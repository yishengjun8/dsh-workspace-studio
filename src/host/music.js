/** Music workshop Host module: AI composition, score-file storage and listing.
 *
 * The score itself is pure data (src/shared/music-score.js); this module only turns an
 * optional LLM answer into that shape, and writes/reads the JSON files under the
 * workspace's music directory. Every path is workspace-confined through the same
 * primitives as the file API, and every write is serialized on the workspace queue so a
 * music save cannot interleave with a tree mutation.
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { HttpError } from './errors.js'
import { sessionModelOf } from './mindmap.js'
import { hasSymlinkComponent, isInside, normalizeEntryName, normalizeRelativePath } from './paths.js'
import { serializeWrite } from './write.js'
import {
  MUSIC_BARS_MAX,
  MUSIC_BARS_MIN,
  MUSIC_DEFAULT_DIR,
  MUSIC_DOC_MAX_BYTES,
  MUSIC_DOC_VERSION,
  MUSIC_FILE_SUFFIX,
  MUSIC_KEY_ROOTS,
  MUSIC_MOOD_IDS,
  MUSIC_STYLE_IDS,
  buildMusicPlan,
  composeMusicScore,
  musicNoteCount,
  normalizeMusicDoc,
  normalizeMusicInstruments,
  normalizeMusicSeamless,
} from '../shared/music-score.js'

const MUSIC_LLM_TIMEOUT_MS = 55_000
const MUSIC_LIST_MAX = 200
const MUSIC_LIST_SCAN_MAX = 4000
const MUSIC_PROMPT_MAX = 2000

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

function normalizeModel(value) {
  if (!isPlainObject(value)) return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return null
  if (provider.length > 200 || model.length > 300) return null
  return { provider, model }
}

/* One llm.stream consumed under a hard deadline: a stuck stream must not hold the
   request open past the client's timeout. Mirrors the mind-map summary consumer. */
async function consumeStream(llm, params, timeoutMs) {
  let output = ''
  const consume = (async () => {
    for await (const chunk of llm.stream(params)) {
      if (chunk === null || chunk === undefined) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
      if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) return null
    }
    return output
  })()
  let timer = 0
  const deadline = new Promise((done) => { timer = setTimeout(() => done(null), timeoutMs + 10_000) })
  try {
    return await Promise.race([consume, deadline])
  } finally {
    clearTimeout(timer)
  }
}

function systemPrompt(instruments, seamless, segment) {
  const hasDrums = instruments.includes('drums')
  const range = segment.totalBars > segment.bars
    ? `This is segment ${segment.index}/${segment.count}: absolute bars ${segment.startBar}-${segment.startBar + segment.bars - 1} of a ${segment.totalBars}-bar piece. Write LOCAL bar numbers 1-${segment.bars} only.`
    : `Write exactly ${segment.bars} bars.`
  return [
    'You are a music composer that returns ONLY a JSON score. No prose, no markdown fences.',
    'Schema: {"bpm":number,"keyRoot":"C".."B","keyMode":"major"|"minor","bars":number,',
    '"chordProgression":[string per bar],',
    '"tracks":[{"instrument":"piano","name":"optional","volume":0.8,"notes":[note]},',
    '{"instrument":"drums","drums":{"kick":[{step:velocity} per bar],"snare":[],"hat":[],"open":[],"clap":[],"perc":[]}}]}',
    'A note is {"bar":1-based,"step":0..15,"midi":number,"len":1..16,"vel":1..127}.',
    'Allowed instruments: piano, epiano, organ, harpsichord, harp, strumstick, psaltery, sax, recorder, glockenspiel, timpani, drums.',
    `Use EXACTLY these instruments, one track each: ${instruments.join(', ')}. Do not add, omit, or duplicate an instrument.`,
    hasDrums ? 'Include exactly one drums track. A drums track holds a step object per bar.' : 'Do not include a drums track.',
    instruments.length === 1 && hasDrums ? 'This request is a drums-only score.' : 'Write only the requested instrument tracks.',
    range,
    `Use these chord labels for this segment, one per local bar, in order: ${segment.chords.join(' | ')}.`,
    seamless
      ? 'This piece loops seamlessly: the last bar is a turnaround into bar 1, with no final cadence, no terminal crash and no ending fill.'
      : 'This segment ends normally; a final fill or cadence is allowed.',
    'Rules: piano/organ/harpsichord carry sustained chord tones; use the piano low register or timpani for roots;',
    'sax/recorder carry a singable melody inside the key; keep 1-4 notes sounding at once.',
    'Respect the requested style, mood, density and complexity. Output valid JSON only.',
  ].join(' ')
}

function extractJson(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Compose a score for the requested parameters. The LLM answer is validated into the
 * shared document shape; any failure (no llm service, provider error, unusable JSON,
 * empty note set) degrades to the deterministic template so the request never fails.
 */
export async function composeMusic(ctx, persistence, payload) {
  const totalBars = clampInt(payload?.totalBars, MUSIC_BARS_MIN, MUSIC_BARS_MAX, 8)
  const bars = clampInt(payload?.bars, 1, totalBars, totalBars)
  const startBar = clampInt(payload?.startBar, 1, Math.max(1, totalBars - bars + 1), 1)
  const style = MUSIC_STYLE_IDS.includes(payload?.style) ? payload.style : 'lofi'
  const keyRoot = MUSIC_KEY_ROOTS.includes(payload?.keyRoot) ? payload.keyRoot : undefined
  const keyMode = payload?.keyMode === 'minor' ? 'minor' : payload?.keyMode === 'major' ? 'major' : undefined
  const seamless = normalizeMusicSeamless(payload?.seamless)
  const plan = buildMusicPlan({ bars: totalBars, bpm: payload?.bpm, style, keyRoot, keyMode, seamless })
  const chordSlice = plan.progression.slice(startBar - 1, startBar - 1 + bars)
  const section = plan.sections.find(entry => entry.from <= startBar && entry.to >= startBar)?.name ?? ''
  const request = {
    prompt: typeof payload?.prompt === 'string' ? payload.prompt.trim().slice(0, MUSIC_PROMPT_MAX) : '',
    style,
    mood: MUSIC_MOOD_IDS.includes(payload?.mood) ? payload.mood : 'lazy',
    bars,
    bpm: plan.bpm,
    keyRoot: plan.keyRoot,
    keyMode: plan.keyMode,
    density: clampFloat(payload?.density, 0, 1, 0.55),
    complexity: clampFloat(payload?.complexity, 0, 1, 0.5),
    swing: clampFloat(payload?.swing, 0, 0.75, 0.3),
    humanize: clampFloat(payload?.humanize, 0, 0.5, 0.08),
    instruments: normalizeMusicInstruments(payload?.instruments),
    seamless,
    seed: Number.isFinite(payload?.seed) ? Math.floor(payload.seed) : Date.now(),
  }
  const template = (warning) => ({
    doc: composeMusicScore({ ...request, chordProgression: chordSlice }),
    engine: 'template',
    ...(warning === undefined ? {} : { warning }),
  })

  /* The model choice is either a fixed route or "follow the chat": the latter resolves the
     chat session's current route on the Host, so a switch in the composer is picked up without
     the client having to send a provider/model pair (same rule as the mind-map summaries). */
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim().slice(0, 300) : ''
  const followSession = payload?.model === null || payload?.model === undefined
    || (isPlainObject(payload.model) && payload.model.mode === 'session')
  let model = followSession ? null : normalizeModel(payload?.model)
  let modelWarning
  if (followSession && sessionId !== '') {
    try {
      model = await sessionModelOf(ctx, persistence, sessionId)
    } catch {
      model = null
    }
    if (model === null) modelWarning = 'session-model-unavailable'
  }
  if (model === null) return template(modelWarning)
  let llm
  try {
    llm = ctx.get('llm')
  } catch {
    return template('llm-unavailable')
  }
  if (llm === null || llm === undefined || typeof llm.stream !== 'function') return template('llm-unavailable')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MUSIC_LLM_TIMEOUT_MS)
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const userText = [
    `style: ${request.style}`,
    `mood: ${request.mood}`,
    `bars: ${request.bars}`,
    `absolute bar range: ${startBar}-${startBar + bars - 1} of ${totalBars}`,
    `section: ${section === '' ? 'continuation' : section}`,
    `chords: ${chordSlice.join(' | ')}`,
    `seamless loop: ${request.seamless ? 'yes' : 'no'}`,
    `density: ${request.density}`,
    `complexity: ${request.complexity}`,
    `instruments: ${request.instruments.join(', ')}`,
    `bpm: ${request.bpm}`,
    `key: ${request.keyRoot} ${request.keyMode}`,
    request.prompt === '' ? 'description: an instrumental sketch' : `description: ${request.prompt}`,
  ].join('\n')
  let output
  try {
    output = await consumeStream(llm, {
      provider: model.provider,
      model: model.model,
      messages: [
        { id: `music-${stamp}-s`, role: 'system', content: [{ type: 'text', text: systemPrompt(request.instruments, request.seamless, { bars, chords: chordSlice, count: clampInt(payload?.segmentCount, 1, 16, 1), index: clampInt(payload?.segmentIndex, 1, 16, 1), startBar, totalBars }) }], source: { kind: 'plugin', plugin: 'workspace-studio' } },
        { id: `music-${stamp}-u`, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'plugin', plugin: 'workspace-studio' } },
      ],
      maxTokens: 6000,
      signal: controller.signal,
    }, MUSIC_LLM_TIMEOUT_MS)
  } catch {
    output = null
  } finally {
    clearTimeout(timer)
  }
  const parsed = extractJson(output)
  if (parsed === null) return template('llm-invalid')
  const doc = normalizeMusicDoc({
    ...parsed,
    version: MUSIC_DOC_VERSION,
    title: undefined,
    keyRoot: request.keyRoot,
    keyMode: request.keyMode,
    prompt: { text: request.prompt, style: request.style, mood: request.mood, density: request.density, complexity: request.complexity, instruments: request.instruments, seamless: request.seamless },
  })
  if (doc === null) return template('llm-invalid')
  const noteCount = musicNoteCount(doc)
  if (noteCount === 0) return template('llm-empty')
  /* The user picked an exact instrumentation; accept the model only when every selected
     instrument appears exactly once and nothing else is present. */
  const expected = new Set(request.instruments)
  const actual = doc.tracks.map(track => track.instrument)
  if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(id => !expected.has(id))) {
    return template('llm-instrument-mismatch')
  }
  /* Keep the requested framing even when the model picked its own tempo/key. Re-normalising
     after the override drops notes the model wrote past the requested last bar and keeps every
     stored value inside the shared schema. */
  const forced = normalizeMusicDoc({
    ...doc,
    bars: request.bars,
    bpm: request.bpm,
    keyRoot: request.keyRoot,
    keyMode: request.keyMode,
    swing: request.swing,
    humanize: request.humanize,
    tracks: doc.tracks.map(track => (track.kind === 'drums'
      ? { ...track, drums: Object.fromEntries(Object.entries(track.drums).map(([lane, bars]) => [lane, bars.slice(0, request.bars)])) }
      : { ...track, notes: track.notes.filter(note => note.bar <= request.bars) })),
    chordProgression: chordSlice,
    prompt: { text: request.prompt, style: request.style, mood: request.mood, density: request.density, complexity: request.complexity, instruments: request.instruments, seamless: request.seamless },
  })
  if (forced === null) return template('llm-invalid')
  return { doc: forced, engine: 'llm', model }
}

function musicFileName(value, config, fallbackTitle) {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallbackTitle
  let name = normalizeEntryName(raw, config.maxEntryNameBytes)
  if (!name.toLowerCase().endsWith(MUSIC_FILE_SUFFIX)) name = `${name}${MUSIC_FILE_SUFFIX}`
  /* The suffix may push a name over the Host's own byte cap: refuse rather than write an
     over-long name the file tree cannot render. */
  if (Buffer.byteLength(name, 'utf8') > config.maxEntryNameBytes) {
    throw new HttpError(413, 'entry-name-too-large', `文件名不能超过 ${config.maxEntryNameBytes} 字节`)
  }
  return name
}

async function writeScoreFile(root, relativePath, doc) {
  const dir = dirname(relativePath)
  const dirPart = dir === '.' ? '' : dir
  const dirAbs = dirPart === '' ? root : resolve(root, ...dirPart.split('/'))
  if (!isInside(root, dirAbs)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
  await mkdir(dirAbs, { recursive: true })
  const realDir = await realpath(dirAbs)
  if (!isInside(root, realDir)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
  if (dirPart !== '' && await hasSymlinkComponent(root, dirPart)) {
    throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
  }
  const target = resolve(root, ...relativePath.split('/'))
  let existing = null
  try {
    existing = await lstat(target)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (existing !== null && existing.isSymbolicLink()) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
  const bytes = Buffer.from(JSON.stringify(doc, null, 2), 'utf8')
  if (bytes.byteLength > MUSIC_DOC_MAX_BYTES) {
    throw new HttpError(413, 'music-doc-too-large', `乐谱文件不能超过 ${MUSIC_DOC_MAX_BYTES} 字节`)
  }
  if (await hasSymlinkComponent(root, dir === '' || dir === '.' ? dirname(relativePath) : dir)) {
    throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
  }
  const temp = resolve(realDir, `.${randomBytes(12).toString('hex')}.dsh-music.tmp`)
  try {
    const { open } = await import('node:fs/promises')
    const handle = await open(temp, 'wx', 0o644)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (dirPart !== '' && await hasSymlinkComponent(root, dirPart)) {
      throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
    }
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  const info = await stat(target)
  return { size: info.size, mtimeMs: info.mtimeMs }
}

/** Save (create or overwrite) one score file under the workspace music directory. */
export async function saveMusicDoc(workspace, config, queues, payload) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  const doc = normalizeMusicDoc(payload?.doc)
  if (doc === null) throw new HttpError(400, 'invalid-music-doc', '乐谱内容无效')
  const dirInput = typeof payload?.dir === 'string' && payload.dir.trim() !== '' ? payload.dir.trim() : MUSIC_DEFAULT_DIR
  const dir = normalizeRelativePath(dirInput)
  const name = musicFileName(payload?.name, config, doc.title)
  const relativePath = dir === '' ? name : `${dir}/${name}`
  const saved = { ...doc, updatedAt: Date.now() }
  return serializeWrite(queues, `workspace:${String(workspace.id)}`, async () => {
    const root = await realpath(workspace.path)
    const written = await writeScoreFile(root, relativePath, saved)
    return { path: relativePath, name, size: written.size, mtimeMs: written.mtimeMs, savedAt: saved.updatedAt, doc: saved }
  })
}

/** Read one score file back (the panel's 「打开」 path). */
export async function loadMusicDoc(workspace, payload) {
  const relativePath = normalizeRelativePath(payload?.path)
  if (!relativePath.toLowerCase().endsWith(MUSIC_FILE_SUFFIX)) {
    throw new HttpError(400, 'invalid-music-path', '只能打开乐谱文件')
  }
  const root = await realpath(workspace.path)
  const target = await realpath(resolve(root, ...relativePath.split('/')))
  if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝访问工作区之外的路径')
  const info = await lstat(target)
  if (!info.isFile()) throw new HttpError(400, 'not-a-file', '不是可读取的乐谱文件')
  if (info.size > MUSIC_DOC_MAX_BYTES) throw new HttpError(413, 'music-doc-too-large', '乐谱文件过大')
  let parsed
  try {
    parsed = JSON.parse(await readFile(target, 'utf8'))
  } catch {
    throw new HttpError(422, 'invalid-music-doc', '乐谱文件不是有效的 JSON')
  }
  const doc = normalizeMusicDoc(parsed)
  if (doc === null) throw new HttpError(422, 'invalid-music-doc', '乐谱文件内容无效')
  return { exists: true, path: relativePath, doc }
}

/** List score files in one workspace directory (default: music/). */
export async function listMusicDocs(workspace, payload) {
  const dirInput = typeof payload?.dir === 'string' && payload.dir.trim() !== '' ? payload.dir.trim() : MUSIC_DEFAULT_DIR
  const dir = normalizeRelativePath(dirInput)
  const root = await realpath(workspace.path)
  const dirAbs = resolve(root, ...(dir === '' ? ['.'] : dir.split('/')))
  let realDir
  try {
    realDir = await realpath(dirAbs)
  } catch {
    return { dir, files: [] }
  }
  if (!isInside(root, realDir)) throw new HttpError(403, 'path-outside-workspace', '拒绝访问工作区之外的路径')
  const entries = await readdir(realDir, { withFileTypes: true })
  const files = []
  let scanned = 0
  for (const entry of entries) {
    if (scanned >= MUSIC_LIST_SCAN_MAX || files.length >= MUSIC_LIST_MAX) break
    scanned += 1
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(MUSIC_FILE_SUFFIX)) continue
    const relativePath = dir === '' ? entry.name : `${dir}/${entry.name}`
    try {
      const info = await stat(resolve(realDir, entry.name))
      files.push({ path: relativePath, name: entry.name, size: info.size, mtimeMs: info.mtimeMs })
    } catch {
      /* A file that vanished between readdir and stat simply is not listed. */
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { dir, files }
}



