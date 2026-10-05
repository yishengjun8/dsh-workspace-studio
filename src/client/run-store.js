/* Executable-file run console store.
 *
 * One module-level entry per workspace path, so three things stay true at once:
 *   - the console keeps its output when the user switches preview tabs (and comes back);
 *   - the tab badge can say "this other file is still running" without a second poll loop;
 *   - a page refresh re-attaches to whatever the Host is still running, because the entry is
 *     rebuilt from the Host's own record instead of from client state.
 *
 * The Host owns the process and a bounded output ring buffer; this store owns the *rendered* tail
 * (line list) plus the poll cursor. Nothing here is persisted: a refresh is a re-attach, not a
 * restore, and the Host is the single source of truth for every run.
 *
 * Components subscribe per PATH (useRunEntry) or globally (useRunVersion, the tab strip). The
 * per-path subscription is what keeps the 400 ms poll cheap: only the console of the path that
 * changed re-renders, instead of every consumer in the layout on every tick.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { RUN_FOLLOW_DEFAULT, RUN_POLL_MS } from './constants.js'
import { appendRunChunks, emptyRunBuffer } from './run-detect.js'
import { fetchRunPlan, fetchRunPolicy, fetchRunStatus, setRunPolicy, startRunRequest, stopRunRequest } from './api.js'
import { shouldSkipPoll } from './poll-gate.js'

const entries = new Map()
/* Global subscribers: the tab strip's badge row, which must react to ANY path's status. */
const listeners = new Set()
/* Per-path subscribers and their published snapshot. The entry object is MUTATED in place by
   setEntry's shallow copy semantics on the poll path, so React cannot compare it by identity: each
   publish replaces a tiny wrapper object instead, which is the value useSyncExternalStore sees. */
const pathListeners = new Map()
const pathSnapshots = new Map()
const inflight = new Set()
let version = 0
let timer = null

function bump(path) {
  version += 1
  pathSnapshots.set(path, { entry: entries.get(path) })
  const perPath = pathListeners.get(path)
  if (perPath !== undefined) for (const listener of [...perPath]) listener()
  for (const listener of [...listeners]) listener()
}

function subscribeRunStore(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function subscribeRunPath(path, listener) {
  let set = pathListeners.get(path)
  if (set === undefined) {
    set = new Set()
    pathListeners.set(path, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) {
      pathListeners.delete(path)
      pathSnapshots.delete(path)
    }
  }
}

function getVersion() {
  return version
}

export function getRunEntry(path) {
  return path === null || path === undefined ? undefined : entries.get(path)
}

/** The console's entry for one path (undefined until something loads it): re-renders only when THIS
 *  path changes, which is what keeps a running process's 400 ms poll from re-rendering the layout. */
export function useRunEntry(path) {
  const subscribe = useCallback(listener => subscribeRunPath(path, listener), [path])
  const getSnapshot = useCallback(() => {
    /* A consumer may mount after the entry was created (or after the last subscriber's cleanup
       dropped the snapshot): materialize it from the live entry rather than reporting undefined. */
    let snapshot = pathSnapshots.get(path)
    if (snapshot === undefined) {
      snapshot = { entry: entries.get(path) }
      pathSnapshots.set(path, snapshot)
    }
    return snapshot
  }, [path])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)?.entry
}

/** Version-only subscription for consumers that read MANY paths at once (the tab strip): one
 *  subscription re-renders the strip, and each row resolves its own entry without a hook. */
export function useRunVersion() {
  return useSyncExternalStore(subscribeRunStore, getVersion, getVersion)
}

function blankEntry(path) {
  return {
    path,
    workspaceId: null,
    plan: null,
    planState: 'idle',
    planError: null,
    policyLoaded: false,
    trusted: false,
    status: undefined,
    stopping: false,
    runId: null,
    code: null,
    errorCode: null,
    errorMessage: null,
    errorCandidates: null,
    command: '',
    cwdRelative: '',
    interpreter: null,
    startedAt: null,
    settledAt: null,
    durationMs: null,
    buffer: emptyRunBuffer(),
    offset: 0,
    totalLength: 0,
    truncated: false,
    exists: false,
    busy: false,
    notice: undefined,
    /* Per-path UI state, memory only (never persisted): a collapsed console stays collapsed while
       the page lives, and the dragged height is a pixel value, not a ratio, so the split holds. */
    collapsed: false,
    panelPx: null,
    follow: RUN_FOLLOW_DEFAULT,
    argsText: '',
  }
}

function setEntry(path, patch) {
  if (path === null || path === undefined) return
  const current = entries.get(path) ?? blankEntry(path)
  const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch }
  if (next === current) return
  entries.set(path, next)
  bump(path)
}

function messageOf(error, fallbackKey) {
  const message = error?.message
  if (typeof message === 'string' && message !== '') return message
  return fallbackKey ?? ''
}

/* ---- polling driver: alive while a run is live OR while it still has undelivered output ---- */

/* The tail matters: a fast, chatty process can settle on a poll whose slice was capped, and if the
   driver stopped right there the console would keep a truncated output forever. `offset < totalLength`
   keeps the loop running until the Host's buffer is drained, terminal status or not. */
function needsPolling(entry) {
  return entry.status === 'running' || entry.offset < (entry.totalLength ?? 0)
}

function ensureTimer() {
  let live = false
  for (const entry of entries.values()) {
    if (needsPolling(entry)) { live = true; break }
  }
  if (live && timer === null) timer = setInterval(() => {
    if (shouldSkipPoll()) return
    tick()
  }, RUN_POLL_MS)
  if (!live && timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function tick() {
  for (const entry of entries.values()) {
    if (!needsPolling(entry)) continue
    void pollStatus(entry.path, entry.workspaceId)
  }
}

/** Fetch the slice past this entry's cursor and fold it into the console. */
async function pollStatus(path, workspaceId) {
  if (workspaceId === null || workspaceId === undefined) return
  if (inflight.has(path)) return
  const entry = entries.get(path)
  if (entry === undefined) return
  inflight.add(path)
  try {
    const payload = await fetchRunStatus(workspaceId, path, entry.offset)
    applyStatus(path, payload)
  } catch {
    /* A transient Host/transport failure must not blank the console: the next tick retries, and the
       process itself is unaffected (the Host owns it). */
  } finally {
    inflight.delete(path)
  }
}

function applyStatus(path, payload) {
  const current = entries.get(path) ?? blankEntry(path)
  if (payload?.exists !== true) {
    if (current.exists) setEntry(path, { exists: false, status: undefined, runId: null, stopping: false })
    else ensureTimer()
    return
  }
  const live = payload.status === 'running'
  const wasLive = current.status === 'running'
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : []
  const buffer = appendRunChunks(current.buffer, chunks)
  const totalLength = Number.isFinite(payload.totalLength) ? payload.totalLength : current.totalLength
  const reported = Number.isFinite(payload.nextOffset) ? payload.nextOffset : current.offset
  /* Defensive: a terminal payload that claims more output but does not advance the cursor would make
     the driver poll forever. The Host always advances (and equals totalLength once drained), so this
     only ever triggers against a broken/unreachable answer — treat it as drained rather than spin. */
  const stalledTail = !live && reported <= current.offset && current.offset < totalLength
  setEntry(path, {
    status: payload.status,
    stopping: payload.stopping === true,
    runId: payload.runId ?? current.runId,
    code: payload.code ?? null,
    errorCode: payload.errorCode ?? null,
    errorMessage: payload.errorMessage ?? null,
    errorCandidates: payload.errorCandidates ?? null,
    command: typeof payload.command === 'string' && payload.command !== '' ? payload.command : current.command,
    cwdRelative: typeof payload.cwdRelative === 'string' ? payload.cwdRelative : current.cwdRelative,
    interpreter: payload.interpreter ?? current.interpreter,
    startedAt: payload.startedAt ?? current.startedAt,
    durationMs: Number.isFinite(payload.durationMs) ? payload.durationMs : current.durationMs,
    buffer,
    offset: stalledTail ? totalLength : reported,
    totalLength,
    truncated: payload.truncated === true,
    exists: true,
    busy: false,
    /* A run that just settled gets a timestamp so the panel can render one exit line at the tail;
       a re-attach to an already-settled run keeps the Host's duration as-is. */
    settledAt: live ? null : (wasLive ? Date.now() : (current.settledAt ?? Date.now())),
  })
  ensureTimer()
}

/* ---- lifecycle ---- */

/** Point the console at one path: load what the Host knows about it (plan + policy), then discover
 *  whether a run is already live there — that discovery is what makes a refresh re-attach instead of
 *  forgetting. Cheap: one plan, one policy and one status request per opened runnable file. */
export async function focusRunPath(workspaceId, path) {
  if (path === null || path === undefined) return
  const entry = entries.get(path)
  setEntry(path, { workspaceId: workspaceId ?? entry?.workspaceId ?? null })
  const current = entries.get(path)
  if (current.planState === 'idle' || current.planState === 'error') void loadRunPlan(workspaceId, path)
  if (current.policyLoaded !== true) void loadRunPolicy(workspaceId, path)
  if (current.exists !== true) await pollStatus(path, workspaceId)
}

export async function loadRunPlan(workspaceId, path, refresh) {
  if (workspaceId === null || workspaceId === undefined) return
  setEntry(path, { planState: 'loading', planError: null })
  try {
    const plan = await fetchRunPlan(workspaceId, path, refresh === true)
    setEntry(path, {
      plan,
      planState: 'ready',
      planError: null,
      command: typeof plan?.command === 'string' && plan.command !== '' ? plan.command : '',
      cwdRelative: typeof plan?.cwdRelative === 'string' ? plan.cwdRelative : '',
      interpreter: plan?.interpreter ?? null,
    })
  } catch (error) {
    setEntry(path, { planState: 'error', planError: messageOf(error) })
  }
}

async function loadRunPolicy(workspaceId, path) {
  try {
    const payload = await fetchRunPolicy(workspaceId)
    setEntry(path, { policyLoaded: true, trusted: payload?.trusted === true })
  } catch {
    /* Without the policy the console simply asks for confirmation; never block the panel on it. */
    setEntry(path, { policyLoaded: true, trusted: false })
  }
}

/** Remember "this workspace runs files without asking again" on the Host, so both ends share it. */
export async function trustRunWorkspace(workspaceId, path) {
  try {
    const payload = await setRunPolicy(workspaceId, { trusted: true })
    setEntry(path, { trusted: payload?.trusted === true, policyLoaded: true })
  } catch (error) {
    setEntry(path, { notice: { error: true, text: messageOf(error) } })
  }
}

/** Re-resolve this file's plan after an interpreter change. The policy WRITE itself lives in
 *  run-config.js (one owner for every interpreter map); what belongs here is the consequence: the
 *  console must show the new interpreter without a page refresh, and a run started right after must
 *  actually use it — so the Host re-resolves with its PATH cache cleared. */
export async function reloadRunPath(workspaceId, path) {
  if (path === null || path === undefined) return
  setEntry(path, { planState: 'idle', notice: undefined })
  await loadRunPlan(workspaceId, path, true)
  void pollStatus(path, workspaceId)
}

export async function startRunFor(workspaceId, path, argsText) {
  const entry = entries.get(path)
  setEntry(path, { workspaceId, argsText: String(argsText ?? entry?.argsText ?? ''), busy: true, notice: undefined })
  try {
    const payload = await startRunRequest(workspaceId, path, argsText)
    const fresh = blankEntry(path)
    setEntry(path, {
      ...fresh,
      /* Keep the console's own UI state across a restart; only the run record is replaced. */
      workspaceId,
      plan: entry?.plan ?? null,
      planState: entry?.planState ?? 'idle',
      policyLoaded: entry?.policyLoaded === true,
      trusted: entry?.trusted === true,
      collapsed: entry?.collapsed === true,
      panelPx: entry?.panelPx ?? null,
      follow: entry?.follow !== false,
      argsText: String(argsText ?? ''),
      busy: false,
    })
    applyStatus(path, payload)
    return true
  } catch (error) {
    const reason = error?.data?.reason
    if (typeof reason === 'string') {
      /* The Host refused the plan (`run-not-supported`): surface it as the amber "cannot run" card
         instead of a red error, since nothing started. */
      const plan = entry?.plan ?? null
      setEntry(path, {
        plan: { ...(plan ?? {}), runnable: true, supported: false, reason, candidates: error?.data?.candidates ?? plan?.candidates ?? [] },
        busy: false,
      })
      await pollStatus(path, workspaceId)
      return false
    }
    setEntry(path, { busy: false, notice: { error: true, text: messageOf(error) } })
    /* A 409 (already running) means the console was out of date: catch up immediately. */
    await pollStatus(path, workspaceId)
    return false
  }
}

export async function stopRunFor(path) {
  const entry = entries.get(path)
  const runId = entry?.runId
  if (typeof runId !== 'string' || runId === '') return
  setEntry(path, { stopping: true, busy: true, notice: undefined })
  try {
    await stopRunRequest(runId)
    setEntry(path, { busy: false })
    void pollStatus(path, entry.workspaceId)
  } catch (error) {
    setEntry(path, { busy: false, stopping: false, notice: { error: true, text: messageOf(error) } })
  }
}

/** 清空: drop what this client has rendered and move the cursor to the end of the Host's buffer —
 *  for a live run (so the next poll does not replay it) and equally for a finished one (the drained
 *  cursor would otherwise make the driver re-fetch everything the user just cleared). */
export function clearRunOutput(path) {
  setEntry(path, (current) => ({
    ...current,
    buffer: emptyRunBuffer(),
    offset: Math.max(current.offset, current.totalLength ?? 0),
    truncated: false,
    settledAt: null,
    durationMs: current.status === 'running' ? null : current.durationMs,
  }))
  /* The cursor may now be drained, so the driver can stop (otherwise it would tick forever on an
     entry that has nothing left to fetch). */
  ensureTimer()
}

export function setRunArgsText(path, value) {
  setEntry(path, { argsText: String(value ?? '').slice(0, 4096) })
}

export function setRunCollapsed(path, collapsed) {
  setEntry(path, { collapsed: collapsed === true })
}

export function setRunPanelPx(path, px) {
  setEntry(path, { panelPx: Number.isFinite(px) ? Math.max(0, Math.round(px)) : null })
}

export function setRunFollow(path, follow) {
  setEntry(path, { follow: follow === true })
}

function dismissRunNotice(path) {
  setEntry(path, { notice: undefined })
}
