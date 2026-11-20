/* Shared composition orchestration for the music workshop.
 *
 *  A long piece rarely fits one model answer, so both the workshop page and the Host's
 *  headless fallback split it into balanced 12-16 bar segments, merge the answers through the
 *  same document shape, and fall back to the deterministic template as one whole piece. The
 *  two callers differ only in HOW one segment is requested (`request`) and how the fallback
 *  is built, so the ranges/merge/fallback policy lives here once.
 *
 *  Pure data + injected async request: no fetch, no DOM, no Node APIs.
 */
import {
  MUSIC_AI_SEGMENT_MAX,
  MUSIC_AI_SINGLE_BARS,
  MUSIC_DOC_KIND,
  MUSIC_DOC_VERSION,
  normalizeMusicDoc,
} from './music-score.js'

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
      seamless: meta.seamless,
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

/** Abort as the same DOMException name the request helper reports, so callers keep one branch. */
function abortedError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Compose a whole piece through per-segment requests.
 *
 * @param plan - `buildMusicPlan()` result plus `instruments`.
 * @param meta - title / createdAt / style / mood / density / complexity / swing / humanize / prompt.
 * @param request - `async ({ range, index, count, plan }) => ({ doc, engine, warning })`.
 *   A non-'llm' engine means the caller already fell back (model missing / unusable answer);
 *   it stops the loop and the whole piece uses `fallback()`.
 * @param fallback - `() => doc`, the deterministic full-length template for this plan.
 * @param onStage - optional `({ index, total })` progress callback (1-based index).
 * @param signal - optional AbortSignal checked between segments.
 * @returns `{ doc, engine: 'llm' | 'template', warning }`.
 */
export async function composeMusicSequence({ plan, meta, request, fallback, onStage, signal }) {
  const ranges = composeRanges(plan.bars)
  const segments = []
  let warning = null
  let engine = 'llm'
  for (let index = 0; index < ranges.length; index += 1) {
    if (signal !== undefined && signal !== null && signal.aborted) throw abortedError()
    if (typeof onStage === 'function') onStage({ index: index + 1, total: ranges.length })
    const result = await request({ count: ranges.length, index, plan, range: ranges[index] })
    const parsed = normalizeMusicDoc(result?.doc)
    if (parsed === null) throw new Error('invalid-music-doc')
    if (result?.engine !== 'llm') {
      warning = result?.warning ?? null
      engine = 'template'
      break
    }
    segments.push({ doc: parsed, range: ranges[index] })
  }

  let doc = null
  if (engine === 'llm') {
    if (segments.length === ranges.length) {
      doc = mergeComposedSegments(segments, plan, meta)
      if (doc === null) {
        warning = 'llm-invalid'
        engine = 'template'
      }
    } else {
      engine = 'template'
    }
  }
  if (doc === null) doc = fallback()
  return { doc, engine, warning }
}
