/* Executable-file detection + run-console text helpers.
 *
 * Pure functions only (no React, no API): the extension whitelist is the SHARED table the Host also
 * resolves against (src/shared/run-extensions.js), so the UI's "offer a console" decision and the
 * Host's resolver cannot drift; the state mapper turns one Host status payload into the console's
 * visual state, the chunk accumulator turns streamed stdout/stderr bytes into the rendered line list,
 * and both are testable here without a DOM or a Host.
 */
import { RUN_OUTPUT_LINE_MAX } from './constants.js'
import { translate } from './locale/index.js'
import { RUN_FAMILY_BY_EXTENSION, runFamilyOfName } from '../shared/run-extensions.js'

/** Whether a preview tab may show the run console (extension whitelist only; the Host additionally
 *  applies platform support, the POSIX executable bit and interpreter resolution). */
export function isRunnableName(name) {
  return runFamilyOfName(name) !== null
}

/** The client-side basename of a Host path (either separator, no filesystem access). */
export function pathBasename(value) {
  const text = String(value ?? '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return index < 0 ? text : text.slice(index + 1)
}

/** Where the resolved interpreter came from: 'file' | 'extension' | 'family' | 'auto' | 'direct'.
 *  Wire compatibility with a Host that has not been restarted yet: such a build only reports
 *  `interpreterOverride` (never `interpreterSource`) and may still resolve the retired per-family
 *  tier, so both are still understood here. No client code writes or stores such a tier. */
export function runInterpreterSourceOf(plan) {
  if (plan === null || plan === undefined) return null
  if (typeof plan.interpreterSource === 'string' && plan.interpreterSource !== '') return plan.interpreterSource
  if (plan.supported === true) return plan.interpreterOverride === true ? 'family' : 'auto'
  return null
}

/** The name the console's interpreter button shows: the recipe's short name for auto-detection, the
 *  path's basename for an override (the full path lives in the button's tooltip). */
export function runInterpreterLabel(plan, entry) {
  const name = plan?.interpreterName
  if (typeof name === 'string' && name !== '') return name
  const fallback = typeof plan?.interpreter === 'string' && plan.interpreter !== ''
    ? plan.interpreter
    : (typeof entry?.interpreter === 'string' ? entry.interpreter : '')
  return fallback === '' ? '' : pathBasename(fallback)
}

/** The highest-priority tier whose stored path is no longer executable, or null.
 *  Reported so the console can say WHICH setting stopped working instead of silently ignoring it. */
export function runStaleOverrideOf(plan) {
  const scope = plan?.interpreterStaleScope
  if (typeof scope !== 'string' || scope === '') return null
  return { scope, path: typeof plan?.interpreterStalePath === 'string' ? plan.interpreterStalePath : '' }
}

/** Extensions sharing one command family — the dialog's 「同时应用」 target list. Empty for
 *  `direct` (`.exe`/`.com` run the file itself, so they have no interpreter to share). */
export function runSiblingExtensions(ext) {
  const key = String(ext ?? '').toLowerCase()
  const family = RUN_FAMILY_BY_EXTENSION[key]
  if (family === undefined || family === 'direct') return []
  return Object.keys(RUN_FAMILY_BY_EXTENSION).filter(candidate => candidate !== key && RUN_FAMILY_BY_EXTENSION[candidate] === family)
}

/** Whether the console may offer an interpreter override for this plan at all: a directly executed
 *  file has no interpreter to point elsewhere, and anything outside the whitelist has no console. */
export function runInterpreterEditable(plan) {
  if (plan === null || plan === undefined) return false
  if (plan.runnable === false) return false
  return runInterpreterSourceOf(plan) !== 'direct' && plan.kind !== 'direct'
}

/* Localized name of one resolution tier. The per-extension tier names the suffix it came from, so a
   button reading 「全局 .py 指定」 cannot be mistaken for any other suffix's setting. 'family' is
   only reachable through a not-yet-restarted Host (see runInterpreterSourceOf). */
const INTERPRETER_SOURCE_KEYS = Object.freeze({
  auto: 'run.interp.source.auto',
  file: 'run.interp.source.file',
  extension: 'run.interp.source.extension',
  family: 'run.interp.source.family',
  direct: 'run.interp.source.direct',
})

export function runInterpreterSourceLabel(source, ext) {
  const key = INTERPRETER_SOURCE_KEYS[source]
  if (key === undefined) return translate('run.interp.source.unknown')
  if (source === 'extension') return translate(key, { ext: `.${String(ext ?? '')}` })
  return translate(key)
}

/** The console's visual state from one status payload (or its absence). */
export function runStateOf(entry) {
  if (entry === undefined || entry === null) return 'idle'
  if (entry.plan !== undefined && entry.plan !== null && entry.plan.runnable === true && entry.plan.supported === false) return 'nointerpreter'
  if (entry.status === 'running') return entry.stopping === true ? 'stopping' : 'running'
  if (entry.status === 'error') {
    return entry.errorCode === 'interpreter-not-found' ? 'nointerpreter' : 'error'
  }
  if (entry.status === 'killed') return 'killed'
  if (entry.status === 'exited') return entry.code === 0 ? 'ok' : 'fail'
  return 'idle'
}

/** Chip tone per state: business = live, success = clean exit, error = failure, warn = cannot run. */
export function runChipTone(state) {
  if (state === 'running' || state === 'stopping') return 'run'
  if (state === 'ok') return 'ok'
  if (state === 'fail' || state === 'error') return 'err'
  if (state === 'killed' || state === 'nointerpreter') return 'warn'
  return 'idle'
}

/* Locale key suffix per state; the panel composes `run.chip.*` / `run.hint.*` from it. */
function runStateKey(state) {
  if (state === 'stopping') return 'stopping'
  if (state === 'running') return 'running'
  if (state === 'ok') return 'exitedOk'
  if (state === 'fail') return 'exitedFail'
  if (state === 'killed') return 'killed'
  if (state === 'error') return 'error'
  if (state === 'nointerpreter') return 'unavailable'
  return 'idle'
}

/** Human duration for the console's chips and exit line: sub-minute keeps two decimals. */
export function formatRunDuration(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 60_000) return `${(value / 1000).toFixed(2)}s`
  const totalSeconds = Math.round(value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/** Empty console buffer for one file. */
export function emptyRunBuffer() {
  return { lines: [], pendingStdout: '', pendingStderr: '', droppedLines: 0 }
}

/** Fold one status payload's chunks into the console buffer, returning a NEW buffer.
 *
 *  Chunks arrive per poll and may split a line anywhere (and interleave stdout/stderr), so each
 *  stream keeps its own unfinished tail. The line list is a tail: past RUN_OUTPUT_LINE_MAX the
 *  oldest lines are dropped and counted, and the panel renders one "…省略" marker for them. */
export function appendRunChunks(buffer, chunks) {
  const current = buffer ?? emptyRunBuffer()
  if (!Array.isArray(chunks) || chunks.length === 0) return current
  let pendingStdout = current.pendingStdout ?? ''
  let pendingStderr = current.pendingStderr ?? ''
  const appended = []
  for (const chunk of chunks) {
    const text = typeof chunk?.t === 'string' ? chunk.t : ''
    if (text === '') continue
    const stream = chunk.s === 'e' ? 'stderr' : 'stdout'
    const merged = (stream === 'stderr' ? pendingStderr : pendingStdout) + text
    const parts = merged.split('\n')
    /* The last part is the unfinished line (or '' when the chunk ended exactly on a newline). */
    const tail = parts.pop() ?? ''
    if (stream === 'stderr') pendingStderr = tail
    else pendingStdout = tail
    for (const part of parts) appended.push({ s: stream, t: part.replace(/\r$/, '') })
  }
  if (appended.length === 0) {
    if (pendingStdout === current.pendingStdout && pendingStderr === current.pendingStderr) return current
    return { ...current, pendingStdout, pendingStderr }
  }
  const lines = [...(current.lines ?? []), ...appended]
  let droppedLines = current.droppedLines ?? 0
  if (lines.length > RUN_OUTPUT_LINE_MAX) {
    const excess = lines.length - RUN_OUTPUT_LINE_MAX
    droppedLines += excess
    lines.splice(0, excess)
  }
  return { lines, pendingStdout, pendingStderr, droppedLines }
}

/** The console's full plain text (copy button): unfinished tails included, and the dropped-line
 *  marker when the caller passes its localized label. */
export function runBufferText(buffer, omittedLabel) {
  const current = buffer ?? emptyRunBuffer()
  const parts = []
  if ((current.droppedLines ?? 0) > 0 && typeof omittedLabel === 'string' && omittedLabel !== '') parts.push(omittedLabel)
  for (const line of current.lines ?? []) parts.push(`${line.s === 'stderr' ? '[stderr] ' : ''}${line.t}`)
  if ((current.pendingStdout ?? '') !== '') parts.push(current.pendingStdout)
  if ((current.pendingStderr ?? '') !== '') parts.push(`[stderr] ${current.pendingStderr}`)
  return parts.join('\n')
}
