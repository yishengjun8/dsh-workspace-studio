import { useSyncExternalStore } from 'react'
import { MINDMAP_INDEX_REFRESH_MS } from '../constants.js'
import { fetchMindmapDocIndex } from '../api.js'

/* Module-wide mind-map index registry: sidebar panel and branch hider need the
   root/branch session sets without fetching on every render; a background
   refresh keeps the index current, components subscribe via useSyncExternalStore. */
export const mindmapRegistry = {
  _docs: [],
  _roots: new Set(),
  _branches: new Set(),
  _version: 0,
  _listeners: new Set(),
  _timer: 0,
  _inflight: null,
  _signature: undefined,
  /* stop() marks the module stopped: an in-flight refresh's finally must not
     re-arm the background timer after an unload (see stop below). */
  _stopped: false,
  /* A markDirty/refresh that arrived while a refresh was in flight: the
     in-flight result predates that mutation, so re-run once it settles. */
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
  /* Resolve a session to its mind-map ROOT session id: the root itself, or the
     root of the doc whose branchSessionIds contains it. Returns null when the
     session belongs to no mind map. Drives the SHARED dsh-ws-preview
     persistence key: every member of the same map (root + all branches) reads
     and writes one snapshot under the root's id. */
  rootOf(id) {
    const key = String(id)
    for (const doc of this._docs) {
      if (String(doc.sessionId) === key) return String(doc.sessionId)
      if ((doc.branchSessionIds ?? []).some(branch => String(branch) === key)) return String(doc.sessionId)
    }
    return null
  },
  _apply(docs) {
    /* Only a signature change (doc added/removed, rootTitle rename, branch-set
       fork, or updatedAt bump from a folded turn) may bump the version and
       re-render subscribers — unconditional notify re-ran them on every idle
       5 s poll. updatedAt is included so a doc that gained a turn re-sorts to
       the top of its sidebar group. */
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
      /* A mutation landed while a refresh was in flight: its result would be
         stale, so remember to re-run once the current one settles. */
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
        /* A stop() during the flight must stay stopped: re-arming the timer
           here would leak a 30 s poll (interval + fetch) after unload. */
        if (this._stopped) return
        /* Keep the background timer aligned with the index: docs exist → keep
           polling; empty index → pause (no docs, no work worth doing). */
        this._syncTimerToDocs()
        /* Re-run when a markDirty/refresh arrived during the in-flight window:
           the just-applied index predates that mutation. */
        if (this._dirtyDuringRefresh) {
          this._dirtyDuringRefresh = false
          void this.refresh()
        }
      })
    this._inflight = pending
    return pending
  },
  /* Background polling cadence: MINDMAP_INDEX_REFRESH_MS while at least one doc
     exists. The timer PAUSES while the index is empty — with no docs on disk
     there is nothing to render and no staleness worth defending against (local
     mutations refresh immediately via markDirty). Any refresh that finds docs
     re-arms it, and markDirty / start() after a pause wake it again. Cross-tab
     caveat: the FIRST doc created in another tab is only noticed here on the
     next local refresh/action (accepted — the overlay-open load path refreshes
     the registry and re-arms the poll). */
  _armTimer() {
    if (this._timer !== 0) return
    this._timer = window.setInterval(() => { void this.refresh() }, MINDMAP_INDEX_REFRESH_MS)
  },
  /* Keep the timer aligned with reality after every completed refresh. */
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
    /* Mark the module stopped BEFORE clearing the timer: an in-flight
       refresh's finally consults this flag and skips re-arming, so an unload
       (AppFrame unmount / plugin reload) cannot leave a leaked interval
       polling /mindmap-doc/index every 30 s. */
    this._stopped = true
    if (this._timer !== 0) { window.clearInterval(this._timer); this._timer = 0 }
  },
  markDirty() { void this.refresh() },
}
/* Module-level bound subscribes: useSyncExternalStore compares the subscribe
   function by identity, so an inline arrow would unsubscribe + resubscribe on
   every render (perf noise). The arrow wrapper is still required — a naked
   method reference would drop `this` off the call (React invokes the function
   bare, reading `undefined._listeners` and crashing the slot on mount). */
const subscribeRegistry = listener => mindmapRegistry.subscribe(listener)
export function useMindmapRegistry() {
  useSyncExternalStore(
    subscribeRegistry,
    () => mindmapRegistry.getVersion(),
  )
  return mindmapRegistry
}

/* Module-wide dock-request bridge: the sidebar mind-map entries and the
   session-header 导图 button ask the explorer to open the map as a preview
   tab (dsh-ws-preview). The explorer consumes the request ONLY when its
   previewSessionId matches the request's expectFamily — add/update the
   mind-map tab, activate it — and clears it, so a later explorer mount
   (session switch) never re-applies a stale request and an unrelated
   session's explorer never adopts one. A request whose family has no
   mounted explorer stays pending and docks on the next matching mount,
   which is the closest the request can get to its intent. */
export const mindmapDockStore = {
  _snapshot: { seq: 0, request: null },
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getSnapshot() { return this._snapshot },
  dock(rootId, name, expectFamily) {
    this._snapshot = {
      seq: this._snapshot.seq + 1,
      request: {
        rootId: String(rootId),
        name: typeof name === 'string' ? name : '',
        /* Only the explorer whose previewSessionId equals expectFamily may
           consume the request. Without this gate the CURRENT session's
           explorer (the one mounted at click time) consumes it first,
           stamping the map's tab onto a session the click is about to leave
           — and the tab then follows that session's snapshot forever. A
           request awaiting its family stays pending until the matching
           explorer mounts (after the session switch the opener performs). */
        expectFamily: String(expectFamily ?? rootId),
      },
    }
    for (const listener of [...this._listeners]) listener()
  },
  consume() {
    if (this._snapshot.request === null) return
    this._snapshot = { seq: this._snapshot.seq + 1, request: null }
    for (const listener of [...this._listeners]) listener()
  },
}

/* Per-group sidebar order of mind-map entries in localStorage (id list per
   group key; a workspace rename loses the mapping — accepted trade-off). */
const MINDMAP_ORDER_STORE_KEY = 'dsh.workspace.studio.mindmap-order.v1'
/* Cross-tab serialization for the read-modify-write of the whole map: two GUI
   tabs writing different maps concurrently would otherwise overwrite each
   other's entries (lost update). Web Locks serializes the read+write; without
   the API the write still happens (single-tab behavior unchanged). */
async function withMindmapStoreLock(name, operation) {
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    try {
      return await navigator.locks.request(name, operation)
    } catch { /* lock unavailable: fall through to the unlocked write */ }
  }
  return operation()
}
export function readMindmapOrder() {
  try {
    const raw = window.localStorage.getItem(MINDMAP_ORDER_STORE_KEY)
    if (raw === null || raw === '') return {}
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
export function writeMindmapOrder(map) {
  return withMindmapStoreLock('dsh-workspace-studio:mindmap-order', () => {
    try { window.localStorage.setItem(MINDMAP_ORDER_STORE_KEY, JSON.stringify(map)) } catch { /* quota / private mode */ }
  })
}
/* Re-read INSIDE the lock so a concurrent tab's drag is never clobbered (same
   pattern as writeMindmapLastSession): the caller's in-memory order may be
   stale, and a bare writeMindmapOrder(map) would overwrite the other tab's
   entries. Returns the merged map (undefined when storage is unavailable). */
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

/* Per-root last-selected session of a mind map in localStorage (root session id
   → last selected session id, one small string pair per map). Written whenever
   a card click lands the selection on a session; restored on the next open of
   that map so the "当前" highlight (and the right-side chat) return to the last
   clicked card instead of defaulting to the first branch. A stale entry whose
   session was archived / re-anchored is harmless: the restore guard falls back
   to the default first branch. */
const MINDMAP_LAST_SESSION_STORE_KEY = 'dsh.workspace.studio.mindmap-last-session.v1'
function readMindmapLastSessionMap() {
  try {
    const raw = window.localStorage.getItem(MINDMAP_LAST_SESSION_STORE_KEY)
    if (raw === null || raw === '') return {}
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
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