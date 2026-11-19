/* The input dock's two context pills (editor file context / music workshop) and their
 * per-session on/off choice.
 *
 * Two different lifetimes live in two different places, on purpose:
 *   - the ENVELOPE describes what is open right now (`<opened_file>` / `<selection>` /
 *     `<music_piece>`), so it stays page memory and must not outlive a reload;
 *   - the CHOICE is the user's, so it is mirrored into localStorage under a format-versioned key
 *     and re-applied from the mount gate — a reload must not silently switch a pill back on.
 *
 * Only the OFF sessions are stored ("on" is the default), one id list per pill kind. The stored
 * lists are capped by CONTEXT_SWITCH_SESSION_MAX with writes appending, so the cap drops the
 * oldest toggles; a stale id is bounded rather than removed because pruning it would need the
 * live session set, which the mount gate does not have.
 *
 * This module is a LEAF (constants only) so it can sit below both `music-context.js` and
 * `controllers.js` without inverting the client module layering. The persisted shape lives here
 * and is registered in persisted-state.js, the same split as preview-tabs.js' normalizers: the
 * shape has one implementation, `readPersistedState()` stays the consumers' only read gateway.
 *
 * Writes happen only on a user toggle, and read-merge-write ONE flag: starting from what is on
 * disk keeps a concurrent GUI tab's entries alive. Web Locks serialize that read+write across
 * tabs (same pattern as the mind-map maps); without the API the write still happens. Live
 * cross-tab sync is deliberately not implemented — a reload applies what is on disk.
 */
import { CONTEXT_SWITCH_SESSION_MAX, CONTEXT_SWITCH_STORE_KEY } from './constants.js'

/* The two pill kinds, which are also the stored top-level keys. */
const KINDS = Object.freeze(['editor', 'music'])
/* A session id is opaque here; the bound only keeps a pathological value out of the merge. */
const SESSION_ID_MAX_LENGTH = 256
const SWITCH_STORE_LOCK = 'dsh-workspace-studio:context-switches'

/* Module-level state belongs to this module alone (client-split-plan): every other module reads
   and writes it through the exported functions. The sets hold sessions whose pill is OFF. */
const offSessions = { editor: new Set(), music: new Set() }

const kindSet = kind => (KINDS.includes(kind) ? offSessions[kind] : null)

function isUsableSessionId(value) {
  return typeof value === 'string' && value !== '' && value.length <= SESSION_ID_MAX_LENGTH
}

/** Canonical stored shape, or null when the top level is unusable (the gate then drops the key). */
export function normalizeContextSwitches(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const canonical = {}
  for (const kind of KINDS) {
    const raw = value[kind]
    canonical[kind] = Array.isArray(raw)
      ? [...new Set(raw.filter(isUsableSessionId))].slice(-CONTEXT_SWITCH_SESSION_MAX)
      : []
  }
  return canonical
}

/** Rebuild the in-memory sets from the canonical value `readPersistedState()` handed over. */
export function hydrateContextSwitches(stored) {
  const canonical = normalizeContextSwitches(stored) ?? { editor: [], music: [] }
  for (const kind of KINDS) offSessions[kind] = new Set(canonical[kind])
}

/** Whether this session's pill of `kind` is switched off (false for an unknown kind). */
export function isContextSwitchOff(kind, sessionId) {
  const set = kindSet(kind)
  return set !== null && set.has(String(sessionId))
}

/** Switch one session's pill and mirror the choice to storage (a no-op when nothing changed). */
export function setContextSwitchOff(kind, sessionId, off) {
  const set = kindSet(kind)
  const id = String(sessionId)
  if (set === null || id === '') return
  const next = off === true
  if (set.has(id) === next) return
  if (next) set.add(id)
  else set.delete(id)
  mergeStoredSwitch(kind, id, next)
}

/* Drop choices of sessions that no longer exist — MEMORY ONLY. The harness session list is
   filtered (archived rows and friends), so "absent from the list" is not proof that a session is
   gone; wiping the stored entry here would silently re-enable that pill after a refresh. Stale
   stored ids are bounded by the cap instead. */
export function pruneContextSwitches(kind, sessionIds) {
  const set = kindSet(kind)
  if (set === null) return
  const live = new Set((Array.isArray(sessionIds) ? sessionIds : []).map(String))
  for (const id of set) if (!live.has(id)) set.delete(id)
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    /* Private mode / blocked storage: the choice still holds for this page. */
    return undefined
  }
}

function readStoredSwitches() {
  const target = storage()
  if (target === undefined) return null
  try {
    const raw = target.getItem(CONTEXT_SWITCH_STORE_KEY)
    return raw === null ? null : normalizeContextSwitches(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeStoredSwitch(kind, sessionId, off) {
  const target = storage()
  if (target === undefined) return
  try {
    const current = readStoredSwitches() ?? { editor: [], music: [] }
    const ids = new Set(current[kind])
    if (off) ids.add(sessionId)
    else ids.delete(sessionId)
    const merged = normalizeContextSwitches({ ...current, [kind]: [...ids] })
    if (merged === null) return
    target.setItem(CONTEXT_SWITCH_STORE_KEY, JSON.stringify(merged))
  } catch { /* quota / private mode: the in-memory choice still holds for this page */ }
}

function mergeStoredSwitch(kind, sessionId, off) {
  const write = () => { writeStoredSwitch(kind, sessionId, off) }
  /* Web Locks serialize the read+write across GUI tabs; without the API the write still happens. */
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    void navigator.locks.request(SWITCH_STORE_LOCK, write).catch(write)
    return
  }
  write()
}
