/** Session-scoped music cache: the pieces a workshop has already moved away from.
 *
 * The cache is deliberately NOT part of the workspace: it belongs to a preview session, so two
 * music-workshop tabs opened from the same session share it and another session cannot see it.
 * The key is an opaque session/family id; the on-disk file name is its SHA-256, so no caller
 * string can become a path. Writes use the shared serialized-write queue and the same atomic
 * JSON primitives as the rest of the plugin's private stores.
 *
 * The current piece is never stored here. Before a compose/switch/open replaces it, the client
 * snapshots the current piece with `upsert`; selecting a cache row hands its doc back and then
 * deletes the row, so the dropdown can always show "current + history" without duplicates.
 */
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DRAFT_DIR_NAME, readJsonStrict, writeJsonAtomic } from './drafts.js'
import { HttpError } from './errors.js'
import { quarantineFile } from './quarantine.js'
import { serializeWrite } from './write.js'
import { MUSIC_DOC_MAX_BYTES, normalizeMusicDoc, scoreSeconds } from '../shared/music-score.js'

const CACHE_VERSION = 1
const CACHE_MAX_ENTRIES = 20
const CACHE_TOTAL_MAX_BYTES = 8 * 1024 * 1024
const CACHE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/u
const CACHE_DIR = join(homedir(), '.dsh-plugin', DRAFT_DIR_NAME, 'music-cache')

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateSession(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw new HttpError(400, 'invalid-music-cache', '会话缓存标识无效')
  }
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-music-cache', '会话缓存标识无效')
  }
  return value
}

function validateId(value) {
  if (typeof value !== 'string' || !CACHE_ID_RE.test(value)) {
    throw new HttpError(400, 'invalid-music-cache', '缓存条目标识无效')
  }
  return value
}

function sessionHash(session) {
  return createHash('sha256').update(session).digest('hex')
}

function cacheFile(session) {
  return join(CACHE_DIR, `${sessionHash(session)}.json`)
}

function fingerprint(doc) {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex')
}

function safeTimestamp(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function cleanPieceKey(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 128) {
    throw new HttpError(400, 'invalid-music-cache', '缓存曲目标识无效')
  }
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-music-cache', '缓存曲目标识无效')
  }
  return value
}

function cleanSavedPath(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 1024) {
    throw new HttpError(400, 'invalid-music-cache', '缓存保存路径无效')
  }
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-music-cache', '缓存保存路径无效')
  }
  return value
}

function normalizeEntry(value) {
  if (!isPlainObject(value) || !CACHE_ID_RE.test(value.id ?? '')) return null
  const doc = normalizeMusicDoc(value.doc)
  if (doc === null) return null
  return {
    createdAt: safeTimestamp(value.createdAt, doc.createdAt),
    doc,
    id: value.id,
    pieceKey: typeof value.pieceKey === 'string' && value.pieceKey !== '' ? value.pieceKey : null,
    savedPath: typeof value.savedPath === 'string' && value.savedPath !== '' ? value.savedPath : null,
    title: doc.title,
    updatedAt: safeTimestamp(value.updatedAt, doc.updatedAt),
  }
}

function metadataOf(entry) {
  return {
    bars: entry.doc.bars,
    bpm: entry.doc.bpm,
    createdAt: entry.createdAt,
    id: entry.id,
    mood: entry.doc.prompt.mood,
    pieceKey: entry.pieceKey,
    savedPath: entry.savedPath,
    seconds: Math.round(scoreSeconds(entry.doc) * 10) / 10,
    style: entry.doc.prompt.style,
    title: entry.title,
    trackCount: entry.doc.tracks.length,
    updatedAt: entry.updatedAt,
  }
}

async function readCache(session) {
  const target = cacheFile(session)
  const read = await readJsonStrict(target)
  if (read.status === 'missing') return { entries: [], target }
  if (read.status === 'invalid') {
    await quarantineFile(target, 'not a current music-cache record')
    return { entries: [], target }
  }
  if (read.value.version !== CACHE_VERSION || !Array.isArray(read.value.entries)) {
    await quarantineFile(target, 'not a current music-cache record')
    return { entries: [], target }
  }
  const entries = read.value.entries.map(normalizeEntry).filter(entry => entry !== null)
  return { entries, target }
}

async function writeCache(target, entries) {
  await writeJsonAtomic(target, { entries, version: CACHE_VERSION })
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
}

function cacheBytes(entries) {
  return Buffer.byteLength(JSON.stringify(entries), 'utf8')
}

function capEntries(entries) {
  const sorted = sortEntries(entries).slice(0, CACHE_MAX_ENTRIES)
  if (cacheBytes(sorted) <= CACHE_TOTAL_MAX_BYTES) return sorted
  while (sorted.length > 1 && cacheBytes(sorted) > CACHE_TOTAL_MAX_BYTES) sorted.pop()
  if (cacheBytes(sorted) > CACHE_TOTAL_MAX_BYTES) {
    throw new HttpError(413, 'music-cache-too-large', '缓存的乐谱过大')
  }
  return sorted
}

/** Read the metadata list for one session; docs stay on disk until a row is selected. */
export async function listMusicCache(queues, payload) {
  const session = validateSession(payload?.session)
  return serializeWrite(queues, `music-cache:${sessionHash(session)}`, async () => {
    const { entries } = await readCache(session)
    return { entries: sortEntries(entries).slice(0, CACHE_MAX_ENTRIES).map(metadataOf), version: CACHE_VERSION }
  })
}

/** Read one cached score for a switch. */
export async function readMusicCacheEntry(queues, payload) {
  const session = validateSession(payload?.session)
  const id = validateId(payload?.id)
  return serializeWrite(queues, `music-cache:${sessionHash(session)}`, async () => {
    const { entries } = await readCache(session)
    const entry = entries.find(item => item.id === id)
    if (entry === undefined) throw new HttpError(404, 'music-cache-not-found', '缓存曲目不存在')
    return { entry: { ...metadataOf(entry), doc: entry.doc } }
  })
}

/** Snapshot the current piece. The same document/fingerprint refreshes the existing row instead
 *  of creating a duplicate when a user switches back and forth. */
export async function upsertMusicCache(queues, payload) {
  const session = validateSession(payload?.session)
  const input = payload?.entry
  if (!isPlainObject(input)) throw new HttpError(400, 'invalid-music-cache', '缓存条目无效')
  const doc = normalizeMusicDoc(input.doc)
  if (doc === null) throw new HttpError(400, 'invalid-music-doc', '乐谱内容无效')
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MUSIC_DOC_MAX_BYTES) {
    throw new HttpError(413, 'music-doc-too-large', '乐谱文件过大')
  }
  const now = Date.now()
  return serializeWrite(queues, `music-cache:${sessionHash(session)}`, async () => {
    const { entries, target } = await readCache(session)
    const hash = fingerprint(doc)
    const requestedId = CACHE_ID_RE.test(input.id ?? '') ? input.id : null
    let found = requestedId === null ? null : entries.find(item => item.id === requestedId) ?? null
    if (found === null) found = entries.find(item => fingerprint(item.doc) === hash) ?? null
    const id = found?.id ?? requestedId ?? randomUUID()
    const savedPath = cleanSavedPath(input.savedPath)
    const pieceKey = cleanPieceKey(input.pieceKey) ?? found?.pieceKey ?? null
    const entry = {
      createdAt: found?.createdAt ?? safeTimestamp(input.createdAt, doc.createdAt || now),
      doc,
      id,
      pieceKey,
      savedPath: savedPath ?? found?.savedPath ?? null,
      title: doc.title,
      updatedAt: now,
    }
    const next = capEntries([...entries.filter(item => item.id !== id), entry])
    await writeCache(target, next)
    return { entry: metadataOf(entry), version: CACHE_VERSION }
  })
}

/** Remove one cached row. The active score is never a cache row, so this cannot delete the
 *  workshop's current document; it only drops the snapshot. */
export async function deleteMusicCacheEntry(queues, payload) {
  const session = validateSession(payload?.session)
  const id = validateId(payload?.id)
  return serializeWrite(queues, `music-cache:${sessionHash(session)}`, async () => {
    const { entries, target } = await readCache(session)
    const next = entries.filter(item => item.id !== id)
    if (next.length !== entries.length) await writeCache(target, next)
    return { deleted: next.length !== entries.length, version: CACHE_VERSION }
  })
}
