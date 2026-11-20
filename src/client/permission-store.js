/* Console-command file permissions: Host-owned pending queue, scope snapshot and settings.
 *
 * Nothing is persisted here. The Host keeps grants / history / settings in
 * permissions/cache.json and serves them through the four /permissions routes; this module only
 * keeps the last answer (and an in-flight flag) so the page and the global prompt can render.
 *
 * Polling is scoped exactly as the surfaces need it:
 *   - pending requests are polled only while a component asks for them (the global prompt);
 *   - a scope snapshot is polled only while the permission page is mounted;
 *   - both skip a tick while the document is hidden (poll-gate.js).
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  clearPermissionAiCache,
  fetchPendingPermissions,
  fetchPermissionConfig,
  fetchPermissionSnapshot,
  postPermissionAction,
  savePermissionConfig,
} from './api.js'
import { PERMISSIONS_POLL_MS, PERMISSIONS_SNAPSHOT_MS } from './constants.js'
import { shouldSkipPoll } from './poll-gate.js'

const pendingState = { requests: [], loading: false, error: null }
const snapshotStates = new Map()
const configState = { value: null, loading: false, error: null }
const busyRequests = new Set()
const listeners = new Set()
let version = 0
let pendingTimer = null
let pendingUsers = 0
let pendingInflight = null
const snapshotTimers = new Map()
const snapshotInflight = new Map()
let configInflight = null

function bump() {
  version += 1
  for (const listener of [...listeners]) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getVersion() {
  return version
}

/** One version subscription shared by every permission surface. */
export function usePermissionVersion() {
  return useSyncExternalStore(subscribe, getVersion, getVersion)
}

function messageOf(error, fallback) {
  return typeof error?.message === 'string' && error.message !== '' ? error.message : (fallback ?? '')
}

async function pollPending() {
  if (pendingInflight !== null) return pendingInflight
  pendingInflight = (async () => {
    let changed = false
    try {
      const payload = await fetchPendingPermissions()
      if (payload === undefined) throw new Error('invalid pending response')
      const previous = pendingState.requests.map(request => request.id).join('|')
      const next = payload.requests.map(request => request.id).join('|')
      /* Re-render only when the queue membership changed: the explorer reads this queue for its
         context-menu count, and a 1.2 s bump would re-render the whole file tree for nothing. */
      if (previous !== next) {
        pendingState.requests = payload.requests
        changed = true
      }
      if (pendingState.error !== null) {
        pendingState.error = null
        changed = true
      }
    } catch (error) {
      const message = messageOf(error, 'permission pending request failed')
      if (pendingState.error !== message) {
        pendingState.error = message
        changed = true
      }
    } finally {
      if (pendingState.loading === true) {
        pendingState.loading = false
        changed = true
      }
      pendingInflight = null
      if (changed) bump()
    }
  })()
  return pendingInflight
}

function acquirePendingPolling() {
  pendingUsers += 1
  if (pendingTimer !== null) return
  pendingState.loading = true
  void pollPending()
  pendingTimer = setInterval(() => {
    if (shouldSkipPoll()) return
    void pollPending()
  }, PERMISSIONS_POLL_MS)
}

function releasePendingPolling() {
  pendingUsers = Math.max(0, pendingUsers - 1)
  if (pendingUsers > 0 || pendingTimer === null) return
  clearInterval(pendingTimer)
  pendingTimer = null
}

/** Force one pending-queue refresh (also used by tests); the shared poll timer stays the normal path. */
export function refreshPendingPermissions() {
  return pollPending()
}

/** The global pending queue (the prompt). Acquires the one shared poll timer while mounted. */
export function usePendingPermissions() {
  usePermissionVersion()
  useEffect(() => {
    acquirePendingPolling()
    return () => { releasePendingPolling() }
  }, [])
  return pendingState
}

/** Whether one request's decision is currently being submitted. */
export function usePermissionRequestBusy(requestId) {
  usePermissionVersion()
  return busyRequests.has(requestId)
}

function snapshotOf(sessionId) {
  const key = String(sessionId ?? '')
  let state = snapshotStates.get(key)
  if (state === undefined) {
    state = { value: null, loading: false, error: null, loaded: false }
    snapshotStates.set(key, state)
  }
  return state
}

export async function refreshPermissionSnapshot(sessionId) {
  const key = String(sessionId ?? '')
  if (key === '') return null
  if (snapshotInflight.has(key)) return snapshotInflight.get(key)
  const state = snapshotOf(key)
  state.loading = true
  state.error = null
  const pending = (async () => {
    try {
      const payload = await fetchPermissionSnapshot(key)
      if (payload === undefined) throw new Error('invalid permission snapshot')
      state.value = payload
      state.loaded = true
      state.error = null
      return payload
    } catch (error) {
      state.error = messageOf(error, 'permission snapshot request failed')
      return null
    } finally {
      state.loading = false
      snapshotInflight.delete(key)
      bump()
    }
  })()
  snapshotInflight.set(key, pending)
  return pending
}

/** The current scope snapshot, refreshed every 2 s while the page is mounted. */
export function usePermissionSnapshot(sessionId) {
  usePermissionVersion()
  useEffect(() => {
    const key = String(sessionId ?? '')
    if (key === '') return undefined
    void refreshPermissionSnapshot(key)
    const timer = setInterval(() => {
      if (shouldSkipPoll()) return
      void refreshPermissionSnapshot(key)
    }, PERMISSIONS_SNAPSHOT_MS)
    snapshotTimers.set(key, timer)
    return () => {
      if (snapshotTimers.get(key) === timer) snapshotTimers.delete(key)
      clearInterval(timer)
    }
  }, [sessionId])
  return snapshotOf(sessionId)
}

export async function decidePermissionRequest(requestId, outcome, grants) {
  const id = String(requestId ?? '')
  if (id === '') return null
  if (busyRequests.has(id)) return null
  busyRequests.add(id)
  bump()
  try {
    const body = { action: 'decide', requestId: id, outcome }
    if (outcome === 'allow-remember') body.grants = Array.isArray(grants) ? grants : []
    const result = await postPermissionAction(body)
    pendingState.requests = pendingState.requests.filter(request => request.id !== id)
    pendingState.error = null
    for (const [key, state] of snapshotStates) {
      if (state.value?.pending?.some(request => request.id === id)) void refreshPermissionSnapshot(key)
    }
    return result
  } catch (error) {
    pendingState.error = messageOf(error, 'permission decision failed')
    return null
  } finally {
    busyRequests.delete(id)
    bump()
  }
}

export async function revokePermission(sessionId, path) {
  const result = await postPermissionAction({ action: 'revoke', sessionId: String(sessionId ?? ''), path: String(path ?? '') })
  await refreshPermissionSnapshot(sessionId)
  return result
}

/* Pause / resume interception for ONE scope (manual, persisted by the Host, no timer). Pausing also
   releases the scope's waiting requests on the Host, so the shared pending queue is refreshed too —
   the global prompt must not keep showing a request that has already resolved. */
export async function pausePermissions(sessionId) {
  const result = await postPermissionAction({ action: 'pause', sessionId: String(sessionId ?? '') })
  await refreshPermissionSnapshot(sessionId)
  await pollPending()
  return result
}

export async function resumePermissions(sessionId) {
  const result = await postPermissionAction({ action: 'resume', sessionId: String(sessionId ?? '') })
  await refreshPermissionSnapshot(sessionId)
  return result
}

export async function revokeAllPermissions(sessionId) {
  const result = await postPermissionAction({ action: 'revoke-all', sessionId: String(sessionId ?? '') })
  await refreshPermissionSnapshot(sessionId)
  return result
}

export async function clearAllPermissions() {
  const result = await postPermissionAction({ action: 'clear-all' })
  for (const key of snapshotStates.keys()) void refreshPermissionSnapshot(key)
  return result
}

export async function clearPermissionAnalysisCache() {
  return clearPermissionAiCache()
}

export async function refreshPermissionConfig() {
  if (configInflight !== null) return configInflight
  configState.loading = true
  configInflight = (async () => {
    try {
      const payload = await fetchPermissionConfig()
      if (payload === undefined) throw new Error('invalid permission config')
      configState.value = payload
      configState.error = null
      return payload
    } catch (error) {
      configState.error = messageOf(error, 'permission config request failed')
      return null
    } finally {
      configState.loading = false
      configInflight = null
      bump()
    }
  })()
  return configInflight
}

export function usePermissionConfig() {
  usePermissionVersion()
  useEffect(() => {
    if (configState.value === null && configState.loading !== true) void refreshPermissionConfig()
  }, [])
  return configState
}

export async function savePermissionSettings(patch) {
  const result = await savePermissionConfig(patch)
  if (result !== undefined) {
    configState.value = result
    configState.error = null
    bump()
  }
  return result
}
