import { clampFontPercent, PREVIEW_SESSION_MAX } from './constants.js'
import { isAbsoluteWorkspacePath, rewriteRelativePath } from './paths.js'

export function entryFromPreviewTab(tab) { return { kind: 'file', name: tab.name, path: tab.path, symlink: Boolean(tab.symlink) } }
/* Synthetic tab path of a docked mind map (root session id): unique per map and never collides with a real workspace path. */
export function mindmapTabPath(rootId) { return `mindmap:${String(rootId)}` }
export function isMindmapTab(tab) { return tab !== null && tab !== undefined && tab.kind === 'mindmap' }
/* Synthetic tab path of an opened plan (its dsh-resource address): unique per plan and never collides with a real workspace path. */
export function planTabPath(address) { return `plan:${String(address)}` }
/* The plan address a plan tab renders ('' for every other tab). */
export function planAddressOfTab(tab) {
  const path = tab === null || tab === undefined || typeof tab.path !== 'string' ? '' : tab.path
  return path.startsWith('plan:') ? path.slice('plan:'.length) : ''
}
export function isPlanTab(tab) { return tab !== null && tab !== undefined && tab.kind === 'plan' }
/* Synthetic tab path of an opened change review (its dsh-resource address): unique per turn and never collides with a real workspace path. */
export function reviewTabPath(address) { return `review:${String(address)}` }
/* The review address a review tab renders ('' for every other tab). */
export function reviewAddressOfTab(tab) {
  const path = tab === null || tab === undefined || typeof tab.path !== 'string' ? '' : tab.path
  return path.startsWith('review:') ? path.slice('review:'.length) : ''
}
export function isReviewTab(tab) { return tab !== null && tab !== undefined && tab.kind === 'review' }
/* A tab that renders something other than a workspace file — a docked mind map, an opened plan, or a turn's change review. Such a tab has no file read, draft, editor state, or tree selection, and never enters the persisted snapshot. */
export function isSyntheticTab(tab) { return isMindmapTab(tab) || isPlanTab(tab) || isReviewTab(tab) }
/* Whether a tab is dropped from every persisted snapshot: an external (dropped-in
   or outside-workspace) tab whose content lives only in memory, an opened plan, or
   a turn's change review. A caller deciding "is there real content to persist"
   must ask here, or a session-only tab would count as content and write an empty
   snapshot over the anchor keys that may hold another session's saved tabs. */
export function isUnpersistedTab(tab) {
  return tab === null || tab === undefined || tab.external === true || isPlanTab(tab) || isReviewTab(tab)
}
/* Family ROOT session id of a mind-map tab (the sessionId stamp, falling back to the synthetic path's root part). */
export function mindmapRootIdOfTab(tab) {
  if (tab !== null && tab !== undefined && typeof tab.sessionId === 'string' && tab.sessionId !== '') return tab.sessionId
  const path = tab === null || tab === undefined || typeof tab.path !== 'string' ? '' : tab.path
  return path.startsWith('mindmap:') ? path.slice('mindmap:'.length) : path
}
export function clonePreviewTab(tab) {
  if (tab === undefined || tab === null || typeof tab.path !== 'string') return null
  return {
    baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
    baseRevision: typeof tab.baseRevision === 'string' ? tab.baseRevision : null,
    bom: Boolean(tab.bom),
    dirty: Boolean(tab.dirty),
    draft: typeof tab.draft === 'string' ? tab.draft : '',
    // True only when this instance holds the tab's actual draft text; serialized snapshots reset it.
    draftKnown: Boolean(tab.draftKnown),
    editing: Boolean(tab.editing),
    encoding: typeof tab.encoding === 'string' && tab.encoding !== '' ? tab.encoding : 'utf-8',
    external: Boolean(tab.external),
    /* This tab's own preview text size (percent). ABSENT means "follow the settings page's base
       size" — the state a tab returns to when its own value is cleared — so the field is left
       undefined rather than defaulted to 100, and it rides the same snapshot as the tab itself. */
    fontPercent: Number.isFinite(tab.fontPercent) ? clampFontPercent(tab.fontPercent) : undefined,
    /* A read-only preview of a file OUTSIDE the workspace: it carries BOTH
       `external` (no draft, no save, no change poll, no persistence) and
       `outside` (the Remote may read its absolute path), which is what lets its
       text render at all. */
    outside: Boolean(tab.outside),
    /* A mind-map tab carries the map's ROOT session id and renders a placeholder for the global map host's body container instead of a file. dockedAt records the persistence family key the tab was docked on, so restore can tell a map opened in this session from one leaked in from another. A plan tab carries its dsh-resource address in the synthetic path. */
    dockedAt: typeof tab.dockedAt === 'string' && tab.dockedAt !== '' ? tab.dockedAt : null,
    kind: tab.kind === 'mindmap' ? 'mindmap' : tab.kind === 'plan' ? 'plan' : tab.kind === 'review' ? 'review' : 'file',
    lineEnding: typeof tab.lineEnding === 'string' ? tab.lineEnding : 'none',
    name: typeof tab.name === 'string' && tab.name !== '' ? tab.name : tab.path.slice(tab.path.lastIndexOf('/') + 1),
    path: tab.path,
    pinned: Boolean(tab.pinned),
    revision: tab.revision === undefined ? null : tab.revision,
    sessionId: typeof tab.sessionId === 'string' && tab.sessionId !== '' ? tab.sessionId : null,
    // Never persist/restore the in-flight flag: a refresh mid-save would leave a tab stuck in "saving".
    saving: false,
    scrollTop: Number.isFinite(tab.scrollTop) ? tab.scrollTop : 0,
    size: Number.isFinite(tab.size) ? tab.size : null,
    status: tab.status === undefined || tab.status === null
      ? undefined
      : { error: Boolean(tab.status.error), text: String(tab.status.text ?? '') },
    symlink: Boolean(tab.symlink),
  }
}
/* Persisted copy of a tab: like the live clone, but clean tabs carry no text — persisting every full draft hit the localStorage quota. Clean content is re-read on restore; only dirty tabs need their draft to survive. */
export function serializePreviewTab(tab) {
  const clone = clonePreviewTab(tab)
  if (clone === null) return null
  // "Saving…" only exists while a save is in flight; never persist it as a stale banner.
  if (tab.saving) clone.status = undefined
  // Error statuses are session-transient: replaying them would flash a stale error banner, so only the error flag is dropped.
  if (clone.status?.error === true) clone.status = undefined
  // Dropped-in AND outside-workspace files are session-only previews: content lives only in memory, so refresh drops them from every persisted snapshot.
  if (clone.external) return null
  /* A plan tab is a session-only rendering of a harness plan resource: its text is re-read from the session log (or expires), so persisting it would only store a path that must be re-resolved anyway. */
  if (clone.kind === 'plan') return null
  /* A review tab renders one turn's changes read from the Host while that turn's
     Session lives: its tab is a live view, so persisting the synthetic path
     would only restore a tab that must re-read (or has nothing left to read). */
  if (clone.kind === 'review') return null
  // localStorage keeps only the dirty marker and tab metadata, never file content; the runtime-only marker tells a live tab apart from this content-free persisted representation.
  clone.baseText = ''
  clone.draft = ''
  clone.draftKnown = false
  return clone
}
/* Cap stored sessions: keep the PREVIEW_SESSION_MAX most recently updated. */
export function prunePreviewSessions(draft) {
  const entries = Object.entries(draft.previewSessions ?? {})
  if (entries.length <= PREVIEW_SESSION_MAX) return
  /* Sort missing timestamps as newest so genuinely-old stamped sessions are pruned first; a non-numeric timestamp is coerced via Number() so the sort never yields NaN. */
  const stampOf = entry => {
    const value = Number(entry?.[1]?.updatedAt)
    return Number.isFinite(value) ? value : Infinity
  }
  entries.sort((a, b) => stampOf(b) - stampOf(a))
  for (const [key] of entries.slice(PREVIEW_SESSION_MAX)) delete draft.previewSessions[key]
}
/* A temporary ("preview") tab: the slot a single file-tree click opens, displaced
   IN PLACE by the next single click on another file. It is runtime-only —
   clonePreviewTab never carries the flag, so a restored tab is always permanent —
   and a pinned tab is never a temporary slot. */
export function isTemporaryTab(tab) {
  return tab !== null && tab !== undefined && tab.temporary === true && tab.pinned !== true
}
/* Make the named tab permanent. Returns the SAME array when nothing changes, so a
   no-op promotion cannot re-render or rewrite the preview snapshot. */
export function promoteTemporaryTab(tabs, path) {
  const current = Array.isArray(tabs) ? tabs : []
  if (!current.some(tab => tab.path === path && tab.temporary === true)) return current
  return current.map(tab => tab.path === path ? { ...tab, temporary: false } : tab)
}
/* Permanent open (a double-click, the chat's file-open path, a search result): the
   target is promoted in place when it is already open, appended otherwise. */
export function openPermanentTab(tabs, tab) {
  const current = Array.isArray(tabs) ? tabs : []
  return current.some(item => item.path === tab.path) ? promoteTemporaryTab(current, tab.path) : [...current, tab]
}
/* Single-click preview open. A target that is already open is returned untouched
   (the caller only activates it: re-clicking a temporary tab must not promote it,
   and the existing temporary slot is not closed). Otherwise the temporary slot is
   replaced IN PLACE, so the strip never reorders. A temporary tab holding unsaved
   work is never displaced: it is promoted to permanent and the new file opens in a
   fresh temporary slot instead (a click must not bin edits that the 1s debounced
   staging write may not have persisted yet).
   Returns { tabs, replacedPath }: replacedPath is the displaced tab, whose runtime
   refs the caller drops. It is clean by construction, so nothing is flushed. */
export function openPreviewTab(tabs, tab) {
  const current = Array.isArray(tabs) ? tabs : []
  if (current.some(item => item.path === tab.path)) return { tabs: current, replacedPath: null }
  const index = current.findIndex(isTemporaryTab)
  if (index < 0) return { tabs: [...current, tab], replacedPath: null }
  const displaced = current[index]
  if (displaced.dirty === true || displaced.saving === true) {
    return {
      tabs: [...current.map(item => item.path === displaced.path ? { ...item, temporary: false } : item), tab],
      replacedPath: null,
    }
  }
  const next = current.slice()
  next[index] = tab
  return { tabs: next, replacedPath: displaced.path }
}
/* Partition keeping every pinned tab ahead of all unpinned ones. */
export function orderPinnedFirst(tabs) {
  const pinned = []
  const unpinned = []
  for (const tab of tabs) (tab.pinned ? pinned : unpinned).push(tab)
  return [...pinned, ...unpinned]
}
export function normalizePreviewSession(value, familyKey) {
  /* A docked mind-map tab must name the persistence family it was docked on: without that stamp
     (or with another session's) restoring it could mount a foreign map in this strip, so such a
     tab is not restorable and is dropped. The stamp is part of the format — a snapshot that lacks
     it is not interpreted, it is cleaned (see persisted-state.js). */
  const family = familyKey === undefined || familyKey === null ? null : String(familyKey)
  const seen = new Set()
  const tabs = Array.isArray(value?.tabs)
    ? value.tabs.map(clonePreviewTab).filter((tab) => {
        if (tab === null || seen.has(tab.path) || tab.external === true) return false
        /* A FILE tab's path is a workspace-relative tree path: an absolute path is not a tree path
           (the Host refuses it with 400 invalid-path), so restoring one would only fire a doomed
           directory read on every load. */
        if (tab.kind === 'file' && isAbsoluteWorkspacePath(tab.path)) return false
        if (tab.kind === 'mindmap' && (tab.dockedAt === null || tab.sessionId === null)) return false
        if (family !== null && tab.kind === 'mindmap' && tab.dockedAt !== family) return false
        seen.add(tab.path)
        return true
      })
    : []
  const activePath = typeof value?.activePath === 'string' && tabs.some(tab => tab.path === value.activePath)
    ? value.activePath
    : (tabs[0]?.path ?? null)
  const expanded = Array.isArray(value?.expanded)
    /* A directory list is made of the same workspace-relative tree paths as the tabs, so an
       absolute entry can never become valid and is dropped here rather than re-firing a refused
       read on every load. */
    ? [...new Set(value.expanded.filter(path => typeof path === 'string' && path !== '' && !isAbsoluteWorkspacePath(path)))]
    : []
  return { activePath, tabs, expanded }
}
export function selectStoredPreviewSession(previewSessions, workspace, currentSession, workspaceId) {
  /* Own-key lookup only: a bare `previewSessions[key]` would match prototype-chain keys. */
  const has = key => (previewSessions !== null && previewSessions !== undefined)
    && Object.prototype.hasOwnProperty.call(previewSessions, key)
  /* A borrowed template must carry real tabs, or it would restore an empty explorer and shadow a later non-empty snapshot. */
  const restorable = key => {
    const value = previewSessions[key]
    return Array.isArray(value?.tabs) && value.tabs.length > 0
  }
  /* Skip borrowed templates carrying a mind-map tab the current session does not belong to, or a foreign map would mount in the strip. */
  const foreignMapTab = value => (value?.tabs ?? []).some(tab => tab?.kind === 'mindmap'
    && typeof tab?.sessionId === 'string' && tab.sessionId !== ''
    && tab.sessionId !== String(currentSession))
  /* A malformed workspace object (missing sessionIds) must degrade like every other bad input here. */
  const sessionIdsOf = workspace => Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
  if (currentSession !== undefined) {
    const currentKey = String(currentSession)
    if (has(currentKey)) return { key: currentKey, value: previewSessions[currentKey] }
    // Restore priority ② (development-notes §2): first snapshot of any session in this workspace.
    if (workspace !== undefined) {
      for (const sessionId of sessionIdsOf(workspace)) {
        const key = String(sessionId)
        if (has(key) && restorable(key) && !foreignMapTab(previewSessions[key])) return { key, value: previewSessions[key] }
      }
    }
    if (workspaceId !== undefined) {
      const workspaceKey = String(workspaceId)
      if (has(workspaceKey) && restorable(workspaceKey) && !foreignMapTab(previewSessions[workspaceKey])) return { key: workspaceKey, value: previewSessions[workspaceKey] }
    }
    return { key: currentKey, value: undefined }
  }
  if (workspace !== undefined) {
    for (const sessionId of sessionIdsOf(workspace)) {
      const key = String(sessionId)
      if (has(key) && restorable(key) && !foreignMapTab(previewSessions[key])) return { key, value: previewSessions[key] }
    }
  }
  if (workspaceId !== undefined) {
    const workspaceKey = String(workspaceId)
    if (has(workspaceKey) && restorable(workspaceKey) && !foreignMapTab(previewSessions[workspaceKey])) return { key: workspaceKey, value: previewSessions[workspaceKey] }
    return { key: workspaceKey, value: undefined }
  }
  return { key: undefined, value: undefined }
}
export function serializePreviewSession(activePath, tabs, expanded) {
  const seen = new Set()
  const normalized = []
  for (const tab of tabs) {
    if (tab === undefined || tab === null || seen.has(tab.path)) continue
    seen.add(tab.path)
    const serialized = serializePreviewTab(tab)
    if (serialized === null) continue
    normalized.push(serialized)
  }
  // Root ('') is expanded by default and never stored.
  const expandedList = expanded === undefined || expanded === null
    ? []
    : [...expanded].filter(path => typeof path === 'string' && path !== '').sort()
  return {
    activePath: activePath !== null && normalized.some(tab => tab.path === activePath) ? activePath : (normalized[0]?.path ?? null),
    tabs: normalized,
    expanded: expandedList,
  }
}
/* Structural identity for persistence dedup: what restore actually depends on (active path, tab paths + dirty flags, expanded dirs). Volatile fields must not participate, or the store would rewrite every render. */
export function previewSnapshotFingerprint(value) {
  const tabs = Array.isArray(value?.tabs) ? value.tabs : []
  // Restored-but-not-volatile metadata (e.g. encoding) participates, or the decode would revert after a refresh.
  // JSON.stringify (not ','/':' joins): file names may contain commas and colons, which could otherwise collide into the same fingerprint.
  // The per-tab text size participates too: it is restored state, so changing ONLY it must still reach localStorage.
  const tabPart = JSON.stringify(tabs.map(tab =>
    [tab.path, tab.kind === 'mindmap' ? 'm' : 'f', tab.kind === 'mindmap' ? (tab.sessionId ?? '') : '', tab.kind === 'mindmap' ? (tab.dockedAt ?? '') : '', tab.name, tab.dirty ? 1 : 0, tab.pinned ? 1 : 0, tab.encoding ?? '', tab.editing ? 1 : 0, tab.lineEnding ?? '', tab.bom ? 1 : 0, tab.baseRevision ?? '', tab.fontPercent ?? '']))
  const expandedPart = JSON.stringify(Array.isArray(value?.expanded) ? [...value.expanded].sort() : [])
  return `${value?.activePath ?? ''}|${tabPart}|${expandedPart}`
}
export function dropIndexFromEvent(event) {
  const tabNodes = event.currentTarget.querySelectorAll('.dsh-ws-preview-tab')
  for (let i = 0; i < tabNodes.length; i += 1) {
    const rect = tabNodes[i].getBoundingClientRect()
    if (event.clientX < rect.left + rect.width / 2) return i
  }
  return tabNodes.length
}
export function rewritePreviewTab(tab, from, to, replacement) {
  const path = rewriteRelativePath(tab.path, from, to)
  if (path === tab.path) return tab
  const renamed = tab.path === from
  return {
    ...tab,
    name: renamed ? replacement.name : tab.name,
    path,
    symlink: renamed ? Boolean(replacement.symlink) : tab.symlink,
  }
}
export function rewritePreviewTabs(tabs, from, to, replacement) {
  return tabs.map(tab => rewritePreviewTab(tab, from, to, replacement))
}
export function ancestorDirectoryPaths(path) {
  const ancestors = ['']
  const parts = path.split('/').slice(0, -1)
  let cursor = ''
  for (const part of parts) {
    cursor = cursor === '' ? part : `${cursor}/${part}`
    ancestors.push(cursor)
  }
  return ancestors
}