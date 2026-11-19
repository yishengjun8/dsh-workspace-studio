/* Long-form AI composition helpers.
 *
 * A 60-second piece can exceed one model answer, so the panel asks the Host for balanced
 * 12-16 bar segments and merges them here. The plan (key, tempo, chord per bar, sections)
 * is shared by every segment, which keeps independently generated chunks in one key.
 */
import { MUSIC_AI_SEGMENT_MAX, MUSIC_AI_SINGLE_BARS, MUSIC_DOC_KIND, MUSIC_DOC_VERSION, normalizeMusicDoc } from '../../../shared/music-score.js'

/** Balanced segment ranges; 17 bars becomes 9+8 rather than 16+1. */
export function composeRanges(bars) {
  const total = Math.max(1, Number(bars) || 1)
  const count = Math.max(1, Math.min(MUSIC_AI_SEGMENT_MAX, Math.ceil(total / MUSIC_AI_SINGLE_BARS)))
  const base = Math.floor(total / count)
  const extra = total % count
  const ranges = []
  let start = 1
  for (let index = 0; index < count; index += 1) {
    const length = base + (index < extra ? 1 : 0)
    ranges.push({ bars: length, start })
    start += length
  }
  return ranges
}

/**
 * Merge segment docs into one full score. Returns null when a segment is missing an
 * instrument, so the caller can fall back to the deterministic full-length template.
 */
export function mergeComposedSegments(segments, plan, meta) {
  const tracks = []
  for (const instrument of plan.instruments) {
    const parts = []
    for (const segment of segments) {
      const track = segment.doc.tracks.find(item => item.instrument === instrument)
      if (track === undefined) return null
      parts.push({ range: segment.range, track })
    }
    const first = parts[0].track
    if (first.kind === 'drums') {
      const drums = {}
      for (const lane of Object.keys(first.drums)) {
        drums[lane] = parts.flatMap(({ range, track }) => {
          const laneBars = Array.isArray(track.drums?.[lane]) ? track.drums[lane] : []
          return Array.from({ length: range.bars }, (_, index) => laneBars[index] ?? {})
        })
      }
      tracks.push({ ...first, drums, id: instrument, name: first.name ?? '' })
      continue
    }
    const notes = parts.flatMap(({ range, track }) => (track.notes ?? []).map(note => ({
      ...note,
      bar: note.bar + range.start - 1,
    })))
    notes.sort((a, b) => (a.bar - b.bar) || (a.step - b.step) || (a.midi - b.midi))
    tracks.push({ ...first, id: instrument, name: first.name ?? '', notes })
  }

  return normalizeMusicDoc({
    bars: plan.bars,
    bpm: plan.bpm,
    chordProgression: plan.progression,
    createdAt: meta.createdAt,
    humanize: meta.humanize,
    keyMode: plan.keyMode,
    keyRoot: plan.keyRoot,
    kind: MUSIC_DOC_KIND,
    prompt: {
      complexity: meta.complexity,
      density: meta.density,
      instruments: plan.instruments,
      mood: meta.mood,
      seamless: plan.seamless,
      style: meta.style,
      text: meta.prompt,
    },
    sections: plan.sections,
    swing: meta.swing,
    title: meta.title,
    tracks,
    updatedAt: Date.now(),
    version: MUSIC_DOC_VERSION,
  })
}
