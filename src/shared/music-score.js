/* Music-workshop score model shared by the Host and the client bundle.
 *
 * Pure data only: no fetch, no DOM, no Node APIs. The Host validates what it stores and builds a
 * deterministic fallback score when no model is configured; the client uses the same normalisation
 * for its in-memory document, so a saved file, an AI answer and a template never drift into three
 * different shapes.
 *
 * v3: a score is an arbitrary list of VCSL sample-instrument tracks (GarageBand-style), each either
 * a melodic track with notes or the drum kit with a per-bar step pattern. v1/v2 documents are
 * rejected: their ids describe the removed oscillator palette.
 */
export const MUSIC_DOC_KIND = 'workspace-studio.music'
export const MUSIC_DOC_VERSION = 3
export const MUSIC_DEFAULT_DIR = 'music'
export const MUSIC_FILE_SUFFIX = '.music.json'
export const MUSIC_DOC_MAX_BYTES = 768 * 1024
export const MUSIC_DRUM_IDS = Object.freeze(['kick', 'snare', 'hat', 'open', 'clap', 'perc'])
/* AI-compose style palette. The id is stable (it is stored in `prompt.style`, sent to the model
   and used as a CSS/data key); the colour is the client's dot/choice accent, the localized label
   and description live in the locale files. Adding a style means one entry here plus its chord
   cell, drum cell and tempo/tone defaults below. */
export const MUSIC_STYLES = Object.freeze({
  lofi: Object.freeze({ color: '#6aa8ff' }),
  electronic: Object.freeze({ color: '#b69cff' }),
  pop: Object.freeze({ color: '#4fd18b' }),
  hiphop: Object.freeze({ color: '#e4a33a' }),
  chinese: Object.freeze({ color: '#ef7676' }),
  cinematic: Object.freeze({ color: '#86c8ff' }),
  jazz: Object.freeze({ color: '#c4a5ff' }),
  rock: Object.freeze({ color: '#f07a5a' }),
  classical: Object.freeze({ color: '#d9c27a' }),
  ambient: Object.freeze({ color: '#8ed6e6' }),
  folk: Object.freeze({ color: '#b7d48a' }),
  funk: Object.freeze({ color: '#d8c14a' }),
})
export const MUSIC_STYLE_IDS = Object.freeze(Object.keys(MUSIC_STYLES))
/* AI-compose mood palette. A mood is not decoration: the deterministic template scales note
   velocity, register and sustain from it (MOOD_PROFILES), and the AI path passes it to the model. */
export const MUSIC_MOODS = Object.freeze({
  lazy: Object.freeze({ color: '#4fd18b' }),
  warm: Object.freeze({ color: '#e4a33a' }),
  bright: Object.freeze({ color: '#6aa8ff' }),
  tense: Object.freeze({ color: '#ef7676' }),
  dreamy: Object.freeze({ color: '#a78bfa' }),
  melancholy: Object.freeze({ color: '#7f9cc9' }),
  epic: Object.freeze({ color: '#d98a3a' }),
  playful: Object.freeze({ color: '#4fd1c5' }),
  calm: Object.freeze({ color: '#9ec9e8' }),
  dark: Object.freeze({ color: '#8b8fa8' }),
})
export const MUSIC_MOOD_IDS = Object.freeze(Object.keys(MUSIC_MOODS))
export const MUSIC_KEY_ROOTS = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])
export const MUSIC_BARS_MIN = 4
export const MUSIC_BARS_MAX = 64
export const MUSIC_BPM_MIN = 40
export const MUSIC_BPM_MAX = 200
/* The duration picker works in seconds; the score grid stays bar-based. */
export const MUSIC_DURATION_MIN_SECONDS = 10
export const MUSIC_DURATION_MAX_SECONDS = 60
/* One model call stays reliable up to 16 bars; longer pieces are composed in segments. */
export const MUSIC_AI_SINGLE_BARS = 16
export const MUSIC_AI_SEGMENT_MAX = 4
export const MUSIC_TRACK_MAX = 24
export const MUSIC_TRACK_NOTE_MAX = 4096
export const MUSIC_NOTE_COUNT_MAX = 16384
/* 16 sixteenth-steps per bar is the editor grid; bars are 4/4 only in this version. */
export const MUSIC_STEPS_PER_BAR = 16
export const MUSIC_DRUM_NAMES = Object.freeze({ kick: '底鼓', snare: '军鼓', hat: '闭镲', open: '开镲', clap: '拍手', perc: '打击乐' })
export const MUSIC_SECTION_NAMES = Object.freeze(['前奏', '主歌', '副歌', '尾声'])
const MUSIC_LOOP_SECTION_NAMES = Object.freeze(['前奏', '主歌', '副歌', '循环'])

/* The instrument palette. `kind` decides which editor a track opens; the palette itself
   (localized names, category, icon) lives in the client, this is the Host-safe core. */
/* Twelve VCSL-backed instruments. There is deliberately no oscillator fallback: every
   track is one of these sample instruments (the drum kit is one entry with six lanes). */
export const MUSIC_INSTRUMENTS = Object.freeze({
  piano: Object.freeze({ kind: 'notes', color: '#8fb8ff' }),
  epiano: Object.freeze({ kind: 'notes', color: '#a78bfa' }),
  organ: Object.freeze({ kind: 'notes', color: '#4fd1c5' }),
  harpsichord: Object.freeze({ kind: 'notes', color: '#f0b85a' }),
  harp: Object.freeze({ kind: 'notes', color: '#c4a5ff' }),
  strumstick: Object.freeze({ kind: 'notes', color: '#f7ad31' }),
  psaltery: Object.freeze({ kind: 'notes', color: '#86c8ff' }),
  sax: Object.freeze({ kind: 'notes', color: '#ef9f76' }),
  recorder: Object.freeze({ kind: 'notes', color: '#6fe0c8' }),
  glockenspiel: Object.freeze({ kind: 'notes', color: '#b69cff' }),
  timpani: Object.freeze({ kind: 'notes', color: '#d6a84a' }),
  drums: Object.freeze({ kind: 'drums', color: '#f7ad31' }),
})
export const MUSIC_INSTRUMENT_IDS = Object.freeze(Object.keys(MUSIC_INSTRUMENTS))
/* A small, playable default band; the popover can add any of the twelve. */
export const MUSIC_DEFAULT_INSTRUMENTS = Object.freeze(['piano', 'organ', 'harp', 'recorder', 'drums'])

/** Deduplicate/validate a requested instrumentation in palette order; empty/invalid -> default. */
export function normalizeMusicInstruments(value) {
  if (!Array.isArray(value)) return [...MUSIC_DEFAULT_INSTRUMENTS]
  const wanted = new Set(value.filter(id => typeof id === 'string'))
  const result = MUSIC_INSTRUMENT_IDS.filter(id => wanted.has(id))
  return result.length === 0 ? [...MUSIC_DEFAULT_INSTRUMENTS] : result
}

/** Seamless-loop intent. Old scores had no field and played looped, so absent means on. */
export function normalizeMusicSeamless(value) {
  return value === false ? false : true
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
const PENTATONIC = [0, 2, 4, 7, 9]
/* Chord qualities the progression table uses, expressed as semitone offsets from the root. */
const CHORD_SHAPES = Object.freeze({
  maj7: [0, 4, 7, 11],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  m: [0, 3, 7],
  maj: [0, 4, 7],
  sus4: [0, 5, 7],
})


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function clampFloat(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function cleanText(value, max, fallback) {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  if (text === '') return fallback
  return text.slice(0, max)
}

function cleanId(value, fallback) {
  if (typeof value !== 'string') return fallback
  const id = value.trim().slice(0, 40)
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : fallback
}

export function midiName(midi) {
  const value = clampInt(midi, 0, 127, 60)
  return `${NOTE_NAMES[value % 12]}${Math.floor(value / 12) - 1}`
}

/* Root note name of a chord label such as "Cmaj7" / "F#m7" / "Bb7". */
export function chordRootName(label) {
  if (typeof label !== 'string') return 'C'
  const match = /^([A-G][#b]?)/.exec(label)
  if (match === null) return 'C'
  return match[1].replace('b', '#').replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#')
}

function rootMidiOf(name, octave) {
  const root = MUSIC_KEY_ROOTS.indexOf(String(name).replace('b', '#').replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#'))
  const safeRoot = root < 0 ? 0 : root
  return 12 * (octave + 1) + safeRoot
}

/* Mulberry32: a tiny deterministic PRNG so one seed always rebuilds the same sketch
   (no Math.random in the shared module, which the client would otherwise make
   non-reproducible between a fallback preview and a Host-side fallback). */
function makeRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normalizeNote(value) {
  if (!isPlainObject(value)) return null
  const bar = clampInt(value.bar, 1, MUSIC_BARS_MAX, 1)
  const step = clampInt(value.step, 0, MUSIC_STEPS_PER_BAR - 1, 0)
  const midi = clampInt(value.midi, 12, 108, 60)
  const len = clampInt(value.len, 1, MUSIC_BARS_MAX * MUSIC_STEPS_PER_BAR, 1)
  const vel = clampInt(value.vel, 1, 127, 96)
  return { bar, step, midi, len, vel }
}

function normalizeNotes(value, limit = MUSIC_TRACK_NOTE_MAX) {
  const input = Array.isArray(value) ? value : []
  const notes = []
  for (const entry of input) {
    const note = normalizeNote(entry)
    if (note === null) continue
    notes.push(note)
    if (notes.length >= limit) break
  }
  notes.sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi))
  return notes
}

function normalizeDrumLane(value, bars) {
  const input = Array.isArray(value) ? value : []
  const output = []
  for (let bar = 0; bar < bars; bar += 1) {
    const source = isPlainObject(input[bar]) ? input[bar] : {}
    const steps = {}
    for (const [rawStep, rawVelocity] of Object.entries(source)) {
      const step = Number(rawStep)
      if (!Number.isSafeInteger(step) || step < 0 || step >= MUSIC_STEPS_PER_BAR) continue
      const velocity = Number(rawVelocity)
      if (!Number.isFinite(velocity) || velocity <= 0) continue
      steps[String(step)] = clampInt(velocity, 1, 127, 96)
    }
    output.push(steps)
  }
  return output
}

function normalizeDrums(value, bars) {
  const source = isPlainObject(value) ? value : {}
  const drums = {}
  for (const id of MUSIC_DRUM_IDS) drums[id] = normalizeDrumLane(source[id], bars)
  return drums
}

/** Number of drum hits in a drum track's pattern. */
export function musicDrumHitCount(drums) {
  if (!isPlainObject(drums)) return 0
  let total = 0
  for (const lane of MUSIC_DRUM_IDS) {
    const bars = Array.isArray(drums[lane]) ? drums[lane] : []
    for (const steps of bars) {
      if (isPlainObject(steps)) total += Object.keys(steps).length
    }
  }
  return total
}

/** Total playable events (melodic notes + drum hits) in a score. */
export function musicNoteCount(doc) {
  const tracks = Array.isArray(doc?.tracks) ? doc.tracks : []
  let total = 0
  for (const track of tracks) {
    total += track.kind === 'drums' ? musicDrumHitCount(track.drums) : (Array.isArray(track.notes) ? track.notes.length : 0)
  }
  return total
}

function normalizeTrack(source, index, bars, usedIds) {
  const value = isPlainObject(source) ? source : {}
  const requested = typeof value.instrument === 'string' && MUSIC_INSTRUMENT_IDS.includes(value.instrument)
    ? value.instrument
    : null
  /* A model may omit the instrument; a missing/unknown one is a piano, never an old synth id. */
  const instrument = requested ?? (value.kind === 'drums' || value.id === 'drums' ? 'drums' : 'piano')
  const kind = MUSIC_INSTRUMENTS[instrument].kind
  let id = cleanId(value.id, `track-${index + 1}`)
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${cleanId(value.id, `track-${index + 1}`)}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  const track = {
    id,
    name: cleanText(value.name, 40, ''),
    instrument,
    kind,
    volume: clampFloat(value.volume, 0, 1, kind === 'drums' ? 0.9 : 0.8),
    muted: value.muted === true,
    solo: value.solo === true,
  }
  if (kind === 'drums') track.drums = normalizeDrums(value.drums, bars)
  else track.notes = normalizeNotes(value.notes).filter(note => note.bar <= bars)
  return track
}

/* A v3 track list, or an object map a model may return instead of an array. */
function normalizeTrackList(value, bars) {
  const list = Array.isArray(value)
    ? value
    : (isPlainObject(value) ? Object.entries(value).map(([id, track]) => (isPlainObject(track) ? { id, ...track } : null)) : [])
  const tracks = []
  const usedIds = new Set()
  let total = 0
  for (let index = 0; index < list.length; index += 1) {
    if (tracks.length >= MUSIC_TRACK_MAX) break
    const source = list[index]
    if (!isPlainObject(source)) continue
    const track = normalizeTrack(source, index, bars, usedIds)
    if (track.kind === 'notes') {
      track.notes = track.notes.slice(0, Math.max(0, MUSIC_NOTE_COUNT_MAX - total))
      total += track.notes.length
    }
    tracks.push(track)
  }
  return tracks
}

function normalizeSections(value, bars, seamless = false) {
  const input = Array.isArray(value) ? value : []
  const sections = []
  for (const entry of input) {
    if (!isPlainObject(entry)) continue
    const from = clampInt(entry.from, 1, bars, 1)
    const to = clampInt(entry.to, from, bars, bars)
    sections.push({ name: cleanText(entry.name, 20, '段落'), from, to })
    if (sections.length >= 12) break
  }
  if (sections.length > 0) return sections
  return defaultSections(bars, seamless)
}

function normalizeProgression(value, bars) {
  const input = Array.isArray(value) ? value : []
  const labels = []
  for (let bar = 0; bar < bars; bar += 1) {
    const candidate = input[bar]
    labels.push(cleanText(candidate, 16, 'Cmaj7'))
  }
  return labels
}

function defaultSections(bars, seamless = false) {
  const quarter = Math.max(1, Math.round(bars / 4))
  const names = seamless ? MUSIC_LOOP_SECTION_NAMES : MUSIC_SECTION_NAMES
  const sections = []
  let cursor = 1
  for (let index = 0; index < names.length && cursor <= bars; index += 1) {
    const to = index === names.length - 1 ? bars : Math.min(bars, cursor + quarter - 1)
    sections.push({ name: names[index], from: cursor, to })
    cursor = to + 1
  }
  return sections
}

/** Default title for a new, unsaved piece. */
export function defaultMusicTitle(now) {
  const stamp = new Date(Number.isFinite(now) ? now : Date.now())
  const pad = value => String(value).padStart(2, '0')
  return `未命名作品 ${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}-${pad(stamp.getMinutes())}`
}

/** A blank score with a playable starting point is built by composeMusicScore, not here. */
export function createMusicDoc(overrides = {}) {
  const bars = clampInt(overrides.bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
  const now = Number.isFinite(overrides.now) ? overrides.now : Date.now()
  return normalizeMusicDoc({
    kind: MUSIC_DOC_KIND,
    version: MUSIC_DOC_VERSION,
    title: overrides.title,
    createdAt: now,
    updatedAt: now,
    bpm: overrides.bpm,
    keyRoot: overrides.keyRoot,
    keyMode: overrides.keyMode,
    bars,
    swing: overrides.swing,
    humanize: overrides.humanize,
    prompt: overrides.prompt,
    tracks: overrides.tracks ?? [],
    drums: overrides.drums,
    chordProgression: overrides.chordProgression,
    sections: overrides.sections,
  })
}

/**
 * Validate and clamp any score-shaped value (a saved file, an LLM answer, in-memory state).
 * Never throws: an unusable value returns null and the caller decides the fallback.
 */
export function normalizeMusicDoc(value) {
  if (!isPlainObject(value)) return null
  /* v1/v2 scores and their synthesized instruments are intentionally not migrated: the
     sample palette is a new document version whose instrument ids do not exist in them. */
  if (value.version !== MUSIC_DOC_VERSION) return null
  const hasScore = Array.isArray(value.tracks) || isPlainObject(value.tracks)
  if (!hasScore) return null
  const bars = clampInt(value.bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
  const prompt = isPlainObject(value.prompt) ? value.prompt : {}
  const seamless = normalizeMusicSeamless(prompt.seamless)
  const now = Date.now()
  const doc = {
    kind: MUSIC_DOC_KIND,
    version: MUSIC_DOC_VERSION,
    title: cleanText(value.title, 120, '未命名作品'),
    createdAt: clampInt(value.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: clampInt(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
    bpm: clampInt(value.bpm, MUSIC_BPM_MIN, MUSIC_BPM_MAX, 96),
    keyRoot: MUSIC_KEY_ROOTS.includes(value.keyRoot) ? value.keyRoot : 'C',
    keyMode: value.keyMode === 'minor' ? 'minor' : 'major',
    bars,
    swing: clampFloat(value.swing, 0, 0.75, 0),
    humanize: clampFloat(value.humanize, 0, 0.5, 0),
    prompt: {
      text: cleanText(prompt.text, 2000, ''),
      style: MUSIC_STYLE_IDS.includes(prompt.style) ? prompt.style : 'lofi',
      mood: MUSIC_MOOD_IDS.includes(prompt.mood) ? prompt.mood : 'lazy',
      density: clampFloat(prompt.density, 0, 1, 0.5),
      complexity: clampFloat(prompt.complexity, 0, 1, 0.5),
      instruments: normalizeMusicInstruments(prompt.instruments),
      seamless,
    },
    tracks: normalizeTrackList(value.tracks, bars),
    chordProgression: normalizeProgression(value.chordProgression, bars),
    sections: normalizeSections(value.sections, bars, seamless),
  }
  /* A loaded or generated score can carry notes past its own last bar (a shrunk bar count, a
     model that overshot): they would render outside the grid and never be scheduled. */
  doc.tracks = doc.tracks.map(track => (track.kind === 'drums'
    ? { ...track, drums: normalizeDrums(track.drums, bars) }
    : {
        ...track,
        notes: track.notes
          .filter(note => note.bar <= bars)
          .map(note => ({ ...note, len: Math.min(note.len, (bars - note.bar + 1) * MUSIC_STEPS_PER_BAR - note.step) })),
      }))
  return doc
}

/* ── deterministic fallback composer ───────────────────────────────────────── */

const PROGRESSIONS = Object.freeze({
  lofi: [['maj7', 0], ['m7', 9], ['m7', 2], ['7', 7]],
  electronic: [['m', 9], ['maj7', 5], ['maj', 0], ['maj', 7]],
  pop: [['maj', 0], ['maj', 7], ['m', 9], ['maj', 5]],
  hiphop: [['m7', 9], ['m7', 2], ['maj7', 5], ['7', 7]],
  chinese: [['m', 2], ['m', 9], ['maj', 10], ['maj', 0]],
  cinematic: [['m', 0], ['maj7', 8], ['maj', 3], ['maj', 10]],
  /* ii-V-I with a vi answer: the seventh-heavy cell that makes jazz read as jazz. */
  jazz: [['m7', 2], ['7', 7], ['maj7', 0], ['m7', 9]],
  /* I-bVII-IV-I: the modal rock cadence that never lands on a leading tone. */
  rock: [['maj', 0], ['maj', 10], ['maj', 5], ['maj', 0]],
  /* I-IV-vi-V, all triads: functional harmony without added sevenths. */
  classical: [['maj', 0], ['maj', 5], ['m', 9], ['7', 7]],
  /* One colour held for four bars; movement comes from register, not chord changes. */
  ambient: [['maj7', 0], ['maj7', 5], ['maj7', 9], ['maj7', 2]],
  /* I-vi-IV-V turnaround, the acoustic singer-songwriter loop. */
  folk: [['maj', 0], ['m', 9], ['maj', 5], ['maj', 7]],
  /* Dm7 vamp answered by G7: a static groove that lets the syncopation carry the bar. */
  funk: [['m7', 2], ['m7', 2], ['7', 7], ['m7', 2]],
})

/* Tempo/tonality each style defaults to when the request leaves them open. */
const STYLE_DEFAULTS = Object.freeze({
  lofi: Object.freeze({ bpm: 92, mode: 'major' }),
  electronic: Object.freeze({ bpm: 118, mode: 'minor' }),
  pop: Object.freeze({ bpm: 112, mode: 'major' }),
  hiphop: Object.freeze({ bpm: 88, mode: 'minor' }),
  chinese: Object.freeze({ bpm: 84, mode: 'major' }),
  cinematic: Object.freeze({ bpm: 96, mode: 'minor' }),
  jazz: Object.freeze({ bpm: 96, mode: 'major' }),
  rock: Object.freeze({ bpm: 126, mode: 'major' }),
  classical: Object.freeze({ bpm: 84, mode: 'major' }),
  ambient: Object.freeze({ bpm: 70, mode: 'major' }),
  folk: Object.freeze({ bpm: 100, mode: 'major' }),
  funk: Object.freeze({ bpm: 112, mode: 'minor' }),
})

/* What a mood does to the deterministic template. `velocity` scales every generated note and
   drum hit, `register` transposes the melody line, `sustain` lengthens melodic/bass notes (which
   also thins the phrase, because each note consumes more of its bar). The AI path gets the mood
   id in its prompt; both engines therefore honour the same choice. */
const MOOD_PROFILES = Object.freeze({
  lazy: Object.freeze({ register: 0, sustain: 1.2, velocity: 0.88 }),
  warm: Object.freeze({ register: 0, sustain: 1.15, velocity: 0.94 }),
  bright: Object.freeze({ register: 12, sustain: 0.85, velocity: 1.06 }),
  tense: Object.freeze({ register: 0, sustain: 0.6, velocity: 1.12 }),
  dreamy: Object.freeze({ register: 12, sustain: 1.55, velocity: 0.8 }),
  melancholy: Object.freeze({ register: -12, sustain: 1.4, velocity: 0.84 }),
  epic: Object.freeze({ register: 0, sustain: 1.25, velocity: 1.18 }),
  playful: Object.freeze({ register: 12, sustain: 0.7, velocity: 1.08 }),
  calm: Object.freeze({ register: 0, sustain: 1.5, velocity: 0.78 }),
  dark: Object.freeze({ register: -12, sustain: 1.2, velocity: 0.88 }),
})

const DRUM_PATTERNS = Object.freeze({
  lofi: {
    kick: ['0', '6', '10'],
    snare: ['4', '12'],
    hat: ['0', '2', '4', '6', '8', '10', '12', '14'],
    open: ['14'],
    clap: ['12'],
    perc: ['3', '7', '11'],
  },
  hiphop: {
    kick: ['0', '7', '10'],
    snare: ['4', '12'],
    hat: ['0', '2', '4', '6', '8', '10', '12', '14'],
    open: ['15'],
    clap: ['12'],
    perc: ['3', '11', '14'],
  },
  electronic: {
    kick: ['0', '4', '8', '12'],
    snare: ['4', '12'],
    hat: ['2', '6', '10', '14'],
    open: ['2', '6', '10', '14'],
    clap: ['4', '12'],
    perc: ['7', '15'],
  },
  pop: {
    kick: ['0', '8'],
    snare: ['4', '12'],
    hat: ['0', '2', '4', '6', '8', '10', '12', '14'],
    open: ['14'],
    clap: ['4', '12'],
    perc: ['6', '14'],
  },
  chinese: {
    kick: ['0', '8'],
    snare: ['4', '12'],
    hat: ['0', '4', '8', '12'],
    open: ['6'],
    clap: ['12'],
    perc: ['3', '7', '11', '15'],
  },
  cinematic: {
    kick: ['0', '10'],
    snare: ['12'],
    hat: ['8'],
    open: ['14'],
    clap: ['12'],
    perc: ['2', '6', '10'],
  },
  jazz: {
    kick: ['0', '8'],
    snare: ['4', '12'],
    hat: ['0', '2', '4', '6', '8', '10', '12', '14'],
    open: [],
    clap: [],
    perc: ['3', '11'],
  },
  rock: {
    kick: ['0', '6', '8'],
    snare: ['4', '12'],
    hat: ['0', '4', '8', '12'],
    open: ['14'],
    clap: ['4', '12'],
    perc: ['7', '15'],
  },
  classical: {
    kick: ['0'],
    snare: [],
    hat: [],
    open: [],
    clap: [],
    perc: ['8', '12'],
  },
  ambient: {
    kick: ['0'],
    snare: [],
    hat: ['4', '12'],
    open: [],
    clap: [],
    perc: ['8'],
  },
  folk: {
    kick: ['0', '8'],
    snare: ['4', '12'],
    hat: ['0', '4', '8', '12'],
    open: [],
    clap: [],
    perc: ['6', '14'],
  },
  funk: {
    kick: ['0', '3', '8', '10'],
    snare: ['4', '12'],
    hat: ['0', '2', '4', '6', '8', '10', '12', '14'],
    open: ['14'],
    clap: ['4', '12'],
    perc: ['7', '11', '15'],
  },
})

function chordLabel(shape, rootIndex) {
  const root = MUSIC_KEY_ROOTS[rootIndex]
  return `${root}${shape === 'maj' || shape === 'm' ? '' : shape}`
}

/**
 * Shared harmony and framing plan for one score. The AI path uses it to keep independently
 * generated segments in the same key/progression, and the template path uses it so both
 * engines produce the same section map.
 */
export function buildMusicPlan(options = {}) {
  const style = MUSIC_STYLE_IDS.includes(options.style) ? options.style : 'lofi'
  const bars = clampInt(options.bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
  const seamless = normalizeMusicSeamless(options.seamless)
  const defaults = STYLE_DEFAULTS[style] ?? STYLE_DEFAULTS.lofi
  const bpm = clampInt(options.bpm, MUSIC_BPM_MIN, MUSIC_BPM_MAX, defaults.bpm)
  const keyMode = options.keyMode === 'major' || options.keyMode === 'minor' ? options.keyMode : defaults.mode
  const keyRoot = MUSIC_KEY_ROOTS.includes(options.keyRoot)
    ? options.keyRoot
    : (style === 'chinese' ? 'D' : keyMode === 'minor' ? 'A' : 'C')

  /* A four-bar harmonic cell, looped over the requested length, transposed into the
     requested key by shifting the degree table rather than by spelling 12 keys. */
  const cell = PROGRESSIONS[style]
  const rootIndex = MUSIC_KEY_ROOTS.indexOf(keyRoot)
  const generated = []
  for (let bar = 0; bar < bars; bar += 1) {
    const [shape, degree] = cell[bar % cell.length]
    generated.push(chordLabel(shape, (rootIndex + degree) % 12))
  }
  const supplied = Array.isArray(options.chordProgression) ? options.chordProgression : []
  const progression = generated.map((label, index) => cleanText(supplied[index], 16, label))
  const sections = Array.isArray(options.sections) && options.sections.length > 0
    ? normalizeSections(options.sections, bars, seamless)
    : defaultSections(bars, seamless)
  return { bars, bpm, keyMode, keyRoot, progression, sections, seamless, style }
}

/**
 * Build a complete, playable score without any model. Used as the offline fallback and
 * as the "no model configured" path, so the workshop always produces something.
 * Its material is played by the bundled VCSL sampler, not by oscillators.
 */
export function composeMusicScore(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const plan = buildMusicPlan(options)
  const { bars, bpm, keyMode, keyRoot, progression, sections, seamless, style } = plan
  const mood = MUSIC_MOOD_IDS.includes(options.mood) ? options.mood : 'lazy'
  const moodProfile = MOOD_PROFILES[mood] ?? MOOD_PROFILES.lazy
  const density = clampFloat(options.density, 0, 1, 0.55)
  const complexity = clampFloat(options.complexity, 0, 1, 0.5)
  const swing = clampFloat(options.swing, 0, 0.75, style === 'lofi' || style === 'hiphop' ? 0.32 : 0.08)
  const humanize = clampFloat(options.humanize, 0, 0.5, 0.08)
  const random = makeRandom(options.seed === undefined ? now : options.seed)
  const instruments = normalizeMusicInstruments(options.instruments)
  /* Mood shapes the material: every velocity passes through the profile, melodic lengths stretch
     (which also thins the phrase) and the melody line sits in the mood's register. */
  const shapedVelocity = value => clampInt(Math.round(value * moodProfile.velocity), 16, 124, value)
  const shapedLength = (length, min = 1) => Math.max(min, Math.min(16, Math.round(length * moodProfile.sustain)))

  const melodyScale = style === 'chinese' ? PENTATONIC : (keyMode === 'minor' ? MINOR_SCALE : MAJOR_SCALE)
  const tonic = rootMidiOf(keyRoot, 4)
  const melodyBase = tonic + moodProfile.register
  const melodyNotes = []
  const chordNotes = []
  const padNotes = []
  const bassNotes = []
  const arpNotes = []

  for (let bar = 1; bar <= bars; bar += 1) {
    const label = progression[bar - 1]
    const root = rootMidiOf(chordRootName(label), 3)
    const shape = /m7/.test(label) ? 'm7' : /maj7/.test(label) ? 'maj7' : /7$/.test(label) ? '7' : /m/.test(label) ? 'm' : 'maj'
    const chordOffsets = CHORD_SHAPES[shape]
    /* Broken-chord figures give harp/strumstick/harpsichord their material without
       changing the harmonic progression. */
    for (let step = 0; step < MUSIC_STEPS_PER_BAR; step += 2) {
      const offset = chordOffsets[(step / 2) % chordOffsets.length]
      arpNotes.push({ bar, step, midi: root + 24 + offset, len: 1, vel: shapedVelocity(clampInt(62 + Math.floor(random() * 34), 48, 110, 78)) })
    }
    for (const offset of chordOffsets) {
      chordNotes.push({ bar, step: 0, midi: root + 12 + offset, len: MUSIC_STEPS_PER_BAR, vel: shapedVelocity(64) })
      padNotes.push({ bar, step: 0, midi: root + 24 + offset, len: MUSIC_STEPS_PER_BAR, vel: shapedVelocity(42) })
    }
    /* Bass: root on the down beat, a fifth answer halfway through, and a pickup on the
       last eighth when the density budget allows it. */
    bassNotes.push({ bar, step: 0, midi: root, len: shapedLength(6, 3), vel: shapedVelocity(104) })
    if (density > 0.3) bassNotes.push({ bar, step: 8, midi: root + 7, len: shapedLength(4, 2), vel: shapedVelocity(92) })
    if (density > 0.65) bassNotes.push({ bar, step: 12, midi: root + (random() < 0.5 ? 12 : 7), len: shapedLength(3, 1), vel: shapedVelocity(88) })

    /* Melody: a per-bar phrase of eighths, with rests and an occasional sixteenth pair.
       Bars 5-6 quote the first phrase a third higher so the sketch has a B section. */
    let cursor = 0
    let previous = melodyBase + melodyScale[Math.floor(random() * melodyScale.length)]
    while (cursor < MUSIC_STEPS_PER_BAR) {
      const gap = random()
      if (gap > 0.35 + density * 0.55) { cursor += 2; continue }
      const degree = Math.floor(random() * melodyScale.length)
      const octave = random() < 0.18 && complexity > 0.4 ? 12 : 0
      let midi = melodyBase + melodyScale[degree] + octave
      /* Prefer stepwise motion: a leap is only kept above the complexity budget. */
      if (Math.abs(midi - previous) > 7 && random() > complexity) {
        midi = previous + (random() < 0.5 ? -2 : 2)
      }
      midi = Math.min(melodyBase + 19, Math.max(melodyBase - 5, midi))
      const len = shapedLength(random() < 0.22 * density ? 1 : 2)
      melodyNotes.push({ bar, step: cursor, midi, len, vel: shapedVelocity(clampInt(84 + Math.floor(random() * 28), 60, 118, 96)) })
      previous = midi
      cursor += len + (gap > 0.5 ? 2 : 0)
    }
  }

  const drums = {}
  for (const lane of MUSIC_DRUM_IDS) {
    const base = DRUM_PATTERNS[style][lane] ?? []
    drums[lane] = []
    for (let bar = 0; bar < bars; bar += 1) {
      const steps = {}
      for (const step of base) {
        /* A seamless loop turns around instead of ending: no terminal fill, no thinned hats. */
        const isFill = !seamless && bar === bars - 1
        if (isFill && (lane === 'hat' || lane === 'open') && random() < 0.25) continue
        steps[step] = shapedVelocity(clampInt(70 + Math.floor(random() * 44), 40, 124, 96))
      }
      if (!seamless && bar === bars - 1 && (lane === 'snare' || lane === 'perc')) {
        for (const step of ['13', '14', '15']) if (random() < 0.8) steps[step] = shapedVelocity(clampInt(80 + Math.floor(random() * 30), 50, 124, 100))
      }
      drums[lane].push(steps)
    }
  }

  return normalizeMusicDoc({
    kind: MUSIC_DOC_KIND,
    version: MUSIC_DOC_VERSION,
    title: defaultMusicTitle(now),
    createdAt: now,
    updatedAt: now,
    bpm,
    keyRoot,
    keyMode,
    bars,
    swing,
    humanize,
    prompt: {
      text: typeof options.prompt === 'string' ? options.prompt : '',
      style,
      mood,
      density,
      complexity,
      instruments,
      seamless,
    },
    tracks: buildInstrumentTracks(instruments, { melodyNotes, chordNotes, padNotes, bassNotes, arpNotes, drums }),
    chordProgression: progression,
    sections,
  })
}

/* Per-instrument note material and level for the fallback composer. */
const TRACK_VOLUMES = Object.freeze({
  piano: 0.72, epiano: 0.58, organ: 0.46, harpsichord: 0.5, harp: 0.55,
  strumstick: 0.5, psaltery: 0.5, sax: 0.58, recorder: 0.5, glockenspiel: 0.4,
  timpani: 0.62, drums: 0.9,
})

function buildInstrumentTracks(instruments, material) {
  const highArp = material.arpNotes.map(note => ({ ...note, midi: Math.min(108, note.midi + 12) }))
  const timpaniNotes = material.bassNotes
    .filter(note => note.step === 0)
    .map(note => ({ ...note, midi: Math.min(57, note.midi + 12), len: Math.max(2, note.len) }))
  return instruments.map(instrument => {
    if (instrument === 'drums') return { id: 'drums', instrument, volume: TRACK_VOLUMES.drums, drums: material.drums }
    const notes = instrument === 'piano' ? [...material.chordNotes, ...material.bassNotes]
      : instrument === 'epiano' ? material.chordNotes
        : instrument === 'organ' ? material.padNotes
          : instrument === 'harpsichord' || instrument === 'harp' || instrument === 'strumstick' ? material.arpNotes
            : instrument === 'psaltery' ? material.padNotes
              : instrument === 'sax' || instrument === 'recorder' ? material.melodyNotes
                : instrument === 'glockenspiel' ? highArp
                  : instrument === 'timpani' ? timpaniNotes
                    : material.chordNotes
    return { id: instrument, instrument, volume: TRACK_VOLUMES[instrument] ?? 0.55, notes }
  })
}

/** Seconds per bar at a tempo. */
export function barSeconds(bpm) {
  return (60 / clampInt(bpm, MUSIC_BPM_MIN, MUSIC_BPM_MAX, 96)) * 4
}

/** Whole bars needed for a requested duration; at least MUSIC_BARS_MIN bars. */
export function barsForSeconds(seconds, bpm) {
  const target = clampFloat(seconds, MUSIC_DURATION_MIN_SECONDS, MUSIC_DURATION_MAX_SECONDS, 20)
  return clampInt(Math.ceil(target / barSeconds(bpm)), MUSIC_BARS_MIN, MUSIC_BARS_MAX)
}

/** Actual length of a bar count at a tempo. */
export function secondsForBars(bars, bpm) {
  return barSeconds(bpm) * clampInt(bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
}

/** Total loop length of a score in seconds. */
export function scoreSeconds(doc) {
  const bars = clampInt(doc?.bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
  return barSeconds(doc?.bpm) * bars
}


