/* Long-form AI composition helpers.
 *
 * The workshop page and the Host's headless fallback share the segment ranges, the merge and
 * the template-fallback policy (src/shared/music-compose.js); this module is the client half:
 * it asks the Host's `/music/compose` once per segment and returns one whole-piece result.
 */
import { composeMusicRequest } from '../../api.js'
import { buildMusicPlan, composeMusicScore, normalizeMusicInstruments } from '../../../shared/music-score.js'
import { composeMusicSequence, composeRanges, mergeComposedSegments } from '../../../shared/music-compose.js'

export { composeRanges, mergeComposedSegments }

/**
 * Compose one whole piece through the Host's compose endpoint.
 *
 * @param options.workspaceId - workspace the compose request is fenced to.
 * @param options.chatSessionId - session used by the "follow the chat model" choice.
 * @param options.model - `{ mode: 'session' }` or `{ provider, model }`.
 * @param options.bars / bpm / keyMode / keyRoot / style / mood / prompt / density / complexity /
 *   instruments / seamless / swing / humanize / title / createdAt - the piece framing.
 * @param options.signal - caller abort signal.
 * @param options.onStage - `({ index, total })` segment-progress callback (1-based index).
 * @returns `{ doc, engine, warning }` (engine 'template' means the deterministic fallback ran).
 */
export async function composePiece({
  workspaceId,
  chatSessionId,
  model,
  bars,
  bpm,
  keyMode,
  keyRoot,
  style,
  mood,
  prompt,
  density,
  complexity,
  instruments,
  seamless,
  swing,
  humanize,
  title,
  createdAt,
  signal,
  onStage,
}) {
  const plan = {
    ...buildMusicPlan({
      bars,
      bpm: Number.isFinite(Number(bpm)) ? Number(bpm) : undefined,
      keyMode: keyMode === 'major' || keyMode === 'minor' ? keyMode : undefined,
      keyRoot: typeof keyRoot === 'string' && keyRoot !== '' ? keyRoot : undefined,
      seamless,
      style,
    }),
    instruments: normalizeMusicInstruments(instruments),
  }
  const now = Date.now()

  const request = async ({ count, index, plan: current, range }) => {
    const result = await composeMusicRequest(workspaceId, {
      bars: range.bars,
      bpm: current.bpm,
      complexity,
      density,
      humanize,
      instruments: current.instruments,
      keyMode: current.keyMode,
      keyRoot: current.keyRoot,
      model,
      mood,
      prompt,
      segmentCount: count,
      segmentIndex: index + 1,
      seamless: current.seamless && index === count - 1,
      sessionId: chatSessionId,
      startBar: range.start,
      style,
      swing,
      totalBars: current.bars,
    }, signal)
    return { doc: result.doc, engine: result.engine, warning: result.warning }
  }

  const fallback = () => {
    const next = composeMusicScore({
      bars: plan.bars,
      bpm: plan.bpm,
      complexity,
      density,
      humanize,
      instruments: plan.instruments,
      keyMode: plan.keyMode,
      keyRoot: plan.keyRoot,
      mood,
      now,
      prompt,
      seamless: plan.seamless,
      seed: now,
      style,
      swing,
    })
    return { ...next, createdAt, title }
  }

  return composeMusicSequence({
    plan,
    meta: {
      complexity,
      createdAt,
      density,
      humanize,
      mood,
      prompt,
      seamless: plan.seamless,
      style,
      swing,
      title,
    },
    request,
    fallback,
    onStage,
    signal,
  })
}
