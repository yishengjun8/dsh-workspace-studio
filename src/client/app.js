import { createElement as h, Fragment, useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { clampSpinSpeed, CONTEXT_MENU_WIDTH, EDIT_LINES_DEFAULT, EDIT_LINES_MAX, EDIT_LINES_MIN, EDITOR_CONTEXT_PROVIDER, EXPLORER_MAX_RATIO, MINDMAP_END_COLOR_DEFAULT, MINDMAP_HEAD_COLOR_DEFAULT, MINDMAP_SPIN_BASE_DURATION_S, MINDMAP_SPIN_STOP_DURATION_S, MOBILE_HEADER_FALLBACK_H, PACKAGE_ID, PREVIEW_DEFAULT, PREVIEW_MAX, PREVIEW_MIN, PREVIEW_SESSION_MAX, ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, SIDEBAR_COLLAPSED, SIDEBAR_MAX_FALLBACK, SIDEBAR_MAX_RATIO, SIDEBAR_MIN, THINK_LINES_DEFAULT, THINK_LINES_MAX, THINK_LINES_MIN, TREE_MAX, TREE_MIN } from './constants.js'
import { installLocaleService, translate, useLocaleText } from './locale/index.js'
import { setDrawerOpen, setMobile, useMobile } from './mobile.js'
import { styles } from './styles.js'
import { clamp, FILE_COLOR_GROUPS, fileColorOf } from './format.js'
import { previewSnapshotFingerprint, selectStoredPreviewSession } from './preview-tabs.js'
import { checkFileChange, createWorkspaceEntry, deleteDraft, deleteMindmapDoc, putFile, readDraft, renameWorkspaceEntry, requestDraftTree, requestJson, writeDraft } from './api.js'
import { createExplorerPaneStore, createExplorerSettingsStore, createLayoutStore, createPreviewSessionStore, LayoutController } from './stores.js'
import { EditorContextController, PromptContextBridge, selectWorkspaceForSession, workspaceOfSession } from './controllers.js'
import { EditorContextPrefix, installEditorContextMessageCompactor } from './context-bridge.js'
/* The session-row context menu is a FIXED 3 items + separator; clamp its top
   edge against its real height (not the 52 px used for other overlays), so
   the last item stays reachable near the bottom of the viewport. */
const SESSION_CONTEXT_MENU_HEIGHT = 140
import { ThemePresenter } from './theme.js'
import { mindmapRegistry, useMindmapRegistry } from './mindmap/registry.js'
import { installMindmapBranchHider } from './mindmap/hider.js'
import { MindmapSessionsPanel } from './mindmap/panel.js'
import { MindmapHeaderButton } from './mindmap/overlay.js'
import { ResizeHandle, SessionInlineRename, SidebarTopActions } from './components/menus.js'
import { EmptyWorkspaceExplorer, ExplorerSettingsSection } from './components/settings.js'
import { SessionSwitcherDropdown } from './components/switcher.js'
import { MobileHeaderControls, MobileHeroControls, MobileModeToggle } from './components/mobile.js'
import { WorkspaceExplorer } from './components/explorer/index.js'
import { buildMindmapActions } from './mindmap-actions.js'
import { useChatDropMask } from './hooks/chat-drop.js'
import { useChatTailPin } from './hooks/chat-tail-pin.js'
import { useSessionMenu } from './hooks/session-menu.js'
import { useSidebarChrome } from './hooks/sidebar-chrome.js'
import { useThinkCard } from './hooks/think-card.js'
import { registerStudioFileMutationToolview } from './toolview.js'

export function AppFrame(props) {
  const panels = props.useStore(state => state)
  const previewPanels = useSyncExternalStore(props.previewSessionsStore.subscribe, props.previewSessionsStore.getSnapshot)
  const settings = useSyncExternalStore(props.settingsStore.subscribe, props.settingsStore.getSnapshot)
  const panes = useSyncExternalStore(props.explorerPaneStore.subscribe, props.explorerPaneStore.getSnapshot)
  const mobile = useMobile()
  /* One-time self-heal for legacy over-limit data: prunePreviewSessions only
     runs inside rememberPreviewSession, so a localStorage snapshot holding
     more than PREVIEW_SESSION_MAX keys (written before the cap existed) would
     stay oversized — and keep 3-key whole-value serializations large — until
     the next real write. Re-stamping every key through the store action
     converges to the cap in one pass and refreshes updatedAt so genuinely
     stale sessions prune first. */
  useLayoutEffect(() => {
    const entries = previewPanels.previewSessions
    if (entries === null || entries === undefined || typeof entries !== 'object') return
    const keys = Object.keys(entries)
    if (keys.length <= PREVIEW_SESSION_MAX) return
    for (const key of keys) props.previewSessionsStore.actions.rememberPreviewSession(key, entries[key])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Mirror the sidebar width into the persisted pane store: the layout store
  // owns the live value but cannot persist wholesale, so the pane store's
  // small layout value is the durable copy, rehydrated on the next load.
  const sidebarMirrorRef = useRef(null)
  // Viewport-driven sidebar width ceiling. Declared BEFORE the mirror effect
  // below (and the mobile-header effect reading chatSectionRef): the persisted
  // value must not be clamped to the 420 fallback while the live grid allows
  // a wider sidebar, or a refresh loses the wider width.
  const viewportRef = useRef(null)
  const chatSectionRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const sidebarMax = viewportWidth > 0
    ? Math.max(SIDEBAR_MIN, Math.floor(viewportWidth * SIDEBAR_MAX_RATIO))
    : SIDEBAR_MAX_FALLBACK
  useLayoutEffect(() => {
    // In mobile mode the sidebar width is a transient force-expand (the mobile
    // effect unfolds a collapsed sidebar so the drawer shows full content);
    // persisting it would make a mobile-mode refresh lose the user's collapsed
    // preference. While mobile, only track the value in the ref; the exit
    // render compares against the restored desktop width and writes once.
    if (mobile.on) {
      sidebarMirrorRef.current = { value: panels.sidebar, max: sidebarMax }
      return
    }
    // Re-mirror when the VALUE changed (the ceiling only clamps the write);
    // keep the ref current on a ceiling-only change (viewport resize) WITHOUT
    // rewriting the persisted store — a whole-store setItem per resize tick
    // is pure cost when the value did not move.
    const previousMirror = sidebarMirrorRef.current
    if (previousMirror?.value !== panels.sidebar) {
      sidebarMirrorRef.current = { value: panels.sidebar, max: sidebarMax }
      props.explorerPaneStore.actions.setSidebar(panels.sidebar, sidebarMax)
    } else if (previousMirror?.max !== sidebarMax) {
      sidebarMirrorRef.current = { value: panels.sidebar, max: sidebarMax }
    }
  }, [mobile.on, panels.sidebar, props.explorerPaneStore, sidebarMax])
  // In mobile file-fullscreen the conversation header stays pinned above the
  // file browsing page; its live height feeds --dsh-ws-mobile-header-h so the
  // preview fills the phone column below it.
  const currentSession = props.useSessions(state => state.current)
  const sessionIds = props.useSessions(state => state.ids)
  const [mobileHeaderHeight, setMobileHeaderHeight] = useState(MOBILE_HEADER_FALLBACK_H)
  useLayoutEffect(() => {
    // A session switch may swap the header element (or blank it out entirely);
    // reset to the fallback on every pass, then re-measure when present, so the
    // pinned file page never sits under a stale or missing header height.
    setMobileHeaderHeight(MOBILE_HEADER_FALLBACK_H)
    if (!mobile.on || !mobile.files) return undefined
    const section = chatSectionRef.current
    if (section === null) return undefined
    const attach = (headerElement) => {
      const measure = () => {
        const height = headerElement.getBoundingClientRect().height
        if (height > 0) setMobileHeaderHeight(height)
      }
      measure()
      if (typeof ResizeObserver !== 'function') return undefined
      const observer = new ResizeObserver(measure)
      observer.observe(headerElement)
      return () => { observer.disconnect() }
    }
    /* The header may mount a frame or two AFTER this layout effect (the
       conversation slot renders asynchronously): retry for a few frames before
       giving up, so the fixed file page does not sit under a stale fallback
       height for the whole session. Both paths funnel their observer cleanup
       through detachObserver so a late-found header never leaks its observer. */
    let detachObserver = undefined
    let rafId = 0
    const findHeader = () => section.querySelector('[data-slot="conversation.session.header"]')
    let header = findHeader()
    if (header !== null) {
      detachObserver = attach(header)
    } else {
      let retries = 0
      const rafRetry = () => {
        if (retries >= 10) return
        retries += 1
        header = findHeader()
        if (header === null) {
          rafId = requestAnimationFrame(rafRetry)
        } else {
          detachObserver = attach(header)
        }
      }
      rafId = requestAnimationFrame(rafRetry)
    }
    return () => { cancelAnimationFrame(rafId); detachObserver?.() }
  }, [currentSession, mobile.files, mobile.on])
  /* Sidebar mind-map entry icon spin: user speed multiplier (1.2x default over
     the 1.2 s base = 1 s per revolution; larger = faster) becomes the
     animation duration var; speed 0 freezes the spin. */
  const mindmapSpinSpeed = clampSpinSpeed(settings.mindmapSpinSpeed)
  const mindmapSpinDuration = mindmapSpinSpeed > 0
    ? `${(MINDMAP_SPIN_BASE_DURATION_S / mindmapSpinSpeed).toFixed(3)}s`
    : `${MINDMAP_SPIN_STOP_DURATION_S}s`
  // One accent custom property per color group; unset groups resolve to their
  // default inside the CSS rule's var() fallback (the value here is the
  // effective color either way, so the fallback is only a safety net).
  const fileColorVars = {}
  for (const { group } of FILE_COLOR_GROUPS) fileColorVars[`--dsh-ws-file-${group}`] = fileColorOf(settings, group)
  // The session rename dialog targets the current session id.
  const sessionId = currentSession
  // The workspace-files header names the current session (its durable title)
  // instead of a fixed label, so the panel reads as belonging to the session
  // being worked on; fall back when none is selected.
  const sessionTitle = props.useSessions(state => state.current === undefined
    ? undefined
    : state.byId[state.current]?.title)
  const currentCwd = props.useSessions(state => state.current === undefined
    ? undefined
    : state.byId[state.current]?.cwd)
  const detailsCapable = props.useSessions(state => state.current !== undefined
    && state.byId[state.current]?.blank === false)
  const workspaces = props.useWorkspaces(state => state.items)
  const recent = props.useWorkspaces(state => state.recentWorkspaceId)
  // Right-click session-list menu (harness-rendered sidebar rows), the in-place
  // rename overlay, and archive/reveal feedback are owned here because the
  // target rows live in the harness sidebar slot this component renders.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const [resizing, setResizing] = useState(false)
  const chatDrop = useChatDropMask({ chatSectionRef })
  useThinkCard({ chatSectionRef })
  useChatTailPin({ chatSectionRef, currentSession })
  const sidebarChromeState = useSidebarChrome()
  const sessionMenu = useSessionMenu({ props, mountedRef })
  const { asideRef, sidebarChrome } = sidebarChromeState
  const { chatDropActive, chatDropSuppressed, setChatDropActive } = chatDrop
  const {
    sessionContextMenu, sessionMenuRef, sessionInlineRename, sessionInlineRenameBusy,
    sessionInlineRenameError, sessionNotice, beginSessionInlineRename,
    cancelSessionInlineRename, confirmSessionInlineRename, archiveSessionFromMenu,
    revealSessionById, revealSessionFromMenu, openMindmapSession,
  } = sessionMenu

  /* Same two-stage resolution as workspaceOfSession (membership first, then
     cwd): the explorer mount and the editor-context injection must never land
     on different workspaces for the same session (U1 audit). */
  const workspace = useMemo(() => currentSession !== undefined
    ? selectWorkspaceForSession(workspaces, currentSession, currentCwd)
    : workspaces.find(item => item.workspaceId === recent),
  [currentCwd, currentSession, recent, workspaces])
  const workspaceId = workspace?.workspaceId
  const publishEditorContext = useCallback((value) => {
    if (currentSession !== undefined) props.publishEditorContext(String(currentSession), value)
  }, [currentSession, props.publishEditorContext])
  useEffect(() => {
    if (currentSession !== undefined) props.activateEditorSession(String(currentSession))
  }, [currentSession, props.activateEditorSession])
  /* Shared dsh-ws-preview persistence: every session of the same mind map
     (root + all branches) reads and writes ONE snapshot keyed by the map's
     ROOT session id, so the tab strip follows the user across the whole tree;
     sessions outside any map keep their own key. The registry index can lag
     briefly (startup fetch, a fork just made in another tab): a member
     session then falls back to its own key and switches over once the index
     lands (same accepted staleness as the 30 s background poll). The
     explorer's React key uses the SAME id, so switching between member
     sessions keeps the whole preview area MOUNTED (tabs, docked maps, tree)
     instead of remounting and reloading every view. */
  const mindmapRegistryState = useMindmapRegistry()
  const previewSessionId = currentSession === undefined
    ? undefined
    : (mindmapRegistryState.rootOf(currentSession) ?? String(currentSession))
  const previewSessionSelection = selectStoredPreviewSession(previewPanels.previewSessions, workspace, previewSessionId, workspaceId)
  const previewSessionKey = previewSessionSelection.key
  const storedPreviewSession = previewSessionSelection.value
  // Skip a rewrite when this key-set already holds the same snapshot: each
  // write serializes and stores the whole previewSessions value, so identical
  // repeat writes (e.g. a layout effect firing with unchanged state) are pure
  // cost. Keyed per key-set, since switching sessions legitimately writes the
  // same snapshot to a different key-set.
  const lastPersistedSnapshotRef = useRef(new Map())
  const persistPreviewSession = useCallback((value) => {
    // Write the snapshot to every key restore may pick: the current session's
    // persistence key (its mind-map ROOT id when the session is a map member,
    // so the whole tree shares one snapshot) and the workspace anchor. The
    // selected key joins them only when it IS one of those two (a session that
    // already owns a snapshot, or the workspace itself). When restore fell
    // back to ANOTHER session's snapshot (priority ②), that key is a borrowed
    // template, not a write target: persisting to it would overwrite (or
    // delete, on an empty snapshot) that session's saved tabs.
    const keys = new Set()
    if (previewSessionId !== undefined) keys.add(previewSessionId)
    if (workspaceId !== undefined) keys.add(String(workspaceId))
    if (previewSessionKey !== undefined
      && (previewSessionKey === previewSessionId || previewSessionKey === String(workspaceId))) {
      keys.add(previewSessionKey)
    }
    if (keys.size === 0) return
    const keySet = [...keys].sort().join('|')
    const fingerprint = previewSnapshotFingerprint(value)
    if (lastPersistedSnapshotRef.current.get(keySet) === fingerprint) return
    lastPersistedSnapshotRef.current.set(keySet, fingerprint)
    /* LRU-style bound: evict the OLDEST single entry instead of clearing the
       whole table — a full clear would re-serialize and re-write every key on
       the next change (a synchronous full-store write burst). Map iteration
       order is insertion order, so the first key is the oldest write. */
    if (lastPersistedSnapshotRef.current.size > 128) {
      const oldest = lastPersistedSnapshotRef.current.keys().next().value
      if (oldest !== undefined) lastPersistedSnapshotRef.current.delete(oldest)
    }
    for (const key of keys) props.previewSessionsStore.actions.rememberPreviewSession(key, value)
  }, [previewSessionId, previewSessionKey, props.previewSessionsStore, workspaceId])
  const last = useRef(currentSession)
  useEffect(() => {
    const liveSessionIds = sessionIds.map(String)
    props.retainEditorSessions(liveSessionIds)
  }, [props.retainEditorSessions, sessionIds])
  useLayoutEffect(() => {
    if (!detailsCapable) props.actions.closeDetails()
    else if (last.current !== undefined && last.current !== currentSession) props.actions.closeDetails()
    last.current = currentSession
  }, [detailsCapable, currentSession, props.actions])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return undefined
    const measure = () => { setViewportWidth(viewport.getBoundingClientRect().width) }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(viewport)
    return () => { observer.disconnect() }
  }, [])
  // Chat drop mask: track file drags over the chat pane (capture phase,
  // without stopping propagation, so the harness composer still receives the
  // drop and attaches images as usual). The mask covers only the chat pane;
  // the harness's full-viewport mask is hidden by CSS. Enter/leave use a depth
  // counter (Chrome's dragleave has a null relatedTarget, so a contains()
  // check would hide the mask on the first child transition). Closing the mask
  // suppresses it for the current drag until it ends or is dropped.
  // Think card behavior (useThinkCard): every think block (data-variant=
  // "think") is kept open so the harness renders its body (the body exists
  // only while the disclosure row is open — the row state is internal React
  // state, toggled by clicking the disclosure row). The card body viewport
  // shows only the latest --dsh-ws-think-lines rows and stays scroll-pinned
  // to the newest text. User interaction owns a block: a row collapsed by
  // the user is never force-reopened.
  const collapsed = panels.sidebar === 0
  // Mobile mode expands the sidebar so the drawer shows the full browsing
  // content (the rail has no drawer affordance); the previous collapsed state
  // is restored when mobile turns off (mirroring mobile-preview's
  // forceExpanded). Declared after `collapsed` so the dependency array reads
  // an initialized binding (TDZ-safe).
  const sidebarWasCollapsedRef = useRef(null)
  useEffect(() => {
    if (mobile.on) {
      if (sidebarWasCollapsedRef.current === null) {
        sidebarWasCollapsedRef.current = collapsed
        if (collapsed) props.toggleSidebar()
      }
    } else if (sidebarWasCollapsedRef.current !== null) {
      if (sidebarWasCollapsedRef.current) props.toggleSidebar()
      sidebarWasCollapsedRef.current = null
    }
  }, [collapsed, mobile.on, props.toggleSidebar])
  const view = panels.view === 'files' ? 'files' : 'sessions'
  const filesMode = view === 'files'
  const filesActive = filesMode && !collapsed
  const sidebar = collapsed ? SIDEBAR_COLLAPSED : clamp(panels.sidebar, SIDEBAR_MIN, sidebarMax)
  // Measure the viewport, not the grid frame: the conversation column can now shrink without a fixed floor.
  const leftStackMax = viewportWidth > 0
    ? Math.max(sidebar + TREE_MIN + PREVIEW_MIN, Math.floor(viewportWidth * EXPLORER_MAX_RATIO))
    : SIDEBAR_MAX_FALLBACK + TREE_MAX + PREVIEW_MAX
  const explorerMax = Math.max(TREE_MIN + PREVIEW_MIN, leftStackMax - sidebar)
  // The workspace file tree lives only in the sidebar files region, revealed
  // only in the files view; the main frame's tree track stays at zero, so
  // opening the explorer shows only the file preview next to the chat. The
  // tree always portals into the sidebar seat (hidden in the sessions view)
  // and never displaces the preview.
  const tree = 0
  const previewMax = settings.previewRight === true
    ? Math.max(PREVIEW_MIN, viewportWidth > 0 ? Math.floor(viewportWidth * EXPLORER_MAX_RATIO) : PREVIEW_MAX)
    : Math.max(PREVIEW_MIN, explorerMax - tree)
  const preview = filesActive || panes.explorerOpen ? clamp(panes.preview ?? PREVIEW_DEFAULT, PREVIEW_MIN, previewMax) : 0
  const previewBoundary = sidebar + preview
  const treePortalTarget = sidebarChrome?.files ?? null
  return h('div',{ref:viewportRef,className:'dsh-ws-viewport'},h('main',{className:'dsh-ws-frame','data-explorer-closed':!panes.explorerOpen&&!filesActive||undefined,'data-sidebar-collapsed':collapsed||undefined,'data-sidebar-files':filesActive||undefined,'data-resizing':resizing||undefined,'data-preview-right':settings.previewRight===true||undefined,style:{'--dsh-ws-preview':`${preview}px`,'--dsh-ws-sidebar':`${sidebar}px`,'--dsh-ws-row-height':`${clamp(settings.rowHeight ?? ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)}px`,'--dsh-ws-mobile-header-h':`${mobileHeaderHeight}px`,'--dsh-ws-mindmap-spin-duration':mindmapSpinDuration,...fileColorVars}},h('aside',{className:'dsh-ws-sidebar',ref:asideRef},props.renderSlot('sidebar',{collapsed,width:sidebar}),sidebarChrome?.top?createPortal(h(SidebarTopActions,{collapsed,view,width:sidebar,onSelectSessions:()=>{props.actions.setView('sessions')},onSelectFiles:()=>{if(collapsed)props.toggleSidebar();props.actions.setView('files')}}),sidebarChrome.top):null,sidebarChrome&&(sidebarChrome.groups.length>0?sidebarChrome.groups.map(group=>createPortal(h(MindmapSessionsPanel,{useSessions:props.useSessions,useWorkspaces:props.useWorkspaces,groupTitle:group.title,openSession:openMindmapSession,revealSession:revealSessionById}),group.container)):sidebarChrome.fallback?createPortal(h(MindmapSessionsPanel,{useSessions:props.useSessions,useWorkspaces:props.useWorkspaces,groupTitle:undefined,openSession:openMindmapSession,revealSession:revealSessionById}),sidebarChrome.fallback):null)),workspace?h(WorkspaceExplorer,{key:`${workspace.workspaceId}:${previewSessionId ?? 'workspace'}`,createEntry:props.createEntry,listDirectory:props.listDirectory,mindmapActions:props.mindmapActions,persistPreviewSession,previewSessionId,publishEditorContext,readFile:props.readFile,renameEntry:props.renameEntry,saveFile:props.saveFile,loadDraft:props.loadDraft,persistDraftFile:props.persistDraftFile,removeDraftFile:props.removeDraftFile,draftTree:props.draftTree,checkFileChange:props.checkFileChange,settingsStore:props.settingsStore,storedPreviewSession,sessionTitle,sessionId,renameSession:props.renameSession,treePortalTarget,useSessions:props.useSessions,workspace}):h(EmptyWorkspaceExplorer,{sessionTitle,treePortalTarget}),h('section',{className:'dsh-ws-chat',ref:chatSectionRef},props.renderSlot('conversation',{}),chatDropActive?h('div',{className:'dsh-ws-chat-drop-mask',role:'presentation'},h('button',{'aria-label':translate('drop.closeAria'),className:'dsh-ws-chat-drop-close',onClick:()=>{chatDropSuppressed.current=true;setChatDropActive(false)},title:translate('drop.closeTitle'),type:'button'},'×'),h('div',{className:'dsh-ws-chat-drop-card'},translate('drop.releaseImages'))):null),!collapsed?h(ResizeHandle,{label:translate('resize.sidebar'),left:sidebar,max:sidebarMax,min:SIDEBAR_MIN,onDragging:setResizing,onResize:width=>props.actions.setSidebar(width,sidebarMax),value:sidebar}):null,(panes.explorerOpen||filesActive)?h(ResizeHandle,{label:translate('resize.preview'),left:settings.previewRight===true?Math.max(0,viewportWidth-preview):previewBoundary,max:previewMax,min:PREVIEW_MIN,onDragging:setResizing,onResize:width=>props.explorerPaneStore.actions.setPreview(width,previewMax),value:preview,invert:settings.previewRight===true||undefined}):null,h('aside',{className:'dsh-ws-details','data-closed':!panels.detailsOpen||!detailsCapable||undefined},h(props.SessionProvider,null,props.renderSlot('details',{}))),mobile.on&&mobile.drawerOpen?h('div',{className:'dsh-ws-mobile-scrim',onClick:()=>setDrawerOpen(false)}):null,h('div',{className:'dsh-ws-overlay','data-shell-overlay':true},props.renderSlot('shell.overlay',{})),sessionContextMenu?h('div',{className:'dsh-ws-context-menu',ref:sessionMenuRef,role:'menu',style:{left:Math.max(4,Math.min(sessionContextMenu.x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top:Math.max(4,Math.min(sessionContextMenu.y,window.innerHeight-SESSION_CONTEXT_MENU_HEIGHT-8))}},h('button',{className:'dsh-ws-context-item',onClick:beginSessionInlineRename,role:'menuitem',type:'button',title:sessionContextMenu.ambiguous?translate('context.ambiguousTitle',{id:String(sessionContextMenu.sessionId).slice(0,8)}):undefined},translate('context.renameSession')+(sessionContextMenu.ambiguous?` · ${String(sessionContextMenu.sessionId).slice(0,8)}`:'')),h('button',{className:'dsh-ws-context-item',onClick:archiveSessionFromMenu,role:'menuitem',type:'button',title:sessionContextMenu.ambiguous?translate('context.ambiguousTitle',{id:String(sessionContextMenu.sessionId).slice(0,8)}):undefined},translate('context.archiveSession')+(sessionContextMenu.ambiguous?` · ${String(sessionContextMenu.sessionId).slice(0,8)}`:'')),h('div',{className:'dsh-ws-context-separator',role:'separator'}),h('button',{className:'dsh-ws-context-item',onClick:revealSessionFromMenu,role:'menuitem',type:'button'},translate('context.reveal'))):null,sessionInlineRename?h(SessionInlineRename,{busy:sessionInlineRenameBusy,error:sessionInlineRenameError,key:sessionInlineRename.sessionId,onCancel:cancelSessionInlineRename,onConfirm:confirmSessionInlineRename,row:sessionInlineRename.row,title:sessionInlineRename.title}):null,sessionNotice?h('div',{className:'dsh-ws-copy-notice','data-error':sessionNotice.error||undefined,role:'status'},sessionNotice.text):null))}

export const inject = ['slots', 'theme', 'sessions', 'workspaces']
export function mountStudio(ctx) {
  const layout = new LayoutController()
  const layoutStore = createLayoutStore()
  const previewSessionsStore = createPreviewSessionStore().create()
  const settingsStore = createExplorerSettingsStore().create()
  const explorerPaneStore = createExplorerPaneStore().create()
  // The explorer footer toggle is gone; keep the panes always on-screen.
  // Persisted `explorerOpen:false` self-heals here, since nothing else can
  // reopen it anymore.
  explorerPaneStore.actions.setExplorerOpen(true)
  /* Publish the user's mind-map highlight colors (hover / selected) as
     document-wide CSS custom properties: every mind-map highlight rule
     resolves them live, so changing a setting updates open maps instantly
     (no React re-render), and unset values keep the theme defaults. */
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    const applyMindmapColors = () => {
      const state = settingsStore.getSnapshot()
      const root = document.documentElement
      root.style.setProperty('--dsh-ws-mindmap-hover', state?.mindmapHoverColor || 'var(--dsw-alias-state-warn-primary)')
      root.style.setProperty('--dsh-ws-mindmap-selected', state?.mindmapSelectedColor || 'var(--dsw-alias-state-business-primary)')
      root.style.setProperty('--dsh-ws-mindmap-head', state?.mindmapHeadColor || MINDMAP_HEAD_COLOR_DEFAULT)
      root.style.setProperty('--dsh-ws-mindmap-end', state?.mindmapEndColor || MINDMAP_END_COLOR_DEFAULT)
    }
    applyMindmapColors()
    return settingsStore.subscribe(applyMindmapColors)
  }, 'workspace-studio: mind-map highlight colors')
  /* Publish the Think-card viewport height (in lines) as a document-wide CSS
     custom property: the card CSS resolves it live, so moving the settings
     slider restyles every open card instantly (no React re-render). */
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    const applyThinkLines = () => {
      const state = settingsStore.getSnapshot()
      document.documentElement.style.setProperty('--dsh-ws-think-lines', String(clamp(state?.thinkLines ?? THINK_LINES_DEFAULT, THINK_LINES_MIN, THINK_LINES_MAX)))
    }
    applyThinkLines()
    return settingsStore.subscribe(applyThinkLines)
  }, 'workspace-studio: think card lines')
  /* Publish the edit-row viewport height (in lines) as a document-wide CSS
     custom property — the same mechanism as the Think-card line count, but
     independent (the 编辑显示行数 slider drives --dsh-ws-edit-lines). */
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    const applyEditLines = () => {
      const state = settingsStore.getSnapshot()
      document.documentElement.style.setProperty('--dsh-ws-edit-lines', String(clamp(state?.editLines ?? EDIT_LINES_DEFAULT, EDIT_LINES_MIN, EDIT_LINES_MAX)))
    }
    applyEditLines()
    return settingsStore.subscribe(applyEditLines)
  }, 'workspace-studio: edit row lines')
  const editorContexts = new EditorContextController()
  /* Follow the harness language setting (Settings -> General -> Language) when
     the locale plugin is present: register this plugin's dictionaries, bind
     the active-locale translator, and expose the locale face to useLocaleText.
     Without the service everything stays on the zh dictionary. Registered via a
     deferred inject (same pattern as the commandUi scope below) so a locale
     service that activates AFTER this plugin still gets wired up — a one-shot
     ctx.get('locale') at apply time would silently stay on zh forever. */
  ctx.inject(['locale'], scope => {
    scope.effect(() => {
      const localeService = scope.get('locale')
      if (localeService === undefined) return undefined
      return installLocaleService(localeService)
    }, 'workspace-studio: locale dictionaries')
  })
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    for (const stale of document.querySelectorAll(`style[data-plugin-css="${PACKAGE_ID}/layout"]`)) stale.remove()
    const tag = document.createElement('style')
    tag.dataset.plugin = PACKAGE_ID
    tag.dataset.pluginCss = `${PACKAGE_ID}/layout`
    tag.textContent = styles
    document.head.append(tag)
    return () => tag.remove()
  }, 'workspace-studio: styles')
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    // Mobile mode is transient and the document classes are plugin-owned
    // global state. Clear stale classes on activation and disposal so hot
    // reload/uninstall cannot leak layout gates to the shell.
    setMobile(false)
    return () => { setMobile(false) }
  }, 'workspace-studio: mobile class lifecycle')
  ctx.effect(() => installEditorContextMessageCompactor(), 'workspace-studio: compact logged editor context')
  const listDirectory = (workspaceId, path, signal) => requestJson('tree', String(workspaceId), path, signal)
  const readFile = (workspaceId, path, signal, encoding) => requestJson('file', String(workspaceId), path, signal, encoding)
  const saveFile = (workspaceId, path, content, revision, signal, encoding) => putFile(workspaceId, path, content, revision, signal, encoding)
  const loadDraft = (workspaceId, path, signal, owner) => readDraft(String(workspaceId), path, signal, owner)
  const persistDraftFile = (workspaceId, path, payload, signal) => writeDraft(String(workspaceId), path, payload, signal)
  const removeDraftFile = (workspaceId, path, signal, owner, generation) => deleteDraft(String(workspaceId), path, signal, owner, generation)
  const draftTree = (workspaceId, payload, signal) => requestDraftTree(String(workspaceId), payload, signal)
  const checkFileChangeBound = (workspaceId, path, previous, signal) => checkFileChange(String(workspaceId), path, previous, signal)


  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session-maybe' },
        details: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: layoutStore,
      inject: (actions) => {
        layout.attach(actions)
        return {
          createEntry: (workspaceId, path, kind, name, signal) => createWorkspaceEntry(workspaceId, path, kind, name, signal),
          listDirectory,
          publishEditorContext: (sessionId, value) => { editorContexts.update(sessionId, value) },
          activateEditorSession: sessionId => { editorContexts.activate(sessionId) },
          renameEntry: (workspaceId, path, name, signal) => renameWorkspaceEntry(workspaceId, path, name, signal),
          retainEditorSessions: sessionIds => { editorContexts.retain(sessionIds) },
          readFile,
          explorerPaneStore,
          previewSessionsStore,
          saveFile,
          loadDraft,
          persistDraftFile,
          removeDraftFile,
          draftTree,
          checkFileChange: checkFileChangeBound,
          settingsStore,
          toggleSidebar: () => { layout.toggleSidebar() },
          renameSession: async (sessionId, title) => {
            const session = ctx.sessions.binding(String(sessionId))?.session
            if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
            const result = await session.rename(title)
            if (!result.ok) throw new Error(result.error.message)
          },
          // Right-click session-list actions: archive via the harness
          // workspaces service and read sessions/workspaces snapshots
          // imperatively (the AppFrame listener must not subscribe through
          // hooks to decide whether to show the menu).
          archiveSession: sessionId => ctx.workspaces.archiveSession(sessionId),
          getSessionList: () => ctx.sessions.list.getSnapshot(),
          getWorkspaceItems: () => ctx.workspaces.list.getSnapshot().items,
          // Mind-map sidebar entries open the root session and dock the mind
          // map as a preview tab (the chat column stays visible).
          openSession: sessionId => { ctx.sessions.open(sessionId) },
          deleteMindmapDoc: (sessionId, signal) => deleteMindmapDoc(sessionId, signal),
          // The docked mind-map view's document/fork/archive action face.
          mindmapActions: buildMindmapActions(ctx),
        }
      },
    }, AppFrame)
    return () => {
      disposeRegistration()
      void disposeService()
    }
  }, 'workspace-studio: service and root registration')
  const promptContextBridge = new PromptContextBridge(ctx, editorContexts)
  ctx.inject(['conversation'], scope => {
    scope.effect(
      () => promptContextBridge.install(),
      'workspace-studio: prompt context bridge',
    )
  })
  /* The /init slash command: a popupSelect contribution that resolves the
     session's workspace, shows the target root, and hands the model a Claude
     Code /init-style instruction through the session's send seam. Only direct
     sessions can run it. Registered when ui-commands is present; otherwise
     the command does not exist. */
  ctx.inject(['commandUi'], scope => {
    scope.effect(() => {
      const commandUi = scope.get('commandUi')
      // A deferred inject scope can fire without the service present (same
      // transition the locale block guards): degrade to "no command" instead
      // of throwing inside the effect run.
      if (commandUi === undefined) return undefined
      const dispose = commandUi.register({
        name: 'init',
        description: translate('init.menu.description'),
        available: session => {
          const row = ctx.sessions.list.getSnapshot().byId[String(session.sessionId)]
          return row !== undefined && row.origin !== 'subagent'
        },
        ui: {
          kind: 'popupSelect',
          options: async (session, signal) => {
            const id = String(session.sessionId)
            const workspace = workspaceOfSession(ctx, id)
            if (workspace === undefined) throw new Error(translate('init.error.no-workspace'))
            const root = workspace.path
            let exists = false
            try {
              const tree = await listDirectory(workspace.workspaceId, '', signal)
              exists = (tree?.entries ?? []).some(entry => entry.kind === 'file' && entry.name === 'AGENTS.md')
            } catch (error) {
              // A failed scan must not block the command: the agent re-checks
              // existence itself; this only decides the option wording.
              if (error?.name === 'AbortError') throw error
            }
            const action = exists ? {
              id: 'update', label: translate('init.option.update'), detail: translate('init.option.update.detail', { root }),
            } : {
              id: 'generate', label: translate('init.option.generate'), detail: translate('init.option.generate.detail', { root }),
            }
            return exists ? [action, { id: 'cancel', label: translate('dialog.cancel') }] : [action]
          },
          onSelect: async (option, session) => {
            if (option.id === 'cancel') return
            await promptContextBridge.runInitCommand(String(session.sessionId))
          },
        },
      })
      return dispose
    }, 'workspace-studio: init command')
  })
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: EDITOR_CONTEXT_PROVIDER,
    order: 30,
    inject: sessionId => ({
      hooks: { editorContext: editorContexts.storeFor(String(sessionId)) },
      toggle: () => { editorContexts.toggle(String(sessionId)) },
      ensureSession: id => { promptContextBridge.ensure(id) },
    }),
  }, EditorContextPrefix))
  /* Chat edit/write rows: default-open Studio row with the merged diff view
     (green-background additions, red-strikethrough deletions in one block),
     shadowing the shipped FileMutationRow for the edit/write keys. */
  registerStudioFileMutationToolview(ctx)
  ctx.effect(() => () => { editorContexts.dispose() }, 'workspace-studio: editor context state')
  /* Mobile mode entries: the sidebar-footer toggle, the session-header whale +
     file-content-browsing controls (declared by ui-conversation), and the
     hero-page whale (declared by this plugin's root, rendered into the
     shell.overlay seat). All contributions install when their slot declares. */
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'workspace-mobile-toggle', order: 110,
  }, MobileModeToggle))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'workspace-mobile-controls', order: -300,
  }, MobileHeaderControls))
  // The session-switcher dropdown replaces the harness title crumb (CSS hides
  // it; the trigger renders at -400, leftmost). Switching reuses
  // ctx.sessions.open — the same call the sidebar list uses — so the whole
  // layout (workspace, preview, chat) follows the new current.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'workspace-session-switcher', order: -400,
    inject: () => ({ openSession: sessionId => { ctx.sessions.open(sessionId) } }),
  }, SessionSwitcherDropdown))
  /* The session-header mind-map button: opens the current session's mind map
     as a preview tab (dsh-ws-preview), keeping the chat column visible. */
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'workspace-mindmap-toggle', order: -350,
  }, MindmapHeaderButton))
  /* Mind-map family sessions (roots + every fork descendant) are hidden from
     the harness sidebar session list; each mind map is represented by its
     self-drawn sidebar entry instead. */
  ctx.effect(() => installMindmapBranchHider(
    () => ctx.sessions.list.getSnapshot(),
    () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
    () => ctx.workspaces.list.getSnapshot().items,
  ), 'workspace-studio: mind-map branch hider')
  /* Background mind-map doc index (feeds the sidebar entries and the hider). */
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    mindmapRegistry.start()
    return () => mindmapRegistry.stop()
  }, 'workspace-studio: mind-map index registry')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'workspace-mobile-hero', order: -100,
  }, MobileHeroControls))
  // The browser Settings page owns every explorer preference in one section,
  // grouped into plugin update, session browsing, mind-map browsing, file
  // browsing, content browsing, and dialog settings (unset color/preset
  // groups resolve to their defaults).
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'workspace-explorer', order: 5, label: () => translate('settings.section.title'),
    inject: () => ({ settingsStore }),
  }, ExplorerSettingsSection))
  ctx.effect(() => {
    /* Every other DOM-touching effect in this file guards on document; the
       ThemePresenter constructs DOM immediately, so it must too. */
    if (typeof document === 'undefined') return undefined
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => presenter.apply(snapshot))
    return () => {
      off()
      presenter.dispose()
    }
  }, 'workspace-studio: theme presenter')
}
