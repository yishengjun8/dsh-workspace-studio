import { useSyncExternalStore } from 'react'
import { MINDMAP_INDEX_REFRESH_MS, MINDMAP_LAST_SESSION_STORE_KEY, MINDMAP_MEMBER_TTL_MS, MINDMAP_ORDER_STORE_KEY } from '../constants.js'
import { readPersistedState } from '../persisted-state.js'
import { fetchMindmapDocIndex } from '../api.js'
import { createRequestStore } from '../request-store.js'
import { shouldSkipPoll } from '../poll-gate.js'

/* Module-wide mind-map index registry: the sidebar panel and branch hider need the root/branch
   session sets without fetching on every render; a background refresh keeps the index current. */
export const mindmapRegistry = {
  _docs: [],
  _roots: new Set(),
  _branches: new Set(),
  /* Optimistic session -> family root for sessions THIS client just created or adopted (a map
     fork, a root-node "new session", an external chat fork). The doc write and the chat switch
     both happen before the async index refresh, and a null mapping in that window changes the
     explorer's React key — the whole preview column, docked map included, remounts empty. These
     bridge exactly that window; the refreshed index confirms and prunes them. */
  _members: new Map(),
  /* Optimistic root aliases written when an open map is RE-ANCHORED (its root session was
     archived or replaced): the index still serves the old root for a few hundred ms, but every
     family member now belongs to the new one. Consulted BEFORE the index, so the preview key
     flips once, in the same commit that migrates the host body, tab and snapshot. */
  _rootAliases: new Map(),
  _version: 0,
  _listeners: new Set(),
  _timer: 0,
  _inflight: null,
  _signature: undefined,
  /* Set by stop(): an in-flight refresh's finally must not re-arm the timer after an unload. */
  _stopped: false,
  /* A markDirty/refresh that arrived mid-flight: its result predates the mutation, so re-run once
     it settles. */
  _dirtyDuringRefresh: false,
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getVersion() { return this._version },
  getDocs() { return this._docs },
  isRoot(id) { return this._roots.has(String(id)) },
  isBranch(id) { return this._branches.has(String(id)) },
  isMember(id) { const key = String(id); return this._roots.has(key) || this._branches.has(key) },
  /* Resolve a session to its mind-map ROOT session id: the root itself, or the root of the doc whose
      branchSessionIds contains it; null when the session belongs to no mind map. Drives the SHARED
      dsh-ws-preview persistence key: every member of the same map (root + branches) reads and writes
      one snapshot under the root's id.
      Optimistic entries come FIRST: they exist precisely because the index is still stale (a session
      created a moment ago, or a family re-anchored to a new root), and every consumer — the preview
      key, the highlight, the hider — must see the same family the client already committed to. */
  rootOf(id) {
    const key = String(id)
    const alias = this._rootAliases.get(key)
    if (alias !== undefined && Date.now() - alias.at < MINDMAP_MEMBER_TTL_MS) return String(alias.root)
    const member = this._members.get(key)
    if (member !== undefined) {
      if (Date.now() - member.at < MINDMAP_MEMBER_TTL_MS) return String(member.root)
      this._members.delete(key)
    }
    for (const doc of this._docs) {
      if (String(doc.sessionId) === key) return String(doc.sessionId)
      if ((doc.branchSessionIds ?? []).some(branch => String(branch) === key)) return String(doc.sessionId)
    }
    return null
  },
  /* Record a freshly created/adopted child BEFORE the chat switches to it: from that instant every
     render (the session switch, the map body's highlight) resolves the child to its family root, so
     the preview column's React key never changes. No-op when the index already knows the member. */
  noteMember(rootId, sessionId) {
    const root = String(rootId)
    const child = String(sessionId)
    if (root === '' || child === '' || child === 'undefined' || child === 'null' || root === child) return
    if (this._roots.has(child) || this._branches.has(child)) return
    const previous = this._members.get(child)
    if (previous !== undefined && String(previous.root) === root) return
    this._members.set(child, { root, at: Date.now() })
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  /* Batch form for a whole loaded document: one notify for every member the index does not know
     yet. The single-member form above is for the write paths (which switch the chat immediately). */
  noteMembers(rootId, sessionIds) {
    const root = String(rootId)
    if (root === '') return
    let changed = false
    for (const sessionId of Array.isArray(sessionIds) ? sessionIds : []) {
      if (sessionId === undefined || sessionId === null) continue
      const child = String(sessionId)
      if (child === '' || child === 'undefined' || child === 'null' || child === root) continue
      if (this._roots.has(child) || this._branches.has(child)) continue
      const previous = this._members.get(child)
      if (previous !== undefined && String(previous.root) === root) continue
      this._members.set(child, { root, at: Date.now() })
      changed = true
    }
    if (!changed) return
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  /* Drop an optimistic member again (its doc write failed and the orphan session was archived):
     leaving it behind would keep claiming a family for a dead session. */
  forgetMember(sessionId) {
    if (!this._members.delete(String(sessionId))) return
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  /* Move an open family to a new root in the registry: alias the OLD root, the NEW root and every
     member of the fresh document to the new root until the index catches up. The doc itself already
     moved Host-side (root replacement writes the new file + an alias stub at the old root), so the
     stale index is the only thing still naming the old root. */
  rekeyRoot(oldRoot, newRoot, familyIds) {
    const from = String(oldRoot)
    const to = String(newRoot)
    if (from === '' || to === '' || from === to) return
    const at = Date.now()
    this._rootAliases.set(to, { root: to, at })
    this._rootAliases.set(from, { root: to, at, retired: true })
    for (const id of Array.isArray(familyIds) ? familyIds : []) {
      const key = String(id)
      if (key !== '') this._rootAliases.set(key, { root: to, at })
    }
    for (const [child, entry] of this._members) {
      if (String(entry.root) === from) this._members.set(child, { root: to, at: entry.at })
    }
    /* Mirror the move in the derived sets the hider/sidebar read, so the old root stops looking
       like a live map root and the new one starts (the index refresh recomputes both anyway). */
    if (this._roots.delete(from)) this._roots.add(to)
    this._branches.delete(to)
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  /* Drop optimistic entries the refreshed index has confirmed, plus entries older than the TTL.
     A stale alias is worse than a remount: it would keep resolving sessions to a family the Host
     no longer serves. */
  _pruneOptimistic(docs) {
    const now = Date.now()
    for (const [child, entry] of this._members) {
      if (now - entry.at > MINDMAP_MEMBER_TTL_MS) { this._members.delete(child); continue }
      const doc = docs.find(item => String(item.sessionId) === String(entry.root))
      if (doc !== undefined && (doc.branchSessionIds ?? []).some(branch => String(branch) === child)) this._members.delete(child)
    }
    for (const [id, entry] of this._rootAliases) {
      if (now - entry.at > MINDMAP_MEMBER_TTL_MS) { this._rootAliases.delete(id); continue }
      const target = docs.find(item => String(item.sessionId) === String(entry.root))
      if (target === undefined) continue
      if (String(id) === String(entry.root)) { this._rootAliases.delete(id); continue }
      if ((target.branchSessionIds ?? []).some(branch => String(branch) === String(id))) { this._rootAliases.delete(id); continue }
      /* The retired root: its document is gone from the index, so the alias has done its job.
         Member aliases are never doc roots, so they must not use this test — they stay until the
         TTL unless the branch list above confirmed them. */
      if (entry.retired === true && !docs.some(item => String(item.sessionId) === String(id))) this._rootAliases.delete(id)
    }
  },
  _apply(docs) {
    this._pruneOptimistic(docs)
    /* Only a signature change (doc added/removed, rootTitle rename, branch-set fork, or an updatedAt
       bump from a folded turn) may bump the version and re-render subscribers — unconditional notify
       re-ran them on every idle poll tick. updatedAt is in the signature so a doc that gained a turn
       re-sorts to the top of its sidebar group. */
    const signature = docs
      .map(doc => `${String(doc.sessionId)}\u0001${String(doc.rootTitle ?? '')}\u0001${(doc.branchSessionIds ?? []).map(String).sort().join('\u0003')}\u0001${Number(doc.updatedAt) || 0}`)
      .sort()
      .join('\u0002')
    if (signature === this._signature) return
    this._signature = signature
    this._docs = docs
    this._roots = new Set()
    this._branches = new Set()
    for (const doc of docs) {
      this._roots.add(String(doc.sessionId))
      for (const id of doc.branchSessionIds ?? []) this._branches.add(String(id))
    }
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  async refresh() {
    if (this._inflight !== null) {
      /* A mutation landed mid-flight: its result would be stale — re-run after this one settles. */
      this._dirtyDuringRefresh = true
      return this._inflight
    }
    const pending = fetchMindmapDocIndex()
      .then((payload) => {
        this._apply(Array.isArray(payload?.docs) ? payload.docs : [])
        return payload
      })
      .catch(() => { /* keep the last known index */ })
      .finally(() => {
        this._inflight = null
        /* A stop() during the flight must stay stopped: re-arming here would leak a 30 s poll
           (interval + fetch) after unload. */
        if (this._stopped) return
        /* Keep the background timer aligned with the index: docs exist → keep
           polling; empty index → pause (no docs, no work worth doing). */
        this._syncTimerToDocs()
        /* A markDirty/refresh arrived mid-flight: the just-applied index predates it. */
        if (this._dirtyDuringRefresh) {
          this._dirtyDuringRefresh = false
          void this.refresh()
        }
      })
    this._inflight = pending
    return pending
  },
  /* Background polling cadence: MINDMAP_INDEX_REFRESH_MS while at least one doc exists, pausing on
     an empty index. A doc created in another tab is only noticed on the next local refresh (accepted). */
  _armTimer() {
    if (this._timer !== 0) return
    this._timer = window.setInterval(() => {
      if (shouldSkipPoll()) return
      void this.refresh()
    }, MINDMAP_INDEX_REFRESH_MS)
  },
  _syncTimerToDocs() {
    if (this._docs.length > 0) this._armTimer()
    else if (this._timer !== 0) { window.clearInterval(this._timer); this._timer = 0 }
  },
  start() {
    this._stopped = false
    if (this._timer !== 0) return
    void this.refresh()
    this._armTimer()
  },
  stop() {
    /* Mark stopped BEFORE clearing the timer: an in-flight refresh's finally consults this flag and
       skips re-arming, so an unload (AppFrame unmount / plugin reload) cannot leave a leaked interval
       polling /mindmap-doc/index every 30 s. */
    this._stopped = true
    if (this._timer !== 0) { window.clearInterval(this._timer); this._timer = 0 }
  },
  markDirty() { void this.refresh() },
}
/* Module-level bound subscribes: useSyncExternalStore compares the subscribe function by identity,
   so an inline arrow would unsubscribe + resubscribe every render (perf noise). The arrow wrapper is
   still required — a naked method reference drops `this` (React invokes it bare, crashing on
   `undefined._listeners` at mount). */
const subscribeRegistry = listener => mindmapRegistry.subscribe(listener)
export function useMindmapRegistry() {
  useSyncExternalStore(
    subscribeRegistry,
    () => mindmapRegistry.getVersion(),
  )
  return mindmapRegistry
}

/* Module-wide dock-request bridge: the sidebar mind-map entries and the session-header mind-map
   button ask the explorer to open the map as a preview tab. The explorer consumes the request only
   when its previewSessionId matches the request's expectFamily, so a later mount never re-applies a
   stale request and an unrelated session's explorer never adopts one. */
const pendingDock = createRequestStore()

export const mindmapDockStore = {
  ...pendingDock,
  dock(rootId, name, expectFamily) {
    /* Only the explorer whose previewSessionId faces expectFamily (the request's key) may consume the
       request; otherwise it would stamp the tab onto a session the click is about to leave. */
    pendingDock.request(expectFamily ?? rootId, {
      rootId: String(rootId),
      name: typeof name === 'string' ? name : '',
    })
  },
}

/* Module-wide document hand-off: a fork made OUTSIDE the map (the harness chat's own branch button)
   creates a session the document has not adopted yet, and the map body's periodic sync would keep
   missing it — the Host sync cache serves an incremental `doc: null` once the fork watch's own sync
   has folded the child, so the poll can never deliver the new branch. The fork watch therefore does
   the family sync itself (adopting + persisting on the Host) and hands the document to the body
   here. Entries are replaced per publish (useSyncExternalStore needs a stable identity per change)
   and the map is bounded: one document per entry, oldest evicted past the cap. */
const MINDMAP_HANDOFF_MAX = 8
const MINDMAP_EMPTY_HANDOFF = { seq: 0, doc: null, sessionId: null }
export const mindmapDocHandoff = {
  _entries: new Map(),
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  /* Stable reference while a root has no hand-off: a fresh object per read would re-render forever. */
  snapshotOf(rootId) {
    return this._entries.get(String(rootId)) ?? MINDMAP_EMPTY_HANDOFF
  },
  publish(rootId, doc, sessionId) {
    const key = String(rootId)
    const previous = this._entries.get(key)
    this._entries.set(key, { seq: (previous?.seq ?? 0) + 1, doc, sessionId: String(sessionId) })
    if (this._entries.size > MINDMAP_HANDOFF_MAX) {
      const oldest = this._entries.keys().next().value
      if (oldest !== undefined && oldest !== key) this._entries.delete(oldest)
    }
    for (const listener of [...this._listeners]) listener()
  },
}
/* Same bare-reference trap as useMindmapRegistry: the subscribe must be a module-level arrow wrapper. */
const subscribeHandoff = listener => mindmapDocHandoff.subscribe(listener)
export function useMindmapDocHandoff(rootId) {
  const key = rootId === null || rootId === undefined ? '' : String(rootId)
  return useSyncExternalStore(subscribeHandoff, () => mindmapDocHandoff.snapshotOf(key))
}

/* Per-group sidebar order of mind-map entries in localStorage (id list per group key; a workspace
   rename loses the mapping — accepted trade-off). The stored shape is owned by persisted-state.js,
   which drops anything unusable (including the keys of previous formats) before this module reads it. */
/* Cross-tab serialization for the read-modify-write of the whole map: two GUI tabs writing different
   maps concurrently would otherwise overwrite each other's entries (lost update). Web Locks
   serializes read+write; without the API the write still happens (single-tab behavior unchanged). */
async function withMindmapStoreLock(name, operation) {
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    try {
      return await navigator.locks.request(name, operation)
    } catch { /* lock unavailable: fall through to the unlocked write */ }
  }
  return operation()
}
export function readMindmapOrder() {
  return readPersistedState(MINDMAP_ORDER_STORE_KEY) ?? {}
}
function writeMindmapOrder(map) {
  return withMindmapStoreLock('dsh-workspace-studio:mindmap-order', () => {
    try { window.localStorage.setItem(MINDMAP_ORDER_STORE_KEY, JSON.stringify(map)) } catch { /* quota / private mode */ }
  })
}
/* Re-read INSIDE the lock so a concurrent tab's drag is never clobbered (same pattern as
   writeMindmapLastSession): the caller's order may be stale and a bare writeMindmapOrder(map)
   would overwrite the other tab's entries. Returns the merged map (undefined when storage is
   unavailable). */
export function updateMindmapOrder(groupKey, ids) {
  return withMindmapStoreLock('dsh-workspace-studio:mindmap-order', () => {
    try {
      const map = readMindmapOrder()
      map[String(groupKey)] = ids
      window.localStorage.setItem(MINDMAP_ORDER_STORE_KEY, JSON.stringify(map))
      return map
    } catch { /* quota / private mode */ }
  })
}

/* Per-root last-selected session of a mind map in localStorage (root session id → last selected
   session id). Restored on the next open so the highlight (and the right-side chat) return to the
   last clicked card; a stale entry falls back to the default first branch. */
function readMindmapLastSessionMap() {
  return readPersistedState(MINDMAP_LAST_SESSION_STORE_KEY) ?? {}
}
export function readMindmapLastSession(rootId) {
  const value = readMindmapLastSessionMap()[String(rootId)]
  return typeof value === 'string' && value !== '' ? value : null
}
export function writeMindmapLastSession(rootId, sessionId) {
  /* Re-read INSIDE the lock so a concurrent tab's write is never clobbered. */
  return withMindmapStoreLock('dsh-workspace-studio:mindmap-last-session', () => {
    try {
      const map = readMindmapLastSessionMap()
      map[String(rootId)] = String(sessionId)
      window.localStorage.setItem(MINDMAP_LAST_SESSION_STORE_KEY, JSON.stringify(map))
    } catch { /* quota / private mode */ }
  })
}
export function removeMindmapLastSession(rootId) {
  return withMindmapStoreLock('dsh-workspace-studio:mindmap-last-session', () => {
    try {
      const map = readMindmapLastSessionMap()
      if (!Object.prototype.hasOwnProperty.call(map, String(rootId))) return
      delete map[String(rootId)]
      window.localStorage.setItem(MINDMAP_LAST_SESSION_STORE_KEY, JSON.stringify(map))
    } catch { /* quota / private mode */ }
  })
}