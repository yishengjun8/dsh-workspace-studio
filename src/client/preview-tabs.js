import { PREVIEW_SESSION_MAX } from './constants.js'
import { rewriteRelativePath } from './paths.js'

export function entryFromPreviewTab(tab) { return { kind: 'file', name: tab.name, path: tab.path, symlink: Boolean(tab.symlink) } }
export function clonePreviewTab(tab) {
  if (tab === undefined || tab === null || typeof tab.path !== 'string') return null
  return {
    baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
    baseRevision: typeof tab.baseRevision === 'string' ? tab.baseRevision : null,
    bom: Boolean(tab.bom),
    dirty: Boolean(tab.dirty),
    draft: typeof tab.draft === 'string' ? tab.draft : '',
    // True only when this instance holds the tab's actual draft text; serialized snapshots reset it (they omit content).
    draftKnown: Boolean(tab.draftKnown),
    editing: Boolean(tab.editing),
    encoding: typeof tab.encoding === 'string' && tab.encoding !== '' ? tab.encoding : 'utf-8',
    external: Boolean(tab.external),
    lineEnding: typeof tab.lineEnding === 'string' ? tab.lineEnding : 'none',
    name: typeof tab.name === 'string' && tab.name !== '' ? tab.name : tab.path.slice(tab.path.lastIndexOf('/') + 1),
    path: tab.path,
    pinned: Boolean(tab.pinned),
    revision: tab.revision === undefined ? null : tab.revision,
    // Never persist/restore the in-flight flag: a refresh mid-save would leave a
    // tab stuck in "saving" with every action disabled and no recovery path.
    saving: false,
    scrollTop: Number.isFinite(tab.scrollTop) ? tab.scrollTop : 0,
    size: Number.isFinite(tab.size) ? tab.size : null,
    status: tab.status === undefined || tab.status === null
      ? undefined
      : { error: Boolean(tab.status.error), text: String(tab.status.text ?? '') },
    symlink: Boolean(tab.symlink),
  }
}
/* Persisted copy of a tab: like the live clone, but clean tabs carry no text —
 * persisting every full draft hit the localStorage quota, making setItem throw
 * and silently killing persistence (stale tabs on reload). Clean content equals
 * disk and is re-read on restore; only dirty tabs need their draft to survive. */
export function serializePreviewTab(tab) {
  const clone = clonePreviewTab(tab)
  if (clone === null) return null
  // "Saving…" only exists while a save is in flight; never persist it as a stale banner.
  if (tab.saving) clone.status = undefined
  // Error statuses (autosave failure, save conflict, ...) are session-transient:
  // replaying them on a later open would flash a stale error banner over the
  // fresh read. Informational statuses are harmless (the read pass overwrites
  // them), so only the error flag is dropped.
  if (clone.status?.error === true) clone.status = undefined
  // Dropped non-workspace files are session-only previews: content lives only
  // in memory (persisting it would re-introduce the quota blow-up the slim
  // serialization prevents), so refresh drops them from every persisted snapshot.
  if (clone.external) return null
  // localStorage keeps ONLY the dirty marker and tab metadata, never file
  // content or the snapshot (those live in the draft file, re-read on restore).
  // An empty draft can be real user input, so the runtime-only marker tells a
  // live tab apart from this content-free persisted representation.
  clone.baseText = ''
  clone.draft = ''
  clone.draftKnown = false
  return clone
}
/* Cap stored sessions: the freshest key survives; others keep the PREVIEW_SESSION_MAX most recently updated. */
export function prunePreviewSessions(draft) {
  const entries = Object.entries(draft.previewSessions ?? {})
  if (entries.length <= PREVIEW_SESSION_MAX) return
  /* A legacy session without `updatedAt` must not be treated as the oldest and
     evicted first: it pre-dates the timestamp field, and its next write stamps
     it. Sort missing timestamps as NEWEST so genuinely-old stamped sessions
     are pruned first; the legacy entry self-heals on the next remember. A
     non-numeric timestamp (polluted/legacy data) is coerced via Number() so
     the subtraction never yields NaN (which would leave the sort order
     undefined). */
  const stampOf = entry => {
    const value = Number(entry?.[1]?.updatedAt)
    return Number.isFinite(value) ? value : Infinity
  }
  entries.sort((a, b) => stampOf(b) - stampOf(a))
  for (const [key] of entries.slice(PREVIEW_SESSION_MAX)) delete draft.previewSessions[key]
}
/* Stable partition keeping every pinned tab ahead of all unpinned ones. */
export function orderPinnedFirst(tabs) {
  const pinned = []
  const unpinned = []
  for (const tab of tabs) (tab.pinned ? pinned : unpinned).push(tab)
  return [...pinned, ...unpinned]
}
export function normalizePreviewSession(value) {
  const seen = new Set()
  const tabs = Array.isArray(value?.tabs)
    ? value.tabs.map(clonePreviewTab).filter((tab) => {
        if (tab === null || seen.has(tab.path)) return false
        seen.add(tab.path)
        return true
      })
    : []
  const activePath = typeof value?.activePath === 'string' && tabs.some(tab => tab.path === value.activePath)
    ? value.activePath
    : (tabs[0]?.path ?? null)
  const expanded = Array.isArray(value?.expanded)
    ? [...new Set(value.expanded.filter(path => typeof path === 'string' && path !== ''))]
    : []
  return { activePath, tabs, expanded }
}
export function selectStoredPreviewSession(previewSessions, workspace, currentSession, workspaceId) {
  /* Own-key lookup only: a bare `previewSessions[key]` would match
     prototype-chain keys (constructor/toString). Root may be missing/polluted
     in localStorage; every `has` short-circuits on null/undefined so the
     function degrades to an empty restore instead of throwing. */
  const has = key => (previewSessions !== null && previewSessions !== undefined)
    && Object.prototype.hasOwnProperty.call(previewSessions, key)
  /* A borrowed template must carry real tabs: an entry with only tree expansion
     (or a stale empty shell) would restore an empty explorer and shadow a later
     non-empty snapshot. The current session's OWN snapshot is exempt — its own
     (possibly empty) state is the correct restore. */
  const restorable = key => {
    const value = previewSessions[key]
    return Array.isArray(value?.tabs) && value.tabs.length > 0
  }
  /* A malformed workspace object (missing sessionIds) must degrade like every
     other bad input here — never throw out of the render path. */
  const sessionIdsOf = workspace => Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
  if (currentSession !== undefined) {
    const currentKey = String(currentSession)
    if (has(currentKey)) return { key: currentKey, value: previewSessions[currentKey] }
    // Restore priority ② (development-notes §2): first snapshot of any session
    // in this workspace, so one without its own still restores the prior tabs.
    if (workspace !== undefined) {
      for (const sessionId of sessionIdsOf(workspace)) {
        const key = String(sessionId)
        if (has(key) && restorable(key)) return { key, value: previewSessions[key] }
      }
    }
    if (workspaceId !== undefined) {
      const workspaceKey = String(workspaceId)
      if (has(workspaceKey) && restorable(workspaceKey)) return { key: workspaceKey, value: previewSessions[workspaceKey] }
    }
    return { key: currentKey, value: undefined }
  }
  if (workspace !== undefined) {
    for (const sessionId of sessionIdsOf(workspace)) {
      const key = String(sessionId)
      if (has(key) && restorable(key)) return { key, value: previewSessions[key] }
    }
  }
  if (workspaceId !== undefined) {
    const workspaceKey = String(workspaceId)
    if (has(workspaceKey) && restorable(workspaceKey)) return { key: workspaceKey, value: previewSessions[workspaceKey] }
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
  // Root ('') is expanded by default and never stored; only real folders persist.
  const expandedList = expanded === undefined || expanded === null
    ? []
    : [...expanded].filter(path => typeof path === 'string' && path !== '').sort()
  return {
    activePath: activePath !== null && normalized.some(tab => tab.path === activePath) ? activePath : (normalized[0]?.path ?? null),
    tabs: normalized,
    expanded: expandedList,
  }
}
/* Structural identity for persistence dedup: what restore actually depends on
   (active path, tab paths + dirty flags, expanded dirs). Volatile fields
   (status, scrollTop, draft/baseText) must NOT participate — treating them as
   new snapshots would rewrite the store every render, remounting the explorer
   and aborting every in-flight request. */
export function previewSnapshotFingerprint(value) {
  const tabs = Array.isArray(value?.tabs) ? value.tabs : []
  // Restored-but-not-volatile metadata (e.g. encoding) participates: ignoring
  // it would skip the write and revert the decode after a refresh.
  // JSON.stringify (not ','/':' joins): file names may legally contain commas
  // and colons, and two different states could otherwise collide into the
  // same fingerprint, silently skipping a needed persistence write.
  const tabPart = JSON.stringify(tabs.map(tab =>
    [tab.path, tab.dirty ? 1 : 0, tab.pinned ? 1 : 0, tab.encoding ?? '', tab.editing ? 1 : 0, tab.lineEnding ?? '', tab.bom ? 1 : 0, tab.baseRevision ?? '']))
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