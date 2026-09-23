/** Token usage statistics: aggregates assistant/message usage records from every session log into per-day buckets, cached per session behind a STABLE per-session log fingerprint so repeated scans only re-read changed logs. A long cold scan runs in the background and checkpoints, and requests always answer from the cached index (partial results + progress) instead of waiting for it. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isPlainObject } from './errors.js'
import { sessionRowFingerprint, sessionRowId } from './session-rows.js'
import { DRAFT_DIR_NAME, readJsonFileOrNull, writeJsonAtomic } from './drafts.js'

const TOKEN_STATS_SUB_DIR = 'token-stats'
const USAGE_INDEX_VERSION = 1
/* Sessions between two durable index checkpoints: a cold scan interrupted by a restart resumes from the last checkpoint instead of from zero, while the index still only sees a handful of writes. */
const CHECKPOINT_EVERY = 100
/* A request arriving this soon after a settled sync answers from the index without starting another one; the client's progress poll would otherwise re-list the storage on every tick. */
const SYNC_DEBOUNCE_MS = 2000
/* How long a persisted "this log cannot be read" verdict is trusted. The verdict is keyed by the
   per-session fingerprint (session-rows.js), so it survives restarts; without a bound a harness
   upgrade that learned to read an older generation would keep serving the stale verdict forever.
   Re-attempting is cheap: one open per such session, at most once per window. */
const UNREADABLE_RETRY_MS = 7 * 24 * 60 * 60 * 1000

function usageIndexPath() {
  return join(homedir(), '.dsh-plugin', DRAFT_DIR_NAME, TOKEN_STATS_SUB_DIR, 'usage-index.json')
}

/* Zero-valued token row shared by degenerate responses. */
function emptyTotals() {
  return { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
}

/* Local midnight (ms) of an event time — the coarsest bucket every supported range needs. */
function dayStartOf(time) {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return Number.NaN
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/* Non-negative integer coercion: NaN/negative/non-finite usage fields count as 0. */
function countOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/* Attached sessions expose their live event array for free; the fork-inherited prefix count travels on the session, mirroring the mind-map read path. Null when the session is not attached. */
function liveUsageEvents(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId)
  if (live === undefined || typeof live.snapshotEvents !== 'function') return null
  try {
    const events = live.snapshotEvents()
    if (!Array.isArray(events)) return null
    return { events, inheritedEventCount: Number.isSafeInteger(live.inheritedEventCount) ? live.inheritedEventCount : 0 }
  } catch {
    return null
  }
}

/* Cold (non-attached) session read through the persistence seam: one read handle opened, read, closed. `read()` answers with a result object ({ eventState, events }) — the events array lives under `.events`, so the result itself is never the array (an array answer is still tolerated). Events are null when the log could not be read. */
async function coldUsageEvents(persistence, sessionId) {
  if (persistence === undefined || typeof persistence.open !== 'function') return null
  let handle
  try {
    handle = await persistence.open(String(sessionId), 'read')
  } catch {
    return null
  }
  try {
    const result = await handle.read()
    const events = Array.isArray(result)
      ? result
      : isPlainObject(result) && Array.isArray(result.events)
        ? result.events
        : null
    return {
      events,
      inheritedEventCount: Number.isSafeInteger(handle.inheritedEventCount) ? handle.inheritedEventCount : 0,
    }
  } catch {
    return null
  } finally {
    try { await handle.close() } catch { /* release is best-effort */ }
  }
}

/* Day-bucket rows for one session log: only assistant/message events with a plain usage object count; the fork-inherited prefix (already counted in the parent's log) is skipped. Each row collapses one (day, provider/model) pair. */
export function usageRowsOfEvents(events, inheritedEventCount) {
  const rows = []
  if (!Array.isArray(events)) return rows
  const buckets = new Map() // `${t}\u0001${provider}\u0001${model}` -> row index
  const skip = Number.isSafeInteger(inheritedEventCount) && inheritedEventCount > 0 ? inheritedEventCount : 0
  for (let index = skip; index < events.length; index += 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'assistant/message') continue
    const usage = event.data === null || event.data === undefined ? undefined : event.data.usage
    if (!isPlainObject(usage)) continue
    const source = isPlainObject(event.data?.message?.source) ? event.data.message.source : null
    const provider = typeof source?.provider === 'string' && source.provider !== '' ? source.provider : 'unknown'
    const model = typeof source?.model === 'string' && source.model !== '' ? source.model : provider
    const day = dayStartOf(event.time)
    if (Number.isNaN(day)) continue
    const key = `${day}\u0001${provider}\u0001${model}`
    let row = buckets.get(key)
    if (row === undefined) {
      row = { t: day, p: provider, m: model, i: 0, cr: 0, cw: 0, o: 0, c: 0 }
      buckets.set(key, row)
      rows.push(row)
    }
    row.i += countOf(usage.inputTokens)
    row.cr += countOf(usage.cacheReadTokens)
    row.cw += countOf(usage.cacheWriteTokens)
    row.o += countOf(usage.outputTokens)
    row.c += 1
  }
  return rows
}

/* In-memory copy of the usage index, filled by the first sync (startup warm-up or first request) so later aggregation reads no file. Mutations happen only inside refreshUsageIndex, which runs inside the single-flight sync, so aggregation (synchronous) never observes a half-written index. */
let usageIndexMemory = null
/* The in-flight sync, or null when idle. */
let usageIndexSync = null
/* Progress of the newest sync, reported so a panel answered from a partial index can show how far the background scan is. */
let usageIndexProgress = { processed: 0, total: 0 }
/* When the last sync settled, for the request debounce. */
let usageIndexSettledAt = 0

/* Sessions the backend refused to read, remembered as cached verdicts: the panel reports them instead of leaving their cost unpaid on every sync. */
function unreadableCountOf(sessions) {
  let count = 0
  for (const key of Object.keys(sessions)) {
    if (sessions[key]?.unreadable === true) count += 1
  }
  return count
}

/* Single-flight sync of the usage index against the persistence listing. Returns null when a settled sync is recent enough to skip (unless forced). The returned promise never rejects: every failure mode degrades to the cached index and is surfaced through the response counters, so callers may fire it and forget. */
function syncUsageIndex(ctx, persistence, options) {
  if (usageIndexSync !== null) return usageIndexSync
  if (options?.force !== true && usageIndexSettledAt !== 0 && Date.now() - usageIndexSettledAt < SYNC_DEBOUNCE_MS) return null
  const run = (async () => {
    try {
      return await refreshUsageIndex(ctx, persistence)
    } catch {
      return { storageError: false, failed: unreadableCountOf(usageIndexMemory === null ? {} : usageIndexMemory.sessions), scanned: 0 }
    }
  })()
  usageIndexSync = run
  const settle = () => {
    if (usageIndexSync === run) usageIndexSync = null
    usageIndexSettledAt = Date.now()
  }
  void run.then(settle, settle)
  return run
}

async function refreshUsageIndex(ctx, persistence) {
  const indexPath = usageIndexPath()
  let index = usageIndexMemory !== null ? usageIndexMemory : await readJsonFileOrNull(indexPath)
  if (!isPlainObject(index) || index.version !== USAGE_INDEX_VERSION || !isPlainObject(index.sessions)) {
    index = { version: USAGE_INDEX_VERSION, sessions: {} }
  }
  usageIndexMemory = index
  const sessions = index.sessions
  let listed
  try {
    listed = await persistence.list()
  } catch {
    /* The storage index is unusable: serve the cached index as-is; the next request retries. */
    return { storageError: true, failed: unreadableCountOf(sessions), scanned: 0 }
  }
  const entries = []
  for (const row of listed) {
    const id = sessionRowId(row)
    if (id === undefined) continue
    /* Fingerprint (per-session physical revision, legacy corpus suffix stripped) instead of the
       raw revision: a legacy row's revision embeds a hash over EVERY log in the store, so the old
       key changed whenever any unrelated session appended — every sync then re-read the whole
       legacy population (1100+ sessions here) and the Host never went idle. */
    entries.push({ key: id, rev: sessionRowFingerprint(row) })
  }
  usageIndexProgress = { processed: 0, total: entries.length }
  let changed = false
  let scanned = 0
  let sinceCheckpoint = 0
  /* Durability between two long stretches of work: a crash or restart resumes from the last checkpoint. */
  const checkpoint = async () => {
    if (!changed || sinceCheckpoint < CHECKPOINT_EVERY) return
    sinceCheckpoint = 0
    try {
      await writeJsonAtomic(indexPath, index)
    } catch {
      /* A failed checkpoint keeps the previous file; the scan continues. */
    }
  }
  for (const entry of entries) {
    const { key, rev } = entry
    /* Attached sessions are read from memory, and their log may not be flushed yet: the snapshot length joins the fingerprint so a live session still refreshes between two durable appends. */
    const live = liveUsageEvents(ctx, key)
    const identity = live === null ? String(rev) : `${rev}#${live.events.length}`
    const cached = sessions[key]
    /* A cached "unreadable" verdict is trusted only for UNREADABLE_RETRY_MS: beyond that the
       session is re-attempted once (see the constant), so a harness that learned to read the
       format is not locked out by a verdict minted before the upgrade. */
    const verdictExpired = isPlainObject(cached) && cached.unreadable === true
      && !(Number(cached.at) > 0 && Date.now() - Number(cached.at) < UNREADABLE_RETRY_MS)
    if (!verdictExpired && isPlainObject(cached) && cached.rev === identity && (Array.isArray(cached.rows) || cached.unreadable === true)) {
      usageIndexProgress.processed += 1
      continue
    }
    scanned += 1
    const read = live ?? await coldUsageEvents(persistence, key)
    if (read === null || read.events === null) {
      /* A log the backend refuses (legacy or unsupported format) is a verdict, not a transient fault: caching it (with the fingerprint key and the attempt time) keeps every later sync from paying for the same failed read, while the timestamp bounds how long that verdict is trusted. */
      sessions[key] = { rev: identity, rows: [], unreadable: true, at: Date.now() }
    } else {
      sessions[key] = { rev: identity, rows: usageRowsOfEvents(read.events, read.inheritedEventCount) }
    }
    changed = true
    sinceCheckpoint += 1
    usageIndexProgress.processed += 1
    await checkpoint()
  }
  /* Sessions that vanished from the listing no longer exist: prune them so the index cannot grow unbounded. An empty listing against a populated index is treated as a transient storage answer and never prunes the cache. */
  const seen = new Set(entries.map(entry => entry.key))
  let pruned = false
  if (!(entries.length === 0 && Object.keys(sessions).length > 0)) {
    for (const key of Object.keys(sessions)) {
      if (!seen.has(key)) {
        delete sessions[key]
        pruned = true
      }
    }
  }
  if (changed || pruned) {
    try {
      await writeJsonAtomic(indexPath, index)
    } catch {
      /* A failed cache write keeps the previous index on disk; the next request re-reads the changed sessions and retries. */
    }
  }
  return { storageError: false, failed: unreadableCountOf(sessions), scanned }
}

/* Startup warm-up: kick the single-flight index sync in the background so the first panel open answers from the cache instead of scanning. Bounded retries cover a late-loading persistence service; giving up only costs the first request doing the scan itself. */
export function warmTokenStatsIndex(ctx) {
  let attempts = 0
  const attempt = () => {
    attempts += 1
    let persistence
    try {
      persistence = ctx.get('sessionPersistence')
    } catch {
      persistence = undefined
    }
    if (persistence !== undefined && typeof persistence.list === 'function') {
      void syncUsageIndex(ctx, persistence, { force: true })
      return
    }
    if (attempts < 30) setTimeout(attempt, 2000)
  }
  setTimeout(() => attempt(), 1500)
}

/* Archived session ids from the workspace registry; an unavailable face degrades to an empty set (nothing excluded). */
function archivedSessionIdsOf(ctx) {
  const ids = ctx.workspaceRegistry === null || ctx.workspaceRegistry === undefined ? undefined : ctx.workspaceRegistry.archivedSessionIds
  if (!Array.isArray(ids)) return new Set()
  const set = new Set()
  for (const id of ids) set.add(String(id))
  return set
}

/**
 * Aggregate token usage over [from, to) (ms) per provider/model.
 *
 * Answers from the cached index as soon as one exists — a background scan never blocks the panel — and reports `warming` plus `progress` so the caller can poll until the scan settles. Only a request that finds no index at all waits for the sync.
 * @param query - { from, to, archived } with from/to as non-negative safe integers and archived a boolean (true = include archived sessions, the default).
 */
export async function computeTokenStats(ctx, persistence, query) {
  const { from, to } = query
  const includeArchived = query.archived !== false
  const degraded = { available: false, from, to, archived: includeArchived, totals: emptyTotals(), rows: [], failed: 0, scanned: 0, warming: false, progress: { processed: 0, total: 0 } }
  if (persistence === undefined || typeof persistence.list !== 'function') return degraded
  let synced = null
  if (usageIndexMemory === null) {
    /* Cold first request (opened before the warm-up landed): this one request pays for the sync, since there is nothing to answer with yet. */
    synced = await syncUsageIndex(ctx, persistence, { force: true })
    if (synced === null || synced.storageError === true) {
      return { ...degraded, failed: synced?.failed ?? 0, scanned: synced?.scanned ?? 0 }
    }
  } else {
    /* A cached index exists: refresh it in the background and answer immediately with what is already known. */
    void syncUsageIndex(ctx, persistence)
  }
  /* The sync left the index in memory (warm-up, background refresh or this request); aggregate straight from it, no file read. */
  const sessions = usageIndexMemory === null ? {} : usageIndexMemory.sessions
  const archivedSet = includeArchived ? null : archivedSessionIdsOf(ctx)
  const byModel = new Map() // `${provider}\u0001${model}` -> cell
  for (const key of Object.keys(sessions)) {
    if (archivedSet !== null && archivedSet.has(key)) continue
    const rows = sessions[key]?.rows
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      if (!(row.t >= from && row.t < to)) continue
      const mkey = `${row.p}\u0001${row.m}`
      let cell = byModel.get(mkey)
      if (cell === undefined) {
        cell = { provider: row.p, model: row.m, calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
        byModel.set(mkey, cell)
      }
      cell.calls += row.c
      cell.input += row.i
      cell.cacheRead += row.cr
      cell.cacheWrite += row.cw
      cell.output += row.o
    }
  }
  const rowsOut = [...byModel.values()].map(cell => ({
    provider: cell.provider,
    model: cell.model,
    calls: cell.calls,
    input: cell.input,
    cacheRead: cell.cacheRead,
    cacheWrite: cell.cacheWrite,
    output: cell.output,
  }))
  rowsOut.sort((a, b) => (
    (b.input + b.cacheRead + b.cacheWrite + b.output) - (a.input + a.cacheRead + a.cacheWrite + a.output)
  ))
  const totals = rowsOut.reduce((acc, row) => {
    acc.calls += row.calls
    acc.input += row.input
    acc.cacheRead += row.cacheRead
    acc.cacheWrite += row.cacheWrite
    acc.output += row.output
    return acc
  }, emptyTotals())
  return {
    available: true,
    from,
    to,
    archived: includeArchived,
    totals,
    rows: rowsOut,
    failed: unreadableCountOf(sessions),
    scanned: synced?.scanned ?? 0,
    warming: usageIndexSync !== null,
    progress: { processed: usageIndexProgress.processed, total: usageIndexProgress.total },
  }
}
