/* Pure edit helpers for the music workshop's chat collaboration.
 *
 * The Host (tool validation + the summary the model is told) and the client (applying the
 * patch to the live document) import this same file, so a patch can never mean two things:
 * the ops are deterministic, the rewritten-note rules reject the whole patch rather than
 * "fixing" it, and the summary numbers are recomputed from the actual before/after tracks
 * instead of trusting whatever the model claimed.
 *
 * Pure data only: no fetch, no DOM, no Node APIs, no Math.random (a seeded PRNG keeps a
 * Host preview and the page's apply in agreement).
 */
import {
  MUSIC_DRUM_IDS,
  MUSIC_STEPS_PER_BAR,
  chordPitchClasses,
  makeRandom,
  midiName,
  scalePitchClasses,
} from './music-score.js'

/* Editable forms. Adding one means: an entry here, a branch in applyMusicOps, and a line in
   the tool description — nothing else. */
export const MUSIC_EDIT_OPS = Object.freeze(['thin', 'transpose', 'velocity', 'sustain', 'trim', 'drumVary', 'drumLane'])
/* At most this many ops per call; more than a handful is a sign the model should rewrite
   the notes instead. */
export const MUSIC_EDIT_OPS_MAX = 8
/* A rewrite must stay small enough that a model answer is never truncated: past these limits
   the tool rejects and asks for segments (which the client merges into ONE undo step). */
export const MUSIC_REWRITE_BARS_MAX = 8
export const MUSIC_REWRITE_NOTES_MAX = 512
export const MUSIC_REWRITE_BYTES_MAX = 200 * 1024
const VIOLATION_LIMIT = 12

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

const clampFloat = (value, min, max, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

const noteEnd = note => (note.bar - 1) * MUSIC_STEPS_PER_BAR + note.step + note.len

const inBars = (bar, from, to) => bar >= from && bar <= to

/* FNV-1a over the note's identity: the same note always keeps or drops, so the Host summary
   and the page's apply agree without either side rolling dice. */
function stableRoll(note, salt) {
  const text = `${salt}|${note.bar}|${note.step}|${note.midi}|${note.len}`
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

/* [from, to] inclusive, clamped into the piece; null when not a usable range. */
export function normalizeBarRange(value, docBars) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const from = Math.round(Number(value[0]))
  const to = Math.round(Number(value[1]))
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  if (from < 1 || to < 1 || to < from) return null
  return [clampInt(from, 1, docBars, 1), clampInt(to, 1, docBars, 1)]
}

/* Lane step map: step (0-15) -> velocity (1-127), at most one 16th grid per bar. */
function normalizeSteps(value) {
  if (!isPlainObject(value)) return null
  const steps = {}
  for (const [rawStep, rawVelocity] of Object.entries(value)) {
    const step = Math.round(Number(rawStep))
    const velocity = Math.round(Number(rawVelocity))
    if (!Number.isFinite(step) || step < 0 || step >= MUSIC_STEPS_PER_BAR) continue
    if (!Number.isFinite(velocity) || velocity <= 0) continue
    steps[String(step)] = clampInt(velocity, 1, 127, 96)
  }
  return steps
}

function normalizeOp(value, docBars) {
  if (!isPlainObject(value) || typeof value.op !== 'string') return null
  if (!MUSIC_EDIT_OPS.includes(value.op)) return null
  const bars = normalizeBarRange(value.bars, docBars)
  if (bars === null) return null
  const base = { op: value.op, bars }
  if (value.op === 'thin') return { ...base, keep: clampFloat(value.keep, 0.05, 0.95, 0.6) }
  if (value.op === 'transpose') return { ...base, semitones: clampInt(value.semitones, -24, 24, 12) }
  if (value.op === 'velocity') {
    const low = clampInt(value.min, 1, 127, 1)
    const high = clampInt(value.max, 1, 127, 127)
    /* An inverted range is a typo, not a request to flatten the track: honour both bounds. */
    return { ...base, factor: clampFloat(value.factor, 0.2, 2, 0.9), max: Math.max(low, high), min: Math.min(low, high) }
  }
  if (value.op === 'sustain') return { ...base, factor: clampFloat(value.factor, 0.5, 2, 1.5) }
  if (value.op === 'trim') return base
  if (value.op === 'drumVary') return { ...base, seed: clampInt(value.seed, 1, 0xffffffff, 1) }
  if (typeof value.lane !== 'string' || !MUSIC_DRUM_IDS.includes(value.lane)) return null
  const steps = normalizeSteps(value.steps)
  return steps === null ? null : { ...base, lane: value.lane, steps }
}

/* One drum track's lanes, padded to the piece length so ops can address any bar. */
function cloneDrums(drums, bars) {
  const source = isPlainObject(drums) ? drums : {}
  const next = {}
  for (const lane of MUSIC_DRUM_IDS) {
    next[lane] = Array.from({ length: bars }, (_, index) => {
      const steps = source[lane]?.[index]
      return isPlainObject(steps) ? { ...steps } : {}
    })
  }
  return next
}

/* The bar-level "give me a variation" action, shared with the panel's own Vary button:
   keeps the kick/snare spine, re-rolls the colour lanes, adds a small fill on the last bar.
   `random` is injected so the Host's deterministic preview and the panel's dice can differ
   without forking the algorithm. */
export function varyDrums(drums, bars, barIndex, density = 0.55, random = Math.random) {
  const next = cloneDrums(drums, bars)
  const hatSteps = []
  for (let step = 0; step < MUSIC_STEPS_PER_BAR; step += 1) {
    if (random() < 0.45 + density * 0.35) hatSteps.push(step)
  }
  if (barIndex >= 0 && barIndex < bars) {
    const hat = {}
    for (const step of hatSteps) hat[String(step)] = Math.round(58 + random() * 50)
    next.hat[barIndex] = hat
    for (const lane of ['open', 'clap', 'perc']) {
      const steps = {}
      for (let step = 0; step < MUSIC_STEPS_PER_BAR; step += 1) {
        if (random() < (lane === 'perc' ? 0.16 : 0.08)) steps[String(step)] = Math.round(60 + random() * 50)
      }
      next[lane][barIndex] = steps
    }
    if (barIndex === bars - 1) {
      const snare = { ...next.snare[barIndex] }
      for (const step of [13, 14, 15]) if (random() < 0.75) snare[String(step)] = Math.round(84 + random() * 30)
      next.snare[barIndex] = snare
    }
  }
  return next
}

function applyNoteOps(track, ops, bars) {
  const totalSteps = bars * MUSIC_STEPS_PER_BAR
  let notes = (Array.isArray(track.notes) ? track.notes : []).map(note => ({ ...note }))
  for (const op of ops) {
    const [from, to] = op.bars
    if (op.op === 'thin') {
      notes = notes.filter(note => !inBars(note.bar, from, to) || note.step % 4 === 0 || stableRoll(note, 'thin') < op.keep)
      continue
    }
    if (op.op === 'transpose') {
      notes = notes.map(note => (inBars(note.bar, from, to)
        ? { ...note, midi: clampInt(note.midi + op.semitones, 0, 127, note.midi) }
        : note))
      continue
    }
    if (op.op === 'velocity') {
      notes = notes.map(note => (inBars(note.bar, from, to)
        ? { ...note, vel: clampInt(Math.round(note.vel * op.factor), op.min, op.max, note.vel) }
        : note))
      continue
    }
    if (op.op === 'sustain') {
      notes = notes.map(note => {
        if (!inBars(note.bar, from, to)) return note
        const maxLen = totalSteps - ((note.bar - 1) * MUSIC_STEPS_PER_BAR + note.step)
        return { ...note, len: clampInt(Math.round(note.len * op.factor), 1, Math.max(1, maxLen), note.len) }
      })
      continue
    }
    /* trim: delete anything starting inside the range, and cut notes that merely cross into
       it — a note spanning the whole region becomes its left and right remainders. */
    const startAbs = (from - 1) * MUSIC_STEPS_PER_BAR
    const endAbs = to * MUSIC_STEPS_PER_BAR
    notes = notes.flatMap(note => {
      const start = (note.bar - 1) * MUSIC_STEPS_PER_BAR + note.step
      const end = start + note.len
      if (end <= startAbs || start >= endAbs) return [note]
      if (start < startAbs && end > endAbs) {
        const rightStart = endAbs
        return [
          { ...note, len: startAbs - start },
          { ...note, bar: Math.floor(rightStart / MUSIC_STEPS_PER_BAR) + 1, step: rightStart % MUSIC_STEPS_PER_BAR, len: end - rightStart },
        ]
      }
      if (start < startAbs) return [{ ...note, len: startAbs - start }]
      if (end > endAbs) {
        const rightStart = endAbs
        return [{ ...note, bar: Math.floor(rightStart / MUSIC_STEPS_PER_BAR) + 1, step: rightStart % MUSIC_STEPS_PER_BAR, len: end - rightStart }]
      }
      return []
    })
  }
  notes = notes.filter(note => note.len > 0 && note.bar >= 1 && note.bar <= bars)
  notes.sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi))
  return { ...track, notes }
}

function applyDrumOps(track, ops, bars) {
  let drums = cloneDrums(track.drums, bars)
  for (const op of ops) {
    const [from, to] = op.bars
    if (op.op === 'drumVary') {
      const random = makeRandom(op.seed)
      for (let bar = from; bar <= to; bar += 1) drums = varyDrums(drums, bars, bar - 1, 0.55, random)
      continue
    }
    drums[op.lane] = drums[op.lane].map((steps, index) => (index >= from - 1 && index <= to - 1 ? { ...op.steps } : steps))
  }
  return { ...track, drums }
}

/* Notes whose pitch class left the key, for the bars a transpose touched. Only used to REFUSE
   a transposition: the piece is written in one key, so a mechanical shift that crosses out of
   it would leave the track fighting the chords — the caller tells the model to rewrite the
   bars instead, which the rewrite rules then check chord tone by chord tone. */
function keyViolations(notes, ranges, scale) {
  const violations = []
  for (const note of notes) {
    if (!ranges.some(([from, to]) => inBars(note.bar, from, to))) continue
    if (scale.includes(((note.midi % 12) + 12) % 12)) continue
    violations.push({ bar: note.bar, step: note.step, midi: note.midi, reason: 'transpose-out-of-key', name: midiName(note.midi) })
    if (violations.length >= VIOLATION_LIMIT) break
  }
  return violations
}

/**
 * Apply one patch's ops to a track. Returns `{ track }` with a NEW track (other fields
 * untouched) or `{ error }`; never throws, never mutates the input.
 */
export function applyMusicOps(track, ops, context = {}) {
  if (!isPlainObject(track) || (track.kind !== 'notes' && track.kind !== 'drums')) return { error: 'invalid-track' }
  const docBars = clampInt(context.bars, 1, 512, 1)
  /* Reject an over-long list instead of silently applying a prefix: a model that sent nine
     ops must learn that two were dropped, not get a summary that quietly hides it. */
  if (Array.isArray(ops) && ops.length > MUSIC_EDIT_OPS_MAX) return { error: 'too-many-ops' }
  const list = Array.isArray(ops) ? ops : []
  const normalized = []
  for (const raw of list) {
    const op = normalizeOp(raw, docBars)
    if (op === null) return { error: 'invalid-op' }
    normalized.push(op)
  }
  if (normalized.length === 0) return { error: 'no-op' }
  if (track.kind === 'drums') {
    if (normalized.some(op => op.op !== 'drumVary' && op.op !== 'drumLane')) return { error: 'op-not-applicable' }
    return { track: applyDrumOps(track, normalized, docBars) }
  }
  if (normalized.some(op => op.op === 'drumVary' || op.op === 'drumLane')) return { error: 'op-not-applicable' }
  const applied = applyNoteOps(track, normalized, docBars)
  /* The key fence is deliberately only about the transposed bars: a track that already uses
     chromatic colour there cannot have the shift attributed to it, so it is left alone. */
  const transposeRanges = normalized.filter(op => op.op === 'transpose').map(op => op.bars)
  if (transposeRanges.length > 0 && typeof context.keyRoot === 'string') {
    const scale = scalePitchClasses(context.keyRoot, context.keyMode)
    const source = Array.isArray(track.notes) ? track.notes : []
    if (scale.length > 0 && keyViolations(source, transposeRanges, scale).length === 0) {
      const violations = keyViolations(applied.notes, transposeRanges, scale)
      if (violations.length > 0) return { error: 'transpose-out-of-key', violations }
    }
  }
  return { track: applied }
}

/* Chord label of one bar, the same lookup the composer uses. */
function chordOf(doc, bar) {
  const progression = Array.isArray(doc.chordProgression) ? doc.chordProgression : []
  return progression[bar - 1]
}

/**
 * Validate a rewritten note list for one bar range against the piece's key and each bar's
 * chord. Rejecting is deliberate: a patch the model got wrong must not reach the document,
 * and "repairing" it would silently change what the user asked for.
 */
export function validateRewrittenNotes(input) {
  const doc = isPlainObject(input?.doc) ? input.doc : {}
  const docBars = clampInt(doc.bars, 1, 512, 1)
  const bars = normalizeBarRange(input?.bars, docBars)
  if (bars === null) return { ok: false, bars: null, violations: [{ reason: 'bad-range' }], notes: null }
  const [from, to] = bars
  if (to - from + 1 > MUSIC_REWRITE_BARS_MAX) return { ok: false, bars, violations: [{ reason: 'range-too-long' }], notes: null }
  const source = Array.isArray(input?.notes) ? input.notes : null
  /* "notes missing" and "notes: []" are different requests: the first is a malformed patch,
     the second clears the range (the only way to empty bars without `trim`). */
  if (source === null) return { ok: false, bars, violations: [{ reason: 'no-notes' }], notes: null }
  if (source.length > MUSIC_REWRITE_NOTES_MAX) return { ok: false, bars, violations: [{ reason: 'too-many-notes' }], notes: null }
  if (JSON.stringify(source).length > MUSIC_REWRITE_BYTES_MAX) return { ok: false, bars, violations: [{ reason: 'too-large' }], notes: null }
  if (source.length === 0) return { ok: true, bars, violations: [], notes: [] }
  const scale = scalePitchClasses(doc.keyRoot, doc.keyMode)
  const totalSteps = docBars * MUSIC_STEPS_PER_BAR
  const violations = []
  const notes = []
  const occupied = new Map()
  for (const raw of source) {
    const midi = Math.round(Number(raw?.midi))
    const bar = Math.round(Number(raw?.bar))
    const step = Math.round(Number(raw?.step))
    const len = Math.round(Number(raw?.len))
    const vel = Math.round(Number(raw?.vel))
    if (![midi, bar, step, len, vel].every(Number.isFinite)) {
      violations.push({ reason: 'not-a-number' })
      continue
    }
    if (bar < from || bar > to) {
      violations.push({ bar, step, midi, reason: 'out-of-range' })
      continue
    }
    if (step < 0 || step >= MUSIC_STEPS_PER_BAR || midi < 0 || midi > 127 || vel < 1 || vel > 127) {
      violations.push({ bar, step, midi, reason: 'out-of-bounds' })
      continue
    }
    const start = (bar - 1) * MUSIC_STEPS_PER_BAR + step
    if (len < 1 || start + len > totalSteps) {
      violations.push({ bar, step, midi, reason: 'bad-length' })
      continue
    }
    if (scale.length > 0 && !scale.includes(((midi % 12) + 12) % 12)) {
      violations.push({ bar, step, midi, reason: 'not-in-key' })
      continue
    }
    if (step % 4 === 0 && scale.length > 0) {
      const tones = chordPitchClasses(chordOf(doc, bar))
      if (tones.length > 0 && !tones.includes(((midi % 12) + 12) % 12)) {
        violations.push({ bar, step, midi, reason: 'not-chord-tone' })
        continue
      }
    }
    const taken = occupied.get(midi) ?? []
    if (taken.some(interval => start < interval[1] && interval[0] < start + len)) {
      violations.push({ bar, step, midi, reason: 'overlap' })
      continue
    }
    taken.push([start, start + len])
    occupied.set(midi, taken)
    notes.push({ bar, step, midi, len, vel })
  }
  if (violations.length > 0) {
    return { ok: false, bars, violations: violations.slice(0, VIOLATION_LIMIT).map(entry => (entry.midi === undefined ? entry : { ...entry, name: midiName(entry.midi) })), notes: null }
  }
  notes.sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi))
  return { ok: true, bars, violations: [], notes }
}

/* Notes per bar, cheap enough to send for every track in the collaboration registration. */
export function musicBarHistogram(track, bars) {
  const length = clampInt(bars, 1, 512, 1)
  const histogram = Array.from({ length }, () => 0)
  const notes = Array.isArray(track?.notes) ? track.notes : []
  for (const note of notes) {
    const index = Math.round(Number(note?.bar)) - 1
    if (index >= 0 && index < length) histogram[index] += 1
  }
  if (track?.kind === 'drums') {
    for (let index = 0; index < length; index += 1) {
      histogram[index] = 0
      for (const lane of MUSIC_DRUM_IDS) histogram[index] += Object.keys(track.drums?.[lane]?.[index] ?? {}).length
    }
  }
  return histogram
}

/* Content fingerprint of one track: the client sends it with every registration, the patch
   carries the value the tool saw, and a mismatch means a hand edit raced the tool. */
export function musicTrackFingerprint(track) {
  const text = `${track?.kind ?? ''}|${track?.instrument ?? ''}|${JSON.stringify(track?.kind === 'drums' ? track?.drums ?? {} : track?.notes ?? [])}`
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const average = values => (values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100)

/* Share of strong-beat notes that sit on the bar's chord; null when the piece has no
   progression to check against. */
export function musicChordFit(track, doc) {
  const progression = Array.isArray(doc?.chordProgression) ? doc.chordProgression : []
  const notes = Array.isArray(track?.notes) ? track.notes : []
  let strong = 0
  let fit = 0
  for (const note of notes) {
    if (note.step % 4 !== 0) continue
    const tones = chordPitchClasses(progression[note.bar - 1])
    if (tones.length === 0) continue
    strong += 1
    if (tones.includes(((note.midi % 12) + 12) % 12)) fit += 1
  }
  return strong === 0 ? null : Math.round((fit / strong) * 100) / 100
}

/**
 * Numbers shown in the status bar and returned to the model: always computed from the real
 * before/after tracks, never from the model's own claim.
 */
export function musicEditSummary(before, after, doc) {
  const beforeNotes = Array.isArray(before?.notes) ? before.notes : []
  const afterNotes = Array.isArray(after?.notes) ? after.notes : []
  const bars = Math.max(
    ...beforeNotes.map(note => note.bar),
    ...afterNotes.map(note => note.bar),
    1,
  )
  const perBar = []
  for (let bar = 1; bar <= Math.min(bars, 64); bar += 1) {
    const countBefore = beforeNotes.filter(note => note.bar === bar).length
    const countAfter = afterNotes.filter(note => note.bar === bar).length
    perBar.push({ bar, before: countBefore, after: countAfter })
  }
  return {
    notesBefore: beforeNotes.length,
    notesAfter: afterNotes.length,
    velocityBefore: average(beforeNotes.map(note => note.vel)),
    velocityAfter: average(afterNotes.map(note => note.vel)),
    perBar: perBar.filter(entry => entry.before !== entry.after),
    chordFit: musicChordFit(after, doc),
  }
}
