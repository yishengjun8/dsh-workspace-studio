/* Zero-dependency self-check for the music workshop's chat collaboration.
 *
 * Two layers, because a patch can only mean one thing if both agree:
 *   1. the shared edit rules (deterministic ops, rewrite validation, summary/fingerprint);
 *   2. the Host bridge's state machine (register -> patch -> ack, reload, takeover, unregister,
 *      rate/op limits, registration ordering, TTL).
 *
 * Deliberately no timers longer than a few tens of ms: every path that would wait for the page
 * is either acked here or resolved by the bridge itself. Run from the repo root:
 *   node scripts/check-music-collab.mjs
 */
import {
  MUSIC_EDIT_OPS_MAX,
  applyMusicOps,
  musicEditSummary,
  musicTrackFingerprint,
  validateRewrittenNotes,
} from '../src/shared/music-edit.js'
import { MUSIC_DRUM_IDS } from '../src/shared/music-score.js'
import {
  ackMusicCollabPatch,
  applyMusicCollabEdit,
  dropMusicCollab,
  readMusicCollabOverview,
  readMusicCollabPatch,
  readMusicCollabTrack,
  upsertMusicCollab,
} from '../src/host/music-collab.js'

let failures = 0
let checks = 0
const check = (condition, message) => {
  checks += 1
  if (condition) return
  failures += 1
  console.error(`FAIL ${message}`)
}
const equal = (actual, expected, message) => {
  const got = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  check(got === want, `${message} (got ${got}, want ${want})`)
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20))

/* ---- fixtures ------------------------------------------------------------------------- */

const note = (bar, step, midi, len = 4, vel = 90) => ({ bar, step, midi, len, vel })
const doc = { bars: 8, bpm: 96, chordProgression: Array.from({ length: 8 }, () => 'Cmaj7'), keyMode: 'major', keyRoot: 'C', style: '', mood: '', seamless: true, title: 'check' }
const notes = [note(1, 0, 60), note(5, 0, 64, 8)]
const fingerprint = musicTrackFingerprint({ instrument: 'piano', kind: 'notes', notes })
const notesTrack = (overrides = {}) => ({
  histogram: [],
  id: 'piano',
  instrument: 'piano',
  kind: 'notes',
  muted: false,
  name: '',
  noteCount: notes.length,
  notes,
  rev: fingerprint,
  solo: false,
  volume: 0.8,
  ...overrides,
})
let rev = 0
const register = (session, tab, extra = {}) => {
  rev += 1
  return upsertMusicCollab({
    doc,
    rev,
    selected: { bars: [1, 1], trackId: 'piano' },
    session,
    tab,
    tracks: [notesTrack()],
    ...extra,
  })
}

/* ---- 1. shared edit rules ------------------------------------------------------------- */

const transpose = [{ bars: [1, 2], op: 'transpose', semitones: 2 }]
const first = applyMusicOps({ instrument: 'piano', kind: 'notes', notes }, transpose, { bars: 8 })
const second = applyMusicOps({ instrument: 'piano', kind: 'notes', notes }, transpose, { bars: 8 })
equal(first.track.notes, second.track.notes, 'ops are deterministic')
equal(first.track.notes[0].midi, 62, 'transpose shifts the pitch')

const spanning = [note(1, 0, 60, 48)]
const trimmed = applyMusicOps({ kind: 'notes', notes: spanning }, [{ bars: [2, 2], op: 'trim' }], { bars: 8 })
equal(trimmed.track.notes, [note(1, 0, 60, 16), note(3, 0, 60, 16)], 'trim splits a note that spans the cut')

const clamped = applyMusicOps({ kind: 'notes', notes: [note(1, 0, 60)] }, [{ bars: [1, 1], factor: 2, max: 20, min: 100, op: 'velocity' }], { bars: 8 })
equal(clamped.track.notes[0].vel, 100, 'velocity swaps an inverted min/max instead of flattening')

const tooMany = applyMusicOps({ kind: 'notes', notes }, Array.from({ length: MUSIC_EDIT_OPS_MAX + 1 }, () => ({ bars: [1, 1], factor: 1.1, op: 'velocity' })), { bars: 8 })
equal(tooMany.error, 'too-many-ops', 'an over-long op list is refused, not trimmed')

const outOfKey = validateRewrittenNotes({ bars: [1, 1], doc, notes: [note(1, 0, 61)] })
equal(outOfKey.violations?.[0]?.reason, 'not-in-key', 'rewrite rejects a pitch outside the key')
const overlap = validateRewrittenNotes({ bars: [1, 1], doc, notes: [note(1, 0, 60, 4), note(1, 2, 60, 4)] })
equal(overlap.violations?.[0]?.reason, 'overlap', 'rewrite rejects overlapping notes on one pitch')
const cleared = validateRewrittenNotes({ bars: [1, 1], doc, notes: [] })
check(cleared.ok === true && cleared.notes.length === 0, 'an empty rewrite clears the range')
const missing = validateRewrittenNotes({ bars: [1, 1], doc })
check(missing.ok === false, 'a rewrite without a notes array is malformed')

equal(
  musicEditSummary({ notes }, { notes: [] }, doc).notesAfter,
  0,
  'the summary counts the real after-track',
)
check(musicTrackFingerprint({ kind: 'notes', notes: [note(1, 0, 60)] }) !== fingerprint, 'the fingerprint follows the notes')

/* ---- 2. Host bridge ------------------------------------------------------------------- */

/* Whole-track default, opt-in focus, and the drums range cap. */
register('s-read', 'tab-a')
const whole = readMusicCollabTrack({ session: 's-read', trackId: 'piano' })
equal(whole.notes.length, 2, 'read without bars answers for the whole track')
const focused = readMusicCollabTrack({ focus: true, session: 's-read', trackId: 'piano' })
equal(focused.notes.length, 1, 'read with focus answers for the focused bar')

/* The page's scope survives registration: whole piece keeps its mode; a missing scope means
   one bar (older pages must not suddenly become whole-piece). */
register('s-scope', 'tab-a', { selected: { bars: [1, 8], scope: 'whole', trackId: 'piano' } })
equal(
  readMusicCollabOverview({ session: 's-scope' }).selected,
  { trackId: 'piano', bars: [1, 8], scope: 'whole' },
  'whole-piece scope survives registration',
)
equal(readMusicCollabOverview({ session: 's-read' }).selected.scope, 'bar', 'a registration without scope means one bar')
register('s-scope-unknown', 'tab-a', { selected: { bars: [1, 1], scope: 'everywhere', trackId: 'piano' } })
equal(readMusicCollabOverview({ session: 's-scope-unknown' }).selected.scope, 'bar', 'an unknown scope falls back to one bar')

const drumsDoc = { ...doc, bars: 16 }
const drums = Object.fromEntries(MUSIC_DRUM_IDS.map(lane => [lane, Array.from({ length: 16 }, (_, bar) => (lane === 'kick' && bar === 0 ? { '0': 96 } : {}))]))
rev += 1
upsertMusicCollab({
  doc: drumsDoc,
  rev,
  selected: { bars: [1, 1], trackId: 'drums' },
  session: 's-drums',
  tab: 'tab-a',
  tracks: [{ drums, id: 'drums', instrument: 'drums', kind: 'drums', name: '', noteCount: 1, rev: 'x', volume: 0.9 }],
})
const drumRead = readMusicCollabTrack({ bars: [1, 16], session: 's-drums', trackId: 'drums' })
equal(drumRead.bars, [1, 8], 'a drum read caps the returned range at 8 bars')
equal(drumRead.drums.kick.length, 8, 'drum lanes are sliced to the returned range')
check(drumRead.truncated === true, 'a capped drum read says it is truncated')

/* Apply path: patch -> ack -> applied. */
register('s-edit', 'tab-a')
const edit = applyMusicCollabEdit({ ops: [{ bars: [1, 1], op: 'velocity', factor: 1.0, min: 40 }], session: 's-edit', trackId: 'piano' })
await tick()
const pending = readMusicCollabPatch({ session: 's-edit', tab: 'tab-a' })
check(pending.registered === true && pending.patch !== null, 'the owner polls its patch')
equal(ackMusicCollabPatch({ id: pending.patch.id, result: 'bogus', session: 's-edit' }), { ok: false }, 'an unknown ack result is refused')
equal(ackMusicCollabPatch({ id: pending.patch.id, result: 'applied', session: 's-edit' }), { ok: true }, 'a known ack result lands')
const applied = await edit
equal(applied.result, 'applied', 'the waiting tool learns the patch was applied')

/* A reloaded page (new tab id) still receives the in-flight patch and its ack lands. */
register('s-reload', 'tab-a')
const reloadEdit = applyMusicCollabEdit({ ops: [{ bars: [1, 1], op: 'velocity', factor: 1.0 }], session: 's-reload', trackId: 'piano' })
await tick()
register('s-reload', 'tab-b')
const reloadPending = readMusicCollabPatch({ session: 's-reload', tab: 'tab-b' })
check(reloadPending.patch !== null, 'a reloaded tab still receives the pending patch')
equal(reloadPending.registered, true, 'the reloaded tab owns the session')
ackMusicCollabPatch({ id: reloadPending.patch.id, result: 'applied', session: 's-reload' })
equal((await reloadEdit).result, 'applied', 'the ack after a reload reaches the waiting tool')

/* One session, two tabs: the newest owns it and the older one learns that from its poll. */
register('s-tabs', 'tab-a')
register('s-tabs', 'tab-b')
const loser = readMusicCollabPatch({ session: 's-tabs', tab: 'tab-a' })
check(loser.registered === false && loser.owned === true && loser.superseded === true, 'the superseded tab is told so')
equal(readMusicCollabPatch({ session: 's-tabs', tab: 'tab-b' }).registered, true, 'the newest tab owns the session')

/* Closing the tab settles the waiting tool instead of leaving it to time out. */
register('s-drop', 'tab-a')
const dropped = applyMusicCollabEdit({ ops: [{ bars: [1, 1], op: 'thin', keep: 0.5 }], session: 's-drop', trackId: 'piano' })
await tick()
dropMusicCollab({ session: 's-drop', tab: 'tab-a' })
equal((await dropped).result, 'workshop-closed', 'unregistering settles the waiting tool')

/* Over-long op lists are refused before anything is queued. */
register('s-ops', 'tab-a')
const refused = await applyMusicCollabEdit({ ops: Array.from({ length: MUSIC_EDIT_OPS_MAX + 1 }, () => ({ bars: [1, 1], op: 'thin', keep: 0.5 })), session: 's-ops', trackId: 'piano' })
equal(refused.reason, 'too-many-ops', 'the edit tool refuses too many ops')

/* A late registration of the same tab must not roll the mirror back. */
register('s-stale', 'tab-a')
const fresh = register('s-stale', 'tab-a', { doc: { ...doc, title: 'fresh' } })
const stale = register('s-stale', 'tab-a', { doc: { ...doc, title: 'stale' }, rev: 1 })
check(fresh.ok === true && stale.stale === true, 'an out-of-order registration is ignored')
equal(readMusicCollabOverview({ session: 's-stale' }).doc.title, 'fresh', 'the newer mirror survives')

/* Nothing registered: the poll tells the page to register again. */
equal(readMusicCollabPatch({ session: 's-missing', tab: 'tab-a' }), { patch: null, registered: false, owned: false, superseded: false }, 'a missing registration is reported')

/* Expiry: page traffic refreshes the TTL, a tool read must not. */
register('s-ttl', 'tab-a')
const realNow = Date.now
Date.now = () => realNow() + 31 * 60 * 1000
check(readMusicCollabOverview({ session: 's-ttl' }).result === 'workshop-closed', 'an expired registration is dropped')
Date.now = realNow

if (failures > 0) {
  console.error(`check:music-collab FAILED — ${failures}/${checks} assertions`)
  process.exit(1)
}
console.log(`check:music-collab OK — ${checks} assertions (shared edit rules + host bridge state machine)`)
