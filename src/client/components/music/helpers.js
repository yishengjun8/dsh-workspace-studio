/* Pure helpers for the music panel: note value labels, path parsing, immutable score
 * edits and the per-bar drum variation. Kept out of the component files so the panel
 * renders what these functions return and never mutates the document in place.
 */
import { MUSIC_DRUM_IDS, MUSIC_STEPS_PER_BAR, chordRootName, midiName, musicNoteCount } from '../../../shared/music-score.js'
import { translate } from '../../locale/index.js'

const NOTE_VALUES = [
  [16, '1/1'], [12, '3/4'], [8, '1/2'], [6, '3/8'], [4, '1/4'], [3, '3/16'], [2, '1/8'], [1, '1/16'],
]

export function noteValueLabel(len) {
  const found = NOTE_VALUES.find(entry => entry[0] === len)
  if (found !== undefined) return found[1]
  if (len > MUSIC_STEPS_PER_BAR) {
    const bars = Math.round((len / MUSIC_STEPS_PER_BAR) * 100) / 100
    return `${bars} ${translate('music.barsUnit')}`
  }
  return `${len}/16`
}

export function startLabel(bar, step) {
  return `${bar}.${Math.floor(step / 4) + 1}.${(step % 4) + 1}`
}

export function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  const whole = Math.floor(rest)
  return `${minutes}:${whole < 10 ? '0' : ''}${whole}.${Math.floor((rest - whole) * 10)}`
}

export function parseSavedPath(path) {
  if (typeof path !== 'string' || path === '') return { dir: '', name: '' }
  const index = path.lastIndexOf('/')
  return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index), name: path.slice(index + 1) }
}

export function stripMusicSuffix(name) {
  return typeof name === 'string' && name.toLowerCase().endsWith('.music.json')
    ? name.slice(0, -'.music.json'.length)
    : (typeof name === 'string' ? name : '')
}

/* A score title is free text, but a FILE name is not: Windows refuses : * ? " < > | (and the
   Host validates names per platform). Deriving the save dialog's default name through this
   keeps the common case (a generated timestamped title) a one-click save. */
export function safeFileName(name) {
  return String(name ?? '').replace(/[\\/:*?"<>|]/gu, '-').trim()
}

export function countNotes(doc) {
  return musicNoteCount(doc)
}

/** Playable events that a shorter arrangement would discard. */
export function countEventsBeyond(doc, bars) {
  let total = 0
  for (const track of Array.isArray(doc?.tracks) ? doc.tracks : []) {
    if (track.kind === 'drums') {
      for (const lane of MUSIC_DRUM_IDS) {
        const laneBars = Array.isArray(track.drums?.[lane]) ? track.drums[lane] : []
        for (let index = bars; index < laneBars.length; index += 1) {
          if (laneBars[index] !== null && typeof laneBars[index] === 'object') total += Object.keys(laneBars[index]).length
        }
      }
      continue
    }
    for (const note of Array.isArray(track.notes) ? track.notes : []) {
      if (note.bar > bars) total += 1
    }
  }
  return total
}

export function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  return (Math.round(safe * 10) / 10).toFixed(1)
}

export function keyLabel(doc) {
  return `${doc.keyRoot} ${doc.keyMode === 'minor' ? '小调' : '大调'}`
}

export function chordNameAt(doc, bar) {
  const label = doc.chordProgression?.[bar - 1]
  return typeof label === 'string' && label !== '' ? label : chordRootName('C')
}

export function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc))
}

export function trackById(doc, trackId) {
  return doc.tracks.find(item => item.id === trackId) ?? null
}

export function findNote(doc, selection) {
  if (selection === null || selection === undefined) return null
  const track = doc.tracks.find(item => item.id === selection.trackId)
  if (track === undefined || track.kind === 'drums') return null
  const note = track.notes[selection.index]
  return note === undefined ? null : { track, note }
}

/** Replace one note through an immutable document copy; a no-op patch returns the same doc. */
export function patchNote(doc, trackId, index, patch) {
  const track = doc.tracks.find(item => item.id === trackId)
  if (track === undefined || track.kind === 'drums') return doc
  const note = track.notes[index]
  if (note === undefined) return doc
  const nextNote = { ...note, ...patch }
  if (nextNote.midi === note.midi && nextNote.bar === note.bar && nextNote.step === note.step && nextNote.len === note.len && nextNote.vel === note.vel) return doc
  const notes = track.notes
    .map((item, itemIndex) => (itemIndex === index ? nextNote : item))
    .sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi))
  return {
    ...doc,
    tracks: doc.tracks.map(item => (item.id === trackId ? { ...item, notes } : item)),
  }
}

export function deleteNoteAt(doc, trackId, index) {
  const track = doc.tracks.find(item => item.id === trackId)
  if (track === undefined || track.kind === 'drums' || track.notes[index] === undefined) return doc
  return {
    ...doc,
    tracks: doc.tracks.map(item => (item.id === trackId
      ? { ...item, notes: item.notes.filter((_, noteIndex) => noteIndex !== index) }
      : item)),
  }
}

export function addNoteTo(doc, trackId, note) {
  return {
    ...doc,
    tracks: doc.tracks.map(item => (item.id === trackId && item.kind !== 'drums'
      ? { ...item, notes: [...item.notes, note].sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi)) }
      : item)),
  }
}

/** Empty six-lane pattern for a drum track. */
export function emptyDrumPattern(bars) {
  const drums = {}
  for (const lane of MUSIC_DRUM_IDS) {
    drums[lane] = Array.from({ length: bars }, () => ({}))
  }
  return drums
}

/** Toggle one step in a drum track's pattern; returns the new drums object. */
export function toggleDrumStep(drums, lane, barIndex, step, velocity) {
  const lanes = drums?.[lane]
  if (!Array.isArray(lanes)) return drums
  return {
    ...drums,
    [lane]: lanes.map((steps, index) => {
      if (index !== barIndex) return steps
      const next = { ...steps }
      if (next[String(step)] === undefined) next[String(step)] = velocity
      else delete next[String(step)]
      return next
    }),
  }
}

/* The bar-level "give me a variation" action: keeps the kick/snare spine and re-rolls the
   colour lanes (hat / open / clap / perc), adding a small fill on the last bar. Local and
   instant — the panel treats it as an ordinary edit, so it saves with the score. */
export function varyDrums(drums, bars, barIndex, density = 0.55, random = Math.random) {
  const next = { ...drums }
  const hatSteps = []
  for (let step = 0; step < MUSIC_STEPS_PER_BAR; step += 1) {
    if (random() < 0.45 + density * 0.35) hatSteps.push(step)
  }
  next.hat = next.hat.map((steps, index) => {
    if (index !== barIndex) return steps
    const result = {}
    for (const step of hatSteps) result[String(step)] = Math.round(58 + random() * 50)
    return result
  })
  for (const lane of ['open', 'clap', 'perc']) {
    next[lane] = next[lane].map((steps, index) => {
      if (index !== barIndex) return steps
      const result = {}
      for (let step = 0; step < MUSIC_STEPS_PER_BAR; step += 1) {
        if (random() < (lane === 'perc' ? 0.16 : 0.08)) result[String(step)] = Math.round(60 + random() * 50)
      }
      return result
    })
  }
  if (barIndex === bars - 1) {
    next.snare = next.snare.map((steps, index) => {
      if (index !== barIndex) return steps
      const result = { ...steps }
      for (const step of [13, 14, 15]) if (random() < 0.75) result[String(step)] = Math.round(84 + random() * 30)
      return result
    })
  }
  return next
}

export function noteTitle(note) {
  return `${midiName(note.midi)} · 小节 ${note.bar}`
}

