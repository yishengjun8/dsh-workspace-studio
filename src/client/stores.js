import { defineStore } from '@deepseek-ai/dsh-client-store'
import { AUTO_EXPAND_EDIT_DIFF_DEFAULT, AUTO_EXPAND_THINK_DEFAULT, AUTO_SYNC_MODE_AUTO, AUTO_SYNC_MODE_WATCH_ONLY, clampMountBulge, CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN, cssColorToHex, EXPLORER_LAYOUT_STORE_KEY, EXPLORER_SETTINGS_STORE_KEY, MINDMAP_END_COLOR_DEFAULT, MINDMAP_HEAD_COLOR_DEFAULT, MINDMAP_HOVER_COLOR_FALLBACK, MINDMAP_HOVER_THEME_VAR, MINDMAP_MOUNT_BULGE_DEFAULT_X, MINDMAP_SELECTED_COLOR_FALLBACK, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SPIN_SPEED_DEFAULT_X, MINDMAP_SPIN_SPEED_MAX_X, MINDMAP_SPIN_SPEED_MIN_X, MINDMAP_SUMMARY_DEFAULT_LENGTH, MINDMAP_SUMMARY_LENGTH_STEP, MINDMAP_SUMMARY_MAX_LENGTH, MINDMAP_SUMMARY_MIN_LENGTH, MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH, MINDMAP_SUMMARY_SESSION_LENGTH_STEP, MINDMAP_SUMMARY_SESSION_MAX_LENGTH, MINDMAP_SUMMARY_SESSION_MIN_LENGTH, mindmapEffectiveColor, PREVIEW_DEFAULT, PREVIEW_MAX, PREVIEW_MIN, PREVIEW_RIGHT_DEFAULT, PREVIEW_SESSION_STORE_KEY, ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, SEARCH_MATCH_EXPAND_DEFAULT, SIDEBAR_DEFAULT, SIDEBAR_MAX_FALLBACK, SIDEBAR_MIN, THINK_COLLAPSE_DELAY_DEFAULT_S, THINK_COLLAPSE_DELAY_MAX_S, THINK_COLLAPSE_DELAY_MIN_S, TREE_DEFAULT, TREE_MAX, TREE_MIN, WATCH_FILES_DEFAULT } from './constants.js'
import { clamp, fileColorDefault, highlightPresetDefaultFor } from './format.js'
import { normalizePreviewSession, prunePreviewSessions } from './preview-tabs.js'

// The persisted sidebar width lives with the explorer pane geometry
// (EXPLORER_LAYOUT_STORE_KEY): the root layout store can't persist its whole
// value, so the explorer store mirrors it on change and this rehydrates it on
// load. 0 means collapsed; missing/invalid data falls back to the default
// width (render-time clamping still applies the viewport ceiling).
export function readPersistedSidebarWidth() {
  if (typeof localStorage === 'undefined') return SIDEBAR_DEFAULT
  try {
    const raw = localStorage.getItem(EXPLORER_LAYOUT_STORE_KEY)
    if (raw === null) return SIDEBAR_DEFAULT
    const sidebar = JSON.parse(raw)?.sidebar
    if (sidebar === 0) return 0
    if (typeof sidebar === 'number' && Number.isFinite(sidebar)) return Math.max(SIDEBAR_MIN, Math.round(sidebar))
    return SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}
export function createLayoutStore() {
  return defineStore({
    init: () => ({
      sidebar: readPersistedSidebarWidth(),
      detailsOpen: false,
      // Sidebar browsing region: 'sessions' = workspace/session browser;
      // 'files' swaps the same region for the workspace file tree.
      view: 'sessions',
    }),
    actions: {
      setSidebar: (draft, width, max = SIDEBAR_MAX_FALLBACK) => { draft.sidebar = width === 0 ? 0 : clamp(width, SIDEBAR_MIN, max) },
      toggleSidebar: (draft) => { draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0 },
      openDetails: (draft) => { draft.detailsOpen = true },
      closeDetails: (draft) => { draft.detailsOpen = false },
      setView: (draft, view) => { draft.view = view === 'files' ? 'files' : 'sessions' },
    },
  })
}
/* Explorer pane geometry shared by every session: file-tree width, preview
   width, sidebar width (0 = collapsed), and explorer open state (controls
   both panes' on-screen presence). Persisted in localStorage so switches and
   reloads keep one shared set. */
export function createExplorerPaneStore() {
  return defineStore({
    init: () => ({
      tree: TREE_DEFAULT,
      preview: PREVIEW_DEFAULT,
      sidebar: SIDEBAR_DEFAULT,
      explorerOpen: true,
    }),
    persist: EXPLORER_LAYOUT_STORE_KEY,
    actions: {
      setTree: (draft, width, max = TREE_MAX) => { draft.tree = clamp(width, TREE_MIN, max) },
      setPreview: (draft, width, max = PREVIEW_MAX) => { draft.preview = clamp(width, PREVIEW_MIN, max) },
      setSidebar: (draft, width, max = SIDEBAR_MAX_FALLBACK) => { draft.sidebar = width === 0 ? 0 : clamp(width, SIDEBAR_MIN, max) },
      setExplorerOpen: (draft, open) => { draft.explorerOpen = open },
    },
  })
}
export function createPreviewSessionStore() {
  return defineStore({
    init: () => ({
      previewSessions: {},
    }),
    persist: PREVIEW_SESSION_STORE_KEY,
    actions: {
      rememberPreviewSession: (draft, key, value) => {
        // Rehydrated wholesale from localStorage; a polluted or legacy key
        // without the expected shape must not throw.
        if (draft.previewSessions === undefined || draft.previewSessions === null || typeof draft.previewSessions !== 'object') draft.previewSessions = {}
        const normalized = normalizePreviewSession(value)
        if (normalized.tabs.length === 0 && (normalized.expanded ?? []).length === 0) delete draft.previewSessions[String(key)]
        else {
          // Timestamp every write so stale sessions can be pruned below; the
          // in-memory editor keeps full content, only the stored copy is slim.
          draft.previewSessions[String(key)] = { ...normalized, updatedAt: Date.now() }
          prunePreviewSessions(draft)
        }
      },
    },
  })
}
export function createExplorerSettingsStore() {
  return defineStore({
    init: () => ({
      rowHeight: ROW_HEIGHT_DEFAULT,
      conflictFontSize: CONFLICT_FONT_SIZE_DEFAULT,
      wrap: false,
      expandSearchMatches: SEARCH_MATCH_EXPAND_DEFAULT,
      autoExpandThink: AUTO_EXPAND_THINK_DEFAULT,
      thinkCollapseDelay: THINK_COLLAPSE_DELAY_DEFAULT_S,
      autoExpandEditDiff: AUTO_EXPAND_EDIT_DIFF_DEFAULT,
      mindmapSpinSpeed: MINDMAP_SPIN_SPEED_DEFAULT_X,
      mindmapHoverColor: undefined,
      mindmapSelectedColor: undefined,
      mindmapHeadColor: undefined,
      mindmapEndColor: undefined,
      mindmapMountBulge: MINDMAP_MOUNT_BULGE_DEFAULT_X,
      /* AI card summaries: OFF by default (no hidden token cost); the model is
         undefined = "follow the session's model" once enabled. */
      mindmapSummaryEnabled: false,
      mindmapSummaryModel: undefined,
      mindmapSummaryLength: MINDMAP_SUMMARY_DEFAULT_LENGTH,
      mindmapSummarySessionLength: MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH,
      fileColors: {},
      highlightPresets: {},
      previewRight: PREVIEW_RIGHT_DEFAULT,
      watchFiles: WATCH_FILES_DEFAULT,
      autoSyncMode: AUTO_SYNC_MODE_AUTO,
    }),
    persist: EXPLORER_SETTINGS_STORE_KEY,
    actions: {
      setRowHeight: (draft, value) => { draft.rowHeight = clamp(value, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX) },
      setConflictFontSize: (draft, value) => { draft.conflictFontSize = clamp(value, CONFLICT_FONT_SIZE_MIN, CONFLICT_FONT_SIZE_MAX) },
      setWrap: (draft, value) => { draft.wrap = Boolean(value) },
      setExpandSearchMatches: (draft, value) => { draft.expandSearchMatches = Boolean(value) },
      setAutoExpandThink: (draft, value) => { draft.autoExpandThink = Boolean(value) },
      setAutoExpandEditDiff: (draft, value) => { draft.autoExpandEditDiff = Boolean(value) },
      setThinkCollapseDelay: (draft, value) => {
        const seconds = Number(value)
        const bounded = Number.isFinite(seconds)
          ? Math.min(THINK_COLLAPSE_DELAY_MAX_S, Math.max(THINK_COLLAPSE_DELAY_MIN_S, seconds))
          : THINK_COLLAPSE_DELAY_DEFAULT_S
        draft.thinkCollapseDelay = Math.round(bounded * 10) / 10
      },
      setMindmapSpinSpeed: (draft, value) => {
        const speed = Number(value)
        const bounded = Number.isFinite(speed)
          ? Math.min(MINDMAP_SPIN_SPEED_MAX_X, Math.max(MINDMAP_SPIN_SPEED_MIN_X, speed))
          : MINDMAP_SPIN_SPEED_DEFAULT_X
        draft.mindmapSpinSpeed = Math.round(bounded * 10) / 10
      },
      setMindmapHoverColor: (draft, value) => {
        const hex = cssColorToHex(value)
        if (hex === null) return
        const defaultHex = mindmapEffectiveColor(undefined, MINDMAP_HOVER_THEME_VAR, MINDMAP_HOVER_COLOR_FALLBACK)
        if (hex === defaultHex) delete draft.mindmapHoverColor
        else draft.mindmapHoverColor = hex
      },
      resetMindmapHoverColor: (draft) => { delete draft.mindmapHoverColor },
      setMindmapSelectedColor: (draft, value) => {
        const hex = cssColorToHex(value)
        if (hex === null) return
        const defaultHex = mindmapEffectiveColor(undefined, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SELECTED_COLOR_FALLBACK)
        if (hex === defaultHex) delete draft.mindmapSelectedColor
        else draft.mindmapSelectedColor = hex
      },
      resetMindmapSelectedColor: (draft) => { delete draft.mindmapSelectedColor },
      setMindmapHeadColor: (draft, value) => {
        const hex = cssColorToHex(value)
        if (hex === null) return
        /* The DEFAULT head color is the fixed violet (not a theme var): picking
           it back means "use the default" — drop the stored override. */
        if (hex === MINDMAP_HEAD_COLOR_DEFAULT) delete draft.mindmapHeadColor
        else draft.mindmapHeadColor = hex
      },
      resetMindmapHeadColor: (draft) => { delete draft.mindmapHeadColor },
      setMindmapEndColor: (draft, value) => {
        const hex = cssColorToHex(value)
        if (hex === null) return
        /* The DEFAULT end-card color is the fixed success green (not a theme
           var): picking it back means "use the default" — drop the override. */
        if (hex === MINDMAP_END_COLOR_DEFAULT) delete draft.mindmapEndColor
        else draft.mindmapEndColor = hex
      },
      resetMindmapEndColor: (draft) => { delete draft.mindmapEndColor },
      setMindmapMountBulge: (draft, value) => { draft.mindmapMountBulge = clampMountBulge(value) },
      setMindmapSummaryEnabled: (draft, value) => { draft.mindmapSummaryEnabled = Boolean(value) },
      setMindmapSummaryModel: (draft, value) => {
        if (value === null || value === undefined) delete draft.mindmapSummaryModel
        else if (typeof value?.provider === 'string' && value.provider !== ''
          && typeof value?.model === 'string' && value.model !== '') {
          draft.mindmapSummaryModel = { provider: value.provider, model: value.model }
        }
      },
      setMindmapSummaryLength: (draft, value) => {
        const raw = Number(value)
        if (!Number.isFinite(raw)) { draft.mindmapSummaryLength = MINDMAP_SUMMARY_DEFAULT_LENGTH; return }
        const stepped = Math.round(raw / MINDMAP_SUMMARY_LENGTH_STEP) * MINDMAP_SUMMARY_LENGTH_STEP
        draft.mindmapSummaryLength = Math.min(MINDMAP_SUMMARY_MAX_LENGTH, Math.max(MINDMAP_SUMMARY_MIN_LENGTH, stepped))
      },
      setMindmapSummarySessionLength: (draft, value) => {
        const raw = Number(value)
        if (!Number.isFinite(raw)) { draft.mindmapSummarySessionLength = MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH; return }
        const stepped = Math.round(raw / MINDMAP_SUMMARY_SESSION_LENGTH_STEP) * MINDMAP_SUMMARY_SESSION_LENGTH_STEP
        draft.mindmapSummarySessionLength = Math.min(MINDMAP_SUMMARY_SESSION_MAX_LENGTH, Math.max(MINDMAP_SUMMARY_SESSION_MIN_LENGTH, stepped))
      },
      setFileColor: (draft, group, value) => {
        if (draft.fileColors === undefined) draft.fileColors = {}
        if (String(value).toLowerCase() === fileColorDefault(group).toLowerCase()) delete draft.fileColors[group]
        else draft.fileColors[group] = String(value)
      },
      resetFileColor: (draft, group) => { if (draft.fileColors !== undefined) delete draft.fileColors[group] },
      resetFileColors: (draft) => { draft.fileColors = {} },
      setHighlightPreset: (draft, group, presetId) => {
        if (draft.highlightPresets === undefined) draft.highlightPresets = {}
        if (presetId === highlightPresetDefaultFor(group)) delete draft.highlightPresets[group]
        else draft.highlightPresets[group] = String(presetId)
      },
      resetHighlightPreset: (draft, group) => { if (draft.highlightPresets !== undefined) delete draft.highlightPresets[group] },
      resetHighlightPresets: (draft) => { draft.highlightPresets = {} },
      setPreviewRight: (draft, value) => { draft.previewRight = Boolean(value) },
      setWatchFiles: (draft, value) => { draft.watchFiles = Boolean(value) },
      setAutoSyncMode: (draft, value) => {
        draft.autoSyncMode = value === AUTO_SYNC_MODE_WATCH_ONLY ? AUTO_SYNC_MODE_WATCH_ONLY : AUTO_SYNC_MODE_AUTO
      },
    },
  })
}
export class LayoutController { attach(actions){this.actions=actions} requireActions(){if(!this.actions)throw new Error('workspace-studio: root store actions are not attached');return this.actions} toggleSidebar(){this.requireActions().toggleSidebar()} openDetails(){this.requireActions().openDetails()} closeDetails(){this.requireActions().closeDetails()} }