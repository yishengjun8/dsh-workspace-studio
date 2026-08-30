/* Shared module constants for the workspace-studio client. */
export const PACKAGE_ID = '@yishengjun8/dsh-workspace-studio'
export const API_PREFIX = '/workspace-studio/api'
export const EDITOR_CONTEXT_PROVIDER = 'workspace-editor-context'
export const SEND_SESSION_BRIDGE_MARKER = Symbol('workspace-studio.send-session-bridge')
/* Max 50 ms retries while a session's input binding is not ready (≈1 s total);
   a session whose binding never becomes ready must not spin a timer forever. */
export const ENSURE_RETRY_MAX = 20
export const PREVIEW_SESSION_STORE_KEY = 'dsh.workspace.studio.preview-sessions.v1'
export const PREVIEW_SESSION_MAX = 25
export const SIDEBAR_DEFAULT = 280, SIDEBAR_COLLAPSED = 56, SIDEBAR_MIN = 240, SIDEBAR_MAX_RATIO = 0.8, SIDEBAR_MAX_FALLBACK = 420
export const EXPLORER_MAX_RATIO = 0.8
export const TREE_DEFAULT = 280, TREE_MIN = 220, TREE_MAX = 520
export const PREVIEW_DEFAULT = 420, PREVIEW_MIN = 280, PREVIEW_MAX = 760, RESIZE_STEP = 12
export const CONTEXT_MENU_WIDTH = 176, CONTEXT_MENU_HEIGHT = 280, COMPACT_MENU_HEIGHT = 72
export const ROW_HEIGHT_DEFAULT = 20, ROW_HEIGHT_MIN = 12, ROW_HEIGHT_MAX = 36
/* Save-conflict dialog comparison text size (px); default matches .dsh-ws-conflict-code. */
export const CONFLICT_FONT_SIZE_DEFAULT = 12, CONFLICT_FONT_SIZE_MIN = 6, CONFLICT_FONT_SIZE_MAX = 24
/* Search-result rows expanded by default (user-tunable in explorer settings). */
export const SEARCH_MATCH_EXPAND_DEFAULT = true
/* File-browser pane sits on the right side of the conversation column instead of the left (user-tunable). */
export const PREVIEW_RIGHT_DEFAULT = false
/* Watch opened files for external changes and auto-sync the clean preview (user-tunable); polls this cadence when the host watch is unavailable. */
export const WATCH_FILES_DEFAULT = true
export const AUTO_SYNC_CHECK_MS = 2000
/* Backpressure for AUTO-mode reloads: after reloading a file, further
   external changes to the SAME path within this window only surface a status
   (no remount), so a continuously-written file (logs, build output) cannot
   remount the editor — and wipe its undo history — every single tick. */
export const AUTO_RELOAD_COOLDOWN_MS = 4000
/* "Auto" = a clean tab reloads on change; "watch-only" = only shows a "file changed" status and waits for the user's refresh. */
export const AUTO_SYNC_MODE_AUTO = 'auto'
export const AUTO_SYNC_MODE_WATCH_ONLY = 'watch-only'
/* Auto-open streaming Think disclosures and close them when done (user-tunable). */
export const AUTO_EXPAND_THINK_DEFAULT = true
/* Delay (s) before an auto-expanded Think disclosure collapses; user-tunable (0-10 s, 0.1 s steps), manual interaction cancels. */
export const THINK_COLLAPSE_DELAY_DEFAULT_S = 3
export const THINK_COLLAPSE_DELAY_MIN_S = 0
export const THINK_COLLAPSE_DELAY_MAX_S = 10
export const THINK_COLLAPSE_DELAY_STEP_S = 0.1
/* Sidebar mind-map icon spin: speed multiplier over the 0.8 s base (default 1.5x = 1.2 s/rev; larger = faster, 0 = no rotation). */
export const MINDMAP_SPIN_BASE_DURATION_S = 0.8
export const MINDMAP_SPIN_SPEED_DEFAULT_X = 1.5
export const MINDMAP_SPIN_SPEED_MIN_X = 0
export const MINDMAP_SPIN_SPEED_MAX_X = 3
/* Speed 0 would divide by zero: freeze the spin with a huge duration instead. */
export const MINDMAP_SPIN_STOP_DURATION_S = 1e6
/* Fractional clamp: preserves 0.1-granular decimals — the shared clamp() rounds to integers, snapping 1.1 back to 1 on the controlled input. */
export const clampSpinSpeed = (value) => {
  const speed = Number(value ?? MINDMAP_SPIN_SPEED_DEFAULT_X)
  const bounded = Number.isFinite(speed)
    ? Math.min(MINDMAP_SPIN_SPEED_MAX_X, Math.max(MINDMAP_SPIN_SPEED_MIN_X, speed))
    : MINDMAP_SPIN_SPEED_DEFAULT_X
  return Math.round(bounded * 10) / 10
}
/* Mount-edge S-curve bulge (root → head, parent card → nested head): scale over the "slight" base curve. Default ×5 (start-side up/outward bow + end-side left/up hook); 0 = straight chord. The max keeps the root→head left swing inside the map's left margin. */
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
export const EXPLORER_SETTINGS_STORE_KEY = 'dsh.workspace.studio.settings.v1'
/* Mind-map highlight colors (hover / selected): user hex, or unset = harness theme default. Resolved hexes feed the settings color picker and publish as document-wide --dsh-ws-mindmap-hover / --dsh-ws-mindmap-selected for the highlight CSS, so defaults stay theme-adaptive until overridden. */
export const MINDMAP_HOVER_THEME_VAR = '--dsw-alias-state-warn-primary'
export const MINDMAP_SELECTED_THEME_VAR = '--dsw-alias-state-business-primary'
export const MINDMAP_HOVER_COLOR_FALLBACK = '#f59e0b'
export const MINDMAP_SELECTED_COLOR_FALLBACK = '#4176e6'
/* Session-head card accent color (border + background wash + folder icon), published as the document-wide --dsh-ws-mindmap-head property (see applyMindmapColors). Defaults to violet #a78bfa to stay distinct from the blue root/selection and green "末端" chips; overridable in 设置 → 工作区设置 → 导图浏览设置. */
export const MINDMAP_HEAD_COLOR_DEFAULT = '#a78bfa'
/* End-of-branch card accent (whole-card tint: border + wash + "末端" capsule) for cards whose click jumps instead of forking; published as the document-wide --dsh-ws-mindmap-end property (see applyMindmapColors). Defaults to success green #22c55e — the capsule's color — so terminal-point meaning stays green; overridable in 设置 → 工作区设置 → 导图浏览设置. */
export const MINDMAP_END_COLOR_DEFAULT = '#22c55e'
export const cssColorToHex = (color) => {
  if (typeof color !== 'string') return null
  const text = color.trim()
  const shortHex = text.match(/^#([0-9a-fA-F]{3,4})$/)
  if (shortHex !== null) {
    /* 3-digit #abc → #aabbcc; 4-digit #abcd → #aabbccdd (nibble doubling
       keeps the alpha channel — slicing to 3 digits silently dropped it). */
    const doubled = shortHex[1].split('').map(part => `${part}${part}`).join('').toLowerCase()
    return `#${doubled}`
  }
  if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(text)) return `#${text.slice(1, 7).toLowerCase()}`
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
export const resolveCssColorToHex = (value) => {
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
export const EXPLORER_LAYOUT_STORE_KEY = 'dsh.workspace.studio.layout.v1'
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
/* Mind-map conversation branching ("导图"): a left-side floating window over everything except the chat column, rendering a persisted per-root-session document (a flat list of session turn-chains + fork branches) left-to-right. Branch sessions are ordinary forks hidden from the sidebar list. */
export const MINDMAP_NODE_W = 236
/* Card height fits the branch-title row, clamped two-line question, and status row. */
export const MINDMAP_NODE_H = 124
/* Virtual ROOT node (top hub: click creates a new top-level session) and per-session HEAD node (identity card at the left of its question chain; click switches to the session). Both are layout-only, never part of the persisted doc. */
export const MINDMAP_ROOT_W = 264
export const MINDMAP_ROOT_H = 64
export const MINDMAP_HEAD_W = 180
export const MINDMAP_HEAD_H = 124
export const MINDMAP_DEPTH_GAP = 64
export const MINDMAP_ROW_GAP = 12
export const MINDMAP_TEXT_MAX = 88
/* AI card summaries: the model picker + advisory length live in 设置 → 工作区设置 →
   导图浏览设置. The length is a SUGGESTION (prompt wording), not a hard bound.
   Step 4 keeps the 48-char default on the slider grid (a step of 10 would snap
   it to 50); the default is what the length row's 恢复默认 restores to. */
export const MINDMAP_SUMMARY_DEFAULT_LENGTH = 48
export const MINDMAP_SUMMARY_MIN_LENGTH = 20
export const MINDMAP_SUMMARY_MAX_LENGTH = 200
export const MINDMAP_SUMMARY_LENGTH_STEP = 4
/* Session-level summary length (右键会话头 → 总结当前会话): a paragraph, so the
   range is wider than the card length; step 4 keeps the 64-char default on the
   slider grid. */
export const MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH = 64
export const MINDMAP_SUMMARY_SESSION_MIN_LENGTH = 20
export const MINDMAP_SUMMARY_SESSION_MAX_LENGTH = 500
export const MINDMAP_SUMMARY_SESSION_LENGTH_STEP = 4
export const MINDMAP_MODELS_CACHE_MS = 60_000
/* Mind-map viewport interaction bounds: wheel-zoom range, pan overhang (MINDMAP_PAN_MARGIN, the margin the fit view aligns to), and wheel zoom step. */
export const MINDMAP_ZOOM_MIN = 0.25
export const MINDMAP_ZOOM_MAX = 3
export const MINDMAP_PAN_MARGIN = 48
/* Max fraction of the map (per axis, at current zoom) draggable out of view: 0.8 → at least 20% stays on screen; applies to grab-pan and wheel-zoom alike. */
export const MINDMAP_PAN_OUT_MAX = 0.8
export const MINDMAP_WHEEL_STEP = 0.0016
/* Mind-map doc-index refresh interval (sidebar panel + branch hider read it);
   also bumped on every doc mutation (markDirty refreshes immediately), so the
   idle poll only needs to catch external changes — 10 s keeps the constant
   background disk scan (Host reads every doc file per index) at half rate. */
export const MINDMAP_INDEX_REFRESH_MS = 10000
/* Re-sync the doc this often while the map is mounted, so a branch turn that completes in chat folds in live. */
export const MINDMAP_SYNC_MS = 2500
/* Min interval between branch-hider scans: it observes every body mutation (streaming included), so throttle to a bounded scan rate. */
export const MINDMAP_HIDER_THROTTLE_MS = 400
/* DeepSeek fish logo path (ui-primitives FishLogo); padded viewBox keeps the 1.4-wide stroke unclipped. */
export const FISH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

/* Encoding fallback mirroring the server's authoritative list (<API_PREFIX>/encodings), so the menu and badge work before (or without) the fetch succeeding. */
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