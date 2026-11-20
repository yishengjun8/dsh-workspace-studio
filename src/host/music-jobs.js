/** Music-workshop auto-generation jobs: the live bridge from a chat tool to the page.
 *
 *  A chat tool creates ONE job for its session; the page (Explorer) polls, claims the job,
 *  opens a new workshop tab and drives the existing compose/save/export pipeline; the page's
 *  ack settles the tool call so the model can report the real paths.
 *
 *  Deliberately in-memory: a job describes a live page and a live tool call, not durable
 *  state. A Host restart drops it; the tool times out/reports pending and the page simply
 *  polls again. There is no on-disk format to migrate or quarantine.
 *
 *  Invariants:
 *   - one ACTIVE job per session (a second create answers `busy` instead of queuing work);
 *   - a claim older than CLAIM_STALE_MS may be claimed again, so a refreshed/reopened page can
 *     recover a job whose first claimer vanished;
 *   - `ack` accepts only `done / failed / aborted`; anything else is refused, never defaulted;
 *   - ack data is untrusted: only known string/number fields survive, all bounded.
 */
import { randomBytes } from 'node:crypto'
import { MUSIC_BPM_MAX, MUSIC_BPM_MIN, MUSIC_BARS_MAX, MUSIC_BARS_MIN, MUSIC_KEY_ROOTS, MUSIC_MOOD_IDS, MUSIC_STYLE_IDS, normalizeMusicInstruments, normalizeMusicSeamless } from '../shared/music-score.js'
import { MUSIC_EXPORT_FORMATS } from '../shared/music-export.js'

/* A job that nobody acks (page closed, Host half gone) must not block the session forever. */
export const MUSIC_JOB_TTL_MS = 10 * 60 * 1000
/* A claimed job may be re-claimed after this, which is how a refreshed page recovers it. */
export const MUSIC_JOB_CLAIM_STALE_MS = 15 * 1000
/* A Host must not accumulate one entry per session that ever generated music. */
const MUSIC_JOB_SESSIONS_MAX = 16
const MUSIC_JOB_SESSION_MAX = 300
const MUSIC_JOB_ID_MAX = 64
const MUSIC_JOB_PROMPT_MAX = 2000
const MUSIC_JOB_NAME_MAX = 80
const MUSIC_JOB_PATH_MAX = 1000
const MUSIC_JOB_TEXT_MAX = 500
const MUSIC_JOB_CREATE_RATE_MAX = 4
const MUSIC_JOB_CREATE_RATE_WINDOW_MS = 60 * 1000
/* What the page may report. Anything else is refused rather than defaulted to "done". */
const ACK_RESULTS = new Set(['done', 'failed', 'aborted'])

/* How long a finished job's ack is remembered after its entry is gone, so a tool that registers
   its result waiter a moment after the page acked still sees the real outcome. */
const MUSIC_JOB_ACK_GRACE_MS = 60 * 1000

/** session -> { job, waiters, updatedAt } */
const entries = new Map()
/** session -> number[] (create timestamps inside the rate window) */
const rates = new Map()
/** job id -> { ack, at } (short-lived; covers ack-before-wait races) */
const settled = new Map()
let seq = 0

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

const clampFloat = (value, min, max, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function normalizeSession(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text === '' || text.length > MUSIC_JOB_SESSION_MAX) return ''
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(text)) return ''
  return text
}

function normalizeId(value) {
  return typeof value === 'string' && value !== '' && value.length <= MUSIC_JOB_ID_MAX ? value : ''
}

/** One line of page text that is safe to hand back to the model. */
function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, max)
}

/** A file-name base: no path separators or Windows-reserved characters. */
function cleanName(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\\/:*?"<>|]/gu, '-').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, MUSIC_JOB_NAME_MAX)
}

function normalizeExport(value) {
  if (value === 'none') return { format: 'none' }
  if (typeof value === 'string' && MUSIC_EXPORT_FORMATS.includes(value)) return { format: value }
  return { format: null }
}

/** Validate everything the model sent into the one shape the page consumes. */
export function normalizeMusicJobParams(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    prompt: cleanText(value.prompt, MUSIC_JOB_PROMPT_MAX),
    style: MUSIC_STYLE_IDS.includes(value.style) ? value.style : 'lofi',
    mood: MUSIC_MOOD_IDS.includes(value.mood) ? value.mood : 'lazy',
    bars: clampInt(value.bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8),
    bpm: Number.isFinite(Number(value.bpm)) ? clampInt(value.bpm, MUSIC_BPM_MIN, MUSIC_BPM_MAX, 96) : null,
    keyRoot: MUSIC_KEY_ROOTS.includes(value.keyRoot) ? value.keyRoot : null,
    keyMode: value.keyMode === 'major' || value.keyMode === 'minor' ? value.keyMode : null,
    density: clampFloat(value.density, 0, 1, 0.55),
    complexity: clampFloat(value.complexity, 0, 1, 0.5),
    swing: clampFloat(value.swing, 0, 0.75, 0.3),
    humanize: clampFloat(value.humanize, 0, 0.5, 0.08),
    instruments: normalizeMusicInstruments(value.instruments),
    seamless: normalizeMusicSeamless(value.seamless),
    export: normalizeExport(value.export),
    name: cleanName(value.name),
    /* The workspace the creating tool resolved for the session; the page refuses a job from a
       different workspace instead of saving into whatever pane happens to be open. */
    workspaceId: cleanText(value.workspaceId, 64),
  }
}

function publicJob(job) {
  return { id: job.id, params: job.params }
}

function wake(entry, kind, payload) {
  for (const waiter of [...entry.waiters]) {
    if (waiter.kind !== kind) continue
    entry.waiters.delete(waiter)
    waiter.finish(payload)
  }
}

function settle(entry, result) {
  entry.ack = result
  wake(entry, 'result', result)
}

function dropEntry(session) {
  const entry = entries.get(session)
  if (entry === undefined) return
  entries.delete(session)
  for (const waiter of entry.waiters) {
    waiter.finish(waiter.kind === 'claim' ? false : { result: 'expired', data: {} })
  }
  entry.waiters.clear()
}

/** Prune expired jobs and old rate timestamps. Safe to call from every entry point. */
export function pruneMusicJobs(now = Date.now()) {
  for (const [session, entry] of entries) {
    if (now - entry.job.createdAt > MUSIC_JOB_TTL_MS) {
      settle(entry, { result: 'expired', data: {} })
      dropEntry(session)
    }
  }
  for (const [session, stamps] of rates) {
    const live = stamps.filter(stamp => now - stamp < MUSIC_JOB_CREATE_RATE_WINDOW_MS)
    if (live.length === 0) rates.delete(session)
    else rates.set(session, live)
  }
  for (const [id, entry] of settled) {
    if (now - entry.at > MUSIC_JOB_ACK_GRACE_MS) settled.delete(id)
  }
  /* Bound the session table even when jobs complete normally. */
  while (entries.size > MUSIC_JOB_SESSIONS_MAX) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].job.createdAt - b[1].job.createdAt)[0]
    if (oldest === undefined) break
    settle(oldest[1], { result: 'expired', data: {} })
    entries.delete(oldest[0])
  }
}

function rateAllows(session, now) {
  const stamps = (rates.get(session) ?? []).filter(stamp => now - stamp < MUSIC_JOB_CREATE_RATE_WINDOW_MS)
  if (stamps.length >= MUSIC_JOB_CREATE_RATE_MAX) {
    rates.set(session, stamps)
    return false
  }
  stamps.push(now)
  rates.set(session, stamps)
  return true
}

/**
 * Create the one active job for a session.
 * @returns `{ ok: true, id }` or `{ ok: false, reason }`.
 */
export function createMusicJob(sessionValue, paramsValue, now = Date.now()) {
  pruneMusicJobs(now)
  const session = normalizeSession(sessionValue)
  if (session === '') return { ok: false, reason: 'invalid-session' }
  if (entries.has(session)) return { ok: false, reason: 'busy' }
  if (!rateAllows(session, now)) return { ok: false, reason: 'too-many-jobs' }
  const params = normalizeMusicJobParams(paramsValue)
  if (params === null) return { ok: false, reason: 'invalid-params' }
  seq += 1
  const job = {
    id: `job-${now.toString(36)}-${seq.toString(36)}-${randomBytes(4).toString('hex')}`,
    session,
    params,
    createdAt: now,
    claimedAt: 0,
    ack: null,
  }
  const entry = { job, waiters: new Set(), updatedAt: now, ack: null }
  entries.set(session, entry)
  wake(entry, 'claim', true)
  return { ok: true, id: job.id }
}

/**
 * The page's poll: claim a pending (or stale-claimed) job for this session.
 * @returns `{ job: {id, params} | null, busy?: true }`.
 */
export function readMusicJob(sessionValue, now = Date.now()) {
  pruneMusicJobs(now)
  const session = normalizeSession(sessionValue)
  if (session === '') return { job: null }
  const entry = entries.get(session)
  if (entry === undefined) return { job: null }
  if (entry.job.claimedAt !== 0 && now - entry.job.claimedAt < MUSIC_JOB_CLAIM_STALE_MS) {
    return { job: null, busy: true }
  }
  entry.job.claimedAt = now
  entry.updatedAt = now
  wake(entry, 'claim', true)
  return { job: publicJob(entry.job) }
}

function addWaiter(entry, kind, timeoutMs, signal) {
  return new Promise(resolve => {
    let timer = 0
    const waiter = {
      kind,
      finish(payload) {
        if (timer !== 0) clearTimeout(timer)
        if (signal !== undefined && signal !== null) signal.removeEventListener('abort', onAbort)
        resolve(payload)
      },
    }
    const onAbort = () => {
      if (!entry.waiters.delete(waiter)) return
      if (timer !== 0) clearTimeout(timer)
      resolve({ result: 'aborted' })
    }
    entry.waiters.add(waiter)
    timer = setTimeout(() => {
      if (!entry.waiters.delete(waiter)) return
      if (signal !== undefined && signal !== null) signal.removeEventListener('abort', onAbort)
      resolve(kind === 'claim' ? false : { result: 'pending', data: {} })
    }, timeoutMs)
    if (signal !== undefined && signal !== null) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * Wait until the page claims this job.
 * @returns true when claimed, false on timeout/expiry, `{ result: 'aborted' }` when cancelled.
 */
export async function waitMusicJobClaim(sessionValue, idValue, timeoutMs, signal) {
  const session = normalizeSession(sessionValue)
  const id = normalizeId(idValue)
  if (session === '' || id === '') return false
  const entry = entries.get(session)
  if (entry === undefined || entry.job.id !== id) return false
  if (entry.job.claimedAt !== 0) return true
  return addWaiter(entry, 'claim', timeoutMs, signal)
}

/**
 * Wait for the page's ack.
 * @returns `{ result: 'done'|'failed'|'aborted'|'expired'|'pending', data }`.
 */
export async function waitMusicJobResult(sessionValue, idValue, timeoutMs, signal) {
  const session = normalizeSession(sessionValue)
  const id = normalizeId(idValue)
  if (session === '' || id === '') return { result: 'pending', data: {} }
  const entry = entries.get(session)
  if (entry === undefined || entry.job.id !== id) {
    const done = settled.get(id)
    if (done !== undefined && Date.now() - done.at < MUSIC_JOB_ACK_GRACE_MS) return done.ack
    return { result: 'pending', data: {} }
  }
  if (entry.ack !== null) return entry.ack
  return addWaiter(entry, 'result', timeoutMs, signal)
}

function normalizeAckData(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const data = {}
  for (const key of ['path', 'exportPath']) {
    const text = cleanText(value[key], MUSIC_JOB_PATH_MAX)
    if (text !== '') data[key] = text
  }
  for (const key of ['format', 'engine', 'warning', 'error', 'title']) {
    const text = cleanText(value[key], MUSIC_JOB_TEXT_MAX)
    if (text !== '') data[key] = text
  }
  if (Number.isFinite(Number(value.bars))) data.bars = clampInt(value.bars, 0, MUSIC_BARS_MAX, 0)
  return data
}

/**
 * The page's ack. Only a known id and a whitelisted result settle the waiting tool.
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function ackMusicJob(payload, now = Date.now()) {
  const session = normalizeSession(payload?.session)
  const id = normalizeId(payload?.id)
  const result = typeof payload?.result === 'string' ? payload.result : ''
  if (session === '' || id === '') return { ok: false, reason: 'invalid-ack' }
  if (!ACK_RESULTS.has(result)) return { ok: false, reason: 'invalid-result' }
  const entry = entries.get(session)
  if (entry === undefined || entry.job.id !== id) return { ok: false, reason: 'unknown-job' }
  settle(entry, { result, data: normalizeAckData(payload?.data) })
  settled.set(id, { ack: entry.ack, at: now })
  entries.delete(session)
  entry.updatedAt = now
  return { ok: true }
}

/** Cancel a job whose tool call went away; a claimed job is left to finish so a page that
 *  claimed just as the tool timed out is not duplicated by the Host fallback. */
export function cancelMusicJob(sessionValue, idValue) {
  const session = normalizeSession(sessionValue)
  const id = normalizeId(idValue)
  if (session === '' || id === '') return false
  const entry = entries.get(session)
  if (entry === undefined || entry.job.id !== id) return false
  if (entry.job.claimedAt !== 0) return false
  settle(entry, { result: 'aborted', data: {} })
  settled.set(id, { ack: entry.ack, at: Date.now() })
  entries.delete(session)
  return true
}

/** Test/teardown hook: settle every waiter, then forget every job and rate stamp. */
export function resetMusicJobs() {
  for (const session of [...entries.keys()]) {
    const entry = entries.get(session)
    if (entry === undefined) continue
    settle(entry, { result: 'aborted', data: {} })
    dropEntry(session)
  }
  entries.clear()
  rates.clear()
  settled.clear()
  seq = 0
}

/** Test hook: how many sessions currently hold an entry. */
export function musicJobCount() {
  return entries.size
}
