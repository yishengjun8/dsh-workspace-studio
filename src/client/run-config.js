/* Interpreter configuration store.
 *
 * Owns everything about WHICH interpreter a runnable file will use:
 *   - the resolved per-extension table (what each suffix resolves to right now), which the settings
 *     page renders;
 *   - the Host policy maps (global per-extension + per-file overrides), which the settings page and
 *     the console's dialog both read and write.
 *
 * The Host-side policy file is the single source of truth (both ends share it, so a refresh is a
 * re-read rather than a restore), and this module is a cache with a version counter. The console's
 * per-file RUN state lives in run-store.js; the two modules never import each other — components
 * compose them (a successful override write here is followed by run-store's reloadRunPath there).
 */
import { useSyncExternalStore } from 'react'
import { fetchRunInterpreters, fetchRunPolicy, probeRunInterpreter, setRunPolicy } from './api.js'
import { runSiblingExtensions } from './run-detect.js'

const EMPTY_POLICY = Object.freeze({ extensions: Object.freeze({}), files: Object.freeze({}) })

const listeners = new Set()
let version = 0
let state = {
  status: 'idle', // idle | loading | ready | error
  error: null,
  platform: '',
  rows: [],
  policy: EMPTY_POLICY,
  refreshing: false,
  writing: false,
  notice: undefined,
}
let inflight = null

function bump() {
  version += 1
  for (const listener of listeners) listener()
}

function update(patch) {
  const next = { ...state, ...patch }
  state = next
  bump()
}

export function subscribeRunConfig(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot() {
  return state
}

export function getRunConfig() {
  return state
}

/** Subscribe to the whole configuration snapshot (rows + policy + write state). */
export function useRunConfig() {
  return useSyncExternalStore(subscribeRunConfig, getSnapshot, getSnapshot)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function messageOf(error, fallback) {
  const message = error?.message
  if (typeof message === 'string' && message !== '') return message
  return fallback ?? ''
}

function policySnapshot(payload) {
  const source = isObject(payload) ? payload : {}
  return {
    extensions: isObject(source.extensions) ? source.extensions : {},
    files: isObject(source.files) ? source.files : {},
  }
}

/** Load the resolved table and the policy together. `refresh` also clears the Host's PATH cache, so
 *  「重新检测」 answers with what is installed NOW instead of a stale search result. */
function load(refresh) {
  if (inflight !== null) return inflight
  update({ status: state.status === 'ready' ? 'ready' : 'loading', refreshing: true, error: null })
  inflight = (async () => {
    try {
      const [table, policy] = await Promise.all([
        fetchRunInterpreters(refresh === true),
        fetchRunPolicy(null),
      ])
      update({
        status: 'ready',
        error: null,
        refreshing: false,
        platform: typeof table?.platform === 'string' ? table.platform : '',
        rows: Array.isArray(table?.extensions) ? table.extensions : [],
        policy: policySnapshot(policy),
      })
    } catch (error) {
      update({ status: 'error', error: messageOf(error), refreshing: false })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Load once (idempotent): every consumer calls this on mount instead of coordinating a refresh. */
export function focusRunConfig() {
  if (state.status === 'ready' && inflight === null) return Promise.resolve()
  return load(false)
}

/** Re-detect after an install (or after a write that changed what resolves). */
export function refreshRunConfig() {
  return load(true)
}

/** One policy write, with the shared bookkeeping: refresh the resolved table afterwards (the table
 *  depends on the policy) and surface a failure as an inline notice instead of a thrown error, so
 *  both call sites can stay declarative. */
async function writePolicy(payload, workspaceId) {
  update({ writing: true, notice: undefined })
  try {
    const result = await setRunPolicy(workspaceId ?? null, payload)
    update({ writing: false, policy: policySnapshot(result) })
    void load(true)
    return { ok: true }
  } catch (error) {
    const text = messageOf(error)
    update({ writing: false, notice: { error: true, text } })
    return { ok: false, error: text }
  }
}

/** Save (or clear, with an empty value) one extension's global interpreter. */
export function saveExtensionInterpreter(ext, value, alsoSiblings) {
  const key = String(ext ?? '').toLowerCase()
  if (key === '') return Promise.resolve({ ok: false, error: '' })
  const text = String(value ?? '')
  const extensions = { [key]: text }
  if (alsoSiblings === true && text !== '') {
    for (const sibling of runSiblingExtensions(key)) extensions[sibling] = text
  }
  return writePolicy({ extensions })
}

/** Save (or clear) the interpreter of ONE file, optionally pushing the same value to the global
 *  per-extension map at the same time (the dialog's 「同时设为全局」 box). */
export function saveFileInterpreter(fileKey, value, options = {}) {
  const key = String(fileKey ?? '')
  if (key === '') return Promise.resolve({ ok: false, error: '' })
  const text = String(value ?? '')
  const payload = { files: { [key]: text } }
  if (options.alsoGlobal === true && typeof options.ext === 'string' && options.ext !== '') {
    payload.extensions = { [options.ext]: text }
  }
  return writePolicy(payload)
}

export function clearFileInterpreter(fileKey) {
  return saveFileInterpreter(fileKey, '')
}

/** Drop every per-file override (the settings page's 「清除全部」). */
export function clearAllFileInterpreters() {
  const keys = Object.keys(state.policy.files ?? {})
  if (keys.length === 0) return Promise.resolve({ ok: true })
  const files = {}
  for (const key of keys) files[key] = ''
  return writePolicy({ files })
}

/** Back to auto-detection everywhere: every stored extension override. */
export function resetAllInterpreters() {
  const extensions = {}
  for (const key of Object.keys(state.policy.extensions ?? {})) extensions[key] = ''
  if (Object.keys(extensions).length === 0) return Promise.resolve({ ok: true })
  return writePolicy({ extensions })
}

/** One version probe (`<path> --version`), for the dialogs' 「测试」 button. Never throws: the dialog
 *  renders either the version line or the reason inline. */
export async function probeInterpreter(path, family) {
  try {
    const result = await probeRunInterpreter(path, family)
    return {
      ok: result?.ok === true,
      output: typeof result?.output === 'string' ? result.output : '',
      durationMs: Number.isFinite(result?.durationMs) ? result.durationMs : null,
      timedOut: result?.timedOut === true,
    }
  } catch (error) {
    return { ok: false, output: '', durationMs: null, error: messageOf(error) }
  }
}

export function dismissRunConfigNotice() {
  update({ notice: undefined })
}

/** The per-file overrides as a stable, display-ready list (keys are absolute file paths). */
export function runConfigFileOverrides(snapshot) {
  const files = snapshot?.policy?.files ?? {}
  return Object.keys(files).sort().map(key => ({ key, interpreter: files[key] }))
}

/** One extension's row from the resolved table, or undefined. */
export function runConfigRowOf(snapshot, ext) {
  const key = String(ext ?? '').toLowerCase()
  const rows = snapshot?.rows
  if (!Array.isArray(rows)) return undefined
  return rows.find(row => row?.ext === key)
}
