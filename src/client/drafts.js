import { rewriteRelativePath } from './paths.js'

/* IndexedDB mirrors the newest dirty snapshot immediately, closing the durability gap an unload cannot finish; Host drafts stay the authority. */
const EMERGENCY_DRAFT_DB = 'dsh-workspace-studio'
const EMERGENCY_DRAFT_STORE = 'drafts-v1'
let emergencyDraftDbPromise
const emergencyDraftTails = new Map()
function emergencyDraftKey(workspaceId, scopeId, path) {
  return JSON.stringify([String(workspaceId), String(scopeId), path])
}
/* Tombstones (state: 'deleted') only suppress restoring a discarded draft and are reclaimed after a retention window. */
const EMERGENCY_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
let emergencyDraftPruneScheduled = false
/* Circuit breaker for a persistently unavailable IndexedDB (private mode, storage disabled): time-bounded, so a transient failure does not disable the mirror for the page lifetime. */
let emergencyDraftDbFailed = false
let emergencyDraftDbFailedAt = 0
const EMERGENCY_DRAFT_BREAKER_WINDOW_MS = 30_000
async function pruneEmergencyDrafts() {
  const db = await openEmergencyDraftDb()
  if (db === undefined) return
  const cutoff = Date.now() - EMERGENCY_DRAFT_RETENTION_MS
  await new Promise((resolvePrune, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readwrite')
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      for (const value of request.result ?? []) {
        /* A record with a missing/corrupt updatedAt can never satisfy the retention check: treat it as the oldest. */
        const updatedAt = Number(value.updatedAt)
        const expired = !Number.isFinite(updatedAt) || updatedAt < cutoff
        if (value?.state === 'deleted') {
          if (expired) store.delete(value.key)
        } else if (expired) {
          /* A zombie left by a raced path rewrite has no Host counterpart to reconcile against, so reclaiming it is safe. */
          store.delete(value.key)
        }
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft prune failed')) }
    transaction.oncomplete = () => { resolvePrune() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft prune failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft prune aborted')) }
  })
}
function openEmergencyDraftDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined)
  if (emergencyDraftDbFailed) {
    /* Time-bounded breaker: allow one retry after the window. */
    if (Date.now() - emergencyDraftDbFailedAt < EMERGENCY_DRAFT_BREAKER_WINDOW_MS) return Promise.resolve(undefined)
    emergencyDraftDbFailed = false
  }
  if (emergencyDraftDbPromise !== undefined) return emergencyDraftDbPromise
  emergencyDraftDbPromise = new Promise((resolveDb, reject) => {
    let request
    let blocked = false
    try {
      request = indexedDB.open(EMERGENCY_DRAFT_DB, 1)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EMERGENCY_DRAFT_STORE)) {
        request.result.createObjectStore(EMERGENCY_DRAFT_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      /* The upgrade may have been blocked at open time and only now succeeded: close the late connection instead of leaking it. */
      if (blocked) {
        request.result.close()
        return
      }
      resolveDb(request.result)
      /* One best-effort sweep per page load. */
      if (!emergencyDraftPruneScheduled) {
        emergencyDraftPruneScheduled = true
        void pruneEmergencyDrafts().catch(() => {})
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB open failed')) }
    request.onblocked = () => {
      /* Another tab holds the old version and the upgrade cannot proceed: degrade to "no mirror" instead of rejecting forever. */
      blocked = true
      console.warn('workspace-studio: IndexedDB draft upgrade blocked; emergency mirror disabled for this session')
      resolveDb(undefined)
    }
  }).catch(error => {
    emergencyDraftDbPromise = undefined
    /* Failure (private mode / disabled storage / transient glitch): trip the time-bounded breaker so later writes stop re-opening the database. */
    emergencyDraftDbFailed = true
    emergencyDraftDbFailedAt = Date.now()
    throw error
  })
  return emergencyDraftDbPromise
}
async function emergencyDraftRequest(mode, operation) {
  const db = await openEmergencyDraftDb()
  if (db === undefined) return undefined
  return new Promise((resolveRequest, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, mode)
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    let request
    let result
    try {
      request = operation(store)
    } catch (error) {
      reject(error)
      return
    }
    if (request !== undefined) {
      request.onsuccess = () => { result = request.result }
      request.onerror = () => { reject(request.error ?? new Error('IndexedDB request failed')) }
    }
    transaction.oncomplete = () => { resolveRequest(result) }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB transaction failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB transaction aborted')) }
  })
}
function queueEmergencyDraft(key, operation) {
  const previous = emergencyDraftTails.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  emergencyDraftTails.set(key, current)
  const cleanup = () => { if (emergencyDraftTails.get(key) === current) emergencyDraftTails.delete(key) }
  current.then(cleanup, cleanup)
  return current
}
export function writeEmergencyDraft(workspaceId, scopeId, path, payload) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  /* Spread the payload first so identity fields always win: a payload's own path must never override the record's derived `path`. */
  const value = { ...payload, key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, updatedAt: Date.now() }
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readwrite', store => store.put(value)))
}
export async function readEmergencyDraft(workspaceId, scopeId, path) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  /* Queue the read on the same key as every write, or a write enqueued after the wait could commit after the read. */
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readonly', store => store.get(key)))
}
export function deleteEmergencyDraft(workspaceId, scopeId, path, generation) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  const tombstone = { key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, state: 'deleted', generation, updatedAt: Date.now() }
  // Keep a tombstone: a failed/late restore must not resurrect a discarded draft.
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readwrite', store => store.put(tombstone)))
}
export async function rewriteEmergencyDraftPath(workspaceId, scopeId, from, to) {
  await Promise.all([...emergencyDraftTails.values()].map(tail => tail.catch(() => {})))
  const db = await openEmergencyDraftDb()
  if (db === undefined) return
  /* Read-modify-write inside one readwrite transaction, so a write enqueued between separate transactions cannot be overwritten by a stale snapshot. */
  const rewrittenOldKeys = []
  await new Promise((resolveRewrite, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readwrite')
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      const all = request.result ?? []
      const rewrites = []
      for (const value of all) {
        if (value.workspaceId !== String(workspaceId) || value.scopeId !== String(scopeId)) continue
        const path = rewriteRelativePath(value.path, from, to)
        if (path === value.path) continue
        rewrites.push({ oldKey: value.key, value: { ...value, key: emergencyDraftKey(workspaceId, scopeId, path), path, updatedAt: Date.now() } })
      }
      if (rewrites.length === 0) return
      /* Destination collision: keep the newer side (generation, then updatedAt). */
      const destinationByKey = new Map()
      for (const record of all) if (record.key !== undefined) destinationByKey.set(record.key, record)
      const finalized = []
      const seen = new Set()
      for (const rewrite of rewrites) {
        if (seen.has(rewrite.value.key)) continue
        seen.add(rewrite.value.key)
        const existing = destinationByKey.get(rewrite.value.key)
        if (existing !== undefined && existing !== null) {
          const existingGeneration = Number.isSafeInteger(existing.generation) ? existing.generation : -1
          const movedGeneration = Number.isSafeInteger(rewrite.value.generation) ? rewrite.value.generation : -1
          const existingAt = Number(existing.updatedAt) || 0
          const movedAt = Number(rewrite.value.updatedAt) || 0
          if (existingGeneration > movedGeneration || (existingGeneration === movedGeneration && existingAt > movedAt)) {
            finalized.push({ delete: rewrite.oldKey })
            continue
          }
        }
        finalized.push({ delete: rewrite.oldKey, put: rewrite.value })
      }
      for (const step of finalized) {
        store.delete(step.delete)
        if (step.put !== undefined) store.put(step.put)
        rewrittenOldKeys.push(step.delete)
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.oncomplete = () => { resolveRewrite() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite aborted')) }
  })
  /* Sweep pass: migrate any old-key record a mirror write enqueued after the rewrite transaction started. */
  if (rewrittenOldKeys.length > 0) {
    await new Promise((resolveSweep, reject) => {
      const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readwrite')
      const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
      const request = store.getAll()
      request.onsuccess = () => {
        const all = request.result ?? []
        const oldKeySet = new Set(rewrittenOldKeys)
        for (const value of all) {
          if (value.workspaceId !== String(workspaceId) || value.scopeId !== String(scopeId)) continue
          if (value.key === undefined || !oldKeySet.has(value.key)) continue
          const path = rewriteRelativePath(value.path, from, to)
          if (path === value.path) continue
          const newKey = emergencyDraftKey(workspaceId, scopeId, path)
          /* Destination collision: keep the newer side, same rule as above. */
          const existing = all.find(record => record.key === newKey)
          if (existing !== undefined && existing !== null) {
            const existingGeneration = Number.isSafeInteger(existing.generation) ? existing.generation : -1
            const movedGeneration = Number.isSafeInteger(value.generation) ? value.generation : -1
            const existingAt = Number(existing.updatedAt) || 0
            const movedAt = Number(value.updatedAt) || 0
            if (existingGeneration > movedGeneration || (existingGeneration === movedGeneration && existingAt > movedAt)) {
              store.delete(value.key)
              continue
            }
          }
          store.delete(value.key)
          store.put({ ...value, key: newKey, path, updatedAt: Date.now() })
        }
      }
      request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft rewrite sweep failed')) }
      transaction.oncomplete = () => { resolveSweep() }
      transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite sweep failed')) }
      transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite sweep aborted')) }
    })
  }
}