import { clampFontPercent, PREVIEW_SESSION_MAX } from './constants.js'
import { isAbsoluteWorkspacePath, rewriteRelativePath } from './paths.js'
import { normalizeMusicPrefs } from './music-prefs.js'

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
/* Synthetic tab path of a music-workshop document: unique per open score and never a real workspace path. The id is minted client-side and stays stable for the tab's whole life (a save only changes savedPath/name). */
export function musicTabPath(id) { return `music:${String(id)}` }
export function isMusicTab(tab) { return tab !== null && tab !== undefined && tab.kind === 'music' }
/* Synthetic tab path of the console file-permission page. The scope key is the session or mind-map
   root it belongs to, so opening the same scope twice activates the existing tab. */
export function permissionTabPath(scopeKey) { return `permissions:${String(scopeKey)}` }
export function isPermissionTab(tab) { return tab !== null && tab !== undefined && tab.kind === 'permissions' }
/* A tab rendering something other than a workspace file (docked mind map, opened plan, change review, music score, permission page): no file read, draft, editor state or tree selection. Plan/review tabs are dropped from every persisted snapshot; a docked map, a music score and the workspace-level permission page DO persist. */
export function isSyntheticTab(tab) { return isMindmapTab(tab) || isPlanTab(tab) || isReviewTab(tab) || isMusicTab(tab) || isPermissionTab(tab) }
/* Whether a tab is dropped from every persisted snapshot: an external (dropped-in or
   outside-workspace) tab whose content lives only in memory, an opened plan, or a turn's
   change review. The permission page is NOT here: it is a workspace-level tab (the workspace
   anchor snapshot owns it, and selectStoredPreviewSession merges it into every session page).
   A caller deciding "is there real content to persist" must ask here, or a session-only tab
   would write an empty snapshot over anchor keys holding another session's tabs. */
export function isUnpersistedTab(tab) {
  return tab === null || tab === undefined || tab.external === true || isPlanTab(tab) || isReviewTab(tab)
}
/* Family ROOT session id of a mind-map tab (the sessionId stamp, falling back to the synthetic path's root part). */
export function mindmapRootIdOfTab(tab) {
  if (tab !== null && tab !== undefined && typeof tab.sessionId === 'string' && tab.sessionId !== '') return tab.sessionId
  const path = tab === null || tab === undefined || typeof tab.path !== 'string' ? '' : tab.path
  return path.startsWith('mindmap:') ? path.slice('mindmap:'.length) : path
}
/* Largest score snapshot a persisted tab may carry. A score is small JSON; the cap only
   exists so a pathological document cannot bloat localStorage past its quota (the file on
   disk is the durable copy, the snapshot is a refresh convenience). */
const MUSIC_DOC_PERSIST_MAX = 200_000

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
       size" — where a tab returns to when its value is cleared — so it stays undefined rather than
       defaulting to 100, and rides the same snapshot as the tab. */
    fontPercent: Number.isFinite(tab.fontPercent) ? clampFontPercent(tab.fontPercent) : undefined,
    /* A read-only preview of a file OUTSIDE the workspace: it carries BOTH `external`
       (no draft, no save, no change poll, no persistence) and `outside` (the Remote may
       read its absolute path), which is what lets its text render at all. */
    outside: Boolean(tab.outside),
    /* A mind-map tab carries the map's ROOT session id and renders a placeholder for the global map host's body container instead of a file. dockedAt records the persistence family key the tab was docked on, so restore can tell a map opened in this session from one leaked in from another. A plan tab carries its dsh-resource address in the synthetic path. */
    dockedAt: typeof tab.dockedAt === 'string' && tab.dockedAt !== '' ? tab.dockedAt : null,
    kind: tab.kind === 'mindmap' ? 'mindmap' : tab.kind === 'plan' ? 'plan' : tab.kind === 'review' ? 'review' : tab.kind === 'music' ? 'music' : tab.kind === 'permissions' ? 'permissions' : 'file',
    /* A music tab keeps its score in the tab so a refresh restores the work; savedPath is the
       last file it was written to, and musicRev lets the snapshot fingerprint notice edits. */
    musicDoc: tab.kind === 'music' && tab.musicDoc !== null && typeof tab.musicDoc === 'object' ? tab.musicDoc : null,
    musicRev: Number.isFinite(tab.musicRev) ? Math.max(0, Math.floor(tab.musicRev)) : 0,
    savedPath: typeof tab.savedPath === 'string' && tab.savedPath !== '' ? tab.savedPath : null,
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
/* Persisted copy of a tab: like the live clone, but clean tabs carry no text — persisting every full draft hit the localStorage quota; clean content is re-read on restore, only dirty tabs need their draft. */
function serializePreviewTab(tab) {
  const clone = clonePreviewTab(tab)
  if (clone === null) return null
  // "Saving…" only exists while a save is in flight; never persist it as a stale banner.
  if (tab.saving) clone.status = undefined
  // Error statuses are session-transient (replaying one would flash a stale banner), so only they are dropped.
  if (clone.status?.error === true) clone.status = undefined
  // Dropped-in AND outside-workspace files are session-only previews: content lives only in memory, so refresh drops them from every persisted snapshot.
  if (clone.external) return null
  /* A plan tab is a session-only rendering of a harness plan resource: its text is re-read from the session log (or expires), so persisting it would only store a path that must be re-resolved anyway. */
  if (clone.kind === 'plan') return null
  /* A review tab renders one turn's changes read from the Host while that turn's Session lives:
     persisting the synthetic path would only restore a tab that must re-read (or has nothing left). */
  if (clone.kind === 'review') return null
  // localStorage keeps only metadata, never file content: the runtime-only draftKnown marker tells a live tab apart from this content-free persisted copy.
  clone.baseText = ''
  clone.draft = ''
  clone.draftKnown = false
  /* A score snapshot rides the tab; an oversized document is dropped rather than
     blowing the localStorage quota — the saved file stays the durable copy. */
  if (clone.kind === 'music' && clone.musicDoc !== null) {
    let text = ''
    try {
      text = JSON.stringify(clone.musicDoc)
    } catch {
      text = ''
    }
    if (text === '' || text.length > MUSIC_DOC_PERSIST_MAX) clone.musicDoc = null
  }
  return clone
}
/* Cap stored sessions: keep the PREVIEW_SESSION_MAX most recently updated. */
export function prunePreviewSessions(draft) {
  const entries = Object.entries(draft.previewSessions ?? {})
  if (entries.length <= PREVIEW_SESSION_MAX) return
  /* Missing timestamps sort as newest, so genuinely-old stamped sessions are pruned first; Number() coercion keeps the sort from yielding NaN. */
  const stampOf = entry => {
    const value = Number(entry?.[1]?.updatedAt)
    return Number.isFinite(value) ? value : Infinity
  }
  entries.sort((a, b) => stampOf(b) - stampOf(a))
  for (const [key] of entries.slice(PREVIEW_SESSION_MAX)) delete draft.previewSessions[key]
}
/* A temporary ("preview") tab: the slot a single file-tree click opens, displaced IN PLACE
   by the next single click on another file. It is runtime-only — clonePreviewTab never
   carries the flag, so a restored tab is always permanent — and a pinned tab is never one. */
export function isTemporaryTab(tab) {
  return tab !== null && tab !== undefined && tab.temporary === true && tab.pinned !== true
}
/** Whether `path` already has a tab. THE existence predicate: a future tab kind keying on
 *  something other than `path` must be fixed here alone. */
export function hasTabPath(tabs, path) {
  return (Array.isArray(tabs) ? tabs : []).some(tab => tab.path === path)
}
/** Apply `patch` (an object, or a function of the tab) to the tab at `path`, returning the SAME array
 *  when no tab matches — so a patch for a closed tab cannot re-render or rewrite the snapshot. */
export function patchTab(tabs, path, patch) {
  const current = Array.isArray(tabs) ? tabs : []
  if (!hasTabPath(current, path)) return current
  return current.map(tab => {
    if (tab.path !== path) return tab
    const nextPatch = typeof patch === 'function' ? patch(tab) : patch
    return { ...tab, ...nextPatch }
  })
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
  return hasTabPath(current, tab.path) ? promoteTemporaryTab(current, tab.path) : [...current, tab]
}
/* Single-click preview open. An already-open target is returned untouched — the caller only
   activates it: re-clicking a temporary tab must not promote it, and the existing temporary slot
   stays. Otherwise the temporary slot is replaced IN PLACE, so the strip never reorders. A
   temporary tab holding unsaved work is never displaced: it is promoted to permanent and the new
   file opens in a fresh temporary slot (a click must not bin edits the 1s debounced staging write
   may not have persisted yet). Returns { tabs, replacedPath }: replacedPath is the displaced tab,
   whose runtime refs the caller drops; it is clean by construction, so nothing is flushed. */
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
     (or with another session's) it would mount a foreign map in this strip, so such a tab is dropped.
     The stamp is part of the format — a snapshot lacking it is not interpreted, it is cleaned (persisted-state.js). */
  const family = familyKey === undefined || familyKey === null ? null : String(familyKey)
  const seen = new Set()
  const tabs = Array.isArray(value?.tabs)
    ? value.tabs.map(clonePreviewTab).filter((tab) => {
        if (tab === null || seen.has(tab.path) || tab.external === true) return false
        /* A FILE tab's path is a workspace-relative tree path: an absolute path is not a tree path
           (the Host refuses it with 400 invalid-path), so restoring one would only fire a doomed read on every load. */
        if (tab.kind === 'file' && isAbsoluteWorkspacePath(tab.path)) return false
        if (tab.kind === 'mindmap' && (tab.dockedAt === null || tab.sessionId === null)) return false
        /* A music tab's synthetic path is the only address it has: anything else would be a
           file read with a fabricated path, so a malformed one is dropped on restore. */
        if (tab.kind === 'music' && (typeof tab.path !== 'string' || !tab.path.startsWith('music:'))) return false
        /* A permission tab's synthetic path is its only address; a malformed one would mount the
           page without a scope. Its path is rewritten to the current family when selected. */
        if (tab.kind === 'permissions' && (typeof tab.path !== 'string' || !tab.path.startsWith('permissions:'))) return false
        if (family !== null && tab.kind === 'mindmap' && tab.dockedAt !== family) return false
        seen.add(tab.path)
        return true
      })
    : []
  const activePath = typeof value?.activePath === 'string' && tabs.some(tab => tab.path === value.activePath)
    ? value.activePath
    : (tabs[0]?.path ?? null)
  const expanded = Array.isArray(value?.expanded)
    /* A directory list holds the same workspace-relative tree paths as the tabs, so an absolute
       entry can never become valid and is dropped here rather than re-firing a refused read on every load. */
    ? [...new Set(value.expanded.filter(path => typeof path === 'string' && path !== '' && !isAbsoluteWorkspacePath(path)))]
    : []
  return { activePath, tabs, expanded, musicPrefs: normalizeMusicPrefs(value?.musicPrefs) }
}
/* The permission page is a WORKSPACE-LEVEL tab: it is written into the workspace anchor snapshot and
   merged into whichever session page is currently mounted. Session snapshots may contain a copy (the
   explorer persists one value under every anchor), but that copy is stripped here so closing the tab
   in one session cannot resurrect it from another session's old snapshot. */
function mergeWorkspacePermission(selection, workspaceValue, workspaceKey, familyKey) {
  const value = selection.value
  const family = familyKey === undefined || familyKey === null ? null : String(familyKey)
  const sourceTabs = Array.isArray(value?.tabs) ? value.tabs : []
  const workspacePermission = (workspaceValue?.tabs ?? []).find(isPermissionTab)
  const isWorkspaceSelection = workspaceKey !== null && String(selection.key) === workspaceKey
  const permission = isWorkspaceSelection ? ((sourceTabs.find(isPermissionTab)) ?? workspacePermission) : workspacePermission
  const hadPermission = sourceTabs.some(isPermissionTab)
  if (permission === undefined && !hadPermission) return selection
  const baseTabs = sourceTabs.filter(tab => !isPermissionTab(tab))
  if (family === null) {
    /* No session page is mounted: a permission tab would render its no-session state, so keep it out.
       Do not manufacture a value when none existed (an empty workspace selection must stay empty). */
    if (value === undefined || value === null) return selection
    const activePath = typeof value.activePath === 'string' && baseTabs.some(tab => tab.path === value.activePath)
      ? value.activePath
      : null
    return { key: selection.key, value: { ...value, tabs: baseTabs, activePath } }
  }
  const permissionPath = permission === undefined ? null : permissionTabPath(family)
  const tabs = permission === undefined ? baseTabs : [...baseTabs, { ...permission, path: permissionPath }]
  const originalActive = typeof value?.activePath === 'string' ? value.activePath : null
  const activeWasPermission = sourceTabs.some(tab => tab.path === originalActive && isPermissionTab(tab))
  let activePath = activeWasPermission ? permissionPath : originalActive
  if (activePath !== null && !tabs.some(tab => tab.path === activePath)) activePath = null
  if (value === undefined || value === null) {
    /* No snapshot at all for this session: a workspace-level permission tab is still restorable. */
    return permission === undefined ? selection : { key: selection.key, value: { tabs, activePath: permissionPath } }
  }
  return { key: selection.key, value: { ...value, tabs, activePath } }
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
  const workspaceKey = workspaceId === undefined || workspaceId === null ? null : String(workspaceId)
  const workspaceValue = workspaceKey !== null && has(workspaceKey) ? previewSessions[workspaceKey] : undefined
  const finish = selection => mergeWorkspacePermission(selection, workspaceValue, workspaceKey, currentSession)
  if (currentSession !== undefined) {
    const currentKey = String(currentSession)
    if (has(currentKey)) return finish({ key: currentKey, value: previewSessions[currentKey] })
    // Restore priority ② (development-notes §2): first snapshot of any session in this workspace.
    if (workspace !== undefined) {
      for (const sessionId of sessionIdsOf(workspace)) {
        const key = String(sessionId)
        if (has(key) && restorable(key) && !foreignMapTab(previewSessions[key])) return finish({ key, value: previewSessions[key] })
      }
    }
    if (workspaceKey !== null && has(workspaceKey) && restorable(workspaceKey) && !foreignMapTab(workspaceValue)) {
      return finish({ key: workspaceKey, value: workspaceValue })
    }
    return finish({ key: currentKey, value: undefined })
  }
  if (workspace !== undefined) {
    for (const sessionId of sessionIdsOf(workspace)) {
      const key = String(sessionId)
      if (has(key) && restorable(key) && !foreignMapTab(previewSessions[key])) return finish({ key, value: previewSessions[key] })
    }
  }
  if (workspaceKey !== null) {
    if (has(workspaceKey) && restorable(workspaceKey) && !foreignMapTab(workspaceValue)) return finish({ key: workspaceKey, value: workspaceValue })
    return finish({ key: workspaceKey, value: undefined })
  }
  return finish({ key: undefined, value: undefined })
}
export function serializePreviewSession(activePath, tabs, expanded, musicPrefs) {
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
    /* Per-session page settings ride the same snapshot: the preview page (not a global key)
       owns the model choice and the roll height, so each session keeps its own. */
    musicPrefs: normalizeMusicPrefs(musicPrefs),
  }
}
/* Structural identity for persistence dedup: what restore actually depends on (active path, tab paths + dirty flags, expanded dirs). Volatile fields must not participate, or the store would rewrite every render. */
export function previewSnapshotFingerprint(value) {
  const tabs = Array.isArray(value?.tabs) ? value.tabs : []
  // Restored state (encoding, per-tab text size) participates, or the decode / size would revert after a refresh and changing only it would never reach localStorage.
  // JSON.stringify (not ','/':' joins): file names may contain commas and colons, which could otherwise collide into the same fingerprint.
  const tabPart = JSON.stringify(tabs.map(tab =>
    [tab.path, tab.kind === 'mindmap' ? 'm' : tab.kind === 'music' ? 'u' : 'f', tab.kind === 'mindmap' ? (tab.sessionId ?? '') : '', tab.kind === 'mindmap' ? (tab.dockedAt ?? '') : '', tab.name, tab.dirty ? 1 : 0, tab.pinned ? 1 : 0, tab.encoding ?? '', tab.editing ? 1 : 0, tab.lineEnding ?? '', tab.bom ? 1 : 0, tab.baseRevision ?? '', tab.fontPercent ?? '', tab.kind === 'music' ? (tab.savedPath ?? '') : '', tab.kind === 'music' ? (tab.musicRev ?? 0) : '']))
  const expandedPart = JSON.stringify(Array.isArray(value?.expanded) ? [...value.expanded].sort() : [])
  const prefsPart = JSON.stringify(normalizeMusicPrefs(value?.musicPrefs))
  return `${value?.activePath ?? ''}|${tabPart}|${expandedPart}|${prefsPart}`
}
export function dropIndexFromEvent(event) {
  const tabNodes = event.currentTarget.querySelectorAll('.dsh-ws-preview-tab')
  for (let i = 0; i < tabNodes.length; i += 1) {
    const rect = tabNodes[i].getBoundingClientRect()
    if (event.clientX < rect.left + rect.width / 2) return i
  }
  return tabNodes.length
}
function rewritePreviewTab(tab, from, to, replacement) {
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


