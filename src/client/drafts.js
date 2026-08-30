import { rewriteRelativePath } from './paths.js'

/* IndexedDB mirrors the newest dirty snapshot immediately. Host drafts stay
   the authority, but an unload cannot reliably finish a 1 MiB fetch; the
   local mirror closes that durability gap and is reconciled on restore. */
const EMERGENCY_DRAFT_DB = 'dsh-workspace-studio'
const EMERGENCY_DRAFT_STORE = 'drafts-v1'
let emergencyDraftDbPromise
const emergencyDraftTails = new Map()
function emergencyDraftKey(workspaceId, scopeId, path) {
  return JSON.stringify([String(workspaceId), String(scopeId), path])
}
/* Tombstones (state: 'deleted') only suppress restoring a discarded draft and
   are reclaimed after a retention window so the mirror cannot grow without
   bound; live records are unsaved work and never pruned. */
const EMERGENCY_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
let emergencyDraftPruneScheduled = false
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
        if (value?.state !== 'deleted') continue
        /* A tombstone with a missing/corrupt updatedAt can never satisfy the
           retention check (NaN < cutoff is false) and would linger forever:
           treat it as the oldest so it is reclaimed on the first sweep. */
        const updatedAt = Number(value.updatedAt)
        if (!Number.isFinite(updatedAt) || updatedAt < cutoff) store.delete(value.key)
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
      /* The upgrade may have been blocked at open time (we already resolved
         undefined) and only now succeeded after the blocking tab closed: close
         the late connection instead of leaking it — the mirror stays disabled
         for this session by design. */
      if (blocked) {
        request.result.close()
        return
      }
      resolveDb(request.result)
      /* One best-effort sweep per page load: reclaim expired tombstones, never live drafts. */
      if (!emergencyDraftPruneScheduled) {
        emergencyDraftPruneScheduled = true
        void pruneEmergencyDrafts().catch(() => {})
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB open failed')) }
    request.onblocked = () => {
      /* Another tab holds the old version and the upgrade cannot proceed. The
         mirror is best-effort (the Host draft stays authoritative), so degrade
         to "no mirror" instead of rejecting forever — a rejected promise would
         be retried on every write and keep failing. */
      blocked = true
      console.warn('workspace-studio: IndexedDB draft upgrade blocked; emergency mirror disabled for this session')
      resolveDb(undefined)
    }
  }).catch(error => {
    emergencyDraftDbPromise = undefined
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
  /* Spread the payload FIRST so identity fields always win: a payload's own
     path must never override the record's derived `path` (and key), or
     restore/rewrite would operate on inconsistent records. */
  const value = { ...payload, key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, updatedAt: Date.now() }
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readwrite', store => store.put(value)))
}
export async function readEmergencyDraft(workspaceId, scopeId, path) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  /* Queue the read on the same key as every write: a bare "wait for the
     current tail, then read" leaves a window where a write enqueued right
     after the wait commits AFTER the read transaction — restore would see
     the previous snapshot. Serializing the read makes read-after-write
     strict for this key. */
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readonly', store => store.get(key)))
}
export function deleteEmergencyDraft(workspaceId, scopeId, path, generation) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  const tombstone = { key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, state: 'deleted', generation, updatedAt: Date.now() }
  // Keep a tombstone: a failed/late restore must not resurrect a draft the user discarded.
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readwrite', store => store.put(tombstone)))
}
export async function rewriteEmergencyDraftPath(workspaceId, scopeId, from, to) {
  await Promise.all([...emergencyDraftTails.values()].map(tail => tail.catch(() => {})))
  const db = await openEmergencyDraftDb()
  if (db === undefined) return
  /* Read ALL + decide + delete/put inside ONE readwrite transaction: a write
     enqueued between a separate read transaction and a later write transaction
     could otherwise be overwritten by the stale snapshot (or deleted along
     with the old key). IndexedDB serializes transactions on the same store, so
     the whole read-modify-write is atomic against concurrent mirror writes. */
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
      /* Destination collision: keep the NEWER side (generation, then updatedAt)
         so a live draft at the destination never loses newer work to a moved
         older record. */
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
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.oncomplete = () => { resolveRewrite() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite aborted')) }
  })
}