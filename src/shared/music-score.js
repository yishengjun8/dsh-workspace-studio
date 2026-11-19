/* Music-workshop score model shared by the Host and the client bundle.
 *
 * Pure data only: no fetch, no DOM, no Node APIs. The Host uses it to validate what it
 * stores and to build a deterministic fallback score when no model is configured; the
 * client uses the very same normalisation for its in-memory document, so a saved file,
 * an AI answer and a template never drift into three different shapes.
 *
 * v2: a score is an arbitrary list of instrument tracks (GarageBand-style), each either a
 * melodic track with notes or a drum track with a per-bar step pattern. v1 scores (fixed
 * melody/chords/bass + one drum bus) are migrated when loaded, never written back in the
 * old shape.
 */
export const MUSIC_DOC_KIND = 'workspace-studio.music'
export const MUSIC_DOC_VERSION = 2
export const MUSIC_DEFAULT_DIR = 'music'
export const MUSIC_FILE_SUFFIX = '.music.json'
export const MUSIC_DOC_MAX_BYTES = 768 * 1024
export const MUSIC_DRUM_IDS = Object.freeze(['kick', 'snare', 'hat', 'open', 'clap', 'perc'])
export const MUSIC_STYLE_IDS = Object.freeze(['lofi', 'electronic', 'pop', 'hiphop', 'chinese', 'cinematic'])
export const MUSIC_MOOD_IDS = Object.freeze(['lazy', 'warm', 'bright', 'tense'])
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
export const MUSIC_INSTRUMENTS = Object.freeze({
  lead: Object.freeze({ kind: 'notes', color: '#7aaaff' }),
  epiano: Object.freeze({ kind: 'notes', color: '#a78bfa' }),
  piano: Object.freeze({ kind: 'notes', color: '#8fb8ff' }),
  pad: Object.freeze({ kind: 'notes', color: '#4fd1c5' }),
  bass: Object.freeze({ kind: 'notes', color: '#4ed17e' }),
  guitar: Object.freeze({ kind: 'notes', color: '#f7ad31' }),
  strings: Object.freeze({ kind: 'notes', color: '#c4a5ff' }),
  organ: Object.freeze({ kind: 'notes', color: '#86c8ff' }),
  pluck: Object.freeze({ kind: 'notes', color: '#6fe0c8' }),
  brass: Object.freeze({ kind: 'notes', color: '#f0b85a' }),
  drums: Object.freeze({ kind: 'drums', color: '#f7ad31' }),
})
export const MUSIC_INSTRUMENT_IDS = Object.freeze(Object.keys(MUSIC_INSTRUMENTS))
/* The default AI-compose instrumentation: the same five parts the old fixed template used. */
export const MUSIC_DEFAULT_INSTRUMENTS = Object.freeze(['lead', 'epiano', 'bass', 'drums', 'pad'])

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
/* Legacy ids of the v1 fixed score. Used only when reading an old document. */
const LEGACY_TRACK_IDS = Object.freeze(['melody', 'chords', 'bass'])
const LEGACY_TRACK_INSTRUMENTS = Object.freeze({ melody: 'lead', chords: 'epiano', bass: 'bass' })

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
  /* A model may omit the instrument but keep a legacy id; infer the closest palette entry. */
  const instrument = requested
    ?? (value.kind === 'drums' || value.id === 'drums' ? 'drums'
      : value.id === 'bass' ? 'bass'
        : value.id === 'chords' ? 'epiano' : 'lead')
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

/* v1: the score kept three fixed melodic tracks plus one shared drum bus. */
function legacyTracks(value, bars) {
  const list = Array.isArray(value.tracks) ? value.tracks : []
  const byId = new Map()
  for (const track of list) {
    if (isPlainObject(track) && typeof track.id === 'string') byId.set(track.id, track)
  }
  const map = isPlainObject(value.tracks) ? value.tracks : {}
  const tracks = []
  let total = 0
  for (const id of LEGACY_TRACK_IDS) {
    const source = byId.get(id) ?? map[id] ?? {}
    const notes = normalizeNotes(source.notes).filter(note => note.bar <= bars)
    const limited = notes.slice(0, Math.max(0, MUSIC_NOTE_COUNT_MAX - total))
    total += limited.length
    tracks.push({
      id,
      name: '',
      instrument: LEGACY_TRACK_INSTRUMENTS[id],
      kind: 'notes',
      volume: id === 'chords' ? 0.62 : 0.8,
      muted: source.muted === true,
      solo: false,
      notes: limited,
    })
  }
  tracks.push({
    id: 'drums',
    name: '',
    instrument: 'drums',
    kind: 'drums',
    volume: 0.9,
    muted: false,
    solo: false,
    drums: normalizeDrums(value.drums, bars),
  })
  return tracks
}

/* A v2 track list, or an object map a model may return instead of an array. */
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

function isV2Score(value) {
  if (value.version === MUSIC_DOC_VERSION) return true
  /* v1 always wrote a top-level drum bus and never a per-track `kind`; the version field is
     authoritative when present, and the top-level bus is the legacy signature otherwise. */
  if (value.version === 1) return false
  if (isPlainObject(value.drums)) return false
  const list = Array.isArray(value.tracks) ? value.tracks : (isPlainObject(value.tracks) ? Object.values(value.tracks) : [])
  return list.some(track => isPlainObject(track)
    && (track.kind === 'drums' || track.kind === 'notes'
      || (typeof track.instrument === 'string' && MUSIC_INSTRUMENT_IDS.includes(track.instrument))))
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
 * v1 documents are migrated to the v2 track list on read.
 */
export function normalizeMusicDoc(value) {
  if (!isPlainObject(value)) return null
  const hasScore = Array.isArray(value.tracks) || isPlainObject(value.tracks) || isPlainObject(value.drums)
  if (!hasScore && value.kind !== MUSIC_DOC_KIND) return null
  const bars = clampInt(value.bars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
  const prompt = isPlainObject(value.prompt) ? value.prompt : {}
  const seamless = normalizeMusicSeamless(prompt.seamless)
  const now = Date.now()
  const v2 = isV2Score(value)
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
    tracks: v2 ? normalizeTrackList(value.tracks, bars) : legacyTracks(value, bars),
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
  const bpm = clampInt(options.bpm, MUSIC_BPM_MIN, MUSIC_BPM_MAX, style === 'electronic' ? 118 : style === 'lofi' ? 92 : 104)
  const keyMode = options.keyMode === 'major' || options.keyMode === 'minor'
    ? options.keyMode
    : (style === 'electronic' || style === 'hiphop' || style === 'cinematic' ? 'minor' : 'major')
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
 * Five instrument tracks (lead / e-piano / bass / drums / pad) mirror what the AI returns.
 */
export function composeMusicScore(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const plan = buildMusicPlan(options)
  const { bars, bpm, keyMode, keyRoot, progression, sections, seamless, style } = plan
  const mood = MUSIC_MOOD_IDS.includes(options.mood) ? options.mood : 'lazy'
  const density = clampFloat(options.density, 0, 1, 0.55)
  const complexity = clampFloat(options.complexity, 0, 1, 0.5)
  const swing = clampFloat(options.swing, 0, 0.75, style === 'lofi' || style === 'hiphop' ? 0.32 : 0.08)
  const humanize = clampFloat(options.humanize, 0, 0.5, 0.08)
  const random = makeRandom(options.seed === undefined ? now : options.seed)
  const instruments = normalizeMusicInstruments(options.instruments)

  const melodyScale = style === 'chinese' ? PENTATONIC : (keyMode === 'minor' ? MINOR_SCALE : MAJOR_SCALE)
  const tonic = rootMidiOf(keyRoot, 4)
  const melodyNotes = []
  const chordNotes = []
  const padNotes = []
  const bassNotes = []
  const arpNotes = []
  const brassNotes = []

  for (let bar = 1; bar <= bars; bar += 1) {
    const label = progression[bar - 1]
    const root = rootMidiOf(chordRootName(label), 3)
    const shape = /m7/.test(label) ? 'm7' : /maj7/.test(label) ? 'maj7' : /7$/.test(label) ? '7' : /m/.test(label) ? 'm' : 'maj'
    const chordOffsets = CHORD_SHAPES[shape]
    /* Broken-chord and stab figures give guitar/pluck/brass their own material without
       changing the harmonic progression. */
    for (let step = 0; step < MUSIC_STEPS_PER_BAR; step += 2) {
      const offset = chordOffsets[(step / 2) % chordOffsets.length]
      arpNotes.push({ bar, step, midi: root + 24 + offset, len: 1, vel: clampInt(62 + Math.floor(random() * 34), 48, 110, 78) })
    }
    for (const step of [0, 8]) {
      for (const offset of chordOffsets.slice(0, 3)) {
        brassNotes.push({ bar, step, midi: root + 12 + offset, len: 2, vel: 96 })
      }
    }
    for (const offset of chordOffsets) {
      chordNotes.push({ bar, step: 0, midi: root + 12 + offset, len: MUSIC_STEPS_PER_BAR, vel: 64 })
      padNotes.push({ bar, step: 0, midi: root + 24 + offset, len: MUSIC_STEPS_PER_BAR, vel: 42 })
    }
    /* Bass: root on the down beat, a fifth answer halfway through, and a pickup on the
       last eighth when the density budget allows it. */
    bassNotes.push({ bar, step: 0, midi: root, len: 6, vel: 104 })
    if (density > 0.3) bassNotes.push({ bar, step: 8, midi: root + 7, len: 4, vel: 92 })
    if (density > 0.65) bassNotes.push({ bar, step: 12, midi: root + (random() < 0.5 ? 12 : 7), len: 3, vel: 88 })

    /* Melody: a per-bar phrase of eighths, with rests and an occasional sixteenth pair.
       Bars 5-6 quote the first phrase a third higher so the sketch has a B section. */
    let cursor = 0
    let previous = tonic + melodyScale[Math.floor(random() * melodyScale.length)]
    while (cursor < MUSIC_STEPS_PER_BAR) {
      const gap = random()
      if (gap > 0.35 + density * 0.55) { cursor += 2; continue }
      const degree = Math.floor(random() * melodyScale.length)
      const octave = random() < 0.18 && complexity > 0.4 ? 12 : 0
      let midi = tonic + melodyScale[degree] + octave
      /* Prefer stepwise motion: a leap is only kept above the complexity budget. */
      if (Math.abs(midi - previous) > 7 && random() > complexity) {
        midi = previous + (random() < 0.5 ? -2 : 2)
      }
      midi = Math.min(tonic + 19, Math.max(tonic - 5, midi))
      const len = random() < 0.22 * density ? 1 : 2
      melodyNotes.push({ bar, step: cursor, midi, len, vel: clampInt(84 + Math.floor(random() * 28), 60, 118, 96) })
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
        steps[step] = clampInt(70 + Math.floor(random() * 44), 40, 124, 96)
      }
      if (!seamless && bar === bars - 1 && (lane === 'snare' || lane === 'perc')) {
        for (const step of ['13', '14', '15']) if (random() < 0.8) steps[step] = clampInt(80 + Math.floor(random() * 30), 50, 124, 100)
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
    tracks: buildInstrumentTracks(instruments, { melodyNotes, chordNotes, padNotes, bassNotes, arpNotes, brassNotes, drums }),
    chordProgression: progression,
    sections,
  })
}

/* Per-instrument note material and level for the fallback composer. */
const TRACK_VOLUMES = Object.freeze({
  lead: 0.8, epiano: 0.62, piano: 0.68, pad: 0.45, bass: 0.8, guitar: 0.56,
  strings: 0.5, organ: 0.52, pluck: 0.55, brass: 0.58, drums: 0.9,
})

function buildInstrumentTracks(instruments, material) {
  return instruments.map(instrument => {
    if (instrument === 'drums') return { id: 'drums', instrument, volume: TRACK_VOLUMES.drums, drums: material.drums }
    const notes = instrument === 'bass' ? material.bassNotes
      : instrument === 'pad' || instrument === 'strings' ? material.padNotes
        : instrument === 'guitar' || instrument === 'pluck' ? material.arpNotes
          : instrument === 'brass' ? material.brassNotes
            : instrument === 'lead' ? material.melodyNotes
              : material.chordNotes
    return { id: instrument, instrument, volume: TRACK_VOLUMES[instrument] ?? 0.6, notes }
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


