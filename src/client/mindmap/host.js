import { createElement as h, Fragment, useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { mindmapTabPath } from '../preview-tabs.js'
import { mindmapRegistry } from './registry.js'
import { MindMapView } from './view.js'

/* The GLOBAL mind-map view host (scheme B, revised): every docked map body
   lives HERE, mounted once per family root and independent of the per-session
   explorer — whose React key (`workspaceId:previewSessionId`) tears the whole
   preview column down on every session switch, taking any in-explorer
   MindMapView (doc, pan/zoom, highlight, sync timers) with it. Explorers no
   longer render MindMapView and no longer offer a portal target: the host
   owns ONE STABLE CONTAINER div per map body and the explorer PHYSICALLY
   PARKS that element (plain appendChild — no React reconciliation involved)
   into its strip placeholder while the tab is shown, and back into the host's
   hidden holding node while away.

   The 2026-02 revision of this design portalled the body directly into the
   explorer's strip container and switched the portal target to a hidden
   fallback while away. That does NOT work: React treats a CHANGED portal
   container as a new portal (react-dom `updatePortal` /
   `reconcileSinglePortal` only reuse the portal fiber when `containerInfo` is
   the same — otherwise `deleteRemainingChildren` unmounts the whole subtree
   and a fresh one mounts). Every attach/detach remounted MindMapView: the
   doc, pan/zoom, highlight and sync timers died, and switching back ran a
   full loadDoc again (the exact bug the host was built to fix — verified
   against react 18.2.0 and 18.3.1). Keeping the portal container identity
   CONSTANT for the body's lifetime is what makes the keep-alive real: same
   fibers, DOM parked wherever the tab currently shows. */

/* Hidden holding node: the stable containers live here while no strip shows
   their tab (display:none keeps the bodies invisible but MOUNTED — background
   sync keeps folding turns while the user is on another session). Created
   lazily so module evaluation never touches the document (the bundle is
   injected before the body may exist). */
let holdingEl = null
const mindmapHolding = () => {
  if (holdingEl === null) {
    holdingEl = document.createElement('div')
    holdingEl.hidden = true
    holdingEl.style.display = 'none'
    document.body.appendChild(holdingEl)
  }
  return holdingEl
}

export const mindmapViewHost = {
  /* rootId -> { fresh } : every map that currently has a live tab somewhere.
     `fresh` marks a body whose tab was just created by a DOCK REQUEST: its
     MindMapView may land the chat on the map's remembered session. Captured by
     the view's mount-time useRef and then CONSUMED via consumeFresh() — a
     stale true flag must never replay restoreLastSession on a later remount
     of the same body. */
  _roots: new Map(),
  /* rootId -> { el, host } : the map's STABLE portal container. `el` is
     created once per body (lazily, by containerOf) and its identity NEVER
     changes while the body lives — the MindMapBody portal targets it forever,
     which is what keeps React from remounting the map. `host` is the
     placeholder element the container is currently parked in (null = parked
     in the hidden holding node). Parking/unparking is a plain DOM move. */
  _containers: new Map(),
  /* The strip API of the explorer currently mounted (one at a time): doc-gone
     and title updates reach the tab strip only while it is displayed; the
     host fixes the persisted family snapshot directly when it is not. */
  _strip: null,
  /* rootId -> last map-internal session id: the 当前-highlight fallback when
     the harness current session is not a family member (hero page /
     transient), mirroring the old per-explorer mapSessionByPath. */
  _sessions: new Map(),
  /* Registered by MindMapHost (AppFrame) so away-case snapshot fixups can
     write through the preview-sessions store (see docGone/titleChange). */
  storeRef: { current: null },
  _version: 0,
  _listeners: new Set(),

  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getVersion() { return this._version },
  _notify() {
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  roots() { return [...this._roots.keys()] },
  /* The map's STABLE portal container: created once per body and parked in
     the hidden holding node until an explorer places it into a strip
     placeholder. Idempotent, so both ensure() and a (defensive) bare render
     can call it — the returned element identity is constant for the body's
     lifetime, which is the whole point of this design. */
  containerOf(rootId) {
    const key = String(rootId)
    let entry = this._containers.get(key)
    if (entry === undefined) {
      const el = document.createElement('div')
      el.className = 'dsh-ws-mindmap-host-body'
      mindmapHolding().appendChild(el)
      entry = { el, host: null }
      this._containers.set(key, entry)
    }
    return entry.el
  },
  isFresh(rootId) {
    return this._roots.get(String(rootId))?.fresh === true
  },
  /* The body's MindMapView captured the fresh flag into its mount-time ref:
     clear it so no later (accidental) remount of the same body can replay
     restoreLastSession with a stale fresh=true (the stale flag would yank
     the chat onto the map's remembered session instead of the session the
     user actually opened). */
  consumeFresh(rootId) {
    const entry = this._roots.get(String(rootId))
    if (entry === undefined || entry.fresh !== true) return
    entry.fresh = false
  },
  sessionOf(rootId) {
    const value = this._sessions.get(String(rootId))
    return value === undefined ? null : value
  },
  /* A map tab needs a body: called by the explorer when a dock request is
     consumed (fresh = true) and when a snapshot-restored tab mounts (fresh =
     false). Idempotent: an already-mounted body keeps its state — a re-dock
     of an open tab must never remount it (or flip its fresh flag). */
  ensure(rootId, fresh) {
    const key = String(rootId)
    if (this._roots.has(key)) return
    this._roots.set(key, { fresh: Boolean(fresh) })
    this.containerOf(key)
    this._notify()
  },
  /* The tab was closed (× button, doc gone, archive whole map): the body
     unmounts and its sync timers die; the stable container is destroyed with
     it. A later dock mounts a FRESH body in a new container. */
  drop(rootId) {
    const key = String(rootId)
    if (!this._roots.delete(key)) return
    const entry = this._containers.get(key)
    if (entry !== undefined) {
      entry.el.remove()
      this._containers.delete(key)
    }
    this._sessions.delete(key)
    this._notify()
  },
  /* Park the map's STABLE container into the explorer's strip placeholder for
     this tab: a plain appendChild move — the portal container identity never
     changes, so the body's fibers (doc, viewport, highlight, sync timers)
     survive untouched. Idempotent per placeholder: re-placing into the same
     element is a no-op (tab churn must not move the body around). The
     placeholder's own display:none keeps an inactive tab's body hidden while
     it stays mounted. */
  place(rootId, el) {
    if (el === null || el === undefined) return
    const entry = this._containers.get(String(rootId))
    if (entry === undefined || (entry.host === el && entry.el.parentElement === el)) return
    el.appendChild(entry.el)
    entry.host = el
  },
  /* The tab left the strip (closed elsewhere, explorer unmounted): park the
     stable container back into the hidden holding node. Works even when the
     placeholder was ALREADY removed by React (explorer teardown): appendChild
     re-parents the (possibly detached) container into the holding node. No
     notification: placement is pure DOM, no React state depends on it. */
  unplace(rootId) {
    const entry = this._containers.get(String(rootId))
    if (entry === undefined || entry.host === null) return
    mindmapHolding().appendChild(entry.el)
    entry.host = null
  },
  noteSession(rootId, sessionId) {
    this._sessions.set(String(rootId), String(sessionId))
  },
  /* Strip API: the mounted explorer registers one object with hasTab/closeTab/
     updateTab; doc-gone and title updates route through it while the tab is
     displayed, and fall back to persisted-snapshot fixups below otherwise. */
  registerStrip(api) { this._strip = api },
  unregisterStrip(api) { if (this._strip === api) this._strip = null },
  /* The map's doc is gone (root archived outside the map): close the tab when
     a strip shows it (the explorer's closeTab drops the body); otherwise fix
     the persisted family snapshot so the dead tab never restores, and drop
     the body. */
  docGone(rootId) {
    const key = String(rootId)
    const path = mindmapTabPath(key)
    const strip = this._strip
    if (strip !== null && strip.hasTab(path)) {
      strip.closeTab(path)
      return
    }
    this._removeFromSnapshot(key, path)
    this.drop(key)
  },
  /* The map's OWN title (doc.rootTitle) changed: keep the tab label in sync
     while the strip shows it, and always keep the persisted family snapshot
     current (a rename while the user is on another session must survive). The
     strip path carries the same name-equality guard as the snapshot path — a
     title fires on every sync fingerprint change (each folded turn), and a
     redundant updateTab would re-render the strip for nothing. */
  titleChange(rootId, title) {
    const key = String(rootId)
    const path = mindmapTabPath(key)
    const strip = this._strip
    if (strip !== null && strip.hasTab(path) && strip.tabName(path) !== title) {
      strip.updateTab(path, { name: title })
    }
    this._patchSnapshot(key, path, (tab) => {
      if (typeof tab.name === 'string' && tab.name === title) return tab
      return { ...tab, name: title }
    })
  },
  _snapshotStore() {
    return this.storeRef?.current ?? null
  },
  _snapshotValue(key) {
    const store = this._snapshotStore()
    if (store === null) return null
    const snap = store.getSnapshot()
    const value = snap?.previewSessions?.[key]
    return value !== undefined && value !== null && typeof value === 'object' ? value : null
  },
  /* Remove the map tab from the persisted family snapshot (key = root id, the
     one restore prefers for member sessions). The store action normalizes the
     activePath and deletes the entry when it empties out. */
  _removeFromSnapshot(key, path) {
    const store = this._snapshotStore()
    if (store === null) return
    const value = this._snapshotValue(key)
    if (value === null || !Array.isArray(value.tabs)) return
    const kept = value.tabs.filter(tab => tab === null || tab === undefined || tab.path !== path)
    if (kept.length === value.tabs.length) return
    store.actions.rememberPreviewSession(key, { ...value, tabs: kept })
  },
  _patchSnapshot(key, path, patch) {
    const store = this._snapshotStore()
    if (store === null) return
    const value = this._snapshotValue(key)
    if (value === null || !Array.isArray(value.tabs)) return
    let changed = false
    const tabs = value.tabs.map(tab => {
      if (tab === null || tab === undefined || tab.path !== path) return tab
      const next = patch(tab)
      if (next === tab) return tab
      changed = true
      return next
    })
    if (!changed) return
    store.actions.rememberPreviewSession(key, { ...value, tabs })
  },
}

/* React calls the useSyncExternalStore subscribe/getSnapshot as BARE function
   references — a detached object method would lose `this` (subscribe would
   throw on `this._listeners`). Same wrapper convention as useMindmapRegistry. */
const subscribeHost = listener => mindmapViewHost.subscribe(listener)
const hostVersion = () => mindmapViewHost.getVersion()

/* Rendered once by AppFrame (always mounted, even without a workspace): owns
   every open map body. The bodies portal into their own STABLE containers
   (created per body, never re-keyed); the current explorer physically parks
   those containers into its strip placeholders (or the hidden holding node
   while away) with plain DOM moves. */
export function MindMapHost({ currentSession, useSessions, mindmapActions, settingsStore, previewSessionsStore }) {
  /* The away-case snapshot fixups need the store; it is stable for the app's
     lifetime, so an inline assignment is idempotent. */
  mindmapViewHost.storeRef.current = previewSessionsStore
  useSyncExternalStore(subscribeHost, hostVersion)
  const roots = mindmapViewHost.roots()
  return h(Fragment, null,
    ...roots.map(rootId => h(MindMapBody, {
      currentSession,
      key: rootId,
      mindmapActions,
      rootId,
      settingsStore,
      useSessions,
    })))
}

function MindMapBody({ rootId, currentSession, useSessions, mindmapActions, settingsStore }) {
  /* Fresh-dock is read at mount (MindMapView captures the prop into a ref and
     then consumes the flag via onFreshConsumed): a later dock of the
     already-open tab must not flip this body into "land the chat on the
     remembered session" mode, and no later remount may replay it either. */
  const freshDock = mindmapViewHost.isFresh(String(rootId))
  /* The map's session follows the HARNESS current session whenever it is a
     member of this family (a sidebar-entry / switcher switch drives the chat
     directly and the highlight must follow); otherwise the last map-internal
     selection, falling back to the root. Mirrors the old per-explorer logic. */
  const sessionId = useMemo(() => {
    const current = currentSession === undefined || currentSession === null
      ? undefined
      : String(currentSession)
    if (current !== undefined
      && (current === String(rootId) || mindmapRegistry.rootOf(current) === String(rootId))) {
      return current
    }
    return mindmapViewHost.sessionOf(String(rootId)) ?? String(rootId)
  }, [currentSession, rootId])
  /* Portal target: the body's OWN stable container — created once per body and
     never re-keyed. Placement (strip placeholder vs hidden holding node) is a
     plain DOM move done by the explorer, invisible to React: same fibers, the
     body's state (doc, viewport, highlight) survives every session switch. */
  const target = mindmapViewHost.containerOf(String(rootId))
  return createPortal(h(MindMapView, {
    archiveSession: mindmapActions.archiveSession,
    createSession: mindmapActions.createSession,
    deleteDoc: mindmapActions.deleteDoc,
    forkAt: mindmapActions.forkAt,
    freshDock,
    key: rootId,
    listWorkspaces: mindmapActions.listWorkspaces,
    loadDoc: mindmapActions.loadDoc,
    onDocGone: () => mindmapViewHost.docGone(String(rootId)),
    onFreshConsumed: () => mindmapViewHost.consumeFresh(String(rootId)),
    onTitleChange: (title) => mindmapViewHost.titleChange(String(rootId), title),
    openSession: (id) => {
      mindmapActions.openSession(String(id))
      mindmapViewHost.noteSession(String(rootId), String(id))
    },
    renameDoc: mindmapActions.renameDoc,
    renameSession: mindmapActions.renameSession,
    saveDoc: mindmapActions.saveDoc,
    sessionId,
    settingsStore,
    syncDoc: mindmapActions.syncDoc,
    useSessions,
  }), target)
}