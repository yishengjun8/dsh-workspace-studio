import { createElement as h, Fragment, useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN, CONTEXT_MENU_WIDTH, ENCODING_FALLBACK } from '../../constants.js'
import { translate } from '../../locale/index.js'
import { clamp, fileLabel, formatBytes, readOnlyReason } from '../../format.js'
import { copyText, defaultEntryName, entryNameError, entryPath, joinAbsolutePath, parentPath, pathBaseName, rewriteDirectoryMap, rewritePathMap, rewritePathSet, rewriteRelativePath, selectedLevelPath } from '../../paths.js'
import { ancestorDirectoryPaths, dropIndexFromEvent, entryFromPreviewTab, isMindmapTab, isPlanTab, isReviewTab, isSyntheticTab, isUnpersistedTab, mindmapRootIdOfTab, mindmapTabPath, normalizePreviewSession, orderPinnedFirst, planAddressOfTab, planTabPath, reviewAddressOfTab, reviewTabPath, rewritePreviewTabs, serializePreviewSession } from '../../preview-tabs.js'
import { IconFolder, IconNewFile, IconNewFolder, IconRefresh, IconSearch } from '../../icons.js'
import { encodingLabel, fetchEncodings, rawFileUrl, requestFsOperation, revealInExplorer, uploadExternalFile, WorkspaceApiError } from '../../api.js'
import { hasDraggedFiles, hasNormalFile } from '../../utils.js'
import { deleteEmergencyDraft, rewriteEmergencyDraftPath } from '../../drafts.js'
import { invalidateCachedSubtree, rewriteCachedPaths } from '../../file-cache.js'
import { mindmapDockStore } from '../../mindmap/registry.js'
import { mindmapViewHost } from '../../mindmap/host.js'
import { fileOpenRequestStore } from '../../open-request.js'
import { parseChangesReviewAddress, reviewOpenStore } from '../../changes-review.js'
import { planDocuments, planOpenStore } from '../../plan-open.js'
import { EncodingMenu, PanelHeader, PreviewToast, TabContextMenu, TreeContextMenu } from '../menus.js'
import { DeleteDialog, EncodingDialog, EntryDialog, SaveConflictDialog, SessionRenameDialog } from '../dialogs.js'
import { DropOverlay } from './drop.js'
import { ExplorerTree } from './tree.js'
import { PreviewPane } from './preview.js'
import { PreviewTabs } from './tabs.js'
import { SearchResults } from './search.js'
import { useDismissMenu } from './hooks/dismiss.js'
import { useEditorSession } from './hooks/editor-session.js'
import { usePreviewScrollbar } from './hooks/scrollbar.js'
import { useSearchState } from './hooks/search.js'
import { useSessionRename } from './hooks/session-rename.js'
import { isByteKind, isHtmlName, isImageName, isMarkdownName, isOfficeName, isPdfName, VIEW_EDIT, VIEW_PREVIEW, viewerCandidates } from '../../renderers/registry.js'
import { PlanView } from '../../renderers/plan-view.js'
import { ReviewView } from '../../renderers/review-view.js'

/* Whether a preview tab has no file-tree row: a docked mind map, an opened plan,
   or a file OUTSIDE the workspace. Such a tab selects nothing in the tree and is
   never revealed — revealing an outside path would ask the Host to list its
   "ancestor" directories, which the workspace fence refuses (400 invalid-path). */
function hasNoTreeRow(tab) {
  return isSyntheticTab(tab) || tab?.outside === true
}


export function WorkspaceExplorer({
  workspace, treePortalTarget, sessionTitle, sessionId, previewSessionId, renameSession, publishEditorContext, listDirectory, readFile, saveFile, createEntry, renameEntry, storedPreviewSession, persistPreviewSession, settingsStore, loadDraft, persistDraftFile, removeDraftFile, draftTree, checkFileChange, mindmapActions, sessionCwdOf,
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  /* Draft scope follows the shared persistence key: inside a mind map every member session shares one draft scope (the map's root), since the tab strip and its in-memory draft are shared. */
  const draftScopeId = sessionId === undefined ? `workspace:${workspace.workspaceId}` : `session:${previewSessionId ?? sessionId}`
  /* Restore under this mount's persistence family: a docked mind-map tab whose dockedAt (or root session id) does not match previewSessionId must not reappear here. */
  const initialPreviewSession = normalizePreviewSession(storedPreviewSession, previewSessionId)
  const [directories, setDirectories] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  const [tabs, setTabs] = useState(() => initialPreviewSession.tabs)
  const [activePath, setActivePath] = useState(() => initialPreviewSession.activePath)
  const [selected, setSelected] = useState(() => {
    if (initialPreviewSession.activePath === null) return undefined
    const activeTab = initialPreviewSession.tabs.find(tab => tab.path === initialPreviewSession.activePath)
    /* A restored tab with no tree row selects nothing in the file tree. */
    if (activeTab === undefined || hasNoTreeRow(activeTab)) return undefined
    return entryFromPreviewTab(activeTab)
  })
  const [reloadToken, setReloadToken] = useState(0)
  const [searchReveal, setSearchReveal] = useState()
  const [encodingMenu, setEncodingMenu] = useState()
  const [encodingDialog, setEncodingDialog] = useState()
  const [encodingPick, setEncodingPick] = useState('utf-8')
  const [encodingOptions, setEncodingOptions] = useState(ENCODING_FALLBACK)
  const [draggingPath, setDraggingPath] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)
  const [dropActive, setDropActive] = useState(false)
  const [previewToast, setPreviewToast] = useState()
  /* Viewer mode for the active file (registry-driven): 'edit' = the editor, 'preview' = the rendered view; per-file, reset on switch, and deliberately not persisted. */
  const [viewMode, setViewMode] = useState(VIEW_EDIT)
  const [entryDialog, setEntryDialog] = useState()
  const [entryDraft, setEntryDraft] = useState('')
  const [entryBusy, setEntryBusy] = useState(false)
  const [entryError, setEntryError] = useState()
  const [contextMenu, setContextMenu] = useState()
  const [tabContextMenu, setTabContextMenu] = useState()
  const [titleContextMenu, setTitleContextMenu] = useState()
  const [copyNotice, setCopyNotice] = useState()
  const [clipboard, setClipboard] = useState()
  /* Live mirror of the clipboard for in-flight guards: a paste's success handler must not clear a clipboard the user re-filled while the move was in flight. */
  const clipboardRef = useRef(clipboard)
  clipboardRef.current = clipboard
  const [deleteDialog, setDeleteDialog] = useState()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const menuRef = useRef(null)
  const tabMenuRef = useRef(null)
  const titleMenuRef = useRef(null)
  const encodingMenuRef = useRef(null)
  const requestedEncodingRef = useRef()
  // Set by the preview-header refresh action; the file-read effect consumes it and surfaces a "reloaded" status.
  const refreshPendingRef = useRef(null)
  // Like refreshPendingRef but for the cancel action: surfaces the "reloaded from disk" status once the discard re-read completes.
  const cancelRestoreRef = useRef(null)
  const previewTabsRef = useRef(null)
  // The file tree's native scroll container; its scrollTop must be restored after a refresh re-lists expanded directories.
  const treeScrollRef = useRef(null)
  const previewSectionRef = useRef(null)
  const previewScrollbarRef = useRef(null)
  const previewScrollThumbRef = useRef(null)
  const previewHeaderRef = useRef(null)
  const dropSuppressedRef = useRef(false)
  const toastSeqRef = useRef(0)
  const copyNoticeTimer = useRef()
  const requests = useRef(new Map())
  const mutationController = useRef()
  // Monotonic sequence for tree mutations: each op applies its UI result only while still the latest, so a stranded server-side op cannot corrupt the tree.
  const mutationSeqRef = useRef(0)
  const editorRef = useRef()
  const searchPanelContainerRef = useRef(null)
  const composingRef = useRef(false)
  const mounted = useRef(true)
  // Paths being re-read by an auto-sync reload; the polling tick skips them so a racing change check cannot bump reloadToken again.
  const reloadingPathsRef = useRef(new Set())
  const tabsRef = useRef(initialPreviewSession.tabs)
  const activePathRef = useRef(initialPreviewSession.activePath)
  const expandedRef = useRef(new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  // Live editor scroll positions, written per scroll event without touching React state or persistence.
  const scrollTopRef = useRef(new Map())
  const sessionEstablishedRef = useRef(false)
  /* Whether a snapshot with real content (a persistable tab or a tree expansion) was ever persisted for this mount; the skip guard below only applies while nothing real was ever persisted. */
  const persistedRealContentRef = useRef(initialPreviewSession.tabs.some(tab => !isUnpersistedTab(tab)) || (initialPreviewSession.expanded ?? []).length > 0)
  // Paths confirmed missing while restoring persisted expansion; later restore passes skip them until the cleaned snapshot is persisted.
  const prunedPathsRef = useRef(new Set())
  const previewTabsBootstrapped = useRef(Boolean(initialPreviewSession.tabs.length > 0 || initialPreviewSession.activePath !== null))
  const selectedDirectoryPath = selectedLevelPath(selected)
  const activatePath = useCallback((path) => {
    // A cancel marker belongs to one file; switching files must not let a stale marker decorate a later read.
    if (path !== activePathRef.current) cancelRestoreRef.current = null
    activePathRef.current = path
    setActivePath(path)
  }, [])
  useLayoutEffect(() => { tabsRef.current = tabs }, [tabs])
  useLayoutEffect(() => { activePathRef.current = activePath }, [activePath])
  useLayoutEffect(() => { expandedRef.current = expanded }, [expanded])
  const activeTab = useMemo(() => activePath === null ? undefined : tabs.find(tab => tab.path === activePath), [activePath, tabs])
  /* A mind-map tab hosts the global host's stable body container instead of a file: no file header, status bar, tree selection, or file read. A plan tab renders a harness plan document instead of a file and is equally chrome-free. */
  const activeMindmap = activeTab !== undefined && isMindmapTab(activeTab)
  const activePlan = activeTab !== undefined && isPlanTab(activeTab)
  /* A review tab draws its own body, header, and file list: the file header and
     the bottom status bar belong to a file tab and are hidden with it. */
  const activeReview = activeTab !== undefined && isReviewTab(activeTab)
  /* A session switch inside the same mind map keeps this explorer mounted, so the editor context would stay bound to the previous session; clear it for the new session. */
  const lastSessionIdRef = useRef(sessionId)
  useEffect(() => {
    if (lastSessionIdRef.current === sessionId) return
    lastSessionIdRef.current = sessionId
    if (activePath === null || isSyntheticTab(activeTab)) publishEditorContext(undefined)
  }, [activePath, activeTab, publishEditorContext, sessionId])
  const hasDirtyTabs = useMemo(() => tabs.some(tab => tab.dirty || tab.saving), [tabs])
  const updateActiveTab = useCallback((patch) => {
    const path = activePathRef.current
    if (path === null) return
    setTabs(current => current.map(tab => {
      if (tab.path !== path) return tab
      const nextPatch = typeof patch === 'function' ? patch(tab) : patch
      return { ...tab, ...nextPatch }
    }))
  }, [])
  const updateTab = useCallback((path, patch) => {
    setTabs(current => current.map(tab => {
      if (tab.path !== path) return tab
      const nextPatch = typeof patch === 'function' ? patch(tab) : patch
      return { ...tab, ...nextPatch }
    }))
  }, [])
  const persistSessionTabs = useCallback(() => {
    if (persistPreviewSession === undefined) return
    const hasTreeExpansion = Array.from(expandedRef.current).some(path => path !== '')
    const liveTabs = tabsRef.current
    /* External, plan, and review tabs serialize to null; when only such tabs exist with no tree expansion, writing would delete the anchor keys that may hold another session's tabs. The skip must not apply once real content was ever persisted, or the closed tab would resurrect on refresh. */
    const hasRealTabs = liveTabs.some(tab => !isUnpersistedTab(tab))
    const hasRealContent = hasRealTabs || hasTreeExpansion
    if (!hasRealContent && !persistedRealContentRef.current) return
    if (hasRealContent) persistedRealContentRef.current = true
    const meaningful = previewTabsBootstrapped.current || liveTabs.length !== 0 || activePathRef.current !== null || hasTreeExpansion
    // Skip until this session establishes state so a bare empty mount cannot clobber another session's snapshot; once established, keep writing.
    if (!meaningful && !sessionEstablishedRef.current) return
    if (meaningful) sessionEstablishedRef.current = true
    // Merge live scroll positions (kept out of React state so scrolling never re-renders or writes) into the serialized copy only.
    const snapshotTabs = liveTabs.map(tab => {
      const live = scrollTopRef.current.get(tab.path)
      return live === undefined ? tab : { ...tab, scrollTop: live }
    })
    persistPreviewSession(serializePreviewSession(activePathRef.current, snapshotTabs, expandedRef.current))
  }, [persistPreviewSession])
  // Persist on a microtask after commit so a pin + immediate refresh cannot race the localStorage write, and bursts coalesce into one write per event-loop tick.
  const persistPendingRef = useRef(false)
  const schedulePersist = useCallback(() => {
    if (persistPendingRef.current) return
    persistPendingRef.current = true
    queueMicrotask(() => {
      persistPendingRef.current = false
      persistSessionTabs()
    })
  }, [persistSessionTabs])
  useLayoutEffect(() => { schedulePersist() }, [activePath, schedulePersist, tabs, expanded])

  /* Dock requests from the sidebar mind-map entries and the session-header button: add/update the mind-map tab and activate it. A request is consumed only when its expectFamily matches this mount's previewSessionId. */
  useEffect(() => {
    const applyDock = () => {
      const { request } = mindmapDockStore.getSnapshot()
      if (request === null) return
      if (request.expectFamily !== (previewSessionId ?? null)) return
      const path = mindmapTabPath(request.rootId)
      /* The map needs a body in the global host: a new tab's body mounts fresh, while a re-dock of an already-open tab is a no-op. */
      mindmapViewHost.ensure(String(request.rootId), true)
      /* Stamp the persistence family the tab was docked on so a snapshot carrying the tab cannot leak it into unrelated sessions. */
      const dockedAt = previewSessionId ?? null
      setTabs(current => {
        const existing = current.find(tab => tab.path === path)
        if (existing !== undefined) {
          /* Re-dock refreshes the tab name (the map title may have changed) and re-anchors the stamp on this family. */
          return current.map(tab => tab.path === path ? { ...tab, name: request.name, dockedAt } : tab)
        }
        return [...current, {
          baseText: '',
          baseRevision: null,
          bom: false,
          dirty: false,
          dockedAt,
          bom: false,
          dirty: false,
          draft: '',
          draftKnown: false,
          editing: false,
          encoding: 'utf-8',
          external: false,
          kind: 'mindmap',
          lineEnding: 'none',
          name: request.name,
          path,
          pinned: false,
          revision: null,
          saving: false,
          scrollTop: 0,
          sessionId: request.rootId,
          size: null,
          status: undefined,
          symlink: false,
        }]
      })
      setSelected(undefined)
      activatePath(path)
      mindmapDockStore.consume()
    }
    if (mindmapDockStore.getSnapshot().request !== null) applyDock()
    return mindmapDockStore.subscribe(applyDock)
  }, [activatePath, previewSessionId])

  /* Open requests for harness plans (ui-plan's 「查看全文」 and the turn's plan card): the openResource router publishes them, and the explorer whose previewSessionId matches the request's family consumes one as a session-only plan tab. The tab carries the plan's dsh-resource address in its synthetic path; its body renders the temporary review document or the harness plan resource. */
  const applyPlanTitle = useCallback((path, title) => {
    const name = typeof title === 'string' ? title.trim() : ''
    if (name === '') return
    setTabs(current => {
      const tab = current.find(item => item.path === path)
      /* An unchanged name returns the same array, so a viewer reporting its title on every render cannot loop. */
      if (tab === undefined || tab.name === name) return current
      return current.map(item => item.path === path ? { ...item, name } : item)
    })
  }, [])
  useEffect(() => {
    const applyOpen = () => {
      const { request } = planOpenStore.getSnapshot()
      if (request === null) return
      /* Consumed by the explorer showing the plan's own session — the chat's session, or the map root whose preview strip the chat shares. Any other mount leaves the request pending for the matching one. */
      const family = request.expectFamily
      if (family !== (previewSessionId ?? null) && family !== (sessionId ?? null)) return
      const path = planTabPath(request.address)
      setTabs(current => current.some(tab => tab.path === path)
        ? current
        : [...current, {
          baseText: '',
          dirty: false,
          draft: '',
          draftKnown: false,
          editing: false,
          encoding: 'utf-8',
          external: false,
          /* Session-only: a plan tab is never persisted (preview-tabs drops it), and its address lives in the synthetic path. */
          kind: 'plan',
          lineEnding: 'none',
          name: request.name !== '' ? request.name : translate('plan.tab'),
          path,
          pinned: false,
          revision: null,
          saving: false,
          scrollTop: 0,
          sessionId: null,
          size: null,
          symlink: false,
        }])
      setSelected(undefined)
      activatePath(path)
      planOpenStore.consume()
    }
    if (planOpenStore.getSnapshot().request !== null) applyOpen()
    return planOpenStore.subscribe(applyOpen)
  }, [activatePath, previewSessionId, sessionId])

  /* Open requests for change reviews (the chat's changed-files card): the
     openResource router publishes them, and the explorer whose previewSessionId
     matches the request's family consumes one as a session-only review tab. The
     tab carries the review's dsh-resource address in its synthetic path plus the
     file index the card was clicked on; a later click on another row re-seeds
     that index on the SAME tab instead of opening a second one. */
  useEffect(() => {
    const applyOpen = () => {
      const { request } = reviewOpenStore.getSnapshot()
      if (request === null) return
      /* Consumed by the explorer showing the review's own session — the chat's
         session, or the map root whose preview strip the chat shares. Any other
         mount leaves the request pending for the matching one. */
      const family = request.expectFamily
      if (family !== (previewSessionId ?? null) && family !== (sessionId ?? null)) return
      const path = reviewTabPath(request.address)
      const coordinates = parseChangesReviewAddress(request.address)
      setTabs(current => current.some(tab => tab.path === path)
        ? current.map(tab => tab.path === path
          ? { ...tab, reviewIndex: request.index, reviewNav: (tab.reviewNav ?? 0) + 1 }
          : tab)
        : [...current, {
          baseText: '',
          dirty: false,
          draft: '',
          draftKnown: false,
          editing: false,
          encoding: 'utf-8',
          external: false,
          /* Session-only: a review tab is never persisted (preview-tabs drops
             it), and its address lives in the synthetic path. */
          kind: 'review',
          lineEnding: 'none',
          name: translate('review.tabName', { turn: String(coordinates?.turn ?? 1) }),
          path,
          pinned: false,
          revision: null,
          reviewIndex: request.index,
          reviewNav: 1,
          saving: false,
          scrollTop: 0,
          sessionId: null,
          size: null,
          symlink: false,
        }])
      setSelected(undefined)
      activatePath(path)
      reviewOpenStore.consume()
    }
    if (reviewOpenStore.getSnapshot().request !== null) applyOpen()
    return reviewOpenStore.subscribe(applyOpen)
  }, [activatePath, previewSessionId, sessionId])

  const editorSession = useEditorSession({
    workspace, sessionId: previewSessionId, draftScopeId, activePath, activeTab, tabsRef, activePathRef, updateTab, setTabs,
    setSelected, publishEditorContext, loadDraft, readFile, saveFile, persistDraftFile,
    removeDraftFile, draftTree, checkFileChange, settings, mounted, editorRef,
    refreshPendingRef, cancelRestoreRef, requestedEncodingRef, reloadingPathsRef,
    scrollTopRef, reloadToken, setReloadToken,
  })
  const {
    preview, editing, dirty, saving, draft, status, readEpoch, conflictDialog, baseText,
    setPreview, setEditing, setDirty, setSaving, setDraft, setStatus,
    publishContextState, save, cancel, discardDraft, resolveConflict,
    clearDraftFile, scheduleAutosave, invalidateDraftPath, nextDraftGeneration,
    clearAutosaveTimer,
    forgetPathRefs, rollbackDraftTree, lastWriteRef, draftTailsRef, draftGenerationsRef,
    watchSnapshotsRef, contentBaselinesRef, retainedStatesRef,
    readController: readControllerRef, saveController: saveControllerRef,
    flushAutosavesRef, migratePendingAutosavesRef,
  } = editorSession
  /* Retain CodeMirror EditorSessions per open file tab so re-activating a tab passes the entry back as `restore` and undo/selection/folds survive the view swap. */
  const retainEditorState = useCallback((path, session) => {
    retainedStatesRef.current.set(path, session)
  }, [retainedStatesRef])
  const search = useSearchState({ workspaceId: workspace.workspaceId, settings })
  const sessionRename = useSessionRename({ sessionId, sessionTitle, renameSession, mounted })
  const scrollbar = usePreviewScrollbar({ previewTabsRef, previewScrollbarRef, previewScrollThumbRef, activePath, tabsLength: tabs.length })
  const {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery,
    searchCaseSensitive, setSearchCaseSensitive, searchNameOnly, setSearchNameOnly,
    searchState, searchExpanded, runSearch, closeSearch, toggleSearchFile,
  } = search
  const {
    sessionRenameOpen, setSessionRenameOpen, sessionRenameDraft, setSessionRenameDraft,
    sessionRenameBusy, sessionRenameError, setSessionRenameError,
    beginSessionRename, closeSessionRename, confirmSessionRename,
  } = sessionRename
  const {
    scrollTabIntoView, handleTabsMouseEnter, handleTabsMouseLeave, handleTabsScroll,
    handleScrollbarMouseEnter, handleScrollbarMouseLeave, handleScrollbarPointerDown,
    handleScrollbarPointerMove, handleScrollbarPointerEnd,
  } = scrollbar
  // The session-rename dialog entry also closes the panel title's own menu.
  const openSessionRename = useCallback(() => { setTitleContextMenu(undefined); beginSessionRename() }, [beginSessionRename])
  const abortDirectoryRequests = useCallback(() => {
    for (const controller of requests.current.values()) controller.abort()
    requests.current.clear()
  }, [])
  const abortRequests = useCallback(() => {
    abortDirectoryRequests()
    readControllerRef.current?.abort()
    saveControllerRef.current?.abort()
    mutationController.current?.abort()
  }, [abortDirectoryRequests, readControllerRef, saveControllerRef])


  useEffect(() => {
    if (!hasDirtyTabs) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDirtyTabs])
  // Restore-time self-heal: a persisted expansion path missing from the workspace is dropped from the expanded set (with its descendants and per-directory state), and the cleaned snapshot is persisted so stale paths stop 404-ing.
  const pruneExpandedPath = useCallback((path) => {
    prunedPathsRef.current.add(path)
    const prefix = `${path}/`
    const expandedAffected = [...expandedRef.current].filter(p => p === path || p.startsWith(prefix))
    if (expandedAffected.length > 0) {
      for (const p of expandedAffected) expandedRef.current.delete(p)
      setExpanded(cur => {
        const next = new Set(cur)
        for (const p of expandedAffected) next.delete(p)
        return next
      })
    }
    setDirectories(cur => {
      const keys = [...cur.keys()].filter(key => key === path || key.startsWith(prefix))
      if (keys.length === 0) return cur
      const next = new Map(cur)
      for (const key of keys) next.delete(key)
      return next
    })
    // Persist the cleaned expansion so stale paths do not 404 again; mark the session established so the bare-mount guard does not suppress the self-heal.
    sessionEstablishedRef.current = true
    schedulePersist()
  }, [schedulePersist])
  const loadDirectory = useCallback(async (path, options) => {
    requests.current.get(path)?.abort()
    const controller = new AbortController()
    requests.current.set(path, controller)
    setDirectories(cur => {
      const next = new Map(cur)
      const prior = next.get(path)
      next.set(path, { state: 'loading', entries: prior?.entries ?? [] })
      return next
    })
    try {
      const result = await listDirectory(workspace.workspaceId, path, controller.signal)
      /* Apply only while this request is still the LATEST for the path (a
         superseded request can resolve after its abort — the fetch may have
         already settled) and the explorer is still mounted: a stale response
         must never overwrite a newer listing, and an unmounted explorer must
         never setState. */
      if (!mounted.current || requests.current.get(path) !== controller) return
      setDirectories(cur => {
        const next = new Map(cur)
        next.set(path, { state: 'ready', entries: result.entries })
        return next
      })
    } catch (error) {
      /* User cancellation is silent; a TIMEOUT is a real failure and must
         surface the error row (the request is timeout-bounded in api.js). */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      if (!mounted.current || requests.current.get(path) !== controller) return
      setDirectories(cur => {
        const next = new Map(cur)
        next.set(path, {
          state: 'error',
          entries: [],
          message: error instanceof Error ? error.message : String(error),
        })
        return next
      })
      if (options?.pruneOnMissing && error instanceof WorkspaceApiError
        && (error.code === 'path-not-found' || error.code === 'invalid-path')) {
        /* invalid-path too: a restored path the Host refuses as a tree path (an
           absolute one, say) can never become valid, so the self-heal must drop
           it instead of re-firing it on every load. */
        pruneExpandedPath(path)
      }
    } finally {
      if (requests.current.get(path) === controller) requests.current.delete(path)
    }
  }, [listDirectory, pruneExpandedPath, workspace.workspaceId])
  useEffect(() => { void loadDirectory('') }, [loadDirectory])
  // Restore the persisted expansion: fetch every restored directory's listing
  // so the tree renders its children. Mount-only; ancestors are already in the
  // persisted set, so nested folders appear in place.
  useEffect(() => {
    for (const path of initialPreviewSession.expanded ?? []) {
      if (path === '' || path === undefined) continue
      if (prunedPathsRef.current.has(path)) continue
      void loadDirectory(path, { pruneOnMissing: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const revealPath = useCallback((entry) => {
    const paths = entry.kind === 'directory'
      ? [...ancestorDirectoryPaths(entry.path), entry.path]
      : ancestorDirectoryPaths(entry.path)
    for (const path of paths) {
      setExpanded(cur => {
        if (cur.has(path)) return cur
        const next = new Set(cur)
        next.add(path)
        return next
      })
      /* Load every non-ready directory in the chain INCLUDING the entry itself
         when it is a directory: chooseDirectory only selects + reveals, so
         skipping the entry here left it stuck on the loading placeholder
         forever until the user collapsed and re-expanded it. */
      const isEntryDirectory = entry.kind === 'directory' && path === entry.path
      if ((isEntryDirectory || path !== entry.path) && directories.get(path)?.state !== 'ready') void loadDirectory(path)
    }
  }, [directories, loadDirectory])
  useLayoutEffect(() => {
    if (previewTabsBootstrapped.current) return
    if (tabsRef.current.length !== 0) return
    const next = normalizePreviewSession(storedPreviewSession, previewSessionId)
    if (next.tabs.length === 0) return
    previewTabsBootstrapped.current = true
    setTabs(next.tabs)
    activatePath(next.activePath)
    const nextTab = next.tabs.find(tab => tab.path === next.activePath)
    if (nextTab !== undefined) {
      if (hasNoTreeRow(nextTab)) {
        /* A tab with no tree row selects nothing in the file tree. */
        setSelected(undefined)
      } else {
        const entry = entryFromPreviewTab(nextTab)
        setSelected(entry)
        revealPath(entry)
      }
    }
  }, [activatePath, previewSessionId, revealPath, storedPreviewSession])
  // Late-arriving restore: if storedPreviewSession appears only after mount, merge its expanded paths and load them.
  useLayoutEffect(() => {
    const stored = normalizePreviewSession(storedPreviewSession)
    const paths = (stored.expanded ?? []).filter(path => !prunedPathsRef.current.has(path))
    if (paths.length === 0) return
    if (paths.every(path => expandedRef.current.has(path))) return
    setExpanded(cur => {
      const merged = new Set(cur)
      for (const path of paths) merged.add(path)
      return merged
    })
    for (const path of paths) {
      if (path !== '' && path !== undefined) void loadDirectory(path, { pruneOnMissing: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedPreviewSession])
  const chooseFile = useCallback((entry) => {
    previewTabsBootstrapped.current = true
    setSelected(entry)
    activatePath(entry.path)
    // A re-open re-runs the read pass, which re-seeds the change snapshot baseline so the polling tick never re-reports the just-loaded content.
    setTabs(current => current.some(tab => tab.path === entry.path)
      ? current
      : [...current, {
          baseText: '',
          dirty: false,
          draft: '',
          draftKnown: false,
          editing: false,
          name: entry.name,
          path: entry.path,
          pinned: false,
          saving: false,
          revision: null,
          scrollTop: 0,
          size: null,
          status: undefined,
          symlink: Boolean(entry.symlink),
          bom: false,
          lineEnding: 'none',
        }])
    revealPath(entry)
  }, [revealPath])
  const chooseDirectory = useCallback((entry) => {
    setSelected(entry)
    revealPath(entry)
  }, [revealPath])
  /* Read-only preview of a file OUTSIDE the workspace (the chat's file-open path
     can name one): the plugin's workspace-confined API cannot serve such a path,
     so the tab is session-only and its content is read through the harness
     workspace-files Remote instead. No tree selection (the tree has no row for
     it) and no reveal — expanding its "ancestors" would fire directory reads the
     Host refuses on sight, which is exactly the bug this path exists to avoid. */
  const openOutsideFile = useCallback((entry) => {
    previewTabsBootstrapped.current = true
    setSelected(undefined)
    activatePath(entry.path)
    setTabs(current => current.some(tab => tab.path === entry.path)
      ? current
      : [...current, {
          baseText: '',
          bom: false,
          dirty: false,
          draft: '',
          draftKnown: false,
          editing: false,
          external: true,
          lineEnding: 'none',
          name: entry.name,
          outside: true,
          path: entry.path,
          pinned: false,
          readOnlyReason: 'outside-workspace',
          revision: null,
          saving: false,
          scrollTop: 0,
          size: null,
          status: undefined,
          symlink: Boolean(entry.symlink),
        }])
  }, [activatePath])
  /* Open requests from the chat's file-open path: add/activate the file tab and optionally reveal a line. Consumed only when the request's workspace matches this mount's workspace. */
  useEffect(() => {
    const applyOpen = () => {
      const { request } = fileOpenRequestStore.getSnapshot()
      if (request === null) return
      if (request.workspaceId !== String(workspace.workspaceId)) return
      const entry = { kind: 'file', name: request.name, path: request.path, symlink: false }
      if (request.outside === true) openOutsideFile(entry)
      else chooseFile(entry)
      if (request.line !== undefined) {
        setSearchReveal({ line: request.line, column: 1, endColumn: 1, path: request.path })
      }
      fileOpenRequestStore.consume()
    }
    if (fileOpenRequestStore.getSnapshot().request !== null) applyOpen()
    return fileOpenRequestStore.subscribe(applyOpen)
  }, [chooseFile, openOutsideFile, workspace.workspaceId])
  // Open a non-workspace file dropped into the preview pane: upload its raw bytes, decode them into a read-only preview payload, and add a session-only external tab.
  const openExternalFile = useCallback(async (file, encoding) => {
    try {
      const bytes = await file.arrayBuffer()
      const result = await uploadExternalFile(bytes, file.name, undefined, encoding)
      if (!mounted.current) return true
      const path = `external:${(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
      const tab = {
        baseText: result.content,
        bom: Boolean(result.bom),
        dirty: false,
        draft: result.content,
        editing: false,
        encoding: result.encoding ?? 'utf-8',
        external: true,
        lineEnding: result.lineEnding ?? 'none',
        name: typeof result.name === 'string' && result.name !== '' ? result.name : file.name,
        path,
        pinned: false,
        revision: null,
        saving: false,
        scrollTop: 0,
        size: Number.isFinite(result.size) ? result.size : file.size,
        status: undefined,
        symlink: false,
      }
      previewTabsBootstrapped.current = true
      setTabs(current => current.some(item => item.path === path) ? current : [...current, tab])
      activatePath(path)
      setStatus({ text: translate('status.externalOpened', { name: tab.name }) })
      return true
    } catch (error) {
      /* A request TIMEOUT is a real failure, not a cancellation; surface it through the failure toast instead of counting the upload as success. */
      if ((error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') || !mounted.current) return true
      // Only normal (text) files preview; a non-text file reports the server's message via the toast.
      const message = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
        ? translate('editor.requestTimeout')
        : (error instanceof Error ? error.message : String(error))
      return message
    }
  }, [activatePath])
  const showPreviewToast = useCallback((text) => {
    toastSeqRef.current += 1
    setPreviewToast({ seq: toastSeqRef.current, text })
  }, [])
  const handlePreviewDrop = useCallback(async (event) => {
    setDropActive(false)
    // Folders carry no File objects; detect them via drag items so the drop
    // announces "cannot preview" instead of doing nothing.
    const hasFolder = Array.from(event.dataTransfer?.items ?? []).some((item) => {
      try {
        const entry = typeof item?.getAsEntry === 'function' ? item.getAsEntry() : item?.webkitGetAsEntry?.()
        return entry !== null && entry !== undefined && entry.isDirectory === true
      } catch {
        return false
      }
    })
    if (hasFolder) {
      showPreviewToast(translate('status.folderNotPreviewable'))
      return
    }
    // Every dropped file goes through the upload endpoint; the server rejects non-text files with a message the toast announces.
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    const results = await Promise.allSettled(files.map(file => openExternalFile(file)))
    if (!mounted.current) return
    const ok = results.filter(result => result.status === 'fulfilled' && result.value === true).length
    if (files.length > 1 && ok > 0) {
      setStatus({ text: translate('status.externalOpenedMany', { count: ok }) })
    }
    const failures = results
      .filter(result => result.status === 'fulfilled' && typeof result.value === 'string' && result.value !== '')
      .map(result => result.value)
    if (failures.length > 0) {
      showPreviewToast(files.length === 1
        ? failures[0]
        : translate('status.externalFailedMany', { count: failures.length }))
    }
  }, [openExternalFile, showPreviewToast])
  // File drags are intercepted in the capture phase on the whole preview section so CodeMirror's own drop handler cannot insert the file's text first; internal tab reorders carry no files and pass through. Enter/leave use a depth counter because Chrome's dragleave.relatedTarget is null.
  useEffect(() => {
    const section = previewSectionRef.current
    if (section === null) return undefined
    let depth = 0
    const resetDrop = () => {
      depth = 0
      dropSuppressedRef.current = false
      setDropActive(false)
    }
    const onDragEnter = (event) => {
      if (!hasDraggedFiles(event)) return
      // Suppress the harness chat drop mask over the preview so each area keeps its own response.
      event.preventDefault()
      event.stopPropagation()
      if (dropSuppressedRef.current) return
      if (hasNormalFile(event)) {
        depth += 1
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      } else if (event.dataTransfer) {
        // Images/folders are not preview targets (no highlight), but the drop stays allowed so the handler can announce "cannot preview".
        event.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDragOver = (event) => {
      if (!hasDraggedFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (dropSuppressedRef.current) return
      if (hasNormalFile(event)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        if (depth === 0) depth = 1
        setDropActive(true)
      } else if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDragLeave = (event) => {
  /* Firefox can clear dataTransfer.types on dragleave and OS file drags never fire window dragend, so decrement the depth unconditionally; the suppressed flag still stops the overlay from flashing. */
      depth = Math.max(0, depth - 1)
      if (depth === 0) {
        dropSuppressedRef.current = false
        setDropActive(false)
      }
    }
    const onDrop = (event) => {
      if (!hasDraggedFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      /* The mask's × marks this drag as suppressed: dropping after dismissing must not upload/open the file either. */
      if (dropSuppressedRef.current) {
        resetDrop()
        return
      }
      resetDrop()
      void handlePreviewDrop(event)
    }
    const onDragEnd = () => { resetDrop() }
    section.addEventListener('dragenter', onDragEnter, true)
    section.addEventListener('dragover', onDragOver, true)
    section.addEventListener('drop', onDrop, true)
    section.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      section.removeEventListener('dragenter', onDragEnter, true)
      section.removeEventListener('dragover', onDragOver, true)
      section.removeEventListener('drop', onDrop, true)
      section.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [handlePreviewDrop])
  const openEntryDialog = useCallback(kind => { setEntryDialog({ mode: 'create', kind, parentPath: selectedDirectoryPath }); setEntryDraft(defaultEntryName(kind)); setEntryError(undefined); composingRef.current=false }, [selectedDirectoryPath])
  const beginRename = useCallback(entry => {
    if (entry.kind === 'blocked' || entry.kind === 'other') return
    const prefix = entry.path === '' ? '' : `${entry.path}/`
    const affectedDirty = tabsRef.current.some(tab => tab.dirty || tab.saving
      ? tab.path === entry.path || (prefix !== '' && tab.path.startsWith(prefix))
      : false)
    if (affectedDirty || (dirty && activePath === entry.path)) {
      setStatus({ error: true, text: translate('editor.unsavedBlocked') })
      return
    }
    setEntryDialog({ mode: 'rename', entry })
    setEntryDraft(entry.name)
    setEntryError(undefined)
    composingRef.current = false
  }, [activePath, dirty])
  const closeEntryDialog=useCallback(()=>{if(entryBusy)return;setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false},[entryBusy])
  // The viewer mode is scoped to one file: switching files lands on that
  // file's default view — Markdown and HTML files open straight into their
  // rendered view (document preview / page preview), every other file in the
  // source editor. The tab lookup reads the refs kept fresh by the layout
  // effects above, so this effect keeps its activePath-only dependency.
  useEffect(() => {
    const tab = tabsRef.current.find(candidate => candidate.path === activePathRef.current)
    setViewMode(isHtmlName(tab?.name) || isMarkdownName(tab?.name) ? VIEW_PREVIEW : VIEW_EDIT)
  }, [activePath])
  const rewriteRuntimePaths = useCallback((from, to) => {
    lastWriteRef.current = rewritePathMap(lastWriteRef.current, from, to)
    draftGenerationsRef.current = rewritePathMap(draftGenerationsRef.current, from, to)
    scrollTopRef.current = rewritePathMap(scrollTopRef.current, from, to)
    /* The change-poll baseline must follow the move too, or the new path would start with no baseline and trigger a full re-check. */
    watchSnapshotsRef.current = rewritePathMap(watchSnapshotsRef.current, from, to)
    /* The content baseline and the retained editor session describe the same disk content, so they follow the move. */    contentBaselinesRef.current = rewritePathMap(contentBaselinesRef.current, from, to)
    const retainedNext = new Map()
    for (const [path, session] of retainedStatesRef.current) {
      retainedNext.set(rewriteRelativePath(path, from, to), session)
    }
    retainedStatesRef.current = retainedNext
    /* The global cache keys ride on the same path space: move the subtree. */
    rewriteCachedPaths(workspace.workspaceId, from, to)
  }, [workspace.workspaceId])
  /* Deps note (development-notes §16): this callback omits callbacks declared later in the body, since listing them would throw a TDZ ReferenceError; their identities are stable for the mount, so the omission is safe. */
  const submitEntryDialog=useCallback(()=>{if(entryBusy||entryDialog===undefined)return;/* A concurrent tree mutation would bump mutationSeq and drop this op's bookkeeping after the server already succeeded — refuse while one is in flight (same guard as pasteEntry). */if(mutationController.current!==undefined){setEntryError(translate('editor.operationBusy'));return}const trimmed=entryDraft.trim();const message=entryNameError(entryDraft);if(message!==undefined){setEntryError(message);return}const parentPathValue=entryDialog.mode==='create'?entryDialog.parentPath:parentPath(entryDialog.entry.path);const siblings=directories.get(parentPathValue)?.entries??[];if(entryDialog.mode==='create'){if(siblings.some(entry=>entry.name===trimmed)){setEntryError(translate('entry.duplicate'));return}}else if(trimmed===entryDialog.entry.name||siblings.some(entry=>entry.name===trimmed&&entry.path!==entryDialog.entry.path)){setEntryError(trimmed===entryDialog.entry.name?translate('entry.nameUnchanged'):translate('entry.duplicate'));return}const controller=new AbortController();mutationController.current=controller;setEntryBusy(true);setEntryError(undefined);const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;const request=(async()=>{if(entryDialog.mode==='rename'){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:entryDialog.entry.path,toPath:entryPath(parentPath(entryDialog.entry.path),trimmed)},controller.signal)}return entryDialog.mode==='create'?createEntry(workspace.workspaceId,entryDialog.parentPath,entryDialog.kind,trimmed,controller.signal):renameEntry(workspace.workspaceId,entryDialog.entry.path,trimmed,controller.signal)})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;const mode=entryDialog.mode;const sourcePath=mode==='create'?entryDialog.parentPath:entryDialog.entry.path;const nextStatus=mode==='create'?result.kind==='directory'?translate('status.createdFolder'):translate('status.createdFile'):result.kind==='directory'?translate('status.renamedFolder'):translate('status.renamedFile');composingRef.current=false;setEntryBusy(false);setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);setStatus({text:nextStatus});if(mode==='create'){setExpanded(cur=>{const next=new Set(cur);next.add(sourcePath);if(result.kind==='directory')next.add(result.path);return next});if(result.kind==='file'){previewTabsBootstrapped.current = true;setTabs(cur=>cur.some(tab=>tab.path===result.path)?cur:[...cur,{baseText:'',dirty:false,draft:'',editing:false,name:result.name,path:result.path,pinned:false,saving:false,scrollTop:0,size:null,status:undefined,symlink:Boolean(result.symlink),bom:false,lineEnding:'none',revision:null}]);activatePath(result.path)}setSelected(result);void loadDirectory(sourcePath);if(result.kind==='directory')void loadDirectory(result.path)}else{setDirectories(cur=>rewriteDirectoryMap(cur,sourcePath,result.path,result));setExpanded(cur=>rewritePathSet(cur,sourcePath,result.path));setTabs(cur=>rewritePreviewTabs(cur,sourcePath,result.path,result));rewriteRuntimePaths(sourcePath,result.path);migratePendingAutosavesRef.current?.(sourcePath,result.path);void rewriteEmergencyDraftPath(workspace.workspaceId,draftScopeId,sourcePath,result.path).catch(error=>{if(mounted.current)setStatus({error:true,text:translate('editor.autosaveFailed',{message:error instanceof Error?error.message:String(error)})})});{const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,sourcePath,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath)}setSelected(result);void loadDirectory(parentPath(sourcePath))}}).catch(error=>{const timedOut=error?.name==='AbortError'&&error?.reason?.name==='TimeoutError';if((error?.name==='AbortError'&&!timedOut)||!mounted.current||mutationSeq!==mutationSeqRef.current){return}if(entryDialog?.mode==='rename'&&draftMoveGeneration!==undefined){void rollbackDraftTree(entryDialog.entry.path,entryPath(parentPath(entryDialog.entry.path),trimmed))}setEntryBusy(false);setEntryError(timedOut?translate('editor.requestTimeout'):(error instanceof Error?error.message:String(error)))}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined;if(mounted.current)setEntryBusy(false)})},[createEntry,directories,draftScopeId,draftTree,entryBusy,entryDialog,entryDraft,loadDirectory,renameEntry,rewriteRuntimePaths,workspace.workspaceId])

  // The unmount cleanup must run exactly once per real unmount; snapshot the callbacks in refs so the effect stays stable.
  const persistSessionTabsRef = useRef(persistSessionTabs)
  persistSessionTabsRef.current = persistSessionTabs
  const publishEditorContextRef = useRef(publishEditorContext)
  publishEditorContextRef.current = publishEditorContext
  const abortRequestsRef = useRef(abortRequests)
  abortRequestsRef.current = abortRequests
  useEffect(() => {
    mounted.current = true
    return () => {
      flushAutosavesRef.current()
      persistSessionTabsRef.current()
      mounted.current = false
      clearTimeout(copyNoticeTimer.current)
      publishEditorContextRef.current(undefined)
      abortRequestsRef.current()
    }
  }, [])

  // Navigation never unmounts React, so flush pending auto-saves and persist the final tab session synchronously on page hide/unload.
  useEffect(() => {
    const flush = () => { flushAutosavesRef.current(); persistSessionTabsRef.current() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  /* Re-apply the tree's pre-refresh scrollTop over a short animation-frame window, since listings settle back over a few frames and one restore would land on an intermediate layout. */
  const restoreTreeScroll = useCallback((savedScrollTop, framesLeft = 12) => {
    const el = treeScrollRef.current
    if (el === null) return
    const maxScroll = el.scrollHeight - el.clientHeight
    const target = Math.min(savedScrollTop, Math.max(0, maxScroll))
    if (el.scrollTop !== target) el.scrollTop = target
    if (framesLeft > 0) requestAnimationFrame(() => { if (mounted.current) restoreTreeScroll(savedScrollTop, framesLeft - 1) })
  }, [])
  const refresh=useCallback(()=>{if(hasDirtyTabs){setStatus({error:true,text:translate('tree.refreshBlocked')});return}/* Refresh must not collapse the tree: snapshot the scroll position and expanded paths before clearing the listings, then re-list the root and every expanded directory so disk changes appear in place. */  const scrollEl=treeScrollRef.current;const savedScrollTop=scrollEl?.scrollTop??0;const expandedPaths=[...expandedRef.current].filter(path=>path!=='');abortDirectoryRequests();setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false;setDirectories(new Map());setStatus(undefined);const reloads=[loadDirectory(''),...expandedPaths.map(path=>loadDirectory(path,{pruneOnMissing:true}))];void Promise.allSettled(reloads).then(()=>{if(mounted.current)restoreTreeScroll(savedScrollTop)})},[abortDirectoryRequests,hasDirtyTabs,loadDirectory,restoreTreeScroll])
  const toggleDirectory=useCallback(entry=>{const path=entry.path;const opening=!expanded.has(path);setExpanded(cur=>{const next=new Set(cur);opening?next.add(path):next.delete(path);return next});if(opening){if(directories.get(path)?.state!=='ready')void loadDirectory(path);chooseDirectory(entry)}else setSelected(entry)},[chooseDirectory,directories,expanded,loadDirectory])
  const openContextMenu=useCallback((event,entry)=>{event.preventDefault();setSelected(entry);setContextMenu({entry,x:event.clientX,y:event.clientY})},[])
  const copyEntryPath=useCallback((entry,relative)=>{const value=relative?entry.path:joinAbsolutePath(workspace.path,entry.path);void copyText(value).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?(relative?translate('status.copiedRelative'):translate('status.copiedPath')):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[workspace.path])
  const copyEntryName=useCallback((entry)=>{void copyText(entry.name).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?translate('status.copiedName'):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[])
  const openInExplorer=useCallback((entry)=>{setContextMenu(undefined);const controller=new AbortController();revealInExplorer(workspace.workspaceId,entry.path,controller.signal).then(()=>{if(!mounted.current)return;setCopyNotice(translate('status.revealed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)}).catch(error=>{if(!mounted.current||error?.name==='AbortError')return;setCopyNotice(translate('status.revealFailed',{message:error instanceof Error?error.message:String(error)}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)})},[workspace.workspaceId])
  const copyEntryToClipboard=useCallback((entry,cut)=>{setContextMenu(undefined);setClipboard({workspaceId:workspace.workspaceId,path:entry.path,name:entry.name,kind:entry.kind,cut});setCopyNotice(cut?translate('status.cut'):translate('status.copied'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)},[workspace.workspaceId])
  const pasteEntry=useCallback((targetEntry)=>{if(clipboard===undefined||clipboard.workspaceId!==workspace.workspaceId)return;const targetDir=targetEntry.kind==='directory'?targetEntry.path:parentPath(targetEntry.path);const targetPath=entryPath(targetDir,pathBaseName(clipboard.path));if(clipboard.cut&&clipboard.path===targetPath)return;const wasCut=clipboard.cut;const affectedPrefix=clipboard.path===''?'':`${clipboard.path}/`;if(wasCut&&tabsRef.current.some(tab=>{if(!tab.dirty&&!tab.saving)return false;return tab.path===clipboard.path||(affectedPrefix!==''&&tab.path.startsWith(affectedPrefix))})){setStatus({error:true,text:translate('editor.unsavedBlocked')});return}/* A concurrent mutation would bump mutationSeq and drop this paste's bookkeeping after the fs move already succeeded — refuse while one is in flight. */if(mutationController.current!==undefined){setStatus({error:true,text:translate('editor.operationBusy')});return}const controller=new AbortController();mutationController.current=controller;const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;let draftMoveFailed=false;const request=(async()=>{const result=await requestFsOperation(workspace.workspaceId,{action:wasCut?'move':'copy',source:clipboard.path,target:targetPath},controller.signal);if(wasCut){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:clipboard.path,toPath:result.path},controller.signal).catch(async error=>{if(!mounted.current)return;draftMoveFailed=true;console.warn('workspace-studio: draft move after fs move failed:',error);setStatus({error:true,text:translate('status.movedDraftWarning')});/* The old-path draft is the ONLY persistent copy of the user's unsaved edits: deleting it on a failed move (the old behavior) could lose them if the page refreshes before the next autosave lands on the new path. Retry once with a fresh generation (the failure is usually a transient generation race with a concurrent autosave); if the retry also fails, KEEP the old-path draft — a harmless zombie that only restores if a file appears at the old path again — and warn. */try{await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:nextDraftGeneration('__tree__'),fromPath:clipboard.path,toPath:result.path},controller.signal);draftMoveFailed=false}catch(retryError){if(mounted.current)console.warn('workspace-studio: draft move retry also failed; keeping draft at source path:',retryError)}})}return result})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;setContextMenu(undefined);setStatus(draftMoveFailed?{error:true,text:translate('status.movedDraftWarning')}:{text:wasCut?translate('status.moved'):translate('status.pasted')});if(wasCut){const source=clipboard.path;if(clipboardRef.current?.path===source&&clipboardRef.current?.cut===true)setClipboard(undefined);setSelected(result);setDirectories(cur=>rewriteDirectoryMap(cur,source,result.path,result));setExpanded(cur=>rewritePathSet(cur,source,result.path));setTabs(cur=>rewritePreviewTabs(cur,source,result.path,result));rewriteRuntimePaths(source,result.path);migratePendingAutosavesRef.current?.(source,result.path);void rewriteEmergencyDraftPath(workspace.workspaceId,draftScopeId,source,result.path).catch(error=>{if(mounted.current)setStatus({error:true,text:translate('editor.autosaveFailed',{message:error instanceof Error?error.message:String(error)})})});const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,source,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath);void loadDirectory(parentPath(source));void loadDirectory(targetDir)}else{void loadDirectory(targetDir)}}).catch(error=>{const timedOut=error?.name==='AbortError'&&error?.reason?.name==='TimeoutError';if((error?.name==='AbortError'&&!timedOut)||!mounted.current||mutationSeq!==mutationSeqRef.current)return;setContextMenu(undefined);const failedMessage=timedOut?translate('editor.requestTimeout'):(error instanceof Error?error.message:String(error));setCopyNotice(translate(wasCut?'status.cutFailed':'status.pasteFailed',{message:failedMessage}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined})},[clipboard,draftScopeId,draftTree,loadDirectory,nextDraftGeneration,rewriteRuntimePaths,workspace.workspaceId])
  const openDeleteConfirm=useCallback(entry=>{setContextMenu(undefined);setDeleteDialog(entry);setDeleteBusy(false)},[])
  const closeDeleteDialog=useCallback(()=>{if(deleteBusy)return;setDeleteDialog(undefined)},[deleteBusy])
  const confirmDelete = useCallback(async () => {
    if (deleteBusy || deleteDialog === undefined) return
    /* A concurrent tree mutation would bump mutationSeq and drop this delete's
       bookkeeping after the server already succeeded — refuse while one is in
       flight (same guard as pasteEntry). */
    if (mutationController.current !== undefined) {
      setDeleteDialog(undefined)
      setStatus({ error: true, text: translate('editor.operationBusy') })
      return
    }
    const entry = deleteDialog
    const prefix = entry.path === '' ? '' : `${entry.path}/`
    const affected = tabsRef.current
      .filter(tab => tab.path === entry.path || (prefix !== '' && tab.path.startsWith(prefix)))
      .map(tab => ({ path: tab.path, draft: tab.draft, dirty: tab.dirty || tab.saving, saving: tab.saving }))
    // Deleting under an in-flight save would race it: the save's PUT hits a 404 and its failure toast lands on a tab that no longer exists.
    if (affected.some(item => item.saving)) {
      setDeleteDialog(undefined)
      setStatus({ error: true, text: translate('editor.unsavedBlocked') })
      return
    }
    setDeleteBusy(true)
    const controller = new AbortController()
    mutationController.current = controller
    const mutationSeq = (mutationSeqRef.current += 1)
    for (const item of affected) invalidateDraftPath(item.path)
    // Drain requests that already reached the Host before deleting the source, or a late PUT could recreate a draft for a future same-named file.
    await Promise.all(affected.map(item => (draftTailsRef.current.get(item.path) ?? Promise.resolve()).catch(() => {})))
    if (!mounted.current) return
    const treeGeneration = nextDraftGeneration('__tree__')
    try {
      await draftTree(workspace.workspaceId, { action: 'delete', owner: draftScopeId, generation: treeGeneration, path: entry.path }, controller.signal)
    } catch (error) {
      // The source tree was not touched, so the delete can be retried: keep the dialog open, release the busy flag, and reschedule the affected drafts.
      if (!mounted.current || mutationSeq !== mutationSeqRef.current) return
      setDeleteBusy(false)
      for (const item of affected) {
        if (!item.dirty) continue
        // Use the tab's CURRENT draft, not the stale `affected` snapshot: the
        // delete dialog keeps editor focus, so the user may have typed after
        // capture, and a failed delete must not roll the staging draft back.
        // force=true also re-writes staging drafts of NON-editable dirty tabs
        // (their scheduleAutosave gate would skip them), so a failed delete
        // never destroys an orphaned draft. Drop the autosave dedup FIRST:
        // draftTree already tombstoned these drafts, yet lastWriteRef still
        // records the same text, so scheduleAutosave's content-dedup would
        // skip the re-write and the orphaned draft would stay lost.
        const fresh = tabsRef.current.find(tab => tab.path === item.path)
        lastWriteRef.current.delete(item.path)
        scheduleAutosave(item.path, fresh?.draft ?? item.draft, true)
      }
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') {
        /* Release the mutation slot even on abort so a future reorder cannot leave the controller stuck and block later pastes. */
        if (mutationController.current === controller) mutationController.current = undefined
        return
      }
      const deleteMessage = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
        ? translate('editor.requestTimeout')
        : (error instanceof Error ? error.message : String(error))
      setCopyNotice(translate('status.deleteFailed', { message: deleteMessage }))
      clearTimeout(copyNoticeTimer.current)
      copyNoticeTimer.current = setTimeout(() => { if (mounted.current) setCopyNotice(undefined) }, 3000)
      if (mutationController.current === controller) mutationController.current = undefined
      return
    }
    requestFsOperation(workspace.workspaceId, { action: 'delete', path: entry.path }, controller.signal).then(async result => {
      if (!mounted.current || mutationSeq !== mutationSeqRef.current) return
      await Promise.all(affected.map(item => deleteEmergencyDraft(workspace.workspaceId, draftScopeId, item.path, draftGenerationsRef.current.get(item.path) ?? 0).catch(() => {})))
      setDeleteBusy(false)
      setDeleteDialog(undefined)
      setStatus({ text: translate('status.deleted') })
      setTabs(cur => cur.filter(tab => tab.path !== entry.path && !tab.path.startsWith(`${entry.path}/`)))
      for (const item of affected) {
        /* A keystroke during the (possibly slow) fs delete re-armed a 1s autosave above the tree fence: disarm it here, or the PUT would recreate a Host staging draft for the deleted path (a future same-named file would restore it as dirty). */
        clearAutosaveTimer(item.path)
        lastWriteRef.current.delete(item.path)
        draftGenerationsRef.current.delete(item.path)
        scrollTopRef.current.delete(item.path)
      }
      /* Runtime maps of closed tabs die with the subtree too, and the global cache must not serve content of a deleted path as if it were current. */      const subtreeMatch = (path) => path === entry.path || (path !== '' && path.startsWith(`${entry.path}/`))
      for (const path of [...retainedStatesRef.current.keys()]) {
        if (subtreeMatch(path)) retainedStatesRef.current.delete(path)
      }
      for (const path of [...contentBaselinesRef.current.keys()]) {
        if (subtreeMatch(path)) contentBaselinesRef.current.delete(path)
      }
      invalidateCachedSubtree(workspace.workspaceId, entry.path)
      const nextActivePath = activePathRef.current === null
        ? null
        : (activePathRef.current === entry.path || activePathRef.current.startsWith(`${entry.path}/`)) ? null : activePathRef.current
      if (nextActivePath !== activePathRef.current) activatePath(nextActivePath)
      setExpanded(cur => {
        const next = new Set()
        for (const path of cur) if (path !== entry.path && !path.startsWith(`${entry.path}/`)) next.add(path)
        return next
      })
      if (selected?.path === entry.path || (prefix !== '' && selected?.path?.startsWith(prefix))) setSelected(undefined)
      void loadDirectory(parentPath(entry.path))
    }).catch(error => {
      if (!mounted.current || mutationSeq !== mutationSeqRef.current) return
      setDeleteBusy(false)
      for (const item of affected) {
        if (!item.dirty) continue
        // Use the tab's CURRENT draft, not the stale `affected` snapshot: the
        // delete dialog keeps editor focus, so the user may have typed after
        // capture, and a failed delete must not roll the staging draft back.
        // force=true also re-writes staging drafts of NON-editable dirty tabs
        // (their scheduleAutosave gate would skip them), so a failed delete
        // never destroys an orphaned draft. Drop the autosave dedup FIRST:
        // draftTree already tombstoned these drafts, yet lastWriteRef still
        // records the same text, so scheduleAutosave's content-dedup would
        // skip the re-write and the orphaned draft would stay lost.
        const fresh = tabsRef.current.find(tab => tab.path === item.path)
        lastWriteRef.current.delete(item.path)
        scheduleAutosave(item.path, fresh?.draft ?? item.draft, true)
      }
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      const deleteMessage = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
        ? translate('editor.requestTimeout')
        : (error instanceof Error ? error.message : String(error))
      setCopyNotice(translate('status.deleteFailed', { message: deleteMessage }))
      clearTimeout(copyNoticeTimer.current)
      copyNoticeTimer.current = setTimeout(() => { if (mounted.current) setCopyNotice(undefined) }, 3000)
    }).finally(() => {
      if (mutationController.current === controller) mutationController.current = undefined
    })
  }, [activatePath, clearAutosaveTimer, deleteBusy, deleteDialog, draftScopeId, draftTree, invalidateDraftPath, loadDirectory, scheduleAutosave, selected?.path, workspace.workspaceId])
  useEffect(()=>{
    const onKeyDown=event=>{
      if(event.isComposing)return
      const key=event.key
      /* Modifier discipline: Ctrl/Cmd+C/X/V copy/cut/paste only when no other modifier rides along, and Delete opens the delete confirm only unmodified. */
      const withMod=(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey
      const isFileShortcut=(withMod&&(key==='c'||key==='C'||key==='x'||key==='X'||key==='v'||key==='V'))||(key==='Delete'&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey)
      if(!isFileShortcut)return
      const target=event.target
      const element=target instanceof Element?target:target instanceof Node?target.parentElement:null
      if(element===null)return
      if(element.tagName==='INPUT'||element.tagName==='TEXTAREA'||element.tagName==='SELECT'||element.isContentEditable)return
      // File shortcuts fire only while a tree row is focused (or the tree
      // context menu is open); editors and inputs keep native behavior.
      const treeFocused=element.classList.contains('dsh-ws-tree-row')
      if(!treeFocused&&contextMenu===undefined)return
      if(selected===undefined)return
      const isPaste=key==='v'||key==='V'
      // A paste with an empty/foreign-workspace clipboard would no-op inside pasteEntry, so let it pass through to keep the browser's native paste.
      if(isPaste&&(clipboard===undefined||clipboard.workspaceId!==workspace.workspaceId))return
      event.preventDefault()
      event.stopPropagation()
      if(key==='Delete'){openDeleteConfirm(selected);return}
      if(key==='c'||key==='C'){copyEntryToClipboard(selected,false);return}
      if(key==='x'||key==='X'){copyEntryToClipboard(selected,true);return}
      pasteEntry(selected)
    }
    window.addEventListener('keydown',onKeyDown,true)
    return()=>window.removeEventListener('keydown',onKeyDown,true)
  },[clipboard,contextMenu,copyEntryToClipboard,openDeleteConfirm,pasteEntry,selected,workspace.workspaceId])
  const openSearchMatch=useCallback((file,match)=>{const entry={kind:'file',name:file.name,path:file.path,symlink:false};chooseFile(entry);setSearchReveal({column:match.startLineColumn??match.startColumn,endColumn:match.endLineColumn??match.endColumn,line:match.line,path:file.path})},[chooseFile])
  const openSearchEntry=useCallback((file)=>{const entry={kind:file.kind==='directory'?'directory':'file',name:file.name,path:file.path,symlink:false};if(entry.kind==='directory'){chooseDirectory(entry);closeSearch()}else chooseFile(entry)},[chooseDirectory,chooseFile,closeSearch])
  useDismissMenu(menuRef, contextMenu !== undefined, setContextMenu)
  useDismissMenu(tabMenuRef, tabContextMenu !== undefined, setTabContextMenu)
  useDismissMenu(titleMenuRef, titleContextMenu !== undefined, setTitleContextMenu)

  const openWithEncoding = useCallback((encodingId) => {
    // Same busy gate as confirmEncodingDialog: a reload racing an in-flight save-as applies a pre-save read result over the saved file (stale content + stale baselines).
    if (dirty || saving) {
      setStatus({ error: true, text: translate(dirty ? 'editor.dirtyEncodingSwitch' : 'editor.operationBusy') })
      return
    }
    requestedEncodingRef.current = encodingId
    if (activePath !== null) reloadingPathsRef.current.add(activePath)
    setReloadToken(token => token + 1)
  }, [activePath, dirty, saving])
  const refreshFile = useCallback(() => {
    // Reloading while a draft exists would silently discard unsaved work; refuse loudly instead. A save in flight is refused too (same race as openWithEncoding).
    if (dirty || saving) {
      setStatus({ error: true, text: translate(dirty ? 'editor.refreshBlocked' : 'editor.operationBusy') })
      return
    }
    refreshPendingRef.current = activePath
    if (activePath !== null) reloadingPathsRef.current.add(activePath)
    setReloadToken(token => token + 1)
  }, [activePath, dirty, saving])
  const openEncodingDialog = useCallback((mode) => {
    setEncodingMenu(undefined)
    setEncodingPick(preview.encoding ?? 'utf-8')
    void fetchEncodings().then(list => {
      if (mounted.current) setEncodingOptions(list.length > 0 ? list : ENCODING_FALLBACK)
    }).catch(() => {})
    setEncodingDialog({ mode })
  }, [preview.encoding])
  const closeEncodingDialog = useCallback(() => {
    if (saving) return
    setEncodingDialog(undefined)
  }, [saving])
  const confirmEncodingDialog = useCallback(() => {
    if (encodingDialog === undefined || encodingPick === '') return
    const selected = encodingPick
    if (encodingDialog.mode === 'open') {
      setEncodingDialog(undefined)
      openWithEncoding(selected)
    } else {
      // Close the picker before saving so a three-way conflict cannot stack two modals; errors surface in the status bar instead.
      setEncodingDialog(undefined)
      /* save() silently returns false while another save is in flight; say so instead of dropping the user's encoding choice. */
      if (saving) {
        setStatus({ error: true, text: translate('editor.operationBusy') })
        return
      }
      void save(selected)
    }
  }, [encodingDialog, encodingPick, openWithEncoding, save, saving])
  useDismissMenu(encodingMenuRef, encodingMenu !== undefined, setEncodingMenu)

  const closeTab = useCallback((path) => {
    const current = tabsRef.current
    const index = current.findIndex(tab => tab.path === path)
    if (index < 0) return
    const closing = current[index]
    // A dirty tab is close-guarded only while editable: a non-editable file with a leftover draft has no save/cancel path, so allow closing and drop its staging draft below.
    const nonEditableDirty = closing.dirty === true && closing.editing === false
    if (closing.saving || (closing.dirty && !nonEditableDirty)) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabClose') }
      if (activePathRef.current === path) setStatus(nextStatus)
      else updateTab(path, { status: nextStatus })
      return
    }
    if (nonEditableDirty) {
      // Discard the orphaned staging draft so the next open does not restore the non-restorable state.
      void clearDraftFile(path, '', closing.encoding ?? 'utf-8', closing.lineEnding ?? 'none', Boolean(closing.bom), closing.revision ?? null).catch(() => {})
    }
    if (isMindmapTab(closing)) {
      /* The tab is gone: the global host unmounts this map's body; a later re-dock mounts a fresh body. */
      mindmapViewHost.drop(mindmapRootIdOfTab(closing))
    }
    /* A closed plan tab releases its temporary review document: the tab is the only holder, and the review strip re-publishes it on a later open. */
    if (isPlanTab(closing)) planDocuments.drop(planAddressOfTab(closing))
    const nextTabs = current.filter(tab => tab.path !== path)
    const nextActivePath = activePathRef.current === path
      ? (nextTabs[index]?.path ?? nextTabs[index - 1]?.path ?? null)
      : activePathRef.current
    setTabs(nextTabs)
    forgetPathRefs(path)
    activatePath(nextActivePath)
    if (nextActivePath === null) {
      setSelected(undefined)
      setPreview({ state: 'idle' })
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setDraft('')
      setStatus(undefined)
      publishEditorContext(undefined)
      return
    }
    const nextTab = nextTabs.find(tab => tab.path === nextActivePath)
    if (nextTab !== undefined) {
      if (hasNoTreeRow(nextTab)) {
        /* A mind-map, plan, or outside-workspace tab selects nothing in the file tree. */
        setSelected(undefined)
      } else {
        const entry = entryFromPreviewTab(nextTab)
        setSelected(entry)
        revealPath(entry)
      }
    }
  }, [clearDraftFile, forgetPathRefs, publishEditorContext, revealPath, updateTab])
  const closeOtherTabs = useCallback((keepPath) => {
    const current = tabsRef.current
    const keep = current.find(tab => tab.path === keepPath)
    if (keep === undefined) return
    const closing = current.filter(tab => tab.path !== keepPath && !tab.pinned)
    if (closing.length === 0) return
    /* Same rule as closeTab: a dirty tab is close-guarded only while editable. */
    if (closing.some(tab => tab.saving || (tab.dirty && tab.editing !== false))) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabsClose') }
      if (activePathRef.current === keepPath) setStatus(nextStatus)
      else updateTab(keepPath, { status: nextStatus })
      return
    }
    for (const tab of closing) {
      if (tab.dirty && tab.editing === false) {
        // Discard the orphaned staging draft (same escape as closeTab).
        void clearDraftFile(tab.path, '', tab.encoding ?? 'utf-8', tab.lineEnding ?? 'none', Boolean(tab.bom), tab.revision ?? null).catch(() => {})
      }
    }
    setTabs(current.filter(tab => tab.pinned || tab.path === keepPath))
    for (const tab of closing) {
      /* A closed map tab must also unmount its global body (same rule as closeTab). */
      if (isMindmapTab(tab)) mindmapViewHost.drop(mindmapRootIdOfTab(tab))
      /* A closed plan tab releases its temporary review document (same rule as closeTab). */
      if (isPlanTab(tab)) planDocuments.drop(planAddressOfTab(tab))
      forgetPathRefs(tab.path)
    }
    activatePath(keep.path)
    if (hasNoTreeRow(keep)) {
      /* A mind-map, plan, or outside-workspace tab selects nothing in the file tree. */
      setSelected(undefined)
    } else {
      const entry = entryFromPreviewTab(keep)
      setSelected(entry)
      revealPath(entry)
    }
  }, [activatePath, clearDraftFile, forgetPathRefs, revealPath, updateTab])
  const pinTab = useCallback((path) => {
    setTabs(current => {
      const tab = current.find(item => item.path === path)
      if (tab === undefined || tab.pinned) return current
      const pinned = { ...tab, pinned: true }
      return orderPinnedFirst([pinned, ...current.filter(item => item.path !== path)])
    })
    if (activePathRef.current === path) scrollTabIntoView(path)
  }, [scrollTabIntoView])
  const unpinTab = useCallback((path) => {
    setTabs(current => {
      const tab = current.find(item => item.path === path)
      if (tab === undefined || !tab.pinned) return current
      const unpinned = { ...tab, pinned: false }
      // Move the unpinned tab right after the last pinned one so the pinned block stays grouped at the front.
      const rest = current.filter(item => item.path !== path)
      let lastPinnedIndex = -1
      for (let i = 0; i < rest.length; i += 1) if (rest[i].pinned) lastPinnedIndex = i
      const insertAt = lastPinnedIndex < 0 ? 0 : lastPinnedIndex + 1
      return [...rest.slice(0, insertAt), unpinned, ...rest.slice(insertAt)]
    })
    scrollTabIntoView(path)
  }, [scrollTabIntoView])
  const dropTabAt = useCallback((insertAt) => {
    if (draggingPath === null || insertAt === null) return
    setTabs(current => {
      const from = current.findIndex(tab => tab.path === draggingPath)
      if (from < 0 || insertAt === from || insertAt === from + 1) return current
      const moved = current[from]
      const next = current.filter(tab => tab.path !== draggingPath)
      next.splice(insertAt > from ? insertAt - 1 : insertAt, 0, moved)
      return orderPinnedFirst(next)
    })
  }, [draggingPath])
  /* The tab bar renders pinned-first, so clamp the insertion point to the dragged tab's own partition (pinned: inside the pinned block; unpinned: at or after the first unpinned slot) to match the drop indicator. */
  const clampDropIndexForTab = useCallback((rawIndex) => {
    if (draggingPath === null || !Number.isInteger(rawIndex)) return rawIndex
    const current = tabsRef.current
    const from = current.findIndex(tab => tab.path === draggingPath)
    if (from < 0) return rawIndex
    const draggedPinned = current[from]?.pinned === true
    let pinnedCount = 0
    for (const tab of current) {
      if (tab.path !== draggingPath && tab.pinned) pinnedCount += 1
    }
    return draggedPinned ? Math.min(rawIndex, pinnedCount) : Math.max(rawIndex, pinnedCount)
  }, [draggingPath])
  const updateDropIndex = useCallback((event) => {
    if (draggingPath === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const next = clampDropIndexForTab(dropIndexFromEvent(event))
    setDropIndex(current => current === next ? current : next)
  }, [clampDropIndexForTab, draggingPath])
  const handleTabsDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropIndex(null)
  }, [])
  const handleTabsDrop = useCallback((event) => {
    event.preventDefault()
    dropTabAt(clampDropIndexForTab(dropIndexFromEvent(event)))
    setDraggingPath(null)
    setDropIndex(null)
  }, [clampDropIndexForTab, dropTabAt])
  /* The strip API handed to the global mind-map host: doc-gone closes the tab and root renames update the tab label. closeTab/updateTab may change identity across renders, so the API forwards through refs. */
  const closeTabRef = useRef(closeTab)
  closeTabRef.current = closeTab
  const updateTabRef = useRef(updateTab)
  updateTabRef.current = updateTab
  const stripApiRef = useRef(null)
  if (stripApiRef.current === null) {
    stripApiRef.current = {
      hasTab: (tabPath) => tabsRef.current.some(tab => tab.path === tabPath),
      tabName: (tabPath) => {
        const tab = tabsRef.current.find(item => item.path === tabPath)
        return tab === undefined ? undefined : tab.name
      },
      closeTab: (tabPath) => closeTabRef.current(tabPath),
      updateTab: (tabPath, patch) => updateTabRef.current(tabPath, patch),
    }
  }
  useEffect(() => {
    mindmapViewHost.registerStrip(stripApiRef.current)
    return () => mindmapViewHost.unregisterStrip(stripApiRef.current)
  }, [])
  /* Strip placeholders of the docked map tabs; the host's stable map-body containers are physically parked into these elements. */
  const mindmapTabElsRef = useRef(new Map())
  /* The root ids parked into this mount's placeholders; the effect unparks only what disappeared. */
  const placedMapRootsRef = useRef(new Map())
  /* Placement runs as a layout effect so the container move lands before paint; the parked element is the host's stable container, so parking it is a plain DOM move and the map body never remounts. */
  useLayoutEffect(() => {
    const next = new Map()
    for (const tab of tabs) {
      if (!isMindmapTab(tab)) continue
      const el = mindmapTabElsRef.current.get(tab.path)
      if (el === undefined || el === null) continue
      const rootId = mindmapRootIdOfTab(tab)
      /* Restored tabs mount not fresh: a restore must never yank the chat onto the map's remembered session. */
      mindmapViewHost.ensure(rootId, false)
      next.set(rootId, el)
      mindmapViewHost.place(rootId, el)
    }
    for (const rootId of placedMapRootsRef.current.keys()) {
      if (!next.has(rootId)) mindmapViewHost.unplace(rootId)
    }
    placedMapRootsRef.current = next
  }, [tabs])
  /* Explorer teardown (a session switch): unpark every placed container so the map bodies fall back to the host's hidden holding node and keep their state. */
  useLayoutEffect(() => () => {
    for (const rootId of placedMapRootsRef.current.keys()) mindmapViewHost.unplace(rootId)
    placedMapRootsRef.current = new Map()
  }, [])
  // Renderer dispatch (registry-driven): markdown/html offer a rendered preview, byte renderers (image/pdf/office) render standalone, and read-only text files offer a paged full-file browse.
  const isMarkdown = preview.state === 'ready' && isMarkdownName(preview.name)
  const isHtmlFile = preview.state === 'ready' && isHtmlName(preview.name)
  /* The active byte renderer (image/pdf/office), selected by the preview itself. */
  const byteKind = preview.state === 'ready' && isByteKind(preview.kind) ? preview.kind : undefined
  const isReadOnlyText = preview.state === 'ready' && !isByteKind(preview.kind)
    && (preview.editable === false || preview.readOnlyReason)
  /* Browse mode = the paged full-file view; it replaces the editor for read-only text files, while HTML keeps the iframe overlay. A dropped-in file has no path the Remote could read (its content lives only in memory), but a file OUTSIDE the workspace does — the Remote reads its absolute path — so that tab browses like any other read-only file. */
  const showBrowse = viewMode === VIEW_PREVIEW && isReadOnlyText && !isHtmlFile
    && (activeTab?.external !== true || activeTab?.outside === true)
  const browseKind = isMarkdown ? 'markdown' : 'code'
  const viewerItems = useMemo(() => {
    if (preview.state !== 'ready' || activeTab === undefined || isSyntheticTab(activeTab)) return []
    /* A Remote-readable tab: an outside-workspace file is readable, a dropped-in one is not. */
    return viewerCandidates(preview, activeTab.name, activeTab.external === true && activeTab.outside !== true)
  }, [activeTab, preview])
  const currentViewer = viewerItems.find(item => item.id === (byteKind ?? viewMode)) ?? viewerItems[0]
  /* The toggle button's tooltip names the view it switches to. */
  const viewerToggleTitle = currentViewer?.id === VIEW_PREVIEW
    ? (isMarkdown ? translate('mdPreview.edit.title') : isHtmlFile ? translate('htmlPreview.edit.title') : translate('editor.edit.title'))
    : (isMarkdown ? translate('mdPreview.preview.title') : isHtmlFile ? translate('htmlPreview.preview.title') : translate('renderer.browse.title'))
  /* A mind-map tab renders nothing here: this div is a placeholder the global host parks its stable map-body container into; parking is a plain appendChild move, so the doc, pan/zoom and highlight survive a session switch. */
  const mindmapTabs = tabs.filter(isMindmapTab)
  /* A plan tab renders the harness plan document inline; every plan body stays mounted (hidden when inactive) so switching tabs keeps its scroll and resource hold. */
  const planTabs = tabs.filter(isPlanTab)
  /* A review tab renders one turn's change review inline; like a plan body it
     stays mounted (hidden when inactive), so switching tabs keeps the selected
     file, its scroll, and the comparisons already read. */
  const reviewTabs = tabs.filter(isReviewTab)
  /* The active file's retained CodeMirror session; dropped when its name no longer matches the tab, so a rename builds the next view fresh. */
  const retainedForActive = (() => {
    if (activePath === null || activeTab === undefined || isSyntheticTab(activeTab)) return null
    const session = retainedStatesRef.current.get(activePath)
    if (session === undefined) return null
    if (session.name !== activeTab.name) {
      retainedStatesRef.current.delete(activePath)
      return null
    }
    return session
  })()
  const body = mindmapTabs.length > 0 || planTabs.length > 0 || reviewTabs.length > 0
    ? h(Fragment, null,
        ...mindmapTabs.map(tab => h('div', {
          className: 'dsh-ws-preview-body dsh-ws-mindmap-dock',
          key: tab.path,
          ref: (el) => {
            if (el !== null) mindmapTabElsRef.current.set(tab.path, el)
            else mindmapTabElsRef.current.delete(tab.path)
          },
          style: tab.path === activePath ? undefined : { display: 'none' },
        })),
        ...planTabs.map(tab => h('div', {
          className: 'dsh-ws-preview-body dsh-ws-plan-dock',
          key: tab.path,
          style: tab.path === activePath ? undefined : { display: 'none' },
        }, h(PlanView, {
          address: planAddressOfTab(tab),
          onTitle: (title) => applyPlanTitle(tab.path, title),
        }))),
        ...reviewTabs.map(tab => h('div', {
          className: 'dsh-ws-preview-body dsh-ws-review-dock',
          key: tab.path,
          style: tab.path === activePath ? undefined : { display: 'none' },
        }, h(ReviewView, {
          address: reviewAddressOfTab(tab),
          initialIndex: tab.reviewIndex ?? 0,
          navSeq: tab.reviewNav ?? 1,
          sessionCwdOf,
          workspace,
        }))),
        activeMindmap || activePlan || activeReview ? null : h(PreviewPane, {
    activePath,
    activeTab,
    browseKind,
    draft,
    editing,
    editorRef,
    isBrowse: showBrowse,
    isHtmlFile,
    isMarkdown,
    onBodyClick: () => { if (activePathRef.current !== null) scrollTabIntoView(activePathRef.current) },
    onContext: publishContextState,
    onDirty: (text) => {
      const nextDirty = text !== baseText.current
      setDraft(text)
      setDirty(nextDirty)
      updateActiveTab({ dirty: nextDirty, draft: text, draftKnown: nextDirty })
      if (nextDirty) {
        scheduleAutosave(activePath, text)
      } else {
        // Reverted exactly to the snapshot: drop the staging draft so a refresh can't resurrect intermediate edits.
        lastWriteRef.current.set(activePath, { revision: null, content: text })
        clearDraftFile(activePath, text, preview.encoding ?? 'utf-8', preview.lineEnding ?? 'none', Boolean(preview.bom), preview.revision ?? null).catch(() => {
          // A double failure (Host DELETE + fallback persist) leaves the staging draft behind an apparently clean tab: say so instead of an unhandled rejection — the §15 read pass re-derives the truth (and would restore the surviving draft as dirty).
          if (mounted.current && activePathRef.current === activePath) setStatus({ error: true, text: translate('editor.saveDraftCleanupFailed') })
        })
      }
    },
    onRevealApplied: () => setSearchReveal(undefined),
    onSaveShortcut: () => { if (editing && !saving) void save() },
    onScroll: (path, scrollTop) => { scrollTopRef.current.set(path, scrollTop) },
    onSearchPanelContextMenu: (event) => { if (event.button !== 2) event.preventDefault() },
    onViewState: retainEditorState,
    preview,
    readEpoch,
    restore: retainedForActive,
    scrollTopRef,
    searchPanelContainerRef,
    searchReveal,
    sessionId: previewSessionId,
    settings,
    viewMode,
  }))
    : h(PreviewPane, {
    activePath,
    activeTab,
    browseKind,
    draft,
    editing,
    editorRef,
    isBrowse: showBrowse,
    isHtmlFile,
    isMarkdown,
    onBodyClick: () => { if (activePathRef.current !== null) scrollTabIntoView(activePathRef.current) },
    onContext: publishContextState,
    onDirty: (text) => {
      const nextDirty = text !== baseText.current
      setDraft(text)
      setDirty(nextDirty)
      updateActiveTab({ dirty: nextDirty, draft: text, draftKnown: nextDirty })
      if (nextDirty) {
        scheduleAutosave(activePath, text)
      } else {
        // Reverted exactly to the snapshot: drop the staging draft so a refresh can't resurrect intermediate edits.
        lastWriteRef.current.set(activePath, { revision: null, content: text })
        clearDraftFile(activePath, text, preview.encoding ?? 'utf-8', preview.lineEnding ?? 'none', Boolean(preview.bom), preview.revision ?? null).catch(() => {
          // A double failure (Host DELETE + fallback persist) leaves the staging draft behind an apparently clean tab: say so instead of an unhandled rejection — the §15 read pass re-derives the truth (and would restore the surviving draft as dirty).
          if (mounted.current && activePathRef.current === activePath) setStatus({ error: true, text: translate('editor.saveDraftCleanupFailed') })
        })
      }
    },
    onRevealApplied: () => setSearchReveal(undefined),
    onSaveShortcut: () => { if (editing && !saving) void save() },
    onScroll: (path, scrollTop) => { scrollTopRef.current.set(path, scrollTop) },
    onSearchPanelContextMenu: (event) => { if (event.button !== 2) event.preventDefault() },
    onViewState: retainEditorState,
    preview,
    readEpoch,
    restore: retainedForActive,
    scrollTopRef,
    searchPanelContainerRef,
    searchReveal,
    sessionId: previewSessionId,
    settings,
    viewMode,
  })
  const searchBody = h(SearchResults, { expanded: searchExpanded, onOpenEntry: openSearchEntry, onOpenMatch: openSearchMatch, onToggleFile: toggleSearchFile, state: searchState })
  const entryDialogTrimmed = entryDraft.trim()
  const entryDialogParentPath = entryDialog?.mode === 'create'
    ? entryDialog.parentPath
    : entryDialog === undefined
      ? ''
      : parentPath(entryDialog.entry.path)
  const entryDialogSiblings = entryDialog === undefined ? [] : directories.get(entryDialogParentPath)?.entries ?? []
  const entryDialogDuplicate = entryDialog !== undefined
    && entryDialogTrimmed !== ''
    && entryDialogSiblings.some(entry => entry.name === entryDialogTrimmed
      && (entryDialog.mode !== 'rename' || entry.path !== entryDialog.entry.path))
  const entryDialogValidation = entryDialog === undefined ? undefined : entryNameError(entryDraft)
  const entryDialogError = entryError ?? (entryDialogValidation !== undefined
    ? entryDialogValidation
    : entryDialogDuplicate
      ? translate('entry.duplicate')
      : entryDialog?.mode === 'rename' && entryDialogTrimmed === entryDialog.entry.name
        ? translate('entry.nameUnchanged')
        : undefined)
  const entryDialogBlocked = entryBusy || entryDialog === undefined || entryDialogError !== undefined
  const reason = preview.state === 'ready' ? readOnlyReason(preview) : translate('editor.notLoaded')
  const size = preview.state === 'ready' ? formatBytes(preview.size) : ''
  const tabMenuTarget = tabContextMenu === undefined ? undefined : tabs.find(tab => tab.path === tabContextMenu.path)
  /* "Open in new window" is limited to workspace file tabs the Host can serve as text: mind-map, plan, external, image, PDF, and Office tabs have no such content. */
  const canOpenInNewWindow = tabMenuTarget !== undefined && !isSyntheticTab(tabMenuTarget) && !tabMenuTarget.external
    && !isImageName(tabMenuTarget.name) && !isPdfName(tabMenuTarget.name) && !isOfficeName(tabMenuTarget.name)
  const openTabInNewWindow = () => {
    setTabContextMenu(undefined)
    if (!canOpenInNewWindow) return
    window.open(rawFileUrl(workspace.workspaceId, tabMenuTarget.path), '_blank', 'noopener')
  }
  const treeSection = h('section', { className: 'dsh-ws-tree' },
      searchOpen
        ? h(Fragment, null,
          h('header', { className: 'dsh-ws-panel-header dsh-ws-search-header' },
            h('div', { className: 'dsh-ws-search-input-row' },
              h('input', {
                'aria-label': translate('search.placeholder'),
                autoFocus: true,
                className: 'dsh-ws-search-input',
                onChange: e => setSearchQuery(e.target.value),
                onKeyDown: e => {
                  /* IME composition must never submit the search (same guard
                     as every other text input in this plugin). */
                  if (e.isComposing) return
                  if (e.key === 'Enter') { e.preventDefault(); void runSearch(searchQuery) }
                  else if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
                },
                placeholder: translate('search.placeholder'),
                spellCheck: false,
                value: searchQuery,
              }),
              h('button', {
                'aria-pressed': searchCaseSensitive,
                className: 'dsh-ws-icon-button dsh-ws-search-case',
                'data-active': searchCaseSensitive || undefined,
                onClick: () => setSearchCaseSensitive(value => !value),
                title: searchCaseSensitive ? translate('search.caseSensitive') : translate('search.caseInsensitive'),
                type: 'button',
              }, 'Aa'),
              h('button', {
                'aria-label': translate('search.closeAria'),
                className: 'dsh-ws-icon-button',
                onClick: closeSearch,
                title: translate('search.close.title'),
                type: 'button',
              }, '×'),
            ),
            h('label', { className: 'dsh-ws-search-nameonly', title: translate('search.nameOnly.title') },
              h('input', {
                checked: searchNameOnly,
                onChange: e => setSearchNameOnly(e.target.checked),
                type: 'checkbox',
              }),
              translate('search.nameOnly'),
            ),
          ),
          h('div', { className: 'dsh-ws-tree-scroll' }, searchBody),
        )
        : h(Fragment, null,
          h(PanelHeader, {
            actions: [
              { label: translate('search.toolbar'), title: translate('search.toolbar.title'), onClick: () => setSearchOpen(true), icon: h(IconSearch) },
              { label: translate('dialog.newFolder'), title: translate('toolbar.newFolder.title'), onClick: () => openEntryDialog('directory'), disabled: entryBusy, icon: h(IconNewFolder) },
              { label: translate('dialog.newFile'), title: translate('toolbar.newFile.title'), onClick: () => openEntryDialog('file'), disabled: entryBusy, icon: h(IconNewFile) },
            ],
            action: refresh,
            actionLabel: translate('tree.refresh'),
            onContextMenu: event => { event.preventDefault(); setTitleContextMenu({ x: event.clientX, y: event.clientY }) },
            subtitle: workspace.path,
            title: sessionTitle ?? translate('panel.workspaceFiles'),
          }),
          h(ExplorerTree, { clipboard, containerRef: treeScrollRef, directories, entryBusy, entryDialog, entryDialogError, entryDraft, expanded, onCloseEntryDialog: closeEntryDialog, onConfirmEntryDialog: submitEntryDialog, onContextMenu: openContextMenu, onDirectory: toggleDirectory, onDraftEntry: value => { setEntryDraft(value); setEntryError(undefined) }, onFile: chooseFile, onSelect: setSelected, onRename: beginRename, selected }),
          contextMenu ? h(TreeContextMenu, { entry: contextMenu.entry, menuRef, onRename: entry => { setContextMenu(undefined); beginRename(entry) }, onCopyName: copyEntryName, onCopyPath: copyEntryPath, onReveal: openInExplorer, onCopy: entry => copyEntryToClipboard(entry, false), onPaste: pasteEntry, onCut: entry => copyEntryToClipboard(entry, true), onDelete: openDeleteConfirm, pasteDisabled: clipboard === undefined || clipboard.workspaceId !== workspace.workspaceId, pasteTitle: clipboard === undefined ? translate('context.paste.titleEmpty') : clipboard.workspaceId !== workspace.workspaceId ? translate('context.paste.titleForeign') : translate('context.paste.title'), x: contextMenu.x, y: contextMenu.y }) : null,
          titleContextMenu ? h('div', { className: 'dsh-ws-context-menu', ref: titleMenuRef, role: 'menu', style: { left: Math.max(4, Math.min(titleContextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)), top: Math.max(4, Math.min(titleContextMenu.y, window.innerHeight - 52)) } }, h('button', { className: 'dsh-ws-context-item', onClick: openSessionRename, role: 'menuitem', title: translate('dialog.renameSession'), type: 'button' }, translate('dialog.renameSession'))) : null,
          copyNotice ? h('div', { className: 'dsh-ws-copy-notice', role: 'status' }, copyNotice) : null,
        ),
  )
  return h(Fragment, null,
    entryDialog && entryDialog.mode !== 'rename' ? h(EntryDialog, {
      blocked: entryDialogBlocked,
      busy: entryBusy,
      composingRef,
      dialog: entryDialog,
      draft: entryDraft,
      error: entryDialogError,
      onCancel: closeEntryDialog,
      onConfirm: submitEntryDialog,
      onDraft: value => { setEntryDraft(value); setEntryError(undefined) },
    }) : null,
    encodingMenu ? h(EncodingMenu, { canOpen: !dirty, canSave: preview.state === 'ready' && preview.editable !== false && !preview.readOnlyReason, menuRef: encodingMenuRef, onOpen: () => openEncodingDialog('open'), onSave: () => openEncodingDialog('save'), x: encodingMenu.x, y: encodingMenu.y }) : null,
    encodingDialog ? h(EncodingDialog, { busy: encodingDialog.mode === 'save' && saving, dialog: encodingDialog, onCancel: closeEncodingDialog, onConfirm: confirmEncodingDialog, onPick: setEncodingPick, options: encodingOptions, value: encodingPick }) : null,
    deleteDialog ? h(DeleteDialog, { busy: deleteBusy, dirtyWarning: tabs.some(tab => (tab.dirty || tab.saving) && (tab.path === deleteDialog.path || tab.path.startsWith(`${deleteDialog.path}/`))), entry: deleteDialog, onCancel: closeDeleteDialog, onConfirm: confirmDelete }) : null,
    conflictDialog ? h(SaveConflictDialog, { conflict: conflictDialog, fontSize: clamp(settings.conflictFontSize ?? CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MIN, CONFLICT_FONT_SIZE_MAX), onResolve: resolveConflict }) : null,
    sessionRenameOpen ? h(SessionRenameDialog, {
      busy: sessionRenameBusy,
      draft: sessionRenameDraft,
      error: sessionRenameError,
      onCancel: closeSessionRename,
      onConfirm: confirmSessionRename,
      onDraft: value => { setSessionRenameDraft(value); setSessionRenameError(undefined) },
    }) : null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { 'data-drop-active': dropActive || undefined, className: 'dsh-ws-preview', ref: previewSectionRef },
      tabs.length ? h(PreviewTabs, { activePath, containerRef: previewTabsRef, draggingPath, dropIndex, onChoose: tab => {
        if (hasNoTreeRow(tab)) {
          /* A tab with no tree row (mind map, plan, or an outside-workspace file) activates directly: no tree selection/reveal. */
          setSelected(undefined)
          activatePath(tab.path)
        } else {
          chooseFile(entryFromPreviewTab(tab))
        }
      }, onClose: closeTab, onContextMenu: (path, x, y) => setTabContextMenu({ path, x, y }), onDragEnd: () => { setDraggingPath(null); setDropIndex(null) }, onDragLeave: handleTabsDragLeave, onDragOver: updateDropIndex, onDragStart: (path, event) => { setDraggingPath(path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', path) }, onDrop: handleTabsDrop, onMouseEnter: handleTabsMouseEnter, onMouseLeave: handleTabsMouseLeave, onScroll: handleTabsScroll, onUnpin: unpinTab, tabs }) : null,
      tabs.length ? h('div', { className: 'dsh-ws-preview-scrollbar', onMouseEnter: handleScrollbarMouseEnter, onMouseLeave: handleScrollbarMouseLeave, onPointerCancel: handleScrollbarPointerEnd, onPointerDown: handleScrollbarPointerDown, onPointerMove: handleScrollbarPointerMove, onPointerUp: handleScrollbarPointerEnd, ref: previewScrollbarRef }, h('div', { className: 'dsh-ws-preview-scrollbar-thumb', ref: previewScrollThumbRef })) : null,
      tabContextMenu ? h(TabContextMenu, { menuRef: tabMenuRef, onCloseOthers: () => { setTabContextMenu(undefined); closeOtherTabs(tabContextMenu.path) }, onTogglePin: () => { setTabContextMenu(undefined); if (tabMenuTarget?.pinned) unpinTab(tabContextMenu.path); else pinTab(tabContextMenu.path) }, onOpenInNewWindow: openTabInNewWindow, canOpenInNewWindow, pinned: Boolean(tabMenuTarget?.pinned), x: tabContextMenu.x, y: tabContextMenu.y }) : null,
      /* A mind-map tab hides the file header: the map draws its own toolbar
         and title bar. A plan tab hides it too: the document carries its own
         heading and has no file chrome to offer. A review tab hides it as
         well: its own header names the turn and the selected file. */
      activeMindmap || activePlan || activeReview ? null : h('header', { className: 'dsh-ws-panel-header dsh-ws-preview-file-header', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && preview.kind !== 'image' && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) }, ref: previewHeaderRef },
        h('span', { className: 'dsh-ws-preview-file-path', title: activeTab === undefined ? undefined : (activeTab.outside === true ? activeTab.path : activeTab.external ? translate('external.externalFile.title') : activeTab.path) },
          activeTab
            ? (activeTab.outside === true
                ? translate('external.outsideFile', { name: activeTab.name })
                : activeTab.external
                  ? translate('external.externalFile', { name: activeTab.name })
                  : activeTab.path)
            : workspace.title),
        preview.state === 'ready'
          ? h(Fragment, null,
            /* Viewer toggle (registry-driven): exactly two candidates exist for every file that shows the button, so it flips directly instead of opening a menu. */
            viewerItems.length > 1
              ? h('button', {
                'aria-label': translate('viewer.menu'),
                className: 'dsh-ws-text-button',
                'data-active': currentViewer?.id === VIEW_PREVIEW || undefined,
                onClick: () => setViewMode(currentViewer?.id === VIEW_PREVIEW ? VIEW_EDIT : VIEW_PREVIEW),
                title: viewerToggleTitle,
                type: 'button',
              }, currentViewer?.label ?? '')
              : null,
            h('button', {
              'aria-label': translate('editor.refresh'),
              className: 'dsh-ws-icon-button',
              /* A dropped-in tab has no reread to offer; an outside-workspace tab re-reads through the Remote. */
              disabled: Boolean(activeTab?.external && activeTab?.outside !== true),
              onClick: refreshFile,
              title: translate('editor.refresh.title'),
              type: 'button',
            }, h(IconRefresh)),
          )
          : null,
      ),
      body,
      // Merged bottom status bar: action buttons + file meta (left) and the transient status notice (right); a mind-map, plan, or review tab hides it.
      activeMindmap || activePlan || activeReview ? null : h('div', { className: 'dsh-ws-status', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && preview.kind !== 'image' && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) } },
        h('div', { className: 'dsh-ws-preview-status-actions' },
          preview.state === 'ready' && preview.kind !== 'image'
            ? h(Fragment, null,
              h('button', {
                'aria-pressed': settings.wrap === true,
                className: 'dsh-ws-text-button',
                'data-active': settings.wrap === true || undefined,
                onClick: () => settingsStore.actions.setWrap(settings.wrap !== true),
                title: settings.wrap === true ? translate('editor.wrap.off.title') : translate('editor.wrap.on.title'),
                type: 'button',
              }, translate('editor.wrap')),
              reason === null
                ? h(Fragment, null,
                  h('button', { className: 'dsh-ws-text-button', disabled: !dirty || saving, onClick: cancel, type: 'button' }, translate('editor.cancel')),
                  h('button', { className: 'dsh-ws-text-button', disabled: !dirty || saving, onClick: () => void save(), type: 'button' }, saving ? translate('editor.saving') : translate('editor.save')),
                )
                : dirty
                  ? h('button', { className: 'dsh-ws-text-button', disabled: saving, onClick: () => void discardDraft(), title: translate('editor.discardDraft.title'), type: 'button' }, translate('editor.discardDraft'))
                  : null,
            )
            : null,
        ),
        h('div', { className: 'dsh-ws-preview-status-meta' },
          activeTab ? h('span', { className: 'dsh-ws-language' }, fileLabel(activeTab.name)) : null,
          size ? h('span', null, size) : null,
          preview.state === 'ready' && preview.kind !== 'image' && preview.encoding ? h('span', { className: 'dsh-ws-encoding', title: translate('encoding.badge') }, encodingLabel(preview.encoding)) : null,
          preview.state === 'ready' && preview.kind !== 'image' && reason ? h('span', { title: reason }, reason) : null,
        ),
        h('span', { className: 'dsh-ws-preview-status-msg', 'data-error': status?.error || undefined }, status?.text ?? ''),
      ),
      h(DropOverlay, { active: dropActive, onClose: () => setDropActive(false), suppressedRef: dropSuppressedRef }),
      previewToast ? h(PreviewToast, { headerRef: previewHeaderRef, key: previewToast.seq, onDone: () => setPreviewToast(undefined), text: previewToast.text }) : null,
    ),
  )
}
