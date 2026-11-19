/** Music-workshop chat collaboration: the live bridge between an open workshop page and the
 *  chat tools.
 *
 *  The page owns the score; this module only mirrors what the page last registered (tracks,
 *  selection, piece header), queues ONE pending patch per session, and hands the page's ack
 *  back to the waiting tool so the model can report what actually happened. Nothing here
 *  touches the filesystem or a workspace: a registration is a page-scoped claim.
 *
 *  Deliberately in-memory: this is a live bridge, not durable state. A Host restart drops it,
 *  the page's next poll answer says `registered: false`, and the page re-registers itself;
 *  there is no stale on-disk format to migrate or quarantine.
 *
 *  One session owns ONE registration: the newest tab to register takes it, a superseded tab
 *  reads `superseded: true` from its own poll and stops. A patch and the tool waiting on it
 *  survive a re-registration (page reload, Host restart), so an edit in flight is still
 *  delivered to the tab that comes back; only an explicit unregister drops them.
 */
import { randomBytes } from 'node:crypto'
import {
  MUSIC_EDIT_OPS_MAX,
  applyMusicOps,
  musicEditSummary,
  validateRewrittenNotes,
} from '../shared/music-edit.js'
import { MUSIC_DRUM_IDS, MUSIC_STEPS_PER_BAR } from '../shared/music-score.js'
import { HttpError } from './errors.js'
import { isPlainObject } from './errors.js'

/* A registration older than this is a page that went away without telling us. Only page
   traffic (register / poll / ack) refreshes it: a tool call must never keep a dead page
   alive for another half hour. */
const COLLAB_TTL_MS = 30 * 60 * 1000
const COLLAB_TRACK_MAX = 24
const COLLAB_NOTE_MAX = 4096
/* Registrations are per open workshop tab; a Host must not accumulate one per session forever. */
const COLLAB_SESSIONS_MAX = 16
const COLLAB_SESSION_MAX = 300
const COLLAB_TAB_MAX = 128
/* How long a tool call waits for the page to apply its patch before reporting "pending".
   Must exceed one slow poll (4 s while the tab is hidden or another preview tab is active). */
const EDIT_ACK_TIMEOUT_MS = 6_500
/* A patch nobody acked (tab frozen, page half gone) must not block every later edit. */
const EDIT_STALE_MS = 10_000
/* Runaway guard: a model that edits a track a dozen times in one turn is guessing, not tuning. */
const EDIT_RATE_MAX = 6
const EDIT_RATE_WINDOW_MS = 60 * 1000
/* Bars of drums one read returns: six lanes x 16 steps per bar is already a lot of context. */
const DRUM_READ_BARS_MAX = 8
/* What the page may report. Anything else is refused rather than defaulted to "applied". */
const ACK_RESULTS = new Set(['applied', 'conflict', 'gone', 'rejected'])

/** session id -> { tab, rev, doc, selected, tracks, patch, waiters, edits, updatedAt } */
const collabs = new Map()

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
  if (text === '' || text.length > COLLAB_SESSION_MAX) return ''
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(text)) return ''
  return text
}

function normalizeTab(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text === '' || text.length > COLLAB_TAB_MAX) return ''
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(text)) return ''
  return text
}

function normalizeNote(value, bars) {
  if (!isPlainObject(value)) return null
  const bar = Math.round(Number(value.bar))
  const step = Math.round(Number(value.step))
  const midi = Math.round(Number(value.midi))
  const len = Math.round(Number(value.len))
  const vel = Math.round(Number(value.vel))
  if (![bar, step, midi, len, vel].every(Number.isFinite)) return null
  /* The client's own notes are already in range; a registration is still an untrusted input,
     and the tools compute over what it says. */
  return {
    bar: clampInt(bar, 1, bars, 1),
    step: clampInt(step, 0, MUSIC_STEPS_PER_BAR - 1, 0),
    midi: clampInt(midi, 0, 127, 60),
    len: clampInt(len, 1, bars * MUSIC_STEPS_PER_BAR, 1),
    vel: clampInt(vel, 1, 127, 96),
  }
}

/* One bar's { step: velocity } map, bounded to the 16-step grid. */
function normalizeStepMap(value) {
  if (!isPlainObject(value)) return {}
  const output = {}
  for (const [rawStep, rawVelocity] of Object.entries(value)) {
    const step = Math.round(Number(rawStep))
    const velocity = Math.round(Number(rawVelocity))
    if (!Number.isFinite(step) || step < 0 || step >= MUSIC_STEPS_PER_BAR) continue
    if (!Number.isFinite(velocity) || velocity <= 0) continue
    output[String(step)] = clampInt(velocity, 1, 127, 96)
  }
  return output
}

/* Only the six known lanes, padded to the piece length: an arbitrary key would become an own
   property of this object (or, for `__proto__`, its prototype). */
function normalizeDrums(value, bars) {
  if (!isPlainObject(value)) return null
  const drums = {}
  for (const lane of MUSIC_DRUM_IDS) {
    const source = Array.isArray(value[lane]) ? value[lane] : []
    drums[lane] = Array.from({ length: bars }, (_, index) => normalizeStepMap(source[index]))
  }
  return drums
}

function normalizeCollabTrack(value, bars) {
  if (!isPlainObject(value)) return null
  const id = typeof value.id === 'string' ? value.id.slice(0, 64) : ''
  if (id === '') return null
  const kind = value.kind === 'drums' ? 'drums' : 'notes'
  const track = {
    id,
    instrument: typeof value.instrument === 'string' ? value.instrument.slice(0, 32) : 'piano',
    name: typeof value.name === 'string' ? value.name.slice(0, 40) : '',
    kind,
    volume: clampFloat(value.volume, 0, 1, 0.8),
    muted: value.muted === true,
    solo: value.solo === true,
    noteCount: clampInt(value.noteCount, 0, 100000, 0),
    /* The page's own fingerprint: the patch carries it back and the page compares it with its
       live track, so a hand edit that raced the tool surfaces as a conflict instead of being
       silently overwritten. */
    rev: typeof value.rev === 'string' ? value.rev.slice(0, 32) : '',
    histogram: Array.isArray(value.histogram) ? value.histogram.slice(0, 512).map(entry => clampInt(entry, 0, 100000, 0)) : [],
    full: false,
  }
  if (kind === 'drums') {
    const drums = normalizeDrums(value.drums, bars)
    if (drums !== null) {
      track.drums = drums
      track.full = true
    }
  } else if (Array.isArray(value.notes) && value.notes.length <= COLLAB_NOTE_MAX) {
    track.notes = value.notes.map(note => normalizeNote(note, bars)).filter(note => note !== null)
    track.full = true
  }
  return track
}

function normalizeDoc(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    title: typeof source.title === 'string' ? source.title.slice(0, 80) : '',
    bars: clampInt(source.bars, 1, 512, 8),
    bpm: clampInt(source.bpm, 40, 200, 96),
    keyRoot: typeof source.keyRoot === 'string' ? source.keyRoot.slice(0, 4) : 'C',
    keyMode: source.keyMode === 'minor' ? 'minor' : 'major',
    style: typeof source.style === 'string' ? source.style.slice(0, 24) : '',
    mood: typeof source.mood === 'string' ? source.mood.slice(0, 24) : '',
    seamless: source.seamless !== false,
    chordProgression: Array.isArray(source.chordProgression)
      ? source.chordProgression.slice(0, 512).map(label => (typeof label === 'string' ? label.slice(0, 16) : ''))
      : [],
  }
}

/* Resolve every waiting tool call in an entry (an unregistered or expired page can never
   ack its patch, so the caller must not be left to time out and report "pending"). */
function settle(entry, result) {
  if (entry.waiters.size === 0) return
  const waiters = [...entry.waiters.values()]
  entry.waiters.clear()
  for (const waiter of waiters) waiter({ result })
}

function prune() {
  const now = Date.now()
  for (const [session, entry] of collabs) {
    if (now - entry.updatedAt <= COLLAB_TTL_MS) continue
    collabs.delete(session)
    settle(entry, 'workshop-closed')
  }
}

/* Cap the registration count: evict the oldest idle session first, then anything oldest. */
function evictOne() {
  let victim = null
  for (const [session, entry] of collabs) {
    if (entry.patch !== null || entry.waiters.size > 0) continue
    if (victim === null || entry.updatedAt < victim.entry.updatedAt) victim = { session, entry }
  }
  if (victim === null) {
    for (const [session, entry] of collabs) {
      if (victim === null || entry.updatedAt < victim.entry.updatedAt) victim = { session, entry }
    }
  }
  if (victim !== null) collabs.delete(victim.session)
}

/* `touch` is off for tool traffic: only the page itself proves the page is still alive. */
function entryOf(payload, touch = false) {
  prune()
  const session = normalizeSession(payload?.session)
  if (session === '') return null
  const entry = collabs.get(session)
  if (entry === undefined) return null
  const tab = normalizeTab(payload?.tab)
  if (tab !== '' && entry.tab !== tab) return null
  if (touch) entry.updatedAt = Date.now()
  return entry
}

/** Register (or refresh) the workshop tab the chat tools may reach. One tab per session. */
export function upsertMusicCollab(payload) {
  const session = normalizeSession(payload?.session)
  const tab = normalizeTab(payload?.tab)
  if (session === '' || tab === '') throw new HttpError(400, 'invalid-music-collab', '会话协作标识无效')
  prune()
  const doc = normalizeDoc(payload?.doc)
  const tracks = []
  for (const source of Array.isArray(payload?.tracks) ? payload.tracks : []) {
    if (tracks.length >= COLLAB_TRACK_MAX) break
    const track = normalizeCollabTrack(source, doc.bars)
    if (track !== null) tracks.push(track)
  }
  const selectedRaw = isPlainObject(payload?.selected) ? payload.selected : null
  const selected = selectedRaw === null || typeof selectedRaw.trackId !== 'string'
    ? null
    : {
        trackId: selectedRaw.trackId.slice(0, 64),
        bars: Array.isArray(selectedRaw.bars) && selectedRaw.bars.length === 2
          ? [clampInt(selectedRaw.bars[0], 1, doc.bars, 1), clampInt(selectedRaw.bars[1], 1, doc.bars, 1)]
          : null,
      }
  const previous = collabs.get(session)
  const rev = clampInt(payload?.rev, 0, Number.MAX_SAFE_INTEGER, 0)
  /* Two registrations of the SAME tab can arrive out of order (debounced edit vs heartbeat):
     the lower rev is the older mirror, so keep the newer one and only refresh liveness. */
  if (previous !== undefined && previous.tab === tab && rev > 0 && previous.rev > 0 && rev < previous.rev) {
    previous.updatedAt = Date.now()
    return { ok: true, stale: true }
  }
  if (previous === undefined && collabs.size >= COLLAB_SESSIONS_MAX) evictOne()
  collabs.set(session, {
    tab,
    rev,
    doc,
    selected,
    tracks,
    /* A patch nobody acked belongs to the SESSION, not to the tab: a reloaded page, a second
       tab or a restarted Host still receives it (and the waiting tool still learns the truth). */
    patch: previous?.patch ?? null,
    waiters: previous?.waiters ?? new Map(),
    edits: previous?.edits ?? [],
    updatedAt: Date.now(),
  })
  return { ok: true }
}

/** Drop the registration when the tab closes; a stale tab cannot drop a newer one. */
export function dropMusicCollab(payload) {
  const session = normalizeSession(payload?.session)
  if (session === '') return { ok: true }
  const entry = collabs.get(session)
  const tab = normalizeTab(payload?.tab)
  if (entry === undefined || (tab !== '' && entry.tab !== tab)) return { ok: true }
  collabs.delete(session)
  settle(entry, 'workshop-closed')
  return { ok: true }
}

/** The page's poll: the one patch it should apply right now, plus whether it still owns the
 *  session (`registered`), whether another tab owns it (`owned`, the client's slot vocabulary)
 *  and the same fact as `superseded`. */
export function readMusicCollabPatch(payload) {
  prune()
  const session = normalizeSession(payload?.session)
  if (session === '') return { patch: null, registered: false, owned: false, superseded: false }
  const entry = collabs.get(session)
  if (entry === undefined) return { patch: null, registered: false, owned: false, superseded: false }
  const tab = normalizeTab(payload?.tab)
  if (tab !== '' && entry.tab !== tab) return { patch: null, registered: false, owned: true, superseded: true }
  entry.updatedAt = Date.now()
  const patch = entry.patch
  return {
    registered: true,
    owned: false,
    superseded: false,
    patch: patch === null
      ? null
      : { id: patch.id, trackId: patch.trackId, mode: patch.mode, bars: patch.bars, ops: patch.ops, notes: patch.notes, baseRev: patch.baseRev, summary: patch.summary },
  }
}

/** The page reports what it did; this is what the waiting tool returns to the model.
 *  Keyed by the patch id (only the tab that polled it knows that id), so a page reloaded
 *  between apply and ack still lands its answer. */
export function ackMusicCollabPatch(payload) {
  prune()
  const session = normalizeSession(payload?.session)
  if (session === '') return { ok: false }
  const entry = collabs.get(session)
  if (entry === undefined) return { ok: false }
  const id = typeof payload?.id === 'string' ? payload.id : ''
  if (entry.patch === null || entry.patch.id !== id) return { ok: false }
  const result = ACK_RESULTS.has(payload?.result) ? payload.result : null
  /* An unknown result must not become "applied": refuse it so the tool times out as pending
     instead of telling the model a lie. */
  if (result === null) return { ok: false }
  entry.updatedAt = Date.now()
  const waiter = entry.waiters.get(id)
  entry.patch = null
  if (waiter !== undefined) waiter({ result, summary: isPlainObject(payload?.summary) ? payload.summary : undefined })
  return { ok: true }
}

/** One track's notes for the read tool, bounded by the requested bar range. */
export function readMusicCollabTrack(payload) {
  const entry = entryOf(payload)
  if (entry === null) return { result: 'workshop-closed' }
  const trackId = typeof payload?.trackId === 'string' ? payload.trackId : ''
  const track = entry.tracks.find(candidate => candidate.id === trackId)
  if (track === undefined) return { result: 'track-missing' }
  if (track.full !== true) return { result: 'track-not-loaded', trackId }
  const docBars = entry.doc.bars
  /* Default: the WHOLE track. The panel's focused bar is a one-bar answer the model would
     read as "the track is almost empty", so it is opt-in through `focus`. */
  const focused = payload?.focus === true && Array.isArray(entry.selected?.bars) ? entry.selected.bars : null
  const fallback = focused ?? [1, docBars]
  const from = clampInt(payload?.bars?.[0], 1, docBars, fallback[0])
  const to = clampInt(payload?.bars?.[1], 1, docBars, Math.max(from, fallback[1]))
  const [low, high] = to < from ? [to, from] : [from, to]
  const limit = clampInt(payload?.limit, 1, 512, 256)
  const head = {
    result: 'ok',
    trackId,
    instrument: track.instrument,
    name: track.name,
    kind: track.kind,
    docBars,
    keyRoot: entry.doc.keyRoot,
    keyMode: entry.doc.keyMode,
    bpm: entry.doc.bpm,
  }
  if (track.kind === 'drums') {
    /* Six lanes x 16 steps per bar: return at most DRUM_READ_BARS_MAX bars of the range and
       say so, instead of dumping a 64-bar grid into the model's context. */
    const drumTo = Math.min(high, low + DRUM_READ_BARS_MAX - 1)
    const drums = {}
    for (const lane of MUSIC_DRUM_IDS) drums[lane] = (track.drums?.[lane] ?? []).slice(low - 1, drumTo)
    return {
      ...head,
      bars: [low, drumTo],
      chords: entry.doc.chordProgression.slice(low - 1, drumTo),
      notes: [],
      truncated: drumTo < high,
      drums,
    }
  }
  const inRange = note => note.bar >= low && note.bar <= high
  const notes = (track.notes ?? []).filter(inRange)
  const sliced = notes.slice(0, limit)
  return {
    ...head,
    bars: [low, high],
    chords: entry.doc.chordProgression.slice(low - 1, high),
    notes: sliced,
    truncated: notes.length > sliced.length,
  }
}

function rateLimited(entry) {
  const now = Date.now()
  entry.edits = entry.edits.filter(at => now - at < EDIT_RATE_WINDOW_MS)
  if (entry.edits.length >= EDIT_RATE_MAX) return true
  entry.edits.push(now)
  return false
}

function waitForAck(entry, id) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      entry.waiters.delete(id)
      resolve({ result: 'pending' })
    }, EDIT_ACK_TIMEOUT_MS)
    entry.waiters.set(id, value => {
      clearTimeout(timer)
      entry.waiters.delete(id)
      resolve(value)
    })
  })
}

/** Merge a validated rewrite into the track: only the requested bars change. */
function mergeRewrite(track, bars, notes) {
  const [from, to] = bars
  const keep = (track.notes ?? []).filter(note => note.bar < from || note.bar > to)
  const merged = [...keep, ...notes].sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi))
  return { ...track, notes: merged }
}

/**
 * The edit tool's body: validate, queue ONE patch, wait for the page, report the truth.
 * Results are 'applied' | 'conflict' | 'gone' | 'rejected' | 'pending' | 'busy' |
 * 'workshop-closed' | 'track-missing' | 'track-not-loaded' | 'too-many-edits' | 'too-many-ops'.
 */
export async function applyMusicCollabEdit(payload) {
  const entry = entryOf(payload)
  if (entry === null) return { result: 'workshop-closed' }
  const trackId = typeof payload?.trackId === 'string' ? payload.trackId : ''
  const track = entry.tracks.find(candidate => candidate.id === trackId)
  if (track === undefined) return { result: 'track-missing', trackId }
  if (track.full !== true) return { result: 'track-not-loaded', trackId }
  /* A patch the page never acked (tab hidden, page frozen) must not block every later edit. */
  if (entry.patch !== null && Date.now() - entry.patch.createdAt > EDIT_STALE_MS) entry.patch = null
  if (entry.patch !== null) return { result: 'busy' }
  if (rateLimited(entry)) return { result: 'too-many-edits' }

  const docBars = entry.doc.bars
  const ops = Array.isArray(payload?.ops) ? payload.ops : null
  const notes = Array.isArray(payload?.notes) ? payload.notes : null
  if (ops === null && notes === null) return { result: 'rejected', reason: 'nothing-to-apply' }
  if (ops !== null && notes !== null) return { result: 'rejected', reason: 'two-modes' }
  /* Refuse an over-long op list: silently applying a prefix makes the model's own count and
     the applied result disagree. */
  if (ops !== null && ops.length > MUSIC_EDIT_OPS_MAX) return { result: 'rejected', reason: 'too-many-ops', limit: MUSIC_EDIT_OPS_MAX }

  let patch
  let summary
  let bars
  if (ops !== null) {
    if (track.kind === 'drums' && ops.some(op => op?.op !== 'drumVary' && op?.op !== 'drumLane')) {
      return { result: 'rejected', reason: 'op-not-applicable' }
    }
    const applied = applyMusicOps(track, ops, { bars: docBars, keyMode: entry.doc.keyMode, keyRoot: entry.doc.keyRoot })
    if (applied.error !== undefined) return { result: 'rejected', reason: applied.error }
    summary = musicEditSummary(track, applied.track, entry.doc)
    patch = { mode: 'ops', ops }
  } else {
    if (track.kind !== 'notes') return { result: 'rejected', reason: 'drums-need-ops' }
    const checked = validateRewrittenNotes({ doc: entry.doc, bars: payload?.bars, notes })
    if (!checked.ok) return { result: 'rejected', reason: checked.violations[0]?.reason ?? 'invalid-notes', violations: checked.violations }
    bars = checked.bars
    summary = musicEditSummary(track, mergeRewrite(track, bars, checked.notes), entry.doc)
    patch = { mode: 'notes', bars, notes: checked.notes }
  }

  const id = randomBytes(8).toString('hex')
  entry.patch = { id, trackId, baseRev: track.rev, summary, ...patch, createdAt: Date.now() }
  const ack = await waitForAck(entry, id)
  if (entry.patch?.id === id) entry.patch = null
  return { result: ack.result, summary: ack.summary ?? summary }
}

/** Read-only overview for the read tool when only the piece header is wanted. */
export function readMusicCollabOverview(payload) {
  const entry = entryOf(payload)
  if (entry === null) return { result: 'workshop-closed' }
  return {
    result: 'ok',
    doc: entry.doc,
    selected: entry.selected,
    tracks: entry.tracks.map(track => ({
      id: track.id,
      instrument: track.instrument,
      name: track.name,
      kind: track.kind,
      noteCount: track.noteCount,
      full: track.full === true,
    })),
  }
}
