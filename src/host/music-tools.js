/** Model-facing tools for the music workshop's chat collaboration.
 *
 *  Two tools only, both scoped to "the workshop tab this session has open":
 *   - music_read_track  reads the registered snapshot (one bar range of one track);
 *   - music_edit_track  validates a patch and hands it to the page, which applies it to the
 *                       live document as one undoable track edit.
 *
 *  Definitions are plain ToolDefinition objects (name/description/parameters/output/execute)
 *  rather than `defineTool(...)` inputs: this package does not depend on the harness tool
 *  package, so it must not import it. Every argument is validated here.
 */
import {
  MUSIC_EDIT_OPS,
  MUSIC_REWRITE_BARS_MAX,
  MUSIC_REWRITE_NOTES_MAX,
} from '../shared/music-edit.js'
import {
  applyMusicCollabEdit,
  readMusicCollabOverview,
  readMusicCollabTrack,
} from './music-collab.js'

const SESSION_MISSING = 'no-session'
const READ_DESCRIPTION = [
  'Read one track of the score currently open in the user\'s music workshop (the AI Music Workshop tab of this session).',
  'Use it before rewriting notes: it returns the track\'s notes for a bar range plus the piece header (bars, BPM, key) and each bar\'s chord label, which is what a legal rewrite must follow.',
  'Without `bars` it returns the WHOLE track (notes capped by `limit`, default 256); pass `focus: true` to read only the bar the workshop has focused.',
  'A drum track returns its six lanes sliced to the requested range, at most 8 bars per call, and `bars` reports the range actually returned.',
  'Requires the workshop to be open in this session; otherwise it reports "workshop-closed" and you should ask the user to open it.',
  'Omit trackId for a compact overview of every track (id, instrument, kind, note count).',
].join(' ')
const EDIT_DESCRIPTION = [
  'Edit ONE track of the score open in the user\'s music workshop, immediately and undoably: the user gets one undo/redo step for the change.',
  'Never change the whole piece: BPM, key, bar count, the chord progression and every other track are locked and such requests must be refused with an explanation.',
  'Two mutually exclusive forms:',
  '(1) ops, rules over the existing notes (at most 8 ops per call: a longer list is refused, never trimmed) — thin (bars+keep 0.05-0.95, keeps downbeats), transpose (bars+semitones -24..24; refused when the shift would leave the piece\'s key, with the offending notes — rewrite those bars note by note instead), velocity (bars+factor 0.2-2, optional min/max), sustain (bars+factor 0.5-2), trim (bars, cuts that region out), drumVary (bars+seed, re-rolls the drum colour lanes), drumLane (bars+lane+steps {16th:velocity}).',
  `(2) notes, a rewrite of one bar range — bars is required, at most ${MUSIC_REWRITE_BARS_MAX} bars and ${MUSIC_REWRITE_NOTES_MAX} notes; every pitch must be in the piece's key and every strong beat (step 0/4/8/12) must be a chord tone of that bar. Anything outside those rules is rejected as a whole with the offending notes, so read the track and the chords first, and segment a longer rewrite. An empty notes array clears that range.`,
  'The result tells you what happened: applied (done), conflict (the user edited that track first — read it again), rejected (invalid patch, see reason/violations), gone, busy (another edit is still pending), pending (the page did not answer in time; it applies on its next poll), workshop-closed (no workshop open in this session), track-missing, track-not-loaded (only the selected track of a large piece is editable), too-many-edits (rate limit).',
].join(' ')

const text = value => [{ type: 'text', text: value }]

const barRangeSchema = {
  type: 'array',
  description: 'Inclusive bar range [from, to], 1-based.',
  items: { type: 'number' },
}

const noteSchema = {
  type: 'object',
  properties: {
    bar: { type: 'number', description: 'Bar number, 1-based.' },
    step: { type: 'number', description: '16th step inside the bar, 0-15.' },
    midi: { type: 'number', description: 'MIDI note number.' },
    len: { type: 'number', description: 'Length in 16th steps, at least 1.' },
    vel: { type: 'number', description: 'Velocity, 1-127.' },
  },
  required: ['bar', 'step', 'midi', 'len', 'vel'],
  additionalProperties: false,
}

const opSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: [...MUSIC_EDIT_OPS], description: 'Operation name.' },
    bars: barRangeSchema,
    keep: { type: 'number', description: 'thin: keep ratio 0.05-0.95.' },
    semitones: { type: 'number', description: 'transpose: semitones -24..24.' },
    factor: { type: 'number', description: 'velocity 0.2-2, sustain 0.5-2.' },
    min: { type: 'number', description: 'velocity: lower clamp 1-127.' },
    max: { type: 'number', description: 'velocity: upper clamp 1-127.' },
    seed: { type: 'number', description: 'drumVary: seed for the variation.' },
    lane: { type: 'string', description: 'drumLane: kick | snare | hat | open | clap | perc.' },
    steps: { type: 'object', description: 'drumLane: { "step": velocity } map.' },
  },
  required: ['op', 'bars'],
}

const readTrackTool = {
  name: 'music_read_track',
  description: READ_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      trackId: { type: 'string', description: 'Track id from the overview; omit for an overview of every track.' },
      bars: barRangeSchema,
      focus: { type: 'boolean', description: 'Read only the bar the workshop has focused instead of the whole track.' },
      limit: { type: 'number', description: 'Maximum notes to return (1-512, default 256).' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object' },
    render(_args, value) {
      const data = value ?? {}
      if (data.result !== 'ok') return text(`music workshop: ${String(data.result ?? 'unknown')}`)
      if (Array.isArray(data.tracks)) {
        const lines = [`piece: ${data.doc?.title || 'untitled'} · ${data.doc?.bars} bars · ${data.doc?.bpm} BPM · ${data.doc?.keyRoot} ${data.doc?.keyMode}`]
        for (const track of data.tracks) lines.push(`- ${track.id} (${track.instrument}${track.kind === 'drums' ? ', drums' : ''}) ${track.noteCount} notes${track.full === true ? '' : ' · summary only'}`)
        if (data.selected !== null && data.selected !== undefined) lines.push(`selected: ${data.selected.trackId}`)
        return text(lines.join('\n'))
      }
      const notes = Array.isArray(data.notes) ? data.notes : []
      const lines = [
        `${data.trackId} (${data.instrument}) bars ${data.bars?.[0]}-${data.bars?.[1]} of ${data.docBars}`,
        `key ${data.keyRoot} ${data.keyMode} · ${data.bpm} BPM`,
        `chords ${(data.chords ?? []).join(' | ') || '(none)'}`,
        `${notes.length} notes${data.truncated === true ? ' (truncated)' : ''}`,
      ]
      for (const note of notes.slice(0, 64)) lines.push(`bar ${note.bar} step ${note.step} midi ${note.midi} len ${note.len} vel ${note.vel}`)
      if (notes.length > 64) lines.push(`… ${notes.length - 64} more`)
      if (data.kind === 'drums' && data.drums !== null && typeof data.drums === 'object') {
        for (const [lane, bars] of Object.entries(data.drums)) {
          const list = Array.isArray(bars) ? bars : []
          const hits = list.reduce((sum, steps) => sum + Object.keys(steps ?? {}).length, 0)
          lines.push(`lane ${lane}: ${hits} hits in ${list.length} bars`)
        }
      }
      return text(lines.join('\n'))
    },
  },
  timeoutMs: 10_000,
  async execute(args, exec) {
    const session = exec?.agent?.id
    if (typeof session !== 'string' || session === '') return { result: SESSION_MISSING }
    if (typeof args?.trackId !== 'string' || args.trackId === '') return readMusicCollabOverview({ session })
    return readMusicCollabTrack({ bars: args.bars, focus: args.focus, limit: args.limit, session, trackId: args.trackId })
  },
}

const editTrackTool = {
  name: 'music_edit_track',
  description: EDIT_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      trackId: { type: 'string', description: 'The single track to change.' },
      ops: { type: 'array', description: 'Rule-based edits (form 1). Mutually exclusive with notes+bars.', items: opSchema },
      bars: { ...barRangeSchema, description: 'Rewrite range (form 2), required with notes; at most 8 bars.' },
      notes: { type: 'array', description: 'Rewritten notes for that range (form 2).', items: noteSchema },
      instruction: { type: 'string', description: 'What the user asked for, in one line (for the log).' },
    },
    required: ['trackId'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object' },
    render(_args, value) {
      const data = value ?? {}
      const summary = data.summary ?? {}
      const lines = [`music edit: ${String(data.result ?? 'unknown')}`]
      lines.push(`track ${String(data.trackId ?? '')} · notes ${summary.notesBefore ?? '?'} -> ${summary.notesAfter ?? '?'}${summary.chordFit === null || summary.chordFit === undefined ? '' : ` · chord fit ${summary.chordFit}`}`)
      if (data.reason !== undefined) lines.push(`reason: ${String(data.reason)}`)
      if (data.reason === 'transpose-out-of-key') lines.push('hint: rewrite those bars with notes+bars instead, or pick a shift that stays in the key')
      for (const violation of Array.isArray(data.violations) ? data.violations.slice(0, 8) : []) {
        lines.push(`violation: ${String(violation.reason)}${violation.bar === undefined ? '' : ` · bar ${violation.bar} step ${violation.step} ${violation.name ?? violation.midi ?? ''}`}`)
      }
      if (data.result === 'pending') lines.push('the page did not answer in time; it will apply within a second or two')
      return text(lines.join('\n'))
    },
  },
  timeoutMs: 15_000,
  async execute(args, exec) {
    const session = exec?.agent?.id
    if (typeof session !== 'string' || session === '') return { result: SESSION_MISSING }
    if (typeof args?.trackId !== 'string' || args.trackId === '') return { result: 'rejected', reason: 'track-id-required' }
    const result = await applyMusicCollabEdit({
      session,
      trackId: args.trackId,
      ops: args.ops,
      bars: args.bars,
      notes: args.notes,
      instruction: typeof args.instruction === 'string' ? args.instruction : '',
    })
    return { trackId: args.trackId, ...result }
  },
}

export const MUSIC_TOOL_NAMES = Object.freeze([readTrackTool.name, editTrackTool.name])

/** Register both tools; returns the disposer for the injected `tools` scope. */
export function installMusicTools(ctx) {
  const disposers = [ctx.tools.register(readTrackTool), ctx.tools.register(editTrackTool)]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
