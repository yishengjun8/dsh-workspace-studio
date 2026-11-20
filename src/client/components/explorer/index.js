import { createElement as h, Fragment, useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { clampFontPercent, CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN, CONTEXT_MENU_WIDTH, DIFF_RULER_WIDTH_DEFAULT, DIFF_RULER_WIDTH_MAX, DIFF_RULER_WIDTH_MIN, DISK_STATE_CLEAN, DISK_STATE_CONFLICT, DISK_STATE_GONE, DISK_STATE_STALE, ENCODING_FALLBACK, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, stepFontPercent } from '../../constants.js'
import { translate } from '../../locale/index.js'
import { clamp, diffColorVars, fileLabel, formatBytes, readOnlyReason, vcsStatusColorVars } from '../../format.js'
import { copyText, defaultEntryName, entryNameError, entryPath, joinAbsolutePath, parentPath, pathBaseName, rewriteDirectoryMap, rewritePathMap, rewritePathSet, rewriteRelativePath, selectedLevelPath } from '../../paths.js'
import { ancestorDirectoryPaths, dropIndexFromEvent, entryFromPreviewTab, isMindmapTab, isMusicTab, isPermissionTab, isPlanTab, isReviewTab, isSyntheticTab, isTemporaryTab, hasTabPath, isUnpersistedTab, mindmapRootIdOfTab, mindmapTabPath, musicTabPath, normalizePreviewSession, openPermanentTab, openPreviewTab, orderPinnedFirst, paneOfTab, patchTab, permissionTabPath, planAddressOfTab, planTabPath, PREVIEW_PANE_BOTTOM, PREVIEW_PANE_TOP, promoteTemporaryTab, reviewAddressOfTab, reviewTabPath, rewritePreviewTabs, serializePreviewSession, tabsOfPane } from '../../preview-tabs.js'
import { registerPreviewFontReset } from '../../preview-font.js'
import { IconNewFile, IconNewFolder, IconRefresh, IconSearch } from '../../icons.js'
import { encodingLabel, fetchEncodings, hostAbsoluteHref, openFileExternal, pollMusicJobRequest, rawFileUrl, requestFsOperation, revealInExplorer, uploadExternalFile, WorkspaceApiError } from '../../api.js'
import { hasDraggedFiles, hasNormalFile } from '../../utils.js'
import { invalidateCachedSubtree, rewriteCachedPaths } from '../../file-cache.js'
import { mindmapDockStore } from '../../mindmap/registry.js'
import { mindmapViewHost } from '../../mindmap/host.js'
import { fileOpenRequestStore } from '../../open-request.js'
import { parseChangesReviewAddress, reviewOpenStore } from '../../changes-review.js'
import { planDocuments, planOpenStore } from '../../plan-open.js'
import { usePendingRequest } from '../../request-store.js'
import { EncodingMenu, PanelHeader, PreviewToast, TabContextMenu, TabStripContextMenu, TreeContextMenu } from '../menus.js'
import { DeleteDialog, EncodingDialog, EntryDialog, SaveConflictDialog, SessionRenameDialog } from '../dialogs.js'
import { DropOverlay } from './drop.js'
import { ExplorerTree } from './tree.js'
import { VcsBar } from './vcs.js'
import { vcsBarModel, vcsPendingAutoExpand } from '../../vcs.js'
import { useVcsStatus } from './hooks/vcs.js'
import { useDiffBase } from './hooks/diff-base.js'
import { diffReasonKey, summaryHasChanges } from '../../diff-gutter.js'
import { PreviewPane, StaticPreviewPane } from './preview.js'
import { PaneSplitter } from './pane-splitter.js'
import { useMobile } from '../../mobile.js'
import { PreviewTabs } from './tabs.js'
import { SearchResults } from './search.js'
import { useDismissMenu } from './hooks/dismiss.js'
import { useEditorSession } from './hooks/editor-session.js'
import { usePreviewScrollbar } from './hooks/scrollbar.js'
import { useSearchState } from './hooks/search.js'
import { useSessionRename } from './hooks/session-rename.js'
import { isByteKind, isHtmlName, isImageName, isMarkdownName, isOfficeName, isPdfName, RENDERER_CODE, RENDERER_IMAGE, RENDERER_MARKDOWN, VIEW_EDIT, VIEW_PREVIEW, viewerCandidates } from '../../renderers/registry.js'
import { isRunnableName } from '../../run-detect.js'
import { setRunCollapsed, useRunEntry } from '../../run-store.js'
import { PlanView } from '../../renderers/plan-view.js'
import { MusicDock } from '../music/index.js'
import { composeMusicScore } from '../../../shared/music-score.js'
import { normalizeMusicPrefs } from '../../music-prefs.js'
import { ReviewView } from '../../renderers/review-view.js'
import { PermissionPage } from '../permissions.js'
import { usePendingPermissions } from '../../permission-store.js'
import { shouldSkipPoll } from '../../poll-gate.js'

/* Whether a preview tab has no file-tree row: a docked mind map, an opened plan or change
   review, or a file OUTSIDE the workspace. It selects nothing and is never revealed —
   revealing an outside path would ask the Host to list "ancestor" directories the fence
   refuses (400 invalid-path). */
function hasNoTreeRow(tab) {
  return isSyntheticTab(tab) || tab?.outside === true
}

/* The tab a file-tree entry opens. `temporary` is the single-click preview slot; the
   permanent and preview paths share this one shape so they cannot drift apart. */
function fileTabFromEntry(entry, temporary, pane = PREVIEW_PANE_TOP) {
  return {
    baseText: '',
    dirty: false,
    draft: '',
    draftKnown: false,
    editing: false,
    name: entry.name,
    pane: pane === PREVIEW_PANE_BOTTOM ? PREVIEW_PANE_BOTTOM : PREVIEW_PANE_TOP,
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
    temporary: temporary === true,
  }
}

/* The flat tab array is the runtime source of truth; this keeps its pane blocks contiguous and
   pinned-first inside each pane, so every strip render and every persisted group is canonical.
   It runs on every tab update (the setTabs wrapper), making move/pin/unpin order-independent. */
function orderTabLayout(tabs) {
  const list = Array.isArray(tabs) ? tabs : []
  const top = orderPinnedFirst(list.filter(tab => paneOfTab(tab) === PREVIEW_PANE_TOP))
  const bottom = orderPinnedFirst(list.filter(tab => paneOfTab(tab) === PREVIEW_PANE_BOTTOM))
  return [...top, ...bottom]
}

/* The default viewer mode of a file: documents open rendered, source files open in the editor. */
function defaultViewModeOf(tab) {
  return tab !== undefined && (isHtmlName(tab.name) || isMarkdownName(tab.name)) ? VIEW_PREVIEW : VIEW_EDIT
}

/* Bounded concurrency for the version-control auto-expansion: a large change set must not fire one
   directory listing per ancestor directory at the same moment. `loadDirectory` reports its own
   failures (it sets the directory's error row), so a rejection here is only a safety net. */
const VCS_AUTO_EXPAND_CONCURRENCY = 6
async function loadDirectoriesBounded(paths, load) {
  let index = 0
  const worker = async () => {
    while (index < paths.length) {
      const path = paths[index]
      index += 1
      try {
        await load(path)
      } catch { /* reported by the loader */ }
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(VCS_AUTO_EXPAND_CONCURRENCY, paths.length); i += 1) workers.push(worker())
  await Promise.all(workers)
}


export function WorkspaceExplorer({
  workspace, treePortalTarget, sessionTitle, sessionId, previewSessionId, renameSession, publishEditorContext, listDirectory, readFile, saveFile, createEntry, renameEntry, storedPreviewSession, persistPreviewSession, settingsStore, loadDraft, persistDraftFile, removeDraftFile, draftTree, checkFileChange, mindmapActions, sessionCwdOf,
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const mobile = useMobile()
  /* Draft scope follows the shared persistence key: inside a mind map every member session shares one draft scope (the map's root), since the tab strip and its in-memory draft are shared. */
  const draftScopeId = sessionId === undefined ? `workspace:${workspace.workspaceId}` : `session:${previewSessionId ?? sessionId}`
  /* Restore under this mount's persistence family: a docked mind-map tab whose dockedAt stamp
     names another family must not reappear here. */
  const initialPreviewSession = normalizePreviewSession(storedPreviewSession, previewSessionId)
  const initialPaneActive = initialPreviewSession.paneActive
  const [directories, setDirectories] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  /* `tabs` stays the flat runtime list; every write goes through the wrapper so the pane blocks
     stay grouped and pinned-first inside each pane (orderTabLayout). */
  const [tabs, setTabsState] = useState(() => initialPreviewSession.tabs)
  const setTabs = useCallback((updater) => {
    setTabsState(current => orderTabLayout(typeof updater === 'function' ? updater(current) : updater))
  }, [])
  /* Per-pane active tab and the last-focused pane. `activePath` is derived from the focused pane:
     the single live editor session always follows it. */
  const [paneActive, setPaneActive] = useState(() => initialPaneActive)
  const [focusedPane, setFocusedPane] = useState(() => initialPreviewSession.focusedPane)
  const [splitRatio, setSplitRatio] = useState(() => initialPreviewSession.splitRatio)
  const activePath = paneActive[focusedPane] ?? null
  /* Viewer mode is per pane, not per file: switching focus keeps the pane's mode, activating a
     different tab in that pane resets it from the file's default (markdown/html = rendered). */
  const [viewModes, setViewModes] = useState(() => {
    const modeOf = (pane) => {
      const path = initialPaneActive[pane]
      return defaultViewModeOf(initialPreviewSession.tabs.find(tab => tab.path === path))
    }
    return { a: modeOf(PREVIEW_PANE_TOP), b: modeOf(PREVIEW_PANE_BOTTOM) }
  })
  const viewMode = viewModes[focusedPane]
  /* Per-session-page music settings (model choice + roll height). They live in the preview
     snapshot next to the tabs, so a map family shares one page and each session keeps its own. */
  const [musicPrefs, setMusicPrefs] = useState(() => normalizeMusicPrefs(initialPreviewSession.musicPrefs))
  const musicPrefsRef = useRef(musicPrefs)
  musicPrefsRef.current = musicPrefs
  const [selected, setSelected] = useState(() => {
    if (initialPreviewSession.activePath === null) return undefined
    const activeTab = initialPreviewSession.tabs.find(tab => tab.path === initialPreviewSession.activePath)
    if (activeTab === undefined || hasNoTreeRow(activeTab)) return undefined
    return entryFromPreviewTab(activeTab)
  })
  const [reloadToken, setReloadToken] = useState(0)
  /* Version-control display: the "changes only" tree view is session-transient (a refresh restores
     the full tree), so a user can never lose sight of a file because of a forgotten filter. */
  const [vcsChangesOnly, setVcsChangesOnly] = useState(false)
  const [searchReveal, setSearchReveal] = useState()
  const [encodingMenu, setEncodingMenu] = useState()
  const [encodingDialog, setEncodingDialog] = useState()
  const [encodingPick, setEncodingPick] = useState('utf-8')
  const [encodingOptions, setEncodingOptions] = useState(ENCODING_FALLBACK)
  const [draggingPath, setDraggingPath] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)
  const [dropPane, setDropPane] = useState(null)
  /* The lower-half split drop zone: shown only while a tab is dragged in the single-pane layout. */
  const [dropZone, setDropZone] = useState(false)
  /* In the split layout, the OTHER pane highlights when a dragged tab hovers over its body. */
  const [dropBodyPane, setDropBodyPane] = useState(null)
  const [dropActive, setDropActive] = useState(false)
  const [previewToast, setPreviewToast] = useState()
  /* Preview text size: the header stepper edits the ACTIVE tab's own percentage, and clicking its
     number swaps it for an input. `fontDraft` is that input's text ('' = nothing typed yet). */
  const [fontEditing, setFontEditing] = useState(false)
  const [fontDraft, setFontDraft] = useState('')
  const [entryDialog, setEntryDialog] = useState()
  const [entryDraft, setEntryDraft] = useState('')
  const [entryBusy, setEntryBusy] = useState(false)
  const [entryError, setEntryError] = useState()
  const [contextMenu, setContextMenu] = useState()
  const [tabContextMenu, setTabContextMenu] = useState()
  const [stripMenu, setStripMenu] = useState()
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
  const stripMenuRef = useRef(null)
  const titleMenuRef = useRef(null)
  const encodingMenuRef = useRef(null)
  const requestedEncodingRef = useRef()
  // Set by the preview-header refresh action; the file-read effect consumes it and surfaces a "reloaded" status.
  const refreshPendingRef = useRef(null)
  // Like refreshPendingRef but for the cancel action: surfaces the "reloaded from disk" status once the discard re-read completes.
  const cancelRestoreRef = useRef(null)
  /* Per-pane strips and their floating scrollbars; the live editor only uses the focused pane's
     header/search refs, while both strips keep their own tab scroll state. */
  const previewTabsRefA = useRef(null)
  const previewTabsRefB = useRef(null)
  // The file tree's native scroll container; its scrollTop must be restored after a refresh re-lists expanded directories.
  const treeScrollRef = useRef(null)
  const previewSectionRef = useRef(null)
  const previewScrollbarRefA = useRef(null)
  const previewScrollbarRefB = useRef(null)
  const previewScrollThumbRefA = useRef(null)
  const previewScrollThumbRefB = useRef(null)
  const previewHeaderRef = useRef(null)
  /* The strip a tab/strip menu points at: its scroll region owns the menu (menu-dismiss §50). */
  const tabMenuAnchorRef = useRef(null)
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
  const paneActiveRef = useRef(initialPaneActive)
  const focusedPaneRef = useRef(initialPreviewSession.focusedPane)
  const splitRatioRef = useRef(initialPreviewSession.splitRatio)
  const setViewMode = useCallback((mode) => {
    const pane = focusedPaneRef.current
    setViewModes(current => current[pane] === mode ? current : { ...current, [pane]: mode })
  }, [])
  const expandedRef = useRef(new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  // Live editor scroll positions, written per scroll event without touching React state or persistence.
  const scrollTopRef = useRef(new Map())
  const sessionEstablishedRef = useRef(false)
  /* Whether this mount ever persisted real content (a persistable tab or a tree expansion); the skip guard below applies only while nothing real was ever persisted. */
  const persistedRealContentRef = useRef(initialPreviewSession.tabs.some(tab => !isUnpersistedTab(tab)) || (initialPreviewSession.expanded ?? []).length > 0)
  // Paths confirmed missing while restoring persisted expansion; later restore passes skip them until the cleaned snapshot is persisted.
  const prunedPathsRef = useRef(new Set())
  const previewTabsBootstrapped = useRef(Boolean(initialPreviewSession.tabs.length > 0 || initialPreviewSession.activePath !== null))
  /* Working-copy status (git / svn) for this workspace: one shared payload feeds the status bar,
     the tree badges and the changes list. It is display-only, so it can be switched off entirely
     (user setting) or disabled by the Host without touching any other explorer behavior. */
  const vcsEnabled = settings.vcsEnabled !== false
  const vcsPaneVisible = useCallback(() => {
    const container = treeScrollRef.current
    /* The tree lives in the sidebar's files region, which is `display:none` while the session list
       fills the sidebar: skip the poll rather than spawn a status command for a pane nobody can see.
       A missing container (first render) counts as visible so the initial read still happens. */
    return container === null || container === undefined || container.offsetParent !== null
  }, [])
  const vcs = useVcsStatus({
    workspaceId: workspace.workspaceId,
    enabled: vcsEnabled,
    autoRefresh: settings.vcsAutoRefresh !== false,
    includeIgnored: settings.vcsShowIgnored === true,
    isPaneVisible: vcsPaneVisible,
  })
  const vcsModel = vcsBarModel({ payload: vcs.payload, error: vcs.error, loading: vcs.loading })
  /* The refresh triggers live inside callbacks defined below, whose dependency arrays must not grow
     with the hook's own identity: they read it through this mirror ref instead. */
  const vcsRef = useRef(vcs)
  vcsRef.current = vcs
  const selectedDirectoryPath = selectedLevelPath(selected)
  const activatePath = useCallback((path, pane = focusedPaneRef.current) => {
    // A cancel marker belongs to one file; switching files must not let a stale marker decorate a later read.
    if (path !== activePathRef.current) cancelRestoreRef.current = null
    if (pane === focusedPaneRef.current) activePathRef.current = path
    setPaneActive(current => current[pane] === path ? current : { ...current, [pane]: path })
  }, [])
  /* Focus a tab that already exists (possibly in the other pane) without duplicating it. The
     live editor session follows the focused pane's active path, so focusing the owner pane is
     enough; refs are updated eagerly for callers that run in the same event. */
  const selectTabInPane = useCallback((tab) => {
    const pane = paneOfTab(tab)
    if (pane !== focusedPaneRef.current) {
      focusedPaneRef.current = pane
      setFocusedPane(pane)
    }
    paneActiveRef.current = { ...paneActiveRef.current, [pane]: tab.path }
    activePathRef.current = tab.path
    setPaneActive(current => current[pane] === tab.path ? current : { ...current, [pane]: tab.path })
    if (hasNoTreeRow(tab)) setSelected(undefined)
    else setSelected(entryFromPreviewTab(tab))
  }, [])
  /* Open the music workshop: mint one synthetic music tab. The score starts as a deterministic
     sketch so the transport is immediately playable; the panel replaces it with an AI answer
     (or the Host template) on demand. */
  const openMusicWorkshop = useCallback(() => {
    setTabContextMenu(undefined)
    setStripMenu(undefined)
    const path = musicTabPath(`new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    setTabs(current => (current.some(tab => tab.path === path) ? current : [...current, {
      baseText: '',
      baseRevision: null,
      bom: false,
      dirty: false,
      draft: '',
      draftKnown: false,
      editing: false,
      encoding: 'utf-8',
      external: false,
      kind: 'music',
      lineEnding: 'none',
      musicDoc: composeMusicScore({ bars: 8 }),
      musicRev: 0,
      name: translate('music.tab'),
      pane: focusedPaneRef.current,
      path,
      pinned: false,
      revision: null,
      savedPath: null,
      saving: false,
      scrollTop: 0,
      size: null,
      status: undefined,
      symlink: false,
    }]))
    setSelected(undefined)
    activatePath(path)
  }, [activatePath])

  /* Chat auto-generation: open a NEW workshop tab for one claimed job. A new tab is deliberate —
     the user's existing score (saved or not) is never replaced by a background request. */
  const autoJobIdsRef = useRef(new Set())
  const openMusicJobTab = useCallback((job) => {
    const id = typeof job?.id === 'string' ? job.id : ''
    if (id === '' || autoJobIdsRef.current.has(id)) return
    if (autoJobIdsRef.current.size > 32) autoJobIdsRef.current.clear()
    autoJobIdsRef.current.add(id)
    setTabContextMenu(undefined)
    setStripMenu(undefined)
    const bars = Number.isFinite(Number(job?.params?.bars)) ? Math.max(4, Math.min(64, Math.round(Number(job.params.bars)))) : 8
    const path = musicTabPath(`auto-${id}`)
    setTabs(current => {
      if (current.some(tab => tab.path === path)) return patchTab(current, path, { autoJob: job })
      return [...current, {
        autoJob: job,
        baseText: '',
        baseRevision: null,
        bom: false,
        dirty: false,
        draft: '',
        draftKnown: false,
        editing: false,
        encoding: 'utf-8',
        external: false,
        kind: 'music',
        lineEnding: 'none',
        musicDoc: composeMusicScore({ bars }),
        musicRev: 0,
        name: translate('music.tab'),
        pane: focusedPaneRef.current,
        path,
        pinned: false,
        revision: null,
        savedPath: null,
        saving: false,
        scrollTop: 0,
        size: null,
        status: undefined,
        symlink: false,
      }]
    })
    setSelected(undefined)
    activatePath(path)
  }, [activatePath])

  /* Chat job poller: one light request per 3s while the page is visible. The Host answers
     `{ job: null }` when there is nothing to do and `{ busy: true }` while one job runs, so an
     idle poll costs a small JSON round-trip on loopback. Hidden tabs skip (a background page
     must not drive generation); the tool's Host fallback covers that case. */
  useEffect(() => {
    const session = sessionId ?? previewSessionId
    if (typeof session !== 'string' || session === '') return undefined
    let cancelled = false
    let timer = 0
    let controller = null
    const schedule = (delay) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, delay)
    }
    const tick = async () => {
      if (cancelled) return
      if (shouldSkipPoll()) {
        schedule(3000)
        return
      }
      controller = new AbortController()
      try {
        const result = await pollMusicJobRequest(session, controller.signal)
        if (cancelled) return
        const job = result !== null && typeof result === 'object' ? result.job : null
        if (job !== null && typeof job === 'object' && typeof job.id === 'string') openMusicJobTab(job)
        schedule(3000)
      } catch (error) {
        if (cancelled) return
        /* An old Host has no /music/jobs route (a new client before a dsh restart): back off
           instead of hammering a 404; the tool itself does not exist on such a Host. */
        schedule(error?.status === 404 ? 60_000 : 5_000)
      }
    }
    schedule(0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (controller !== null) controller.abort()
    }
  }, [openMusicJobTab, previewSessionId, sessionId])

  /* Open the console file-permission page: one synthetic tab per scope (the current Session, or its
     mind-map root). Re-opening an already open scope activates that tab instead of duplicating it. */
  const openPermissionsPage = useCallback(() => {
    setTabContextMenu(undefined)
    setStripMenu(undefined)
    if (sessionId === null || sessionId === undefined || String(sessionId) === '') return
    const scopeKey = previewSessionId ?? String(sessionId)
    const path = permissionTabPath(scopeKey)
    const existing = tabsRef.current.find(tab => tab.path === path)
    if (existing !== undefined) {
      selectTabInPane(existing)
      return
    }
    setTabs(current => (current.some(tab => tab.path === path) ? current : [...current, {
      baseText: '',
      baseRevision: null,
      bom: false,
      dirty: false,
      draft: '',
      draftKnown: false,
      editing: false,
      encoding: 'utf-8',
      external: false,
      kind: 'permissions',
      lineEnding: 'none',
      name: translate('permissions.tab'),
      pane: focusedPaneRef.current,
      path,
      pinned: false,
      revision: null,
      savedPath: null,
      saving: false,
      scrollTop: 0,
      sessionId: null,
      size: null,
      status: undefined,
      symlink: false,
    }]))
    setSelected(undefined)
    activatePath(path)
  }, [activatePath, previewSessionId, sessionId])

  useLayoutEffect(() => { tabsRef.current = tabs }, [tabs])
  useLayoutEffect(() => { activePathRef.current = activePath }, [activePath])
  useLayoutEffect(() => { paneActiveRef.current = paneActive }, [paneActive])
  useLayoutEffect(() => { focusedPaneRef.current = focusedPane }, [focusedPane])
  useLayoutEffect(() => { splitRatioRef.current = splitRatio }, [splitRatio])
  useLayoutEffect(() => { expandedRef.current = expanded }, [expanded])
  const activeTab = useMemo(() => activePath === null ? undefined : tabs.find(tab => tab.path === activePath), [activePath, tabs])
  const topTabs = useMemo(() => tabsOfPane(tabs, PREVIEW_PANE_TOP), [tabs])
  const bottomTabs = useMemo(() => tabsOfPane(tabs, PREVIEW_PANE_BOTTOM), [tabs])
  const splitOpen = bottomTabs.length > 0
  const topActivePath = paneActive[PREVIEW_PANE_TOP] ?? null
  const bottomActivePath = paneActive[PREVIEW_PANE_BOTTOM] ?? null
  const topActiveTab = topActivePath === null ? undefined : topTabs.find(tab => tab.path === topActivePath)
  const bottomActiveTab = bottomActivePath === null ? undefined : bottomTabs.find(tab => tab.path === bottomActivePath)
  const otherPane = focusedPane === PREVIEW_PANE_TOP ? PREVIEW_PANE_BOTTOM : PREVIEW_PANE_TOP
  const otherActiveTab = otherPane === PREVIEW_PANE_TOP ? topActiveTab : bottomActiveTab
  /* A mind-map tab hosts the global host's stable body container instead of a file: no file header, status bar, tree selection, or file read. A plan tab renders a harness plan document instead of a file and is equally chrome-free. */
  const activeMindmap = activeTab !== undefined && isMindmapTab(activeTab)
  const activePlan = activeTab !== undefined && isPlanTab(activeTab)
  /* A review tab draws its own body, header, and file list: the file header and
     the bottom status bar belong to a file tab and are hidden with it. */
  const activeReview = activeTab !== undefined && isReviewTab(activeTab)
  /* A music tab renders its own transport, headers and status; the file chrome stays hidden. */
  const activeMusic = activeTab !== undefined && isMusicTab(activeTab)
  /* The console file-permission page draws its own header/body/status; it is not a file either. */
  const activePermission = activeTab !== undefined && isPermissionTab(activeTab)
  const permissionPending = usePendingPermissions()
  /* The context-menu badge is the CURRENT scope's queue, not every session's: a pending command in
     another mind map must not decorate this menu. The global prompt still shows every request. */
  const permissionScopeKey = previewSessionId !== undefined && previewSessionId !== null
    ? `root:${String(previewSessionId)}`
    : (sessionId !== undefined && sessionId !== null && String(sessionId) !== '' ? `session:${String(sessionId)}` : null)
  const permissionPendingCount = permissionScopeKey === null
    ? 0
    : permissionPending.requests.filter(request => request?.scope?.key === permissionScopeKey).length
  /* A session switch inside the same mind map keeps this explorer mounted, so the editor context would stay bound to the previous session; clear it for the new session. */
  const lastSessionIdRef = useRef(sessionId)
  useEffect(() => {
    if (lastSessionIdRef.current === sessionId) return
    lastSessionIdRef.current = sessionId
    if (activePath === null || isSyntheticTab(activeTab)) publishEditorContext(undefined)
  }, [activePath, activeTab, publishEditorContext, sessionId])
  const hasDirtyTabs = useMemo(() => tabs.some(tab => tab.dirty || tab.saving), [tabs])
  /* Every tab becoming clean again means a save just landed, so the working copy may have moved:
     re-read the version-control status once the burst settles. Closing a dirty tab lowers the count
     too — one needless (cheap, cached) read, which is preferable to missing a save. */
  const dirtyTabCount = useMemo(() => tabs.filter(tab => tab.dirty || tab.saving).length, [tabs])
  const previousDirtyCountRef = useRef(dirtyTabCount)
  useEffect(() => {
    if (dirtyTabCount < previousDirtyCountRef.current) vcsRef.current.refreshSoon()
    previousDirtyCountRef.current = dirtyTabCount
  }, [dirtyTabCount])
  /* ONE owner for "patch the tab at this path" (preview-tabs.js patchTab): updateTab names the path,
     updateActiveTab takes it from the active ref. */
  const updateTab = useCallback((path, patch) => {
    setTabs(current => patchTab(current, path, patch))
  }, [])
  const updateActiveTab = useCallback((patch) => {
    const path = activePathRef.current
    if (path === null) return
    updateTab(path, patch)
  }, [updateTab])
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
    persistPreviewSession(serializePreviewSession(activePathRef.current, snapshotTabs, expandedRef.current, musicPrefsRef.current, {
      focusedPane: focusedPaneRef.current,
      paneActive: paneActiveRef.current,
      splitRatio: splitRatioRef.current,
    }))
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
  /* The music panel writes page-level settings through here. The ref is updated synchronously
     (the persistence microtask reads it) and the write is scheduled immediately: changing only a
     model/height must reach the snapshot even when no tab/edit changed. */
  const updateMusicPrefs = useCallback((patch) => {
    setMusicPrefs((current) => {
      const next = normalizeMusicPrefs({ ...current, ...patch })
      musicPrefsRef.current = next
      return next
    })
    schedulePersist()
  }, [schedulePersist])
  useLayoutEffect(() => { schedulePersist() }, [activePath, expanded, focusedPane, musicPrefs, paneActive, schedulePersist, splitRatio, tabs])

  /* Dock requests from the sidebar mind-map entries and the session-header button: add/update the mind-map tab and activate it. A request is consumed only when its expectFamily matches this mount's previewSessionId. */
  usePendingRequest(mindmapDockStore, previewSessionId ?? null, (request) => {
    const path = mindmapTabPath(request.rootId)
    /* The map needs a body in the global host: a new tab's body mounts fresh, while a re-dock of an already-open tab is a no-op. */
    mindmapViewHost.ensure(String(request.rootId), true)
    /* Stamp the persistence family the tab was docked on so a snapshot carrying the tab cannot leak it into unrelated sessions. */
    const dockedAt = previewSessionId ?? null
    const existingTab = tabsRef.current.find(tab => tab.path === path)
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
        draft: '',
        draftKnown: false,
        editing: false,
        encoding: 'utf-8',
        external: false,
        kind: 'mindmap',
        lineEnding: 'none',
        name: request.name,
        pane: focusedPaneRef.current,
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
    if (existingTab !== undefined) selectTabInPane(existingTab)
    else {
      setSelected(undefined)
      activatePath(path)
    }
  })

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
  /* Consumed by the explorer showing the plan's own session — the chat's session, or the map root whose preview strip the chat shares — so either identity is accepted. Any other mount leaves the request pending for the matching one. */
  usePendingRequest(planOpenStore, [previewSessionId ?? null, sessionId ?? null], (request) => {
    const path = planTabPath(request.address)
    const existing = tabsRef.current.find(tab => tab.path === path)
    setTabs(current => hasTabPath(current, path)
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
        pane: focusedPaneRef.current,
        path,
        pinned: false,
        revision: null,
        saving: false,
        scrollTop: 0,
        sessionId: null,
        size: null,
        symlink: false,
      }])
    if (existing !== undefined) selectTabInPane(existing)
    else {
      setSelected(undefined)
      activatePath(path)
    }
  })

  /* Open requests for change reviews (the chat's changed-files card): the openResource router
     publishes them, and the explorer whose previewSessionId matches the request's family consumes
     one as a session-only review tab, carrying the review's dsh-resource address in its synthetic
     path plus the file index the card was clicked on; a later click on another row re-seeds that
     index on the SAME tab instead of opening a second one. Consumed by the explorer showing the
     review's own session — the chat's session, or the map root whose preview strip the chat
     shares — so either identity is accepted; any other mount leaves the request pending for the
     matching one. */
  usePendingRequest(reviewOpenStore, [previewSessionId ?? null, sessionId ?? null], (request) => {
    const path = reviewTabPath(request.address)
    const existing = tabsRef.current.find(tab => tab.path === path)
    const coordinates = parseChangesReviewAddress(request.address)
    setTabs(current => hasTabPath(current, path)
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
        pane: focusedPaneRef.current,
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
    if (existing !== undefined) selectTabInPane(existing)
    else {
      setSelected(undefined)
      activatePath(path)
    }
  })

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
  /* Preview text size, part 2 of 2: the settings page's "every tab back to the base size" action
     lives in another slot tree, so it reaches this mounted explorer through a module-level
     registry. The handler is re-created every render (it reads the current tabs) but registered
     once, and forwards through a ref so the registry never holds a stale closure. */
  const clearFontOverridesRef = useRef(null)
  clearFontOverridesRef.current = () => {
    setTabs(current => (current.some(tab => Number.isFinite(tab.fontPercent))
      ? current.map(tab => (Number.isFinite(tab.fontPercent) ? { ...tab, fontPercent: undefined } : tab))
      : current))
    setStatus({ text: translate('status.textSizeClearedAll', { percent: clampFontPercent(settings.previewFontScale ?? FONT_SCALE_DEFAULT) }) })
  }
  useEffect(() => registerPreviewFontReset(() => { clearFontOverridesRef.current?.() }), [])
  /* Switching tabs commits (or cancels) the size input through its own blur, but a synthetic tab
     (mind map / plan / review) removes the whole file header unmounting the input without a blur —
     so the draft must not survive into the next file tab that shows the header again. */
  useEffect(() => { setFontEditing(false); setFontDraft('') }, [activePath])
  /* Retain CodeMirror EditorSessions per open file tab so re-activating a tab passes the entry back as `restore` and undo/selection/folds survive the view swap. */
  const retainEditorState = useCallback((path, session) => {
    retainedStatesRef.current.set(path, session)
  }, [retainedStatesRef])
  const search = useSearchState({ workspaceId: workspace.workspaceId, settings })
  /* Renderer dispatch (registry-driven): markdown/html offer a rendered preview, byte renderers
     (image/pdf/office) render standalone, and read-only text files offer a paged full-file browse.
     These four sit ABOVE the change-gutter block on purpose: its eligibility test reads `showBrowse`,
     and declaring them further down turns that read into a temporal-dead-zone crash at render time. */
  const isMarkdown = preview.state === 'ready' && isMarkdownName(preview.name)
  const isHtmlFile = preview.state === 'ready' && isHtmlName(preview.name)
  const isReadOnlyText = preview.state === 'ready' && !isByteKind(preview.kind)
    && (preview.editable === false || preview.readOnlyReason)
  /* Browse mode = the paged full-file view; it replaces the editor for read-only text files, while HTML keeps the iframe overlay. A dropped-in file has no path the Remote could read (its content lives only in memory), but a file OUTSIDE the workspace does — the Remote reads its absolute path — so that tab browses like any other read-only file. */
  const showBrowse = viewMode === VIEW_PREVIEW && isReadOnlyText && !isHtmlFile
    && (activeTab?.external !== true || activeTab?.outside === true)
  /* ---- Change gutter (editor) + its status-bar summary ----
   * The base revision comes from the Host (HEAD / SVN BASE); the editor diffs it against its live
   * buffer and reports the counts back here, so the status bar recap and the gutter always agree. */
  /* Only the tab kinds that actually render the CodeMirror editor carry a gutter: images, PDF/Office
     conversions and the paged read-only view have no line-number column to annotate. */
  const diffEligible = vcsEnabled === true && preview.state === 'ready'
    && !isByteKind(preview.kind)
    && showBrowse !== true
    && activeTab !== undefined
    && !isSyntheticTab(activeTab) && activeTab.external !== true && activeTab.outside !== true
  const diffEntry = diffEligible ? vcs.overlay.byPath.get(activeTab.path) : undefined
  /* The repository has no base for a new file: the whole buffer is new, so no request is needed
     (the tree shows the same file as ? / A). */
  const diffNewFile = diffEntry !== undefined && (diffEntry.untracked === true || diffEntry.status === 'A')
  const [diffBaseEpoch, setDiffBaseEpoch] = useState(0)
  const diffBaseState = useDiffBase({
    workspaceId: workspace.workspaceId,
    path: diffEligible ? activeTab.path : undefined,
    encoding: preview.encoding,
    enabled: diffEligible && diffNewFile !== true,
    epoch: diffBaseEpoch,
  })
  const diffBaseLabel = diffBaseState.status === 'ready' && typeof diffBaseState.payload?.baseLabel === 'string' && diffBaseState.payload.baseLabel !== ''
    ? diffBaseState.payload.baseLabel
    : (vcs.payload?.kind === 'svn' ? 'BASE' : 'HEAD')
  /* An undefined `diffBase` means "nothing to say": no repository, feature off, or the base is still
     loading. A known-but-unusable base carries its `reason` so the status bar can explain it. */
  const diffBase = (() => {
    if (diffEligible !== true) return undefined
    if (diffNewFile === true) return { exists: false, newFile: true, baseLabel: diffBaseLabel }
    if (diffBaseState.status === 'error') return { exists: false, newFile: false, reason: 'fetch-failed', baseLabel: diffBaseLabel }
    if (diffBaseState.status !== 'ready') return undefined
    const payload = diffBaseState.payload
    if (payload?.exists === true && typeof payload.content === 'string') {
      return { exists: true, content: payload.content, newFile: false, baseLabel: diffBaseLabel }
    }
    const reason = payload?.reason
    /* Not having a repository (or no CLI) is already explained by the status strip: stay silent. */
    if (reason === 'no-repo' || reason === 'disabled' || reason === 'vcs-unavailable') return undefined
    return { exists: false, newFile: false, reason: reason ?? 'no-base', baseLabel: diffBaseLabel }
  })()
  const [diffSummary, setDiffSummary] = useState()
  /* Scrollbar change ruler: the whole preview column's vertical bars share one width, and the marks
     themselves are written by the editor onto its own scroller (the same mark list as the gutter).
     Off = none of the ruler rules apply, so every bar keeps the harness's 8px look. */
  const diffRulerOn = settings.diffRuler !== false
  const diffRulerWidth = clamp(settings.diffRulerWidth ?? DIFF_RULER_WIDTH_DEFAULT, DIFF_RULER_WIDTH_MIN, DIFF_RULER_WIDTH_MAX)
  /* Only adopt a genuinely different report: the editor re-reports on every recompute, and an
     identical payload must not re-render the whole explorer. */
  const handleDiffSummary = useCallback((next) => {
    setDiffSummary(current => {
      if (current === next) return current
      if (current !== undefined && next !== undefined
        && current.status === next.status && current.reason === next.reason && current.baseLabel === next.baseLabel
        && current.summary?.added === next.summary?.added
        && current.summary?.modified === next.summary?.modified
        && current.summary?.deleted === next.summary?.deleted) return current
      return next
    })
  }, [])
  useEffect(() => { setDiffSummary(undefined) }, [activePath, preview.encoding, readEpoch])
  /* A commit / branch switch / checkout moves the base: the status payload's label changes, so the
     cached base text (and the marks built from it) is re-read. */
  const diffLabelRef = useRef(undefined)
  useEffect(() => {
    const label = `${vcs.payload?.kind ?? ''}:${vcs.payload?.label ?? ''}`
    if (diffLabelRef.current === undefined) { diffLabelRef.current = label; return }
    if (diffLabelRef.current === label) return
    diffLabelRef.current = label
    setDiffBaseEpoch(current => current + 1)
  }, [vcs.payload?.kind, vcs.payload?.label])
  const sessionRename = useSessionRename({ sessionId, sessionTitle, renameSession, mounted })
  const scrollbarA = usePreviewScrollbar({
    previewTabsRef: previewTabsRefA,
    previewScrollbarRef: previewScrollbarRefA,
    previewScrollThumbRef: previewScrollThumbRefA,
    activePath: topActivePath,
    tabsLength: topTabs.length,
  })
  const scrollbarB = usePreviewScrollbar({
    previewTabsRef: previewTabsRefB,
    previewScrollbarRef: previewScrollbarRefB,
    previewScrollThumbRef: previewScrollThumbRefB,
    activePath: bottomActivePath,
    tabsLength: bottomTabs.length,
  })
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
    scrollTabIntoView: scrollTabIntoViewA, handleTabsMouseEnter: handleTabsMouseEnterA,
    handleTabsMouseLeave: handleTabsMouseLeaveA, handleTabsScroll: handleTabsScrollA,
    handleScrollbarMouseEnter: handleScrollbarMouseEnterA, handleScrollbarMouseLeave: handleScrollbarMouseLeaveA,
    handleScrollbarPointerDown: handleScrollbarPointerDownA, handleScrollbarPointerMove: handleScrollbarPointerMoveA,
    handleScrollbarPointerEnd: handleScrollbarPointerEndA,
  } = scrollbarA
  const {
    scrollTabIntoView: scrollTabIntoViewB, handleTabsMouseEnter: handleTabsMouseEnterB,
    handleTabsMouseLeave: handleTabsMouseLeaveB, handleTabsScroll: handleTabsScrollB,
    handleScrollbarMouseEnter: handleScrollbarMouseEnterB, handleScrollbarMouseLeave: handleScrollbarMouseLeaveB,
    handleScrollbarPointerDown: handleScrollbarPointerDownB, handleScrollbarPointerMove: handleScrollbarPointerMoveB,
    handleScrollbarPointerEnd: handleScrollbarPointerEndB,
  } = scrollbarB
  /* Scroll a tab into view in its own strip; each hook ignores a path its strip does not own. */
  const scrollTabIntoView = useCallback((path) => {
    scrollTabIntoViewA(path)
    scrollTabIntoViewB(path)
  }, [scrollTabIntoViewA, scrollTabIntoViewB])
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
      /* Apply only while this request is still the LATEST for the path (a superseded
         request can resolve after its abort) and the explorer is still mounted: a stale
         response must never overwrite a newer listing, and an unmounted explorer must
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
  /* A saved score becomes visible in the tree without a manual refresh: expand its ancestors,
     drop the cached parent listing and re-list every directory along the path. */
  const revealSavedScore = useCallback((path) => {
    if (typeof path !== 'string' || path === '') return
    const ancestors = ancestorDirectoryPaths(path)
    setExpanded(current => {
      const next = new Set(current)
      for (const directory of ancestors) next.add(directory)
      return next
    })
    invalidateCachedSubtree(parentPath(path))
    for (const directory of ancestors) void loadDirectory(directory, { pruneOnMissing: true })
  }, [loadDirectory])
  useEffect(() => { void loadDirectory('') }, [loadDirectory])
  /* "Changes only" must show EVERY change without a single click: every directory holding one
     (any ancestor of a changed path, straight from the status payload) is expanded and listed,
     already-listed ones are skipped (idempotent across status polls), and a small worker pool
     keeps a large change set from firing one request per directory at once. */
  const autoExpandedRef = useRef(new Set())
  useEffect(() => {
    if (vcsChangesOnly !== true) {
      autoExpandedRef.current.clear()
      return
    }
    /* Only the directories whose listing already arrived need to be materialized for the exclusion
       set; every other path is decided by the pure helper. */
    const readyDirs = new Set()
    for (const [path, value] of directories) {
      if (value?.state === 'ready') readyDirs.add(path)
    }
    const pending = vcsPendingAutoExpand(vcs.overlay, {
      expanded: expandedRef.current,
      ready: readyDirs,
      requested: autoExpandedRef.current,
    })
    if (pending.length === 0) return
    for (const dir of pending) autoExpandedRef.current.add(dir)
    setExpanded(cur => {
      const next = new Set(cur)
      for (const dir of pending) next.add(dir)
      return next
    })
    void loadDirectoriesBounded(pending, loadDirectory)
  }, [directories, loadDirectory, vcs.overlay, vcsChangesOnly])
  // Restore the persisted expansion: fetch every restored directory's listing so the tree renders
  // its children. Mount-only; ancestors are already in the persisted set, so nested folders appear.
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
      /* Load every non-ready directory in the chain INCLUDING the entry itself when it
         is a directory: chooseDirectory only selects + reveals, so skipping the entry
         left it stuck on the loading placeholder until a collapse + re-expand. */
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
    /* Late hydration must restore the whole pane layout, not just the focused path: a split
       snapshot arriving after mount would otherwise render as a single pane with no bottom
       active tab. Eager refs keep the read pass's dependencies consistent on the same commit. */
    paneActiveRef.current = next.paneActive
    focusedPaneRef.current = next.focusedPane
    splitRatioRef.current = next.splitRatio
    activePathRef.current = next.activePath
    setTabs(next.tabs)
    setPaneActive(next.paneActive)
    setFocusedPane(next.focusedPane)
    setSplitRatio(next.splitRatio)
    const nextTab = next.tabs.find(tab => tab.path === next.activePath)
    if (nextTab !== undefined) {
      if (hasNoTreeRow(nextTab)) {
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
  /* Permanent open (a tree double-click, the chat's file-open path, a search result):
     an already-open temporary tab is promoted in place instead of duplicated. */
  const chooseFile = useCallback((entry) => {
    previewTabsBootstrapped.current = true
    const existing = tabsRef.current.find(tab => tab.path === entry.path)
    if (existing !== undefined) {
      /* A file already open in either pane is never duplicated: focus its pane and (for a
         double-click) promote its temporary slot. */
      setTabs(current => promoteTemporaryTab(current, entry.path))
      selectTabInPane(existing)
      setSelected(entry)
      revealPath(entry)
      return
    }
    setSelected(entry)
    activatePath(entry.path)
    // A re-open re-runs the read pass, which re-seeds the change snapshot baseline so the polling tick never re-reports the just-loaded content.
    setTabs(current => openPermanentTab(current, fileTabFromEntry(entry, false, focusedPaneRef.current)))
    revealPath(entry)
  }, [activatePath, revealPath, selectTabInPane, setTabs])
  /* Single-click open: the temporary preview slot. A click on an already-open file only activates
     it (re-clicking the italic tab must not make it permanent); otherwise the existing temporary
     tab is displaced IN PLACE — the strip never reorders — and its runtime refs are dropped. A
     temporary tab holding unsaved work is never displaced: openPreviewTab promotes it and hands
     back a fresh slot for the new file. */
  const chooseFilePreview = useCallback((entry) => {
    previewTabsBootstrapped.current = true
    const existing = tabsRef.current.find(tab => tab.path === entry.path)
    if (existing !== undefined) {
      /* A single click on an already-open file only activates it (never promotes it). */
      selectTabInPane(existing)
      setSelected(entry)
      revealPath(entry)
      return
    }
    setSelected(entry)
    activatePath(entry.path)
    const pane = focusedPaneRef.current
    const { tabs: nextTabs, replacedPath } = openPreviewTab(tabsRef.current, fileTabFromEntry(entry, true, pane))
    setTabs(nextTabs)
    if (replacedPath !== null) forgetPathRefs(replacedPath)
    revealPath(entry)
  }, [activatePath, forgetPathRefs, revealPath, selectTabInPane, setTabs])
  /* Activating a tab in the strip never touches the tab list: a single click on an italic
     preview tab must not promote it (that is the strip's double-click), and routing this
     through chooseFile would silently do exactly that. */
  const activateTab = useCallback((tab) => {
    selectTabInPane(tab)
    if (hasNoTreeRow(tab)) return
    const entry = entryFromPreviewTab(tab)
    previewTabsBootstrapped.current = true
    setSelected(entry)
    revealPath(entry)
  }, [revealPath, selectTabInPane])
  /* The strip's double-click / a pin makes a preview tab permanent. */
  const promoteTab = useCallback((path) => {
    setTabs(current => promoteTemporaryTab(current, path))
  }, [])
  /* Editing a preview tab pins it, the same way an editor does: the italic marker drops as soon
     as the tab holds unsaved work, so the next single click cannot displace a tab whose debounced
     staging write has not landed yet. Idempotent (once promoted, no tab matches again) and free of
     extra persistence — `temporary` is outside previewSnapshotFingerprint. */
  useLayoutEffect(() => {
    const edited = tabs.filter(tab => isTemporaryTab(tab) && (tab.dirty === true || tab.saving === true))
    if (edited.length === 0) return
    setTabs(current => edited.reduce((acc, tab) => promoteTemporaryTab(acc, tab.path), current))
  }, [tabs])
  const chooseDirectory = useCallback((entry) => {
    setSelected(entry)
    revealPath(entry)
  }, [revealPath])
  /* Read-only preview of a file OUTSIDE the workspace (the chat's file-open path can name one):
     the workspace-confined API cannot serve it, so the tab is session-only and its content comes
     from the harness workspace-files Remote. No tree selection and no reveal: expanding its
     "ancestors" would fire directory reads the Host refuses on sight — the bug this path avoids. */
  const openOutsideFile = useCallback((entry) => {
    previewTabsBootstrapped.current = true
    const existing = tabsRef.current.find(tab => tab.path === entry.path)
    if (existing !== undefined) {
      selectTabInPane(existing)
      setSelected(undefined)
      return
    }
    setSelected(undefined)
    activatePath(entry.path)
    setTabs(current => hasTabPath(current, entry.path)
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
          pane: focusedPaneRef.current,
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
  usePendingRequest(fileOpenRequestStore, String(workspace.workspaceId), (request) => {
    const entry = { kind: 'file', name: request.name, path: request.path, symlink: false }
    if (request.outside === true) openOutsideFile(entry)
    else chooseFile(entry)
    if (request.line !== undefined) {
      setSearchReveal({ line: request.line, column: 1, endColumn: 1, path: request.path })
    }
  })
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
        pane: focusedPaneRef.current,
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
      setTabs(current => hasTabPath(current, path) ? current : [...current, tab])
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
  /* The viewer mode is scoped to one TAB, not to the window: switching the tab shown in either
     pane lands on that file's default view (Markdown / HTML render, everything else edits), while
     merely moving keyboard focus between panes keeps each pane's mode. */
  const lastPanePathsRef = useRef({ a: initialPaneActive.a, b: initialPaneActive.b })
  useLayoutEffect(() => {
    const next = { ...lastPanePathsRef.current }
    let changed = false
    for (const pane of [PREVIEW_PANE_TOP, PREVIEW_PANE_BOTTOM]) {
      const path = paneActive[pane] ?? null
      if (next[pane] === path) continue
      next[pane] = path
      const tab = tabsRef.current.find(candidate => candidate.path === path)
      const mode = defaultViewModeOf(tab)
      setViewModes(current => current[pane] === mode ? current : { ...current, [pane]: mode })
      changed = true
    }
    if (changed) lastPanePathsRef.current = next
  }, [paneActive])
  const rewriteRuntimePaths = useCallback((from, to) => {
    lastWriteRef.current = rewritePathMap(lastWriteRef.current, from, to)
    draftGenerationsRef.current = rewritePathMap(draftGenerationsRef.current, from, to)
    scrollTopRef.current = rewritePathMap(scrollTopRef.current, from, to)
    /* The change-poll baseline follows the move too, or the new path starts with no baseline and re-checks from scratch. */
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
  const submitEntryDialog=useCallback(()=>{if(entryBusy||entryDialog===undefined)return;/* A concurrent tree mutation would bump mutationSeq and drop this op's bookkeeping after the server already succeeded — refuse while one is in flight (same guard as pasteEntry). */if(mutationController.current!==undefined){setEntryError(translate('editor.operationBusy'));return}const trimmed=entryDraft.trim();const message=entryNameError(entryDraft);if(message!==undefined){setEntryError(message);return}const parentPathValue=entryDialog.mode==='create'?entryDialog.parentPath:parentPath(entryDialog.entry.path);const siblings=directories.get(parentPathValue)?.entries??[];if(entryDialog.mode==='create'){if(siblings.some(entry=>entry.name===trimmed)){setEntryError(translate('entry.duplicate'));return}}else if(trimmed===entryDialog.entry.name||siblings.some(entry=>entry.name===trimmed&&entry.path!==entryDialog.entry.path)){setEntryError(trimmed===entryDialog.entry.name?translate('entry.nameUnchanged'):translate('entry.duplicate'));return}const controller=new AbortController();mutationController.current=controller;setEntryBusy(true);setEntryError(undefined);const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;const request=(async()=>{if(entryDialog.mode==='rename'){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:entryDialog.entry.path,toPath:entryPath(parentPath(entryDialog.entry.path),trimmed)},controller.signal)}return entryDialog.mode==='create'?createEntry(workspace.workspaceId,entryDialog.parentPath,entryDialog.kind,trimmed,controller.signal):renameEntry(workspace.workspaceId,entryDialog.entry.path,trimmed,controller.signal)})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;const mode=entryDialog.mode;const sourcePath=mode==='create'?entryDialog.parentPath:entryDialog.entry.path;const nextStatus=mode==='create'?result.kind==='directory'?translate('status.createdFolder'):translate('status.createdFile'):result.kind==='directory'?translate('status.renamedFolder'):translate('status.renamedFile');composingRef.current=false;setEntryBusy(false);setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);setStatus({text:nextStatus});vcsRef.current.refreshSoon();if(mode==='create'){setExpanded(cur=>{const next=new Set(cur);next.add(sourcePath);if(result.kind==='directory')next.add(result.path);return next});if(result.kind==='file'){previewTabsBootstrapped.current = true;setTabs(cur=>cur.some(tab=>tab.path===result.path)?cur:[...cur,{baseText:'',dirty:false,draft:'',editing:false,name:result.name,pane:focusedPaneRef.current,path:result.path,pinned:false,saving:false,scrollTop:0,size:null,status:undefined,symlink:Boolean(result.symlink),bom:false,lineEnding:'none',revision:null}]);activatePath(result.path)}setSelected(result);void loadDirectory(sourcePath);if(result.kind==='directory')void loadDirectory(result.path)}else{setDirectories(cur=>rewriteDirectoryMap(cur,sourcePath,result.path,result));setExpanded(cur=>rewritePathSet(cur,sourcePath,result.path));setTabs(cur=>rewritePreviewTabs(cur,sourcePath,result.path,result));rewriteRuntimePaths(sourcePath,result.path);migratePendingAutosavesRef.current?.(sourcePath,result.path);{const rewriteActivePath=path=>path===null||path===undefined?null:rewriteRelativePath(path,sourcePath,result.path);const nextPaneActive={a:rewriteActivePath(paneActiveRef.current.a),b:rewriteActivePath(paneActiveRef.current.b)};const nextFocusedActive=nextPaneActive[focusedPaneRef.current]??null;if(nextPaneActive.a!==paneActiveRef.current.a||nextPaneActive.b!==paneActiveRef.current.b){paneActiveRef.current=nextPaneActive;activePathRef.current=nextFocusedActive;setPaneActive(nextPaneActive)}else if(nextFocusedActive!==activePathRef.current){activePathRef.current=nextFocusedActive}}setSelected(result);void loadDirectory(parentPath(sourcePath))}}).catch(error=>{const timedOut=error?.name==='AbortError'&&error?.reason?.name==='TimeoutError';if((error?.name==='AbortError'&&!timedOut)||!mounted.current||mutationSeq!==mutationSeqRef.current){return}if(entryDialog?.mode==='rename'&&draftMoveGeneration!==undefined){void rollbackDraftTree(entryDialog.entry.path,entryPath(parentPath(entryDialog.entry.path),trimmed))}setEntryBusy(false);setEntryError(timedOut?translate('editor.requestTimeout'):(error instanceof Error?error.message:String(error)))}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined;if(mounted.current)setEntryBusy(false)})},[createEntry,directories,draftScopeId,draftTree,entryBusy,entryDialog,entryDraft,loadDirectory,renameEntry,rewriteRuntimePaths,workspace.workspaceId])

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
    const flush = () => { flushAutosavesRef.current({ keepalive: true }); persistSessionTabsRef.current() }
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
  const refresh=useCallback(()=>{if(hasDirtyTabs){setStatus({error:true,text:translate('tree.refreshBlocked')});return}/* Refresh must not collapse the tree: snapshot the scroll position and expanded paths before clearing the listings, then re-list the root and every expanded directory so disk changes appear in place. */  const scrollEl=treeScrollRef.current;const savedScrollTop=scrollEl?.scrollTop??0;const expandedPaths=[...expandedRef.current].filter(path=>path!=='');abortDirectoryRequests();setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false;setDirectories(new Map());setStatus(undefined);vcsRef.current.refresh();setDiffBaseEpoch(current=>current+1);const reloads=[loadDirectory(''),...expandedPaths.map(path=>loadDirectory(path,{pruneOnMissing:true}))];void Promise.allSettled(reloads).then(()=>{if(mounted.current)restoreTreeScroll(savedScrollTop)})},[abortDirectoryRequests,hasDirtyTabs,loadDirectory,restoreTreeScroll])
  const toggleDirectory=useCallback(entry=>{const path=entry.path;const opening=!expanded.has(path);setExpanded(cur=>{const next=new Set(cur);opening?next.add(path):next.delete(path);return next});if(opening){if(directories.get(path)?.state!=='ready')void loadDirectory(path);chooseDirectory(entry)}else setSelected(entry)},[chooseDirectory,directories,expanded,loadDirectory])
  const openContextMenu=useCallback((event,entry)=>{event.preventDefault();setSelected(entry);setContextMenu({entry,x:event.clientX,y:event.clientY})},[])
  const copyEntryPath=useCallback((entry,relative)=>{const value=relative?entry.path:joinAbsolutePath(workspace.path,entry.path);void copyText(value).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?(relative?translate('status.copiedRelative'):translate('status.copiedPath')):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[workspace.path])
  const copyEntryName=useCallback((entry)=>{void copyText(entry.name).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?translate('status.copiedName'):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[])
  const openInExplorer=useCallback((entry)=>{setContextMenu(undefined);const controller=new AbortController();revealInExplorer(workspace.workspaceId,entry.path,controller.signal).then(()=>{if(!mounted.current)return;setCopyNotice(translate('status.revealed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)}).catch(error=>{if(!mounted.current||error?.name==='AbortError')return;setCopyNotice(translate('status.revealFailed',{message:error instanceof Error?error.message:String(error)}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)})},[workspace.workspaceId])
  const copyEntryToClipboard=useCallback((entry,cut)=>{setContextMenu(undefined);setClipboard({workspaceId:workspace.workspaceId,path:entry.path,name:entry.name,kind:entry.kind,cut});setCopyNotice(cut?translate('status.cut'):translate('status.copied'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)},[workspace.workspaceId])
  const pasteEntry=useCallback((targetEntry)=>{if(clipboard===undefined||clipboard.workspaceId!==workspace.workspaceId)return;const targetDir=targetEntry.kind==='directory'?targetEntry.path:parentPath(targetEntry.path);const targetPath=entryPath(targetDir,pathBaseName(clipboard.path));if(clipboard.cut&&clipboard.path===targetPath)return;const wasCut=clipboard.cut;const affectedPrefix=clipboard.path===''?'':`${clipboard.path}/`;if(wasCut&&tabsRef.current.some(tab=>{if(!tab.dirty&&!tab.saving)return false;return tab.path===clipboard.path||(affectedPrefix!==''&&tab.path.startsWith(affectedPrefix))})){setStatus({error:true,text:translate('editor.unsavedBlocked')});return}/* A concurrent mutation would bump mutationSeq and drop this paste's bookkeeping after the fs move already succeeded — refuse while one is in flight. */if(mutationController.current!==undefined){setStatus({error:true,text:translate('editor.operationBusy')});return}const controller=new AbortController();mutationController.current=controller;const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;let draftMoveFailed=false;const request=(async()=>{const result=await requestFsOperation(workspace.workspaceId,{action:wasCut?'move':'copy',source:clipboard.path,target:targetPath},controller.signal);if(wasCut){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:clipboard.path,toPath:result.path},controller.signal).catch(async error=>{if(!mounted.current)return;draftMoveFailed=true;console.warn('workspace-studio: draft move after fs move failed:',error);setStatus({error:true,text:translate('status.movedDraftWarning')});/* The old-path draft is the ONLY persistent copy of the user's unsaved edits: deleting it on a failed move (the old behavior) could lose them if the page refreshes before the next autosave lands on the new path. Retry once with a fresh generation (the failure is usually a transient generation race with a concurrent autosave); if the retry also fails, KEEP the old-path draft — a harmless zombie that only restores if a file appears at the old path again — and warn. */try{await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:nextDraftGeneration('__tree__'),fromPath:clipboard.path,toPath:result.path},controller.signal);draftMoveFailed=false}catch(retryError){if(mounted.current)console.warn('workspace-studio: draft move retry also failed; keeping draft at source path:',retryError)}})}return result})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;setContextMenu(undefined);setStatus(draftMoveFailed?{error:true,text:translate('status.movedDraftWarning')}:{text:wasCut?translate('status.moved'):translate('status.pasted')});vcsRef.current.refreshSoon();if(wasCut){const source=clipboard.path;if(clipboardRef.current?.path===source&&clipboardRef.current?.cut===true)setClipboard(undefined);setSelected(result);setDirectories(cur=>rewriteDirectoryMap(cur,source,result.path,result));setExpanded(cur=>rewritePathSet(cur,source,result.path));setTabs(cur=>rewritePreviewTabs(cur,source,result.path,result));rewriteRuntimePaths(source,result.path);migratePendingAutosavesRef.current?.(source,result.path);const rewriteActivePath=path=>path===null||path===undefined?null:rewriteRelativePath(path,source,result.path);const nextPaneActive={a:rewriteActivePath(paneActiveRef.current.a),b:rewriteActivePath(paneActiveRef.current.b)};const nextFocusedActive=nextPaneActive[focusedPaneRef.current]??null;if(nextPaneActive.a!==paneActiveRef.current.a||nextPaneActive.b!==paneActiveRef.current.b){paneActiveRef.current=nextPaneActive;activePathRef.current=nextFocusedActive;setPaneActive(nextPaneActive)}else if(nextFocusedActive!==activePathRef.current){activePathRef.current=nextFocusedActive}void loadDirectory(parentPath(source));void loadDirectory(targetDir)}else{void loadDirectory(targetDir)}}).catch(error=>{const timedOut=error?.name==='AbortError'&&error?.reason?.name==='TimeoutError';if((error?.name==='AbortError'&&!timedOut)||!mounted.current||mutationSeq!==mutationSeqRef.current)return;setContextMenu(undefined);const failedMessage=timedOut?translate('editor.requestTimeout'):(error instanceof Error?error.message:String(error));setCopyNotice(translate(wasCut?'status.cutFailed':'status.pasteFailed',{message:failedMessage}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined})},[clipboard,draftScopeId,draftTree,loadDirectory,nextDraftGeneration,rewriteRuntimePaths,workspace.workspaceId])
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
        // Use the tab's CURRENT draft (the dialog keeps editor focus, so the user may have typed
        // since capture) and never roll the staging draft back on a failed delete. force=true also
        // re-writes NON-editable dirty tabs, whose scheduleAutosave gate would skip them. Drop the
        // autosave dedup FIRST: draftTree already tombstoned these drafts while lastWriteRef still
        // holds the same text, so content-dedup would skip the re-write and the draft stays lost.
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
      setDeleteBusy(false)
      setDeleteDialog(undefined)
      setStatus({ text: translate('status.deleted') })
      vcsRef.current.refreshSoon()
      const nextTabs = tabsRef.current.filter(tab => tab.path !== entry.path && !tab.path.startsWith(`${entry.path}/`))
      const clearDeleted = path => (path !== null && path !== undefined && (path === entry.path || path.startsWith(`${entry.path}/`)) ? null : path)
      const nextPaneActive = { a: clearDeleted(paneActiveRef.current.a), b: clearDeleted(paneActiveRef.current.b) }
      const layout = commitLayout(nextTabs, nextPaneActive, focusedPaneRef.current)
      for (const item of affected) {
        /* A keystroke during the (possibly slow) fs delete re-armed a 1s autosave above the tree fence: disarm it here, or the PUT would recreate a Host staging draft for the deleted path (a future same-named file would restore it as dirty). */
        clearAutosaveTimer(item.path)
        lastWriteRef.current.delete(item.path)
        draftGenerationsRef.current.delete(item.path)
        scrollTopRef.current.delete(item.path)
      }
      /* Runtime maps of closed tabs die with the subtree; the global cache must not serve a deleted path as current. */      const subtreeMatch = (path) => path === entry.path || (path !== '' && path.startsWith(`${entry.path}/`))
      for (const path of [...retainedStatesRef.current.keys()]) {
        if (subtreeMatch(path)) retainedStatesRef.current.delete(path)
      }
      for (const path of [...contentBaselinesRef.current.keys()]) {
        if (subtreeMatch(path)) contentBaselinesRef.current.delete(path)
      }
      invalidateCachedSubtree(workspace.workspaceId, entry.path)
      syncSelectionAfterLayout(layout)
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
  /* Each menu names its own region: a scroll that cannot move that region (the
     conversation's streaming tail follow above all) must not close the menu. */
  useDismissMenu(menuRef, contextMenu !== undefined, setContextMenu, treeScrollRef)
  useDismissMenu(tabMenuRef, tabContextMenu !== undefined, setTabContextMenu, tabMenuAnchorRef)
  useDismissMenu(stripMenuRef, stripMenu !== undefined, setStripMenu, tabMenuAnchorRef)
  useDismissMenu(titleMenuRef, titleContextMenu !== undefined, setTitleContextMenu, previewHeaderRef)

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
    /* A requested reload IS the action the marker asked for: drop it, so the status bar shows the reload notice instead of the superseded "changed on disk" one. */
    updateActiveTab({ diskState: DISK_STATE_CLEAN })
    setReloadToken(token => token + 1)
    /* A manual refresh is also the way to pick up a commit / branch switch made outside: re-read the
       base revision the change marks are computed against. */
    setDiffBaseEpoch(current => current + 1)
  }, [activePath, dirty, saving, updateActiveTab])
  /* Reload ONE tab from disk, from the strip's marker or its context menu. A background tab is
     activated first, because the read effect serves the active path alone; arming the refresh
     flag makes that pass a full read instead of a cache/fast-path serve. Unsaved work is never
     discarded: a dirty tab refuses and says why (the status bar's Cancel is the deliberate way). */
  const reloadTab = useCallback((path) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    if (tab.saving) {
      setStatus({ error: true, text: translate('editor.operationBusy') })
      return
    }
    if (tab.dirty === true) {
      setStatus({ error: true, text: translate('tab.reloadBlocked') })
      return
    }
    if (path !== activePathRef.current) activateTab(tab)
    refreshPendingRef.current = path
    reloadingPathsRef.current.add(path)
    /* The marker asked for this reload, so clear it at once (same rule as refreshFile). */
    updateTab(path, { diskState: DISK_STATE_CLEAN })
    setReloadToken(token => token + 1)
  }, [activateTab, updateTab])
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
  useDismissMenu(encodingMenuRef, encodingMenu !== undefined, setEncodingMenu, previewHeaderRef)

  /* Focus one pane (the live editor follows the focused pane). `reveal` keeps the file tree in
     sync; the body of the previously focused pane becomes the read-only preview. */
  const focusPane = useCallback((pane) => {
    if (mobile.on || !splitOpen) return
    if (pane !== PREVIEW_PANE_TOP && pane !== PREVIEW_PANE_BOTTOM) return
    if (focusedPaneRef.current === pane) return
    const path = paneActiveRef.current[pane]
    if (path === null || path === undefined) return
    focusedPaneRef.current = pane
    activePathRef.current = path
    setFocusedPane(pane)
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    if (hasNoTreeRow(tab)) {
      setSelected(undefined)
      return
    }
    const entry = entryFromPreviewTab(tab)
    setSelected(entry)
    revealPath(entry)
  }, [mobile.on, revealPath, splitOpen])

  /* Commit a tab list plus per-pane active paths, collapsing a pane that lost its last tab (the
     approved rule: an empty pane never stays open; a surviving bottom pane moves up when the top
     empties). Returns the resolved layout so the caller can sync selection/reveal. */
  const commitLayout = useCallback((nextTabs, nextPaneActive, preferredFocus) => {
    let list = orderTabLayout(nextTabs)
    let top = tabsOfPane(list, PREVIEW_PANE_TOP)
    let bottom = tabsOfPane(list, PREVIEW_PANE_BOTTOM)
    const movedBottomActive = top.length === 0 && bottom.length > 0 ? nextPaneActive.b : null
    if (top.length === 0 && bottom.length > 0) {
      list = list.map(tab => ({ ...tab, pane: PREVIEW_PANE_TOP }))
      top = tabsOfPane(list, PREVIEW_PANE_TOP)
      bottom = []
    }
    let focus = preferredFocus === PREVIEW_PANE_BOTTOM ? PREVIEW_PANE_BOTTOM : PREVIEW_PANE_TOP
    if (focus === PREVIEW_PANE_BOTTOM && bottom.length === 0) focus = PREVIEW_PANE_TOP
    const nextActive = {
      a: top.some(tab => tab.path === nextPaneActive.a)
        ? nextPaneActive.a
        : (top.some(tab => tab.path === movedBottomActive) ? movedBottomActive : (top[0]?.path ?? null)),
      b: bottom.length === 0
        ? null
        : (bottom.some(tab => tab.path === nextPaneActive.b) ? nextPaneActive.b : (bottom[0]?.path ?? null)),
    }
    focusedPaneRef.current = focus
    paneActiveRef.current = nextActive
    activePathRef.current = nextActive[focus] ?? null
    setTabs(list)
    setPaneActive(nextActive)
    setFocusedPane(focus)
    return { focusedPane: focus, paneActive: nextActive, tabs: list }
  }, [setTabs])

  const syncSelectionAfterLayout = useCallback((layout) => {
    const nextTab = layout.tabs.find(tab => tab.path === layout.paneActive[layout.focusedPane])
    if (nextTab === undefined || hasNoTreeRow(nextTab)) {
      setSelected(undefined)
      return
    }
    const entry = entryFromPreviewTab(nextTab)
    setSelected(entry)
    revealPath(entry)
  }, [revealPath])

  const closeTab = useCallback((path) => {
    const current = tabsRef.current
    const closing = current.find(tab => tab.path === path)
    if (closing === undefined) return
    const pane = paneOfTab(closing)
    const paneList = tabsOfPane(current, pane)
    const index = paneList.findIndex(tab => tab.path === path)
    /* A music score has no file draft to recover from: an unsaved edit must block the close,
       exactly like an editable file tab, or the composition would vanish with the tab. */
    if (isMusicTab(closing) && closing.dirty === true) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabClose') }
      if (activePathRef.current === path) setStatus(nextStatus)
      else updateTab(path, { status: nextStatus })
      return
    }
    // A dirty tab is close-guarded only while editable: a non-editable file with a leftover draft has no save/cancel path, so allow closing and drop its staging draft below.
    const nonEditableDirty = closing.dirty === true && closing.editing === false
    if (closing.saving || (closing.dirty && !nonEditableDirty)) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabClose') }
      if (activePathRef.current === path) setStatus(nextStatus)
      else updateTab(path, { status: nextStatus })
      return
    }
    if (nonEditableDirty && !isSyntheticTab(closing)) {
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
    const nextPaneActive = { ...paneActiveRef.current }
    if (nextPaneActive[pane] === path) {
      nextPaneActive[pane] = paneList[Math.min(index, paneList.length - 1)]?.path ?? null
    }
    const layout = commitLayout(nextTabs, nextPaneActive, focusedPaneRef.current)
    forgetPathRefs(path)
    syncSelectionAfterLayout(layout)
    if (layout.paneActive[layout.focusedPane] === null) setStatus(undefined)
  }, [clearDraftFile, commitLayout, forgetPathRefs, syncSelectionAfterLayout, updateTab])
  const closeOtherTabs = useCallback((keepPath) => {
    const current = tabsRef.current
    const keep = current.find(tab => tab.path === keepPath)
    if (keep === undefined) return
    const pane = paneOfTab(keep)
    /* "Close others" is scoped to the pane the tab lives in: the other pane keeps its tabs. */
    const closing = tabsOfPane(current, pane).filter(tab => tab.path !== keepPath && !tab.pinned)
    if (closing.length === 0) return
    /* Same rule as closeTab: a dirty tab is close-guarded only while editable. */
    if (closing.some(tab => tab.saving || (tab.dirty && (tab.editing !== false || isMusicTab(tab))))) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabsClose') }
      if (activePathRef.current === keepPath) setStatus(nextStatus)
      else updateTab(keepPath, { status: nextStatus })
      return
    }
    for (const tab of closing) {
      if (tab.dirty && tab.editing === false && !isSyntheticTab(tab)) {
        // Discard the orphaned staging draft (same escape as closeTab).
        void clearDraftFile(tab.path, '', tab.encoding ?? 'utf-8', tab.lineEnding ?? 'none', Boolean(tab.bom), tab.revision ?? null).catch(() => {})
      }
    }
    const closingPaths = new Set(closing.map(tab => tab.path))
    const nextTabs = current.filter(tab => !closingPaths.has(tab.path))
    const layout = commitLayout(nextTabs, { ...paneActiveRef.current, [pane]: keepPath }, pane)
    for (const tab of closing) {
      /* A closed map tab must also unmount its global body (same rule as closeTab). */
      if (isMindmapTab(tab)) mindmapViewHost.drop(mindmapRootIdOfTab(tab))
      /* A closed plan tab releases its temporary review document (same rule as closeTab). */
      if (isPlanTab(tab)) planDocuments.drop(planAddressOfTab(tab))
      forgetPathRefs(tab.path)
    }
    syncSelectionAfterLayout(layout)
    if (!hasNoTreeRow(keep)) revealPath(entryFromPreviewTab(keep))
  }, [clearDraftFile, commitLayout, forgetPathRefs, revealPath, syncSelectionAfterLayout, updateTab])
  /* The setTabs wrapper keeps the pinned block first inside the tab's own pane, so pinning and
     unpinning only change the flag. */
  const pinTab = useCallback((path) => {
    setTabs(current => current.map(tab => tab.path === path && tab.pinned !== true
      ? { ...tab, pinned: true, /* Pinning makes it a real tab: the italic preview marker goes with it. */ temporary: false }
      : tab))
    scrollTabIntoView(path)
  }, [scrollTabIntoView])
  const unpinTab = useCallback((path) => {
    setTabs(current => current.map(tab => tab.path === path && tab.pinned === true ? { ...tab, pinned: false } : tab))
    scrollTabIntoView(path)
  }, [scrollTabIntoView])
  const finishDrag = useCallback(() => {
    setDraggingPath(null)
    setDropIndex(null)
    setDropPane(null)
    setDropZone(false)
    setDropBodyPane(null)
  }, [])
  /* Clamp the insertion point to the dragged tab's own partition inside ITS pane (pinned: inside
     the pinned block; unpinned: at or after the first unpinned slot), matching the drop indicator. */
  const clampDropIndexForPane = useCallback((pane, rawIndex) => {
    if (draggingPath === null || !Number.isInteger(rawIndex)) return rawIndex
    const list = tabsOfPane(tabsRef.current, pane)
    const from = list.findIndex(tab => tab.path === draggingPath)
    if (from < 0) return rawIndex
    const draggedPinned = list[from]?.pinned === true
    let pinnedCount = 0
    for (const tab of list) {
      if (tab.path !== draggingPath && tab.pinned) pinnedCount += 1
    }
    return draggedPinned ? Math.min(rawIndex, pinnedCount) : Math.max(rawIndex, pinnedCount)
  }, [draggingPath])
  const updateDropIndex = useCallback((pane, event) => {
    if (draggingPath === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropPane(pane)
    setDropZone(false)
    setDropBodyPane(null)
    const next = clampDropIndexForPane(pane, dropIndexFromEvent(event))
    setDropIndex(current => current === next ? current : next)
  }, [clampDropIndexForPane, draggingPath])
  const handleTabsDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropIndex(null)
    setDropPane(null)
  }, [])
  const dropTabAt = useCallback((pane, insertAt) => {
    if (draggingPath === null || insertAt === null) return
    const current = tabsRef.current
    const moved = current.find(tab => tab.path === draggingPath)
    if (moved === undefined) return
    const sourcePane = paneOfTab(moved)
    const sourceTabs = tabsOfPane(current, sourcePane)
    if (sourcePane === pane) {
      const from = sourceTabs.findIndex(tab => tab.path === draggingPath)
      if (from < 0) return
      const adjusted = insertAt > from ? insertAt - 1 : insertAt
      if (adjusted === from) return
      const targetTabs = sourceTabs.filter(tab => tab.path !== draggingPath)
      targetTabs.splice(Math.max(0, Math.min(adjusted, targetTabs.length)), 0, moved)
      const top = pane === PREVIEW_PANE_TOP ? targetTabs : tabsOfPane(current, PREVIEW_PANE_TOP)
      const bottom = pane === PREVIEW_PANE_BOTTOM ? targetTabs : tabsOfPane(current, PREVIEW_PANE_BOTTOM)
      setTabs([...top, ...bottom])
      return
    }
    /* Cross-pane move: the moved tab becomes the target pane's active tab and the target pane
       gains focus; an emptied source pane collapses through commitLayout. */
    const withPane = current.map(tab => tab.path === draggingPath ? { ...tab, pane } : tab)
    const targetTabs = tabsOfPane(withPane, pane).filter(tab => tab.path !== draggingPath)
    const movedNow = tabsOfPane(withPane, pane).find(tab => tab.path === draggingPath)
    if (movedNow === undefined) return
    targetTabs.splice(Math.max(0, Math.min(insertAt, targetTabs.length)), 0, movedNow)
    const top = pane === PREVIEW_PANE_TOP ? targetTabs : tabsOfPane(withPane, PREVIEW_PANE_TOP)
    const bottom = pane === PREVIEW_PANE_BOTTOM ? targetTabs : tabsOfPane(withPane, PREVIEW_PANE_BOTTOM)
    const nextTabs = [...top, ...bottom]
    const sourceRest = sourceTabs.filter(tab => tab.path !== draggingPath)
    const nextActive = { ...paneActiveRef.current, [pane]: draggingPath }
    if (nextActive[sourcePane] === draggingPath) nextActive[sourcePane] = sourceRest[0]?.path ?? null
    const layout = commitLayout(nextTabs, nextActive, pane)
    syncSelectionAfterLayout(layout)
  }, [commitLayout, draggingPath, setTabs, syncSelectionAfterLayout])
  const handleTabsDrop = useCallback((pane, event) => {
    event.preventDefault()
    event.stopPropagation()
    const index = clampDropIndexForPane(pane, dropIndexFromEvent(event))
    finishDrag()
    dropTabAt(pane, index)
  }, [clampDropIndexForPane, dropTabAt, finishDrag])

  /* Create the bottom pane from a dragged tab (single-pane layout only): the tab moves down, the
     top pane keeps the rest, and the new pane takes focus. */
  const splitTab = useCallback((path) => {
    if (mobile.on || splitOpen) return
    const current = tabsRef.current
    const moved = current.find(tab => tab.path === path)
    if (moved === undefined) return
    const sourceTabs = tabsOfPane(current, paneOfTab(moved))
    if (sourceTabs.length < 2) {
      setStatus({ error: true, text: translate('preview.split.needTwo') })
      return
    }
    const sourceIndex = sourceTabs.findIndex(tab => tab.path === path)
    const remaining = sourceTabs.filter(tab => tab.path !== path)
    const topActive = paneActiveRef.current.a === path
      ? (remaining[Math.min(sourceIndex, remaining.length - 1)]?.path ?? null)
      : (paneActiveRef.current.a ?? remaining[0]?.path ?? null)
    const nextTabs = current.map(tab => tab.path === path ? { ...tab, pane: PREVIEW_PANE_BOTTOM } : tab)
    const layout = commitLayout(nextTabs, { a: topActive, b: path }, PREVIEW_PANE_BOTTOM)
    /* Keep the session's remembered ratio: a first split starts at 50/50, and closing/reopening
       the bottom pane returns to whatever the user last dragged. */
    syncSelectionAfterLayout(layout)
    setStatus({ text: translate('preview.split.created') })
  }, [commitLayout, mobile.on, splitOpen, syncSelectionAfterLayout])
  /* Collapse the bottom pane: its tabs move back into the top, in order, with the bottom's active
     tab becoming the top's active tab (drafts and runtime state ride the tab objects). */
  const closeBottomPane = useCallback(() => {
    if (!splitOpen) return
    const current = tabsRef.current
    const topTabs = tabsOfPane(current, PREVIEW_PANE_TOP)
    const bottomTabs = tabsOfPane(current, PREVIEW_PANE_BOTTOM)
    if (bottomTabs.length === 0) return
    const nextTabs = [...topTabs, ...bottomTabs.map(tab => ({ ...tab, pane: PREVIEW_PANE_TOP }))]
    const bottomActive = paneActiveRef.current.b
    const layout = commitLayout(nextTabs, { a: bottomActive ?? topTabs[0]?.path ?? null, b: null }, PREVIEW_PANE_TOP)
    syncSelectionAfterLayout(layout)
    setStatus({ text: translate('preview.split.closed', { count: bottomTabs.length }) })
  }, [commitLayout, splitOpen, syncSelectionAfterLayout])
  /* Menu equivalent of a cross-pane drag: move the tab to the other pane, activate it there and
     focus that pane. An emptied source pane collapses through commitLayout. */
  const moveTabToOtherPane = useCallback((path) => {
    if (!splitOpen) return
    const current = tabsRef.current
    const tab = current.find(item => item.path === path)
    if (tab === undefined) return
    const source = paneOfTab(tab)
    const target = source === PREVIEW_PANE_TOP ? PREVIEW_PANE_BOTTOM : PREVIEW_PANE_TOP
    const sourceTabs = tabsOfPane(current, source)
    if (tabsOfPane(current, target).length === 0) return
    const nextTabs = current.map(item => item.path === path ? { ...item, pane: target } : item)
    const nextActive = { ...paneActiveRef.current, [target]: path }
    if (nextActive[source] === path) nextActive[source] = sourceTabs.filter(item => item.path !== path)[0]?.path ?? null
    const layout = commitLayout(nextTabs, nextActive, target)
    syncSelectionAfterLayout(layout)
  }, [commitLayout, splitOpen, syncSelectionAfterLayout])
  /* Mobile keeps one pane (the design's degradation rule): a split restored from the desktop is
     merged into the top pane as soon as the mobile gate turns on, keeping the focused tab active. */
  useEffect(() => {
    if (!mobile.on || !splitOpen) return
    const current = tabsRef.current
    const topTabs = tabsOfPane(current, PREVIEW_PANE_TOP)
    const bottomTabs = tabsOfPane(current, PREVIEW_PANE_BOTTOM)
    if (bottomTabs.length === 0) return
    const active = paneActiveRef.current[focusedPaneRef.current] ?? paneActiveRef.current.a ?? topTabs[0]?.path ?? null
    const layout = commitLayout([...topTabs, ...bottomTabs.map(tab => ({ ...tab, pane: PREVIEW_PANE_TOP }))], { a: active, b: null }, PREVIEW_PANE_TOP)
    syncSelectionAfterLayout(layout)
  }, [commitLayout, mobile.on, splitOpen, syncSelectionAfterLayout])
  /* Lower-half split drop zone of the single-pane layout. The strip's own handlers win over the
     tabs; everything else below the midline is the split target. */
  const handlePreviewTabDragOver = useCallback((event) => {
    if (draggingPath === null || mobile.on) return
    if (splitOpen) {
      setDropZone(false)
      if (event.target instanceof Element && event.target.closest('.dsh-ws-preview-tabs, .dsh-ws-panes-splitter') !== null) {
        setDropBodyPane(null)
        return
      }
      const paneEl = event.target instanceof Element ? event.target.closest('.dsh-ws-pane') : null
      const moved = tabsRef.current.find(tab => tab.path === draggingPath)
      if (paneEl === null || moved === undefined) {
        setDropBodyPane(null)
        return
      }
      const targetPane = paneEl.dataset.pane
      if ((targetPane !== PREVIEW_PANE_TOP && targetPane !== PREVIEW_PANE_BOTTOM) || targetPane === paneOfTab(moved)) {
        setDropBodyPane(null)
        return
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      setDropBodyPane(targetPane)
      return
    }
    setDropBodyPane(null)
    if (event.target instanceof Element && event.target.closest('.dsh-ws-preview-tabs, .dsh-ws-panes-splitter') !== null) return
    const moved = tabsRef.current.find(tab => tab.path === draggingPath)
    if (moved === undefined) { setDropZone(false); return }
    if (tabsOfPane(tabsRef.current, paneOfTab(moved)).length < 2) { setDropZone(false); return }
    const section = previewSectionRef.current
    if (section === null) return
    const rect = section.getBoundingClientRect()
    if (event.clientY <= rect.top + rect.height * 0.55) { setDropZone(false); return }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropZone(true)
  }, [draggingPath, mobile.on, splitOpen])
  const handlePreviewTabDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropZone(false)
    setDropBodyPane(null)
  }, [])
  const handlePreviewTabDrop = useCallback((event) => {
    if (draggingPath === null) return
    if (splitOpen) {
      if (dropBodyPane === null) return
      event.preventDefault()
      const path = draggingPath
      finishDrag()
      moveTabToOtherPane(path)
      return
    }
    if (!dropZone) return
    event.preventDefault()
    const path = draggingPath
    finishDrag()
    splitTab(path)
  }, [draggingPath, dropBodyPane, dropZone, finishDrag, moveTabToOtherPane, splitOpen, splitTab])
  /* A tab drag that ends over the editor body would otherwise reach CodeMirror's native drop
     handler, which inserts the transferred text/plain (the tab path) into the document — the
     split gesture's drop point is exactly that body. Handle the drop in the CAPTURE phase, before
     the target sees it, and let a strip drop through to the strip's own reorder handler. */
  const handlePreviewTabDropCapture = useCallback((event) => {
    if (draggingPath === null) return
    if (event.target instanceof Element && event.target.closest('.dsh-ws-preview-tabs') !== null) return
    event.preventDefault()
    event.stopPropagation()
    const path = draggingPath
    const moveTo = splitOpen ? dropBodyPane : null
    const split = !splitOpen && dropZone
    finishDrag()
    if (moveTo !== null) moveTabToOtherPane(path)
    else if (split) splitTab(path)
  }, [draggingPath, dropBodyPane, dropZone, finishDrag, moveTabToOtherPane, splitOpen, splitTab])
  /* The strip API handed to the global mind-map host: doc-gone closes the tab and root renames update the tab label. closeTab/updateTab may change identity across renders, so the API forwards through refs. */
  const closeTabRef = useRef(closeTab)
  closeTabRef.current = closeTab
  const updateTabRef = useRef(updateTab)
  updateTabRef.current = updateTab
  const stripApiRef = useRef(null)
  if (stripApiRef.current === null) {
    stripApiRef.current = {
      hasTab: (tabPath) => hasTabPath(tabsRef.current, tabPath),
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
  /* The active byte renderer (image/pdf/office), selected by the preview itself. */
  const byteKind = preview.state === 'ready' && isByteKind(preview.kind) ? preview.kind : undefined
  const browseKind = isMarkdown ? RENDERER_MARKDOWN : RENDERER_CODE
  const viewerItems = useMemo(() => {
    if (preview.state !== 'ready' || activeTab === undefined || isSyntheticTab(activeTab)) return []
    /* A Remote-readable tab: an outside-workspace file is readable, a dropped-in one is not. */
    return viewerCandidates(preview, activeTab.name, activeTab.external === true && activeTab.outside !== true)
  }, [activeTab, preview])
  const currentViewer = viewerItems.find(item => item.id === (byteKind ?? viewMode)) ?? viewerItems[0]
  /* The viewer toggle button's tooltip names the view it switches to. */
  const viewerToggleTitle = currentViewer?.id === VIEW_PREVIEW
    ? (isMarkdown ? translate('mdPreview.edit.title') : isHtmlFile ? translate('htmlPreview.edit.title') : translate('editor.edit.title'))
    : (isMarkdown ? translate('mdPreview.preview.title') : isHtmlFile ? translate('htmlPreview.preview.title') : translate('renderer.browse.title'))
  /* The active file's run console, when it has one: drives the file header's 控制台 toggle. The
     console itself is rendered by PreviewPane, and the tab strip reads the same store for its
     "still running" badge, so one subscription here is enough. */
  const runTabPath = activeTab !== undefined
    && !isSyntheticTab(activeTab)
    && activeTab.external !== true
    && activeTab.outside !== true
    && isRunnableName(activeTab.name)
    ? activeTab.path
    : null
  const runTabEntry = useRunEntry(runTabPath)
  const runPanelOpen = runTabEntry?.collapsed !== true
  /* The active file's retained CodeMirror session; dropped when its name no longer matches the tab, so a rename builds the next view fresh. */
  const retainedForActive = (() => {
    if (activePath === null || activeTab === undefined || isSyntheticTab(activeTab)) return null
    const session = retainedStatesRef.current.get(activePath)
    if (session === undefined) return null
    if (session.name !== activeTab.name) {
      retainedStatesRef.current.delete(activePath)
      return null
    }
    /* The retained map is keyed by path, but a pane move / a fast focus switch can leave a state
       whose document belongs to the tab that was in front before. Restoring it would show file A's
       text under tab B (measured after moving a tab between panes). A known live draft is the
       source of truth: discard a state whose document differs from it (LF-normalized, the editor's
       own coordinates). */
    if (activeTab.dirty !== true && activeTab.draftKnown === true) {
      const expected = String(activeTab.draft).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      if (session.state.doc.toString() !== expected) {
        retainedStatesRef.current.delete(activePath)
        return null
      }
    }
    return session
  })()
  /* One synthetic-tab dock. Every synthetic tab of a pane stays mounted even while another tab is
     in front (plan/review scroll + holds, music transport, the permission poll, the map body);
     only the active one is visible. */
  const renderDock = (tab, panePath) => {
    if (isMindmapTab(tab)) {
      return h('div', {
        className: 'dsh-ws-preview-body dsh-ws-mindmap-dock',
        key: tab.path,
        ref: (el) => {
          if (el !== null) mindmapTabElsRef.current.set(tab.path, el)
          else mindmapTabElsRef.current.delete(tab.path)
        },
        style: tab.path === panePath ? undefined : { display: 'none' },
      })
    }
    if (isPlanTab(tab)) {
      return h('div', {
        className: 'dsh-ws-preview-body dsh-ws-plan-dock',
        key: tab.path,
        style: tab.path === panePath ? undefined : { display: 'none' },
      }, h(PlanView, {
        address: planAddressOfTab(tab),
        onTitle: (title) => applyPlanTitle(tab.path, title),
      }))
    }
    if (isReviewTab(tab)) {
      return h('div', {
        className: 'dsh-ws-preview-body dsh-ws-review-dock',
        key: tab.path,
        style: tab.path === panePath ? undefined : { display: 'none' },
      }, h(ReviewView, {
        address: reviewAddressOfTab(tab),
        initialIndex: tab.reviewIndex ?? 0,
        navSeq: tab.reviewNav ?? 1,
        sessionCwdOf,
        workspace,
      }))
    }
    if (isMusicTab(tab)) {
      return h('div', {
        className: 'dsh-ws-preview-body dsh-ws-music-dock',
        key: tab.path,
        style: tab.path === panePath ? undefined : { display: 'none' },
      }, h(MusicDock, {
        active: tab.path === panePath,
        arrangeBarWidth: settings.musicArrangeBarWidth,
        cacheScopeId: previewSessionId ?? sessionId ?? `workspace:${String(workspace.workspaceId)}`,
        chatSessionId: sessionId ?? previewSessionId,
        musicPrefs,
        onMusicPrefs: updateMusicPrefs,
        onSaved: revealSavedScore,
        onUpdate: patch => updateTab(tab.path, patch),
        rollBaseHeight: settings.musicRollRowHeight,
        rollBaseWidth: settings.musicRollGridWidth,
        saveDir: settings.musicSaveDir,
        tab,
        workspace,
      }))
    }
    if (isPermissionTab(tab)) {
      return h('div', {
        className: 'dsh-ws-preview-body dsh-ws-perm-dock',
        key: tab.path,
        style: tab.path === panePath ? undefined : { display: 'none' },
      }, h(PermissionPage, {
        sessionId,
        sessionTitle,
      }))
    }
    return null
  }
  const livePreviewNode = h(PreviewPane, {
    activePath,
    activeTab,
    browseKind,
    diffBase,
    draft,
    editing,
    onDiffSummary: handleDiffSummary,
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
    workspaceId: workspace.workspaceId,
  })
  /* The body of one pane: all of its synthetic docks stay mounted; the active file is either the
     single live PreviewPane (focused pane) or the read-only static view (the other pane). */
  const renderPaneBody = (paneId, paneTabs, paneTab, panePath, isFocused) => {
    const docks = paneTabs.filter(isSyntheticTab).map(tab => renderDock(tab, panePath))
    if (paneTab !== undefined && isSyntheticTab(paneTab)) {
      return h('div', { className: 'dsh-ws-pane-body' }, ...docks)
    }
    return h('div', { className: 'dsh-ws-pane-body' },
      ...docks,
      isFocused === true
        ? livePreviewNode
        : h('div', {
          className: 'dsh-ws-static-scope',
          /* Single clicks stay available for text selection in the read-only view; a double
             click (or the tab/header) activates the pane and swaps in the live editor. */
          onDoubleClick: () => focusPane(paneId),
        }, h(StaticPreviewPane, {
          readFile,
          sessionId: previewSessionId,
          tab: paneTab,
          viewMode: viewModes[paneId],
          workspaceId: workspace.workspaceId,
        })))
  }
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
  /* ---- Preview text size (part 1 of 2): the file header's stepper ----
   * It sizes the SOURCE EDITOR's text, so it shows only while the source editor is the view on screen.
   * Every rendered view is a preview state — a Markdown / HTML tab opens straight into it, a read-only
   * file's paged browse is VIEW_PREVIEW too — where the size has nothing to act on, so the header hides
   * the control rather than offering one with no effect. The ACTIVE tab's own percentage wins; a tab
   * without one follows the settings page's base size, so "no value of mine" and "follow the base" are
   * one state (clearing the input returns to it). Byte-rendered tabs (image / PDF / Office conversions)
   * have no text to size and no control; synthetic tabs (mind map / plan / review) draw no file header. */
  const fontBase = clampFontPercent(settings.previewFontScale ?? FONT_SCALE_DEFAULT, FONT_SCALE_DEFAULT)
  const fontOwn = activeTab !== undefined && Number.isFinite(activeTab.fontPercent)
  const fontPercent = clampFontPercent(fontOwn ? activeTab.fontPercent : fontBase, fontBase)
  const fontControlVisible = viewMode === VIEW_EDIT
    && activeTab !== undefined && !isSyntheticTab(activeTab)
    && !isImageName(activeTab.name) && !isPdfName(activeTab.name) && !isOfficeName(activeTab.name)
  /* Write this tab's own value (undefined = "follow the base size" again). */
  const setFontPercent = (next) => {
    if (!fontControlVisible) return
    updateActiveTab({ fontPercent: next })
  }
  const stepFont = (delta) => {
    if (!fontControlVisible) return
    const next = stepFontPercent(fontPercent, delta)
    setFontPercent(next)
    setStatus({ text: translate('status.textSizeChanged', { percent: next }) })
  }
  /* Commit the input: Enter, or the blur that follows a click anywhere else. An empty value (or a
     plain 0) is the "my own value" reset, and a typed value is used as typed — only clamped to the
     range, never snapped to the stepper's grid (137% is a legitimate size). */
  const commitFontPercent = () => {
    if (!fontEditing) return
    setFontEditing(false)
    const text = fontDraft.trim()
    setFontDraft('')
    if (!fontControlVisible) return
    if (text === '' || Number(text) === 0) {
      setFontPercent(undefined)
      setStatus({ text: translate('status.textSizeBase', { percent: fontBase }) })
      return
    }
    const typed = Number(text)
    setFontPercent(clampFontPercent(typed))
    if (typed > FONT_SCALE_MAX) setStatus({ text: translate('status.textSizeMax', { percent: FONT_SCALE_MAX }) })
    else if (typed < FONT_SCALE_MIN) setStatus({ text: translate('status.textSizeMin', { percent: FONT_SCALE_MIN }) })
    else setStatus({ text: translate('status.textSizeChanged', { percent: clampFontPercent(typed) }) })
  }
  /* Status-bar recap of the editor's change marks, fused into the EXISTING bottom bar: one divider
     plus one item, never a third row. Nothing renders while the base is unknown or the file is
     clean, and a known-unusable base says so instead of silently showing nothing. */
  const diffSummaryNode = (() => {
    if (diffSummary === undefined || diffSummary.status === 'pending') return null
    if (diffSummary.status === 'unavailable') {
      return [
        h('div', { className: 'dsh-ws-status-divider', key: 'diff-divider' }),
        h('span', {
          className: 'dsh-ws-diff-muted',
          key: 'diff-unavailable',
          title: translate('diff.unavailable.title', { reason: translate(diffReasonKey(diffSummary.reason)) }),
        }, translate('diff.unavailable')),
      ]
    }
    const summary = diffSummary.summary
    if (!summaryHasChanges(summary)) return null
    const tokens = []
    if (summary.added > 0) tokens.push(h('span', { className: 'dsh-ws-diff-token', 'data-kind': 'added', key: 'added' }, h('span', { 'aria-hidden': true }, '+'), h('span', { className: 'dsh-ws-diff-count' }, String(summary.added))))
    if (summary.modified > 0) tokens.push(h('span', { className: 'dsh-ws-diff-token', 'data-kind': 'modified', key: 'modified' }, h('span', { 'aria-hidden': true }, '~'), h('span', { className: 'dsh-ws-diff-count' }, String(summary.modified))))
    if (summary.deleted > 0) tokens.push(h('span', { className: 'dsh-ws-diff-token', 'data-kind': 'deleted', key: 'deleted' }, h('span', { 'aria-hidden': true }, '−'), h('span', { className: 'dsh-ws-diff-count' }, String(summary.deleted))))
    const title = translate('diff.summary.title', {
      base: diffSummary.baseLabel === '' ? diffBaseLabel : diffSummary.baseLabel,
      added: summary.added,
      modified: summary.modified,
      deleted: summary.deleted,
    })
    return [
      h('div', { className: 'dsh-ws-status-divider', key: 'diff-divider' }),
      h('div', {
        className: 'dsh-ws-diff-summary',
        key: 'diff-summary',
        /* Counting the live buffer is the point: an unsaved edit's marks are already included. */
        title: activeTab?.dirty === true ? `${title} · ${translate('diff.summary.unsaved')}` : title,
      }, tokens),
    ]
  })()
  const size = preview.state === 'ready' ? formatBytes(preview.size) : ''
  const tabMenuTarget = tabContextMenu === undefined ? undefined : tabs.find(tab => tab.path === tabContextMenu.path)
  /* Disk state is DERIVED here rather than stored in tab.status: a stored non-error
     status is persisted, so it would outlive the reload that resolved it (a hard
     refresh would re-read the file and still claim "changed on disk"). Precedence is
     error status > disk state > informational status, so a save failure keeps the
     status bar while the strip's marker carries the disk story. */
  const diskNotice = activeTab === undefined || activeTab.external === true ? undefined
    : activeTab.diskState === DISK_STATE_GONE ? { error: true, text: translate('status.fileRemoved') }
      : activeTab.diskState === DISK_STATE_CONFLICT ? { error: true, text: translate('status.fileChangedDirty') }
        : activeTab.diskState === DISK_STATE_STALE ? { text: translate('status.fileChanged') }
          : undefined
  const notice = status?.error === true ? status : (diskNotice ?? status)
  /* "Open in the browser" hands an HTML tab's file to the operating system, which passes the REAL PATH
     to the default program, so the browser opens the file itself and its relative stylesheets, scripts
     and images resolve natively. The page cannot: an http(s) origin may not navigate to file://, and the
     Desktop shell forwards only http(s) to the system browser — hence the path travels through the Host.
     EVERY OTHER file keeps the /raw browser tab on purpose: handing a script to the OS default program
     RUNS it (measured on Windows: `.js` is `WScript.exe "%1" %*`, and `.bat` / `.cmd` / `.ps1` / `.sh` are
     no better), bypassing the run console's first-run confirmation for one menu click; other text types
     would merely open in Notepad or an editor instead of this plugin's clean text tab.
     Mind-map, plan, review, external, image, PDF and Office tabs have no such file to open. */
  const canOpenExternally = tabMenuTarget !== undefined && !isSyntheticTab(tabMenuTarget) && !tabMenuTarget.external
    && !isImageName(tabMenuTarget.name) && !isPdfName(tabMenuTarget.name) && !isOfficeName(tabMenuTarget.name)
  const openExternallyHtml = canOpenExternally && isHtmlName(tabMenuTarget.name)
  const openExternallyLabel = translate(openExternallyHtml ? 'tab.openInBrowser' : 'tab.openInNewWindow')
  const openExternallyTitle = translate(openExternallyHtml ? 'tab.openInBrowser.title' : 'tab.openInNewWindow.title')
  const openTabExternally = () => {
    setTabContextMenu(undefined)
    if (!canOpenExternally) return
    if (!openExternallyHtml) {
      window.open(hostAbsoluteHref(rawFileUrl(workspace.workspaceId, tabMenuTarget.path)), '_blank', 'noopener')
      return
    }
    const controller = new AbortController()
    openFileExternal(workspace.workspaceId, tabMenuTarget.path, controller.signal).then(() => {
      if (!mounted.current) return
      setCopyNotice(translate('status.openedExternally'))
      clearTimeout(copyNoticeTimer.current)
      copyNoticeTimer.current = setTimeout(() => { if (mounted.current) setCopyNotice(undefined) }, 1600)
    }).catch(error => {
      if (!mounted.current || error?.name === 'AbortError') return
      setCopyNotice(translate('status.revealFailed', { message: error instanceof Error ? error.message : String(error) }))
      clearTimeout(copyNoticeTimer.current)
      copyNoticeTimer.current = setTimeout(() => { if (mounted.current) setCopyNotice(undefined) }, 3000)
    })
  }
  const treeSection = h('section', { className: 'dsh-ws-tree', style: vcsStatusColorVars(settings) },
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
          h(VcsBar, {
            changesOnly: vcsChangesOnly,
            ignored: settings.vcsShowIgnored === true,
            model: vcsModel,
            onRefresh: vcs.refresh,
            onToggleChangesOnly: () => setVcsChangesOnly(current => !current),
            onToggleIgnored: () => settingsStore.actions.setVcsShowIgnored(settings.vcsShowIgnored !== true),
            showIgnored: vcsModel.visible === true,
          }),
          h(ExplorerTree, {
            changesLoading: vcs.loading,
            changesOnly: vcsChangesOnly,
            clipboard,
            containerRef: treeScrollRef,
            directories,
            entryBusy,
            entryDialog,
            entryDialogError,
            entryDraft,
            expanded,
            hideMetadataDirs: settings.vcsHideDirs !== false,
            onCloseEntryDialog: closeEntryDialog,
            onConfirmEntryDialog: submitEntryDialog,
            onContextMenu: openContextMenu,
            onDirectory: toggleDirectory,
            onDraftEntry: value => { setEntryDraft(value); setEntryError(undefined) },
            onFile: chooseFilePreview,
            onFilePermanent: chooseFile,
            onSelect: setSelected,
            onRename: beginRename,
            overlay: vcs.overlay,
            selected,
          }),
          contextMenu ? h(TreeContextMenu, { entry: contextMenu.entry, menuRef, onRename: entry => { setContextMenu(undefined); beginRename(entry) }, onCopyName: copyEntryName, onCopyPath: copyEntryPath, onReveal: openInExplorer, onCopy: entry => copyEntryToClipboard(entry, false), onPaste: pasteEntry, onCut: entry => copyEntryToClipboard(entry, true), onDelete: openDeleteConfirm, pasteDisabled: clipboard === undefined || clipboard.workspaceId !== workspace.workspaceId, pasteTitle: clipboard === undefined ? translate('context.paste.titleEmpty') : clipboard.workspaceId !== workspace.workspaceId ? translate('context.paste.titleForeign') : translate('context.paste.title'), x: contextMenu.x, y: contextMenu.y }) : null,
          titleContextMenu ? h('div', { className: 'dsh-ws-context-menu', ref: titleMenuRef, role: 'menu', style: { left: Math.max(4, Math.min(titleContextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)), top: Math.max(4, Math.min(titleContextMenu.y, window.innerHeight - 52)) } }, h('button', { className: 'dsh-ws-context-item', onClick: openSessionRename, role: 'menuitem', title: translate('dialog.renameSession'), type: 'button' }, translate('dialog.renameSession'))) : null,
          copyNotice ? h('div', { className: 'dsh-ws-copy-notice', role: 'status' }, copyNotice) : null,
        ),
  )

  const inactiveHeaderLabel = (tab) => {
    if (tab === undefined) return workspace.title
    if (tab.outside === true) return translate('external.outsideFile', { name: tab.name })
    if (tab.external) return translate('external.externalFile', { name: tab.name })
    return tab.path
  }
  /* The non-focused pane's chrome: a read-only header (click/Enter focuses the pane) and a status
     bar that reports lang/size/encoding plus the tab's disk state, without save/cancel controls. */
  const renderInactiveHeader = (tab, paneId) => h('header', {
    className: 'dsh-ws-panel-header dsh-ws-preview-file-header dsh-ws-static-header',
    onClick: () => focusPane(paneId),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        focusPane(paneId)
      }
    },
    role: 'button',
    tabIndex: 0,
    title: translate('preview.split.activate'),
  },
  h('span', {
    className: 'dsh-ws-preview-file-path',
    title: tab === undefined ? undefined : (tab.outside === true ? tab.path : tab.external ? translate('external.externalFile.title') : tab.path),
  }, inactiveHeaderLabel(tab)),
  h('span', { className: 'dsh-ws-pane-readonly' }, translate('preview.split.readonly')))
  const renderInactiveStatus = (tab) => {
    const disk = tab === undefined
      ? undefined
      : tab.diskState === DISK_STATE_GONE ? { error: true, text: translate('status.fileRemoved') }
        : tab.diskState === DISK_STATE_CONFLICT ? { error: true, text: translate('status.fileChangedDirty') }
          : tab.diskState === DISK_STATE_STALE ? { text: translate('status.fileChanged') }
            : undefined
    return h('div', { className: 'dsh-ws-status dsh-ws-static-status' },
      h('span', { className: 'dsh-ws-pane-readonly-chip' }, translate('preview.split.readonly')),
      h('span', { className: 'dsh-ws-preview-status-msg', 'data-error': disk?.error || undefined }, disk?.text ?? translate('preview.split.activateHint')),
      h('div', { className: 'dsh-ws-preview-status-meta' },
        tab ? h('span', { className: 'dsh-ws-language' }, fileLabel(tab.name)) : null,
        tab && Number.isFinite(tab.size) ? h('span', null, formatBytes(tab.size)) : null,
        tab?.encoding ? h('span', { className: 'dsh-ws-encoding', title: translate('encoding.badge') }, encodingLabel(tab.encoding)) : null))
  }
  const renderLiveHeader = () => h('header', { className: 'dsh-ws-panel-header dsh-ws-preview-file-header', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && preview.kind !== RENDERER_IMAGE && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) }, ref: previewHeaderRef },
    h('span', { className: 'dsh-ws-preview-file-path', title: activeTab === undefined ? undefined : (activeTab.outside === true ? activeTab.path : activeTab.external ? translate('external.externalFile.title') : activeTab.path) },
      activeTab
        ? (activeTab.outside === true
            ? translate('external.outsideFile', { name: activeTab.name })
            : activeTab.external
              ? translate('external.externalFile', { name: activeTab.name })
              : activeTab.path)
        : workspace.title),
    fontControlVisible
      ? h('span', { className: 'dsh-ws-font-size', key: 'font-size' },
        h('button', {
          'aria-label': translate('preview.textSize.decrease.title'),
          className: 'dsh-ws-text-button dsh-ws-font-step',
          disabled: fontPercent <= FONT_SCALE_MIN || undefined,
          onClick: () => stepFont(-FONT_SCALE_STEP),
          title: translate('preview.textSize.decrease.title'),
          type: 'button',
        }, h('span', { className: 'dsh-ws-font-a', 'data-glyph': 'sm', 'aria-hidden': true }, 'A'), h('span', { className: 'dsh-ws-font-sign', 'aria-hidden': true }, '−')),
        fontEditing
          ? h('span', { className: 'dsh-ws-font-input' },
            h('input', {
              'aria-label': translate('preview.textSize.input'),
              autoFocus: true,
              className: 'dsh-ws-font-field',
              inputMode: 'numeric',
              maxLength: 3,
              onBlur: commitFontPercent,
              onChange: (event) => setFontDraft(event.target.value.replace(/[^0-9]/gu, '').slice(0, 3)),
              onFocus: (event) => event.target.select(),
              onKeyDown: (event) => {
                if (event.isComposing) return
                if (event.key === 'Enter') { event.preventDefault(); commitFontPercent(); return }
                if (event.key === 'Escape') { event.preventDefault(); setFontEditing(false); setFontDraft(''); return }
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const next = stepFontPercent(fontPercent, event.key === 'ArrowUp' ? FONT_SCALE_STEP : -FONT_SCALE_STEP)
                setFontPercent(next)
                setFontDraft(String(next))
                setStatus({ text: translate('status.textSizeChanged', { percent: next }) })
              },
              placeholder: String(fontBase),
              type: 'text',
              value: fontDraft,
            }),
            h('span', { className: 'dsh-ws-font-pct', 'aria-hidden': true }, '%'))
          : h('button', {
            className: 'dsh-ws-text-button dsh-ws-font-value',
            'data-inherit': fontOwn ? undefined : true,
            onClick: () => { setFontDraft(String(fontPercent)); setFontEditing(true) },
            title: translate('preview.textSize.value.title', { percent: fontBase }),
            type: 'button',
          }, `${fontPercent}%`),
        h('button', {
          'aria-label': translate('preview.textSize.increase.title'),
          className: 'dsh-ws-text-button dsh-ws-font-step',
          disabled: fontPercent >= FONT_SCALE_MAX || undefined,
          onClick: () => stepFont(FONT_SCALE_STEP),
          title: translate('preview.textSize.increase.title'),
          type: 'button',
        }, h('span', { className: 'dsh-ws-font-a', 'data-glyph': 'lg', 'aria-hidden': true }, 'A'), h('span', { className: 'dsh-ws-font-sign', 'aria-hidden': true }, '+')))
      : null,
    runTabPath === null
      ? null
      : h('button', {
        'aria-label': translate('run.panel'),
        className: 'dsh-ws-text-button',
        'data-active': runPanelOpen || undefined,
        onClick: () => setRunCollapsed(runTabPath, runPanelOpen),
        title: translate('run.panel.title'),
        type: 'button',
      }, translate('run.panel')),
    preview.state === 'ready'
      ? h(Fragment, null,
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
          disabled: Boolean(activeTab?.external && activeTab?.outside !== true),
          onClick: refreshFile,
          title: translate('editor.refresh.title'),
          type: 'button',
        }, h(IconRefresh)),
      )
      : null,
  )
  const renderLiveStatus = () => h('div', { className: 'dsh-ws-status', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && preview.kind !== RENDERER_IMAGE && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) } },
    h('div', { className: 'dsh-ws-preview-status-actions' },
      preview.state === 'ready' && preview.kind !== RENDERER_IMAGE
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
    diffSummaryNode,
    h('div', { className: 'dsh-ws-preview-status-meta' },
      activeTab ? h('span', { className: 'dsh-ws-language' }, fileLabel(activeTab.name)) : null,
      size ? h('span', null, size) : null,
      preview.state === 'ready' && preview.kind !== RENDERER_IMAGE && preview.encoding ? h('span', { className: 'dsh-ws-encoding', title: translate('encoding.badge') }, encodingLabel(preview.encoding)) : null,
      preview.state === 'ready' && preview.kind !== RENDERER_IMAGE && reason ? h('span', { title: reason }, reason) : null,
    ),
    h('span', { className: 'dsh-ws-preview-status-msg', 'data-error': notice?.error || undefined }, notice?.text ?? ''),
  )
  /* One pane: its strip, private scrollbar, header/body/status. The lower pane additionally owns
     the collapse control; both panes' strips focus their pane when a tab is activated. */
  const renderPane = (paneId, paneTabs, paneTab, panePath, isFocused) => {
    const bottom = paneId === PREVIEW_PANE_BOTTOM
    const stripRef = bottom ? previewTabsRefB : previewTabsRefA
    const barRef = bottom ? previewScrollbarRefB : previewScrollbarRefA
    const thumbRef = bottom ? previewScrollThumbRefB : previewScrollThumbRefA
    const synthetic = paneTab !== undefined && isSyntheticTab(paneTab)
    return h('section', {
      className: 'dsh-ws-pane',
      'data-drop-body': splitOpen && dropBodyPane === paneId ? true : undefined,
      'data-drop-label': splitOpen && dropBodyPane === paneId ? translate('preview.split.moveHere') : undefined,
      'data-focused': isFocused && splitOpen ? true : undefined,
      'data-pane': paneId,
      style: splitOpen ? { flexGrow: bottom ? 1 - splitRatio : splitRatio } : undefined,
    },
    h(PreviewTabs, {
      activePath: panePath,
      bottom,
      containerRef: stripRef,
      draggingPath,
      dropIndex: dropPane === paneId ? dropIndex : null,
      onBlankContextMenu: (x, y) => {
        tabMenuAnchorRef.current = stripRef.current
        setStripMenu({ pane: paneId, x, y })
      },
      onChoose: activateTab,
      onClose: closeTab,
      onClosePane: bottom ? closeBottomPane : undefined,
      onContextMenu: (path, x, y) => {
        tabMenuAnchorRef.current = stripRef.current
        setTabContextMenu({ pane: paneId, path, x, y })
      },
      onDragEnd: finishDrag,
      onDragLeave: handleTabsDragLeave,
      onDragOver: event => updateDropIndex(paneId, event),
      onDragStart: (path, event) => {
        setDraggingPath(path)
        setDropPane(null)
        setDropIndex(null)
        setDropZone(false)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', path)
      },
      onDrop: event => handleTabsDrop(paneId, event),
      onMouseEnter: bottom ? handleTabsMouseEnterB : handleTabsMouseEnterA,
      onMouseLeave: bottom ? handleTabsMouseLeaveB : handleTabsMouseLeaveA,
      onPromote: promoteTab,
      onReload: reloadTab,
      onScroll: bottom ? handleTabsScrollB : handleTabsScrollA,
      onUnpin: unpinTab,
      tabs: paneTabs,
    }),
    paneTabs.length > 0
      ? h('div', {
        className: 'dsh-ws-preview-scrollbar',
        onMouseEnter: bottom ? handleScrollbarMouseEnterB : handleScrollbarMouseEnterA,
        onMouseLeave: bottom ? handleScrollbarMouseLeaveB : handleScrollbarMouseLeaveA,
        onPointerCancel: bottom ? handleScrollbarPointerEndB : handleScrollbarPointerEndA,
        onPointerDown: bottom ? handleScrollbarPointerDownB : handleScrollbarPointerDownA,
        onPointerMove: bottom ? handleScrollbarPointerMoveB : handleScrollbarPointerMoveA,
        onPointerUp: bottom ? handleScrollbarPointerEndB : handleScrollbarPointerEndA,
        ref: barRef,
      }, h('div', { className: 'dsh-ws-preview-scrollbar-thumb', ref: thumbRef }))
      : null,
    synthetic ? null : (isFocused ? renderLiveHeader() : renderInactiveHeader(paneTab, paneId)),
    renderPaneBody(paneId, paneTabs, paneTab, panePath, isFocused),
    synthetic ? null : (isFocused ? renderLiveStatus() : renderInactiveStatus(paneTab)),
    /* The toast is positioned from the focused header; it must live INSIDE the owning pane, or
       its absolute `top` (computed against the header's parent) would land in the wrong pane. */
    isFocused && previewToast
      ? h(PreviewToast, { headerRef: previewHeaderRef, key: previewToast.seq, onDone: () => setPreviewToast(undefined), text: previewToast.text })
      : null)
  }

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
    h('section', {
      'data-diff-ruler': diffRulerOn ? 'on' : 'off',
      'data-diff-ruler-span': settings.diffRulerSpan === 'full' ? 'full' : 'inset',
      'data-diff-ruler-thumb': settings.diffRulerThumb === 'full' ? 'full' : 'slim',
      'data-drop-active': dropActive || undefined,
      'data-split-zone': dropZone ? 'true' : undefined,
      className: 'dsh-ws-preview',
      onDragLeave: handlePreviewTabDragLeave,
      onDragOver: handlePreviewTabDragOver,
      onDrop: handlePreviewTabDrop,
      onDropCapture: handlePreviewTabDropCapture,
      ref: previewSectionRef,
      style: { ...diffColorVars(settings), '--dsh-ws-vscroll-w': `${diffRulerWidth}px`, '--dsh-ws-content-scale': String(fontPercent / 100) },
    },
      h('div', { className: 'dsh-ws-panes', 'data-split': splitOpen ? 'true' : undefined },
        renderPane(PREVIEW_PANE_TOP, topTabs, topActiveTab, topActivePath, focusedPane === PREVIEW_PANE_TOP),
        splitOpen ? h(PaneSplitter, { onChange: (value) => { splitRatioRef.current = value; setSplitRatio(value) }, ratio: splitRatio }) : null,
        splitOpen ? renderPane(PREVIEW_PANE_BOTTOM, bottomTabs, bottomActiveTab, bottomActivePath, focusedPane === PREVIEW_PANE_BOTTOM) : null,
      ),
      h('div', { className: 'dsh-ws-split-zone', 'data-active': dropZone ? 'true' : undefined, 'aria-hidden': true },
        h('div', { className: 'dsh-ws-split-zone-card' },
          h('span', { className: 'dsh-ws-split-zone-icon', 'aria-hidden': true }, h('i'), h('i')),
          h('span', { className: 'dsh-ws-split-zone-title' }, translate('preview.split.hint')),
          h('span', { className: 'dsh-ws-split-zone-sub' }, translate('preview.split.hintSub')))),
      tabContextMenu ? h(TabContextMenu, {
        canClosePane: splitOpen,
        canMoveToOtherPane: splitOpen,
        canOpenExternally,
        canOpenPermissions: sessionId !== undefined && sessionId !== null && String(sessionId) !== '',
        canReload: tabMenuTarget !== undefined && !isSyntheticTab(tabMenuTarget) && !tabMenuTarget.external && tabMenuTarget.dirty !== true && tabMenuTarget.saving !== true,
        canSplitDown: !splitOpen && tabMenuTarget !== undefined && tabsOfPane(tabs, paneOfTab(tabMenuTarget)).length >= 2,
        menuRef: tabMenuRef,
        onCloseOthers: () => { setTabContextMenu(undefined); closeOtherTabs(tabContextMenu.path) },
        onClosePane: splitOpen ? () => { setTabContextMenu(undefined); closeBottomPane() } : undefined,
        onMoveToOtherPane: splitOpen ? () => { setTabContextMenu(undefined); moveTabToOtherPane(tabContextMenu.path) } : undefined,
        onOpenExternally: openTabExternally,
        onOpenMusic: openMusicWorkshop,
        onOpenPermissions: openPermissionsPage,
        onReload: () => { setTabContextMenu(undefined); reloadTab(tabContextMenu.path) },
        onSplitDown: splitOpen ? undefined : () => { setTabContextMenu(undefined); splitTab(tabContextMenu.path) },
        onTogglePin: () => { setTabContextMenu(undefined); if (tabMenuTarget?.pinned) unpinTab(tabContextMenu.path); else pinTab(tabContextMenu.path) },
        openLabel: openExternallyLabel,
        openTitle: openExternallyTitle,
        permissionCount: permissionPendingCount,
        pinned: Boolean(tabMenuTarget?.pinned),
        reloadTitle: tabMenuTarget?.dirty === true ? translate('tab.reloadBlocked') : translate('tab.reload.title'),
        x: tabContextMenu.x,
        y: tabContextMenu.y,
      }) : null,
      stripMenu ? h(TabStripContextMenu, {
        canClosePane: splitOpen,
        canOpenPermissions: sessionId !== undefined && sessionId !== null && String(sessionId) !== '',
        canSplitDown: !splitOpen && tabsOfPane(tabs, stripMenu.pane).length >= 2,
        menuRef: stripMenuRef,
        onClosePane: splitOpen ? () => { setStripMenu(undefined); closeBottomPane() } : undefined,
        onOpenMusic: openMusicWorkshop,
        onOpenPermissions: openPermissionsPage,
        onSplitDown: () => { setStripMenu(undefined); const path = paneActiveRef.current[stripMenu.pane]; if (path !== null) splitTab(path) },
        permissionCount: permissionPendingCount,
        x: stripMenu.x,
        y: stripMenu.y,
      }) : null,
      h(DropOverlay, { active: dropActive, onClose: () => setDropActive(false), suppressedRef: dropSuppressedRef }),
    ),
  )
}









