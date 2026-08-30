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
   bound. Live records hold unsaved work but the Host staging draft stays
   authoritative, so even live records older than the window are reclaimed —
   a genuinely active draft is re-mirrored on every keystroke. */
const EMERGENCY_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
let emergencyDraftPruneScheduled = false
/* Circuit breaker for a persistently unavailable IndexedDB (private mode,
   storage disabled): without it every keystroke would re-open the same
   failing database and reject anew (callsites absorb the rejection, so this
   is noise rather than breakage — but the retries are pure waste). */
let emergencyDraftDbFailed = false
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
        /* A record with a missing/corrupt updatedAt can never satisfy the
           retention check (NaN < cutoff is false) and would linger forever:
           treat it as the oldest so it is reclaimed on the first sweep. */
        const updatedAt = Number(value.updatedAt)
        const expired = !Number.isFinite(updatedAt) || updatedAt < cutoff
        if (value?.state === 'deleted') {
          if (expired) store.delete(value.key)
        } else if (expired) {
          /* Live records are normally never pruned (unsaved work), but a
             zombie record left by a raced path rewrite (see
             rewriteEmergencyDraftPath) has no Host counterpart to reconcile
             against. The Host staging draft stays authoritative, so
             reclaiming mirror records older than the retention window is
             safe — a genuinely active draft is re-mirrored on every keystroke. */
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
  if (emergencyDraftDbFailed) return Promise.resolve(undefined)
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
    /* Persistent failure (private mode / disabled storage): trip the breaker
       so later writes stop re-opening the database on every keystroke. */
    emergencyDraftDbFailed = true
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
        rewrittenOldKeys.push(step.delete)
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.oncomplete = () => { resolveRewrite() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite aborted')) }
  })
  /* Sweep pass: a mirror write enqueued AFTER the rewrite transaction started
     (the user typed at the old path while the move was in flight) commits
     after it and would resurrect the old-key record as a zombie. Migrate any
     such record to the new path in a second readwrite transaction — the editor
     has switched to the new path by now, so no further old-path writes are
     expected. */
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
          /* Destination collision: keep the NEWER side, same rule as above. */
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