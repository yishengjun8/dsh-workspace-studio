export const PACKAGE_ID = '@yishengjun8/dsh-workspace-studio'
export const API_PREFIX = '/workspace-studio/api'
/* Plugin self-update: a real network round trip, so a longer timeout than a generic request. Both budgets stay ABOVE the Host's own bounds (30 s check codeload fetch, 120 s install fetch) plus its gunzip/extract/verify work, so a slow network surfaces the Host's error instead of an opaque client-side abort. */
export const UPDATE_CHECK_TIMEOUT_MS = 60_000
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 180_000
/* Token statistics: the first-ever scan walks every session log on the Host (subsequent opens hit the revision-guarded index), so the request gets a long timeout like the update download. */
export const TOKEN_STATS_TIMEOUT_MS = 120_000
export const EDITOR_CONTEXT_PROVIDER = 'workspace-editor-context'
export const SEND_SESSION_BRIDGE_MARKER = Symbol('workspace-studio.send-session-bridge')
/* The true original sendSession recorded on a wrapper so an overlapping re-install can unwrap a stale wrapper instead of recursing. */
export const SEND_SESSION_BRIDGE_ORIGINAL = Symbol('workspace-studio.send-session-bridge.original')
/* The chat file-open router patches ctx.sidebarRight.openResource with the same marker + recorded original convention so an overlapping re-install unwraps instead of recursing. */
export const OPEN_RESOURCE_BRIDGE_MARKER = Symbol('workspace-studio.open-resource-bridge')
export const OPEN_RESOURCE_BRIDGE_ORIGINAL = Symbol('workspace-studio.open-resource-bridge.original')
/* Bounded 50 ms retries while a session's input binding is not ready; a binding that never becomes ready must not spin a timer forever. */
export const ENSURE_RETRY_MAX = 20
/* Persisted UI state carries the FORMAT version in its key: a shape change bumps the
   key and the previous key is deleted outright (see persisted-state.js), so no reader
   ever has to interpret an older shape. */
export const PREVIEW_SESSION_STORE_KEY = 'dsh.workspace.studio.preview-sessions.v2'
export const PREVIEW_SESSION_MAX = 25
/* Quick-calculator unit prices in the token-stats panel (shared defaults, per-model overrides and the currency symbol); tiny, local-only and never sent anywhere. */
export const TOKEN_PRICES_STORE_KEY = 'dsh.workspace.studio.token-prices.v2'
/* Currency symbols are one or two glyphs; the input is capped so a paste cannot bloat the persisted value. */
export const TOKEN_CURRENCY_MAX_LENGTH = 3
/* Sanity cap per price field: 7 integer digits plus a 6-digit fraction is far beyond any real per-million price. */
export const TOKEN_PRICE_MAX_LENGTH = 14
/* The priced fields, in display order. Cache-write tokens are excluded on purpose: they are
   neither displayed nor priced, so no field exists for them — a value stored under any other
   name (including a field a previous format wrote) is simply not part of the schema and is
   dropped by the persisted-state gate. */
export const TOKEN_PRICE_FIELDS = Object.freeze(['input', 'cacheRead', 'output'])
export const TOKEN_PRICE_DEFAULT_CURRENCY = '¥'
/* Token-stats panel geometry: the draggable divider between the model-detail and
   quick-calculator columns. Its own key (not the explorer layout key, which its store
   serializes wholesale and would wipe a foreign field on the next write). 0 = never
   dragged: the panel uses the built-in column ratio, so both columns keep scaling with
   the window; any other value is the left column's pixel width. */
export const TOKEN_LAYOUT_STORE_KEY = 'dsh.workspace.studio.token-layout.v1'
export const TOKEN_SPLIT_DEFAULT = 0, TOKEN_SPLIT_MIN = 380, TOKEN_SPLIT_MAX = 980, TOKEN_SPLIT_RIGHT_MIN = 440
export const SIDEBAR_DEFAULT = 280, SIDEBAR_COLLAPSED = 56, SIDEBAR_MIN = 240, SIDEBAR_MAX_RATIO = 0.8, SIDEBAR_MAX_FALLBACK = 420
export const EXPLORER_MAX_RATIO = 0.8
export const TREE_DEFAULT = 280, TREE_MIN = 220, TREE_MAX = 520
export const PREVIEW_DEFAULT = 420, PREVIEW_MIN = 280, PREVIEW_MAX = 760, RESIZE_STEP = 12
/* The change-review tab's inner split: the file list beside the comparison. The
   list width is user-draggable in memory only (it is never persisted), so the
   bounds are what keeps the comparison readable inside any preview-column width. */
export const REVIEW_LIST_DEFAULT = 180, REVIEW_LIST_MIN = 140, REVIEW_DIFF_MIN = 220, REVIEW_LIST_MAX_FALLBACK = 520
export const CONTEXT_MENU_WIDTH = 176, CONTEXT_MENU_HEIGHT = 280, COMPACT_MENU_HEIGHT = 72
export const ROW_HEIGHT_DEFAULT = 20, ROW_HEIGHT_MIN = 12, ROW_HEIGHT_MAX = 36
/* Save-conflict dialog comparison text size (px); default matches .dsh-ws-conflict-code. */
export const CONFLICT_FONT_SIZE_DEFAULT = 12, CONFLICT_FONT_SIZE_MIN = 6, CONFLICT_FONT_SIZE_MAX = 24
/* Preview content text size. Each file tab may carry its own percentage (fontPercent); a tab
   WITHOUT one follows the settings page's base size, so "clear my own value" and "follow the
   base" are the same state. Published on the preview column as --dsh-ws-content-scale
   (1 = 100% = the harness's own body size, so 100% is pixel-identical to having no feature). */
export const FONT_SCALE_DEFAULT = 100, FONT_SCALE_MIN = 60, FONT_SCALE_MAX = 200, FONT_SCALE_STEP = 10
/* A typed value keeps its exact integer (137% stays 137%); only the stepper walks the 10% grid. */
export const clampFontPercent = (value, fallback = FONT_SCALE_DEFAULT) => {
  const percent = Number(value)
  if (!Number.isFinite(percent)) return fallback
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(percent)))
}
export const stepFontPercent = (value, delta) => {
  const stepped = Math.round((clampFontPercent(value) + delta) / FONT_SCALE_STEP) * FONT_SCALE_STEP
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stepped))
}
/* Search-result rows expanded by default (user-tunable in explorer settings). */
export const SEARCH_MATCH_EXPAND_DEFAULT = true
/* File-browser pane sits on the right side of the conversation column instead of the left (user-tunable). */
export const PREVIEW_RIGHT_DEFAULT = false
/* Watch opened files for external changes and auto-sync the clean preview (user-tunable); polls this cadence when the host watch is unavailable. */
export const WATCH_FILES_DEFAULT = true
export const AUTO_SYNC_CHECK_MS = 2000
/* Backpressure for AUTO-mode reloads: external changes to the same path within this window only surface a status, so a continuously-written file cannot remount the editor and wipe its undo history every tick. */
export const AUTO_RELOAD_COOLDOWN_MS = 4000
/* "Auto" = a clean tab reloads on change; "watch-only" = only shows a "file changed" status and waits for the user's refresh. */
export const AUTO_SYNC_MODE_AUTO = 'auto'
export const AUTO_SYNC_MODE_WATCH_ONLY = 'watch-only'
/* Version-control status in the file browser (git / svn, read-only). Each poll spawns a
   status command on the Host, so the cadence is far slower than the file-watch tick and
   only runs while the file-browsing pane is actually visible; the Host's own payload TTL
   is shorter, so consecutive polls usually answer from its cache. */
export const VCS_STATUS_POLL_MS = 20000
/* Above the Host's own tool timeout (10 s), so a hung command surfaces the Host's message. */
export const VCS_STATUS_TIMEOUT_MS = 15000
/* Coalesces the refresh triggers of one save / mutation burst into a single request. */
export const VCS_REFRESH_DEBOUNCE_MS = 300
/* Hide VCS metadata directories (.git / .svn) in the tree; display-only, user-tunable. */
export const VCS_HIDE_METADATA_DEFAULT = true
/* Editor change gutter (the add/modify/delete marks left of the code): the recompute runs on the
   live buffer so typing stays responsive, hence a debounce; a document past the line cap and a diff
   whose trace exceeds the merge budget both degrade to "not computed" instead of a slow tick. */
export const DIFF_GUTTER_MAX_LINES = 20000
export const DIFF_GUTTER_DEBOUNCE_MS = 250
/* Change-gutter line tint: rows carry the added/modified wash by default (user-tunable). */
export const DIFF_TINT_DEFAULT = true
/* Scrollbar change ruler: the preview column's vertical scrollbar track is widened and paints the
   buffer's change map UNDER the native slider (no custom scrollbar, so dragging, track paging,
   keyboard and trackpad scrolling stay native). Width is the track's layout width in px, mirrored
   into the harness's own --dsh-scrollbar-width so nested surfaces align. */
export const DIFF_RULER_DEFAULT = true
export const DIFF_RULER_WIDTH_DEFAULT = 14
export const DIFF_RULER_WIDTH_MIN = 10
export const DIFF_RULER_WIDTH_MAX = 18
/* 'inset' keeps a 3px margin either side so the marks read as one column inside the wider track. */
export const DIFF_RULER_SPAN_DEFAULT = 'inset'
/* 'slim' keeps today's 8px slider look centred in the wider track; 'full' fills it. */
export const DIFF_RULER_THUMB_DEFAULT = 'slim'
/* Cap on the ruler gradient's colour stops: a pathological buffer (thousands of alternating runs)
   must not build a megabyte-long inline style; past the cap consecutive runs merge into one band. */
export const DIFF_RULER_MAX_RUNS = 200
/* Per-tab disk state, RUNTIME ONLY (not in clonePreviewTab's whitelist — see
   preview-tabs.js, so it never persists or joins previewSnapshotFingerprint):
   `clean` = shown content matches disk; `stale` = disk moved, tab is clean;
   `conflict` = disk moved AND the tab holds editable unsaved edits;
   `gone` = the Host reports the file missing. */
export const DISK_STATE_CLEAN = 'clean'
export const DISK_STATE_STALE = 'stale'
export const DISK_STATE_CONFLICT = 'conflict'
export const DISK_STATE_GONE = 'gone'
/* Feedback flash applied to a tab an AUTO-mode reload just replaced; must outlast the CSS animation, then clear so the next reload can replay it. */
export const TAB_FLASH_MS = 700
/* Think card: the body viewport shows only the latest N lines (user-tunable, 5-30, default 10), pinned to the newest text while streaming; published as --dsh-ws-think-lines. */
export const THINK_LINES_DEFAULT = 10
export const THINK_LINES_MIN = 5
export const THINK_LINES_MAX = 30
export const THINK_LINES_STEP = 1
/* Edit/write tool rows always open; the diff body and input/output sections are fixed-height viewports showing the latest N lines (user-tunable, 5-30, default 10), published as --dsh-ws-edit-lines, independent of the Think-card count. */
export const EDIT_LINES_DEFAULT = 10
export const EDIT_LINES_MIN = 5
export const EDIT_LINES_MAX = 30
export const EDIT_LINES_STEP = 1
/* Sidebar mind-map icon spin: speed multiplier over the 1.2 s base (default 1.2x = 1 s/rev; larger = faster, 0 = no rotation). */
export const MINDMAP_SPIN_BASE_DURATION_S = 1.2
export const MINDMAP_SPIN_SPEED_DEFAULT_X = 1.2
export const MINDMAP_SPIN_SPEED_MIN_X = 0
export const MINDMAP_SPIN_SPEED_MAX_X = 3
/* Speed 0 would divide by zero: freeze the spin with a huge duration instead. */
export const MINDMAP_SPIN_STOP_DURATION_S = 1e6
/* Fractional clamp: preserves 0.1-granular decimals, which the shared clamp() would round to integers. */
const clampSpinSpeed = (value) => {
  const speed = Number(value ?? MINDMAP_SPIN_SPEED_DEFAULT_X)
  const bounded = Number.isFinite(speed)
    ? Math.min(MINDMAP_SPIN_SPEED_MAX_X, Math.max(MINDMAP_SPIN_SPEED_MIN_X, speed))
    : MINDMAP_SPIN_SPEED_DEFAULT_X
  return Math.round(bounded * 10) / 10
}
/* Mount-edge S-curve bulge scale over the "slight" base curve: default ×5, 0 = straight chord; the max keeps the root→head swing inside the map's left margin. */
export const MINDMAP_MOUNT_BULGE_DEFAULT_X = 5
export const MINDMAP_MOUNT_BULGE_MIN_X = 0
export const MINDMAP_MOUNT_BULGE_MAX_X = 6
export const clampMountBulge = (value) => {
  const bulge = Number(value ?? MINDMAP_MOUNT_BULGE_DEFAULT_X)
  const bounded = Number.isFinite(bulge)
    ? Math.min(MINDMAP_MOUNT_BULGE_MAX_X, Math.max(MINDMAP_MOUNT_BULGE_MIN_X, bulge))
    : MINDMAP_MOUNT_BULGE_DEFAULT_X
  return Math.round(bounded * 10) / 10
}
export const EXPLORER_SETTINGS_STORE_KEY = 'dsh.workspace.studio.settings.v2'
/* Mind-map sidebar presentation, per workspace group (entry order) and per map root
   (last selected session): pure UI state, so both ride the same strict schema gate. */
export const MINDMAP_ORDER_STORE_KEY = 'dsh.workspace.studio.mindmap-order.v2'
export const MINDMAP_LAST_SESSION_STORE_KEY = 'dsh.workspace.studio.mindmap-last-session.v2'
/* Mind-map highlight colors (hover / selected): user hex or the harness theme default, published as --dsh-ws-mindmap-hover / --dsh-ws-mindmap-selected. */
export const MINDMAP_HOVER_THEME_VAR = '--dsw-alias-state-warn-primary'
export const MINDMAP_SELECTED_THEME_VAR = '--dsw-alias-state-business-primary'
export const MINDMAP_HOVER_COLOR_FALLBACK = '#f59e0b'
export const MINDMAP_SELECTED_COLOR_FALLBACK = '#4176e6'
/* Session-head card accent color, published as --dsh-ws-mindmap-head; defaults to violet #8b5cf6 — saturated enough to read as an identity card, and deliberately NOT one of the streaming-ring palette values (the old #a78bfa WAS the ring's third stop, so a streaming session's head card and its ring were the same color). */
export const MINDMAP_HEAD_COLOR_DEFAULT = '#8b5cf6'
/* End-of-branch card accent (border + wash + "末端" capsule), published as --dsh-ws-mindmap-end; defaults to #16a34a so the terminal-point meaning stays green while the 10px capsule keeps ~3:1 contrast on a LIGHT theme (the old #22c55e was ~2:1 there). */
export const MINDMAP_END_COLOR_DEFAULT = '#16a34a'
export const cssColorToHex = (color) => {
  if (typeof color !== 'string') return null
  const text = color.trim()
  const shortHex = text.match(/^#([0-9a-fA-F]{3,4})$/)
  if (shortHex !== null) {
    /* 3-digit #abc → #aabbcc; 4-digit #abcd → #aabbccdd (nibble doubling keeps the alpha channel). */
    const doubled = shortHex[1].split('').map(part => `${part}${part}`).join('').toLowerCase()
    return `#${doubled}`
  }
  if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(text)) {
    /* 8-digit #rrggbbaa keeps its alpha channel; slicing to 6 digits would drop the user's picked opacity. */
    return `#${text.slice(1).toLowerCase()}`
  }
  const rgb = text.match(/^rgba?\(\s*(-?[0-9.]+%?)(?:\s*,\s*|\s+)(-?[0-9.]+%?)(?:\s*,\s*|\s+)(-?[0-9.]+%?)(?:\s*(?:,|\/)\s*[^)]+)?\s*\)$/i)
  if (rgb === null) return null
  /* Percent components map to 255; negatives clamp to 0 (browsers clamp on parse). */
  const toChannel = value => {
    const isPercent = value.endsWith('%')
    const normalized = isPercent ? Number(value) * 255 / 100 : Number(value)
    return Math.max(0, Math.min(255, Math.round(normalized))).toString(16).padStart(2, '0')
  }
  return `#${toChannel(rgb[1])}${toChannel(rgb[2])}${toChannel(rgb[3])}`
}
const resolveCssColorToHex = (value) => {
  const direct = cssColorToHex(value)
  if (direct !== null) return direct
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || document.body === null || typeof value !== 'string') return null
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  probe.style.color = value
  if (probe.style.color === '') return null
  document.body.append(probe)
  try {
    return cssColorToHex(getComputedStyle(probe).color)
  } finally {
    probe.remove()
  }
}
export const mindmapEffectiveColor = (value, themeVar, fallback) => {
  const hex = resolveCssColorToHex(value)
  if (hex !== null) return hex
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function' && document.body !== null) {
    const resolved = getComputedStyle(document.body).getPropertyValue(themeVar).trim()
    const themeHex = resolveCssColorToHex(resolved)
    if (themeHex !== null) return themeHex
  }
  return fallback
}
export const EXPLORER_LAYOUT_STORE_KEY = 'dsh.workspace.studio.layout.v2'
/* Debounce (ms) before a dirty tab's draft is auto-saved; restores edits after refresh but never clears the dirty marker. */
export const AUTOSAVE_DELAY_MS = 1000
/* Above this many base lines, skip the three-way merge (Myers is O(N*D) worst case). */
export const MERGE_MAX_LINES = 20000
/* Bound aggregate Myers frontier cells so divergent files fall back to a whole-file conflict. */
export const MYERS_TRACE_CELL_LIMIT = 4_000_000
/* Mobile (phone-column) mode: a document-class gate drives every layout override; state is transient (reload returns to desktop). */
export const MOBILE_CLASS = 'dsh-ws-mobile-on'
export const MOBILE_DRAWER_CLASS = 'dsh-ws-mobile-drawer-open'
export const MOBILE_FILES_CLASS = 'dsh-ws-mobile-files-on'
export const MOBILE_HEADER_FALLBACK_H = 52
/* Mind-map conversation branching ("导图"): a docked preview tab rendering a persisted per-root-session document (session turn-chains + fork branches) left-to-right; branch sessions are hidden from the sidebar list. */
export const MINDMAP_NODE_W = 236
/* Card height fits the branch-title row, clamped two-line question, and status row. */
export const MINDMAP_NODE_H = 124
/* Virtual ROOT node (click creates a new top-level session) and per-session HEAD node (click switches to the session); both are layout-only, never persisted. */
export const MINDMAP_ROOT_W = 264
export const MINDMAP_ROOT_H = 64
export const MINDMAP_HEAD_W = 180
export const MINDMAP_HEAD_H = 124
export const MINDMAP_DEPTH_GAP = 64
export const MINDMAP_ROW_GAP = 12
export const MINDMAP_TEXT_MAX = 88
/* AI card summaries: the length is a SUGGESTION (prompt wording), not a hard bound; step 4 keeps the 48-char default on the slider grid. */
export const MINDMAP_SUMMARY_DEFAULT_LENGTH = 48
export const MINDMAP_SUMMARY_MIN_LENGTH = 20
export const MINDMAP_SUMMARY_MAX_LENGTH = 200
export const MINDMAP_SUMMARY_LENGTH_STEP = 4
/* Session-level summary length: a paragraph, so the range is wider than the card length; step 4 keeps the 64-char default on the slider grid. */
export const MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH = 64
export const MINDMAP_SUMMARY_SESSION_MIN_LENGTH = 20
export const MINDMAP_SUMMARY_SESSION_MAX_LENGTH = 500
export const MINDMAP_SUMMARY_SESSION_LENGTH_STEP = 4
export const MINDMAP_MODELS_CACHE_MS = 60_000
/* Mind-map viewport interaction bounds: wheel-zoom range, pan overhang, and wheel zoom step. */
export const MINDMAP_ZOOM_MIN = 0.25
export const MINDMAP_ZOOM_MAX = 3
export const MINDMAP_PAN_MARGIN = 48
/* Max fraction of the map draggable out of view per axis: 0.8 keeps at least 20% on screen. */
export const MINDMAP_PAN_OUT_MAX = 0.8
export const MINDMAP_WHEEL_STEP = 0.0016
/* Mind-map doc-index refresh interval; also bumped on every doc mutation, so the idle poll only catches external changes. */
export const MINDMAP_INDEX_REFRESH_MS = 30000
/* Re-sync the doc this often while the map is mounted so a completed branch turn folds in live. */
export const MINDMAP_SYNC_MS = 2500
/* Mind-map request timeouts. The generic 30 s request timeout is far below the
   Host's worst case: opening a map (or the first sync after the sync-cache TTL)
   reconciles the WHOLE family, and each cold member's log carries its parent's
   inherited prefix — measured 37 s for a 23-session / 35 MB family. Aborting
   there left the map stuck on 「加载失败：signal timed out」 instead of opening.
   These stay finite so a genuinely hung Host still surfaces an error. */
export const MINDMAP_LOAD_TIMEOUT_MS = 180_000
export const MINDMAP_SYNC_TIMEOUT_MS = 120_000
/* Show the "first open may take a while" hint once a load has been pending this long. */
export const MINDMAP_SLOW_LOAD_MS = 3000
/* Min interval between branch-hider scans: it observes every body mutation, so throttle to a bounded rate. */
export const MINDMAP_HIDER_THROTTLE_MS = 400
/* DeepSeek fish logo path (ui-primitives FishLogo); padded viewBox keeps the 1.4-wide stroke unclipped. */
export const FISH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

/* Encoding fallback mirroring the server's authoritative list so the menu and badge work before the fetch succeeds. */
export const ENCODING_FALLBACK = Object.freeze([
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-8-bom', label: 'UTF-8（带 BOM）' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
  { id: 'gbk', label: 'GBK' },
  { id: 'gb18030', label: 'GB18030' },
  { id: 'big5', label: 'Big5' },
  { id: 'shift_jis', label: 'Shift_JIS' },
  { id: 'euc-jp', label: 'EUC-JP' },
  { id: 'euc-kr', label: 'EUC-KR' },
  { id: 'iso-8859-1', label: 'ISO-8859-1（Latin-1）' },
  { id: 'windows-1252', label: 'Windows-1252' },
  { id: 'windows-1251', label: 'Windows-1251（西里尔）' },
  { id: 'ascii', label: 'ASCII' },
])
export const ENCODING_LABEL_FALLBACK = Object.fromEntries(ENCODING_FALLBACK.map(encoding => [encoding.id, encoding.label]))
/* In-memory (never persisted) file-content cache keyed per (workspace, path, encoding), surviving explorer remounts within one page load; capped by count and total bytes. */
export const FILE_CACHE_MAX_ENTRIES = 48
export const FILE_CACHE_MAX_BYTES = 12 * 1024 * 1024
export const FILE_CACHE_MAX_ENTRY_BYTES = 4 * 1024 * 1024
/* A fast activation serve skips its background change check only when the mount's poll confirmed the disk state equals the served content within this window. */
export const FILE_CACHE_REVALIDATE_SKIP_MS = 2 * AUTO_SYNC_CHECK_MS + 1000
/* Executable-file run console (preview column's lower half). The poll cadence is the console's
   liveness: the Host keeps the process and a bounded output ring buffer, the client asks for the
   slice past its own offset. Slow enough to be cheap on a quiet script, fast enough to read as live. */
export const RUN_POLL_MS = 400
/* Rendered output lines kept per file: a build log can be enormous, and the console is a tail.
   Older lines are dropped with a "…已省略 N 行" marker (the Host's byte ring drops independently). */
export const RUN_OUTPUT_LINE_MAX = 2000
/* Lower half's share of the preview body on first open, then whatever the user dragged. */
export const RUN_PANEL_RATIO_DEFAULT = 0.38
/* Neither half may be squeezed shut: the panel collapses explicitly (its header button), and the
   code pane must stay readable while the console is dragged open. */
export const RUN_PANEL_MIN_PX = 96
export const RUN_CODE_MIN_PX = 120
/* The editable tail of the command line; mirrors the Host's own bound. */
export const RUN_ARGS_MAX_LENGTH = 4096
/* Status polls are local and tiny: a hung one must not freeze the console behind the store's
   in-flight guard for the generic 30 s request timeout, so they get their own short budget. */
export const RUN_STATUS_TIMEOUT_MS = 8000
/* Follow-the-tail default: a console that stops scrolling mid-run reads as frozen. */
export const RUN_FOLLOW_DEFAULT = true
/* Interpreter configuration (settings page + console dialog). The bounds mirror the Host's own:
   a path is an absolute path or nothing, and the per-file map is capped there too. */
const RUN_INTERPRETER_PATH_MAX_LENGTH = 4096
export const RUN_FILE_OVERRIDE_MAX = 200
/* A version probe is one short-lived process; the request budget covers the Host's 5 s probe timeout
   plus IPC rounding, so a slow interpreter still answers instead of tripping the generic timeout. */
export const RUN_PROBE_TIMEOUT_MS = 5000
export const RUN_PROBE_OUTPUT_MAX = 4096
export const RUN_PROBE_REQUEST_TIMEOUT_MS = 9000
/* Byte cap on the read-only preview of a file OUTSIDE the workspace (read through
   the harness workspace-files Remote, page by page): past it the preview keeps
   what it read and reports itself truncated, like the Host's own preview cap. */
export const OUTSIDE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
/* Workspace collections (a named, ordered set of workspaces). The BUILT-IN views ("all workspaces",
   "unowned workspaces") are client constants and are never persisted; the Host store holds user
   collections only, so these bounds mirror host/collections.js (COLLECTIONS_MAX / COLLECTION_NAME_MAX). */
export const COLLECTION_ALL_ID = '__all__'
/** Built-in view: only workspaces that belong to no collection at all. */
export const COLLECTION_UNOWNED_ID = '__unowned__'
export const COLLECTION_LIMIT = 50
export const COLLECTION_NAME_MAX = 40
/* The harness's persisted workspace-browser view store (`dsh.workspace.view.v5`): its `groupBy`
   decides whether the collection dropdown and its filtering are active at all. Both the key and the
   field are a harness coupling point (dev-notes §47); an unreadable value falls back to the
   harness's own default, 'workspace'. */
export const WORKSPACE_VIEW_STORE_KEY = 'dsh.workspace.view.v5'
export const WORKSPACE_GROUP_BY_DEFAULT = 'workspace'