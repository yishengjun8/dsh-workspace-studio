/** Model-facing tools for the music workshop's chat collaboration.
 *
 *  Tools:
 *   - music_read_track   reads the registered snapshot (one bar range of one track);
 *   - music_edit_track   validates a patch and hands it to the page, which applies it to the
 *                        live document as one undoable track edit;
 *   - music_compose      creates a NEW piece: it hands a job to the page (which opens a new
 *                        workshop tab, composes, saves and exports) and returns the paths. With
 *                        no page to claim it, it composes on the Host and saves the project.
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
  MUSIC_BARS_MAX,
  MUSIC_BARS_MIN,
  MUSIC_BPM_MAX,
  MUSIC_BPM_MIN,
  MUSIC_DEFAULT_DIR,
  MUSIC_FILE_SUFFIX,
  MUSIC_INSTRUMENT_IDS,
  MUSIC_KEY_ROOTS,
  MUSIC_MOOD_IDS,
  MUSIC_STYLE_IDS,
  buildMusicPlan,
  composeMusicScore,
  normalizeMusicDoc,
} from '../shared/music-score.js'
import { MUSIC_EXPORT_FORMATS } from '../shared/music-export.js'
import { composeMusicSequence } from '../shared/music-compose.js'
import { composeMusic, listMusicDocs, saveMusicDoc } from './music.js'
import { createMusicJob, normalizeMusicJobParams, waitMusicJobClaim, waitMusicJobResult, cancelMusicJob } from './music-jobs.js'
import { workspaceForSession } from './workspace.js'
import {
  applyMusicCollabEdit,
  readMusicCollabOverview,
  readMusicCollabTrack,
} from './music-collab.js'

const SESSION_MISSING = 'no-session'
const READ_DESCRIPTION = [
  'Read one track of the score currently open in the user\'s music workshop (the AI Music Workshop tab of this session).',
  'Use it before rewriting notes: it returns the track\'s notes for a bar range plus the piece header (bars, BPM, key) and each bar\'s chord label, which is what a legal rewrite must follow.',
  'Without `bars` it returns the WHOLE track (notes capped by `limit`, default 256); pass `focus: true` to read only the bar the workshop has focused (with whole-piece scope that is the whole track).',
  'A drum track returns its six lanes sliced to the requested range, at most 8 bars per call, and `bars` reports the range actually returned.',
  'Requires the workshop to be open in this session; otherwise it reports "workshop-closed" and you should ask the user to open it.',
  'Omit trackId for a compact overview of every track (id, instrument, kind, note count).',
].join(' ')
const EDIT_DESCRIPTION = [
  'Edit ONE track of the score open in the user\'s music workshop, immediately and undoably: the user gets one undo/redo step for the change.',
  'Global properties are locked: never change BPM, key, bar count or the chord progression, and never touch a track the user did not ask about; refuse such requests with an explanation. A whole-piece request is a SCOPE, not a global edit: when the workshop reports scope whole, any track and any bar range is addressable — make one call per track and per bar range.',
  'Two mutually exclusive forms:',
  '(1) ops, rules over the existing notes (at most 8 ops per call: a longer list is refused, never trimmed) — thin (bars+keep 0.05-0.95, keeps downbeats), transpose (bars+semitones -24..24; refused when the shift would leave the piece\'s key, with the offending notes — rewrite those bars note by note instead), velocity (bars+factor 0.2-2, optional min/max), sustain (bars+factor 0.5-2), trim (bars, cuts that region out), drumVary (bars+seed, re-rolls the drum colour lanes), drumLane (bars+lane+steps {16th:velocity}).',
  `(2) notes, a rewrite of one bar range — bars is required, at most ${MUSIC_REWRITE_BARS_MAX} bars and ${MUSIC_REWRITE_NOTES_MAX} notes; every pitch must be in the piece's key and every strong beat (step 0/4/8/12) must be a chord tone of that bar. Anything outside those rules is rejected as a whole with the offending notes, so read the track and the chords first, and segment a longer rewrite. An empty notes array clears that range.`,
  'The result tells you what happened: applied (done), conflict (the user edited that track first — read it again), rejected (invalid patch, see reason/violations), gone, busy (another edit is still pending), pending (the page did not answer in time; it applies on its next poll), workshop-closed (no workshop open in this session), track-missing, track-not-loaded (only the selected track of a large piece is editable), too-many-edits (rate limit).',
].join(' ')
const COMPOSE_DESCRIPTION = [
  'Create a NEW piece in the user\'s AI Music Workshop and export it. Use this for any request to generate, compose, produce, or write a new piece of music.',
  'It opens a new workshop tab, composes the piece, saves it as a `.music.json` project in the workspace and exports the requested format (WAV, MIDI or the score JSON); it returns the saved and exported workspace paths.',
  'Do NOT use it to change a piece that is already open in the workshop: use `music_read_track` / `music_edit_track` for edits, because this tool replaces the piece instead of editing it.',
  'If the user names no format, omit `export` so the workshop follows the user\'s last export choice (first time: WAV).',
  'When the workshop page is unavailable, the project is still composed and saved on the Host, but WAV/MIDI export is skipped and the result says so.',
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
        if (data.selected !== null && data.selected !== undefined) lines.push(`selected: ${data.selected.trackId}${data.selected.scope === 'whole' ? ' · whole piece' : ''}`)
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

/* ── music_compose ──────────────────────────────────────────────────────────── */

/* The page polls every 3s while visible; 8s leaves room for one slow poll plus React work. */
const COMPOSE_CLAIM_TIMEOUT_MS = 8_000
const COMPOSE_NAME_MAX = 80

function cleanBaseName(value) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\\/:*?"<>|]/gu, '-').replace(/[\u0000-\u001f\u007f]/gu, '').trim()
  return text.slice(0, COMPOSE_NAME_MAX)
}

function stripScoreSuffix(name) {
  return name.toLowerCase().endsWith(MUSIC_FILE_SUFFIX)
    ? name.slice(0, -MUSIC_FILE_SUFFIX.length).trim()
    : name
}

/** A free `<base>` under the music directory, so an automatic save never overwrites a score. */
async function uniqueMusicBase(workspace, dir, rawBase) {
  const root = stripScoreSuffix(cleanBaseName(rawBase)) || '未命名作品'
  let taken = new Set()
  try {
    const listed = await listMusicDocs(workspace, { dir })
    taken = new Set((Array.isArray(listed.files) ? listed.files : []).map(file => String(file.name).toLowerCase()))
  } catch {
    /* A failed listing must not block the save: the Host reports a real write collision. */
  }
  const keyOf = name => `${name}${MUSIC_FILE_SUFFIX}`.toLowerCase()
  if (!taken.has(keyOf(root))) return root
  for (let index = 2; index <= 50; index += 1) {
    const candidate = `${root} (${index})`
    if (!taken.has(keyOf(candidate))) return candidate
  }
  return `${root} ${Date.now()}`
}

/** The session's own route for "follow the chat"; a fixed route avoids reading the whole log. */
function agentModelOf(exec) {
  try {
    const config = exec?.agent?.requestHeader?.()?.config
    if (config !== null && config !== undefined
      && typeof config.provider === 'string' && config.provider !== ''
      && typeof config.model === 'string' && config.model !== '') {
      return { provider: config.provider, model: config.model }
    }
  } catch {
    /* no live header: let composeMusic resolve the session route from persistence */
  }
  return { mode: 'session' }
}

function persistenceOf(ctx) {
  try {
    return ctx.get('sessionPersistence')
  } catch {
    return null
  }
}

/**
 * Host-only fallback: compose the whole piece and save the project. No WAV/MIDI (the page
 * owns offline rendering); the project itself is the JSON export.
 */
export async function composeAndSave(ctx, workspace, config, writeQueues, sessionId, params, exec) {
  const plan = {
    ...buildMusicPlan({
      bars: params.bars,
      bpm: params.bpm ?? undefined,
      keyMode: params.keyMode ?? undefined,
      keyRoot: params.keyRoot ?? undefined,
      seamless: params.seamless,
      style: params.style,
    }),
    instruments: params.instruments,
  }
  const now = Date.now()
  const persistence = persistenceOf(ctx)
  const model = agentModelOf(exec)
  const result = await composeMusicSequence({
    plan,
    meta: {
      complexity: params.complexity,
      createdAt: now,
      density: params.density,
      humanize: params.humanize,
      mood: params.mood,
      prompt: params.prompt,
      seamless: plan.seamless,
      style: params.style,
      swing: params.swing,
      title: params.name || undefined,
    },
    request: async ({ count, index, plan: current, range }) => composeMusic(ctx, persistence, {
      bars: range.bars,
      bpm: current.bpm,
      complexity: params.complexity,
      density: params.density,
      humanize: params.humanize,
      instruments: current.instruments,
      keyMode: current.keyMode,
      keyRoot: current.keyRoot,
      model,
      mood: params.mood,
      prompt: params.prompt,
      segmentCount: count,
      segmentIndex: index + 1,
      seamless: current.seamless && index === count - 1,
      sessionId,
      startBar: range.start,
      style: params.style,
      swing: params.swing,
      totalBars: current.bars,
    }),
    fallback: () => {
      const fallback = composeMusicScore({
        bars: plan.bars,
        bpm: plan.bpm,
        complexity: params.complexity,
        density: params.density,
        humanize: params.humanize,
        instruments: plan.instruments,
        keyMode: plan.keyMode,
        keyRoot: plan.keyRoot,
        mood: params.mood,
        now,
        prompt: params.prompt,
        seamless: plan.seamless,
        seed: now,
        style: params.style,
        swing: params.swing,
      })
      return { ...fallback, createdAt: now, title: params.name || fallback.title }
    },
    signal: exec?.signal,
  })
  const doc = normalizeMusicDoc({ ...result.doc, title: params.name || result.doc.title })
  if (doc === null) throw new Error('invalid-music-doc')
  const dir = MUSIC_DEFAULT_DIR
  const name = await uniqueMusicBase(workspace, dir, params.name || doc.title)
  const saved = await saveMusicDoc(workspace, config, writeQueues, { dir, doc, name })
  return { doc: saved.doc ?? doc, engine: result.engine, path: saved.path, warning: result.warning }
}

/* ── music_compose ──────────────────────────────────────────────────────────── */function createComposeTool({ config, ctx, enableCompose, writeQueues }) {
  return {
    name: 'music_compose',
    description: COMPOSE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the piece should be: mood, scene, references, instruments. Optional.' },
        style: { type: 'string', enum: [...MUSIC_STYLE_IDS], description: 'Musical style id.' },
        mood: { type: 'string', enum: [...MUSIC_MOOD_IDS], description: 'Emotional colour.' },
        bars: { type: 'number', description: `Length in bars (${MUSIC_BARS_MIN}-${MUSIC_BARS_MAX}, default 8). Longer pieces take several model calls.` },
        bpm: { type: 'number', description: `Tempo ${MUSIC_BPM_MIN}-${MUSIC_BPM_MAX}; omit for the style default.` },
        keyRoot: { type: 'string', enum: [...MUSIC_KEY_ROOTS], description: 'Key root; omit for the style default.' },
        keyMode: { type: 'string', enum: ['major', 'minor'], description: 'Key mode; omit for the style default.' },
        density: { type: 'number', description: 'Note density 0-1 (default 0.55).' },
        complexity: { type: 'number', description: 'Harmonic/rhythmic complexity 0-1 (default 0.5).' },
        instruments: { type: 'array', description: 'Instrument ids, one track each (1-12). Omit for the default band.', items: { type: 'string', enum: [...MUSIC_INSTRUMENT_IDS] } },
        seamless: { type: 'boolean', description: 'Loop seamlessly (default true).' },
        export: { type: 'string', enum: [...MUSIC_EXPORT_FORMATS, 'none'], description: 'Export format. Omit to follow the workshop\'s last export choice.' },
        name: { type: 'string', description: 'File base name. Omit to derive it from the piece title.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        const data = value ?? {}
        const lines = [`music compose: ${String(data.result ?? 'unknown')}`]
        if (typeof data.path === 'string' && data.path !== '') lines.push(`saved: ${data.path}`)
        if (typeof data.exportPath === 'string' && data.exportPath !== '') lines.push(`exported: ${data.exportPath}${typeof data.format === 'string' ? ` (${data.format})` : ''}`)
        if (typeof data.engine === 'string') lines.push(`engine: ${data.engine}${typeof data.warning === 'string' && data.warning !== '' ? ` · warning ${data.warning}` : ''}`)
        if (data.audioExportSkipped === true) lines.push('audio export skipped: no workshop page claimed the job; the score project is saved — open the workshop to export WAV/MIDI')
        if (data.result === 'pending') lines.push('the workshop is still composing; the files will appear when it finishes')
        if (data.result === 'busy') lines.push('another music job is already running in this session')
        if (typeof data.reason === 'string' && data.reason !== '') lines.push(`reason: ${data.reason}`)
        if (typeof data.error === 'string' && data.error !== '') lines.push(`error: ${data.error}`)
        return text(lines.join('\n'))
      },
    },
    timeoutMs: config.musicChatTimeoutMs + COMPOSE_CLAIM_TIMEOUT_MS + 15_000,
    async execute(args, exec) {
      const session = exec?.agent?.id
      if (typeof session !== 'string' || session === '') return { result: SESSION_MISSING }
      if (enableCompose !== true) return { result: 'disabled' }
      const workspace = await workspaceForSession(ctx, session).catch(() => null)
      if (workspace === null) return { result: 'no-workspace' }
      if (config.enableEditing !== true) return { result: 'editing-disabled' }

      const created = createMusicJob(session, { ...args, workspaceId: workspace.workspaceId })
      if (created.ok !== true) {
        return { result: created.reason === 'busy' ? 'busy' : 'rejected', reason: created.reason }
      }
      const claimed = await waitMusicJobClaim(session, created.id, COMPOSE_CLAIM_TIMEOUT_MS, exec.signal)
      if (claimed === true) {
        const ack = await waitMusicJobResult(session, created.id, config.musicChatTimeoutMs, exec.signal)
        if (ack.result === 'aborted') {
          cancelMusicJob(session, created.id)
          return { result: 'aborted' }
        }
        if (ack.result === 'pending' || ack.result === 'expired') return { result: 'pending', id: created.id }
        return { result: ack.result, ...ack.data }
      }
      const cancelled = cancelMusicJob(session, created.id)
      if (claimed !== false) return { result: 'aborted' }
      if (cancelled !== true) {
        /* The page claimed the job just as the claim window closed: wait for its result instead
           of composing the same piece twice. */
        const ack = await waitMusicJobResult(session, created.id, config.musicChatTimeoutMs, exec.signal)
        if (ack.result === 'aborted') return { result: 'aborted' }
        if (ack.result === 'pending' || ack.result === 'expired') return { result: 'pending', id: created.id }
        return { result: ack.result, ...ack.data }
      }

      /* No page claimed it: compose on the Host and save the project. */
      try {
        const params = normalizeMusicJobParams(args)
        if (params === null) return { result: 'rejected', reason: 'invalid-params' }
        const result = await composeAndSave(ctx, workspace, config, writeQueues, session, params, exec)
        const format = params.export.format
        const output = {
          bars: result.doc.bars,
          engine: result.engine,
          format: format ?? null,
          path: result.path,
          result: 'saved',
          title: result.doc.title,
          warning: result.warning,
        }
        if (format === 'json') output.exportPath = result.path
        if (format === null || format === 'wav' || format === 'midi') output.audioExportSkipped = true
        return output
      } catch (error) {
        return { result: 'failed', reason: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

const MUSIC_COMPOSE_SECTION = [
  'Music workshop: when the user asks to create, compose, generate, write, or produce a new piece of music (including 生成音乐 / 作曲 / 写歌 / 配乐 / 背景音乐), call `music_compose`;',
  'it opens the AI Music Workshop, composes the piece, saves the project and exports the requested format.',
  'Do not use it to change a piece already open in the workshop — use `music_read_track` / `music_edit_track` for edits.',
  'Unless the user names an export format, omit `export` so the workshop follows the user\'s last export choice.',
].join(' ')

/** Register the system-prompt guidance that makes "generate music" select the compose tool. */
export function installMusicComposeGuidance(systemPromptCtx) {
  return systemPromptCtx.systemPrompt.section({
    name: 'tool:music-compose',
    order: systemPromptCtx.systemPrompt.getSectionOrder('TOOL_SCHEDULE') + 1,
    text: MUSIC_COMPOSE_SECTION,
  })
}

export const MUSIC_TOOL_NAMES = Object.freeze([readTrackTool.name, editTrackTool.name, 'music_compose'])

/**
 * Register the music tools; returns the disposer for the injected `tools` scope.
 * @param options.enableCompose - register `music_compose` (the chat auto-generation entry).
 * @param options.config - resolved plugin Config (timeouts, enableEditing).
 * @param options.ctx - the plugin's root context (workspace resolution, LLM, persistence).
 * @param options.writeQueues - the Host's per-workspace write queues.
 */
export function installMusicTools(ctx, options = {}) {
  const tools = [readTrackTool, editTrackTool]
  if (options.enableCompose === true) tools.push(createComposeTool({
    config: options.config,
    ctx: options.ctx ?? ctx,
    enableCompose: true,
    writeQueues: options.writeQueues,
  }))
  const disposers = tools.map(tool => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers) dispose()
  }
}

