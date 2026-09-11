/* Global in-memory (never persisted) cache of decoded file-read payloads,
 * keyed per (workspaceId, path, encoding) with the DISK CHANGE SNAPSHOT the
 * payload was read against, so a re-activation paints instantly and only
 * re-fetches when a change check reports the disk moved.
 *
 * Invariants (dev-notes §23): content and snapshot always move together (a
 * baseline-only update is never written into an entry — when the disk moved
 * the entry is dropped); the payload is disk content only (restored drafts
 * never enter); the cache is bounded and dies with the page. Key layout:
 * workspaceId \u0000 path \u0000 encoding (the RESULT encoding the tab
 * carries). */
import { FILE_CACHE_MAX_BYTES, FILE_CACHE_MAX_ENTRIES, FILE_CACHE_MAX_ENTRY_BYTES } from './constants.js'

const SEP = '\u0000'
/* path -> { encodings: Map<encoding, { payload, snapshot, bytes }>, at } */
const cache = new Map()
let totalBytes = 0

function keyOf(workspaceId, path) { return `${String(workspaceId)}${SEP}${path}` }
/* Key header of one workspace's entries: every group key starts with it. */
function wsHeader(workspaceId) { return `${String(workspaceId)}${SEP}` }
function pathPartOf(key, workspaceId) { return key.slice(wsHeader(workspaceId).length) }
function removePath(key) {
  const group = cache.get(key)
  if (group === undefined) return false
  cache.delete(key)
  for (const entry of group.encodings.values()) totalBytes -= entry.bytes
  return true
}
/* Drop oldest path groups until the byte/count caps fit `extra`; a single over-cap path is skipped at store time, so eviction always converges. */
function evictFor(extra) {
  while ((cache.size >= FILE_CACHE_MAX_ENTRIES || totalBytes + extra > FILE_CACHE_MAX_BYTES) && cache.size > 0) {
    let oldestKey
    let oldestAt = Infinity
    for (const [pathKey, group] of cache) {
      if (group.at < oldestAt) {
        oldestAt = group.at
        oldestKey = pathKey
      }
    }
    if (oldestKey !== undefined) removePath(oldestKey)
  }
}
function touch(pathKey, at) {
  const group = cache.get(pathKey)
  if (group === undefined) return
  group.at = at
  /* LRU eviction re-scans all groups on overflow (bounded by MAX_ENTRIES), so iteration order is irrelevant here. */
}
function pathMatches(pathPart, path) {
  return pathPart === path || (path !== '' && pathPart.startsWith(`${path}/`))
}

/* Returns { payload, snapshot } or undefined (also serves as LRU touch). */
export function getCachedPreview(workspaceId, path, encoding) {
  const group = cache.get(keyOf(workspaceId, path))
  if (group === undefined) return undefined
  const entry = group.encodings.get(String(encoding ?? 'utf-8'))
  if (entry === undefined) return undefined
  touch(keyOf(workspaceId, path), Date.now())
  return { payload: entry.payload, snapshot: entry.snapshot }
}
/* Store (or replace) one (path, encoding) payload+snapshot pair; payloads larger than FILE_CACHE_MAX_ENTRY_BYTES are not cached. */
export function storeCachedPreview(workspaceId, path, encoding, payload, snapshot) {
  const enc = String(encoding ?? 'utf-8')
  if (typeof payload?.content !== 'string') return
  const bytes = payload.content.length + 512
  if (bytes > FILE_CACHE_MAX_ENTRY_BYTES) return
  const pathKey = keyOf(workspaceId, path)
  let group = cache.get(pathKey)
  if (group === undefined) {
    evictFor(bytes)
    group = { encodings: new Map(), at: 0 }
    cache.set(pathKey, group)
  }
  const prior = group.encodings.get(enc)
  if (prior !== undefined) totalBytes -= prior.bytes
  group.encodings.set(enc, { payload, snapshot, bytes })
  totalBytes += bytes
  touch(pathKey, Date.now())
  /* Evict AFTER storing and touching: the just-stored group is now the newest, so the sweep can only drop genuinely older groups. Evicting BEFORE the store could select the very group being written (its stale `at` while a read is in flight) — the entry would land in a detached Map and totalBytes would drift. */
  evictFor(0)
}
/* Refresh an entry's snapshot after a successful UNCHANGED change check; never call with a snapshot describing a different disk state than the stored payload. */
export function refreshCachedSnapshot(workspaceId, path, encoding, snapshot) {
  const group = cache.get(keyOf(workspaceId, path))
  if (group === undefined) return
  const entry = group.encodings.get(String(encoding ?? 'utf-8'))
  if (entry === undefined) return
  entry.snapshot = snapshot
  touch(keyOf(workspaceId, path), Date.now())
}
/* Drop every encoding entry of one exact path (file save-as, delete). */
export function invalidateCachedPath(workspaceId, path) {
  removePath(keyOf(workspaceId, path))
}
/* Drop the path and every descendant (directory delete/move source). */
export function invalidateCachedSubtree(workspaceId, path) {
  for (const pathKey of [...cache.keys()]) {
    if (pathMatches(pathPartOf(pathKey, workspaceId), path)) removePath(pathKey)
  }
}
/* Move a subtree's entries to a new path (fs rename/move). The payload and snapshot describe the same disk content, so they survive the move. */
export function rewriteCachedPaths(workspaceId, from, to) {
  if (from === to) return
  const header = wsHeader(workspaceId)
  const fromHeader = keyOf(workspaceId, from)
  const affected = []
  for (const pathKey of cache.keys()) {
    if (pathMatches(pathPartOf(pathKey, workspaceId), from)) affected.push(pathKey)
  }
  for (const pathKey of affected) {
    const group = cache.get(pathKey)
    if (group === undefined) continue
    cache.delete(pathKey)
    /* pathKey = ws \0 from [remainder]; rebuild with `to` keeping the remainder ('' for the exact path, '/x' for descendants). */
    const nextKey = header + to + pathKey.slice(fromHeader.length)
    /* A stale destination group (e.g. the destination was deleted out-of-band and never invalidated) would be silently replaced by Map.set while its bytes stayed counted in totalBytes: route the replacement through the accounting primitive. */
    if (cache.has(nextKey)) removePath(nextKey)
    cache.set(nextKey, group)
  }
}
/* Pure snapshot helpers shared with the editor session. */
export function diskSnapshot(mtimeMs, size, revision) {
  return {
    mtimeMs: Number(mtimeMs) || 0,
    size: Number(size) || 0,
    hash: typeof revision === 'string' ? revision : null,
    checkedAt: Date.now(),
  }
}
/* Change-signal equality of two snapshots: mtime/size/hash only (checkedAt never participates in content identity). */
export function sameDiskSnapshot(a, b) {
  if (a === b) return true
  if (a === undefined || a === null || b === undefined || b === null) return false
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.hash === b.hash
}
