import React from 'react'
import { createPortal } from 'react-dom'
import { createSnapshotStore, defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, panels } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeSearchPanel, findNext, findPrevious, gotoLine, highlightSelectionMatches, openSearchPanel, search, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { bracketMatching, defaultHighlightStyle, foldable, foldEffect, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting, StreamLanguage, unfoldAll } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { php } from '@codemirror/lang-php'
import { go } from '@codemirror/lang-go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { clike } from '@codemirror/legacy-modes/mode/clike'

const { Fragment, createElement: h, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React
const PACKAGE_ID = '@yishengjun8/dsh-workspace-studio'
const API_PREFIX = '/workspace-studio/api'
const EDITOR_CONTEXT_PROVIDER = 'workspace-editor-context'
const SEND_SESSION_BRIDGE_MARKER = Symbol('workspace-studio.send-session-bridge')
const PREVIEW_SESSION_STORE_KEY = 'dsh.workspace.studio.preview-sessions.v1'
const PREVIEW_SESSION_MAX = 25
const SIDEBAR_DEFAULT = 280, SIDEBAR_COLLAPSED = 56, SIDEBAR_MIN = 240, SIDEBAR_MAX_RATIO = 0.8, SIDEBAR_MAX_FALLBACK = 420
const EXPLORER_MAX_RATIO = 0.8
const TREE_DEFAULT = 280, TREE_MIN = 220, TREE_MAX = 520
const PREVIEW_DEFAULT = 420, PREVIEW_MIN = 280, PREVIEW_MAX = 760, RESIZE_STEP = 12
const CONTEXT_MENU_WIDTH = 176, CONTEXT_MENU_HEIGHT = 280, COMPACT_MENU_HEIGHT = 72
const ROW_HEIGHT_DEFAULT = 20, ROW_HEIGHT_MIN = 12, ROW_HEIGHT_MAX = 36
const CHAT_FONT_SIZE_DEFAULT = 16, CHAT_FONT_SIZE_MIN = 13, CHAT_FONT_SIZE_MAX = 20
/* Save-conflict dialog comparison text size (px); default matches .dsh-ws-conflict-code. */
const CONFLICT_FONT_SIZE_DEFAULT = 12, CONFLICT_FONT_SIZE_MIN = 6, CONFLICT_FONT_SIZE_MAX = 24
/* Search-result rows expanded by default (user-tunable in explorer settings). */
const SEARCH_MATCH_EXPAND_DEFAULT = true
/* File-browser pane sits on the right side of the conversation column instead of the left (user-tunable). */
const PREVIEW_RIGHT_DEFAULT = false
/* Auto-open streaming Think disclosures and close them when done (user-tunable). */
const AUTO_EXPAND_THINK_DEFAULT = true
/* Delay (s) before an auto-expanded Think disclosure collapses; user-tunable (0-10 s, 0.1 s steps), manual interaction cancels. */
const THINK_COLLAPSE_DELAY_DEFAULT_S = 3
const THINK_COLLAPSE_DELAY_MIN_S = 0
const THINK_COLLAPSE_DELAY_MAX_S = 10
const THINK_COLLAPSE_DELAY_STEP_S = 0.1
/* Sidebar mind-map icon spin: speed multiplier over the 0.8 s base (default
   1.5x = 1.2 s per revolution; larger = faster, 0 = no rotation). */
const MINDMAP_SPIN_BASE_DURATION_S = 0.8
const MINDMAP_SPIN_SPEED_DEFAULT_X = 1.5
const MINDMAP_SPIN_SPEED_MIN_X = 0
const MINDMAP_SPIN_SPEED_MAX_X = 3
/* Speed 0 would divide by zero: freeze the spin with a huge duration instead. */
const MINDMAP_SPIN_STOP_DURATION_S = 1e6
/* Fractional clamp for the spin speed: preserves 0.1-granular decimals,
   unlike the shared clamp() which rounds to integers (the round-trip would
   snap 1.1 back to 1 on the controlled input). */
const clampSpinSpeed = (value) => {
  const speed = Number(value ?? MINDMAP_SPIN_SPEED_DEFAULT_X)
  const bounded = Number.isFinite(speed)
    ? Math.min(MINDMAP_SPIN_SPEED_MAX_X, Math.max(MINDMAP_SPIN_SPEED_MIN_X, speed))
    : MINDMAP_SPIN_SPEED_DEFAULT_X
  return Math.round(bounded * 10) / 10
}
/* Mount-edge S-curve bulge (root → top-level session head, parent card →
   nested session head): a scale factor over the "slight" base curve. Default
   ×5 is the shipped look (start-side up/outward bow + end-side left/up hook);
   0 collapses each mount edge to the straight chord. The max keeps the left
   swing of the root→head curve inside the map's left margin. */
const MINDMAP_MOUNT_BULGE_DEFAULT_X = 5
const MINDMAP_MOUNT_BULGE_MIN_X = 0
const MINDMAP_MOUNT_BULGE_MAX_X = 6
const clampMountBulge = (value) => {
  const bulge = Number(value ?? MINDMAP_MOUNT_BULGE_DEFAULT_X)
  const bounded = Number.isFinite(bulge)
    ? Math.min(MINDMAP_MOUNT_BULGE_MAX_X, Math.max(MINDMAP_MOUNT_BULGE_MIN_X, bulge))
    : MINDMAP_MOUNT_BULGE_DEFAULT_X
  return Math.round(bounded * 10) / 10
}
const EXPLORER_SETTINGS_STORE_KEY = 'dsh.workspace.studio.settings.v1'
/* Mind-map highlight colors (hover / selected): user-chosen hex, or unset
   (undefined) = the harness theme default. The theme CSS variables resolve to
   concrete hexes for the settings color picker; the effective values are
   published as document-wide custom properties (--dsh-ws-mindmap-hover /
   --dsh-ws-mindmap-selected) that the highlight CSS rules consume, so the
   defaults stay theme-adaptive (light/dark) until the user overrides them. */
const MINDMAP_HOVER_THEME_VAR = '--dsw-alias-state-warn-primary'
const MINDMAP_SELECTED_THEME_VAR = '--dsw-alias-state-business-primary'
const MINDMAP_HOVER_COLOR_FALLBACK = '#f59e0b'
const MINDMAP_SELECTED_COLOR_FALLBACK = '#4176e6'
/* Session-head card accent color: the identity tint of a session's head card
   (border + background wash + folder icon), published as the document-wide
   --dsh-ws-mindmap-head custom property (see the applyMindmapColors effect).
   Defaults to violet #a78bfa so the session identity is distinct from the
   primary-blue root/selection and the green "末端" chips; the user can
   override it in 设置 → 工作区设置 → 导图浏览设置. */
const MINDMAP_HEAD_COLOR_DEFAULT = '#a78bfa'
/* End-of-branch card accent color: the whole-card tint (border + background
   wash + the "末端" capsule) of a card whose click jumps (switch) instead of
   forking. Published as the document-wide --dsh-ws-mindmap-end custom
   property (see the applyMindmapColors effect). Defaults to the success
   green #22c55e — the capsule's current color — so the terminal-point meaning
   stays green; the user can override it in 设置 → 工作区设置 → 导图浏览设置. */
const MINDMAP_END_COLOR_DEFAULT = '#22c55e'
const cssColorToHex = (color) => {
  if (typeof color !== 'string') return null
  const text = color.trim()
  const shortHex = text.match(/^#([0-9a-fA-F]{3,4})$/)
  if (shortHex !== null) return `#${shortHex[1].slice(0, 3).split('').map(part => `${part}${part}`).join('').toLowerCase()}`
  if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(text)) return `#${text.slice(1, 7).toLowerCase()}`
  const rgb = text.match(/^rgba?\(\s*([0-9.]+)(?:\s*,\s*|\s+)([0-9.]+)(?:\s*,\s*|\s+)([0-9.]+)(?:\s*(?:,|\/)\s*[^)]+)?\s*\)$/i)
  if (rgb === null) return null
  const to2 = value => Math.max(0, Math.min(255, Math.round(Number(value)))).toString(16).padStart(2, '0')
  return `#${to2(rgb[1])}${to2(rgb[2])}${to2(rgb[3])}`
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
const mindmapEffectiveColor = (value, themeVar, fallback) => {
  const hex = resolveCssColorToHex(value)
  if (hex !== null) return hex
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function' && document.body !== null) {
    const resolved = getComputedStyle(document.body).getPropertyValue(themeVar).trim()
    const themeHex = resolveCssColorToHex(resolved)
    if (themeHex !== null) return themeHex
  }
  return fallback
}
const EXPLORER_LAYOUT_STORE_KEY = 'dsh.workspace.studio.layout.v1'
/* Debounce (ms) before a dirty tab's draft is auto-saved; restores edits after refresh but never clears the dirty marker. */
const AUTOSAVE_DELAY_MS = 1000
/* Above this many base lines, skip the three-way merge (Myers is O(N*D) worst case). */
const MERGE_MAX_LINES = 20000
/* Bound aggregate Myers frontier cells so divergent files fall back to a whole-file conflict. */
const MYERS_TRACE_CELL_LIMIT = 4_000_000
/* Mobile (phone-column) mode: a document-class gate drives every layout override; state is transient (reload returns to desktop). */
const MOBILE_CLASS = 'dsh-ws-mobile-on'
const MOBILE_DRAWER_CLASS = 'dsh-ws-mobile-drawer-open'
const MOBILE_FILES_CLASS = 'dsh-ws-mobile-files-on'
const MOBILE_HEADER_FALLBACK_H = 52
/* Mind-map conversation branching ("导图"): a left-side floating window over
   everything except the chat column, rendering a persisted per-root-session
   document (trunk from the root's full log + fork branches) left-to-right.
   Branch sessions are ordinary forks hidden from the sidebar session list. */
const MINDMAP_NODE_W = 236
/* Card height fits the branch-title row, clamped two-line question, and status row. */
const MINDMAP_NODE_H = 124
/* The virtual mind-map ROOT node (the map's top hub: clicking it creates a new
   top-level session) and the per-session HEAD node (a session's identity
   card at the left of its question chain; clicking it switches to the
   session). Both are layout-only nodes, never part of the persisted doc. */
const MINDMAP_ROOT_W = 264
const MINDMAP_ROOT_H = 64
const MINDMAP_HEAD_W = 180
const MINDMAP_HEAD_H = 124
const MINDMAP_DEPTH_GAP = 64
const MINDMAP_ROW_GAP = 12
const MINDMAP_TEXT_MAX = 88
/* Mind-map viewport interaction bounds: wheel-zoom range, the pan overhang
   (MINDMAP_PAN_MARGIN, the margin the fit view aligns to; the proportional
   clamp MINDMAP_PAN_OUT_MAX below), and the wheel zoom step. */
const MINDMAP_ZOOM_MIN = 0.25
const MINDMAP_ZOOM_MAX = 3
const MINDMAP_PAN_MARGIN = 48
/* Max fraction of the map (per axis, at the current zoom) draggable out of
   view: 0.8 → at least 20% stays on screen. Applies to grab-pan and wheel-zoom alike. */
const MINDMAP_PAN_OUT_MAX = 0.8
const MINDMAP_WHEEL_STEP = 0.0016
/* Mind-map doc-index refresh interval (sidebar panel + branch hider read it); also bumped on every doc mutation. */
const MINDMAP_INDEX_REFRESH_MS = 5000
/* Re-sync the doc this often while the map is mounted, so a branch turn that completes in chat folds in live. */
const MINDMAP_SYNC_MS = 2500
/* Min interval between branch-hider scans: it observes every body mutation (streaming included), so throttle to a bounded scan rate. */
const MINDMAP_HIDER_THROTTLE_MS = 400
/* DeepSeek fish logo path (ui-primitives FishLogo); padded viewBox keeps the 1.4-wide stroke unclipped. */
const FISH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

/* Encoding fallback mirroring the server's authoritative list (<API_PREFIX>/encodings),
   so the menu and badge work even before (or without) the fetch succeeding. */
const ENCODING_FALLBACK = Object.freeze([
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
const ENCODING_LABEL_FALLBACK = Object.fromEntries(ENCODING_FALLBACK.map(encoding => [encoding.id, encoding.label]))
let encodingCache = ENCODING_FALLBACK
/* Fetch the server's authoritative encoding list once; keep the fallback if the request fails. */
async function fetchEncodings() {
  try {
    const response = await fetch(`${API_PREFIX}/encodings`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' })
    if (!response.ok) return encodingCache
    const payload = await response.json()
    const list = Array.isArray(payload?.encodings)
      ? payload.encodings.filter(encoding => typeof encoding?.id === 'string' && typeof encoding?.label === 'string')
      : []
    if (list.length > 0) encodingCache = list
  } catch {
    // keep the built-in fallback
  }
  return encodingCache
}
function encodingLabel(id) {
  const localized = translate(`encoding.${id}`)
  if (localized !== `encoding.${id}`) return localized
  const found = encodingCache.find(encoding => encoding.id === id)
  if (found !== undefined) return found.label
  return ENCODING_LABEL_FALLBACK[id] ?? String(id ?? '')
}

/* ---- Locale support ---- Follows the harness language setting (Settings ->
   General -> Language, via dsh-client-locale): zh is the source of truth and
   en mirrors every key. All product copy goes through `translate`; render code
   re-subscribes through useLocaleText() so a language switch re-renders the
   UI. Without the locale service the plugin falls back to the zh dictionary. */
const EXPLORER_LOCALE_NS = 'workspace.studio'
const zh = {
  'nav.sessions': '会话列表',
  'nav.files': '文件浏览',
  'panel.workspaceFiles': '工作区文件',
  'panel.noWorkspace': '未选择工作区',
  'panel.chooseSession': '请选择一个工作区中的会话',
  'panel.filePreview': '文件预览',
  'panel.chooseWorkspaceToBrowse': '选择工作区后可浏览文件',
  'panel.previewHint': '在文件树中选择文件以预览内容',
  'tree.loading': '正在读取…',
  'tree.empty': '空目录',
  'tree.symlink': '（符号链接）',
  'tree.refresh': '刷新文件树',
  'search.toolbar': '搜索',
  'search.toolbar.title': '在工作区中搜索内容',
  'toolbar.newFolder.title': '在选中层级新建文件夹',
  'toolbar.newFile.title': '在选中层级新建文件',
  'context.copyName': '复制名称',
  'context.copyName.title': '复制此文件或文件夹的完整名称（含扩展名）',
  'context.copyPath': '复制路径',
  'context.copyPath.title': '复制文件的完整绝对路径',
  'context.copyRelative': '复制相对路径',
  'context.copyRelative.title': '复制相对工作区根目录的路径',
  'context.reveal': '在资源管理器中打开',
  'context.reveal.title': '在操作系统的文件管理器中打开此文件或文件夹',
  'context.rename': '重命名',
  'context.rename.title': '在当前位置重命名此文件或文件夹',
  'context.renameSession': '重命名',
  'context.archiveSession': '归档此会话',
  'context.copy': '复制',
  'context.copy.title': '复制此文件或文件夹',
  'context.paste': '粘贴',
  'context.paste.title': '粘贴到当前文件夹',
  'context.paste.titleEmpty': '剪贴板为空',
  'context.paste.titleForeign': '剪贴板来自其他工作区',
  'context.cut': '剪切',
  'context.cut.title': '剪切此文件或文件夹',
  'context.delete': '删除',
  'context.delete.title': '永久删除此文件或文件夹',
  'tab.pin': '固定标签',
  'tab.pin.title': '固定此标签页并移动到标签开头',
  'tab.unpin': '取消固定',
  'tab.unpin.title': '取消固定此标签页',
  'tab.closeOthers': '关闭其他标签页',
  'tab.closeOthers.title': '关闭除当前标签外的所有未固定标签页',
  'tab.close': '关闭标签',
  'tab.close.title': '保存或取消编辑后关闭',
  'tab.closeAria': '关闭 {name}',
  'tab.unpinAria': '取消固定 {name}',
  'tab.dirty': '未保存的更改',
  'tab.list': '文件预览标签',
  'dialog.close': '关闭',
  'dialog.cancel': '取消',
  'dialog.processing': '处理中…',
  'dialog.name': '名称',
  'dialog.sessionName': '会话名称',
  'dialog.rename': '重命名',
  'dialog.create': '创建',
  'dialog.newFolder': '新建文件夹',
  'dialog.newFile': '新建文件',
  'dialog.newFileDefault': '新建文件.txt',
  'dialog.renameSession': '重命名当前会话',
  'dialog.deleteTitle': '确认删除',
  'dialog.deleteMessage': '确定要永久删除“{name}”吗？此操作不可撤销。',
  'dialog.deleteDirtyWarning': '其中包含未保存内容的标签页，删除后无法恢复。',
  'dialog.deleteAction': '删除',
  'encoding.open': '以编码打开…',
  'encoding.save': '另存为编码…',
  'encoding.open.title': '用所选编码重新解码并展示此文件',
  'encoding.open.titleDirty': '有未保存的更改，请先保存或取消后再切换编码打开',
  'encoding.save.title': '将当前文件内容用所选编码写回磁盘',
  'encoding.save.titleReadonly': '该文件当前不能编辑，无法另存为编码',
  'encoding.dialog.open': '以编码打开',
  'encoding.dialog.save': '另存为编码',
  'encoding.dialog.openAction': '打开',
  'encoding.dialog.saveAction': '保存',
  'encoding.badge': '文件编码',
  'encoding.utf-8': 'UTF-8',
  'encoding.utf-8-bom': 'UTF-8（带 BOM）',
  'encoding.utf-16le': 'UTF-16 LE',
  'encoding.utf-16be': 'UTF-16 BE',
  'encoding.gbk': 'GBK',
  'encoding.gb18030': 'GB18030',
  'encoding.big5': 'Big5',
  'encoding.shift_jis': 'Shift_JIS',
  'encoding.euc-jp': 'EUC-JP',
  'encoding.euc-kr': 'EUC-KR',
  'encoding.iso-8859-1': 'ISO-8859-1（Latin-1）',
  'encoding.windows-1252': 'Windows-1252',
  'encoding.windows-1251': 'Windows-1251（西里尔）',
  'encoding.ascii': 'ASCII',
  'search.placeholder': '搜索工作区内容',
  'search.closeAria': '关闭搜索',
  'search.close.title': '关闭搜索，返回文件树',
  'search.caseSensitive': '当前区分大小写；点击切换为不区分',
  'search.caseInsensitive': '当前不区分大小写；点击切换为区分',
  'search.hint': '输入搜索内容，在当前工作区中查找',
  'search.searching': '正在搜索…',
  'search.noResults': '未找到匹配项',
  'search.noResultsFor': '没有找到与“{query}”匹配的内容',
  'search.summary': '{matches} 个匹配项 · {files} 个文件',
  'search.summaryTruncated': '（结果过多，仅显示部分）',
  'search.nameOnly': '仅搜索文件名称',
  'search.nameOnly.title': '匹配文件或文件夹的名称，不搜索文件内容',
  'search.summaryNameOnly': '找到 {files} 个匹配项',
  'search.partial': '部分',
  'search.partial.title': '文件较大，仅搜索了开头部分',
  'search.row.title': '{path} · 第 {line} 行',
  'editor.edit': '编辑',
  'editor.edit.title': '编辑文件',
  'editor.cannotEdit': '无法编辑：{reason}',
  'editor.entered': '已进入编辑模式；按 Ctrl/Cmd+S 保存。',
  'editor.save': '保存',
  'editor.cancel': '取消',
  'editor.saving': '保存中…',
  'editor.wrap': '自动换行',
  'editor.wrap.off.title': '关闭自动换行',
  'editor.wrap.on.title': '开启自动换行',
  'editor.refresh': '刷新',
  'editor.refresh.title': '从磁盘重新读取当前文件',
  'mdPreview.preview': '预览',
  'mdPreview.preview.title': '以渲染后的 Markdown 预览当前文件',
  'mdPreview.edit.title': '返回 Markdown 源码编辑',
  'editor.refreshBlocked': '存在未保存的更改，请先保存或取消后再刷新。',
  'editor.refreshed': '已从磁盘重新读取。',
  'editor.searchResize': '拖拽调整搜索框宽度',
  'editor.saved': '保存成功。',
  'editor.savingWith': '正在保存（{encoding}）…',
  'editor.savedAs': '已保存为 {encoding}。',
  'editor.saveConflict': '保存冲突：文件已在磁盘上被其他工具修改。草稿已保留，请重新读取或选择保留版本。',
  'editor.saveFailed': '保存失败：{message}。草稿已保留。',
  'editor.saveTypedDuringMerge': '已保存，但保存期间产生了新的输入，已保留在编辑器中，请再次保存。',
  'editor.saveAsFailed': '无法另存为编码：{reason}',
  'editor.cancelRestored': '已取消编辑，已从磁盘重新读取源文件。',
  'editor.cancelFailed': '取消失败：{message}。草稿已保留。',
  'editor.discardDraft': '丢弃草稿',
  'editor.discardDraft.title': '丢弃暂存草稿并从磁盘重新读取（该文件当前不可编辑）',
  'editor.autosaveFailed': '自动保存失败：{message}。草稿已保留。',
  'editor.saveCancelled': '已取消保存，仍可继续编辑。',
  'dialog.saveConflictTitle': '保存冲突',
  'dialog.saveConflictMessage': '文件在磁盘上已被其他工具修改，且修改位置与你的修改发生冲突。请选择保留哪个版本。',
  'dialog.saveConflictKeepMine': '保留我的版本',
  'dialog.saveConflictKeepTheirs': '保留磁盘版本',
  'dialog.saveConflictMine': '我的修改',
  'dialog.saveConflictTheirs': '磁盘版本',
  'dialog.saveConflictRegion': '冲突位置：第 {lines} 行',
  'dialog.saveConflictPrev': '上一处',
  'dialog.saveConflictMineFinal': '我的修改 · 实际代码',
  'dialog.saveConflictTheirsFinal': '磁盘版本 · 实际代码',
  'editor.unsavedTabClose': '此标签有未保存内容，请先保存或取消编辑。',
  'editor.unsavedTabsClose': '存在有未保存内容的标签，请先保存或取消编辑。',
  'editor.unsavedBlocked': '当前文件有未保存的更改，请先保存或取消编辑。',
  'editor.dirtyEncodingSwitch': '有未保存的更改，请先保存或取消后再切换编码打开。',
  'tree.refreshBlocked': '存在未保存的更改，已阻止刷新文件树。请先保存或取消编辑。',
  'editor.previewTruncated': '文件较大，当前仅显示开头部分，不能编辑。',
  'editor.notLoaded': '文件尚未加载',
  'editor.loading': '正在读取文件…',
  'status.copiedName': '已复制名称。',
  'status.copiedPath': '已复制完整路径。',
  'status.copiedRelative': '已复制相对路径。',
  'status.copyFailed': '复制失败。',
  'status.revealed': '已在资源管理器中打开。',
  'status.revealFailed': '打开失败：{message}',
  'status.revealNoWorkspace': '未找到该会话的工作区。',
  'status.archivedSession': '已归档会话。',
  'status.archivedSessions': '已归档 {n} 个会话。',
  'status.archiveFailed': '归档失败：{message}',
  'status.draftRestored': '已恢复此工作区中未保存的草稿。',
  'status.draftRestoredConflict': '磁盘文件已在草稿保存后更改。草稿已恢复；保存时将自动合并或提示选择。',
  'status.draftNotRestorable': '检测到未保存草稿，但文件当前不可编辑。草稿内容已展示；关闭标签或刷新后将丢弃，无法保存。',
  'status.externalOpened': '已打开外部文件 {name}。',
  'status.externalOpenedMany': '已打开 {count} 个外部文件。',
  'status.externalFailedMany': '{count} 个文件无法作为文本预览。',
  'status.folderNotPreviewable': '文件夹无法作为文本预览。',
  'status.createdFolder': '已新建文件夹。',
  'status.createdFile': '已新建文件。',
  'status.renamedFolder': '已重命名文件夹。',
  'status.renamedFile': '已重命名文件。',
  'status.copied': '已复制。',
  'status.cut': '已剪切。',
  'status.pasted': '已粘贴。',
  'status.moved': '已移动。',
  'status.movedDraftWarning': '文件已移动，但暂存盘草稿迁移失败，已尝试清理旧路径草稿。',
  'status.deleted': '已删除。',
  'status.cutFailed': '剪切失败：{message}',
  'status.pasteFailed': '粘贴失败：{message}',
  'status.deleteFailed': '删除失败：{message}',
  'entry.nameRequired': '请输入名称',
  'entry.nameInvalid': '名称只能是当前层级内的单个文件名',
  'entry.duplicate': '同级目录中已存在同名条目',
  'entry.nameUnchanged': '名称没有变化',
  'external.externalFile': '外部文件 · {name}',
  'external.externalFile.title': '外部文件（拖入）',
  'drop.closeAria': '关闭拖放提示',
  'drop.closeTitle': '关闭',
  'drop.releaseImages': '松开以添加图片',
  'drop.releaseFiles': '松开以打开外部文件',
  'resize.sidebar': '调整会话面板宽度',
  'resize.preview': '调整文件预览宽度',
  'settings.section.title': '工作区设置',
  'settings.group.browse': '文件浏览设置',
  'settings.group.content': '内容浏览设置',
  'settings.group.dialog': '对话页面设置',
  'settings.group.session': '会话浏览设置',
  'settings.group.mindmap': '导图浏览设置',
  'settings.mindmapHoverColor': '悬浮高亮颜色',
  'settings.mindmapHoverColor.reset.title': '恢复默认悬浮高亮颜色',
  'settings.mindmapSelectedColor': '选中高亮颜色',
  'settings.mindmapSelectedColor.reset.title': '恢复默认选中高亮颜色',
  'settings.mindmapHeadColor': '会话头卡片提示色',
  'settings.mindmapHeadColor.reset.title': '恢复默认会话头卡片提示色',
  'settings.mindmapEndColor': '末端卡片提示色',
  'settings.mindmapEndColor.reset.title': '恢复默认末端卡片提示色',
  'settings.mindmapMountBulge': '导图连线弯曲幅度',
  'settings.mindmapMountBulge.reset.title': '恢复默认弯曲幅度',
  'settings.mindmapSpinSpeed': '导图图标旋转速度',
  'settings.mindmapSpinSpeed.reset.title': '恢复默认旋转速度',
  'settings.rowHeight': '每行高度',
  'settings.rowHeight.reset.title': '恢复默认行高',
  'settings.searchResult': '搜索结果显示',
  'settings.expanded': '默认展开',
  'settings.collapsed': '默认折叠',
  'settings.fileColors': '文件图标颜色',
  'settings.fileColor.aria': '{label} 颜色',
  'settings.fileColor.reset.title': '恢复 {label} 的默认颜色',
  'settings.reset': '重置',
  'settings.resetAllColors': '恢复全部默认颜色',
  'settings.presets': '代码高亮预设',
  'settings.preset.aria': '{label} 高亮预设',
  'settings.preset.reset.title': '恢复 {label} 的默认高亮预设',
  'settings.resetAllPresets': '恢复全部默认预设',
  'settings.chatFont': '对话文字大小',
  'settings.chatFont.reset.title': '恢复默认字号',
  'settings.conflictFontSize': '冲突弹窗对比字号',
  'settings.conflictFontSize.reset.title': '恢复默认字号',
  'settings.autoExpandThink': '思考过程自动展开',
  'settings.thinkDelay': '思考收起延迟',
  'settings.thinkDelay.reset.title': '恢复默认收起延迟',
  'settings.previewRight': '文件浏览页面显示在右侧',
  'settings.resetDefault': '恢复默认',
  'settings.hint': '会话浏览设置：调整侧栏导图条目流式输出时旋转图标的速度（倍速 0.0×–3.0×，数值越大越快，默认 1.5× 即 1.2 秒一圈，0 表示不旋转）；导图浏览设置：调整导图视图中悬浮高亮与选中高亮的颜色（默认分别为琥珀与主题蓝，可分别恢复默认），以及导图挂载连线的弯曲幅度（根节点→会话头、分支提问卡→分支会话头的 S 曲线，默认 5.0×，数值越大弯得越明显，0 为直线）；文件浏览设置：调整左侧文件树的行高、搜索结果显示方式与图标徽标配色；内容浏览设置：为每种文件类型选择编辑器代码高亮预设、调整保存冲突弹窗中对比文本的字号、并可选择是否将文件浏览页面显示在对话页面的右侧；对话页面设置：调整对话文字大小，开启思考过程自动展开后，聊天中正在输出的思考内容会自动展开、结束后按设定延迟自动收起（0–10 秒，分度 0.1 秒），期间手动操作可取消；未修改的项使用默认值。',
  'fileColor.directory': '目录',
  'fileColor.style': '样式',
  'fileColor.log': '日志',
  'fileColor.config': '配置文件',
  'fileColor.other': '其他',
  'fileColor.blocked': '受阻',
  'preset.default': '默认',
  'preset.classic': '经典',
  'preset.warm': '暖色',
  'preset.cool': '冷色',
  'preset.mono': '单色',
  'preset.vscode-config': '配置（VS Code）',
  'preset.vscode-xml': 'XML（VS Code）',
  'preset.vscode-python': 'Python（VS Code）',
  'preset.vscode-json': 'JSON（VS Code）',
  'preset.vscode-typescript': 'TypeScript（VS Code）',
  'preset.vscode-javascript': 'JavaScript（VS Code）',
  'preset.vscode-css': 'CSS（VS Code）',
  'preset.vscode-markdown': 'Markdown（VS Code）',
  'preset.vscode-shell': 'Shell（VS Code）',
  'preset.vscode-cpp': 'C/C++（VS Code）',
  'preset.vscode-csharp': 'C#（VS Code）',
  'preset.vs2022': 'Visual Studio 2022',
  'readonly.binary': '文件不是可编辑的文本文件',
  'readonly.encoding': '文件编码不支持编辑',
  'readonly.too_large': '文件过大，不能编辑',
  'readonly.file-too-large': '文件超过可编辑大小限制',
  'readonly.truncated': '文件内容已截断',
  'readonly.mixed_line_endings': '文件包含混合换行符，不能安全编辑',
  'readonly.permission': '当前工作区没有写入权限',
  'readonly.readonly': '此文件为只读',
  'readonly.editing-disabled': '当前配置未启用文件编辑',
  'readonly.symlink-path': '符号链接路径仅允许浏览',
  'readonly.external-file': '外部文件仅支持浏览',
  'readonly.fallback': '此文件当前不能编辑',
  'context.symlinkError': '符号链接文件不能加入此次对话上下文。',
  'context.tooLarge': '选中文本为 {size}，超过 {limit} 的上下文上限。',
  'context.canceled': '编辑器上下文发送已取消',
  'context.active': '此次发送将包含文件上下文：{path}。点击停用。',
  'context.inactive': '此次发送不包含文件上下文：{path}。点击重新启用。',
  'error.invalid-request': '请求参数无效',
  'error.invalid-path': '文件路径无效',
  'error.path-not-found': '文件或目录不存在',
  'error.path-outside-workspace': '拒绝访问工作区之外的路径',
  'error.wsl-translate-failed': '无法将路径转换为 Windows 路径',
  'error.unsupported-platform': '当前系统没有可用的桌面文件管理器',
  'error.reveal-failed': '无法在资源管理器中打开该路径',
  'error.entry-name-too-large': '条目名称过长',
  'error.not-a-directory': '所选路径不是目录',
  'error.unsupported-encoding': '不支持的编码格式',
  'error.not-a-file': '所选路径不是普通文件',
  'error.binary-file': '该文件包含二进制内容，无法进行文本预览',
  'error.invalid-encoding': '文件不是所选编码的有效文本，无法预览',
  'error.invalid-content-type': '请求内容类型无效',
  'error.empty-file': '文件内容为空',
  'error.editing-disabled': '当前未启用文件编辑',
  'error.revision-required': '保存请求必须提供有效的修订版本',
  'error.invalid-content-length': 'Content-Length 必须是有效的非负整数',
  'error.file-too-large': '保存内容超过可编辑大小限制',
  'error.content-length-mismatch': '请求正文长度与 Content-Length 不一致',
  'error.invalid-text': '保存内容必须是无二进制数据的有效 UTF-8 文本',
  'error.symlink-write-denied': '拒绝通过符号链接写入文件',
  'error.file-conflict': '文件已被修改，请重新加载后再保存',
  'error.request-too-large': '请求正文过大',
  'error.invalid-json': '请求正文必须是有效的 JSON',
  'error.invalid-kind': '只能新建文件或文件夹',
  'error.entry-exists': '同名文件或文件夹已存在',
  'error.invalid-entry-kind': '只能重命名文件或文件夹',
  'error.invalid-context': '编辑器上下文无效',
  'error.context-coordinate-mismatch': '选区与文件内容不一致',
  'error.context-revision-required': '未修改的选区必须携带文件修订版本',
  'error.context-too-large': '选中文本超过上下文大小上限',
  'error.context-symlink-denied': '符号链接文件不能加入对话上下文',
  'error.context-source-too-large': '上下文源文件超过大小上限',
  'error.context-file-changed': '上下文文件在发送期间发生变化',
  'error.context-revision-conflict': '文件已变化，请重新选择上下文后再发送',
  'error.context-content-mismatch': '选中文本与当前文件内容不一致',
  'error.context-session-denied': '当前会话不属于所选工作区',
  'error.workspace-not-found': '当前工作区不存在',
  'error.path-denied': '没有权限访问该路径',
  'error.workspace-operation-failed': '工作区操作失败',
  'error.request-not-trusted': '请求来源未获授权',
  'error.method-not-allowed': '该接口不允许此请求方法',
  'error.endpoint-not-found': '接口不存在',
  'error.invalid-query': '搜索内容不能包含换行或控制字符',
  'error.query-too-long': '搜索内容过长',
  'error.invalid-response': '接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.tree': '工作区接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.save': '保存接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.external': '外部文件接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.context': '编辑器上下文接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.entry': '工作区修改接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.fs': '文件操作接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.search': '搜索接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.reveal': '在资源管理器中打开接口返回了无效响应（HTTP {status}）',
  'error.invalid-response.context-text': '编辑器上下文接口缺少文本结果',
  'error.invalid-response.draft': '暂存盘接口返回了无效响应（HTTP {status}）',
  'error.draft-failed': '暂存盘操作失败（HTTP {status}）',
  'error.request-failed': '读取工作区失败（HTTP {status}）',
  'error.save-failed': '保存文件失败（HTTP {status}）',
  'error.external-file-failed': '打开外部文件失败（HTTP {status}）',
  'error.context-failed': '无法提交编辑器上下文（HTTP {status}）',
  'error.entry-failed': '工作区修改失败（HTTP {status}）',
  'error.fs-failed': '文件操作失败（HTTP {status}）',
  'error.invalid-action': '不支持的操作',
  'error.invalid-target': '不能复制到自身或其子目录',
  'error.search-failed': '搜索失败（HTTP {status}）',
  'error.reveal-failed.http': '在资源管理器中打开失败（HTTP {status}）',
  'init.menu.description': '生成或更新工作区根目录的 AGENTS.md（类似 Claude Code 的 /init）',
  'init.option.generate': '生成 AGENTS.md',
  'init.option.update': '更新 AGENTS.md',
  'init.option.generate.detail': '由当前 Agent 分析工作区后生成，目标：{root}',
  'init.option.update.detail': '保留现有内容，由当前 Agent 分析工作区后合并更新，目标：{root}',
  'init.error.no-workspace': '无法确定当前会话所属的工作区，无法执行 /init',
  'init.error.send-failed': '发送 /init 指令失败：{message}',
  'init.prompt': '为当前工作区生成（或更新）根目录的 AGENTS.md 文档。\n\n工作区根目录：{root}\n\n要求：\n1. 先分析该工作区的项目背景：README、构建与依赖清单（如 package.json / pyproject.toml / Cargo.toml / go.mod 等）、源码目录结构与主要语言。\n2. 在根目录生成 AGENTS.md，内容应包含：项目简介、常用命令（构建 / 测试 / 检查 / 运行）、技术栈、目录结构、代码与协作约定。\n3. AGENTS.md 应当语言精炼准确，只保留必要内容；复杂的逻辑（如架构设计、数据流、模块说明、事故复盘等）不要写进 AGENTS.md，而是新建 docs 文件夹，将复杂逻辑整理成 Markdown 文档写入 docs 文件夹，并在 AGENTS.md 中引用这些文档。\n4. 若 AGENTS.md 已存在：保留其中有价值的内容，在此基础上合并更新，不要盲目覆盖。\n5. 文档语言与项目现有文档保持一致（中文项目用中文，英文项目用英文）。\n6. 完成后简要说明生成或更新了哪些内容。',
  'mobile.toggle': '手机模式',
  'mobile.sidebarOpen': '展开侧栏',
  'mobile.sidebarClose': '收起侧栏',
  'mobile.files': '文件内容浏览',
  'view.mindmap': '导图',
  'mindmap.overlay.close': '关闭导图悬浮窗',
  'mindmap.rootLabel': '导图',
  'mindmap.current': '当前',
  'mindmap.pending': '等待新问题…',
  'mindmap.streaming': '生成中…',
  'mindmap.streaming.click': '查看生成中的会话',
  'mindmap.thinking': '正在思考…',
  'mindmap.done': '已完成',
  'mindmap.emptyRound': '（本轮无文本）',
  'mindmap.open.hint': '从这张卡片创建分支并继续对话',
  'mindmap.rootNode': '导图根节点',
  'mindmap.rootNode.hint': '点击创建新会话分支',
  'mindmap.session.empty': '空会话',
  'mindmap.session.waiting': '等待新问题',
  'mindmap.session.untitled': '未命名会话',
  'mindmap.hint.new': '点击新建会话',
  'mindmap.hint.fork': '点击分支',
  'mindmap.hint.switch': '点击跳转',
  'mindmap.empty': '该会话还没有可展示的内容。点击上方的「导图根节点」即可创建新的空会话分支，或在任意会话中完成一轮对话后再打开导图。',
  'mindmap.loading': '正在加载导图会话…',
  'mindmap.error': '加载导图会话失败：{message}',
  'mindmap.forkFailed': '创建分支失败：{message}',
  'mindmap.created': '已创建导图会话。',
  'mindmap.forked': '已在此处创建分支。',
  'mindmap.sessionCreated': '已创建新的空会话分支。',
  'mindmap.branchTag': '分支',
  'mindmap.endTag': '末端',
  'mindmap.turnTag': '第 {n} 轮',
  'mindmap.rounds': '{n} 轮',
  'mindmap.moreRounds': '还有 {n} 轮历史',
  'mindmap.menu.rename': '重命名',
  'mindmap.menu.archiveAll': '归档整个导图',
  'mindmap.menu.archiveBranch': '归档本会话及其分支',
  'mindmap.rename.title': '重命名',
  'mindmap.archiveAll.message': '确定归档整个导图「{name}」吗？其所有会话分支也将一并归档并从列表中移除。',
  'mindmap.archive.action': '归档',
  'mindmap.archivedAll': '已归档整个导图。',
  'mindmap.archiveBranch.title': '归档会话',
  'mindmap.archiveBranch.message': '确定归档会话「{name}」及其全部分支吗？归档后将从导图移除（当前无恢复入口）。',
  'mindmap.archiveBranch.action': '归档',
  'mindmap.branchArchived': '已归档该会话及其分支。',
  'mindmap.workspace.title': '选择工作区（新建会话归属）',
  'mindmap.workspace.none': '未分组（不指定工作区）',
  'mindmap.workspace.set': '新建会话的工作区已切换为「{name}」。',
  'mindmap.workspace.cleared': '新建会话不再指定工作区。',
  'mindmap.renamed': '已重命名。',
  'mindmap.menu.deleteCard': '删除卡片',
  'mindmap.delete.title': '删除卡片',
  'mindmap.delete.message': '确定删除卡片「{name}」吗？将从这里截断：该卡片及之后的内容、挂在其下的所有会话都会被移除，原会话将被归档（当前无恢复入口）。',
  'mindmap.delete.action': '删除',
  'mindmap.delete.current': '当前会话将被归档，删除后将自动切换到截断后的新会话。',
  'mindmap.delete.lastSession': '导图至少需要保留一个会话，请改为归档整个导图。',
  'mindmap.delete.missing': '找不到要删除的卡片，文档可能已变化，请重试。',
  'mindmap.deleted': '已删除卡片及其派生内容。',
  'mindmap.truncated': '已截断会话并归档原会话。',
  'mindmap.view.restore': '还原视图',
  'mindmap.view.restoreTitle': '将视图大小与位置还原',
  'mindmap.scope.full': '当前填充模式：全部',
  'mindmap.scope.sidebar': '当前填充模式：仅侧栏',
  'mindmap.scope.full.right': '当前填充模式：填充右侧',
  'mindmap.scope.sidebar.right': '当前填充模式：填充左侧',
  'mindmap.scope.title': '切换导图范围：填充（侧边栏 + 文件浏览） / 仅侧边栏',
  'mindmap.scope.title.right': '切换导图范围：填充左侧（侧边栏） / 填充右侧（文件浏览）',
  'mindmap.noticeFailed': '操作失败：{message}',
  'mindmap.sidebar.empty': '还没有导图会话。点击会话的「导图」标签即可创建。',
  'mindmap.sidebar.branches': '{n} 个分支',
  'mindmap.sidebar.open': '打开导图会话',
  'mindmap.sidebar.renameTitle': '重命名导图会话',
  'mindmap.confirm.title': '创建导图会话',
  'mindmap.confirm.message': '将当前会话转换为导图会话，并从左侧会话列表隐藏。确定转换吗？',
  'mindmap.confirm.action': '转换',
  'switcher.aria': '切换会话',
  'switcher.trigger.title': '点击切换会话',
  'switcher.subagent': '子代理',
  'switcher.noSessions': '暂无其他会话',
}
const en = {
  'nav.sessions': 'Sessions',
  'nav.files': 'File Explorer',
  'panel.workspaceFiles': 'Workspace Files',
  'panel.noWorkspace': 'No workspace selected',
  'panel.chooseSession': 'Select a session in a workspace',
  'panel.filePreview': 'File Preview',
  'panel.chooseWorkspaceToBrowse': 'Choose a workspace to browse files',
  'panel.previewHint': 'Select a file in the tree to preview it',
  'tree.loading': 'Loading…',
  'tree.empty': 'Empty',
  'tree.symlink': ' (symlink)',
  'tree.refresh': 'Refresh',
  'search.toolbar': 'Search',
  'search.toolbar.title': 'Search the workspace',
  'toolbar.newFolder.title': 'Create a folder in the selected level',
  'toolbar.newFile.title': 'Create a file in the selected level',
  'context.copyName': 'Copy Name',
  'context.copyName.title': 'Copy the full name of this file or folder (including the extension)',
  'context.copyPath': 'Copy Path',
  'context.copyPath.title': 'Copy the full absolute path of the file',
  'context.copyRelative': 'Copy Relative Path',
  'context.copyRelative.title': 'Copy the path relative to the workspace root',
  'context.reveal': 'Reveal in Explorer',
  'context.reveal.title': 'Open this file or folder in the operating system\'s file manager',
  'context.rename': 'Rename',
  'context.rename.title': 'Rename this file or folder in place',
  'context.renameSession': 'Rename',
  'context.archiveSession': 'Archive This Session',
  'context.copy': 'Copy',
  'context.copy.title': 'Copy this file or folder',
  'context.paste': 'Paste',
  'context.paste.title': 'Paste into the current folder',
  'context.paste.titleEmpty': 'The clipboard is empty',
  'context.paste.titleForeign': 'The clipboard belongs to another workspace',
  'context.cut': 'Cut',
  'context.cut.title': 'Cut this file or folder',
  'context.delete': 'Delete',
  'context.delete.title': 'Permanently delete this file or folder',
  'tab.pin': 'Pin Tab',
  'tab.pin.title': 'Pin this tab and move it to the front',
  'tab.unpin': 'Unpin',
  'tab.unpin.title': 'Unpin this tab',
  'tab.closeOthers': 'Close Other Tabs',
  'tab.closeOthers.title': 'Close all unpinned tabs except the current one',
  'tab.close': 'Close Tab',
  'tab.close.title': 'Close after saving or canceling edits',
  'tab.closeAria': 'Close {name}',
  'tab.unpinAria': 'Unpin {name}',
  'tab.dirty': 'Unsaved changes',
  'tab.list': 'File preview tabs',
  'dialog.close': 'Close',
  'dialog.cancel': 'Cancel',
  'dialog.processing': 'Processing…',
  'dialog.name': 'Name',
  'dialog.sessionName': 'Session name',
  'dialog.rename': 'Rename',
  'dialog.create': 'Create',
  'dialog.newFolder': 'New Folder',
  'dialog.newFile': 'New File',
  'dialog.newFileDefault': 'New File.txt',
  'dialog.renameSession': 'Rename Current Session',
  'dialog.deleteTitle': 'Confirm Delete',
  'dialog.deleteMessage': 'Permanently delete “{name}”? This cannot be undone.',
  'dialog.deleteDirtyWarning': 'Tabs with unsaved content will be closed and cannot be recovered.',
  'dialog.deleteAction': 'Delete',
  'encoding.open': 'Open With Encoding…',
  'encoding.save': 'Save As Encoding…',
  'encoding.open.title': 'Re-decode and display this file with the selected encoding',
  'encoding.open.titleDirty': 'You have unsaved changes; save or cancel before switching the encoding',
  'encoding.save.title': 'Write the current file content back to disk with the selected encoding',
  'encoding.save.titleReadonly': 'This file cannot be edited, so it cannot be saved with another encoding',
  'encoding.dialog.open': 'Open With Encoding',
  'encoding.dialog.save': 'Save As Encoding',
  'encoding.dialog.openAction': 'Open',
  'encoding.dialog.saveAction': 'Save',
  'encoding.badge': 'File encoding',
  'encoding.utf-8': 'UTF-8',
  'encoding.utf-8-bom': 'UTF-8 (with BOM)',
  'encoding.utf-16le': 'UTF-16 LE',
  'encoding.utf-16be': 'UTF-16 BE',
  'encoding.gbk': 'GBK',
  'encoding.gb18030': 'GB18030',
  'encoding.big5': 'Big5',
  'encoding.shift_jis': 'Shift_JIS',
  'encoding.euc-jp': 'EUC-JP',
  'encoding.euc-kr': 'EUC-KR',
  'encoding.iso-8859-1': 'ISO-8859-1 (Latin-1)',
  'encoding.windows-1252': 'Windows-1252',
  'encoding.windows-1251': 'Windows-1251 (Cyrillic)',
  'encoding.ascii': 'ASCII',
  'search.placeholder': 'Search workspace',
  'search.closeAria': 'Close search',
  'search.close.title': 'Close search and return to the file tree',
  'search.caseSensitive': 'Case-sensitive; click to make it case-insensitive',
  'search.caseInsensitive': 'Case-insensitive; click to make it case-sensitive',
  'search.hint': 'Enter text to search the current workspace',
  'search.searching': 'Searching…',
  'search.noResults': 'No matches found',
  'search.noResultsFor': 'No matches found for “{query}”',
  'search.summary': '{matches} matches · {files} files',
  'search.summaryTruncated': ' (too many results; only some are shown)',
  'search.nameOnly': 'File names only',
  'search.nameOnly.title': 'Match file or folder names only; do not search file contents',
  'search.summaryNameOnly': '{files} matches found',
  'search.partial': 'Partial',
  'search.partial.title': 'The file is large; only the beginning was searched',
  'search.row.title': '{path} · line {line}',
  'editor.edit': 'Edit',
  'editor.edit.title': 'Edit file',
  'editor.cannotEdit': 'Cannot edit: {reason}',
  'editor.entered': 'Edit mode: press Ctrl/Cmd+S to save.',
  'editor.save': 'Save',
  'editor.cancel': 'Cancel',
  'editor.saving': 'Saving…',
  'editor.wrap': 'Word Wrap',
  'editor.wrap.off.title': 'Disable word wrap',
  'editor.wrap.on.title': 'Enable word wrap',
  'editor.refresh': 'Reload',
  'editor.refresh.title': 'Reload the current file from disk',
  'mdPreview.preview': 'Preview',
  'mdPreview.preview.title': 'View the current file as rendered Markdown',
  'mdPreview.edit.title': 'Back to Markdown source editing',
  'editor.refreshBlocked': 'There are unsaved changes; save or cancel them before reloading.',
  'editor.refreshed': 'Reloaded from disk.',
  'editor.searchResize': 'Drag to resize the search box width',
  'editor.saved': 'Saved.',
  'editor.savingWith': 'Saving ({encoding})…',
  'editor.savedAs': 'Saved as {encoding}.',
  'editor.saveConflict': 'Save conflict: the file was changed on disk by another tool. Your draft was kept; reload or pick which version to keep.',
  'editor.saveFailed': 'Save failed: {message}. Your draft was kept.',
  'editor.saveTypedDuringMerge': 'Saved, but new input arrived during the merge; it was kept in the editor — save again.',
  'editor.saveAsFailed': 'Cannot save as encoding: {reason}',
  'editor.cancelRestored': 'Edit canceled; reloaded the source file from disk.',
  'editor.cancelFailed': 'Cancel failed: {message}. Your draft was kept.',
  'editor.discardDraft': 'Discard draft',
  'editor.discardDraft.title': 'Discard the staging draft and reload from disk (this file is not currently editable)',
  'editor.autosaveFailed': 'Auto-save failed: {message}. Your draft was kept.',
  'editor.saveCancelled': 'Save canceled; you can keep editing.',
  'dialog.saveConflictTitle': 'Save Conflict',
  'dialog.saveConflictMessage': 'The file was changed on disk by another tool, and the changes overlap your edits. Choose which version to keep.',
  'dialog.saveConflictKeepMine': 'Keep my version',
  'dialog.saveConflictKeepTheirs': 'Keep disk version',
  'dialog.saveConflictMine': 'My changes',
  'dialog.saveConflictTheirs': 'Disk version',
  'dialog.saveConflictRegion': 'Conflict at line(s) {lines}',
  'dialog.saveConflictPrev': 'Previous',
  'dialog.saveConflictMineFinal': 'My changes · final code',
  'dialog.saveConflictTheirsFinal': 'Disk version · final code',
  'editor.unsavedTabClose': 'This tab has unsaved content; save or cancel editing first.',
  'editor.unsavedTabsClose': 'Some tabs have unsaved content; save or cancel editing first.',
  'editor.unsavedBlocked': 'The current file has unsaved changes; save or cancel editing first.',
  'editor.dirtyEncodingSwitch': 'You have unsaved changes; save or cancel before switching the encoding.',
  'tree.refreshBlocked': 'Unsaved changes block the file-tree refresh; save or cancel editing first.',
  'editor.previewTruncated': 'The file is large; only the beginning is shown and it cannot be edited.',
  'editor.notLoaded': 'File not yet loaded',
  'editor.loading': 'Loading file…',
  'status.copiedName': 'Name copied.',
  'status.copiedPath': 'Full path copied.',
  'status.copiedRelative': 'Relative path copied.',
  'status.copyFailed': 'Copy failed.',
  'status.revealed': 'Revealed in Explorer.',
  'status.revealFailed': 'Open failed: {message}',
  'status.revealNoWorkspace': 'No workspace found for this session.',
  'status.archivedSession': 'Session archived.',
  'status.archivedSessions': 'Archived {n} sessions.',
  'status.archiveFailed': 'Archive failed: {message}',
  'status.draftRestored': 'Restored unsaved drafts for this workspace.',
  'status.draftRestoredConflict': 'The file changed on disk after your draft was saved. The draft was restored; saving will merge or ask you to choose.',
  'status.draftNotRestorable': 'Unsaved draft detected, but the file is not editable right now. The draft is shown; it will be discarded on tab close or refresh and cannot be saved.',
  'status.externalOpened': 'Opened external file {name}.',
  'status.externalOpenedMany': 'Opened {count} external files.',
  'status.externalFailedMany': '{count} files cannot be previewed as text.',
  'status.folderNotPreviewable': 'Folders cannot be previewed as text.',
  'status.createdFolder': 'Folder created.',
  'status.createdFile': 'File created.',
  'status.renamedFolder': 'Folder renamed.',
  'status.renamedFile': 'File renamed.',
  'status.copied': 'Copied.',
  'status.cut': 'Cut.',
  'status.pasted': 'Pasted.',
  'status.moved': 'Moved.',
  'status.movedDraftWarning': 'Files moved, but the staging-draft migration failed; old-path drafts were cleaned up best-effort.',
  'status.deleted': 'Deleted.',
  'status.cutFailed': 'Cut failed: {message}',
  'status.pasteFailed': 'Paste failed: {message}',
  'status.deleteFailed': 'Delete failed: {message}',
  'entry.nameRequired': 'Enter a name',
  'entry.nameInvalid': 'The name must be a single file name in the current level',
  'entry.duplicate': 'An entry with the same name already exists in this directory',
  'entry.nameUnchanged': 'The name is unchanged',
  'external.externalFile': 'External file · {name}',
  'external.externalFile.title': 'External file (dropped in)',
  'drop.closeAria': 'Close drop hint',
  'drop.closeTitle': 'Close',
  'drop.releaseImages': 'Release to add images',
  'drop.releaseFiles': 'Release to open external files',
  'resize.sidebar': 'Resize session panel width',
  'resize.preview': 'Resize file preview width',
  'settings.section.title': 'Workspace Settings',
  'settings.group.browse': 'File Browsing',
  'settings.group.content': 'Content Browsing',
  'settings.group.dialog': 'Conversation Page Settings',
  'settings.group.session': 'Session Browsing',
  'settings.group.mindmap': 'Mind Map Browsing',
  'settings.mindmapHoverColor': 'Hover highlight color',
  'settings.mindmapHoverColor.reset.title': 'Reset hover highlight color',
  'settings.mindmapSelectedColor': 'Selected highlight color',
  'settings.mindmapSelectedColor.reset.title': 'Reset selected highlight color',
  'settings.mindmapHeadColor': 'Session head accent color',
  'settings.mindmapHeadColor.reset.title': 'Reset session head accent color',
  'settings.mindmapEndColor': 'End card accent color',
  'settings.mindmapEndColor.reset.title': 'Reset end card accent color',
  'settings.mindmapMountBulge': 'Mount edge curve',
  'settings.mindmapMountBulge.reset.title': 'Reset curve amount',
  'settings.mindmapSpinSpeed': 'Mind-map icon spin speed',
  'settings.mindmapSpinSpeed.reset.title': 'Reset spin speed',
  'settings.rowHeight': 'Row height',
  'settings.rowHeight.reset.title': 'Reset row height',
  'settings.searchResult': 'Search results',
  'settings.expanded': 'Expanded by default',
  'settings.collapsed': 'Collapsed by default',
  'settings.fileColors': 'File icon colors',
  'settings.fileColor.aria': '{label} color',
  'settings.fileColor.reset.title': 'Reset {label} to its default color',
  'settings.reset': 'Reset',
  'settings.resetAllColors': 'Reset all colors',
  'settings.presets': 'Highlight presets',
  'settings.preset.aria': '{label} highlight preset',
  'settings.preset.reset.title': 'Reset {label} to its default preset',
  'settings.resetAllPresets': 'Reset all presets',
  'settings.chatFont': 'Chat font size',
  'settings.chatFont.reset.title': 'Reset font size',
  'settings.conflictFontSize': 'Conflict dialog font size',
  'settings.conflictFontSize.reset.title': 'Reset font size',
  'settings.autoExpandThink': 'Auto-expand thinking',
  'settings.thinkDelay': 'Think collapse delay',
  'settings.thinkDelay.reset.title': 'Reset collapse delay',
  'settings.previewRight': 'Show the file browser pane on the right',
  'settings.resetDefault': 'Reset',
  'settings.hint': 'Session Browsing: adjust the spin speed of the sidebar mind-map entry icon while the map is streaming (a 0.0x–3.0x speed multiplier, larger is faster; the default 1.5x means one 1.2 s revolution, and 0 means no rotation). Mind Map Browsing: adjust the hover and selected highlight colors in the mind-map view (amber and the theme blue by default; each can be reset), plus the mount-edge curve of the mind map (the S-curves from the root to session heads and from branch question cards to branch session heads; default 5.0x, larger bends more visibly, and 0 draws a straight line). File Browsing: adjust the tree row height, how search results are shown, and the file icon badge colors. Content Browsing: pick a highlight preset per file type, adjust the save-conflict dialog comparison text size, and choose whether the file browser pane sits on the right side of the conversation column. Conversation Page Settings: adjust the chat font size; when auto-expand thinking is on, streaming thinking blocks expand automatically and collapse after the configured delay (0–10 s, 0.1 s steps), and manual interaction cancels a pending collapse. Unchanged items use their defaults.',
  'fileColor.directory': 'Directory',
  'fileColor.style': 'Style',
  'fileColor.log': 'Log',
  'fileColor.config': 'Config',
  'fileColor.other': 'Other',
  'fileColor.blocked': 'Blocked',
  'preset.default': 'Default',
  'preset.classic': 'Classic',
  'preset.warm': 'Warm',
  'preset.cool': 'Cool',
  'preset.mono': 'Monochrome',
  'preset.vscode-config': 'Config (VS Code)',
  'preset.vscode-xml': 'XML (VS Code)',
  'preset.vscode-python': 'Python (VS Code)',
  'preset.vscode-json': 'JSON (VS Code)',
  'preset.vscode-typescript': 'TypeScript (VS Code)',
  'preset.vscode-javascript': 'JavaScript (VS Code)',
  'preset.vscode-css': 'CSS (VS Code)',
  'preset.vscode-markdown': 'Markdown (VS Code)',
  'preset.vscode-shell': 'Shell (VS Code)',
  'preset.vscode-cpp': 'C/C++ (VS Code)',
  'preset.vscode-csharp': 'C# (VS Code)',
  'preset.vs2022': 'Visual Studio 2022',
  'readonly.binary': 'The file is not editable text',
  'readonly.encoding': 'The file encoding cannot be edited',
  'readonly.too_large': 'The file is too large to edit',
  'readonly.file-too-large': 'The file exceeds the editable size limit',
  'readonly.truncated': 'The file content is truncated',
  'readonly.mixed_line_endings': 'The file has mixed line endings and cannot be safely edited',
  'readonly.permission': 'The current workspace has no write permission',
  'readonly.readonly': 'This file is read-only',
  'readonly.editing-disabled': 'File editing is not enabled in the current configuration',
  'readonly.symlink-path': 'Symlink paths are browse-only',
  'readonly.external-file': 'External files are browse-only',
  'readonly.fallback': 'This file cannot be edited right now',
  'context.symlinkError': 'Symlink files cannot be added to this conversation context.',
  'context.tooLarge': 'Selected text is {size}, over the {limit} context limit.',
  'context.canceled': 'Editor context send canceled',
  'context.active': 'This send includes file context: {path}. Click to deactivate.',
  'context.inactive': 'This send does not include file context: {path}. Click to re-enable.',
  'error.invalid-request': 'Invalid request',
  'error.invalid-path': 'Invalid path',
  'error.path-not-found': 'File or directory not found',
  'error.path-outside-workspace': 'Access to paths outside the workspace is denied',
  'error.wsl-translate-failed': 'Could not translate the path to a Windows path',
  'error.unsupported-platform': 'No desktop file manager is available on this system',
  'error.reveal-failed': 'Failed to open the path in the file manager',
  'error.entry-name-too-large': 'Entry name is too long',
  'error.not-a-directory': 'The selected path is not a directory',
  'error.unsupported-encoding': 'Unsupported encoding',
  'error.not-a-file': 'The selected path is not a regular file',
  'error.binary-file': 'This file contains binary content and cannot be previewed as text',
  'error.invalid-encoding': 'The file is not valid text in the selected encoding and cannot be previewed',
  'error.invalid-content-type': 'Invalid content type',
  'error.empty-file': 'The file is empty',
  'error.editing-disabled': 'File editing is not enabled',
  'error.revision-required': 'The save request must include a valid revision',
  'error.invalid-content-length': 'Content-Length must be a valid non-negative integer',
  'error.file-too-large': 'The content exceeds the editable size limit',
  'error.content-length-mismatch': 'The body length does not match Content-Length',
  'error.invalid-text': 'The saved content must be valid UTF-8 text without binary data',
  'error.symlink-write-denied': 'Writing through a symlink is denied',
  'error.file-conflict': 'The file was modified; reload it before saving',
  'error.request-too-large': 'Request body too large',
  'error.invalid-json': 'The request body must be valid JSON',
  'error.invalid-kind': 'Only files or folders can be created',
  'error.entry-exists': 'A file or folder with the same name already exists',
  'error.invalid-entry-kind': 'Only files or folders can be renamed',
  'error.invalid-context': 'Invalid editor context',
  'error.context-coordinate-mismatch': 'The selection does not match the file content',
  'error.context-revision-required': 'An unchanged selection must carry the file revision',
  'error.context-too-large': 'The selected text exceeds the context size limit',
  'error.context-symlink-denied': 'Symlink files cannot be added to the conversation context',
  'error.context-source-too-large': 'The context source file exceeds the size limit',
  'error.context-file-changed': 'The context file changed while sending',
  'error.context-revision-conflict': 'The file changed; reselect the context before sending',
  'error.context-content-mismatch': 'The selected text does not match the current file content',
  'error.context-session-denied': 'The current session does not belong to the selected workspace',
  'error.workspace-not-found': 'The current workspace does not exist',
  'error.path-denied': 'No permission to access this path',
  'error.workspace-operation-failed': 'Workspace operation failed',
  'error.request-not-trusted': 'The request origin is not authorized',
  'error.method-not-allowed': 'This method is not allowed for this endpoint',
  'error.endpoint-not-found': 'Endpoint not found',
  'error.invalid-query': 'Search text cannot contain newlines or control characters',
  'error.query-too-long': 'Search text is too long',
  'error.invalid-response': 'The API returned an invalid response (HTTP {status})',
  'error.invalid-response.tree': 'The workspace API returned an invalid response (HTTP {status})',
  'error.invalid-response.save': 'The save API returned an invalid response (HTTP {status})',
  'error.invalid-response.external': 'The external-file API returned an invalid response (HTTP {status})',
  'error.invalid-response.context': 'The editor-context API returned an invalid response (HTTP {status})',
  'error.invalid-response.entry': 'The workspace mutation API returned an invalid response (HTTP {status})',
  'error.invalid-response.fs': 'The file-operation API returned an invalid response (HTTP {status})',
  'error.invalid-response.search': 'The search API returned an invalid response (HTTP {status})',
  'error.invalid-response.reveal': 'The reveal API returned an invalid response (HTTP {status})',
  'error.invalid-response.context-text': 'The editor-context API returned no text result',
  'error.invalid-response.draft': 'The draft API returned an invalid response (HTTP {status})',
  'error.draft-failed': 'The draft operation failed (HTTP {status})',
  'error.request-failed': 'Failed to read the workspace (HTTP {status})',
  'error.save-failed': 'Failed to save the file (HTTP {status})',
  'error.external-file-failed': 'Failed to open the external file (HTTP {status})',
  'error.context-failed': 'Failed to submit the editor context (HTTP {status})',
  'error.entry-failed': 'Failed to modify the workspace entry (HTTP {status})',
  'error.fs-failed': 'File operation failed (HTTP {status})',
  'error.invalid-action': 'Unsupported operation',
  'error.invalid-target': 'Cannot copy into itself or its own subdirectory',
  'error.search-failed': 'Search failed (HTTP {status})',
  'error.reveal-failed.http': 'Failed to open in Explorer (HTTP {status})',
  'init.menu.description': 'Generate or update AGENTS.md at the workspace root (like Claude Code\'s /init)',
  'init.option.generate': 'Generate AGENTS.md',
  'init.option.update': 'Update AGENTS.md',
  'init.option.generate.detail': 'The current agent analyzes the workspace and generates it; target: {root}',
  'init.option.update.detail': 'Keep the existing content; the current agent analyzes the workspace and merges updates; target: {root}',
  'init.error.no-workspace': 'Cannot determine the workspace of the current session; /init cannot run',
  'init.error.send-failed': 'Failed to send the /init instruction: {message}',
  'init.prompt': 'Generate (or update) the AGENTS.md file at the workspace root.\n\nWorkspace root: {root}\n\nRequirements:\n1. First analyze the project background: the README, build and dependency manifests (e.g. package.json / pyproject.toml / Cargo.toml / go.mod), source layout, and primary languages.\n2. Generate AGENTS.md at the root, covering: project overview, common commands (build / test / check / run), tech stack, directory structure, and coding and collaboration conventions.\n3. Keep AGENTS.md concise and accurate, containing only what is necessary; do not put complex logic (such as architecture design, data flows, module details, incident postmortems) into AGENTS.md itself — instead create a docs folder, organize that complex logic into Markdown documents inside it, and reference them from AGENTS.md.\n4. If AGENTS.md already exists: keep the valuable content and merge updates on top of it; do not blindly overwrite.\n5. Write the document in the same language as the project\'s existing docs (Chinese for Chinese projects, English for English ones).\n6. Briefly summarize what you generated or updated when done.',
  'mobile.toggle': 'Mobile mode',
  'mobile.sidebarOpen': 'Open sidebar',
  'mobile.sidebarClose': 'Close sidebar',
  'mobile.files': 'Browse files',
  'view.mindmap': 'Mind map',
  'mindmap.overlay.close': 'Close mind map',
  'mindmap.rootLabel': 'Mind map',
  'mindmap.current': 'Current',
  'mindmap.pending': 'Awaiting a new question…',
  'mindmap.streaming': 'Generating…',
  'mindmap.streaming.click': 'View the generating session',
  'mindmap.thinking': 'Thinking…',
  'mindmap.done': 'Done',
  'mindmap.emptyRound': '(no text this round)',
  'mindmap.open.hint': 'Create a branch from this card and keep chatting',
  'mindmap.rootNode': 'Mind-map root',
  'mindmap.rootNode.hint': 'Click to create a new session branch',
  'mindmap.session.empty': 'Empty session',
  'mindmap.session.waiting': 'Awaiting a question',
  'mindmap.session.untitled': 'Untitled session',
  'mindmap.hint.new': 'Click to create a session',
  'mindmap.hint.fork': 'Click to fork a branch',
  'mindmap.hint.switch': 'Click to switch',
  'mindmap.empty': 'This session has nothing to show yet. Click the "Mind-map root" above to create a new empty session branch, or complete a turn in any session and open the mind map again.',
  'mindmap.loading': 'Loading mind-map session…',
  'mindmap.error': 'Failed to load mind-map session: {message}',
  'mindmap.forkFailed': 'Failed to create branch: {message}',
  'mindmap.created': 'Mind-map session created.',
  'mindmap.forked': 'Branch created here.',
  'mindmap.sessionCreated': 'New empty session branch created.',
  'mindmap.branchTag': 'branch',
  'mindmap.endTag': 'End',
  'mindmap.turnTag': 'Turn {n}',
  'mindmap.rounds': '{n} turns',
  'mindmap.moreRounds': '{n} more turns in history',
  'mindmap.menu.rename': 'Rename',
  'mindmap.menu.archiveAll': 'Archive entire mind map',
  'mindmap.menu.archiveBranch': 'Archive this session and its branches',
  'mindmap.rename.title': 'Rename',
  'mindmap.archiveAll.message': 'Archive the entire mind map "{name}"? All its session branches will be archived and removed from all lists too.',
  'mindmap.archive.action': 'Archive',
  'mindmap.archivedAll': 'Mind map archived.',
  'mindmap.archiveBranch.title': 'Archive Session',
  'mindmap.archiveBranch.message': 'Archive session "{name}" and all its branches? It will be removed from the mind map (currently no restore path).',
  'mindmap.archiveBranch.action': 'Archive',
  'mindmap.branchArchived': 'Session and its branches archived.',
  'mindmap.workspace.title': 'Choose workspace (where new sessions go)',
  'mindmap.workspace.none': 'Ungrouped (no workspace)',
  'mindmap.workspace.set': 'New sessions will land in workspace "{name}".',
  'mindmap.workspace.cleared': 'New sessions will no longer be bound to a workspace.',
  'mindmap.renamed': 'Renamed.',
  'mindmap.menu.deleteCard': 'Delete card',
  'mindmap.delete.title': 'Delete Card',
  'mindmap.delete.message': 'Delete card "{name}"? The conversation will be truncated here: this card, everything after it, and every session hanging below will be removed, and the original session will be archived (currently no restore path).',
  'mindmap.delete.action': 'Delete',
  'mindmap.delete.current': 'The current session will be archived; the view will switch to the truncated session afterwards.',
  'mindmap.delete.lastSession': 'A mind map must keep at least one session; archive the whole mind map instead.',
  'mindmap.delete.missing': 'The card to delete was not found; the document may have changed, please retry.',
  'mindmap.deleted': 'Card and its derived content deleted.',
  'mindmap.truncated': 'Session truncated; the original was archived.',
  'mindmap.view.restore': 'Restore view',
  'mindmap.view.restoreTitle': 'Reset the view size and position',
  'mindmap.scope.full': 'Current fill mode: Full',
  'mindmap.scope.sidebar': 'Current fill mode: Sidebar only',
  'mindmap.scope.full.right': 'Current fill mode: Fill right',
  'mindmap.scope.sidebar.right': 'Current fill mode: Fill left',
  'mindmap.scope.title': 'Toggle mind-map scope: full (sidebar + file browser) / sidebar only',
  'mindmap.scope.title.right': 'Toggle mind-map scope: fill left (sidebar) / fill right (file browser)',
  'mindmap.noticeFailed': 'Operation failed: {message}',
  'mindmap.sidebar.empty': 'No mind-map sessions yet. Click the "Mind map" tab of a session to create one.',
  'mindmap.sidebar.branches': '{n} branches',
  'mindmap.sidebar.open': 'Open mind-map session',
  'mindmap.sidebar.renameTitle': 'Rename mind-map session',
  'mindmap.confirm.title': 'Create Mind Map Session',
  'mindmap.confirm.message': 'This will convert the current session into a mind-map session and hide it from the sidebar session list. Convert now?',
  'mindmap.confirm.action': 'Convert',
  'switcher.aria': 'Switch session',
  'switcher.trigger.title': 'Click to switch session',
  'switcher.subagent': 'subagent',
  'switcher.noSessions': 'No other sessions',
}
/* CodeMirror search/goto-line panel phrases (EditorState.phrases keys; keep
   the $ placeholders). English is CodeMirror's built-in default, so the
   override is only installed for the Chinese surface. */
const CM_PHRASES_ZH = Object.freeze({
  'Find': '查找',
  'Replace': '替换为',
  'next': '下一个',
  'previous': '上一个',
  'all': '全部',
  'match case': '区分大小写',
  'regexp': '正则',
  'by word': '全字匹配',
  'replace': '替换',
  'replace all': '全部替换',
  'close': '关闭',
  'Go to line': '跳转到行',
  'go': '跳转',
  'current match': '当前匹配',
  'on line': '行',
  'replaced match on line $': '已在第 $ 行替换匹配',
  'replaced $ matches': '已替换 $ 个匹配项',
})
/* The LocaleRuntime face (subscribe/getSnapshot pair) once the harness locale
   plugin is present; undefined keeps the plugin on the zh dictionary. */
let localeFace = undefined
/* The active-locale translator. Bound to the harness locale registry in
   apply() when available; without it, falls back to the zh dictionary. */
const zhFallbackTranslate = (key, params) => {
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
}
let translate = zhFallbackTranslate
/* Render subscription: re-renders the calling component whenever the active
   locale (or the dictionary registry) changes. */
function useLocaleText() {
  return useSyncExternalStore(
    localeFace === undefined ? () => () => {} : callback => localeFace.subscribe(callback),
    () => localeFace === undefined ? 0 : localeFace.getSnapshot().revision,
  )
}
/* Whether the active surface is Chinese (no locale service counts as Chinese). */
function localeIsZh() {
  return localeFace === undefined || localeFace.getSnapshot().active !== 'en'
}
/* ---- Mobile mode state ---- The document classes are the single source of
   truth (the CSS gates and this store read the same classes), so a remount
   re-derives state instead of losing it. Components subscribe via useMobile();
   setMobile turns the gate on (and opens the drawer) or off (and clears the
   drawer/files sub-states). */
function mobileState() {
  return {
    on: document.documentElement.classList.contains(MOBILE_CLASS),
    drawerOpen: document.documentElement.classList.contains(MOBILE_DRAWER_CLASS),
    files: document.documentElement.classList.contains(MOBILE_FILES_CLASS),
  }
}
let mobileSnapshot = typeof document === 'undefined' ? { on: false, drawerOpen: false, files: false } : mobileState()
const mobileListeners = new Set()
function notifyMobile() { mobileSnapshot = mobileState(); for (const listener of mobileListeners) listener() }
const mobileFace = {
  subscribe(callback) { mobileListeners.add(callback); return () => { mobileListeners.delete(callback) } },
  getSnapshot() { return mobileSnapshot },
}
function setMobile(on) {
  document.documentElement.classList.toggle(MOBILE_CLASS, on)
  if (on) document.documentElement.classList.add(MOBILE_DRAWER_CLASS)
  else {
    document.documentElement.classList.remove(MOBILE_DRAWER_CLASS)
    document.documentElement.classList.remove(MOBILE_FILES_CLASS)
  }
  notifyMobile()
}
function setDrawerOpen(open) { document.documentElement.classList.toggle(MOBILE_DRAWER_CLASS, open); notifyMobile() }
function setMobileFiles(open) { document.documentElement.classList.toggle(MOBILE_FILES_CLASS, open); notifyMobile() }
function useMobile() { return useSyncExternalStore(mobileFace.subscribe, mobileFace.getSnapshot) }
/* Localize a plugin-API error: the Chinese surface keeps the server message
   verbatim; the English surface maps known error codes through the dictionary
   and falls back to the server message or the wrapper key. */
function apiErrorMessage(code, serverMessage, fallbackKey, params) {
  if (localeIsZh() && typeof serverMessage === 'string' && serverMessage !== '') return serverMessage
  if (code !== undefined) {
    const localized = translate(`error.${code}`)
    if (localized !== `error.${code}`) return localized
  }
  if (typeof serverMessage === 'string' && serverMessage !== '') return serverMessage
  return translate(fallbackKey, params)
}
/* Localized label of one file-color group; language-neutral names (TypeScript, JSON, ...) fall back to the constant label. */
function fileColorGroupLabel(group) {
  const localized = translate(`fileColor.${group}`)
  if (localized !== `fileColor.${group}`) return localized
  return FILE_COLOR_GROUPS.find(item => item.group === group)?.label ?? group
}
/* Localized label of one highlight preset; language-neutral names (Python (VS Code), ...) fall back to the constant label. */
function highlightPresetLabel(id) {
  const localized = translate(`preset.${id}`)
  if (localized !== `preset.${id}`) return localized
  return HIGHLIGHT_PRESETS.find(item => item.id === id)?.label ?? id
}

const styles = `
.dsh-ws-viewport{position:relative;height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-ws-frame{--dsh-ws-sidebar:280px;--dsh-ws-preview:420px;position:relative;display:grid;grid-template-columns:var(--dsh-ws-sidebar) var(--dsh-ws-preview) minmax(0,1fr);grid-template-rows:100%;width:100%;min-width:0;height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-ws-frame[data-resizing]{transition:none;user-select:none}.dsh-ws-sidebar,.dsh-ws-tree,.dsh-ws-preview,.dsh-ws-chat{min-width:0;height:100%;overflow:hidden}.dsh-ws-sidebar{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right]{grid-template-columns:var(--dsh-ws-sidebar) minmax(0,1fr) var(--dsh-ws-preview)}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-sidebar{grid-column:1;grid-row:1}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-chat{grid-column:2;grid-row:1}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-preview{grid-column:3;grid-row:1;border-right:0;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-ws-tree,.dsh-ws-preview{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-ws-frame[data-explorer-closed] .dsh-ws-tree,.dsh-ws-frame[data-explorer-closed] .dsh-ws-preview{visibility:hidden;pointer-events:none;border-right:0}.dsh-ws-chat{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base)}
.dsh-ws-panel-header{display:flex;align-items:center;gap:8px;min-height:52px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}.dsh-ws-panel-title{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}.dsh-ws-panel-title strong{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-panel-title>span{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
/* Preview page top rows (file tabs + active-file name) share the sidebar fill
   so the file browsing page reads as one band with the sidebar. */
.dsh-ws-preview .dsh-ws-panel-header{background:var(--dsw-specific-sidebar-fill)}.dsh-ws-preview .dsh-ws-preview-file-header{min-height:26px;gap:4px;padding:0 8px}.dsh-ws-preview-file-path{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-file-header .dsh-ws-icon-button{width:22px;height:22px}.dsh-ws-preview-file-header .dsh-ws-icon-button svg{width:14px;height:14px}.dsh-ws-preview-file-header .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}
.dsh-ws-panel-actions{display:flex;flex:none;align-items:center;gap:2px}.dsh-ws-icon-button,.dsh-ws-text-button{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dsh-ws-icon-button{width:30px;padding:0;font-size:18px}.dsh-ws-icon-button svg{display:block;width:16px;height:16px}.dsh-ws-icon-button:hover,.dsh-ws-text-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-icon-button:disabled,.dsh-ws-text-button:disabled{cursor:not-allowed;opacity:.55}
.dsh-ws-icon-button:focus-visible,.dsh-ws-text-button:focus-visible,.dsh-ws-tree-row:focus-visible,.dsh-ws-preview-tab-button:focus-visible,.dsh-ws-preview-tab-close:focus-visible,.dsh-ws-splitter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-tree-scroll{flex:1;min-height:0;overflow:auto;padding:8px 6px 16px}.dsh-ws-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-ws-row-height,28px);padding:0 7px 0 calc(7px + var(--dsh-ws-depth,0) * 15px);border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-ws-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-tree-row[data-selected]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-ws-tree-row:disabled{cursor:not-allowed;opacity:.55}.dsh-ws-tree-row[data-cut]{opacity:.55}
.dsh-ws-chevron{display:inline-flex;align-items:center;justify-content:center;flex:0 0 12px;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-ws-file-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;border-radius:4px;background:color-mix(in srgb,var(--dsh-ws-file-accent,var(--dsw-alias-label-tertiary)) 16%,transparent);color:var(--dsh-ws-file-accent,var(--dsw-alias-label-tertiary));font-size:8px;font-weight:600;text-transform:uppercase}.dsh-ws-file-mark[data-group='directory']{--dsh-ws-file-accent:var(--dsh-ws-file-directory,#3b82f6)}.dsh-ws-file-mark[data-group='typescript']{--dsh-ws-file-accent:var(--dsh-ws-file-typescript,#3178c6)}.dsh-ws-file-mark[data-group='javascript']{--dsh-ws-file-accent:var(--dsh-ws-file-javascript,#e5c158)}.dsh-ws-file-mark[data-group='json']{--dsh-ws-file-accent:var(--dsh-ws-file-json,#e07a3c)}.dsh-ws-file-mark[data-group='markup']{--dsh-ws-file-accent:var(--dsh-ws-file-markup,#e04a3c)}.dsh-ws-file-mark[data-group='style']{--dsh-ws-file-accent:var(--dsh-ws-file-style,#a855f7)}.dsh-ws-file-mark[data-group='markdown']{--dsh-ws-file-accent:var(--dsh-ws-file-markdown,#12a5a0)}.dsh-ws-file-mark[data-group='log']{--dsh-ws-file-accent:var(--dsh-ws-file-log,#d99a2b)}.dsh-ws-file-mark[data-group='python']{--dsh-ws-file-accent:var(--dsh-ws-file-python,#4b8bb8)}.dsh-ws-file-mark[data-group='shell']{--dsh-ws-file-accent:var(--dsh-ws-file-shell,#22a06b)}.dsh-ws-file-mark[data-group='config']{--dsh-ws-file-accent:var(--dsh-ws-file-config,#8a95a5)}.dsh-ws-file-mark[data-group='c-family']{--dsh-ws-file-accent:var(--dsh-ws-file-c-family,#5a7ba6)}.dsh-ws-file-mark[data-group='csharp']{--dsh-ws-file-accent:var(--dsh-ws-file-csharp,#a25fd0)}.dsh-ws-file-mark[data-group='other']{--dsh-ws-file-accent:var(--dsh-ws-file-other,#9aa3ad)}.dsh-ws-file-mark[data-group='blocked']{--dsh-ws-file-accent:var(--dsh-ws-file-blocked,#e5484d)}.dsh-ws-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-symlink{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-ws-tree-status{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsh-ws-tree-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-ws-empty{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center}
.dsh-ws-preview-header-meta{display:flex;align-items:center;gap:6px;min-width:0}.dsh-ws-preview-header-meta>span:not(.dsh-ws-language):not(.dsh-ws-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-language{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-ws-encoding{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-ws-dirty{color:var(--dsw-alias-state-warn-label);font-size:12px}.dsh-ws-preview-tabs{display:flex;align-items:stretch;gap:0;min-width:0;height:29px;padding:0;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);overflow-x:auto;overflow-y:hidden}.dsh-ws-preview-tab{flex:none;display:flex;align-items:center;gap:5px;min-width:0;max-width:220px;padding:0 5px 0 9px;border-radius:0;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:grab;box-sizing:border-box;white-space:nowrap}.dsh-ws-preview-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-preview-tab[data-active]{border-bottom:2px solid var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-ws-preview-tab[data-dragging]{opacity:.7}.dsh-ws-preview-tabs::-webkit-scrollbar{height:0;background:transparent}@supports not selector(::-webkit-scrollbar){.dsh-ws-preview-tabs{scrollbar-width:none}}.dsh-ws-preview-scrollbar{position:absolute;top:29px;left:0;right:0;height:4px;border-radius:2px;opacity:0;pointer-events:none;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);touch-action:none;z-index:3}.dsh-ws-preview-scrollbar[data-visible='true']{opacity:1;pointer-events:auto}.dsh-ws-preview-scrollbar-thumb{height:100%;min-width:24px;border-radius:2px;background:var(--dsw-alias-scrollbar-bg-l1)}.dsh-ws-preview-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1)}.dsh-ws-preview-drop-indicator{flex:none;width:3px;height:20px;border-radius:2px;background:var(--dsw-alias-state-business-primary);align-self:center;pointer-events:none}.dsh-ws-preview-tab-button{display:flex;flex:1;align-items:center;gap:5px;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dsh-ws-preview-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.dsh-ws-preview-tab-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:2px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}.dsh-ws-preview-tab-close svg{display:block;flex:none;width:16px;height:16px}.dsh-ws-preview-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.dsh-ws-preview-tab-close:disabled{cursor:not-allowed;opacity:.45}.dsh-ws-preview-body{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-markdown-code-block)}.dsh-ws-editor-host{height:100%;min-width:0}.dsh-ws-editor-host .cm-editor{height:100%;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-scroller{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:19px;overflow:auto}.dsh-ws-editor-host .cm-gutters{background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-ws-editor-host .cm-activeLine,.dsh-ws-editor-host .cm-activeLineGutter{background:var(--dsw-alias-interactive-bg-hover)}.dsh-ws-editor-host .cm-selectionBackground,.dsh-ws-editor-host .cm-content ::selection{background:var(--dsw-alias-interactive-bg-active)!important}.dsh-ws-editor-host .cm-cursor{border-left-color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-foldPlaceholder{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}.dsh-ws-editor-host .cm-panels{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-panel input{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-ws-context-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;width:min(var(--dsh-composer-card-max-width),max(0px,calc(100% - (var(--dsh-composer-side-clearance) * 2))));margin:0 auto;padding:0}.dsh-ws-context-prefix{display:flex;flex:1;align-items:center;gap:6px;min-width:0;min-height:28px;padding:5px 8px 5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer}.dsh-ws-context-prefix:hover{color:var(--dsw-alias-label-primary)}.dsh-ws-context-prefix:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dsh-ws-context-prefix[data-inactive]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);filter:grayscale(1)}.dsh-ws-context-prefix-mark{flex:none;font-size:12px}.dsh-ws-context-prefix-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-message-context-summary{box-sizing:border-box;display:flex;align-items:center;align-self:flex-end;gap:6px;max-width:100%;min-height:24px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}.dsh-ws-message-context-summary-mark{flex:none;font-size:12px}.dsh-ws-message-context-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-message-context-summary-range{flex:none;color:var(--dsw-alias-label-caption)}.dsh-ws-message-context-bubble[data-dsh-ws-empty-prompt]{display:none}
.dsh-ws-banner{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}.dsh-ws-banner-actions{display:flex;gap:6px;margin-top:5px}.dsh-ws-status{flex:none;display:flex;align-items:center;gap:8px;min-width:0;box-sizing:border-box;width:100%;padding:3px 12px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-preview-status-actions{flex:none;display:flex;align-items:center;gap:2px;min-width:0}.dsh-ws-preview-status-actions .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}.dsh-ws-preview-status-meta{flex:none;display:flex;align-items:center;gap:6px;min-width:0}.dsh-ws-preview-status-meta>span:not(.dsh-ws-language):not(.dsh-ws-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-status-msg{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:right;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-status-msg[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-ws-error-card{max-width:300px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:19px;text-align:left}.dsh-ws-dialog-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.38));box-sizing:border-box}.dsh-ws-dialog{width:min(360px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-ws-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-ws-dialog-title{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-dialog-body{display:flex;flex-direction:column;gap:8px;padding:14px}.dsh-ws-dialog-input{width:100%;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;box-sizing:border-box}.dsh-ws-dialog-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dsh-ws-dialog-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-ws-dialog-message{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.dsh-ws-dialog-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-ws-danger-button{color:var(--dsw-alias-state-error-primary)}.dsh-ws-dialog-footer{display:flex;justify-content:flex-end;gap:8px;padding:0 14px 14px}.dsh-ws-conflict-region{display:flex;flex-direction:column;gap:8px;min-height:0}.dsh-ws-conflict-region-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-ws-conflict-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px;min-height:0;flex:1}.dsh-ws-conflict-cols-final{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-ws-conflict-col{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.dsh-ws-conflict-col-label{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-conflict-mine .dsh-ws-conflict-col-label{color:var(--dsw-alias-state-warn-label)}.dsh-ws-conflict-theirs .dsh-ws-conflict-col-label{color:var(--dsw-alias-state-business-primary)}.dsh-ws-conflict-code{margin:0;min-height:0;flex:1;overflow:auto;padding:10px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:var(--dsh-ws-conflict-font-size,12px);line-height:20px;white-space:pre;box-sizing:border-box}.dsh-ws-inline-add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-inline-del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-radius:3px;opacity:.9;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-conflict-code-row{display:inline;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 16%,transparent)}.dsh-ws-conflict-mine .dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 20%,transparent);color:var(--dsw-alias-state-warn-label)}.dsh-ws-conflict-theirs .dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-ws-conflict-code-row[data-kind='del']{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);opacity:.85}.dsh-ws-conflict-dialog{width:66vw;max-width:66vw;max-height:min(90vh,1000px);display:flex;flex-direction:column}.dsh-ws-conflict-dialog .dsh-ws-dialog-body{flex:1;min-height:0;overflow:auto}.dsh-ws-conflict-progress{margin-left:8px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:18px;white-space:nowrap}
.dsh-ws-frame [data-slot='sidebar.footer.action']{display:flex!important;flex-direction:column;align-items:stretch;width:100%;min-width:0}
.dsh-ws-splitter{position:absolute;top:0;bottom:0;z-index:8;width:8px;margin-left:-4px;border:0;background:transparent;cursor:col-resize;touch-action:none}.dsh-ws-splitter::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-ws-splitter:hover::after,.dsh-ws-splitter[data-dragging]::after,.dsh-ws-splitter:focus-visible::after{background:var(--dsw-alias-state-business-primary)}.dsh-ws-details{position:absolute;z-index:16;top:0;right:0;bottom:0;width:min(440px,45vw);overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px var(--dsw-alias-bg-mask-1));transform:translateX(0);opacity:1;transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-ws-details[data-closed]{pointer-events:none;visibility:hidden;transform:translateX(100%);opacity:0}.dsh-ws-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}.dsh-ws-overlay>*{pointer-events:auto}.dsh-ws-tree{position:relative}.dsh-ws-context-menu{position:fixed;z-index:40;min-width:168px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-ws-context-menu-wide{min-width:220px;max-width:280px;max-height:min(420px,70vh);overflow-y:auto}.dsh-ws-context-label{padding:4px 10px 6px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;user-select:none}.dsh-ws-context-item-check{display:flex;align-items:center;gap:8px}.dsh-ws-context-item-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-context-item-check-mark{flex:none;color:var(--dsw-alias-state-business-primary);font-weight:700}.dsh-ws-context-item.dsh-ws-context-item-check{color:var(--dsw-alias-state-business-primary)}.dsh-ws-context-item{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:30px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-ws-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-context-item-danger{color:var(--dsw-alias-state-error-primary)}.dsh-ws-context-item-danger:hover{color:var(--dsw-alias-state-error-primary)}.dsh-ws-context-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-context-item:disabled{cursor:not-allowed;opacity:.5}.dsh-ws-context-item:disabled:hover{background:transparent;color:var(--dsw-alias-label-primary)}.dsh-ws-context-separator{height:1px;margin:4px 0;border:0;background:var(--dsw-alias-border-l2)}.dsh-ws-copy-notice{position:absolute;right:10px;bottom:10px;z-index:12;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}@media(prefers-reduced-motion:reduce){.dsh-ws-frame,.dsh-ws-details,.dsh-ws-splitter::after{transition:none}}
.dsh-ws-search-header{flex-direction:column;align-items:stretch;gap:8px;padding:8px}
.dsh-ws-search-input-row{display:flex;align-items:center;gap:6px}
.dsh-ws-search-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}
.dsh-ws-search-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-search-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-ws-search-case{width:34px;padding:0;font-size:11px;font-weight:600}
.dsh-ws-search-nameonly{display:flex;align-items:center;gap:6px;height:20px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none}
.dsh-ws-search-nameonly:hover{color:var(--dsw-alias-label-primary)}
.dsh-ws-search-nameonly input{margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.dsh-ws-search-kind{flex:none;display:inline-flex;width:16px;color:var(--dsw-alias-label-caption)}
.dsh-ws-icon-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-ws-text-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-ws-search-summary{padding:8px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-search-file{margin:2px 0}
.dsh-ws-search-file-header{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-ws-search-file-header:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-search-file-count{flex:none;color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-ws-search-truncated{flex:none;color:var(--dsw-alias-state-warn-label);font-size:10px}
.dsh-ws-search-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:22px;padding:2px 7px 2px 18px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-ws-search-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-search-line{flex:none;width:32px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;text-align:right}
.dsh-ws-search-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-search-hit{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-radius:2px}
.dsh-ws-settings-row{display:flex;align-items:center;gap:10px}.dsh-ws-settings-label{flex:none;min-width:64px;color:var(--dsw-alias-label-primary);font-size:13px}.dsh-ws-settings-slider{flex:1;min-width:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-ws-settings-checkbox{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-ws-settings-value{flex:none;min-width:48px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}.dsh-ws-settings-hint{padding:0 14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-explorer-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:560px}.dsh-ws-explorer-settings .dsh-ws-settings-label{min-width:88px}.dsh-ws-explorer-settings .dsh-ws-settings-slider{max-width:320px}.dsh-ws-explorer-settings .dsh-ws-settings-hint{padding:0}.dsh-ws-settings-group{display:flex;flex-direction:column;gap:10px}.dsh-ws-settings-group-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:22px}.dsh-ws-settings-group-title::before{content:'';flex:none;width:3px;height:14px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}.dsh-ws-explorer-divider{height:1px;margin:0;border:0;background:var(--dsw-alias-border-l2)}.dsh-ws-file-colors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px}.dsh-ws-file-colors-title{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}.dsh-ws-file-color-row{display:flex;align-items:center;gap:10px;min-height:26px}.dsh-ws-file-color-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dsh-ws-file-color-input{flex:none;width:32px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;cursor:pointer;box-sizing:border-box}.dsh-ws-file-color-input::-webkit-color-swatch-wrapper{padding:2px}.dsh-ws-file-color-input::-webkit-color-swatch{border:0;border-radius:2px}.dsh-ws-file-color-reset{flex:none;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:24px;cursor:pointer}.dsh-ws-file-color-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-file-color-reset:disabled{cursor:not-allowed;opacity:.55}.dsh-ws-file-colors-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding-top:2px}
.dsh-ws-chat{--dsw-font-markdown-h1:700 calc(24px * var(--dsh-ws-chat-font-scale,1)) / calc(34px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h2:700 calc(22px * var(--dsh-ws-chat-font-scale,1)) / calc(32px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h3:700 calc(20px * var(--dsh-ws-chat-font-scale,1)) / calc(30px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h4:600 calc(16px * var(--dsh-ws-chat-font-scale,1)) / calc(28px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base:calc(16px * var(--dsh-ws-chat-font-scale,1)) / calc(28px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-strong:600 calc(16px * var(--dsh-ws-chat-font-scale,1)) / calc(28px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-italic:italic calc(16px * var(--dsh-ws-chat-font-scale,1)) / calc(28px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-strong-italic:italic 600 calc(16px * var(--dsh-ws-chat-font-scale,1)) / calc(28px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-table:calc(15px * var(--dsh-ws-chat-font-scale,1)) / calc(25px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-table-head:500 calc(15px * var(--dsh-ws-chat-font-scale,1)) / calc(25px * var(--dsh-ws-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-code:calc(14px * var(--dsh-ws-chat-font-scale,1)) / calc(22px * var(--dsh-ws-chat-font-scale,1)) var(--ds-font-family-code);--dsw-font-markdown-code-block:calc(13px * var(--dsh-ws-chat-font-scale,1)) / calc(22px * var(--dsh-ws-chat-font-scale,1)) var(--ds-font-family-code);--dsw-font-markdown-code-block-small:calc(12px * var(--dsh-ws-chat-font-scale,1)) / calc(18px * var(--dsh-ws-chat-font-scale,1)) var(--ds-font-family-code)}
.dsh-ws-chat [data-chat-flow-kind='user'] [data-time-hover-root] > div:first-child > div:last-child,.dsh-ws-chat [data-chat-flow-kind='steering'] [data-time-hover-root] > div:first-child > div:last-child,.dsh-ws-chat [data-pending-steering] > div:first-child > div:last-child{font-size:calc(16px * var(--dsh-ws-chat-font-scale,1));line-height:calc(24px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-tool],.dsh-ws-chat [data-sample='bash'],.dsh-ws-chat [data-variant='think']{font-size:calc(14px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-tool] [data-disclosure-row] :is(span,button),.dsh-ws-chat [data-sample='bash'] span,.dsh-ws-chat [data-variant='think'] span,.dsh-ws-chat [data-variant='think'] > div > div{font-size:1em}
.dsh-ws-chat [data-chat-flow]{gap:calc(12px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] [data-slot='conversation.chat.node'] > div > div{gap:calc(12px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] p:not(li p),.dsh-ws-chat [data-chat-flow-kind='assistant-step'] :where(ul,ol,h4,h5,h6,pre){margin-top:calc(12px * var(--dsh-ws-chat-font-scale,1));margin-bottom:calc(12px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] :where(h1,h2,h3){margin-top:calc(24px * var(--dsh-ws-chat-font-scale,1));margin-bottom:calc(12px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] hr{margin:calc(24px * var(--dsh-ws-chat-font-scale,1)) 0}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] blockquote{margin-top:calc(12px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] li:not(:first-child){margin-top:calc(4px * var(--dsh-ws-chat-font-scale,1))}
.dsh-ws-chat [data-chat-flow-kind='assistant-step'] li > p{margin:calc(6px * var(--dsh-ws-chat-font-scale,1)) 0}
.dsh-ws-preview-tab-close[data-pinned]{color:var(--dsw-alias-state-business-primary);width:22px;height:22px}
.dsh-ws-preview-tab-close[data-pinned] svg{display:block;width:16px;height:16px;transform:translateY(1px) rotate(-45deg)}
.dsh-ws-highlight-preset-select{flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}.dsh-ws-highlight-preset-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#0451a5;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#4ec9b0;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#ce9178;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6}
.dsh-ws-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#b4452c;--shiki-token-string:#8a5a00;--shiki-token-comment:#a06a4a;--shiki-token-keyword:#c2410c;--shiki-token-parameter:#d97706;--shiki-token-function:#be185d;--shiki-token-string-expression:#9a3412;--shiki-token-punctuation:#6b4a3f;--shiki-token-link:#9a3412}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#ff8a65;--shiki-token-string:#ffd54f;--shiki-token-comment:#c8a48c;--shiki-token-keyword:#ff9e6d;--shiki-token-parameter:#ffb74d;--shiki-token-function:#f472b6;--shiki-token-string-expression:#ffcc80;--shiki-token-punctuation:#e0c8bb;--shiki-token-link:#ffab91}
.dsh-ws-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#1971c2;--shiki-token-string:#0f766e;--shiki-token-comment:#6f7d94;--shiki-token-keyword:#364fc7;--shiki-token-parameter:#0b7285;--shiki-token-function:#7048e8;--shiki-token-string-expression:#099268;--shiki-token-punctuation:#49576b;--shiki-token-link:#1c7ed6}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#4dabf7;--shiki-token-string:#38d9a9;--shiki-token-comment:#8fa3c2;--shiki-token-keyword:#91a7ff;--shiki-token-parameter:#22b8cf;--shiki-token-function:#b197fc;--shiki-token-string-expression:#63e6be;--shiki-token-punctuation:#b6c2d6;--shiki-token-link:#74c0fc}
.dsh-ws-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#3f3f3f;--shiki-token-string:#2e2e2e;--shiki-token-comment:#9d9d9d;--shiki-token-keyword:#e8590c;--shiki-token-parameter:#565656;--shiki-token-function:#7a7a7a;--shiki-token-string-expression:#4a4a4a;--shiki-token-punctuation:#8a8a8a;--shiki-token-link:#a0a0a0}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#d0d0d0;--shiki-token-string:#e2e2e2;--shiki-token-comment:#6e6e6e;--shiki-token-keyword:#ffa94d;--shiki-token-parameter:#a8a8a8;--shiki-token-function:#bfbfbf;--shiki-token-string-expression:#cfcfcf;--shiki-token-punctuation:#8f8f8f;--shiki-token-link:#7d7d7d}
/* VS Code default theme (Light+/Dark+) XML palette: tag names ride the
   function token, attribute names the parameter token, values/entities the
   string token; two extra vars cover angle brackets and entity characters. */
.dsh-ws-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#008000;--shiki-token-function:#800000;--shiki-token-parameter:#e50000;--shiki-token-string:#a31515;--shiki-token-string-expression:#0000ff;--dsh-ws-token-xml-punctuation:#800000;--dsh-ws-token-xml-entity:#0000ff}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#6A9955;--shiki-token-function:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-string:#ce9178;--shiki-token-string-expression:#569cd6;--dsh-ws-token-xml-punctuation:#808080;--dsh-ws-token-xml-entity:#569cd6}
/* VS Code default theme (Light+/Dark+) shared token palette: one rule serves
   every non-XML vscode-* preset. */
.dsh-ws-editor-host[data-highlight-preset='vscode-python'],.dsh-ws-editor-host[data-highlight-preset='vscode-json'],.dsh-ws-editor-host[data-highlight-preset='vscode-typescript'],.dsh-ws-editor-host[data-highlight-preset='vscode-javascript'],.dsh-ws-editor-host[data-highlight-preset='vscode-css'],.dsh-ws-editor-host[data-highlight-preset='vscode-markdown'],.dsh-ws-editor-host[data-highlight-preset='vscode-shell'],.dsh-ws-editor-host[data-highlight-preset='vscode-config'],.dsh-ws-editor-host[data-highlight-preset='vscode-cpp'],.dsh-ws-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#795e26;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-python'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-json'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-typescript'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-javascript'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-css'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-markdown'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-shell'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-config'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-cpp'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#b5cea8;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#dcdcaa;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6}
.dsh-ws-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#000000;--shiki-token-function:#2b91af;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#b5cea8;--shiki-token-string:#d69d85;--shiki-token-comment:#57a64a;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#dcdcdc;--shiki-token-function:#4ec9b0;--shiki-token-string-expression:#d69d85;--shiki-token-punctuation:#b4b4b4;--shiki-token-link:#569cd6}
/* Preprocessor directive color (C# #if/#region, ...): purple, lighter in dark
   for contrast; overridable per preset. */
.dsh-ws-editor-host{--dsh-ws-token-directive:#8e44ad}
body[data-ds-dark-theme] .dsh-ws-editor-host{--dsh-ws-token-directive:#c586c0}
/* Sidebar top actions: hide the harness New Session button (the root div's
   only direct button); the plugin draws its own two-button row — New Session /
   workspace files — in the same flow position. */
.dsh-ws-frame [data-slot="sidebar"] > div > button{display:none}
.dsh-ws-sidebar-top-actions{flex:none;min-width:0;display:flex;align-items:stretch;gap:6px;height:38px;margin:0 2px 8px;box-sizing:border-box}
.dsh-ws-sidebar-top-action{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden;white-space:nowrap}
.dsh-ws-sidebar-top-action:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-ws-sidebar-top-action[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-primary)}
.dsh-ws-sidebar-top-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-sidebar-top-icon{flex:none;width:14px;height:14px}
.dsh-ws-sidebar-top-icon svg{display:block;width:100%;height:100%}
.dsh-ws-sidebar-top-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Collapsed rail: the two controls become icon-only 36px buttons, stacked. */
.dsh-ws-sidebar-top-actions[data-rail]{flex-direction:column;align-items:flex-start;gap:0;height:auto;margin:0 0 12px;position:relative;z-index:10}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-action{flex:none;width:36px;height:36px;padding:0;gap:0;border-color:transparent;background:transparent}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-icon{width:18px;height:18px}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-label{display:none}
/* Collapsed rail: hide the harness workspace browser's rail controls (search
   + add); the plugin's two nav tabs are the only region icons. */
.dsh-ws-frame[data-sidebar-collapsed] [data-slot="sidebar.workspaces"] > *{display:none}
/* Files region: the harness workspace browser is hidden while the plugin's
   file tree fills the region seat (fused into the sidebar). */
.dsh-ws-sidebar-files{display:none}
.dsh-ws-frame[data-sidebar-files] [data-slot="sidebar.workspaces"] > :not(.dsh-ws-sidebar-files){display:none}
/* The sidebar shell hides nested scrollbars until hover (quietBars); the file
   list is scroll-heavy, so its scrollbar stays visible. The files panel is
   inset 12px both sides so it reads as a symmetric card. */
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-files{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;margin-right:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-files .dsh-ws-tree{flex:1;min-height:0;height:auto;border-right:0}
/* CodeMirror search panel (Ctrl+F) renders into .dsh-ws-preview-search
   (between the status bar and the preview body), so the panel rules stay
   scoped to that container; !important keeps the controls legible under the
   harness's global control styles. Match marks live in the editor content,
   so they stay scoped to the editor host. */
.dsh-ws-preview-search{flex:none;min-width:0;background:var(--dsw-alias-bg-layer-1);user-select:none}
.dsh-ws-preview-search .cm-panels.cm-panels-top{background:var(--dsw-alias-bg-layer-1)!important;color:var(--dsw-alias-label-primary)!important;border-bottom:1px solid var(--dsw-alias-border-l2)!important}
.dsh-ws-preview-search .cm-panel.cm-search{padding:5px 36px 5px 6px}
.dsh-ws-preview-search .cm-panel.cm-search .cm-textfield{height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:6px;background:var(--dsw-alias-bg-base)!important;color:var(--dsw-alias-label-primary)!important;font:inherit!important;font-size:12px!important;box-sizing:border-box;user-select:text}
.dsh-ws-preview-search .cm-panel.cm-search .cm-textfield:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-preview-search .cm-panel.cm-search .cm-button{height:26px;padding:0 8px;border:0!important;border-radius:6px;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font:inherit!important;font-size:12px!important;cursor:pointer}
.dsh-ws-preview-search .cm-panel.cm-search .cm-button:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
.dsh-ws-preview-search .cm-panel.cm-search label{display:inline-flex;align-items:center;gap:3px;height:28px;transform:translateY(3px);color:var(--dsw-alias-label-secondary)!important}
.dsh-ws-preview-search .cm-panel.cm-search input[type=checkbox]{margin:2px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-state-business-primary)}
.dsh-ws-preview-search .cm-panel.cm-search [name=close]{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:absolute!important;top:50%!important;right:4px!important;transform:translateY(-50%)!important;width:30px!important;height:30px!important;padding:0 0 2px!important;margin:0!important;border:0!important;border-radius:8px!important;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font-size:18px!important;line-height:1!important;cursor:pointer!important;box-sizing:border-box!important}
.dsh-ws-preview-search .cm-panel.cm-search [name=close]:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
/* The search field is wrapped (see CodeEditor) with a col-resize grip on its
   right edge so the user can drag it wider/narrower. */
.dsh-ws-preview-search .dsh-ws-search-field-wrap{display:inline-flex;align-items:center;vertical-align:middle}
.dsh-ws-preview-search .dsh-ws-search-field-wrap .cm-textfield{flex:none;min-width:60px}
.dsh-ws-preview-search .dsh-ws-search-resize{flex:none;width:6px;height:16px;margin:0 2px 0 4px;border-radius:3px;background:var(--dsw-alias-border-l2);cursor:col-resize;opacity:.65}
.dsh-ws-preview-search .dsh-ws-search-resize:hover{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-ws-preview-search .dsh-ws-search-resize:active{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-ws-editor-host .cm-searchMatch{background-color:var(--dsw-alias-state-business-tertiary)!important}
.dsh-ws-editor-host .cm-searchMatch-selected{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent)!important}
.dsh-ws-editor-host .cm-selectionMatch{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)!important}
.dsh-ws-editor-host .cm-searchMatch .cm-selectionMatch{background-color:transparent!important}
.dsh-ws-drop-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);pointer-events:none}
.dsh-ws-drop-hint{display:inline-flex;align-items:center;padding:8px 14px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-business-primary);font-size:12px;box-shadow:var(--dsw-shadow-elevated,0 8px 24px rgba(0,0,0,.18))}
.dsh-ws-preview[data-drop-active] .dsh-ws-preview-tabs,.dsh-ws-preview[data-drop-active] .dsh-ws-panel-header,.dsh-ws-preview[data-drop-active] .dsh-ws-editor-host{pointer-events:none}
/* Hide the harness's full-viewport chat drop mask (the only role="status"
   element portaled directly to body); the layout draws its own chat-confined
   mask so it covers the chat pane instead of the whole page. */
body > [role="status"]{display:none!important}
.dsh-ws-chat-drop-mask{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.32));backdrop-filter:blur(6px);pointer-events:none}
.dsh-ws-chat-drop-card{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-ws-chat-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-ws-chat-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Close button on the preview drop hint, matching the chat drop mask. */
.dsh-ws-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-ws-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Transient toast matching the harness conversation Toast look (contrast fill,
   slide-in, hold-and-fade) for failed external-file opens; positioned inside
   the preview pane so the notice stays panel-scoped. */
.dsh-ws-toast{position:absolute;top:12px;left:50%;z-index:60;pointer-events:none;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 48px));padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);animation:dsh-ws-toast-in 160ms ease-out,dsh-ws-toast-fade 1000ms ease 3000ms forwards}
.dsh-ws-toast-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-state-warn-label)}
.dsh-ws-toast-text{min-width:0}
@keyframes dsh-ws-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes dsh-ws-toast-fade{to{opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-ws-toast{animation:dsh-ws-toast-fade 1000ms ease 3000ms forwards}}
/* ── Session switcher (header title → quick-switch dropdown) ────────────
   The conversation header's current-title crumb (the last crumb segment) is
   hidden so the switcher trigger — rendered in
   conversation.session.header.actions at order -400 — becomes the visible
   session title; subagent parent breadcrumbs stay (only the self crumb is
   hidden). The panel is portalled to body with fixed positioning, so the
   chat column's overflow never clips it. */
[data-slot="conversation.session.header"] > header > div:first-child > div:first-child > nav > span:last-child{display:none}
.dsh-ws-session-switcher{display:inline-flex;align-items:center;min-width:0;flex:0 0 auto}
.dsh-ws-session-switcher-trigger{display:inline-flex;align-items:center;gap:4px;max-width:min(320px,60vw);min-width:0;padding:2px 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;box-sizing:border-box}
.dsh-ws-session-switcher-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-session-switcher-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-session-switcher-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-session-switcher .dsh-ws-chevron{flex:none;font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary)}
.dsh-ws-session-switcher-panel{position:fixed;z-index:60;max-height:min(60vh,420px);overflow-y:auto;padding:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-ws-session-switcher-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dsh-ws-session-switcher-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-session-switcher-row.dsh-ws-session-switcher-current{color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-ws-session-switcher-row-main{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-session-switcher-badge{flex:none;margin-left:4px;padding:0 5px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:400}
.dsh-ws-session-switcher-row-ws{flex:none;max-width:40%;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
.dsh-ws-session-switcher-empty{padding:8px 10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
/* ── Mobile (phone-column) mode ─────────────────────────────────────────
   Mirror of dsh-mobile-preview: the document-class gate (dsh-ws-mobile-on)
   drives every override; the floating sidebar drawer and the file-fullscreen
   view ride sibling classes. Desktop layout is untouched when the gate is
   absent. In-flow frame order is aside(1) preview(2) chat(3); the aside
   becomes an absolute drawer, so explicit grid-column keeps each section in
   the phone track. */
.dsh-ws-mobile-toggle{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:0;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left}.dsh-ws-mobile-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-mobile-toggle[data-open]{color:var(--dsw-alias-brand-primary)}.dsh-ws-mobile-toggle[data-rail]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-ws-mobile-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-mobile-toggle-icon{flex:none;width:16px;height:16px}.dsh-ws-mobile-toggle[data-rail] .dsh-ws-mobile-toggle-icon{width:18px;height:18px}.dsh-ws-mobile-toggle-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html.dsh-ws-mobile-on .dsh-ws-frame{grid-template-columns:0 minmax(0,430px) 0!important;justify-content:center}
html.dsh-ws-mobile-on .dsh-ws-chat{grid-column:2}
html.dsh-ws-mobile-on .dsh-ws-preview{display:none}
html.dsh-ws-mobile-on .dsh-ws-sidebar{position:absolute;top:0;bottom:0;left:0;z-index:30;width:min(280px,85vw);box-shadow:8px 0 24px #0000002e;transform:translateX(-100%);transition:transform .2s var(--ds-ease-in-out)}
html.dsh-ws-mobile-on .dsh-ws-sidebar [data-slot="sidebar"] > div{width:100%!important}
html.dsh-ws-mobile-on.dsh-ws-mobile-drawer-open .dsh-ws-sidebar{transform:translateX(0)}
html.dsh-ws-mobile-on .dsh-ws-splitter{display:none}
html.dsh-ws-mobile-on .dsh-ws-details{display:none}
html.dsh-ws-mobile-on [data-slot="sidebar"] > div > div:first-child > button:last-child{display:none}
.dsh-ws-mobile-scrim{position:absolute;inset:0;z-index:25;background:#00000047}
/* File browsing fills the phone column below the pinned conversation header
   (height measured into --dsh-ws-mobile-header-h); the chat's scroll area
   (messages + composer) is hidden so only the header stays reachable. */
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-frame{grid-template-columns:0 minmax(0,430px) 0!important}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-preview{display:flex;grid-column:2;visibility:visible;pointer-events:auto;box-sizing:border-box;padding-top:var(--dsh-ws-mobile-header-h,52px)}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat{position:fixed;top:0;left:50%;width:min(430px,100%);margin-left:calc(min(430px,100%) / -2);z-index:3;height:var(--dsh-ws-mobile-header-h,52px);overflow:hidden}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat [data-slot="conversation"] [data-conversation-scroll]{display:none}
/* In file-fullscreen the conversation's view tabs (chat/trajectory) are pinned
   with the title row; they belong to the chat, not the file page, so hiding
   them lets the file content start flush under the title row (which is also
   what --dsh-ws-mobile-header-h measures after this rule applies). */
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on [data-slot="conversation.session.header"] > header > div[role="tablist"]{display:none}
/* Session-header controls: hidden outside mobile, inline at the phone column's
   top-left in mobile (whale first, file button right after it). */
.dsh-ws-mobile-controls{display:none;align-items:center;gap:2px}
html.dsh-ws-mobile-on .dsh-ws-mobile-controls{display:flex;order:-1}
.dsh-ws-mobile-whale,.dsh-ws-mobile-files{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-ws-mobile-whale:hover,.dsh-ws-mobile-files:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-mobile-active{color:var(--dsw-alias-brand-primary)}
.dsh-ws-mobile-files-icon{width:16px;height:16px}
html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child,html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child > div:nth-child(2){display:contents}
html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > nav{flex:1}
html.dsh-ws-mobile-on [data-slot="conversation.session.header.utilities"]{display:none!important}
/* Hero whale + file button: a frame-level overlay visible only on the
   blank-session hero (the :has gate mirrors ConversationRoot's own hero
   decision). */
.dsh-ws-mobile-hero{display:none;position:absolute;top:10px;left:calc(max(0px,50% - 215px) + 8px)}
html.dsh-ws-mobile-on:has([data-slot="conversation"] [data-phase="hero"]) .dsh-ws-mobile-hero{display:flex;align-items:center;gap:2px}
/* Settings dialog (the harness Settings panel from the sidebar.settings seat):
   in mobile the centered 800px modal becomes a fullscreen phone panel with the
   section nav as a horizontal bottom bar. The drawer keeps a transform even
   when open (translateX(0)), which would make the dialog's position:fixed
   overlay resolve against the 280px drawer instead of the viewport; dropping
   the transform while the dialog is open frees the modal to cover the phone
   column. */
html.dsh-ws-mobile-on .dsh-ws-sidebar:has([data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]){transform:none;transition:none}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav){width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0;flex-direction:column;overflow:hidden}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav{order:2;flex:none;display:flex;flex-direction:row;align-items:center;gap:8px;width:100%;padding:8px 12px 10px;box-sizing:border-box;overflow-x:auto;scrollbar-width:thin}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:last-child{display:flex;flex-direction:row;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:last-child > button{flex:none}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:first-child{position:absolute;top:0;left:0;z-index:1;display:flex;align-items:center;height:54px;padding:0 16px;box-sizing:border-box;white-space:nowrap}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > div{flex:1;min-height:0;display:flex;flex-direction:column}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > div > div:first-child{height:auto;min-height:54px;align-items:center;padding:12px 16px}
.dsh-ws-tree-rename{box-sizing:border-box;width:100%;padding:0 7px 0 calc(7px + var(--dsh-ws-depth,0) * 15px)}
.dsh-ws-tree-rename-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-ws-row-height,28px);box-sizing:border-box}
.dsh-ws-tree-rename-input{flex:1;min-width:0;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;box-sizing:border-box}
.dsh-ws-tree-rename-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-tree-rename-error{padding:2px 0 4px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:15px}
.dsh-ws-session-rename-overlay{position:fixed;z-index:45;box-sizing:border-box;padding:0}
.dsh-ws-session-rename-input{width:100%;height:100%;box-sizing:border-box;padding:0 4px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.dsh-ws-session-rename-input:disabled{opacity:.7;cursor:not-allowed}
.dsh-ws-session-rename-error{position:fixed;z-index:45;max-width:280px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}
.dsh-ws-copy-notice[data-error]{color:var(--dsw-alias-state-error-primary)}
/* Mind-map conversation branching view ("导图") and the sidebar branch-row
   hider (fork children are hidden from the harness session list; branches
   live in the mind map). */
.dsh-ws-mindmap{height:100%;position:relative;box-sizing:border-box;padding:14px 16px 190px;display:flex;flex-direction:column;overflow:hidden}
.dsh-ws-mindmap-toolbar{flex:none;display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dsh-ws-mindmap-toolbar-button{flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-ws-mindmap-toolbar-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
/* The window-scope toggle (full left area vs sidebar column only): pressed
   state mirrors the session-header button pattern; hidden on mobile where the
   overlay is always full screen. */
.dsh-ws-mindmap-toolbar-button[aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}
html.dsh-ws-mobile-on .dsh-ws-mindmap-scope-toggle{display:none}
.dsh-ws-mindmap-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dsh-ws-mindmap-viewport[data-dragging]{cursor:grabbing;user-select:none}
/* The floating mind-map window: by default everything left of the chat column
   (width = 100% - chat width, tracked live), the chat stays visible on the
   right; with the file browser on the right, data-side='right' anchors the
   window over the file browser instead. */
.dsh-ws-mindmap-overlay{position:fixed;top:0;bottom:0;left:0;z-index:30;display:flex;flex-direction:column;min-width:0;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24))}.dsh-ws-mindmap-overlay[data-side='right']{left:auto;right:0;border-right:0;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-ws-mindmap-overlay .dsh-ws-mindmap{flex:1;min-height:0;padding-bottom:14px}
.dsh-ws-mindmap-overlay-close{position:absolute;top:10px;right:10px;z-index:2;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box}
.dsh-ws-mindmap-overlay-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Convert-to-mind-map confirm dialog: a roomier modal than the default
   (larger width, more padding) with pill buttons — cancel gets a neutral
   border, confirm a primary-colored border. */
.dsh-ws-mindmap-confirm-dialog{width:min(440px,100%)}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-body{padding:18px 20px}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-message{font-size:14px;line-height:22px}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-footer{padding:0 20px 18px;gap:10px}
.dsh-ws-mindmap-confirm-button{height:34px;padding:0 18px;border-radius:999px;font-size:13px}
.dsh-ws-mindmap-confirm-cancel{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-confirm-cancel:hover{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}
.dsh-ws-mindmap-confirm-ok{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dsh-ws-mindmap-confirm-ok:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);border-color:var(--dsw-alias-state-business-primary)}
/* The session-header 导图 toggle button. */
.dsh-ws-mindmap-header-button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;box-sizing:border-box}
.dsh-ws-mindmap-header-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-header-button-on,.dsh-ws-mindmap-header-button[aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}
.dsh-ws-mindmap-header-icon{width:14px;height:14px;flex:none}
html.dsh-ws-mobile-on .dsh-ws-mindmap-header-button{display:none}
.dsh-ws-mindmap-canvas{position:absolute;left:0;top:0;transform-origin:0 0}
.dsh-ws-mindmap-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}
.dsh-ws-mindmap-edge:not(.dsh-ws-mindmap-edge-flow){fill:none;stroke:var(--dsw-alias-border-l2,#8a8f98);stroke-width:1.5;opacity:.85}
/* V3 mount edges (root → top-level session head, parent card → nested session
   head): primary dashed, weaker than the ancestor-trace classes above it. */
.dsh-ws-mindmap-edge-mount{stroke:var(--dsw-alias-state-business-primary);stroke-width:1.6;opacity:.55;stroke-dasharray:4 4}
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-flow-under{fill:none;stroke-width:3;stroke-linecap:round;opacity:.9}
.dsh-ws-mindmap-edge-flow{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:10 8;opacity:1;animation:dsh-ws-mindmap-edge-flow 1.1s linear infinite}
@keyframes dsh-ws-mindmap-edge-flow{to{stroke-dashoffset:-18}}
.dsh-ws-mindmap-node{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px;text-align:left;cursor:pointer;overflow:hidden;transition:border-color .12s ease,box-shadow .12s ease}
.dsh-ws-mindmap-node:hover{border-color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-node-current{border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-node-title{flex:none;display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsh-ws-mindmap-node-title-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transform:translateY(-1px)}
.dsh-ws-mindmap-node-q{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);flex:1;min-height:0}
.dsh-ws-mindmap-node-status{flex:none;font-size:11px;line-height:15px}
.dsh-ws-mindmap-node-thinking{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-node-done{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsh-ws-mindmap-node-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.dsh-ws-mindmap-branch{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-ws-mindmap-branch:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-branch:disabled{opacity:.55;cursor:not-allowed}
.dsh-ws-mindmap-node-current-badge{position:absolute;top:3px;right:8px;padding:1px 7px;border-radius:999px;background:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-inverted);font-size:10px;line-height:14px}
/* Branch cards: fork children that cannot overlap the shared trunk window
   render as their own card (always visible), with a head row (tag + branch
   title) and, when the branch has visible rounds, a per-round preview list. */
.dsh-ws-mindmap-pending{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch}
.dsh-ws-mindmap-branchcard{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsw-alias-state-business-primary) 6%)}
/* End-of-branch card ("末端"): the WHOLE card wears the accent tint — border,
   background wash and the "末端" capsule all resolve the --dsh-ws-mindmap-end
   custom property (default success green), so a terminal-point card reads
   green as a card, not just in its chip. The selected / hover ancestor rules
   (later in source, equal-or-higher specificity) still override the border,
   so the trace highlight stays visible over the tint. Streaming cards keep
   only the chip (their flowing ring is already the strong signal). */
.dsh-ws-mindmap-node.dsh-ws-mindmap-endcard{border-color:var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 86%,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 14%)}
/* V3 nodes: the VIRTUAL root node (the map's top hub — click it to create a
   new top-level session) and each session's HEAD node (its identity card at
   the left of the question chain; the "当前" badge sits here). */
.dsh-ws-mindmap-root{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:12px;padding:0 18px;border:2px solid var(--dsw-alias-state-business-primary);border-radius:16px;cursor:pointer;user-select:none;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,var(--dsw-alias-bg-layer-1)),color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-1)));box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);transition:transform .12s ease,box-shadow .12s ease;overflow:hidden}
.dsh-ws-mindmap-root:hover{transform:translateY(-1px);box-shadow:0 0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsh-ws-mindmap-root-plus{flex:none;width:26px;height:26px;border-radius:50%;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}
.dsh-ws-mindmap-root-plus svg{display:block;width:14px;height:14px;transition:transform .15s ease}
.dsh-ws-mindmap-root:hover .dsh-ws-mindmap-root-plus{transform:scale(1.06)}
.dsh-ws-mindmap-root:hover .dsh-ws-mindmap-root-plus svg{transform:rotate(90deg)}
.dsh-ws-mindmap-root-col{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}
.dsh-ws-mindmap-root-title{font-weight:800;font-size:14px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dsh-ws-mindmap-root-hint{font-size:10px;line-height:14px;color:var(--dsw-alias-state-business-primary);white-space:nowrap}
.dsh-ws-mindmap-head{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:9px 10px;border:1px solid var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary));border-radius:10px;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary)) 12%);overflow:hidden}
.dsh-ws-mindmap-head:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary)) 40%,transparent)}
.dsh-ws-mindmap-head-current{border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-head-row{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ws-mindmap-head-icon{flex:none;width:15px;height:15px;color:var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-head-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}
.dsh-ws-mindmap-head-count{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-head-status{display:flex;align-items:center;gap:6px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsh-ws-mindmap-head-status-live{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-head.dsh-ws-mindmap-node-ring{border:2px solid transparent;padding:8px 9px;border-radius:12px;background:linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box;animation:dsh-ws-mindmap-ring-spin 2.4s linear infinite}
/* Live streaming cards (turns in flight, ephemeral UI — replaced by normal
   cards once their turns complete): instead of an enclosing frame, each
   streaming card AND its parent card get a colorful flowing gradient ring
   (conic gradient clipped to the border box, rotating through the registered
   --dsw-ws-mm-angle), and the edge between them flows with the same palette.
   Palette colors arrive as inline --dsw-ws-mm-c1..c3; the 2px transparent
   border plus compensated padding keep content from shifting when the ring
   appears. The compound selectors beat the ancestor / branch border rules. */
@property --dsw-ws-mm-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring{border:2px solid transparent;padding:7px 9px;border-radius:12px;background:linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box;animation:dsh-ws-mindmap-ring-spin 2.4s linear infinite}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring.dsh-ws-mindmap-node-streaming{box-shadow:0 0 14px color-mix(in srgb,var(--dsw-ws-mm-c1) 22%,transparent);background:linear-gradient(color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box}
.dsh-ws-mindmap-node-streaming-status{display:flex;align-items:center;gap:6px;color:var(--dsw-ws-mm-c1,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-node-streaming-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-ws-mm-c1,var(--dsw-alias-state-business-primary));animation:dsh-ws-mindmap-dot-pulse 1s ease-in-out infinite}
@keyframes dsh-ws-mindmap-ring-spin{to{--dsw-ws-mm-angle:360deg}}
@keyframes dsh-ws-mindmap-dot-pulse{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion: reduce){.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring{animation:none}.dsh-ws-mindmap-edge-flow{animation:none}.dsh-ws-mindmap-node-streaming-dot{animation:none}}
.dsh-ws-mindmap-pending-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ws-mindmap-pending-label{flex:none;display:inline-flex;align-items:center;gap:2px;padding:1px 6px 1px 5px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-size:10px;line-height:14px}
/* End-of-branch capsule ("末端"): the same chip shape, but tinted with the
   success green so the terminal-point chip is instantly distinguishable from
   a fork point (which stays primary-blue). */
.dsh-ws-mindmap-end-label{border-color:color-mix(in srgb,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 28%,transparent);background:color-mix(in srgb,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 12%,transparent);color:var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary))}
.dsh-ws-mindmap-pending-icon{flex:none;display:block}
.dsh-ws-mindmap-pending-title{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-mindmap-pending-count{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-ws-mindmap-branch-round{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:8px;row-gap:1px;align-items:center;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1,transparent);border-radius:8px;background:var(--dsw-alias-bg-base)}
.dsh-ws-mindmap-branch-round .dsh-ws-mindmap-node-q{grid-column:1;font-size:11px;line-height:15px;flex:none;-webkit-line-clamp:1}
.dsh-ws-mindmap-branch-round .dsh-ws-mindmap-node-status{grid-column:1;font-size:11px;line-height:15px}
.dsh-ws-mindmap-branch-round .dsh-ws-mindmap-branch{grid-column:2;grid-row:1 / span 2;align-self:center}
.dsh-ws-mindmap-more{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsh-ws-mindmap-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-bar-title{font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-mindmap-status{display:flex;align-items:flex-start;justify-content:center;padding:48px 24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:center}
.dsh-ws-mindmap-error{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-fork-error{position:sticky;top:0;z-index:2;margin-bottom:10px;padding:6px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:17px}
.dsh-ws-mindmap-notice{margin-bottom:10px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px}
.dsh-ws-mindmap-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-node[data-branch]{border-style:solid}
/* Selected-card ancestor trace: the current card's chain back to the root —
   edges turn dashed primary-blue, parent nodes get a dashed primary-blue
   border. The compound selector beats the base rules (equal specificity,
   later in source), so the trace keeps its stroke. */
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-active{stroke:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ancestor{border-style:dashed;border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary)) 18%,transparent)}
/* Hover ancestor trace: the card under the pointer gets a solid amber border
   + soft glow, its ancestors and path edges go amber dashed — visually
   distinct from the selected card's primary-blue chain (blue = persistent
   selection, amber = transient hover preview). Each hover class sits AFTER
   its blue counterpart (equal specificity, later wins), so when a card or
   edge is on BOTH the selection and the hover path, the hover (the pointer's
   current focus) wins. Ring (streaming) cards are excluded: their flowing
   ring is already the stronger signal and a border-color override would
   erase it. */
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-hover-active{stroke:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-hover-ancestor{border-style:dashed;border-color:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 22%,transparent)}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-hover:not(.dsh-ws-mindmap-node-ring){border-style:solid;border-color:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 35%,transparent),0 0 14px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 22%,transparent)}
/* Settings color swatch for the mind-map highlight pickers. */
.dsh-ws-mindmap-node-hint{position:absolute;right:5px;bottom:5px;z-index:1;max-width:calc(100% - 10px);padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-business-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);font-size:10px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-sizing:border-box}
.dsh-ws-settings-color{flex:none;width:40px;height:26px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;box-sizing:border-box}
.dsh-ws-settings-color::-webkit-color-swatch-wrapper{padding:0}
.dsh-ws-settings-color::-webkit-color-swatch{border:0;border-radius:3px}
.dsh-ws-settings-color::-moz-color-swatch{border:0;border-radius:3px}
.dsh-ws-mindmap-hidden-row{display:none!important}
/* Sidebar mind-map session entries: rendered INSIDE each workspace group's
   session list (one container appended to its group section), so a mind map
   shows among the ordinary sessions of its workspace; flat / search list
   modes (no group sections) use a region-area fallback seat instead. Entries
   are draggable to reorder (order persisted per group) and carry a right-click
   menu (rename / reveal). Empty containers collapse. */
.dsh-ws-sidebar-mindmaps{min-width:0;display:flex;flex-direction:column;gap:2px;padding:2px 8px 4px;box-sizing:border-box}
.dsh-ws-sidebar-mindmaps:empty{display:none}
.dsh-ws-sidebar-mindmaps-fallback{flex:none;padding:2px 2px 6px}
.dsh-ws-sidebar-mindmaps-empty{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;line-height:16px;padding:0 4px}
.dsh-ws-sidebar-mindmaps-list{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-ws-sidebar-mindmaps-item{display:flex;align-items:center;gap:6px;min-width:0;height:30px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;text-align:left;cursor:grab}
.dsh-ws-sidebar-mindmaps-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-sidebar-mindmaps-item[data-dragging]{opacity:.45}
.dsh-ws-sidebar-mindmaps-item[data-drop="before"]{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary)}
.dsh-ws-sidebar-mindmaps-item[data-drop="after"]{box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary)}
.dsh-ws-sidebar-mindmaps-icon{flex:none;width:14px;height:14px;color:var(--dsw-alias-state-business-primary)}
/* While any session in a mind map family is streaming (summary.running flips
   at generation start, no sync wait), spin the entry's left icon so the
   sidebar shows the live generation the hidden ordinary rows would have. */
@keyframes dsh-ws-mindmap-spin{to{transform:rotate(360deg)}}
.dsh-ws-sidebar-mindmaps-item[data-running] .dsh-ws-sidebar-mindmaps-icon{animation:dsh-ws-mindmap-spin var(--dsh-ws-mindmap-spin-duration,0.8s) linear infinite;transform-origin:center}
@media (prefers-reduced-motion: reduce){.dsh-ws-sidebar-mindmaps-item[data-running] .dsh-ws-sidebar-mindmaps-icon{animation:none}}
.dsh-ws-sidebar-mindmaps-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-sidebar-mindmaps-count{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-mindmaps{display:none}
.dsh-ws-frame[data-sidebar-collapsed] .dsh-ws-sidebar-mindmaps{display:none}
/* A collapsed workspace group renders no session rows (deriveGroups empties
   them), but the injected mind-map seat is a foreign node React leaves in
   place. Harness wraps the group header in a HoverCard span and the seat is
   appended to that wrapper — so the seat and the collapsed header share the
   same direct parent (the span for real workspaces, the group section div
   for the ungrouped bucket). Fold the seat with the folder by matching
   whatever element directly holds both; the group-collapse analogue of the
   files / rail rules above. */
[data-slot="sidebar.workspaces"] *:has(> [role="treeitem"][aria-expanded="false"]) > .dsh-ws-sidebar-mindmaps{display:none}
/* Rendered-Markdown preview overlay inside the preview body: absolute so the
   kept-mounted CodeMirror editor stays alive underneath, and scrollable so
   long documents browse like the editor does. */
.dsh-ws-md-preview{position:absolute;inset:0;overflow:auto;box-sizing:border-box;padding:16px 20px;background:var(--dsw-alias-bg-base)}
`

const tokenHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--shiki-token-comment)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--shiki-token-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--shiki-token-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--shiki-token-constant)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.typeName, tags.className, tags.namespace], color: 'var(--shiki-token-function)' },
  // Name-definition tokens (class/namespace/type names in declaration
  // position) ride the type color; StreamLanguage emits these as
  // `variableName.definition`, which the bare variableName rule above misses.
  { tag: [tags.definition(tags.variableName), tags.definition(tags.typeName), tags.definition(tags.propertyName)], color: 'var(--shiki-token-function)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--shiki-token-parameter)' },
  { tag: [tags.heading, tags.link, tags.url], color: 'var(--shiki-token-link)' },
  // Preprocessor directives: purple via the directive variable, with a purple
  // fallback. NOTE: tags.meta must not reappear in any LATER rule —
  // @lezer/highlight lets a later rule win per tag, which would strip the
  // directive color from C# #region/#if and C preprocessor lines.
  { tag: tags.meta, color: 'var(--dsh-ws-token-directive, #8e44ad)' },
  { tag: tags.inserted, color: 'var(--shiki-token-string-expression)' },
  { tag: tags.punctuation, color: 'var(--shiki-token-punctuation)' },
  // Markup (XML/HTML) tokens: angleBracket was unstyled and character already
  // rides the string color; the fallbacks preserve that unless a markup preset
  // (e.g. VS Code XML) sets the override variables.
  { tag: tags.angleBracket, color: 'var(--dsh-ws-token-xml-punctuation, inherit)' },
  { tag: tags.character, color: 'var(--dsh-ws-token-xml-entity, var(--shiki-token-string))' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--dsw-alias-state-error-primary)' },
])

const PLAIN_LANGUAGE = Object.freeze({ label: 'text', extension: [] })
const language = (label, extension) => Object.freeze({ label, extension })
const JS_LANGUAGE = language('js', javascript())
const JSX_LANGUAGE = language('jsx', javascript({ jsx: true }))
const TS_LANGUAGE = language('ts', javascript({ typescript: true }))
const TSX_LANGUAGE = language('tsx', javascript({ typescript: true, jsx: true }))
const JSON_LANGUAGE = language('json', json())
const HTML_LANGUAGE = language('html', html())
const CSS_LANGUAGE = language('css', css())
const MARKDOWN_LANGUAGE = language('md', markdown())
const PYTHON_LANGUAGE = language('py', python())
const SQL_LANGUAGE = language('sql', sql())
const XML_LANGUAGE = language('xml', xml())
const YAML_LANGUAGE = language('yaml', yaml())
const C_LANGUAGE = language('c', cpp())
const CPP_LANGUAGE = language('c++', cpp())
const JAVA_LANGUAGE = language('java', java())
const RUST_LANGUAGE = language('rust', rust())
const PHP_LANGUAGE = language('php', php())
const GO_LANGUAGE = language('go', go())
const SHELL_LANGUAGE = language('sh', StreamLanguage.define(shell))
const POWERSHELL_LANGUAGE = language('powershell', StreamLanguage.define(powerShell))
const RUBY_LANGUAGE = language('ruby', StreamLanguage.define(ruby))
const TOML_LANGUAGE = language('toml', StreamLanguage.define(toml))
const DOCKER_LANGUAGE = language('docker', StreamLanguage.define(dockerFile))
const MAKE_LANGUAGE = language('make', [])
const TEXT_LANGUAGE = language('text', [])
const SCSS_LANGUAGE = language('scss', CSS_LANGUAGE.extension)
const LESS_LANGUAGE = language('less', CSS_LANGUAGE.extension)
const MDX_LANGUAGE = language('mdx', MARKDOWN_LANGUAGE.extension)
const INI_LANGUAGE = language('ini', [])
/* C# legacy mode: replicates the clike `csharp` export (keywords, types, the
   @"..." verbatim-string hook) and adds a C/C++-style preprocessor hook so
   #if/#define/#region lines render as directives (the shipped csharp export
   has no '#' hook). */
const csharpWords = (str) => {
  const obj = {}
  for (const word of str.split(' ')) obj[word] = true
  return obj
}
const csharpDirectiveHook = (stream, state) => {
  if (!state.startOfLine) return false
  let next = null
  for (let ch; (ch = stream.peek());) {
    if (ch === '\\' && stream.match(/^.$/)) { next = csharpDirectiveHook; break }
    if (ch === '/' && stream.match(/^\/[\/\*]/, false)) break
    stream.next()
  }
  state.tokenize = next
  return 'meta'
}
const csharpVerbatimString = (stream, state) => {
  let next
  while ((next = stream.next()) != null) {
    if (next === '"' && !stream.eat('"')) { state.tokenize = null; break }
  }
  return 'string'
}
const CSHARP_MODE = clike({
  name: 'csharp',
  keywords: csharpWords('abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in init interface internal is lock namespace new operator out override params private protected public readonly record ref required return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual void volatile while add alias ascending descending dynamic from get global group into join let orderby partial remove select set value var yield'),
  types: csharpWords('Action Boolean Byte Char DateTime DateTimeOffset Decimal Double Func Guid Int16 Int32 Int64 Object SByte Single String Task TimeSpan UInt16 UInt32 UInt64 bool byte char decimal double short int long object sbyte float string ushort uint ulong'),
  blockKeywords: csharpWords('catch class do else finally for foreach if struct switch try while'),
  defKeywords: csharpWords('class interface namespace record struct var'),
  typeFirstDefinitions: true,
  atoms: csharpWords('true false null'),
  hooks: {
    '@': (stream, state) => {
      if (stream.eat('"')) {
        state.tokenize = csharpVerbatimString
        return csharpVerbatimString(stream, state)
      }
      stream.eatWhile(/[\w$_]/)
      return 'meta'
    },
    '#': csharpDirectiveHook,
  },
})
const CS_LANGUAGE = language('cs', StreamLanguage.define(CSHARP_MODE))

const EXACT_LANGUAGES = Object.freeze({
  dockerfile: DOCKER_LANGUAGE,
  'dockerfile.dev': DOCKER_LANGUAGE,
  'dockerfile.prod': DOCKER_LANGUAGE,
  'dockerfile.test': DOCKER_LANGUAGE,
  makefile: MAKE_LANGUAGE,
  'package.json': JSON_LANGUAGE,
  'tsconfig.json': JSON_LANGUAGE,
  '.gitignore': TEXT_LANGUAGE,
  '.env': INI_LANGUAGE,
  license: TEXT_LANGUAGE,
})
const EXTENSION_LANGUAGES = Object.freeze({
  js: JS_LANGUAGE, mjs: JS_LANGUAGE, cjs: JS_LANGUAGE, jsx: JSX_LANGUAGE,
  ts: TS_LANGUAGE, mts: TS_LANGUAGE, cts: TS_LANGUAGE, tsx: TSX_LANGUAGE,
  json: JSON_LANGUAGE, jsonc: JS_LANGUAGE, html: HTML_LANGUAGE, htm: HTML_LANGUAGE,
  css: CSS_LANGUAGE, scss: SCSS_LANGUAGE, less: LESS_LANGUAGE,
  md: MARKDOWN_LANGUAGE, markdown: MARKDOWN_LANGUAGE, mdx: MDX_LANGUAGE,
  py: PYTHON_LANGUAGE, sql: SQL_LANGUAGE, xml: XML_LANGUAGE, svg: XML_LANGUAGE,
  yaml: YAML_LANGUAGE, yml: YAML_LANGUAGE,
  c: C_LANGUAGE, h: C_LANGUAGE, cc: CPP_LANGUAGE, cpp: CPP_LANGUAGE, cxx: CPP_LANGUAGE, hpp: CPP_LANGUAGE,
  java: JAVA_LANGUAGE, rs: RUST_LANGUAGE, php: PHP_LANGUAGE, go: GO_LANGUAGE,
  cs: CS_LANGUAGE, csx: CS_LANGUAGE,
  sh: SHELL_LANGUAGE, bash: SHELL_LANGUAGE, zsh: SHELL_LANGUAGE,
  ps1: POWERSHELL_LANGUAGE, psm1: POWERSHELL_LANGUAGE,
  rb: RUBY_LANGUAGE, toml: TOML_LANGUAGE, ini: INI_LANGUAGE, cfg: INI_LANGUAGE,
})

function languageFor(name) {
  const lower = name.toLowerCase()
  const exact = EXACT_LANGUAGES[lower]
  if (exact !== undefined) return exact
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return EXTENSION_LANGUAGES[extension] ?? PLAIN_LANGUAGE
}

/* File-tree badge color groups. Each group owns one accent color used for the
   leading type badge (text + a translucent tint); users may recolor any group
   from the browser settings page, and an unset group falls back to its
   default. Directory and blocked entries are groups like any file type. */
const FILE_COLOR_GROUPS = Object.freeze([
  { group: 'directory', label: '目录', color: '#3b82f6' },
  { group: 'typescript', label: 'TypeScript', color: '#3178c6' },
  { group: 'javascript', label: 'JavaScript', color: '#e5c158' },
  { group: 'json', label: 'JSON', color: '#e07a3c' },
  { group: 'markup', label: 'HTML/XML', color: '#e04a3c' },
  { group: 'style', label: '样式', color: '#a855f7' },
  { group: 'markdown', label: 'Markdown', color: '#12a5a0' },
  { group: 'log', label: '日志', color: '#d99a2b' },
  { group: 'python', label: 'Python', color: '#4b8bb8' },
  { group: 'shell', label: 'Shell', color: '#22a06b' },
  { group: 'config', label: '配置文件', color: '#8a95a5' },
  { group: 'c-family', label: 'C/C++', color: '#5a7ba6' },
  { group: 'csharp', label: 'C#', color: '#a25fd0' },
  { group: 'other', label: '其他', color: '#9aa3ad' },
  { group: 'blocked', label: '受阻', color: '#e5484d' },
])
const DEFAULT_FILE_COLOR = '#9aa3ad'
const FILE_COLOR_DEFAULTS = Object.fromEntries(FILE_COLOR_GROUPS.map(({ group, color }) => [group, color]))
/** The accent color a group falls back to when the user has not set one. */
function fileColorDefault(group) {
  return FILE_COLOR_DEFAULTS[group] ?? DEFAULT_FILE_COLOR
}
/** Resolve one group's effective color: the user's customization, else the default. */
function fileColorOf(settings, group) {
  return settings?.fileColors?.[group] ?? fileColorDefault(group)
}

/* Extension -> color group. Mirrors EXTENSION_LANGUAGES so a file's badge and
   its editor highlighting stay on the same type; unknown suffixes land in
   'other'. */
const FILE_GROUP_BY_EXTENSION = Object.freeze({
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  css: 'style', scss: 'style', less: 'style',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  log: 'log',
  py: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', psm1: 'shell',
  yaml: 'config', yml: 'config', toml: 'config', ini: 'config', cfg: 'config', conf: 'config', env: 'config',
  c: 'c-family', h: 'c-family', cc: 'c-family', cpp: 'c-family', cxx: 'c-family', hpp: 'c-family',
  cs: 'csharp', csx: 'csharp',
})
/* Dot-less or conventionally-uppercase names that extension splitting would miss. */
const FILE_GROUP_BY_EXACT_NAME = Object.freeze({
  'package.json': 'json', 'tsconfig.json': 'json',
  '.gitignore': 'config', '.npmrc': 'config', '.editorconfig': 'config', '.env': 'config',
  'dockerfile': 'config', 'dockerfile.dev': 'config', 'dockerfile.prod': 'config', 'dockerfile.test': 'config',
  'makefile': 'config', 'license': 'config',
})
const DEFAULT_FILE_GROUP = 'other'
/** The color group one tree entry belongs to, from its kind and file name. */
function colorGroupOf(entry) {
  if (entry.kind === 'directory') return 'directory'
  if (entry.kind === 'blocked' || entry.kind === 'other') return 'blocked'
  const lower = String(entry.name).toLowerCase()
  const exact = FILE_GROUP_BY_EXACT_NAME[lower]
  if (exact !== undefined) return exact
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return FILE_GROUP_BY_EXTENSION[extension] ?? DEFAULT_FILE_GROUP
}

/* Editor syntax-highlight presets. Each non-default preset overrides the
   --shiki-token-* variables on the editor host (light and dark variants via
   the body attribute), so the CodeMirror HighlightStyle keeps its single
   var() mapping and every palette stays theme-consistent. 'default' leaves
   the app theme's own shiki palette untouched. */
const HIGHLIGHT_PRESETS = Object.freeze([
  { id: 'default', label: '默认' },
  { id: 'classic', label: '经典' },
  { id: 'warm', label: '暖色' },
  { id: 'cool', label: '冷色' },
  { id: 'mono', label: '单色' },
  { id: 'vscode-xml', label: 'XML（VS Code）' },
  { id: 'vscode-python', label: 'Python（VS Code）' },
  { id: 'vscode-json', label: 'JSON（VS Code）' },
  { id: 'vscode-typescript', label: 'TypeScript（VS Code）' },
  { id: 'vscode-javascript', label: 'JavaScript（VS Code）' },
  { id: 'vscode-css', label: 'CSS（VS Code）' },
  { id: 'vscode-markdown', label: 'Markdown（VS Code）' },
  { id: 'vscode-shell', label: 'Shell（VS Code）' },
  { id: 'vscode-config', label: '配置（VS Code）' },
  { id: 'vscode-cpp', label: 'C/C++（VS Code）' },
  { id: 'vscode-csharp', label: 'C#（VS Code）' },
  { id: 'vs2022', label: 'Visual Studio 2022' },
])
const HIGHLIGHT_PRESET_DEFAULT = 'default'
/* Per-group default highlight presets. A group with no entry here and no user
   pick follows the app theme's shiki palette ('default'). */
const HIGHLIGHT_PRESET_DEFAULT_BY_GROUP = Object.freeze({
  markup: 'vscode-xml',
  python: 'vscode-python',
  json: 'vscode-json',
  typescript: 'vscode-typescript',
  javascript: 'vscode-javascript',
  style: 'vscode-css',
  markdown: 'vscode-markdown',
  shell: 'vscode-shell',
  config: 'vscode-config',
  'c-family': 'vscode-cpp',
  csharp: 'vs2022',
})
/** The preset a group falls back to when the user has not picked one. */
function highlightPresetDefaultFor(group) {
  return HIGHLIGHT_PRESET_DEFAULT_BY_GROUP[group] ?? HIGHLIGHT_PRESET_DEFAULT
}
/** The preset one file-type group resolves to: the user's pick, else the group's default. */
function highlightPresetOf(settings, group) {
  return settings?.highlightPresets?.[group] ?? highlightPresetDefaultFor(group)
}

function lineSeparator(value) {
  if (value === 'crlf' || value === '\r\n') return '\r\n'
  if (value === 'cr' || value === '\r') return '\r'
  return '\n'
}

/* Read-only reason codes the preview payload may carry, mapped to their
   dictionary keys (including alias spellings from the server). */
const READ_ONLY_REASON_KEYS = Object.freeze({
  binary: 'readonly.binary',
  encoding: 'readonly.encoding',
  'unsupported-encoding': 'readonly.encoding',
  too_large: 'readonly.too_large',
  'too-large': 'readonly.too_large',
  'file-too-large': 'readonly.file-too-large',
  truncated: 'readonly.truncated',
  'preview-truncated': 'readonly.truncated',
  mixed_line_endings: 'readonly.mixed_line_endings',
  'mixed-line-endings': 'readonly.mixed_line_endings',
  permission: 'readonly.permission',
  readonly: 'readonly.readonly',
  'read-only': 'readonly.readonly',
  'editing-disabled': 'readonly.editing-disabled',
  'symlink-path': 'readonly.symlink-path',
  'external-file': 'readonly.external-file',
})

function readOnlyReason(preview) {
  if (preview.truncated) return translate('readonly.truncated')
  if (preview.lineEnding === 'mixed') return translate('readonly.mixed_line_endings')
  if (preview.editable !== false && !preview.readOnlyReason) return null
  return translate(READ_ONLY_REASON_KEYS[preview.readOnlyReason] ?? 'readonly.fallback')
}

const fileLabel = name => languageFor(name).label
const clamp = (value, min, max) => {
  const rounded = Math.round(value)
  // NaN (or non-finite) must not leak through Math.min/max into state; a
  // non-numeric input resolves to the lower bound as a safe default.
  return Number.isFinite(rounded) ? Math.min(max, Math.max(min, rounded)) : min
}
function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes < 0) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`; return `${(bytes / 1048576).toFixed(1)} MB` }

/* ---- Save-time three-way merge (Git-like conflict resolution) ----
 *
 * When an explicit save finds the file changed on disk by another tool since
 * the editing snapshot, the user's edits and the external edits are merged:
 * - changes in different places are both kept (clean merge);
 * - overlapping changes are reported as conflicts for the user to pick.
 * Inputs are split on '\n' (the editor and the decoded disk text share the
 * same line endings because editable files are never mixed), so the merge
 * preserves the file's line endings without extra normalization.
 */

/* Compact, budgeted Myers diff: the edit script turning `base` into `mine`
   as { from, to, added } changes, or null when the trace would exceed the
   memory budget. Adjacent operations are coalesced so a replacement is one
   change rather than a deletion followed by an insertion. */
function myersDiff(base, mine) {
  const N = base.length
  const M = mine.length
  const max = N + M
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace = []
  let found = false
  let d = 0
  for (; d <= max && !found; d += 1) {
    if ((trace.length + 1) * v.length > MYERS_TRACE_CELL_LIMIT) return null
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1]
      else x = v[offset + k - 1] + 1
      let y = x - k
      while (x < N && y < M && base[x] === mine[y]) { x += 1; y += 1 }
      v[offset + k] = x
      if (x >= N && y >= M) { found = true; break }
    }
  }
  const changes = []
  let x = N
  let y = M
  // `d` is one past the iteration that found the end; the trace snapshot for
  // backtracking step dd was recorded at the start of iteration dd.
  for (let dd = d - 1; dd >= 1; dd -= 1) {
    const vPrev = trace[dd]
    const k = x - y
    let prevK
    if (k === -dd || (k !== dd && vPrev[offset + k - 1] < vPrev[offset + k + 1])) prevK = k + 1
    else prevK = k - 1
    const prevX = vPrev[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { x -= 1; y -= 1 }
    if (x === prevX) changes.push({ from: x, to: x, added: mine.slice(prevY, y) })
    else changes.push({ from: prevX, to: x, added: mine.slice(prevY, y) })
    x = prevX
    y = prevY
  }
  changes.reverse()
  // Coalesce adjacent operations (a deletion immediately followed by an
  // insertion at the same position is one replacement; two insertions at the
  // same position are one insertion) so the merge walk sees one change per
  // base span.
  const coalesced = []
  for (const change of changes) {
    const previous = coalesced[coalesced.length - 1]
    if (previous !== undefined && change.from === previous.to) {
      coalesced[coalesced.length - 1] = { from: previous.from, to: change.to, added: [...previous.added, ...change.added] }
    } else {
      coalesced.push({ from: change.from, to: change.to, added: [...change.added] })
    }
  }
  return coalesced
}

function linesEqual(left, right) {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

function changesTouch(left, right) {
  const leftInsertion = left.from === left.to
  const rightInsertion = right.from === right.to
  if (leftInsertion && rightInsertion) return left.from === right.from
  // An insertion is "touching" a span only when it lands INSIDE [from, to):
  // an insertion exactly at the exclusive end (right.to / left.to) is disjoint
  // from the deletion (one side deletes the last line while the other appends
  // after it) and must merge cleanly.
  if (leftInsertion) return left.from >= right.from && left.from < right.to
  if (rightInsertion) return right.from >= left.from && right.from < left.to
  return left.from < right.to && right.from < left.to
}

function changeTouchesSpan(change, start, end) {
  if (change.from === change.to) {
    // A degenerate span (start === end, a same-point insertion conflict) is
    // touched by insertions exactly at that point; a non-degenerate span
    // keeps the half-open rule where an insertion landing exactly at the
    // exclusive end stays disjoint (deleting the last line while the other
    // side appends after it must merge cleanly).
    return end === start
      ? change.from === start
      : change.from >= start && change.from < end
  }
  return change.from < end && change.to > start
}

function appendMergeText(parts, lines) {
  if (lines.length === 0) return
  const previous = parts[parts.length - 1]
  if (previous?.kind === 'text') previous.lines.push(...lines)
  else parts.push({ kind: 'text', lines: [...lines] })
}

function applyChangesToSpan(base, start, end, changes) {
  const output = []
  let cursor = start
  for (const change of changes) {
    if (change.from < cursor || change.to < change.from || change.to > end) return null
    output.push(...base.slice(cursor, change.from), ...change.added)
    cursor = change.to
  }
  output.push(...base.slice(cursor, end))
  return output
}

function wholeFileConflict(base, mine, theirs, reason) {
  return {
    status: 'conflict',
    fallbackReason: reason,
    conflicts: [{ id: 0, start: 0, end: base.length, base, mine, theirs, display: 'plain' }],
    parts: [{ kind: 'conflict', id: 0 }],
  }
}

function resolveMergeParts(parts, conflicts, choices) {
  if (!Array.isArray(choices) || choices.length !== conflicts.length
    || choices.some(choice => choice !== 'mine' && choice !== 'theirs')) {
    throw new Error('workspace-studio: incomplete conflict choices')
  }
  const output = []
  for (const part of parts) {
    if (part.kind === 'text') output.push(...part.lines)
    else {
      const conflict = conflicts[part.id]
      if (conflict === undefined) throw new Error('workspace-studio: invalid conflict part')
      output.push(...conflict[choices[part.id]])
    }
  }
  return output.join('\n')
}

/* Merge both edit scripts by collecting every transitively overlapping change
   into one cluster — the closure that makes one-large-vs-many-small overlaps
   terminate, since nothing behind the cursor remains after a conflict is
   emitted. Conflict placement stays structural (`parts`), so user text can
   never collide with a marker string. */
function threeWayMerge(baseText, mineText, theirsText) {
  const base = baseText.split('\n')
  const mine = mineText.split('\n')
  const theirs = theirsText.split('\n')
  // The budget guard must run before the identity short-circuits below: an
  // oversized file that happens to equal one side must still fall back to the
  // whole-file conflict dialog instead of committing a huge file unchecked.
  if (base.length > MERGE_MAX_LINES || mine.length > MERGE_MAX_LINES || theirs.length > MERGE_MAX_LINES) {
    return wholeFileConflict(base, mine, theirs, 'line-limit')
  }
  if (mineText === theirsText) return { status: 'clean', merged: mineText }
  if (baseText === mineText) return { status: 'clean', merged: theirsText }
  if (baseText === theirsText) return { status: 'clean', merged: mineText }
  const mineChanges = myersDiff(base, mine)
  const theirsChanges = myersDiff(base, theirs)
  if (mineChanges === null || theirsChanges === null) return wholeFileConflict(base, mine, theirs, 'diff-budget')

  const parts = []
  const conflicts = []
  let mi = 0
  let ti = 0
  let cursor = 0
  let steps = 0
  const maxSteps = 4 * (mineChanges.length + theirsChanges.length + 1)

  while (mi < mineChanges.length || ti < theirsChanges.length) {
    if (steps >= maxSteps) return wholeFileConflict(base, mine, theirs, 'merge-progress')
    steps += 1
    const m = mineChanges[mi]
    const t = theirsChanges[ti]

    if (m !== undefined && t !== undefined && changesTouch(m, t)) {
      let start = Math.min(m.from, t.from)
      let end = Math.max(m.to, t.to)
      const mineCluster = []
      const theirsCluster = []
      let expanded
      do {
        expanded = false
        while (mi < mineChanges.length && changeTouchesSpan(mineChanges[mi], start, end)) {
          const change = mineChanges[mi]
          mi += 1
          mineCluster.push(change)
          start = Math.min(start, change.from)
          end = Math.max(end, change.to)
          expanded = true
        }
        while (ti < theirsChanges.length && changeTouchesSpan(theirsChanges[ti], start, end)) {
          const change = theirsChanges[ti]
          ti += 1
          theirsCluster.push(change)
          start = Math.min(start, change.from)
          end = Math.max(end, change.to)
          expanded = true
        }
      } while (expanded)

      if (start < cursor || end < start) return wholeFileConflict(base, mine, theirs, 'invalid-cluster')
      appendMergeText(parts, base.slice(cursor, start))
      const baseSegment = base.slice(start, end)
      const mineSegment = applyChangesToSpan(base, start, end, mineCluster)
      const theirsSegment = applyChangesToSpan(base, start, end, theirsCluster)
      if (mineSegment === null || theirsSegment === null) return wholeFileConflict(base, mine, theirs, 'invalid-change')
      if (linesEqual(mineSegment, theirsSegment)) appendMergeText(parts, mineSegment)
      else if (linesEqual(mineSegment, baseSegment)) appendMergeText(parts, theirsSegment)
      else if (linesEqual(theirsSegment, baseSegment)) appendMergeText(parts, mineSegment)
      else {
        const id = conflicts.length
        conflicts.push({ id, start, end, base: baseSegment, mine: mineSegment, theirs: theirsSegment, display: 'diff' })
        parts.push({ kind: 'conflict', id })
      }
      cursor = end
      continue
    }

    const mineFirst = m !== undefined && (t === undefined || m.from < t.from || (m.from === t.from && m.to <= t.to))
    const change = mineFirst ? m : t
    if (change === undefined || change.from < cursor || change.to < change.from) {
      return wholeFileConflict(base, mine, theirs, 'invalid-progress')
    }
    appendMergeText(parts, base.slice(cursor, change.from))
    appendMergeText(parts, change.added)
    cursor = change.to
    if (mineFirst) mi += 1
    else ti += 1
  }

  appendMergeText(parts, base.slice(cursor))
  if (conflicts.length > 0) {
    /* The conflict structure is only trustworthy when EACH side can be fully
       reconstructed from it. A non-canonical Myers diff on repeated identical
       lines can split one replacement into an insertion plus a remote deletion
       whose coordinates collide with the other side's change; the walk then
       applies one side's insertion as clean text and the structure cannot
       reconstruct the other side. If either all-mine or all-theirs fails to
       round-trip, fall back to the whole-file conflict (both full sides,
       exact choice) rather than emit a resolution contradicting the user's
       pick — a wrong save is worse than a manual choice. */
    try {
      const allMine = resolveMergeParts(parts, conflicts, conflicts.map(() => 'mine'))
      const allTheirs = resolveMergeParts(parts, conflicts, conflicts.map(() => 'theirs'))
      if (allMine !== mineText || allTheirs !== theirsText) {
        return wholeFileConflict(base, mine, theirs, 'unsound-cluster')
      }
    } catch {
      return wholeFileConflict(base, mine, theirs, 'unsound-cluster')
    }
    return { status: 'conflict', conflicts, parts }
  }
  return { status: 'clean', merged: resolveMergeParts(parts, [], []) }
}

/* Character-level diff of one conflict side against the common base: coalesced
   { text, kind } segments ('same' | 'add' | 'del') over the whole side.
   Unchanged characters keep their color, added render green, removed render
   as a red strikethrough — all inline on one line. Splitting on codepoints
   (not UTF-16 code units) keeps surrogate pairs intact. Returns null when the
   input is too large to diff safely (the caller falls back to line-level). */
const INLINE_DIFF_MAX_CHARS = 20000
function inlineDiffSegments(baseText, sideText) {
  const baseChars = Array.from(baseText)
  const sideChars = Array.from(sideText)
  if (baseChars.length > INLINE_DIFF_MAX_CHARS || sideChars.length > INLINE_DIFF_MAX_CHARS) return null
  const changes = myersDiff(baseChars, sideChars)
  if (changes === null) return null
  const segments = []
  let i = 0
  const push = (text, kind) => {
    if (text.length === 0) return
    const previous = segments[segments.length - 1]
    if (previous !== undefined && previous.kind === kind) previous.text += text
    else segments.push({ text, kind })
  }
  for (const change of changes) {
    for (; i < change.from; i += 1) push(baseChars[i], 'same')
    for (let k = change.from; k < change.to; k += 1) push(baseChars[k], 'del')
    for (const char of change.added) push(char, 'add')
    i = change.to
  }
  for (; i < baseChars.length; i += 1) push(baseChars[i], 'same')
  return segments
}

/* React nodes for one conflict side against the common base: a character-level
   inline diff (unchanged plain, added green, removed red strikethrough, all on
   one line); newlines inside any segment keep the <pre>'s exact line layout.
   Oversized regions fall back to line-level marks. */
function diffRows(baseLines, sideLines) {
  const segments = inlineDiffSegments(baseLines.join('\n'), sideLines.join('\n'))
  if (segments !== null) {
    const nodes = []
    for (const segment of segments) {
      nodes.push(segment.kind === 'same'
        ? segment.text
        : h('span', { className: `dsh-ws-inline-${segment.kind}` }, segment.text))
    }
    return nodes
  }
  // Fallback: line-level diff rows (whole deleted lines struck, whole added
  // lines highlighted) for content too large for the character diff.
  const rows = diffSideLines(baseLines, sideLines)
  const nodes = []
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0) nodes.push('\n')
    nodes.push(h('span', { className: 'dsh-ws-conflict-code-row', 'data-kind': rows[i].kind }, rows[i].text))
  }
  return nodes
}

/* Line-level diff rows for one conflict side: { text, kind }[] with kind
   'same' | 'add' | 'del'. Used only as the oversized fallback for the inline
   character diff. */
function diffSideLines(baseLines, sideLines) {
  if (baseLines.length > MERGE_MAX_LINES || sideLines.length > MERGE_MAX_LINES) {
    return sideLines.map(text => ({ text, kind: 'same' }))
  }
  const changes = myersDiff(baseLines, sideLines)
  if (changes === null) return sideLines.map(text => ({ text, kind: 'same' }))
  const rows = []
  let i = 0
  for (const change of changes) {
    for (; i < change.from; i += 1) rows.push({ text: baseLines[i], kind: 'same' })
    for (let k = change.from; k < change.to; k += 1) rows.push({ text: baseLines[k], kind: 'del' })
    for (const line of change.added) rows.push({ text: line, kind: 'add' })
    i = change.to
  }
  for (; i < baseLines.length; i += 1) rows.push({ text: baseLines[i], kind: 'same' })
  return rows
}

// Whether a dropped File is an image. Images go to the chat composer, not the
// preview: the drop highlight is withheld and an actual drop is rejected by
// the server with a clear "cannot preview as text" toast (development-notes
// §17). Empty MIME types count as normal files.
function isImageFile(file) {
  const type = typeof file?.type === 'string' ? file.type : ''
  return type.startsWith('image/')
}
// File-drag detection mirroring the harness composer's own check: the
// dataTransfer.types list is authoritative and stable during the whole drag,
// while dataTransfer.files is only guaranteed populated at drop time.
function hasDraggedFiles(event) {
  const dataTransfer = event?.dataTransfer
  if (dataTransfer === null || dataTransfer === undefined) return false
  if ((dataTransfer.files?.length ?? 0) > 0) return true
  try {
    return typeof dataTransfer.types?.includes === 'function' && dataTransfer.types.includes('Files')
  } catch {
    return false
  }
}
// Whether the drag carries a non-image file. Controls only the drop highlight:
// during dragover File objects may not be inspectable yet, so any file drag
// counts as "normal". The drop itself does not filter images — the server
// rejects them with a toast (development-notes §17).
function hasNormalFile(event) {
  if (!hasDraggedFiles(event)) return false
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return true
  for (const file of files) if (!isImageFile(file)) return true
  return false
}
// The persisted sidebar width lives with the explorer pane geometry
// (EXPLORER_LAYOUT_STORE_KEY): the live value rides the root layout store,
// which cannot persist its whole value, so the explorer pane store mirrors it
// on change and this rehydrates it on load. 0 means collapsed; missing or
// invalid persisted data falls back to the default width (render-time clamping
// still applies the viewport ceiling).
function readPersistedSidebarWidth() {
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
function createLayoutStore() {
  return defineStore({
    init: () => ({
      sidebar: readPersistedSidebarWidth(),
      detailsOpen: false,
      // Sidebar browsing region: 'sessions' shows the harness workspace/session
      // browser; 'files' swaps the same region for the workspace file tree.
      view: 'sessions',
    }),
    actions: {
      setSidebar: (draft, width, max = SIDEBAR_MAX_FALLBACK) => { draft.sidebar = clamp(width, SIDEBAR_MIN, max) },
      toggleSidebar: (draft) => { draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0 },
      openDetails: (draft) => { draft.detailsOpen = true },
      closeDetails: (draft) => { draft.detailsOpen = false },
      setView: (draft, view) => { draft.view = view === 'files' ? 'files' : 'sessions' },
    },
  })
}
/* Explorer pane geometry shared by every session: the workspace file-tree
   width, the file-preview width, the sidebar width (0 = collapsed), and the
   explorer open state (which controls the on-screen presence of both panes).
   Persisted globally in localStorage so session switches and page reloads keep
   one shared set of parameters. */
function createExplorerPaneStore() {
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
function createPreviewSessionStore() {
  return defineStore({
    init: () => ({
      previewSessions: {},
    }),
    persist: PREVIEW_SESSION_STORE_KEY,
    actions: {
      rememberPreviewSession: (draft, key, value) => {
        // The persisted value is rehydrated wholesale from localStorage; a
        // polluted or legacy key without the expected shape must not throw.
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
function createExplorerSettingsStore() {
  return defineStore({
    init: () => ({
      rowHeight: ROW_HEIGHT_DEFAULT,
      chatFontSize: CHAT_FONT_SIZE_DEFAULT,
      conflictFontSize: CONFLICT_FONT_SIZE_DEFAULT,
      wrap: false,
      expandSearchMatches: SEARCH_MATCH_EXPAND_DEFAULT,
      autoExpandThink: AUTO_EXPAND_THINK_DEFAULT,
      thinkCollapseDelay: THINK_COLLAPSE_DELAY_DEFAULT_S,
      mindmapSpinSpeed: MINDMAP_SPIN_SPEED_DEFAULT_X,
      mindmapHoverColor: undefined,
      mindmapSelectedColor: undefined,
      mindmapHeadColor: undefined,
      mindmapEndColor: undefined,
      mindmapMountBulge: MINDMAP_MOUNT_BULGE_DEFAULT_X,
      fileColors: {},
      highlightPresets: {},
      previewRight: PREVIEW_RIGHT_DEFAULT,
    }),
    persist: EXPLORER_SETTINGS_STORE_KEY,
    actions: {
      setRowHeight: (draft, value) => { draft.rowHeight = clamp(value, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX) },
      setChatFontSize: (draft, value) => { draft.chatFontSize = clamp(value, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX) },
      setConflictFontSize: (draft, value) => { draft.conflictFontSize = clamp(value, CONFLICT_FONT_SIZE_MIN, CONFLICT_FONT_SIZE_MAX) },
      setWrap: (draft, value) => { draft.wrap = Boolean(value) },
      setExpandSearchMatches: (draft, value) => { draft.expandSearchMatches = Boolean(value) },
      setAutoExpandThink: (draft, value) => { draft.autoExpandThink = Boolean(value) },
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
    },
  })
}
class LayoutController { attach(actions){this.actions=actions} requireActions(){if(!this.actions)throw new Error('workspace-studio: root store actions are not attached');return this.actions} toggleSidebar(){this.requireActions().toggleSidebar()} openDetails(){this.requireActions().openDetails()} closeDetails(){this.requireActions().closeDetails()} }

const EMPTY_EDITOR_CONTEXT_VIEW = Object.freeze({ present: false, active: false })
class EditorContextController {
  constructor() {
    this.records = new Map()
    this.disabledSessions = new Set()
    this.stores = new Map()
    // Last published context per session id: activation restores a session's
    // own value only, never a foreign session's.
    this.latest = new Map()
  }
  active(sessionId) { return this.records.has(sessionId) && !this.disabledSessions.has(sessionId) }
  storeFor(sessionId) {
    let store = this.stores.get(sessionId)
    if (store !== undefined) return store
    store = createSnapshotStore(this.project(sessionId))
    this.stores.set(sessionId, store)
    return store
  }
  project(sessionId) {
    const record = this.records.get(sessionId)
    if (record === undefined) return EMPTY_EDITOR_CONTEXT_VIEW
    return Object.freeze({
      present: true,
      active: !this.disabledSessions.has(sessionId),
      path: record.path,
      selection: record.selection === undefined ? undefined : Object.freeze({
        startLine: record.selection.startLine,
        startColumn: record.selection.startColumn,
        endLine: record.selection.endLine,
        endColumn: record.selection.endColumn,
      }),
    })
  }
  update(sessionId, value) {
    if (value === undefined) {
      this.latest.delete(sessionId)
      this.records.delete(sessionId)
    } else {
      this.latest.set(sessionId, value)
      this.records.set(sessionId, Object.freeze({
        ...value,
        ...(value.selection === undefined ? {} : { selection: Object.freeze({ ...value.selection }) }),
      }))
    }
    this.stores.get(sessionId)?.set(this.project(sessionId))
  }
  toggle(sessionId) {
    if (this.disabledSessions.has(sessionId)) this.disabledSessions.delete(sessionId)
    else this.disabledSessions.add(sessionId)
    this.stores.get(sessionId)?.set(this.project(sessionId))
  }
  activate(sessionId) {
    // Restore only this session's own last published context; a foreign
    // session's value must never leak into the session being activated.
    const own = this.latest.get(sessionId)
    if (own !== undefined) this.update(sessionId, own)
    this.stores.get(sessionId)?.set(this.project(sessionId))
  }
  retain(sessionIds) {
    const live = new Set(sessionIds)
    for (const sessionId of this.records.keys()) if (!live.has(sessionId)) this.records.delete(sessionId)
    for (const sessionId of this.disabledSessions) if (!live.has(sessionId)) this.disabledSessions.delete(sessionId)
    for (const sessionId of this.latest.keys()) if (!live.has(sessionId)) this.latest.delete(sessionId)
    for (const [sessionId, store] of this.stores) {
      if (live.has(sessionId)) continue
      store.set(EMPTY_EDITOR_CONTEXT_VIEW)
      this.stores.delete(sessionId)
    }
  }
  snapshot(sessionId) {
    const record = this.records.get(sessionId)
    if (record === undefined || this.disabledSessions.has(sessionId)) return undefined
    if (record.symlink) throw new Error(translate('context.symlinkError'))
    const common = {
      kind: 'workspace-editor',
      version: 1,
      workspaceId: record.workspaceId,
      path: record.path,
    }
    if (record.selection === undefined) return { ...common, mode: 'path' }
    const bytes = new TextEncoder().encode(record.selection.text).byteLength
    if (Number.isFinite(record.maxContextBytes) && bytes > record.maxContextBytes) {
      throw new Error(translate('context.tooLarge', { size: formatBytes(bytes), limit: formatBytes(record.maxContextBytes) }))
    }
    return {
      ...common,
      mode: 'selection',
      // The decode encoding the editor displayed; the server verifies a clean
      // selection against this same decode.
      encoding: record.encoding,
      dirty: record.dirty,
      ...(record.revision === undefined ? {} : { revision: record.revision }),
      selection: { ...record.selection },
    }
  }
  dispose() {
    this.latest.clear()
    this.records.clear()
    this.disabledSessions.clear()
    for (const store of this.stores.values()) store.set(EMPTY_EDITOR_CONTEXT_VIEW)
    this.stores.clear()
  }
}

function EditorContextPrefix({ useEditorContext, useSessions, toggle, ensureSession, sessionId }) {
  const rowRef = useRef(null)
  const [queueDockGap, setQueueDockGap] = useState(0)
  const context = useEditorContext(value => value)
  const direct = useSessions(state => state.byId[sessionId] !== undefined && state.byId[sessionId].origin !== 'subagent')
  useEffect(() => { ensureSession(String(sessionId)) }, [ensureSession, sessionId])
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row === null) return
    const parent = row.parentElement
    if (parent === null) return
    const updateGap = () => {
      const prev = row.previousElementSibling
      setQueueDockGap(prev instanceof HTMLElement && prev.hasAttribute('data-queue-dock') ? 9 : 0)
    }
    updateGap()
    const observer = new MutationObserver(updateGap)
    observer.observe(parent, { childList: true })
    return () => { observer.disconnect() }
  }, [context.present, direct])
  if (!context.present || !direct) return null
  const range = context.selection === undefined
    ? ''
    : ` · L${context.selection.startLine}:C${context.selection.startColumn}-L${context.selection.endLine}:C${context.selection.endColumn}`
  const label = `${context.path}${range}`
  const title = context.active
    ? translate('context.active', { path: label })
    : translate('context.inactive', { path: label })
  return h('div', { className: 'dsh-ws-context-row', ref: rowRef, style: queueDockGap === 0 ? undefined : { marginTop: `${queueDockGap}px` } },
    h('button', {
      'aria-label': title,
      'aria-pressed': context.active,
      className: 'dsh-ws-context-prefix',
      'data-inactive': !context.active || undefined,
      onClick: toggle,
      title,
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-ws-context-prefix-mark' }, context.active ? '↳' : '○'),
    h('span', { className: 'dsh-ws-context-prefix-label' }, label)))
}

const OPENED_FILE_PREFIX = '<opened_file>The user opened the file '
const OPENED_FILE_SUFFIX = ' in the IDE. This may or may not be related to the current task.</opened_file>'
const SELECTION_PREFIX = '<selection>The user selected the lines '
const SELECTION_TRAILER = 'This may or may not be related to the current task.'
const SELECTION_CLOSE = '</selection>'
const MESSAGE_CONTEXT_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-pending-steering]'
const MESSAGE_CONTEXT_SUMMARY_ATTR = 'data-dsh-ws-message-context-summary'
const pendingEditorContextDisplays = new Map()
/* The queue is consumed only when the message actually mounts and is
   compacted; a session switch, a rendered-text mismatch, or a skipped
   fast-path can leave an entry pending forever. Bound the total so a long
   session cannot grow this module-level map without limit — the oldest pending
   display is dropped first (the envelope still renders; only the rich summary
   is lost, the same outcome as a never-consumed entry). */
const MAX_PENDING_CONTEXT_DISPLAYS = 256
let pendingContextDisplayCount = 0

function rememberEditorContextDisplay(text, display) {
  if (pendingContextDisplayCount >= MAX_PENDING_CONTEXT_DISPLAYS && !pendingEditorContextDisplays.has(text)) {
    const oldest = pendingEditorContextDisplays.keys().next().value
    if (oldest !== undefined) {
      const queue = pendingEditorContextDisplays.get(oldest)
      pendingContextDisplayCount -= queue.length
      pendingEditorContextDisplays.delete(oldest)
    }
  }
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined) pendingEditorContextDisplays.set(text, [display])
  else queue.push(display)
  pendingContextDisplayCount += 1
}

function consumeEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return null
  const display = queue.shift()
  pendingContextDisplayCount -= 1
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
  return display ?? null
}

function discardLastEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return
  queue.pop()
  pendingContextDisplayCount -= 1
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
}

function clearEditorContextDisplays() {
  pendingEditorContextDisplays.clear()
  pendingContextDisplayCount = 0
}

function promptRemainder(text, end) {
  const rest = text.slice(end)
  if (rest.startsWith('\r\n\r\n')) return rest.slice(4)
  if (rest.startsWith('\n\n')) return rest.slice(2)
  return rest
}

function displayFileName(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function displayLineRange(startLine, endLine) {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
}

function displaySelectionRange(selection) {
  return `L${selection.startLine}:C${selection.startColumn}-L${selection.endLine}:C${selection.endColumn}`
}

function describeEditorContext(context, raw) {
  const fileName = displayFileName(context.path)
  if (context.selection === undefined) {
    return { path: context.path, fileName, range: null, title: context.path, raw }
  }
  const range = displaySelectionRange(context.selection)
  return { path: context.path, fileName, range, title: `${context.path} · ${range}`, raw }
}

function parseOpenedFileContext(text) {
  if (!text.startsWith(OPENED_FILE_PREFIX)) return null
  const suffixAt = text.indexOf(OPENED_FILE_SUFFIX, OPENED_FILE_PREFIX.length)
  if (suffixAt < 0) return null
  const path = text.slice(OPENED_FILE_PREFIX.length, suffixAt)
  const end = suffixAt + OPENED_FILE_SUFFIX.length
  return {
    path,
    fileName: displayFileName(path),
    range: null,
    title: path,
    raw: text.slice(0, end),
    visibleText: promptRemainder(text, end),
  }
}

function parseSelectionContext(text) {
  if (!text.startsWith(SELECTION_PREFIX)) return null
  const headerEnd = text.indexOf('\n')
  if (headerEnd < 0) return null
  const header = text.slice(0, headerEnd).replace(/\r$/, '')
  const headerMatch = /^<selection>The user selected the lines (\d+) to (\d+) from (.*):$/.exec(header)
  if (headerMatch === null) return null
  // The envelope ALWAYS closes with the trailer line directly before
  // `</selection>`. Anchor on that exact pair instead of the first
  // `</selection>` so a selected body that itself contains `</selection>`
  // cannot truncate the fold/summary early. lastIndexOf guarantees the
  // envelope's OWN closing pair is used even when the body contains the
  // literal trailer followed by `</selection>`.
  const marker = `${SELECTION_TRAILER}${SELECTION_CLOSE}`
  const markerAt = text.lastIndexOf(marker)
  if (markerAt < 0) return null
  const closeAt = markerAt + marker.length - SELECTION_CLOSE.length
  const body = text.slice(headerEnd + 1, closeAt)
  if (!body.endsWith(SELECTION_TRAILER) && !body.endsWith(`\r${SELECTION_TRAILER}`)) return null
  const startLine = Number(headerMatch[1])
  const endLine = Number(headerMatch[2])
  const path = headerMatch[3]
  const end = closeAt + SELECTION_CLOSE.length
  return {
    path,
    fileName: displayFileName(path),
    range: displayLineRange(startLine, endLine),
    title: `${path} · ${displayLineRange(startLine, endLine)}`,
    raw: text.slice(0, end),
    visibleText: promptRemainder(text, end),
  }
}

function parseEditorContextEnvelope(text) {
  return parseOpenedFileContext(text) ?? parseSelectionContext(text)
}

function findEditorContextBubble(candidate) {
  for (let current = candidate; current instanceof HTMLElement; current = current.parentElement) {
    if (current.parentElement?.parentElement?.hasAttribute('data-time-hover-root')) return current
  }
  return candidate instanceof HTMLElement ? candidate : null
}

function findEditorContextCandidate(container) {
  let candidate = null
  const elements = [container, ...container.querySelectorAll('div,span,p,pre')]
  for (const element of elements) {
    const text = element.textContent ?? ''
    if (text.startsWith(OPENED_FILE_PREFIX) || text.startsWith(SELECTION_PREFIX)) candidate = element
  }
  return candidate
}

function renderEditorContextSummary(bubble, context) {
  const parent = bubble.parentElement
  if (parent === null) return
  let row = bubble.previousElementSibling
  if (!(row instanceof HTMLElement) || !row.hasAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR)) {
    row = document.createElement('div')
    row.setAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR, '')
    row.className = 'dsh-ws-message-context-summary'
    parent.insertBefore(row, bubble)
  }
  row.setAttribute('title', context.raw ?? context.title)
  row.replaceChildren(
    Object.assign(document.createElement('span'), {
      className: 'dsh-ws-message-context-summary-mark',
      textContent: '↳',
    }),
    Object.assign(document.createElement('span'), {
      className: 'dsh-ws-message-context-summary-label',
      textContent: context.fileName,
    }),
    ...(context.range === null ? [] : [Object.assign(document.createElement('span'), {
      className: 'dsh-ws-message-context-summary-range',
      textContent: context.range,
    })]),
  )
}

function installEditorContextMessageCompactor() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  const originals = new Map()
  const compactBubble = (bubble) => {
    const text = bubble.textContent ?? ''
    const context = parseEditorContextEnvelope(text)
    if (context === null) return
    originals.set(bubble, text)
    renderEditorContextSummary(bubble, consumeEditorContextDisplay(text) ?? context)
    bubble.classList.add('dsh-ws-message-context-bubble')
    if (context.visibleText === '') bubble.setAttribute('data-dsh-ws-empty-prompt', '')
    else bubble.removeAttribute('data-dsh-ws-empty-prompt')
    bubble.textContent = context.visibleText
  }
  const compactContainer = (container) => {
    // Fast path: most containers never carry an editor-context envelope; the
    // prefix check skips the element scan for them on every mutation batch
    // (streaming chat mutates character data continuously).
    const text = container.textContent ?? ''
    if (!text.startsWith(OPENED_FILE_PREFIX) && !text.startsWith(SELECTION_PREFIX)) return
    const candidate = findEditorContextCandidate(container)
    const bubble = candidate === null ? null : findEditorContextBubble(candidate)
    if (bubble !== null) compactBubble(bubble)
  }
  const compactAll = () => {
    for (const container of document.querySelectorAll(MESSAGE_CONTEXT_SELECTOR)) compactContainer(container)
    /* Release bubbles that left the document (message cleared, session
       removed): their DOM refs and full text must not accumulate until the
       plugin is disposed. */
    for (const bubble of originals.keys()) {
      if (!bubble.isConnected) originals.delete(bubble)
    }
  }
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      compactAll()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  compactAll()
  return () => {
    observer.disconnect()
    clearEditorContextDisplays()
    for (const [bubble, text] of originals) {
      if (!bubble.isConnected) continue
      const summary = bubble.previousElementSibling
      if (summary instanceof HTMLElement && summary.hasAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR)) summary.remove()
      bubble.classList.remove('dsh-ws-message-context-bubble')
      bubble.removeAttribute('data-dsh-ws-empty-prompt')
      bubble.textContent = text
    }
    originals.clear()
  }
}

class ThemePresenter { constructor(){this.appliedTokens=[];this.themeColorMeta=document.createElement('meta');this.themeColorMeta.name='theme-color'} apply(snapshot){const scheme=snapshot.active.colorScheme;document.documentElement.style.colorScheme=scheme;const body=document.body;scheme==='dark'?body.setAttribute('data-ds-dark-theme',''):body.removeAttribute('data-ds-dark-theme');for(const token of this.appliedTokens)body.style.removeProperty(token);this.appliedTokens=[];for(const [token,value] of Object.entries(snapshot.active.tokens)){body.style.setProperty(token,value);this.appliedTokens.push(token)}this.themeColorMeta.content=getComputedStyle(body).backgroundColor;if(!this.themeColorMeta.isConnected)document.head.append(this.themeColorMeta)} dispose(){document.documentElement.style.removeProperty('color-scheme');const body=document.body;body.removeAttribute('data-ds-dark-theme');for(const token of this.appliedTokens)body.style.removeProperty(token);this.appliedTokens=[];this.themeColorMeta.remove()} }
/* Resolve the workspace a session belongs to — membership first, then the
   session cwd path — the same selection AppFrame uses for the explorer. */
function workspaceOfSession(ctx, id) {
  const row = ctx.sessions.list.getSnapshot().byId[id]
  const items = ctx.get('workspaces')?.list.getSnapshot().items ?? []
  if (row !== undefined) {
    const byMembership = items.find(item => item.sessionIds.includes(id))
    if (byMembership !== undefined) return byMembership
  }
  if (row?.cwd !== undefined) {
    const byPath = items.find(item => item.path === row.cwd)
    if (byPath !== undefined) return byPath
  }
  return undefined
}
class PromptContextBridge {
  constructor(ctx, editorContexts) {
    this.ctx = ctx
    this.editorContexts = editorContexts
    this.inputPatches = new Map()
    this.contextOnlyInFlight = new Set()
    this.sendTails = new Map()
    this.pendingControllers = new Set()
    this.notifiedErrors = new WeakSet()
    this.conversation = undefined
    this.originalSendSession = undefined
    this.wrappedSendSession = undefined
  }
  install() {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) return () => {}
    this.conversation = conversation
    this.originalSendSession = conversation.sendSession
    if (typeof this.originalSendSession !== 'function') {
      this.conversation = undefined
      this.originalSendSession = undefined
      throw new Error('workspace-studio requires the Harness 0.1.x conversation.sendSession seam')
    }
    const bridge = this
    const wrappedSendSession = async function sendSessionWithEditorContext(session, text, imageIds, mode) {
      return bridge.sendSessionWithEditorContext(session, text, imageIds, mode)
    }
    Object.defineProperty(wrappedSendSession, SEND_SESSION_BRIDGE_MARKER, { value: true })
    this.wrappedSendSession = wrappedSendSession
    conversation.sendSession = wrappedSendSession
    const reconcile = () => bridge.reconcile()
    const off = this.ctx.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      off()
      for (const [id, patch] of bridge.inputPatches) bridge.restoreInput(id, patch)
      bridge.inputPatches.clear()
      bridge.contextOnlyInFlight.clear()
      for (const controller of bridge.pendingControllers) controller.abort()
      bridge.pendingControllers.clear()
      bridge.sendTails.clear()
      clearEditorContextDisplays()
      // Cordis returns a fresh trace proxy for each service-method read, so
      // comparing `conversation.sendSession` by identity cannot detect our wrapper.
      const currentSendSession = conversation.sendSession
      if (currentSendSession?.[SEND_SESSION_BRIDGE_MARKER] === true) {
        conversation.sendSession = bridge.originalSendSession
      }
      bridge.conversation = undefined
      bridge.originalSendSession = undefined
      bridge.wrappedSendSession = undefined
    }
  }
  async sendSessionWithEditorContext(session, text, imageIds, mode) {
    const sessionId = String(session.sessionId)
    if (!this.directSession(sessionId)) {
      if (text === '' && imageIds.length === 0) return
      if (this.conversation === undefined || this.originalSendSession === undefined) return
      return this.originalSendSession.call(this.conversation, session, text, imageIds, mode)
    }
    let context
    try {
      context = this.editorContexts.snapshot(sessionId)
    } catch (error) {
      this.notify(sessionId, error)
      throw error
    }
    return this.enqueue(sessionId, async (signal) => {
      if (signal.aborted || this.conversation === undefined || this.originalSendSession === undefined) throw new Error(translate('context.canceled'))
      if (context === undefined) {
        if (text === '' && imageIds.length === 0) return
        return this.originalSendSession.call(this.conversation, session, text, imageIds, mode)
      }
      let rendered
      try {
        rendered = await renderContext(session.sessionId, context, signal)
      } catch (error) {
        if (error?.name !== 'AbortError') this.notify(sessionId, error)
        throw error
      }
      const combined = text === '' ? rendered : `${rendered}\n\n${text}`
      const display = describeEditorContext(context, rendered)
      rememberEditorContextDisplay(combined, display)
      try {
        return await this.originalSendSession.call(this.conversation, session, combined, imageIds, mode)
      } catch (error) {
        discardLastEditorContextDisplay(combined)
        throw error
      }
    })
  }
  /* The /init command (Claude Code style): resolve the session's workspace
     and hand the model a generation instruction so the agent analyzes the
     workspace and writes AGENTS.md at its root. Errors surface in the
     popupSelect shell (its error strip keeps the shell open for retry). */
  async runInitCommand(id) {
    if (this.conversation === undefined || this.originalSendSession === undefined) {
      throw new Error(translate('init.error.send-failed', { message: 'conversation seam unavailable' }))
    }
    const workspace = workspaceOfSession(this.ctx, id)
    if (workspace === undefined) throw new Error(translate('init.error.no-workspace'))
    const binding = this.ctx.sessions.binding(id)
    const session = binding?.session
    if (session === undefined) {
      throw new Error(translate('init.error.send-failed', { message: 'session unavailable' }))
    }
    const text = translate('init.prompt', { root: workspace.path })
    return this.originalSendSession.call(this.conversation, session, text, [], 'queue')
  }
  enqueue(id, operation) {
    const controller = new AbortController()
    this.pendingControllers.add(controller)
    const previous = this.sendTails.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(() => operation(controller.signal))
    this.sendTails.set(id, pending)
    return pending.finally(() => {
      controller.abort()
      this.pendingControllers.delete(controller)
      if (this.sendTails.get(id) === pending) this.sendTails.delete(id)
    })
  }
  directSession(id) {
    const row = this.ctx.sessions.list.getSnapshot().byId[id]
    return row !== undefined && row.origin !== 'subagent'
  }
  reconcile() {
    const list = this.ctx.sessions.list.getSnapshot()
    for (const id of list.ids) if (this.directSession(String(id))) this.ensure(String(id))
    for (const [id, patch] of this.inputPatches) {
      if (!list.ids.some(candidate => String(candidate) === id) || !this.directSession(id)) this.restoreInput(id, patch)
    }
  }
  ensure(id) {
    if (this.inputPatches.has(id)) return
    // Missing seams must never escape into the sessions-list subscription
    // dispatch (a throw there could break later subscribers); the session
    // simply keeps its original input behavior.
    try {
      const binding = this.ctx.sessions.binding(id)
      if (binding === undefined || this.conversation === undefined) return
      const input = this.conversation.input.for(binding.ctx)
      const original = input.submit
      const originalSteerQueue = input.steerQueue
      if (typeof original !== 'function' || typeof originalSteerQueue !== 'function') {
        console.error(`workspace-studio: session ${id} input submit/steer seams unavailable; editor context will not attach`)
        return
      }
      const bridge = this
      const wrapper = function submitWithEditorContext(mode = 'queue') {
        const state = input.state.getSnapshot()
        if (bridge.directSession(id) && state.draft.trim() === '' && state.imageIds.length === 0 && bridge.editorContexts.active(id)) {
          void bridge.sendContextOnly(id, mode)
          return
        }
        return original.call(input, mode)
      }
      const steerWrapper = function steerQueueWithEditorContext() {
        const state = input.state.getSnapshot()
        if (bridge.directSession(id) && state.draft.trim() === '' && state.imageIds.length === 0 && bridge.editorContexts.active(id)) {
          void bridge.sendContextOnly(id, 'steer')
          return
        }
        return originalSteerQueue.call(input)
      }
      input.submit = wrapper
      input.steerQueue = steerWrapper
      this.inputPatches.set(id, { input, original, wrapper, originalSteerQueue, steerWrapper })
    } catch (error) {
      console.error(`workspace-studio: failed to patch input seams for session ${id}:`, error)
    }
  }
  restoreInput(id, patch) {
    if (patch.input.submit === patch.wrapper) patch.input.submit = patch.original
    if (patch.input.steerQueue === patch.steerWrapper) patch.input.steerQueue = patch.originalSteerQueue
    this.inputPatches.delete(id)
  }
  async sendContextOnly(id, mode) {
    if (!this.directSession(id) || this.contextOnlyInFlight.has(id)) return
    const binding = this.ctx.sessions.binding(id)
    if (binding === undefined) return
    this.contextOnlyInFlight.add(id)
    try {
      await this.sendSessionWithEditorContext(binding.session, '', [], mode)
    } catch (error) {
      if (error?.name !== 'AbortError') this.notify(id, error)
    } finally {
      this.contextOnlyInFlight.delete(id)
    }
  }
  notify(id, error) {
    if (error !== null && typeof error === 'object') {
      if (this.notifiedErrors.has(error)) return
      this.notifiedErrors.add(error)
    }
    const patch = this.inputPatches.get(id)
    const message = error instanceof Error ? error.message : String(error)
    patch?.input.notify('error', message)
  }
}
class WorkspaceApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'WorkspaceApiError'
    this.code = code
    this.status = status
  }
}
async function requestJson(endpoint, workspaceId, path, signal, encoding) {
  const query = new URLSearchParams({ workspaceId, path })
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const response = await fetch(`${API_PREFIX}/${endpoint}?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.tree', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'request-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.request-failed', { status: response.status }), response.status)
  }
  return payload
}
async function putFile(workspaceId, path, content, revision, signal, encoding) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const headers = { 'content-type': 'text/plain; charset=utf-8', accept: 'application/json' }
  if (revision !== undefined && revision !== null) headers['if-match'] = String(revision)
  const response = await fetch(`${API_PREFIX}/file?${query}`, { method: 'PUT', headers, credentials: 'same-origin', body: content, signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.save', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'save-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.save-failed', { status: response.status }), response.status)
  }
  return payload
}
// Mind-map document API: the 导图 conversation view is backed by a persisted
// per-root-session document (trunk turns + fork branches) the Host builds by
// reverse-parsing the FULL session logs — the single source of truth. The
// client only re-syncs (folding new turns from the full logs) and persists
// structural changes (forks, branch removal).
async function mindmapRequest(endpoint, options) {
  const { method = 'GET', body, signal } = options ?? {}
  const response = await fetch(`${API_PREFIX}/mindmap-doc${endpoint}`, {
    method,
    headers: body === undefined
      ? { accept: 'application/json' }
      : { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.tree', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'request-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.request-failed', { status: response.status }), response.status)
  }
  return payload
}
const fetchMindmapDoc = (sessionId, signal) => mindmapRequest(`?sessionId=${encodeURIComponent(String(sessionId))}`, { method: 'GET', signal })
const writeMindmapDoc = (sessionId, doc, signal, prevSessionId) => mindmapRequest(`?sessionId=${encodeURIComponent(String(sessionId))}`, {
  method: 'POST',
  body: prevSessionId === undefined || prevSessionId === null
    ? { sessionId: String(sessionId), doc }
    : { sessionId: String(sessionId), doc, prevSessionId: String(prevSessionId) },
  signal,
})
const syncMindmapDoc = (sessionId, liveSessionIds, signal) => {
  const ids = Array.isArray(liveSessionIds) ? liveSessionIds.map(String) : []
  return mindmapRequest('/sync', {
    method: 'POST',
    // The singular field lets an older Host serve the first live card during a
    // rolling update; the current Host prefers the plural field below.
    body: ids.length > 0
      ? { sessionId: String(sessionId), liveSessionIds: ids, liveSessionId: ids[0] }
      : { sessionId: String(sessionId) },
    signal,
  })
}
const fetchMindmapDocIndex = signal => mindmapRequest('/index', { method: 'GET', signal })
const deleteMindmapDoc = (sessionId, signal) => mindmapRequest(`?sessionId=${encodeURIComponent(String(sessionId))}`, { method: 'DELETE', signal })
/* Rename only the map's OWN title (doc.rootTitle) on the Host — a targeted
   update instead of the GET-then-POST full-doc round trip, which could clobber
   a turn a concurrent sync had just folded in the window between the two. */
const renameMindmapDoc = (sessionId, title, signal) => mindmapRequest('/rename', {
  method: 'POST',
  body: { sessionId: String(sessionId), title },
  signal,
})

/* Module-wide mind-map index registry: the sidebar mind-map panel and the
   branch hider both need to know which sessions belong to a mind map (roots +
   documented branches), but they cannot fetch on every render. A background
   refresh keeps the index current; components subscribe via
   useSyncExternalStore and the hider reads the sets synchronously. */
const mindmapRegistry = {
  _docs: [],
  _roots: new Set(),
  _branches: new Set(),
  _version: 0,
  _listeners: new Set(),
  _timer: 0,
  _inflight: null,
  _signature: undefined,
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getVersion() { return this._version },
  getDocs() { return this._docs },
  isRoot(id) { return this._roots.has(String(id)) },
  isBranch(id) { return this._branches.has(String(id)) },
  isMember(id) { const key = String(id); return this._roots.has(key) || this._branches.has(key) },
  _apply(docs) {
    /* The 5 s poll returns the same index over and over; only a signature
       change (a doc added/removed, a rootTitle rename, a fork changing the
       branch set, or an updatedAt bump from a folded turn) may bump the
       version and re-render the subscribers — an unconditional notify made
       the sidebar panel and the hider re-run on every idle poll. updatedAt
       is included so a doc that just gained a turn re-sorts to the top of
       its sidebar group. */
    const signature = docs
      .map(doc => `${String(doc.sessionId)}\u0001${String(doc.rootTitle ?? '')}\u0001${(doc.branchSessionIds ?? []).map(String).sort().join(',')}\u0001${Number(doc.updatedAt) || 0}`)
      .sort()
      .join('\u0002')
    if (signature === this._signature) return
    this._signature = signature
    this._docs = docs
    this._roots = new Set()
    this._branches = new Set()
    for (const doc of docs) {
      this._roots.add(String(doc.sessionId))
      for (const id of doc.branchSessionIds ?? []) this._branches.add(String(id))
    }
    this._version += 1
    for (const listener of [...this._listeners]) listener()
  },
  async refresh() {
    if (this._inflight !== null) return this._inflight
    const pending = fetchMindmapDocIndex()
      .then((payload) => {
        this._apply(Array.isArray(payload?.docs) ? payload.docs : [])
        return payload
      })
      .catch(() => { /* keep the last known index */ })
      .finally(() => { this._inflight = null })
    this._inflight = pending
    return pending
  },
  start() {
    if (this._timer !== 0) return
    void this.refresh()
    this._timer = window.setInterval(() => { void this.refresh() }, MINDMAP_INDEX_REFRESH_MS)
  },
  stop() {
    if (this._timer !== 0) { window.clearInterval(this._timer); this._timer = 0 }
  },
  markDirty() { void this.refresh() },
}
function useMindmapRegistry() {
  /* Arrow-wrapped so React's bare invocation cannot drop `this` off the
     method references (a naked method reference would make subscribe read
     `undefined._listeners` and crash the root slot on mount). */
  useSyncExternalStore(
    listener => mindmapRegistry.subscribe(listener),
    () => mindmapRegistry.getVersion(),
  )
  return mindmapRegistry
}

/* Module-wide floating mind-map overlay state: which session's mind map is
   shown as the left-side floating window while the chat column stays visible
   on the right. Driven by the session-header 导图 button, the sidebar mind-map
   entries, and card clicks inside the map; AppFrame renders the window. The
   snapshot is replaced only on change so useSyncExternalStore sees a stable
   reference between updates. */
const mindmapOverlayStore = {
  _snapshot: { open: false, sessionId: null, scope: 'full' },
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getSnapshot() { return this._snapshot },
  _set(open, sessionId) {
    if (this._snapshot.open === open && this._snapshot.sessionId === sessionId) return
    this._snapshot = { open, sessionId, scope: this._snapshot.scope }
    for (const listener of [...this._listeners]) listener()
  },
  open(sessionId) { this._set(true, String(sessionId)) },
  close() { this._set(false, null) },
  toggle(sessionId) {
    const next = String(sessionId)
    if (this._snapshot.open && this._snapshot.sessionId === next) this._set(false, null)
    else this._set(true, next)
  },
  /* Move the highlight inside an open map (the same document family) when a
     card click switches the right-side conversation to another session. */
  setSession(sessionId) {
    if (!this._snapshot.open) return
    this._set(true, String(sessionId))
  },
  /* Window scope: 'full' covers everything left of the chat column (sidebar +
     file browser), 'sidebar' only the sidebar column. A view preference kept
     across open/close and session switches while the app is alive (not
     persisted). */
  toggleScope() {
    this._snapshot = {
      ...this._snapshot,
      scope: this._snapshot.scope === 'sidebar' ? 'full' : 'sidebar',
    }
    for (const listener of [...this._listeners]) listener()
  },
}
function useMindmapOverlay() {
  /* Arrow-wrapped, same `this` trap as useMindmapRegistry above. */
  useSyncExternalStore(
    listener => mindmapOverlayStore.subscribe(listener),
    () => mindmapOverlayStore.getSnapshot(),
  )
  return mindmapOverlayStore.getSnapshot()
}

/* Per-group sidebar order of mind-map entries, persisted in localStorage
   (a small id list per group key; a workspace rename loses the mapping and
   entries fall back to their default order — accepted trade-off). */
const MINDMAP_ORDER_STORE_KEY = 'dsh.workspace.studio.mindmap-order.v1'
function readMindmapOrder() {
  try {
    const raw = window.localStorage.getItem(MINDMAP_ORDER_STORE_KEY)
    if (raw === null || raw === '') return {}
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
function writeMindmapOrder(map) {
  try { window.localStorage.setItem(MINDMAP_ORDER_STORE_KEY, JSON.stringify(map)) } catch { /* quota / private mode */ }
}
// Draft (staging) file access: while editing, the temporary content lives in a
// draft file outside the workspace (~/.dsh-plugin/.../drafts), never in the
// source file. The draft JSON carries { path, encoding, lineEnding, bom,
// baseText, baseRevision, draft, owner, generation } so a page refresh can
// restore the whole editing session (content + snapshot) without localStorage.
// The owner is the session scope; the Host's generation fence rejects stale
// writes from a discarded or previous mount.
async function readDraft(workspaceId, path, signal, owner) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (owner !== undefined && owner !== null) query.set('owner', String(owner))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'draft-read-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.draft-failed', { status: response.status }), response.status)
  }
  return payload
}
async function writeDraft(workspaceId, path, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (payload.owner !== undefined && payload.owner !== null) query.set('owner', String(payload.owner))
  if (payload.generation !== undefined && payload.generation !== null) query.set('generation', String(payload.generation))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...payload, path }), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = result?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'draft-write-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.draft-failed', { status: response.status }), response.status)
  }
  return result
}
async function deleteDraft(workspaceId, path, signal, owner, generation) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (owner !== undefined && owner !== null) query.set('owner', String(owner))
  if (generation !== undefined && generation !== null) query.set('generation', String(generation))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'DELETE', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = result?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'draft-delete-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.draft-failed', { status: response.status }), response.status)
  }
  return result
}
async function requestDraftTree(workspaceId, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId) })
  const response = await fetch(`${API_PREFIX}/draft-tree?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = result?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'draft-tree-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.draft-failed', { status: response.status }), response.status)
  }
  return result
}

/* IndexedDB mirrors the newest dirty snapshot immediately. Host drafts remain
   the long-lived authority, but an unload cannot reliably finish a 1 MiB
   fetch; the local mirror closes that durability gap and is reconciled on
   restore. */
const EMERGENCY_DRAFT_DB = 'dsh-workspace-studio'
const EMERGENCY_DRAFT_STORE = 'drafts-v1'
let emergencyDraftDbPromise
const emergencyDraftTails = new Map()
function emergencyDraftKey(workspaceId, scopeId, path) {
  return JSON.stringify([String(workspaceId), String(scopeId), path])
}
/* Tombstones (state: 'deleted') exist only to suppress restoring a discarded
   draft; they are reclaimed after a retention window so the emergency IndexedDB
   mirror cannot grow without bound. Live (non-deleted) records are the user's
   unsaved work and are never pruned here. */
const EMERGENCY_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
let emergencyDraftPruneScheduled = false
async function pruneEmergencyDrafts() {
  const db = await openEmergencyDraftDb()
  if (db === undefined) return
  const cutoff = Date.now() - EMERGENCY_DRAFT_RETENTION_MS
  await new Promise((resolvePrune, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readwrite')
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      for (const value of request.result ?? []) {
        if (value?.state === 'deleted' && Number(value.updatedAt) < cutoff) store.delete(value.key)
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft prune failed')) }
    transaction.oncomplete = () => { resolvePrune() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft prune failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft prune aborted')) }
  })
}
function openEmergencyDraftDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined)
  if (emergencyDraftDbPromise !== undefined) return emergencyDraftDbPromise
  emergencyDraftDbPromise = new Promise((resolveDb, reject) => {
    let request
    try {
      request = indexedDB.open(EMERGENCY_DRAFT_DB, 1)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EMERGENCY_DRAFT_STORE)) {
        request.result.createObjectStore(EMERGENCY_DRAFT_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      resolveDb(request.result)
      /* One best-effort sweep per page load: reclaim expired tombstones without
         touching live drafts. */
      if (!emergencyDraftPruneScheduled) {
        emergencyDraftPruneScheduled = true
        void pruneEmergencyDrafts().catch(() => {})
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB open failed')) }
    request.onblocked = () => { reject(new Error('IndexedDB upgrade blocked')) }
  }).catch(error => {
    emergencyDraftDbPromise = undefined
    throw error
  })
  return emergencyDraftDbPromise
}
async function emergencyDraftRequest(mode, operation) {
  const db = await openEmergencyDraftDb()
  if (db === undefined) return undefined
  return new Promise((resolveRequest, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, mode)
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    let request
    let result
    try {
      request = operation(store)
    } catch (error) {
      reject(error)
      return
    }
    if (request !== undefined) {
      request.onsuccess = () => { result = request.result }
      request.onerror = () => { reject(request.error ?? new Error('IndexedDB request failed')) }
    }
    transaction.oncomplete = () => { resolveRequest(result) }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB transaction failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB transaction aborted')) }
  })
}
function queueEmergencyDraft(key, operation) {
  const previous = emergencyDraftTails.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  emergencyDraftTails.set(key, current)
  const cleanup = () => { if (emergencyDraftTails.get(key) === current) emergencyDraftTails.delete(key) }
  current.then(cleanup, cleanup)
  return current
}
function writeEmergencyDraft(workspaceId, scopeId, path, payload) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  /* Spread the payload FIRST so the record's identity fields always win: a
     payload carrying its own path must never override the `path` (and key)
     the record was derived from, or restore/rewrite would operate on
     inconsistent records. */
  const value = { ...payload, key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, updatedAt: Date.now() }
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readwrite', store => store.put(value)))
}
async function readEmergencyDraft(workspaceId, scopeId, path) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  await (emergencyDraftTails.get(key) ?? Promise.resolve()).catch(() => {})
  return emergencyDraftRequest('readonly', store => store.get(key))
}
function deleteEmergencyDraft(workspaceId, scopeId, path, generation) {
  const key = emergencyDraftKey(workspaceId, scopeId, path)
  const tombstone = { key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, state: 'deleted', generation, updatedAt: Date.now() }
  // Keep a tombstone rather than deleting immediately: a failed/late restore
  // must not resurrect a draft that the user explicitly discarded.
  return queueEmergencyDraft(key, () => emergencyDraftRequest('readwrite', store => store.put(tombstone)))
}
async function rewriteEmergencyDraftPath(workspaceId, scopeId, from, to) {
  await Promise.all([...emergencyDraftTails.values()].map(tail => tail.catch(() => {})))
  const db = await openEmergencyDraftDb()
  if (db === undefined) return
  const readAll = () => new Promise((resolveRead, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readonly')
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    const request = store.getAll()
    request.onsuccess = () => { resolveRead(request.result ?? []) }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite aborted')) }
  })
  const all = await readAll()
  const rewrites = []
  for (const value of all) {
    if (value.workspaceId !== String(workspaceId) || value.scopeId !== String(scopeId)) continue
    const path = rewriteRelativePath(value.path, from, to)
    if (path === value.path) continue
    rewrites.push({ oldKey: value.key, value: { ...value, key: emergencyDraftKey(workspaceId, scopeId, path), path, updatedAt: Date.now() } })
  }
  if (rewrites.length === 0) return
  /* Destination collision handling: an existing record at the moved record's
     new key must not be blindly overwritten — keep the NEWER side (generation,
     then updatedAt) so a live draft at the destination never loses newer work
     to a moved older record. */
  const destinationByKey = new Map()
  for (const record of all) if (record.key !== undefined) destinationByKey.set(record.key, record)
  const finalized = []
  const seen = new Set()
  for (const rewrite of rewrites) {
    if (seen.has(rewrite.value.key)) continue
    seen.add(rewrite.value.key)
    const existing = destinationByKey.get(rewrite.value.key)
    if (existing !== undefined && existing !== null) {
      const existingGeneration = Number.isSafeInteger(existing.generation) ? existing.generation : -1
      const movedGeneration = Number.isSafeInteger(rewrite.value.generation) ? rewrite.value.generation : -1
      const existingAt = Number(existing.updatedAt) || 0
      const movedAt = Number(rewrite.value.updatedAt) || 0
      if (existingGeneration > movedGeneration || (existingGeneration === movedGeneration && existingAt > movedAt)) {
        finalized.push({ delete: rewrite.oldKey })
        continue
      }
    }
    finalized.push({ delete: rewrite.oldKey, put: rewrite.value })
  }
  if (finalized.length === 0) return
  await new Promise((resolveRewrite, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readwrite')
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    for (const step of finalized) {
      store.delete(step.delete)
      if (step.put !== undefined) store.put(step.put)
    }
    transaction.oncomplete = () => { resolveRewrite() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('IndexedDB draft rewrite aborted')) }
  })
}
async function uploadExternalFile(bytes, name, signal, encoding) {
  const query = new URLSearchParams()
  if (typeof name === 'string' && name !== '') query.set('name', name)
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const response = await fetch(`${API_PREFIX}/external-file?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/octet-stream' }, credentials: 'same-origin', body: bytes, signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.external', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'external-file-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.external-file-failed', { status: response.status }), response.status)
  }
  return payload
}
async function renderContext(sessionId, context, signal) {
  const response = await fetch(`${API_PREFIX}/context`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...context, sessionId: String(sessionId) }), signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'context-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.context-failed', { status: response.status }), response.status)
  }
  if (typeof payload?.text !== 'string') throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context-text'), response.status)
  return payload.text
}
async function mutateEntry(method, workspaceId, path, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/entry?${query}`, { method, headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.entry', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = result?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'entry-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.entry-failed', { status: response.status }), response.status)
  }
  return result
}
async function requestSearch(workspaceId, query, caseSensitive, nameOnly, signal) {
  const params = new URLSearchParams({ workspaceId: String(workspaceId), q: query, caseSensitive: caseSensitive ? 'true' : 'false', nameOnly: nameOnly ? 'true' : 'false' })
  const response = await fetch(`${API_PREFIX}/search?${params}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.search', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'search-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.search-failed', { status: response.status }), response.status)
  }
  return payload
}
async function revealInExplorer(workspaceId, path, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/reveal?${query}`, { method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.reveal', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'reveal-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.reveal-failed.http', { status: response.status }), response.status)
  }
  return payload
}
const createWorkspaceEntry=(workspaceId,path,kind,name,signal)=>mutateEntry('POST',workspaceId,path,{kind,name},signal)
const renameWorkspaceEntry=(workspaceId,path,name,signal)=>mutateEntry('PATCH',workspaceId,path,{name},signal)
async function requestFsOperation(workspaceId, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId) })
  const response = await fetch(`${API_PREFIX}/fs?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.fs', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = result?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'fs-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.fs-failed', { status: response.status }), response.status)
  }
  return result
}
function entryPath(parent, name) { return parent === '' ? name : `${parent}/${name}` }
function pathBaseName(path) { return path.slice(path.lastIndexOf('/') + 1) }
function parentPath(path){const index=path.lastIndexOf('/');return index<0?'':path.slice(0,index)}
function joinAbsolutePath(root,relative){if(typeof root!=='string'||root==='')return relative;if(relative==='')return root;const separator=/^[A-Za-z]:[\\/]/.test(root)?'\\':'/';return `${root.replace(/[\\/]+$/,'')}${separator}${relative.split('/').join(separator)}`}
async function copyText(value){if(typeof navigator!=='undefined'&&typeof navigator.clipboard?.writeText==='function'){try{await navigator.clipboard.writeText(value);return true}catch{/* clipboard API rejects without user gesture or outside secure contexts; fall back to execCommand */}}const textarea=document.createElement('textarea');textarea.value=value;textarea.style.position='fixed';textarea.style.opacity='0';document.body.append(textarea);textarea.select();let ok=false;try{ok=document.execCommand('copy')}catch{/* execCommand throws in unusual embedders; report failure */}textarea.remove();return ok}
function selectedLevelPath(entry){return entry?.kind==='directory'?entry.path:entry?parentPath(entry.path):''}
function defaultEntryName(kind) { return kind === 'directory' ? translate('dialog.newFolder') : translate('dialog.newFileDefault') }
function entryNameError(value) {
  const name = value.trim()
  if (name === '') return translate('entry.nameRequired')
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(name)) return translate('entry.nameInvalid')
  return undefined
}
function entryDialogTitle(dialog) { if (dialog?.mode === 'rename') return translate('dialog.rename'); return dialog?.kind === 'directory' ? translate('dialog.newFolder') : translate('dialog.newFile') }
function entryDialogAction(dialog) { return dialog?.mode === 'rename' ? translate('dialog.rename') : translate('dialog.create') }
function rewriteRelativePath(path,from,to){if(path===from)return to;if(from!==''&&path.startsWith(`${from}/`))return `${to}${path.slice(from.length)}`;return path}
function rewriteEntry(entry,from,to,replacement){if(!entry)return entry;if(entry.path===from)return {...replacement};const path=rewriteRelativePath(entry.path,from,to);return path===entry.path?entry:{...entry,path}}
function rewriteDirectoryMap(current,from,to,replacement){const next=new Map();for(const [path,state]of current){const nextPath=rewriteRelativePath(path,from,to);const entries=Array.isArray(state?.entries)?state.entries.map(entry=>rewriteEntry(entry,from,to,replacement)):state?.entries;next.set(nextPath,{...state,entries})}return next}
function rewritePathSet(current,from,to){const next=new Set();for(const path of current)next.add(rewriteRelativePath(path,from,to));return next}
function rewritePathMap(current,from,to){const next=new Map();for(const [path,value]of current)next.set(rewriteRelativePath(path,from,to),value);return next}
function entryFromPreviewTab(tab) { return { kind: 'file', name: tab.name, path: tab.path, symlink: Boolean(tab.symlink) } }
function clonePreviewTab(tab) {
  if (tab === undefined || tab === null || typeof tab.path !== 'string') return null
  return {
    baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
    baseRevision: typeof tab.baseRevision === 'string' ? tab.baseRevision : null,
    bom: Boolean(tab.bom),
    dirty: Boolean(tab.dirty),
    draft: typeof tab.draft === 'string' ? tab.draft : '',
    // True only when this browser instance holds the tab's actual draft text.
    // Serialized snapshots deliberately reset it because they omit all content.
    draftKnown: Boolean(tab.draftKnown),
    editing: Boolean(tab.editing),
    encoding: typeof tab.encoding === 'string' && tab.encoding !== '' ? tab.encoding : 'utf-8',
    external: Boolean(tab.external),
    lineEnding: typeof tab.lineEnding === 'string' ? tab.lineEnding : 'none',
    name: typeof tab.name === 'string' && tab.name !== '' ? tab.name : tab.path.slice(tab.path.lastIndexOf('/') + 1),
    path: tab.path,
    pinned: Boolean(tab.pinned),
    revision: tab.revision === undefined ? null : tab.revision,
    // The in-flight flag must never be persisted or restored: a refresh
    // mid-save would otherwise bring back a tab stuck in "saving" with every
    // action (close/save/cancel) disabled and no recovery path.
    saving: false,
    scrollTop: Number.isFinite(tab.scrollTop) ? tab.scrollTop : 0,
    size: Number.isFinite(tab.size) ? tab.size : null,
    status: tab.status === undefined || tab.status === null
      ? undefined
      : { error: Boolean(tab.status.error), text: String(tab.status.text ?? '') },
    symlink: Boolean(tab.symlink),
  }
}
/* Persisted copy of a tab: identical to the live clone except clean tabs
 * carry no file text. Persisting every tab's full draft ballooned the store
 * into the localStorage quota, making setItem throw and silently disabling
 * persistence (stale tabs on reload). Clean content equals disk and is
 * re-read on restore; only dirty tabs need their draft to survive. */
function serializePreviewTab(tab) {
  const clone = clonePreviewTab(tab)
  if (clone === null) return null
  // The "Saving…" status only exists while a save is in flight; a persisted
  // copy must not resurrect it as a stale banner after refresh.
  if (tab.saving) clone.status = undefined
  // Dropped non-workspace files are session-only previews: their content lives
  // only in memory (persisting it would re-introduce the localStorage quota
  // blow-up the slim serialization was written to prevent), so refresh drops
  // them and they are excluded from every persisted snapshot.
  if (clone.external) return null
  // localStorage keeps ONLY the dirty marker and tab metadata, never file
  // content or the snapshot (which live in the draft file and are re-read on
  // restore) — dropping content from every tab also keeps the value small.
  // An empty draft can be real user input, so the runtime-only marker tells a
  // live tab apart from this content-free persisted representation.
  clone.baseText = ''
  clone.draft = ''
  clone.draftKnown = false
  return clone
}
/* Cap the stored session count: the freshest key always survives; others keep
 * the PREVIEW_SESSION_MAX most recently updated entries. */
function prunePreviewSessions(draft) {
  const entries = Object.entries(draft.previewSessions ?? {})
  if (entries.length <= PREVIEW_SESSION_MAX) return
  entries.sort((a, b) => (b[1]?.updatedAt ?? -Infinity) - (a[1]?.updatedAt ?? -Infinity))
  for (const [key] of entries.slice(PREVIEW_SESSION_MAX)) delete draft.previewSessions[key]
}
/* Stable partition keeping every pinned tab ahead of all unpinned ones. */
function orderPinnedFirst(tabs) {
  const pinned = []
  const unpinned = []
  for (const tab of tabs) (tab.pinned ? pinned : unpinned).push(tab)
  return [...pinned, ...unpinned]
}
function normalizePreviewSession(value) {
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
function selectStoredPreviewSession(previewSessions, workspace, currentSession, workspaceId) {
  /* Own-key lookup only: a bare `previewSessions[key]` would also match
     prototype-chain keys (constructor/toString). The root may also be missing/
     polluted in localStorage: an undefined/null root must not throw — every
     `has` below short-circuits on it, so the function degrades to an empty
     restore. */
  const has = key => (previewSessions !== null && previewSessions !== undefined)
    && Object.prototype.hasOwnProperty.call(previewSessions, key)
  /* A borrowed template must carry real tabs: an entry holding only tree
     expansion (or a stale empty shell) would restore an empty explorer and
     shadow a later non-empty snapshot in the same workspace. The current
     session's OWN snapshot is exempt — its own (possibly empty) state is the
     correct restore. */
  const restorable = key => {
    const value = previewSessions[key]
    return Array.isArray(value?.tabs) && value.tabs.length > 0
  }
  if (currentSession !== undefined) {
    const currentKey = String(currentSession)
    if (has(currentKey)) return { key: currentKey, value: previewSessions[currentKey] }
    // Restore priority ② (development-notes §2): the first snapshot of any
    // session in this workspace, so a session without its own snapshot still
    // restores the tabs its workspace previously had instead of an empty explorer.
    if (workspace !== undefined) {
      for (const sessionId of workspace.sessionIds) {
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
    for (const sessionId of workspace.sessionIds) {
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
function serializePreviewSession(activePath, tabs, expanded) {
  const seen = new Set()
  const normalized = []
  for (const tab of tabs) {
    if (tab === undefined || tab === null || seen.has(tab.path)) continue
    seen.add(tab.path)
    const serialized = serializePreviewTab(tab)
    if (serialized === null) continue
    normalized.push(serialized)
  }
  // Root ('') is always expanded by default and never stored; only real
  // folders participate in the persisted set.
  const expandedList = expanded === undefined || expanded === null
    ? []
    : [...expanded].filter(path => typeof path === 'string' && path !== '').sort()
  return {
    activePath: activePath !== null && normalized.some(tab => tab.path === activePath) ? activePath : (normalized[0]?.path ?? null),
    tabs: normalized,
    expanded: expandedList,
  }
}
/* Structural identity of a preview snapshot for persistence dedup: what the
   restore actually depends on (active path, tab paths + dirty flags, expanded
   dirs). Volatile fields (status, scrollTop, draft/baseText content) must NOT
   participate — the serialization drops content anyway, and treating
   status/scroll changes as new snapshots would rewrite the store every render,
   remounting the explorer and aborting every in-flight request. */
function previewSnapshotFingerprint(value) {
  const tabs = Array.isArray(value?.tabs) ? value.tabs : []
  // Encoding and the other restored-but-not-volatile metadata participate:
  // switching the display encoding changes ONLY tab.encoding, and a dedup that
  // ignored it would skip the write and revert the decode after a refresh.
  const tabPart = tabs.map(tab =>
    `${tab.path}:${tab.dirty ? 1 : 0}:${tab.pinned ? 1 : 0}:${tab.encoding ?? ''}:${tab.editing ? 1 : 0}:${tab.lineEnding ?? ''}:${tab.bom ? 1 : 0}:${tab.baseRevision ?? ''}`).join(',')
  const expandedPart = Array.isArray(value?.expanded) ? value.expanded.join(',') : ''
  return `${value?.activePath ?? ''}|${tabPart}|${expandedPart}`
}
function dropIndexFromEvent(event) {
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
function rewritePreviewTabs(tabs, from, to, replacement) {
  return tabs.map(tab => rewritePreviewTab(tab, from, to, replacement))
}
function ancestorDirectoryPaths(path) {
  const ancestors = ['']
  const parts = path.split('/').slice(0, -1)
  let cursor = ''
  for (const part of parts) {
    cursor = cursor === '' ? part : `${cursor}/${part}`
    ancestors.push(cursor)
  }
  return ancestors
}
function IconRefresh(){return h('svg',{'aria-hidden':true,fill:'none',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round',strokeWidth:2,viewBox:'0 0 24 24'},h('polyline',{points:'23 4 23 10 17 10'}),h('path',{d:'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'}))}
function IconNewFile(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M4 1.8h5.4L13 5.4v8.8H4z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}),h('path',{d:'M9.2 1.8v3.8H13M8.5 7.4v4.2M6.4 9.5h4.2',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round',strokeWidth:1.3}))}
function IconNewFolder(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M1.8 4.3h4l1.2 1.4h7.2v6.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}),h('path',{d:'M8 7.5v3.8M6.1 9.4h3.8',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
function IconSearch(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('circle',{cx:6.9,cy:6.9,r:4.4,stroke:'currentColor',strokeWidth:1.3}),h('path',{d:'M10.3 10.3 14 14',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
function IconCloseWin10(){return h('svg',{'aria-hidden':true,fill:'none',stroke:'currentColor',strokeLinecap:'square',strokeWidth:1.75,viewBox:'0 0 16 16'},h('path',{d:'M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5'}))}
// VS Code codicon "pin" — official path from microsoft/vscode-codicons.
function IconPinVscode(){return h('svg',{'aria-hidden':true,fill:'currentColor',viewBox:'0 0 16 16'},h('path',{d:'M13.5 3C13.303 3 13.109 3.038 12.923 3.114L8.481 4.967L5.659 4.026C5.505 3.976 5.339 4.001 5.209 4.095C5.078 4.189 5.001 4.339 5.001 4.5V7H1.257L0.5 7.5L1.257 8H5V10.5C5 10.661 5.077 10.812 5.208 10.905C5.338 11 5.504 11.023 5.658 10.974L8.48 10.033L12.925 11.887C13.109 11.962 13.302 12 13.499 12C14.326 12 14.999 11.327 14.999 10.5V4.5C14.999 3.673 14.326 3 13.499 3H13.5ZM14 10.5C14 10.843 13.615 11.09 13.308 10.962L8.693 9.038C8.631 9.013 8.566 9 8.501 9C8.447 9 8.395 9.009 8.343 9.025L6.001 9.806V5.193L8.343 5.974C8.457 6.011 8.581 6.007 8.694 5.961L13.306 4.038C13.629 3.902 14.001 4.156 14.001 4.499V10.499L14 10.5Z'}))}
function IconFolder(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M1.8 4.3h4l1.2 1.4h7.2v6.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}))}
function IconSessionList(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M2.5 3.2h11M2.5 8h11M2.5 12.8h7',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
/* The sidebar's two-button segment replacing the harness New Session button:
   two exclusive nav tabs — Session List / Workspace Files — that only switch
   the browsing region. Each button is flex:1 (50%) so the pair tracks the
   sidebar width while dragged; the collapsed rail stacks icon-only controls. */
function SidebarTopActions({ collapsed, view, width, onSelectSessions, onSelectFiles }) {
  // The harness sidebar shell does not stretch foreign nodes reliably, so the
  // row width is bound to the sidebar width explicitly (root padding 12px x2
  // plus the row's 2px x2 margins); AppFrame re-renders on every drag tick.
  const rowStyle = collapsed ? undefined : { width: `${Math.max(0, width - 28)}px` }
  return h('div', { className: 'dsh-ws-sidebar-top-actions', 'data-rail': collapsed || undefined, style: rowStyle },
    h('button', {
      'aria-label': translate('nav.sessions'),
      className: 'dsh-ws-sidebar-top-action',
      'data-active': view !== 'files' || undefined,
      onClick: onSelectSessions,
      title: translate('nav.sessions'),
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-ws-sidebar-top-icon' }, h(IconSessionList)), h('span', { className: 'dsh-ws-sidebar-top-label' }, translate('nav.sessions'))),
    h('button', {
      'aria-label': translate('nav.files'),
      className: 'dsh-ws-sidebar-top-action',
      'data-active': view === 'files' || undefined,
      onClick: onSelectFiles,
      title: translate('nav.files'),
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-ws-sidebar-top-icon' }, h(IconFolder)), h('span', { className: 'dsh-ws-sidebar-top-label' }, translate('nav.files'))),
  )
}

function ResizeHandle({label,left,value,min,max,onResize,onDragging,invert}){const sign=invert?-1:1;const[dragging,setDragging]=useState(false),origin=useRef(0),base=useRef(0);const start=useCallback(e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);origin.current=e.clientX;base.current=value;setDragging(true);onDragging(true)},[onDragging,value]);const move=useCallback(e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))onResize(clamp(base.current+sign*(e.clientX-origin.current),min,max))},[max,min,onResize,sign]);const end=useCallback(e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;e.currentTarget.releasePointerCapture(e.pointerId);onResize(clamp(base.current+sign*(e.clientX-origin.current),min,max));setDragging(false);onDragging(false)},[max,min,onDragging,onResize,sign]);return h('div',{'aria-label':label,'aria-orientation':'vertical','aria-valuemax':max,'aria-valuemin':min,'aria-valuenow':value,className:'dsh-ws-splitter','data-dragging':dragging||undefined,onKeyDown:e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onResize(clamp(value+sign*(e.key==='ArrowLeft'?-RESIZE_STEP:RESIZE_STEP),min,max))}},onLostPointerCapture:()=>{setDragging(false);onDragging(false)},onPointerCancel:end,onPointerDown:start,onPointerMove:move,onPointerUp:end,role:'separator',style:{left},tabIndex:0})}
function HeaderAction({action}){return h('button',{'aria-label':action.label,className:'dsh-ws-icon-button','data-active':action.active||undefined,disabled:action.disabled||undefined,onClick:action.onClick,title:action.title??action.label,type:'button'},action.icon)}
function PanelHeader({title,subtitle,action,actionLabel,actions=[],onContextMenu}){const items=[...actions];if(action)items.push({label:actionLabel,onClick:action,icon:h(IconRefresh)});return h('header',{className:'dsh-ws-panel-header'},h('div',{className:'dsh-ws-panel-title',onContextMenu},h('strong',{title},title),subtitle?h('span',{title:subtitle},subtitle):null),items.length?h('div',{className:'dsh-ws-panel-actions'},items.map(item=>h(HeaderAction,{action:item,key:item.label}))):null)}
/* Memoized: the tree re-renders when tabs change (typing, tab drags), but a
   row's own props only change on selection/expansion/directory data, so
   scrolling and typing skip most row reconciliation entirely. */
const TreeRow = memo(function TreeRow({entry,depth,expanded,selected,cut,onContextMenu,onDirectory,onFile,onRename}){useLocaleText();const directory=entry.kind==='directory',blocked=entry.kind==='blocked'||entry.kind==='other',label=directory?'dir':fileLabel(entry.name);return h('button',{'aria-expanded':directory?expanded:undefined,className:'dsh-ws-tree-row','data-cut':cut||undefined,'data-selected':selected||undefined,disabled:blocked,onClick:directory?()=>onDirectory(entry):()=>onFile(entry),onContextMenu:e=>onContextMenu(e,entry),onKeyDown:e=>{if(e.key==='F2'){e.preventDefault();onRename(entry)}},style:{'--dsh-ws-depth':depth},title:`${entry.path}${entry.symlink?translate('tree.symlink'):''}`,type:'button'},h('span',{className:'dsh-ws-chevron'},directory?(expanded?'▼':'▶'):''),h('span',{className:'dsh-ws-file-mark','data-kind':entry.kind,'data-group':colorGroupOf(entry)},label.slice(0,3)),h('span',{className:'dsh-ws-row-name'},entry.name),entry.symlink?h('span',{className:'dsh-ws-symlink'},'↗'):null)})
/* In-place rename of a tree row: TreeRow is swapped for an input mirroring
   the row layout (same depth indent, chevron and file mark), so the edit
   happens exactly where the name sits — no modal. Enter confirms (IME-safe);
   Escape/blur cancels and restores the name. An unchanged name closes quietly;
   invalid/duplicate input keeps the editor open with an inline error. */
function TreeRenameRow({busy,depth,entry,expanded,error,onCancel,onConfirm,onDraft,value}){const composingRef=useRef(false),inputRef=useRef(null);const directory=entry.kind==='directory',label=directory?'dir':fileLabel(entry.name);useEffect(()=>{const input=inputRef.current;if(input!==null){input.focus();input.select()}},[]);return h('div',{className:'dsh-ws-tree-rename',style:{'--dsh-ws-depth':depth}},h('div',{className:'dsh-ws-tree-rename-row'},h('span',{className:'dsh-ws-chevron'},directory?(expanded?'▼':'▶'):''),h('span',{className:'dsh-ws-file-mark','data-kind':entry.kind,'data-group':colorGroupOf(entry)},label.slice(0,3)),h('input',{'aria-label':translate('dialog.name'),autoFocus:true,className:'dsh-ws-tree-rename-input',disabled:busy,onBlur:()=>{if(!busy)onCancel()},onChange:event=>onDraft(event.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();if(!busy)onCancel()}else if(event.key==='Enter'&&!composingRef.current){event.preventDefault();if(value.trim()===entry.name){onCancel();return}onConfirm()}},ref:inputRef,value})),error?h('div',{className:'dsh-ws-tree-rename-error',role:'alert'},error):null)}
const TreeStatus=({children,error})=>h('div',{className:'dsh-ws-tree-status','data-error':error||undefined},children)
function TreeContextMenu({entry,menuRef,onRename,onCopyName,onCopyPath,onReveal,onCopy,onPaste,onCut,onDelete,pasteDisabled,pasteTitle,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{'aria-label':entry.path,className:'dsh-ws-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-ws-context-item',onClick:()=>onRename(entry),role:'menuitem',title:translate('context.rename.title'),type:'button'},translate('context.rename')),h('button',{className:'dsh-ws-context-item',onClick:()=>onCopyName(entry),role:'menuitem',title:translate('context.copyName.title'),type:'button'},translate('context.copyName')),h('button',{className:'dsh-ws-context-item',onClick:()=>onCopyPath(entry,false),role:'menuitem',title:translate('context.copyPath.title'),type:'button'},translate('context.copyPath')),h('button',{className:'dsh-ws-context-item',onClick:()=>onCopyPath(entry,true),role:'menuitem',title:translate('context.copyRelative.title'),type:'button'},translate('context.copyRelative')),h('div',{className:'dsh-ws-context-separator',role:'separator'}),h('button',{className:'dsh-ws-context-item',onClick:()=>onReveal(entry),role:'menuitem',title:translate('context.reveal.title'),type:'button'},translate('context.reveal')),h('div',{className:'dsh-ws-context-separator',role:'separator'}),h('button',{className:'dsh-ws-context-item',onClick:()=>onCopy(entry),role:'menuitem',title:translate('context.copy.title'),type:'button'},translate('context.copy')),h('button',{className:'dsh-ws-context-item',disabled:pasteDisabled,onClick:()=>onPaste(entry),role:'menuitem',title:pasteDisabled?pasteTitle:translate('context.paste.title'),type:'button'},translate('context.paste')),h('button',{className:'dsh-ws-context-item',onClick:()=>onCut(entry),role:'menuitem',title:translate('context.cut.title'),type:'button'},translate('context.cut')),h('button',{className:'dsh-ws-context-item',onClick:()=>onDelete(entry),role:'menuitem',title:translate('context.delete.title'),type:'button'},translate('context.delete')))}
function TabContextMenu({menuRef,onCloseOthers,onTogglePin,pinned,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-COMPACT_MENU_HEIGHT-4));return h('div',{className:'dsh-ws-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-ws-context-item',onClick:onTogglePin,role:'menuitem',title:pinned?translate('tab.unpin.title'):translate('tab.pin.title'),type:'button'},pinned?translate('tab.unpin'):translate('tab.pin')),h('button',{className:'dsh-ws-context-item',onClick:onCloseOthers,role:'menuitem',title:translate('tab.closeOthers.title'),type:'button'},translate('tab.closeOthers')))}
function EntryDialog({dialog,draft,error,busy,blocked,composingRef,onCancel,onConfirm,onDraft}){if(!dialog)return null;const title=entryDialogTitle(dialog),action=entryDialogAction(dialog);return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},title),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('input',{'aria-label':translate('dialog.name'),autoFocus:true,className:'dsh-ws-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();if(!busy)onCancel()}else if(e.key==='Enter'&&!composingRef.current){e.preventDefault();if(!busy)onConfirm()}},value:draft}),error?h('div',{className:'dsh-ws-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-text-button',disabled:blocked,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):action))))}
function EncodingMenu({menuRef,onOpen,onSave,canOpen,canSave,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-COMPACT_MENU_HEIGHT-4));return h('div',{className:'dsh-ws-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-ws-context-item',disabled:!canOpen,onClick:onOpen,role:'menuitem',title:canOpen?translate('encoding.open.title'):translate('encoding.open.titleDirty'),type:'button'},translate('encoding.open')),h('button',{className:'dsh-ws-context-item',disabled:!canSave,onClick:onSave,role:'menuitem',title:canSave?translate('encoding.save.title'):translate('encoding.save.titleReadonly'),type:'button'},translate('encoding.save')))}
/* In-place session rename: an input overlaid on the harness row's title span
   (harness-rendered, so the plugin never mutates its DOM), fixed-positioned at
   the span's rect. Enter confirms (IME-safe), Escape/blur cancels; a row that
   detaches (session removed, list rebuilt) cancels too. */
function SessionInlineRename({busy,error,onCancel,onConfirm,row,title}){const composingRef=useRef(false),inputRef=useRef(null);const[draft,setDraft]=useState(title);useEffect(()=>{if(row===null||!row.isConnected){onCancel();return}const input=inputRef.current;if(input!==null){input.focus();input.select()}},[/* mount-only */]);useEffect(()=>{if(row!==null&&row.isConnected)return undefined;onCancel();return undefined},[onCancel,row]);const span=row===null?null:row.querySelector('span[class*="title"]');const rect=span===null?null:span.getBoundingClientRect();const overlayStyle=rect===null||rect.width===0?undefined:{left:rect.left,top:rect.top,width:Math.max(rect.width,140),height:rect.height};return h(Fragment,null,h('div',{className:'dsh-ws-session-rename-overlay',style:overlayStyle},h('input',{'aria-label':translate('dialog.sessionName'),autoFocus:true,className:'dsh-ws-session-rename-input',disabled:busy,onBlur:()=>{if(!busy)onCancel()},onChange:event=>{setDraft(event.target.value)},onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();if(!busy)onCancel()}else if(event.key==='Enter'&&!composingRef.current){event.preventDefault();onConfirm(draft)}},ref:inputRef,value:draft})),error?h('div',{className:'dsh-ws-session-rename-error',role:'alert',style:rect===null?undefined:{left:rect.left,top:rect.bottom+4}},error):null)}
/* Transient banner mirroring the harness Toast look (contrast fill, hold-
   then-fade, warning icon) so a failed external-file open reads like the
   composer's image-intake rejection. Rendered inside the preview pane
   (top-center) instead of a viewport portal; remounted per show (keyed by
   seq) to restart the animation for repeated messages. */
const WEL_TOAST_HOLD_MS = 3000
const WEL_TOAST_FADE_MS = 1000
const welToastIcon = h('svg',{fill:'none',height:16,viewBox:'0 0 16 16',width:16},h('circle',{cx:8,cy:8,r:6.5,stroke:'currentColor',strokeWidth:1.5}),h('path',{d:'M8 4.75v3.5',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.5}),h('circle',{cx:8,cy:11.25,fill:'currentColor',r:0.9}))
function PreviewToast({text,onDone,headerRef}){const[top,setTop]=useState(null);const onDoneRef=useRef(onDone);onDoneRef.current=onDone;useLayoutEffect(()=>{const header=headerRef?.current;if(header===null||header===undefined)return;const section=header.parentElement;if(section===null)return;const headerBottom=header.getBoundingClientRect().bottom;const sectionTop=section.getBoundingClientRect().top;setTop(headerBottom-sectionTop+8)},[headerRef]);useEffect(()=>{const timer=setTimeout(()=>{onDoneRef.current()},WEL_TOAST_HOLD_MS+WEL_TOAST_FADE_MS);return()=>clearTimeout(timer)},[]);return h('div',{className:'dsh-ws-toast',role:'alert',style:top===null?undefined:{top}},h('span',{'aria-hidden':true,className:'dsh-ws-toast-icon'},welToastIcon),h('span',{className:'dsh-ws-toast-text'},text))}
function EncodingDialog({dialog,options,value,busy,onCancel,onPick,onConfirm}){if(dialog===undefined)return null;const title=dialog.mode==='open'?translate('encoding.dialog.open'):translate('encoding.dialog.save'),action=dialog.mode==='open'?translate('encoding.dialog.openAction'):translate('encoding.dialog.saveAction');return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},title),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('label',{className:'dsh-ws-settings-label',htmlFor:'dsh-ws-encoding-select'},translate('encoding.badge')),h('select',{'aria-label':translate('encoding.badge'),className:'dsh-ws-highlight-preset-select',disabled:busy,id:'dsh-ws-encoding-select',onChange:e=>onPick(e.target.value),value},options.map(enc=>h('option',{key:enc.id,value:enc.id},encodingLabel(enc.id))))),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-text-button',disabled:busy||options.length===0,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):action))))}
function SessionRenameDialog({draft,busy,error,onCancel,onConfirm,onDraft,title}){const composingRef=useRef(false);return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},title ?? translate('dialog.renameSession')),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('input',{'aria-label':translate('dialog.sessionName'),autoFocus:true,className:'dsh-ws-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();onCancel()}else if(e.key==='Enter'&&!composingRef.current){e.preventDefault();onConfirm()}},value:draft}),error?h('div',{className:'dsh-ws-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-text-button',disabled:busy||draft.trim()==='',onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):translate('dialog.rename')))))}
function DeleteDialog({entry,busy,dirtyWarning,onCancel,onConfirm}){if(entry===undefined)return null;return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},translate('dialog.deleteTitle')),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('div',{className:'dsh-ws-dialog-message'},translate('dialog.deleteMessage',{name:entry.name})),dirtyWarning?h('div',{className:'dsh-ws-dialog-warning',role:'alert'},translate('dialog.deleteDirtyWarning')):null),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-danger-button dsh-ws-text-button',disabled:busy,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):translate('dialog.deleteAction')))))}
/* Save-time three-way merge conflict prompt: the file changed on disk by
   another tool and the changes overlap the local edits. Each conflicting
   region is reviewed one at a time (mine vs theirs) in a large dialog; the
   footer walks the regions and the final pick set is handed back as
   { choices } (one 'mine'/'theirs' per conflict, in order) or 'cancel'. */
function SaveConflictDialog({conflict,fontSize,onResolve}) {
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState([])
  // Escape cancels the whole save, same as the backdrop / × button. The dialog
  // is modal, so its own window-level Escape must not leak to the mind-map
  // overlay's Escape-to-close (that listener already yields to any open
  // .dsh-ws-dialog-backdrop).
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') onResolve('cancel')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onResolve])
  if (conflict === undefined) return null
  const total = conflict.conflicts.length
  const current = Math.min(index, total - 1)
  const region = conflict.conflicts[current]
  const regionLines = region.start === region.end
    ? String(region.start + 1)
    : region.start === region.end - 1
      ? String(region.start + 1)
      : `${region.start + 1}–${region.end}`
  const pick = (side) => {
    const next = [...choices, side]
    // The decision is tied to the actual choices length (the array
    // `resolveMergeParts` validates), not the display index, so a back+re-pick
    // cycle can never hand the resolver a mismatched count.
    if (next.length < total) {
      setChoices(next)
      setIndex(next.length)
    } else {
      onResolve({ choices: next })
    }
  }
  const goBack = () => {
    if (current === 0) return
    // Revisiting conflict `current - 1` must drop its stale choice; keeping it
    // made the final choices array one entry too long and the save failed
    // with "incomplete conflict choices" after a back+re-pick cycle.
    setIndex(current - 1)
    setChoices(prev => prev.slice(0, current - 1))
  }
  return h('div', { className: 'dsh-ws-dialog-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onResolve('cancel') } },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-conflict-dialog', role: 'dialog', style: fontSize === undefined ? undefined : { '--dsh-ws-conflict-font-size': `${fontSize}px` } },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' },
          translate('dialog.saveConflictTitle'),
          total > 1 ? h('span', { className: 'dsh-ws-conflict-progress' }, `${current + 1} / ${total}`) : null),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', onClick: () => onResolve('cancel'), title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' }, translate('dialog.saveConflictMessage')),
        h('div', { className: 'dsh-ws-conflict-region' },
          h('div', { className: 'dsh-ws-conflict-region-title' },
            translate('dialog.saveConflictRegion', { lines: regionLines })),
          h('div', { className: 'dsh-ws-conflict-cols' },
            h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-mine' },
              h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictMine')),
              h('pre', { className: 'dsh-ws-conflict-code' }, region.display === 'plain' ? region.mine.join('\n') : diffRows(region.base, region.mine))),
            h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-theirs' },
              h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictTheirs')),
              h('pre', { className: 'dsh-ws-conflict-code' }, region.display === 'plain' ? region.theirs.join('\n') : diffRows(region.base, region.theirs)))),
          h('div', { className: 'dsh-ws-conflict-cols dsh-ws-conflict-cols-final' },
            h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-mine' },
              h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictMineFinal')),
              h('pre', { className: 'dsh-ws-conflict-code' }, region.mine.join('\n'))),
            h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-theirs' },
              h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictTheirsFinal')),
              h('pre', { className: 'dsh-ws-conflict-code' }, region.theirs.join('\n'))))),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', onClick: () => onResolve('cancel'), type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: current === 0, onClick: goBack, type: 'button' }, translate('dialog.saveConflictPrev')),
        h('button', { className: 'dsh-ws-text-button', onClick: () => pick('theirs'), type: 'button' }, translate('dialog.saveConflictKeepTheirs')),
        h('button', { className: 'dsh-ws-danger-button dsh-ws-text-button', onClick: () => pick('mine'), type: 'button' }, translate('dialog.saveConflictKeepMine'))))))}


function revealPosition(view, reveal) {
  const lineNumber = Math.min(Math.max(1, reveal.line), view.state.doc.lines)
  const line = view.state.doc.line(lineNumber)
  const startColumn = Math.min(Math.max(1, reveal.column ?? 1), line.length + 1)
  const endColumn = Math.min(Math.max(startColumn, reveal.endColumn ?? startColumn), line.length + 1)
  const from = line.from + startColumn - 1
  const to = line.from + endColumn - 1
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
}

/* Code-folding helpers backing the Ctrl+K+J / Ctrl+K+<n> shortcuts. Nesting
   depth is 1-based: a top-level fold region is level 1, one directly inside
   another fold region is level 2, and so on. */
function collectFoldableRanges(view) {
  const state = view.state
  const seen = new Set()
  const ranges = []
  for (let pos = 0; pos < state.doc.length;) {
    const line = view.lineBlockAt(pos)
    const range = foldable(state, line.from, line.to)
    if (range) {
      const key = `${range.from}:${range.to}`
      if (!seen.has(key)) {
        seen.add(key)
        ranges.push(range)
      }
    }
    pos = line.to + 1
  }
  return ranges
}
/* Nesting depth per foldable range: 1 for a top-level region, +1 per
   enclosing region. CodeMirror fold regions are disjoint-or-nested and
   collected in document order, so one stack sweep computes every depth in
   linear time (the previous per-range scan was quadratic on large files). */
function foldLevelsOf(ranges) {
  const ordered = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to)
  const levels = new Array(ordered.length)
  const stack = []
  for (let index = 0; index < ordered.length; index += 1) {
    const range = ordered[index]
    while (stack.length > 0 && stack[stack.length - 1].to <= range.from) stack.pop()
    levels[index] = stack.length + 1
    stack.push(range)
  }
  return { ordered, levels }
}
/* Fold every foldable region whose nesting depth is exactly `level`. */
function foldLevel(view, level) {
  const ranges = collectFoldableRanges(view)
  const { ordered, levels } = foldLevelsOf(ranges)
  const effects = []
  for (let index = 0; index < ordered.length; index += 1) {
    if (levels[index] === level) effects.push(foldEffect.of(ordered[index]))
  }
  if (effects.length) {
    view.dispatch({ effects })
    return true
  }
  return false
}

function CodeEditor({ file, editing, wrap, onContext, onDirty, onSaveShortcut, onScroll, reveal, scrollTop, editorRef, highlightPreset, searchPanelContainer, readEpoch, onRevealApplied }) {
  const host = useRef(null)
  const editableCompartment = useRef(new Compartment())
  const wrapCompartment = useRef(new Compartment())
  const phrasesCompartment = useRef(new Compartment())
  const localeTick = useLocaleText()
  const contextRef = useRef(onContext)
  const dirtyRef = useRef(onDirty)
  const saveRef = useRef(onSaveShortcut)
  const scrollRef = useRef(onScroll)
  const revealRef = useRef(null)
  const onRevealAppliedRef = useRef(onRevealApplied)
  const revealAppliedRef = useRef(null)
  contextRef.current = onContext
  dirtyRef.current = onDirty
  saveRef.current = onSaveShortcut
  scrollRef.current = onScroll
  revealRef.current = reveal
  onRevealAppliedRef.current = onRevealApplied
  // A reveal request is consumed the first time it is actually applied, so
  // returning to the tab later restores the persisted scroll instead of
  // re-jumping to a stale search match.
  const markRevealApplied = (target) => {
    if (target === null || revealAppliedRef.current === target) return
    revealAppliedRef.current = target
    onRevealAppliedRef.current?.()
  }

  useEffect(() => {
    const descriptor = languageFor(file.name)
    const separator = lineSeparator(file.lineEnding)
    const separatorExtension = file.lineEnding === 'mixed'
      ? []
      : EditorState.lineSeparator.of(separator)
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: file.content,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), history(), foldGutter(), drawSelection(), dropCursor(),
          EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(),
          highlightSelectionMatches(), highlightActiveLine(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          /* The search panel is rendered into a container div between the
             status bar and the preview body: top:true puts it in the top panel
             group (the @codemirror/search default is bottom), and
             panels({ topContainer }) places that group in the plugin-owned
             container instead of inside the editor. */
          search({ top: true }),
          panels(searchPanelContainer?.current ? { topContainer: searchPanelContainer.current } : undefined),
          /* CodeMirror's search/goto-line panels render their labels through
             EditorState.phrase(); without this map they show English. The keys
             mirror @codemirror/search's phrases; keep the $ placeholders. The
             compartment follows the active locale (English keeps CodeMirror's
             built-in default phrases). */
          phrasesCompartment.current.of(localeIsZh() ? EditorState.phrases.of(CM_PHRASES_ZH) : []),
          syntaxHighlighting(tokenHighlight),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true } },
            indentWithTab, ...closeBracketsKeymap, ...defaultKeymap,
            /* Search keys that only make sense inside the editor stay in the
               keymap: Escape closes the panel; Ctrl+D / Ctrl+Shift+L /
               Ctrl+Alt+G select occurrences, select matches, or jump to a line.
               The find workflow (Ctrl/Cmd+F, Ctrl/Cmd+G, F3) is deliberately
               NOT bound here — the window capture handler below owns it so it
               works from every focus state (single path, same as Ctrl+K). */
            { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
            { key: 'Mod-Shift-l', run: selectSelectionMatches },
            { key: 'Mod-Alt-g', run: gotoLine },
            { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
            ...historyKeymap, ...foldKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) dirtyRef.current(update.state.sliceDoc())
            if (update.docChanged || update.selectionSet) contextRef.current(update.state)
          }),
          editableCompartment.current.of([
            EditorView.editable.of(editing),
            EditorState.readOnly.of(!editing),
          ]),
          wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
          descriptor.extension,
          separatorExtension,
          EditorView.theme({
            '&': { backgroundColor: 'var(--dsw-alias-markdown-code-block)', color: 'var(--dsw-alias-label-primary)' },
            '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)' },
            '&.cm-focused': { outline: 'none' },
          }, { dark: false }),
        ],
      }),
    })
    const reportScroll = () => {
      scrollRef.current?.(file.path, view.scrollDOM.scrollTop)
    }
    view.scrollDOM.addEventListener('scroll', reportScroll)
    editorRef.current = view
    // A reveal consumes itself (the parent clears the request), so the second
    // pass must not fall through to the persisted scrollTop and undo the
    // reveal; the closure flag scopes that to this mount pass.
    let revealHandled = false
    const restoreScroll = () => {
      const target = revealRef.current
      if (target !== null && target.path === file.path) {
        revealPosition(view, target)
        markRevealApplied(target)
        revealHandled = true
        return
      }
      if (revealHandled) return
      if (Number.isFinite(scrollTop) && scrollTop > 0) view.scrollDOM.scrollTop = scrollTop
    }
    restoreScroll()
    const animation = requestAnimationFrame(restoreScroll)
    contextRef.current(view.state)
    return () => {
      cancelAnimationFrame(animation)
      scrollRef.current?.(file.path, view.scrollDOM.scrollTop)
      view.scrollDOM.removeEventListener('scroll', reportScroll)
      if (editorRef.current === view) editorRef.current = undefined
      view.destroy()
    }
    // Rebuild only when the document was actually re-read (path/encoding/read
    // epoch), never on save: a save only advances the revision, and rebuilding
    // would wipe the undo history and caret position.
  }, [file.path, file.encoding, readEpoch])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: editableCompartment.current.reconfigure([
        EditorView.editable.of(editing),
        EditorState.readOnly.of(!editing),
      ]),
    })
  }, [editing])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: phrasesCompartment.current.reconfigure(localeIsZh() ? EditorState.phrases.of(CM_PHRASES_ZH) : []),
    })
  }, [localeTick])

  useEffect(() => {
    const view = editorRef.current
    if (view === undefined || reveal === null) return
    revealPosition(view, reveal)
    markRevealApplied(reveal)
  }, [reveal])

  // The Ctrl+K+J / Ctrl+K+<n> fold shortcuts are handled here at the window
  // level (capture phase) so they work in every focus state: browsing keeps
  // focus on the tree, toolbar, or fold gutter, and even when the editor
  // content is focused the keymap path proved unreliable. The editor keymap
  // deliberately does not bind these keys — one handling path avoids folding
  // twice. Keys are consumed (preventDefault + stopPropagation) only for the
  // captured Ctrl+K prefix and its completion J / 1..9.
  useEffect(() => {
    let armed = false
    let timer
    const cancel = () => { armed = false; clearTimeout(timer) }
    const onKeyDown = (event) => {
      const view = editorRef.current
      if (view === undefined) return
      // IME composition must never arm or complete the fold sequence (same
      // rule the other shortcut paths honor): composing keystrokes pass
      // through untouched.
      if (event.isComposing) { cancel(); return }
      const target = event.target
      // Let text fields outside the editor (chat, rename, search, dialogs) keep
      // their keys; the editor's own contenteditable is inside host.
      const insideEditor = host.current !== null && target instanceof Node && host.current.contains(target)
      if (!insideEditor && target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        cancel()
        return
      }
      const key = String(event.key).toLowerCase()
      const isCtrlK = key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      if (isCtrlK) {
        // (Re-)arm the prefix; a repeated Ctrl+K keeps the sequence alive.
        event.preventDefault()
        event.stopPropagation()
        armed = true
        clearTimeout(timer)
        timer = setTimeout(cancel, 1000)
        return
      }
      if (!armed) return
      cancel()
      if (key === 'j') {
        event.preventDefault()
        event.stopPropagation()
        unfoldAll(view)
        return
      }
      if (key.length === 1 && key >= '1' && key <= '9') {
        event.preventDefault()
        event.stopPropagation()
        foldLevel(view, Number(key))
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      cancel()
    }
  }, [])

  // The find shortcuts (Ctrl/Cmd+F, Ctrl/Cmd+G, Ctrl/Cmd+Shift+G, F3,
  // Shift+F3) are handled here at the window level (capture phase) so they
  // work in every focus state, exactly like Ctrl+K above: browsing keeps focus
  // on the tree, toolbar, or tab bar. The editor keymap deliberately does not
  // bind these keys — one handling path. With no editor mounted the keys are
  // left untouched so the browser's own find still works.
  useEffect(() => {
    const onKeyDown = (event) => {
      const view = editorRef.current
      if (view === undefined) return
      const target = event.target
      // Let text fields outside the editor (chat, rename, dialogs) keep their
      // keys; the editor's own contenteditable and the search panel input
      // (rendered into the search container) are treated as editor-internal,
      // so they still reach this handler.
      const panelContainer = searchPanelContainer?.current
      const insideEditor = (host.current !== null && target instanceof Node && host.current.contains(target))
        || (panelContainer !== null && target instanceof Node && panelContainer.contains(target))
      if (!insideEditor && target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey
      const key = String(event.key).toLowerCase()
      const plainF3 = event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey
      let handled = false
      if (key === 'f' && mod && !event.shiftKey) {
        openSearchPanel(view)
        handled = true
      } else if (key === 'g' && mod && !event.shiftKey) {
        findNext(view)
        handled = true
      } else if (key === 'g' && mod && event.shiftKey) {
        findPrevious(view)
        handled = true
      } else if (plainF3 && !event.shiftKey) {
        findNext(view)
        handled = true
      } else if (plainF3 && event.shiftKey) {
        findPrevious(view)
        handled = true
      }
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // The search field gets a drag-to-resize grip on its right edge. CodeMirror
  // builds the panel DOM itself and SearchPanel is not exported, so watch the
  // panel container for the .cm-panel.cm-search element and wrap its
  // [main-field] input in an inline-flex wrapper next to a col-resize handle
  // (once per input; a fresh input is created each time the panel opens).
  useEffect(() => {
    const container = searchPanelContainer?.current
    if (container === null || container === undefined) return undefined
    let detach = undefined
    const enhance = () => {
      const input = container.querySelector('.cm-panel.cm-search [main-field]')
      if (input === null || input.dataset.dshWelResize === '1') return
      input.dataset.dshWelResize = '1'
      const wrap = document.createElement('span')
      wrap.className = 'dsh-ws-search-field-wrap'
      const handle = document.createElement('span')
      handle.className = 'dsh-ws-search-resize'
      handle.title = translate('editor.searchResize')
      input.before(wrap)
      wrap.append(input, handle)
      let startX = 0
      let startWidth = 0
      let moveListener = undefined
      let upListener = undefined
      const detachPointer = () => {
        if (moveListener !== undefined) window.removeEventListener('pointermove', moveListener)
        if (upListener !== undefined) window.removeEventListener('pointerup', upListener)
        moveListener = undefined
        upListener = undefined
      }
      detach = detachPointer
      const onPointerDown = (event) => {
        event.preventDefault()
        startX = event.clientX
        startWidth = input.getBoundingClientRect().width
        const onPointerMove = (moveEvent) => {
          input.style.width = `${Math.max(60, Math.min(480, startWidth + (moveEvent.clientX - startX)))}px`
        }
        const onPointerUp = () => { detachPointer() }
        // Replace any prior drag state so a second drag cannot leak a stale
        // pair; the effect cleanup also detaches, so an unmount mid-drag (the
        // editor rebuilds on path/encoding/readEpoch) never leaves window
        // listeners bound to a detached input.
        detachPointer()
        moveListener = onPointerMove
        upListener = onPointerUp
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }
      handle.addEventListener('pointerdown', onPointerDown)
    }
    enhance()
    const observer = new MutationObserver(enhance)
    observer.observe(container, { childList: true, subtree: true })
    return () => { observer.disconnect(); detach?.() }
  }, [searchPanelContainer])

  return h('div', { className: 'dsh-ws-editor-host', 'data-highlight-preset': highlightPreset ?? HIGHLIGHT_PRESET_DEFAULT, ref: host })
}

function WorkspaceExplorer({
  workspace, treePortalTarget, sessionTitle, sessionId, renameSession, publishEditorContext, listDirectory, readFile, saveFile, createEntry, renameEntry, storedPreviewSession, persistPreviewSession, settingsStore, loadDraft, persistDraftFile, removeDraftFile, draftTree,
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const draftScopeId = sessionId === undefined ? `workspace:${workspace.workspaceId}` : `session:${sessionId}`
  const initialPreviewSession = normalizePreviewSession(storedPreviewSession)
  const [directories, setDirectories] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  const [tabs, setTabs] = useState(() => initialPreviewSession.tabs)
  const [activePath, setActivePath] = useState(() => initialPreviewSession.activePath)
  const [selected, setSelected] = useState(() => {
    if (initialPreviewSession.activePath === null) return undefined
    const activeTab = initialPreviewSession.tabs.find(tab => tab.path === initialPreviewSession.activePath)
    return activeTab ? entryFromPreviewTab(activeTab) : { path: initialPreviewSession.activePath, name: initialPreviewSession.activePath.slice(initialPreviewSession.activePath.lastIndexOf('/') + 1), kind: 'file' }
  })
  const [preview, setPreview] = useState({ state: 'idle' })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState()
  const [reloadToken, setReloadToken] = useState(0)
  // Bumped once per successful file re-read; the editor rebuilds on this
  // instead of on the revision, so saving (which only advances the revision)
  // keeps the undo history and caret position.
  const [readEpoch, setReadEpoch] = useState(0)
  const [encodingMenu, setEncodingMenu] = useState()
  const [encodingDialog, setEncodingDialog] = useState()
  const [encodingPick, setEncodingPick] = useState('utf-8')
  const [encodingOptions, setEncodingOptions] = useState(ENCODING_FALLBACK)
  const [draggingPath, setDraggingPath] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)
  const [dropActive, setDropActive] = useState(false)
  const [previewToast, setPreviewToast] = useState()
  // Markdown rendered-preview toggle (per-file; reset whenever the file changes).
  const [mdPreview, setMdPreview] = useState(false)
  const [entryDialog, setEntryDialog] = useState()
  const [entryDraft, setEntryDraft] = useState('')
  const [entryBusy, setEntryBusy] = useState(false)
  const [entryError, setEntryError] = useState()
  const [contextMenu, setContextMenu] = useState()
  const [tabContextMenu, setTabContextMenu] = useState()
  const [titleContextMenu, setTitleContextMenu] = useState()
  const [sessionRenameOpen, setSessionRenameOpen] = useState(false)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState()
  const [pinScrollToken, setPinScrollToken] = useState(0)
  const tabScrollPathRef = useRef(null)
  const [copyNotice, setCopyNotice] = useState()
  const [clipboard, setClipboard] = useState()
  const [deleteDialog, setDeleteDialog] = useState()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [conflictDialog, setConflictDialog] = useState()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchNameOnly, setSearchNameOnly] = useState(false)
  const [searchState, setSearchState] = useState({ state: 'idle' })
  const [searchExpanded, setSearchExpanded] = useState(() => new Set())
  const [searchReveal, setSearchReveal] = useState()
  const searchController = useRef()
  const searchRevealToken = useRef(0)
  const menuRef = useRef(null)
  const tabMenuRef = useRef(null)
  const titleMenuRef = useRef(null)
  const encodingMenuRef = useRef(null)
  const requestedEncodingRef = useRef()
  // Set by the preview-header refresh action; the file-read effect consumes it
  // at the start of its next pass and surfaces a "reloaded" status on success.
  const refreshPendingRef = useRef(false)
  // Set by the preview-header cancel action; like refreshPendingRef but
  // surfaces the cancel-specific "reloaded from disk" status once the discard
  // re-read completes.
  const cancelRestoreRef = useRef(null)
  const previewTabsRef = useRef(null)
  const previewSectionRef = useRef(null)
  const previewScrollbarRef = useRef(null)
  const previewScrollThumbRef = useRef(null)
  const tabsHoveredRef = useRef(false)
  const scrollbarHoveredRef = useRef(false)
  const scrollbarDragRef = useRef(null)
  const previewHeaderRef = useRef(null)
  const dropSuppressedRef = useRef(false)
  const toastSeqRef = useRef(0)
  const copyNoticeTimer = useRef()
  const requests = useRef(new Map())
  const readController = useRef()
  const saveController = useRef()
  const mutationController = useRef()
  // Monotonic sequence for tree mutations (create/rename/paste/delete). Each
  // operation captures its own sequence and only applies its UI result when it
  // is still the latest: overlapping operations no longer abort one another's
  // in-flight request (the Host serializes writes anyway), so a stranded
  // server-side operation can never corrupt the tree with a stale result.
  const mutationSeqRef = useRef(0)
  const editorRef = useRef()
  const searchPanelContainerRef = useRef(null)
  const composingRef = useRef(false)
  const baseText = useRef('')
  const diskBaseRef = useRef('')
  const mounted = useRef(true)
  // Latest disk state this editor actually wrote (or last read): content plus
  // revision. Auto-save uses the revision as If-Match and the editor-context
  // uses the content to decide whether a selection matches disk. Per-path,
  // because a pending auto-save can outlive the active tab.
  const lastWriteRef = useRef(new Map())
  const autosaveTimers = useRef(new Map())
  // Draft mutations are serialized per path with a monotonically increasing
  // generation: the promise tail lets an already-arrived stale PUT finish
  // before a newer PUT/DELETE (AbortController cannot retract a request the
  // Host has already started). The Host fences every write/delete/tree op
  // behind ONE owner-level generation (lib/index.js ownerCurrentGeneration),
  // so all operations share this single counter — separate per-path and
  // '__tree__' counters collided with that fence (409 draft-generation-
  // conflict) when a second op reused a generation the Host had consumed.
  const draftGenerationCounterRef = useRef(0)
  const draftGenerationsRef = useRef(new Map())
  const draftTailsRef = useRef(new Map())
  const pendingAutosavesRef = useRef(new Map())
  const conflictDialogRef = useRef(undefined)
  const tabsRef = useRef(initialPreviewSession.tabs)
  const activePathRef = useRef(initialPreviewSession.activePath)
  const expandedRef = useRef(new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  // Live editor scroll positions: written on every scroll event without
  // touching React state or the persistence path, merged into the snapshot
  // only when it is actually serialized.
  const scrollTopRef = useRef(new Map())
  const sessionEstablishedRef = useRef(false)
  // Paths already confirmed missing in the current workspace while restoring
  // the persisted expansion. Every later restore pass (in particular the
  // late-arriving stored session) skips them until the cleaned snapshot has
  // been persisted, so a pruned path cannot be re-seeded and 404 again within
  // one mount.
  const prunedPathsRef = useRef(new Set())
  const previewTabsBootstrapped = useRef(Boolean(initialPreviewSession.tabs.length > 0 || initialPreviewSession.activePath !== null))
  const selectedDirectoryPath = selectedLevelPath(selected)
  const activatePath = useCallback((path) => {
    // A cancel marker belongs to one specific file; switching files must not
    // let a stale marker decorate a later read of the same path.
    if (path !== activePathRef.current) cancelRestoreRef.current = null
    activePathRef.current = path
    setActivePath(path)
  }, [])
  useLayoutEffect(() => { tabsRef.current = tabs }, [tabs])
  useLayoutEffect(() => { activePathRef.current = activePath }, [activePath])
  useLayoutEffect(() => { expandedRef.current = expanded }, [expanded])
  const activeTab = useMemo(() => activePath === null ? undefined : tabs.find(tab => tab.path === activePath), [activePath, tabs])
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
    /* Dropped external files are session-only previews (serializePreviewTab
       returns null for them). When the ONLY tabs are external and the tree
       carries no expansion, writing would serialize to an empty snapshot and
       the store action would DELETE the current-session and workspace anchor
       keys — the workspace key may be the only saved copy of ANOTHER session's
       tabs. Skip the write entirely; external previews must not drive any
       persisted-state change. */
    if (liveTabs.length > 0 && liveTabs.every(tab => tab.external) && !hasTreeExpansion) return
    const meaningful = previewTabsBootstrapped.current || liveTabs.length !== 0 || activePathRef.current !== null || hasTreeExpansion
    // Skip until this session has established any state: a bare empty mount
    // must not clobber the workspace-key snapshot of another session. Once
    // established, keep writing (an empty snapshot deletes the stale entry in
    // the store action), so collapsing everything back to root also persists.
    if (!meaningful && !sessionEstablishedRef.current) return
    if (meaningful) sessionEstablishedRef.current = true
    // Merge the live scroll positions (kept out of React state so scrolling
    // never re-renders or triggers a write) into the serialized copy only.
    const snapshotTabs = liveTabs.map(tab => {
      const live = scrollTopRef.current.get(tab.path)
      return live === undefined ? tab : { ...tab, scrollTop: live }
    })
    persistPreviewSession(serializePreviewSession(activePathRef.current, snapshotTabs, expandedRef.current))
  }, [persistPreviewSession])
  // Persist on a microtask after commit (still before paint) so a pin + an
  // immediate refresh cannot race the localStorage write, and bursts (typing,
  // tab drags) coalesce into one write per event-loop tick. Unmount and
  // pagehide/beforeunload still flush synchronously below. Declared after the
  // tabsRef sync effect so it always serializes the freshest tabs.
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

  const publishContextState = useCallback((state) => {
    if (activeTab === undefined || preview.state !== 'ready') return
    // Dropped external files are read-only and not workspace-confined; never
    // leak their synthetic path into the model's editor context.
    if (activeTab.external) return
    const main = state.selection.main
    const text = state.sliceDoc()
    const selection = main.empty
      ? undefined
      : (() => {
          const start = state.doc.lineAt(main.from)
          const end = state.doc.lineAt(main.to)
          // The editor doc keeps the file's raw line endings (CRLF on Windows
          // files), but the server verifies editor-context selections in
          // LF-normalized space (validateDirtySelection / verifyCleanSelection
          // in lib/index.js): normalize the selection text and map the offsets
          // to that same space. Columns are line-local, so they are unaffected;
          // only the absolute offsets shift by one per preceding CRLF.
          const crlfBefore = (pos) => {
            let count = 0
            for (let i = 0; i + 1 < pos; i += 1) {
              if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10) count += 1
            }
            return count
          }
          const from = main.from - crlfBefore(main.from)
          const to = main.to - crlfBefore(main.to)
          return {
            from,
            to,
            startLine: start.number,
            startColumn: main.from - start.from + 1,
            endLine: end.number,
            endColumn: main.to - end.from + 1,
            text: state.sliceDoc(main.from, main.to).replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
          }
        })()
    // Dirty means "differs from the committed snapshot". The source file is
    // never polluted by the draft (edits live in the draft file), so a clean
    // selection can be verified against the source revision; a dirty editor
    // sends the selection text verbatim instead of verifying against disk.
    publishEditorContext({
      workspaceId: String(workspace.workspaceId),
      path: activeTab.path,
      // The editor decodes the file with preview.encoding; carrying it lets the
      // server verify a clean selection against the same decode (not a hard
      // UTF-8 assumption).
      encoding: preview.encoding,
      dirty: text !== baseText.current || preview.revision === undefined,
      revision: preview.revision ?? undefined,
      selection,
      symlink: Boolean(activeTab.symlink),
      maxContextBytes: preview.maxContextBytes,
    })
  }, [activeTab, preview, publishEditorContext, workspace.workspaceId])

  // A successful save changes the disk revision after CodeMirror keeps the
  // same view; republish so the next clean selection carries the new revision.
  useEffect(() => {
    if (preview.state !== 'ready') return
    const view = editorRef.current
    if (view !== undefined) publishContextState(view.state)
  }, [preview, publishContextState])

  const abortDirectoryRequests = useCallback(() => {
    for (const controller of requests.current.values()) controller.abort()
    requests.current.clear()
  }, [])
  const abortRequests = useCallback(() => {
    abortDirectoryRequests()
    readController.current?.abort()
    saveController.current?.abort()
    mutationController.current?.abort()
  }, [abortDirectoryRequests])

  useEffect(() => {
    if (!hasDirtyTabs) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDirtyTabs])
  // Restore-time self-heal: a persisted expansion path that no longer exists
  // in the current workspace (server 404 path-not-found) is dropped from the
  // expanded set — including every descendant, which cannot exist under a
  // missing parent — along with its per-directory state, and the cleaned
  // snapshot is persisted so the stale paths stop 404-ing on later loads.
  // Only restore-time loads pass pruneOnMissing; a user clicking a directory
  // that turns out missing keeps the visible error row instead of vanishing.
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
    // Persist the cleaned expansion so the stale paths do not 404 again on the
    // next load. Mark the session established so a tabs-empty snapshot still
    // writes through — this is exactly the self-heal the bare-mount guard must
    // not suppress, and the snapshot comes from this restore.
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
      setDirectories(cur => {
        const next = new Map(cur)
        next.set(path, { state: 'ready', entries: result.entries })
        return next
      })
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setDirectories(cur => {
          const next = new Map(cur)
          next.set(path, {
            state: 'error',
            entries: [],
            message: error instanceof Error ? error.message : String(error),
          })
          return next
        })
        if (options?.pruneOnMissing && error instanceof WorkspaceApiError && error.code === 'path-not-found') {
          pruneExpandedPath(path)
        }
      }
    } finally {
      if (requests.current.get(path) === controller) requests.current.delete(path)
    }
  }, [listDirectory, pruneExpandedPath, workspace.workspaceId])
  useEffect(() => { void loadDirectory('') }, [loadDirectory])
  // Restore the persisted expansion: fetch the listing of every restored
  // directory so the tree can render its children. Mount-only; the persisted
  // set already includes every ancestor, so nested folders appear in place.
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
      if (path !== entry.path && directories.get(path)?.state !== 'ready') void loadDirectory(path)
    }
  }, [directories, loadDirectory])
  useLayoutEffect(() => {
    if (previewTabsBootstrapped.current) return
    if (tabsRef.current.length !== 0) return
    const next = normalizePreviewSession(storedPreviewSession)
    if (next.tabs.length === 0) return
    previewTabsBootstrapped.current = true
    setTabs(next.tabs)
    activatePath(next.activePath)
    const nextTab = next.tabs.find(tab => tab.path === next.activePath)
    if (nextTab !== undefined) {
      const entry = entryFromPreviewTab(nextTab)
      setSelected(entry)
      revealPath(entry)
    }
  }, [activatePath, revealPath, storedPreviewSession])
  // Late-arriving restore for tree expansion: if storedPreviewSession becomes
  // available only after mount, merge its expanded paths and load them. The
  // hasAll guard keeps this idempotent across store updates.
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
  // Open a non-workspace file dropped into the preview pane: upload its raw
  // bytes to the plugin endpoint, which decodes them into a read-only preview
  // payload, then add a session-only external tab with that content. Resolves
  // true on success and the failure message (to toast) when the file cannot be
  // loaded as text.
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
      if (error?.name === 'AbortError' || !mounted.current) return true
      // The preview pane only responds to normal (text) files; a file that
      // cannot be loaded as text (binary, image, empty, oversized) reports the
      // server's message through the same toast surface the composer uses.
      return error instanceof Error ? error.message : String(error)
    }
  }, [activatePath])
  const showPreviewToast = useCallback((text) => {
    toastSeqRef.current += 1
    setPreviewToast({ seq: toastSeqRef.current, text })
  }, [])
  const handlePreviewDrop = useCallback(async (event) => {
    setDropActive(false)
    // Folders carry no File objects; detect them via the drag items so the
    // drop still announces "cannot preview" instead of doing nothing.
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
    // Every dropped file goes through the upload endpoint: the server rejects
    // anything that is not text (binary, images, empty, oversized, wrong
    // encoding) with a message that the toast announces, so "cannot load"
    // always reports instead of silently doing nothing.
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
  // File drags are intercepted in the capture phase on the whole preview
  // section: CodeMirror's own drop handler reads dataTransfer.files and would
  // otherwise insert the file's text into the editor before this handler runs.
  // Internal tab reorders carry no files, so they pass through untouched. The
  // highlight only appears for normal (non-image) file drags. Images (the chat
  // composer's domain) get no highlight, but if actually dropped they are still
  // processed and rejected with an explicit "cannot preview" toast — never
  // silently ignored (see isImageFile / handlePreviewDrop, development-notes
  // §17). Enter/leave use a depth counter because dragleave's relatedTarget is
  // null in Chrome. Closing the hint suppresses it for the current drag until
  // the drop or drag end.
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
      // Suppress the harness chat drop mask over the preview regardless of file
      // kind, so each area keeps its own response.
      event.preventDefault()
      event.stopPropagation()
      if (dropSuppressedRef.current) return
      if (hasNormalFile(event)) {
        depth += 1
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      } else if (event.dataTransfer) {
        // Images/folders are not preview targets (no highlight), but the drop
        // stays allowed so the drop handler can announce "cannot preview"
        // instead of the browser silently refusing the drop.
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
      if (!hasDraggedFiles(event)) return
      if (dropSuppressedRef.current) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropActive(false)
    }
    const onDrop = (event) => {
      if (!hasDraggedFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
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
  // The markdown preview mode is scoped to one file: switching files always
  // lands back in the source editor.
  useEffect(() => { setMdPreview(false) }, [activePath])
  const rewriteRuntimePaths = useCallback((from, to) => {
    lastWriteRef.current = rewritePathMap(lastWriteRef.current, from, to)
    draftGenerationsRef.current = rewritePathMap(draftGenerationsRef.current, from, to)
    scrollTopRef.current = rewritePathMap(scrollTopRef.current, from, to)
  }, [])
  const submitEntryDialog=useCallback(()=>{if(entryBusy||entryDialog===undefined)return;const trimmed=entryDraft.trim();const message=entryNameError(entryDraft);if(message!==undefined){setEntryError(message);return}const parentPathValue=entryDialog.mode==='create'?entryDialog.parentPath:parentPath(entryDialog.entry.path);const siblings=directories.get(parentPathValue)?.entries??[];if(entryDialog.mode==='create'){if(siblings.some(entry=>entry.name===trimmed)){setEntryError(translate('entry.duplicate'));return}}else if(trimmed===entryDialog.entry.name||siblings.some(entry=>entry.name===trimmed&&entry.path!==entryDialog.entry.path)){setEntryError(trimmed===entryDialog.entry.name?translate('entry.nameUnchanged'):translate('entry.duplicate'));return}const controller=new AbortController();mutationController.current=controller;setEntryBusy(true);setEntryError(undefined);const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;const request=(async()=>{if(entryDialog.mode==='rename'){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:entryDialog.entry.path,toPath:entryPath(parentPath(entryDialog.entry.path),trimmed)},controller.signal)}return entryDialog.mode==='create'?createEntry(workspace.workspaceId,entryDialog.parentPath,entryDialog.kind,trimmed,controller.signal):renameEntry(workspace.workspaceId,entryDialog.entry.path,trimmed,controller.signal)})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;const mode=entryDialog.mode;const sourcePath=mode==='create'?entryDialog.parentPath:entryDialog.entry.path;const nextStatus=mode==='create'?result.kind==='directory'?translate('status.createdFolder'):translate('status.createdFile'):result.kind==='directory'?translate('status.renamedFolder'):translate('status.renamedFile');composingRef.current=false;setEntryBusy(false);setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);setStatus({text:nextStatus});if(mode==='create'){setExpanded(cur=>{const next=new Set(cur);next.add(sourcePath);if(result.kind==='directory')next.add(result.path);return next});if(result.kind==='file'){previewTabsBootstrapped.current = true;setTabs(cur=>cur.some(tab=>tab.path===result.path)?cur:[...cur,{baseText:'',dirty:false,draft:'',editing:false,name:result.name,path:result.path,pinned:false,saving:false,scrollTop:0,size:null,status:undefined,symlink:Boolean(result.symlink),bom:false,lineEnding:'none',revision:null}]);activatePath(result.path)}setSelected(result);void loadDirectory(sourcePath);if(result.kind==='directory')void loadDirectory(result.path)}else{setDirectories(cur=>rewriteDirectoryMap(cur,sourcePath,result.path,result));setExpanded(cur=>rewritePathSet(cur,sourcePath,result.path));setTabs(cur=>rewritePreviewTabs(cur,sourcePath,result.path,result));rewriteRuntimePaths(sourcePath,result.path);migratePendingAutosavesRef.current?.(sourcePath,result.path);void rewriteEmergencyDraftPath(workspace.workspaceId,draftScopeId,sourcePath,result.path).catch(error=>{if(mounted.current)setStatus({error:true,text:translate('editor.autosaveFailed',{message:error instanceof Error?error.message:String(error)})})});{const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,sourcePath,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath)}setSelected(result);void loadDirectory(parentPath(sourcePath))}}).catch(error=>{if(error?.name==='AbortError'||!mounted.current||mutationSeq!==mutationSeqRef.current){return}if(entryDialog?.mode==='rename'&&draftMoveGeneration!==undefined){void rollbackDraftTree(entryDialog.entry.path,entryPath(parentPath(entryDialog.entry.path),trimmed))}setEntryBusy(false);setEntryError(error instanceof Error?error.message:String(error))}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined;if(mounted.current)setEntryBusy(false)})},[createEntry,directories,draftScopeId,entryBusy,entryDialog,entryDraft,loadDirectory,renameEntry,rewriteRuntimePaths,workspace.workspaceId])
  useLayoutEffect(() => {
    // A user-requested file refresh (the preview header's action) is tracked
    // through this flag: consumed at the start of every read pass so a stale
    // flag can never decorate a later ordinary open with the reloaded status.
    const refreshPending = refreshPendingRef.current
    refreshPendingRef.current = false
    const cancelRestore = activePath !== null && cancelRestoreRef.current === activePath
    if (cancelRestore) cancelRestoreRef.current = null
    if (activePath === null) {
      publishEditorContext(undefined)
      setPreview({ state: 'idle' })
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setDraft('')
      setStatus(undefined)
      baseText.current = ''
      return undefined
    }
    // External (dropped) files carry their decoded content in the tab already:
    // there is no workspace path to re-read and no encoding re-open, so build
    // the read-only preview synchronously and never hit the workspace API.
    const externalTab = tabsRef.current.find(item => item.path === activePath && item.external)
    if (externalTab !== undefined) {
      readController.current?.abort()
      publishEditorContext(undefined)
      const selection = { kind: 'file', name: externalTab.name, path: activePath, symlink: false, external: true }
      setSelected(selection)
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setStatus(undefined)
      const ready = {
        state: 'ready',
        content: externalTab.baseText,
        path: activePath,
        name: externalTab.name,
        symlink: false,
        truncated: false,
        encoding: externalTab.encoding ?? 'utf-8',
        lineEnding: externalTab.lineEnding ?? 'none',
        bom: Boolean(externalTab.bom),
        size: Number.isFinite(externalTab.size) ? externalTab.size : null,
        editable: false,
        readOnlyReason: 'external-file',
      }
      diskBaseRef.current = externalTab.baseText
      baseText.current = externalTab.baseText
      setDraft(externalTab.baseText)
      setPreview(ready)
      return undefined
    }
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    publishEditorContext(undefined)
    const tab = tabsRef.current.find(item => item.path === activePath)
    const effectiveEncoding = requestedEncodingRef.current ?? tab?.encoding ?? 'utf-8'
    // Consume a pending encoding-open request immediately: clearing here keeps
    // an aborted re-read (file switch / tab close mid-flight) from leaking the
    // stale encoding into the next file read.
    requestedEncodingRef.current = undefined
    const selection = tab === undefined ? { kind: 'file', name: activePath.slice(activePath.lastIndexOf('/') + 1), path: activePath } : entryFromPreviewTab(tab)
    setSelected(selection)
    setEditing(Boolean(tab?.editing))
    setDirty(Boolean(tab?.dirty))
    setSaving(Boolean(tab?.saving))
    setStatus(tab?.status)
    setPreview({ state: 'loading', path: activePath })
    readFile(workspace.workspaceId, activePath, controller.signal, effectiveEncoding).then((result) => {
      // The tab may have been switched since the read started (abort covers
      // most cases; a fetch that already resolved is caught here). Applying a
      // stale result would flash the wrong file and bump the read epoch.
      if (!mounted.current || activePathRef.current !== activePath) return
      requestedEncodingRef.current = undefined
      // Read the draft file (staging content + snapshot) so a refresh restores
      // the editing session from disk. A failed draft read is non-critical:
      // fall back to the source.
      return Promise.all([
        loadDraft(workspace.workspaceId, activePath, controller.signal, draftScopeId).catch(() => ({ exists: false })),
        readEmergencyDraft(workspace.workspaceId, draftScopeId, activePath).catch(() => undefined),
      ]).then(([hostDraft, emergencyDraft]) => {
        if (!mounted.current || activePathRef.current !== activePath) return
        const hostGeneration = Number.isSafeInteger(hostDraft?.generation) ? hostDraft.generation : 0
        const emergencyGeneration = Number.isSafeInteger(emergencyDraft?.generation) ? emergencyDraft.generation : 0
        const draftData = emergencyDraft?.state === 'deleted' && emergencyGeneration >= hostGeneration
          ? { exists: false }
          : emergencyDraft?.state !== 'deleted' && typeof emergencyDraft?.draft === 'string'
            && emergencyGeneration >= hostGeneration
            ? emergencyDraft
            : hostDraft
        const tabDraft = tab?.dirty ? tab : undefined
        const editable = result.editable === true
        const diskDraftPresent = draftData !== null && typeof draftData === 'object'
          && draftData.exists !== false && typeof draftData.draft === 'string'
        // A clean fallback draft (draft===baseText), or a stale draft whose text
        // already equals the source, carries no unsaved work and must never
        // override a later disk revision.
        const hasDiskDraft = diskDraftPresent
          && draftData.draft !== draftData.baseText
          && draftData.draft !== result.content
        if (diskDraftPresent && !hasDiskDraft) {
          void removeDraftFile(workspace.workspaceId, activePath, undefined, draftScopeId, Math.max(hostGeneration, emergencyGeneration) + 1).catch(() => {})
          if (emergencyDraft?.state !== 'deleted') {
            void deleteEmergencyDraft(workspace.workspaceId, draftScopeId, activePath, Math.max(hostGeneration, emergencyGeneration)).catch(() => {})
          }
        }
        /* A live tab knows whether its in-memory draft text is materialized.
           This keeps a deliberate empty edit distinct from a content-free dirty
           marker restored from localStorage; cold restores still wait for the
           durable Host/IndexedDB draft instead of treating their empty field as
           a request to erase the source. */
        const hasTabDraft = tabDraft !== undefined && tabDraft.draftKnown === true
          && typeof tabDraft.draft === 'string' && tabDraft.draft !== result.content
        /* In-session the in-memory tab draft is ALWAYS at least as new as any
           disk draft (the host draft and the emergency mirror are only debounced
           copies of it), so prefer it whenever present. Choosing a stale disk
           draft over the live tab draft would roll the editor back and, on the
           next save, write the older text over the source. On a cold restore
           (refresh) the tab is clean, so the disk draft is still the fallback
           that rehydrates the editing session. */
        const restored = hasTabDraft
          ? { content: tabDraft.draft, baseText: tabDraft.baseText, baseRevision: tabDraft.revision }
          : hasDiskDraft
            ? {
                content: draftData.draft,
                baseText: typeof draftData.baseText === 'string' ? draftData.baseText : result.content,
                baseRevision: typeof draftData.baseRevision === 'string' ? draftData.baseRevision : result.revision,
              }
            : { content: result.content, baseText: result.content, baseRevision: result.revision }
        const content = restored.content
        const hasRestoredContent = hasDiskDraft || hasTabDraft
        const canRestore = hasRestoredContent && editable
        const restoredDirty = hasRestoredContent && content !== restored.baseText
        // Compare the SOURCE content to the snapshot: when the source changed
        // since the snapshot (by an external tool), restore still shows the
        // draft and defers to the save-time three-way merge.
        const diskText = typeof result.content === 'string' ? result.content : ''
        const externallyChanged = canRestore && diskText !== restored.baseText
        const ready = {
          state: 'ready',
          ...result,
          name: selection.name,
          path: activePath,
          symlink: Boolean(selection.symlink),
          content,
          revision: result.revision ?? null,
          encoding: result.encoding ?? effectiveEncoding,
          lineEnding: result.lineEnding ?? 'none',
          bom: Boolean(result.bom),
          size: result.size,
        }
        const restoredStatus = canRestore && externallyChanged
          ? { error: true, text: translate('status.draftRestoredConflict') }
          : { text: translate('status.draftRestored') }
        const notRestorableStatus = (hasDiskDraft || hasTabDraft) && !editable
          ? { error: true, text: translate('status.draftNotRestorable') }
          : undefined
        // The source content (as last read) stays separate from the editing
        // baseline: cancel restores the committed snapshot even when a draft
        // restore happened with a stale base.
        diskBaseRef.current = result.content
        baseText.current = restored.baseText
        // Seed the auto-save dedup with the restored draft content (or source
        // content when clean) so the next auto-save only fires after an edit.
        const restoredGeneration = Math.max(hostGeneration, emergencyGeneration)
        // Seed the owner generation counter with the highest generation the
        // Host already knows (its durable owner generation covers every path
        // and every tree op), so the next draft write strictly exceeds it and
        // can never collide with the owner fence after a reload.
        const ownerGeneration = Number.isSafeInteger(hostDraft?.ownerGeneration) ? hostDraft.ownerGeneration : 0
        draftGenerationCounterRef.current = Math.max(draftGenerationCounterRef.current, restoredGeneration, ownerGeneration)
        draftGenerationsRef.current.set(activePath, Math.max(draftGenerationsRef.current.get(activePath) ?? 0, draftGenerationCounterRef.current))
        lastWriteRef.current.set(activePath, { generation: draftGenerationCounterRef.current, content })
        setDraft(content)
        setPreview(ready)
        setEditing(editable)
        setDirty(restoredDirty)
        if (canRestore) {
          setStatus(restoredStatus)
        } else if (hasDiskDraft || hasTabDraft) {
          setStatus(notRestorableStatus)
        }
        if (cancelRestore) setStatus({ text: translate('editor.cancelRestored') })
        else if (refreshPending) setStatus({ text: translate('editor.refreshed') })
        setReadEpoch(epoch => epoch + 1)
        updateTab(activePath, {
          baseText: restored.baseText,
          baseRevision: restored.baseRevision ?? null,
          bom: Boolean(result.bom),
          dirty: restoredDirty,
          draft: content,
          draftKnown: true,
          editing: editable,
          encoding: result.encoding ?? effectiveEncoding,
          lineEnding: result.lineEnding ?? 'none',
          name: selection.name,
          revision: result.revision ?? null,
          saving: false,
          scrollTop: tab?.scrollTop ?? 0,
          size: Number.isFinite(result.size) ? result.size : null,
          status: cancelRestore ? { text: translate('editor.cancelRestored') } : (refreshPending ? { text: translate('editor.refreshed') } : (canRestore ? restoredStatus : ((hasDiskDraft || hasTabDraft) ? notRestorableStatus : tab?.status))),
          symlink: Boolean(selection.symlink),
        })
      })
    }, (error) => {
      if (error?.name !== 'AbortError' && activePathRef.current === activePath) {
        const message = error instanceof Error ? error.message : String(error)
        setPreview({ state: 'error', path: activePath, message })
        updateTab(activePath, { saving: false, status: { error: true, text: message } })
      }
    })
    return () => controller.abort()
  }, [activePath, draftScopeId, loadDraft, publishEditorContext, readFile, reloadToken, removeDraftFile, updateTab, workspace.workspaceId])

  const nextDraftGeneration = useCallback((path) => {
    draftGenerationCounterRef.current += 1
    const next = draftGenerationCounterRef.current
    draftGenerationsRef.current.set(path, next)
    return next
  }, [])
  const clearAutosaveTimer = useCallback((path) => {
    const timer = autosaveTimers.current.get(path)
    if (timer !== undefined) clearTimeout(timer)
    autosaveTimers.current.delete(path)
    pendingAutosavesRef.current.delete(path)
  }, [])
  const enqueueDraftOperation = useCallback((path, generation, operation) => {
    const previous = draftTailsRef.current.get(path) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => {
      if (draftGenerationsRef.current.get(path) !== generation) return { stale: true }
      return operation()
    })
    draftTailsRef.current.set(path, current)
    const cleanup = () => {
      if (draftTailsRef.current.get(path) === current) draftTailsRef.current.delete(path)
    }
    current.then(cleanup, cleanup)
    return current
  }, [])
  const invalidateDraftPath = useCallback((path) => {
    clearAutosaveTimer(path)
    return nextDraftGeneration(path)
  }, [clearAutosaveTimer, nextDraftGeneration])
  const rollbackDraftTree = useCallback(async (fromPath, toPath) => {
    try {
      const generation = nextDraftGeneration('__tree__')
      await draftTree(workspace.workspaceId, {
        action: 'move',
        owner: draftScopeId,
        generation,
        fromPath: toPath,
        toPath: fromPath,
      }, undefined)
    } catch {
      // The rollback is best-effort: the fs operation failed, so the drafts at
      // the target are the only copy of the user's work.
    }
  }, [draftScopeId, draftTree, nextDraftGeneration, workspace.workspaceId])

  /* Drop the per-path runtime bookkeeping when a tab is closed, so reopening
     the same path later starts from a clean slate: no stale scroll position
     resurrected from the previous session, no stale last-write dedup that could
     skip the first auto-save of a repeat edit, no orphan draft generation. The
     tab is guaranteed clean here (dirty/saving tabs cannot be closed), so
     nothing unsaved is dropped. */
  const forgetPathRefs = useCallback((path) => {
    clearAutosaveTimer(path)
    lastWriteRef.current.delete(path)
    scrollTopRef.current.delete(path)
    /* Keep the per-path generation entry alive while a draft operation is
       still queued for this path: closeTab's non-editable-dirty escape enqueues
       a clearDraftFile DELETE just before forgetPathRefs runs, and
       enqueueDraftOperation's staleness gate compares against this entry —
       deleting it synchronously would judge that DELETE stale and skip it, so
       the discarded staging draft would survive and resurrect the stuck tab on
       reopen. Defer the deletion until the queued tail settles. */
    const tail = draftTailsRef.current.get(path)
    if (tail === undefined) draftGenerationsRef.current.delete(path)
    else tail.catch(() => {}).finally(() => { draftGenerationsRef.current.delete(path) })
  }, [clearAutosaveTimer])

  /* After committing `content` to the source file, remove the staging draft so
     a later refresh does not resurrect it. If the removal fails (rare), leave a
     CLEAN draft (baseText === draft === content, fresh revision) so the next
     restore sees no unsaved state either way. */
  const clearDraftFile = useCallback((path, content, encoding, lineEnding, bom, revision) => {
    const generation = invalidateDraftPath(path)
    return enqueueDraftOperation(path, generation, async () => {
      let result
      try {
        result = await removeDraftFile(workspace.workspaceId, path, undefined, draftScopeId, generation)
      } catch {
        // Fall through to a clean generation. Restore treats draft===disk as
        // clean, so even a failed DELETE cannot resurrect old user edits.
      }
      if (result?.deleted !== true) {
        result = await persistDraftFile(workspace.workspaceId, path, {
          owner: draftScopeId,
          encoding,
          lineEnding,
          bom,
          baseText: content,
          baseRevision: revision,
          draft: content,
          generation,
        }, undefined)
      }
      /* Best-effort: the emergency IndexedDB mirror tombstone is bookkeeping
         (its only job is suppressing a later restore); a mirror failure must
         never fail the save/cancel flow the host draft DELETE already drove. */
      await deleteEmergencyDraft(workspace.workspaceId, draftScopeId, path, generation).catch(() => {})
      return result
    })
  }, [draftScopeId, enqueueDraftOperation, invalidateDraftPath, persistDraftFile, removeDraftFile, workspace.workspaceId])

  /* Write `content` to the SOURCE file for `path` and mark the tab committed
     (clean). Used by the explicit save, the clean three-way merge, and the
     conflict resolution. Returns true on success; throws on failure. */
  const commitTab = useCallback(async (path, content, revision, encoding, statusText) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return false
    const controller = new AbortController()
    saveController.current = controller
    try {
      const result = await saveFile(workspace.workspaceId, path, content, revision, controller.signal, encoding)
      if (!mounted.current) return false
      const savedEncoding = result.encoding ?? encoding
      const savedBom = Boolean(result.bom)
      const size = Number.isFinite(result.size) ? result.size : new TextEncoder().encode(content).byteLength
      const savedStatus = { text: statusText ?? translate('editor.saved') }
      try {
        await clearDraftFile(path, content, savedEncoding, tab.lineEnding ?? 'none', savedBom, result.revision ?? revision)
      } catch (error) {
        // Best-effort: the source write above already succeeded, so a failed
        // draft cleanup must not fail the save. A stale draft is reconciled by
        // the restore path (draft===disk is treated as clean) or the next
        // auto-save; the emergency IndexedDB mirror already holds the newest
        // content for the unload case.
        console.warn('workspace-studio: draft cleanup after save failed:', error)
      }
      if (!mounted.current) return false
      lastWriteRef.current.set(path, { revision: null, content })
      updateTab(path, {
        baseText: content,
        baseRevision: result.revision ?? revision ?? null,
        bom: savedBom,
        dirty: false,
        draft: content,
        draftKnown: true,
        editing: true,
        encoding: savedEncoding,
        lineEnding: tab.lineEnding ?? 'none',
        revision: result.revision ?? revision,
        saving: false,
        size,
        status: savedStatus,
        externalConflict: false,
      })
      if (activePathRef.current === path) {
        baseText.current = content
        diskBaseRef.current = content
        setDraft(content)
        setDirty(false)
        setEditing(true)
        setPreview(current => current.state === 'ready' && current.path === path
          ? { ...current, content, encoding: savedEncoding, bom: savedBom, revision: result.revision ?? current.revision, size }
          : current)
        setStatus(savedStatus)
      }
      return true
    } finally {
      if (saveController.current === controller) saveController.current = undefined
    }
  }, [activePathRef, clearDraftFile, saveFile, updateTab, workspace.workspaceId])

  /* Auto-save an immutable snapshot. No active-editor ref is read after the
     snapshot is created, so switching files cannot cross-wire merge bases. */
  const performAutosave = useCallback(async (path, snapshot, generation) => {
    try {
      const result = await enqueueDraftOperation(path, generation, () => persistDraftFile(workspace.workspaceId, path, {
        ...snapshot,
        generation,
      }, undefined))
      if (result?.stale === true || draftGenerationsRef.current.get(path) !== generation) return
      lastWriteRef.current.set(path, { generation, content: snapshot.draft })
      const pending = pendingAutosavesRef.current.get(path)
      if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return
      const message = error instanceof Error ? error.message : String(error)
      if (activePathRef.current === path) setStatus({ error: true, text: translate('editor.autosaveFailed', { message }) })
    }
  }, [enqueueDraftOperation, persistDraftFile, workspace.workspaceId])

  const scheduleAutosave = useCallback((path, text, force = false) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined || tab.external || tab.saving || (!force && tab.editing !== true)) return
    // Drop the pending timer first: an edit that reverts to the last-written
    // text must not let an earlier (different-content) timer fire afterwards;
    // the dedup return below skips the generation bump, so the stale timer
    // would bypass the enqueueDraftOperation staleness check too.
    clearAutosaveTimer(path)
    // Skip a redundant write when the draft equals the last content this owner
    // persisted for the path (dedup documented in development-notes §15 but
    // never wired): typing back to the last-written text must not rewrite the
    // staging file or the IndexedDB mirror.
    if (lastWriteRef.current.get(path)?.content === text) return
    const generation = nextDraftGeneration(path)
    const snapshot = Object.freeze({
      owner: draftScopeId,
      encoding: tab.encoding ?? 'utf-8',
      lineEnding: tab.lineEnding ?? 'none',
      bom: Boolean(tab.bom),
      baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
      baseRevision: tab.baseRevision ?? tab.revision ?? null,
      draft: text,
    })
    pendingAutosavesRef.current.set(path, { generation, snapshot })
    void writeEmergencyDraft(workspace.workspaceId, draftScopeId, path, { ...snapshot, generation }).catch(error => {
      if (!mounted.current || activePathRef.current !== path) return
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ error: true, text: translate('editor.autosaveFailed', { message }) })
    })
    const timer = setTimeout(() => {
      autosaveTimers.current.delete(path)
      void performAutosave(path, snapshot, generation)
    }, AUTOSAVE_DELAY_MS)
    autosaveTimers.current.set(path, timer)
  }, [clearAutosaveTimer, draftScopeId, nextDraftGeneration, performAutosave, workspace.workspaceId])

  const flushAutosaves = useCallback(() => {
    for (const timer of autosaveTimers.current.values()) clearTimeout(timer)
    autosaveTimers.current.clear()
    for (const [path, pending] of pendingAutosavesRef.current) {
      void performAutosave(path, pending.snapshot, pending.generation)
    }
  }, [performAutosave])

  /* When a directory holding a dirty tab is moved or renamed, the tab's
     pending (debounced, not yet flushed) auto-save must follow the path.
     Re-keying the pending map alone is not enough: the old timer still
     captures the old path, and the tree op bumped the generation fence, so
     the old generation would be rejected. Cancel the old timers, drop the
     stale entries, and flush each snapshot at the new path with a fresh
     generation. Otherwise the newest edits would survive only in the
     IndexedDB mirror, which the restore discards because its generation is
     older than the moved Host draft's. */
  const migratePendingAutosaves = useCallback((from, to) => {
    const pending = pendingAutosavesRef.current
    const timers = autosaveTimers.current
    const affected = []
    for (const [path, entry] of pending) {
      if (path === from || (from !== '' && path.startsWith(`${from}/`))) {
        affected.push({ path, snapshot: entry.snapshot })
      }
    }
    for (const { path } of affected) {
      const timer = timers.get(path)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(path)
      pending.delete(path)
    }
    for (const { path, snapshot } of affected) {
      const nextPath = rewriteRelativePath(path, from, to)
      const generation = nextDraftGeneration(nextPath)
      // Keep the re-keyed entry pending so an unload between now and the
      // flush still persists it (flushAutosaves covers the map); the timer
      // fires on the next tick.
      pending.set(nextPath, { generation, snapshot })
      const timer = setTimeout(() => {
        timers.delete(nextPath)
        void performAutosave(nextPath, snapshot, generation)
      }, 0)
      timers.set(nextPath, timer)
    }
  }, [nextDraftGeneration, performAutosave])

  // The unmount cleanup must run exactly once per real unmount. flushAutosaves
  // depends on performAutosave → `preview`, so its identity changes on every
  // preview transition; listing it in the deps would re-run the effect and
  // abort in-flight requests (tree listing + active file read), leaving both
  // stuck loading. Snapshot the callbacks in refs so the effect stays stable.
  const flushAutosavesRef = useRef(flushAutosaves)
  flushAutosavesRef.current = flushAutosaves
  const persistSessionTabsRef = useRef(persistSessionTabs)
  persistSessionTabsRef.current = persistSessionTabs
  const publishEditorContextRef = useRef(publishEditorContext)
  publishEditorContextRef.current = publishEditorContext
  const abortRequestsRef = useRef(abortRequests)
  abortRequestsRef.current = abortRequests
  // migratePendingAutosaves depends on callbacks declared later than the
  // create/rename handlers that call it, so it rides a ref bridge (body
  // references are lazy and TDZ-safe; the ref identity is stable).
  const migratePendingAutosavesRef = useRef(migratePendingAutosaves)
  migratePendingAutosavesRef.current = migratePendingAutosaves
  useEffect(() => {
    mounted.current = true
    return () => {
      flushAutosavesRef.current()
      persistSessionTabsRef.current()
      mounted.current = false
      clearTimeout(copyNoticeTimer.current)
      searchController.current?.abort()
      publishEditorContextRef.current(undefined)
      abortRequestsRef.current()
    }
  }, [])

  // Navigation never unmounts React, so the unmount cleanup above cannot cover
  // a refresh or tab close. Flush the pending auto-saves and persist the final
  // tab session synchronously on page hide/unload.
  useEffect(() => {
    const flush = () => { flushAutosavesRef.current(); persistSessionTabsRef.current() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  /* A keystroke can land between the save's text snapshot and the editor
     freeze (the editable compartment reconfigures in a passive effect after
     the saving flag commits). It stays visible yet is marked clean by the
     commit; recover it as an unsaved edit so it is never silently dropped.
     Only relevant while this tab is active (a tab switch swaps editorRef).
     Declared BEFORE save: save's dependency array references it (TDZ rule). */
  const preservePostSaveKeystrokes = useCallback((path, committedText) => {
    if (activePathRef.current !== path) return
    const view = editorRef.current
    if (view === undefined) return
    const liveText = view.state.sliceDoc()
    if (liveText === committedText) return
    setDraft(liveText)
    setDirty(true)
    updateTab(path, { draft: liveText, draftKnown: true, dirty: true })
    scheduleAutosave(path, liveText)
  }, [scheduleAutosave, updateTab])

  const save = useCallback(async (encodingOverride) => {
    if (preview.state !== 'ready' || saving || activeTab === undefined) return false
    const forceSaveAs = encodingOverride !== undefined && encodingOverride !== null
    if (!forceSaveAs && !dirty) return false
    if (forceSaveAs && (preview.editable === false || preview.readOnlyReason)) {
      setStatus({ error: true, text: translate('editor.saveAsFailed', { reason: readOnlyReason(preview) }) })
      return false
    }
    const path = activeTab.path
    // Capture the complete save transaction before the first await. Switching
    // tabs may change the active refs, but it must never change this file's
    // merge base, revision, or source decode.
    const baseAtSave = typeof activeTab.baseText === 'string' ? activeTab.baseText : baseText.current
    const sourceRevision = activeTab.revision ?? preview.revision
    const sourceEncoding = activeTab.encoding ?? preview.encoding ?? 'utf-8'
    const encoding = forceSaveAs ? String(encodingOverride) : sourceEncoding
    const text = editorRef.current?.state.sliceDoc() ?? draft
    const savingStatus = { text: forceSaveAs ? translate('editor.savingWith', { encoding: encodingLabel(encoding) }) : translate('editor.saving') }
    setSaving(true)
    setStatus(savingStatus)
    updateTab(path, { draft: text, draftKnown: true, dirty: true, saving: true, status: savingStatus })
    const savedStatusText = forceSaveAs ? translate('editor.savedAs', { encoding: encodingLabel(encoding) }) : translate('editor.saved')
    try {
      // Authoritative current disk state: re-read before deciding how to write.
      const disk = await readFile(workspace.workspaceId, path, undefined, sourceEncoding)
      if (!mounted.current) return false
      if (typeof disk?.content !== 'string') throw new Error('invalid read response')
      const diskText = disk.content
      const diskRevision = typeof disk?.revision === 'string' ? disk.revision : undefined
      if (diskText === text) {
        // The source already equals the current draft; commit as-is (the write
        // is idempotent and also clears the staging draft).
        const ok = await commitTab(path, text, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok) preservePostSaveKeystrokes(path, text)
        return ok
      }
      if (diskText === baseAtSave) {
        // The source is untouched since our snapshot: silent write-back.
        const ok = await commitTab(path, text, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok) preservePostSaveKeystrokes(path, text)
        return ok
      }
      // The source changed externally → three-way merge against the snapshot.
      const merged = threeWayMerge(baseAtSave, text, diskText)
      if (merged.status === 'clean') {
        const ok = await commitTab(path, merged.merged, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok && activePathRef.current === path) {
          // Show the merged result (it differs from both sides) — but only when
          // no keystroke landed while the merge ran: dispatching the merged doc
          // would silently wipe text typed against the pre-merge document, the
          // same window preservePostSaveKeystrokes covers on the write-back
          // branches. When the live doc diverged, keep it (nothing dropped) and
          // mark the tab dirty again; commitTab already wrote merged.merged, so
          // the next save re-merges against that newer source.
          const view = editorRef.current
          if (view !== undefined) {
            const liveBefore = view.state.sliceDoc()
            if (liveBefore === text) {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: merged.merged } })
            } else {
              setDraft(liveBefore)
              setDirty(true)
              updateTab(path, { draft: liveBefore, draftKnown: true, dirty: true })
              scheduleAutosave(path, liveBefore)
              setStatus({ error: true, text: translate('editor.saveTypedDuringMerge') })
            }
          }
        }
        return ok
      }
      // Overlapping changes → ask the user to pick; keep the tab busy so no
      // auto-save races the pending decision. Conflict positions stay
      // structural — never literal markers in the content — so the file text
      // cannot collide with an implementation marker.
      const dialog = { path, mine: text, theirs: diskText, diskRevision, encoding, savedStatusText, conflicts: merged.conflicts, parts: merged.parts }
      conflictDialogRef.current = dialog
      setConflictDialog(dialog)
      return false
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return false
      // A 409/412 race on the final write means the file changed mid-save: fall
      // back to the same conflict messaging as a plain conflict.
      const failure = error?.status === 409 || error?.status === 412
        ? translate('editor.saveConflict')
        : translate('editor.saveFailed', { message: error instanceof Error ? error.message : String(error) })
      updateTab(path, { dirty: true, draft: text, draftKnown: true, editing: true, saving: false, status: { error: true, text: failure } })
      if (activePathRef.current === path) setStatus({ error: true, text: failure })
      return false
    } finally {
      // Keep the tab busy while a conflict prompt is pending so no auto-save
      // races the unresolved decision; resolveConflict releases it.
      if (mounted.current && conflictDialogRef.current === undefined) {
        updateTab(path, { saving: false })
        if (activePathRef.current === path) setSaving(false)
      }
    }
  }, [activeTab, baseText, commitTab, dirty, draft, preview, preservePostSaveKeystrokes, readFile, scheduleAutosave, saving, updateTab, workspace.workspaceId])

  /* Resolve the pending save conflict. The dialog walks conflicts one at a
     time and calls back with { choices } ('mine'/'theirs' per conflict, in
     order) or 'cancel'. The resolved file is the merge skeleton — every
     non-conflicting change already applied — with each conflict marker line
     replaced by the chosen side's lines. */
  const resolveConflict = useCallback(async (result) => {
    const dialog = conflictDialogRef.current
    if (dialog === undefined) return
    conflictDialogRef.current = undefined
    setConflictDialog(undefined)
    const { path, diskRevision, encoding, savedStatusText, conflicts, parts } = dialog
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    const finish = () => {
      updateTab(path, { saving: false })
      if (activePathRef.current === path) setSaving(false)
    }
    if (result === 'cancel') {
      setStatus({ text: translate('editor.saveCancelled') })
      finish()
      return
    }
    const choices = Array.isArray(result?.choices) ? result.choices : []
    let resolved
    try {
      resolved = resolveMergeParts(parts, conflicts, choices)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ error: true, text: translate('editor.saveFailed', { message }) })
      finish()
      return
    }
    try {
      const ok = await commitTab(path, resolved, diskRevision ?? tab.revision, encoding, savedStatusText)
      if (ok && activePathRef.current === path) {
        // The resolved file can differ from both sides (mixed picks), so show
        // it in the editor explicitly.
        const view = editorRef.current
        if (view !== undefined) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: resolved } })
      }
      if (!ok) setStatus({ error: true, text: translate('editor.saveConflict') })
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ error: true, text: translate('editor.saveFailed', { message }) })
    } finally {
      finish()
    }
  }, [activePathRef, commitTab, updateTab])

  const cancel = useCallback(async () => {
    if (preview.state !== 'ready' || saving || activeTab === undefined || !dirty) return
    const path = activeTab.path
    const discardedText = editorRef.current?.state.sliceDoc() ?? draft
    const diskContent = diskBaseRef.current
    const encoding = activeTab.encoding ?? preview.encoding ?? 'utf-8'
    const lineEnding = activeTab.lineEnding ?? preview.lineEnding ?? 'none'
    const bom = Boolean(activeTab.bom ?? preview.bom)
    const revision = activeTab.revision ?? preview.revision ?? null
    // Make the editor read-only while the path queue drains. The queued DELETE
    // is ordered after any PUT already executing, so discarded text cannot be
    // recreated after cancellation.
    setSaving(true)
    updateTab(path, { saving: true })
    try {
      await clearDraftFile(path, diskContent, encoding, lineEnding, bom, revision)
      if (!mounted.current) return
      lastWriteRef.current.set(path, { generation: draftGenerationsRef.current.get(path) ?? 0, content: diskContent })
      updateTab(path, { dirty: false, draft: '', draftKnown: false, editing: true, saving: false, status: { text: translate('editor.cancelRestored') } })
      if (activePathRef.current === path) {
        setDraft('')
        setDirty(false)
        cancelRestoreRef.current = path
        setReloadToken(token => token + 1)
      }
    } catch (error) {
      if (!mounted.current) return
      const message = error instanceof Error ? error.message : String(error)
      const failure = { error: true, text: translate('editor.cancelFailed', { message }) }
      updateTab(path, { dirty: true, draft: discardedText, draftKnown: true, editing: true, saving: false, status: failure })
      if (activePathRef.current === path) {
        setDraft(discardedText)
        setDirty(true)
        setStatus(failure)
      }
    } finally {
      if (mounted.current && activePathRef.current === path) setSaving(false)
    }
  }, [activeTab, clearDraftFile, dirty, draft, preview, saving, updateTab])
  /* A non-editable file (read-only, oversized, editing disabled) with a
     leftover draft has no save/cancel path — both are gated on editability —
     so the tab would be stuck dirty with no way to close, save, or refresh.
     This is the escape: discard the staging draft and re-read the source so
     the tab returns to a clean read-only preview; the file is never touched. */
  const discardDraft = useCallback(async () => {
    if (preview.state !== 'ready' || saving || activeTab === undefined || !dirty) return
    const path = activeTab.path
    const encoding = activeTab.encoding ?? preview.encoding ?? 'utf-8'
    const lineEnding = activeTab.lineEnding ?? preview.lineEnding ?? 'none'
    const bom = Boolean(activeTab.bom ?? preview.bom)
    const revision = activeTab.revision ?? preview.revision ?? null
    setSaving(true)
    updateTab(path, { saving: true })
    try {
      await clearDraftFile(path, '', encoding, lineEnding, bom, revision)
      if (!mounted.current) return
      lastWriteRef.current.set(path, { generation: draftGenerationsRef.current.get(path) ?? 0, content: '' })
      // Mark clean BEFORE the re-read so the read pass cannot resurrect the
      // discarded draft from the tab (same ordering rule as cancel).
      updateTab(path, { dirty: false, draft: '', draftKnown: false, editing: false, saving: false, status: { text: translate('editor.cancelRestored') } })
      if (activePathRef.current === path) {
        setDraft('')
        setDirty(false)
        cancelRestoreRef.current = path
        setReloadToken(token => token + 1)
      }
    } catch (error) {
      if (!mounted.current) return
      const message = error instanceof Error ? error.message : String(error)
      const failure = { error: true, text: translate('editor.cancelFailed', { message }) }
      updateTab(path, { dirty: true, editing: false, saving: false, status: failure })
      if (activePathRef.current === path) setStatus(failure)
    } finally {
      if (mounted.current && activePathRef.current === path) setSaving(false)
    }
  }, [activeTab, clearDraftFile, dirty, preview, saving, updateTab])
  const refresh=useCallback(()=>{if(hasDirtyTabs){setStatus({error:true,text:translate('tree.refreshBlocked')});return}abortDirectoryRequests();setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false;setDirectories(new Map());setExpanded(new Set(['']));setStatus(undefined);void loadDirectory('')},[abortDirectoryRequests,hasDirtyTabs,loadDirectory])
  const toggleDirectory=useCallback(entry=>{const path=entry.path;const opening=!expanded.has(path);setExpanded(cur=>{const next=new Set(cur);opening?next.add(path):next.delete(path);return next});if(opening){if(directories.get(path)?.state!=='ready')void loadDirectory(path);chooseDirectory(entry)}else setSelected(entry)},[chooseDirectory,directories,expanded,loadDirectory])
  const openContextMenu=useCallback((event,entry)=>{event.preventDefault();setSelected(entry);setContextMenu({entry,x:event.clientX,y:event.clientY})},[])
  const copyEntryPath=useCallback((entry,relative)=>{const value=relative?entry.path:joinAbsolutePath(workspace.path,entry.path);void copyText(value).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?(relative?translate('status.copiedRelative'):translate('status.copiedPath')):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[workspace.path])
  const copyEntryName=useCallback((entry)=>{void copyText(entry.name).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?translate('status.copiedName'):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[])
  const openInExplorer=useCallback((entry)=>{setContextMenu(undefined);const controller=new AbortController();revealInExplorer(workspace.workspaceId,entry.path,controller.signal).then(()=>{if(!mounted.current)return;setCopyNotice(translate('status.revealed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)}).catch(error=>{if(!mounted.current||error?.name==='AbortError')return;setCopyNotice(translate('status.revealFailed',{message:error instanceof Error?error.message:String(error)}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)})},[workspace.workspaceId])
  const copyEntryToClipboard=useCallback((entry,cut)=>{setContextMenu(undefined);setClipboard({workspaceId:workspace.workspaceId,path:entry.path,name:entry.name,kind:entry.kind,cut});setCopyNotice(cut?translate('status.cut'):translate('status.copied'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)},[workspace.workspaceId])
  const pasteEntry=useCallback((targetEntry)=>{if(clipboard===undefined||clipboard.workspaceId!==workspace.workspaceId)return;const targetDir=targetEntry.kind==='directory'?targetEntry.path:parentPath(targetEntry.path);const targetPath=entryPath(targetDir,pathBaseName(clipboard.path));if(clipboard.cut&&clipboard.path===targetPath)return;const wasCut=clipboard.cut;const affectedPrefix=clipboard.path===''?'':`${clipboard.path}/`;if(wasCut&&tabsRef.current.some(tab=>{if(!tab.dirty&&!tab.saving)return false;return tab.path===clipboard.path||(affectedPrefix!==''&&tab.path.startsWith(affectedPrefix))})){setStatus({error:true,text:translate('editor.unsavedBlocked')});return}const controller=new AbortController();mutationController.current=controller;const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;let draftMoveFailed=false;const request=(async()=>{const result=await requestFsOperation(workspace.workspaceId,{action:wasCut?'move':'copy',source:clipboard.path,target:targetPath},controller.signal);if(wasCut){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:clipboard.path,toPath:result.path},controller.signal).catch(async error=>{if(!mounted.current)return;draftMoveFailed=true;console.warn('workspace-studio: draft move after fs move failed:',error);setStatus({error:true,text:translate('status.movedDraftWarning')});try{await draftTree(workspace.workspaceId,{action:'delete',owner:draftScopeId,generation:nextDraftGeneration('__tree__'),path:clipboard.path},controller.signal)}catch(cleanupError){if(mounted.current)console.warn('workspace-studio: draft cleanup after failed move also failed:',cleanupError)}})}return result})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;setContextMenu(undefined);setStatus(draftMoveFailed?{error:true,text:translate('status.movedDraftWarning')}:{text:wasCut?translate('status.moved'):translate('status.pasted')});if(wasCut){const source=clipboard.path;setClipboard(undefined);setSelected(result);setDirectories(cur=>rewriteDirectoryMap(cur,source,result.path,result));setExpanded(cur=>rewritePathSet(cur,source,result.path));setTabs(cur=>rewritePreviewTabs(cur,source,result.path,result));rewriteRuntimePaths(source,result.path);migratePendingAutosavesRef.current?.(source,result.path);void rewriteEmergencyDraftPath(workspace.workspaceId,draftScopeId,source,result.path).catch(error=>{if(mounted.current)setStatus({error:true,text:translate('editor.autosaveFailed',{message:error instanceof Error?error.message:String(error)})})});const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,source,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath);void loadDirectory(parentPath(source));void loadDirectory(targetDir)}else{void loadDirectory(targetDir)}}).catch(error=>{if(error?.name==='AbortError'||!mounted.current||mutationSeq!==mutationSeqRef.current)return;setCopyNotice(translate(wasCut?'status.cutFailed':'status.pasteFailed',{message:error instanceof Error?error.message:String(error)}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined})},[clipboard,draftScopeId,draftTree,loadDirectory,nextDraftGeneration,rewriteRuntimePaths,workspace.workspaceId])
  const openDeleteConfirm=useCallback(entry=>{setContextMenu(undefined);setDeleteDialog(entry);setDeleteBusy(false)},[])
  const closeDeleteDialog=useCallback(()=>{if(deleteBusy)return;setDeleteDialog(undefined)},[deleteBusy])
  const confirmDelete = useCallback(async () => {
    if (deleteBusy || deleteDialog === undefined) return
    const entry = deleteDialog
    const prefix = entry.path === '' ? '' : `${entry.path}/`
    const affected = tabsRef.current
      .filter(tab => tab.path === entry.path || (prefix !== '' && tab.path.startsWith(prefix)))
      .map(tab => ({ path: tab.path, draft: tab.draft, dirty: tab.dirty || tab.saving, saving: tab.saving }))
    // Deleting under an in-flight save would race it: the save's PUT hits a
    // 404 and its failure toast lands on a tab that no longer exists. Refuse
    // and close the dialog instead (the warning row also mentions saving tabs,
    // so the reason is visible before confirming).
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
    // Drain requests that already reached the Host before deleting the source;
    // otherwise a late PUT could recreate a draft for a future same-named file.
    await Promise.all(affected.map(item => (draftTailsRef.current.get(item.path) ?? Promise.resolve()).catch(() => {})))
    if (!mounted.current) return
    const treeGeneration = nextDraftGeneration('__tree__')
    try {
      await draftTree(workspace.workspaceId, { action: 'delete', owner: draftScopeId, generation: treeGeneration, path: entry.path }, controller.signal)
    } catch (error) {
      // The source tree was not touched, so the delete can be retried. Keep the
      // dialog open, release the busy flag, and reschedule the affected drafts
      // exactly like the fs-operation failure path below.
      if (!mounted.current || mutationSeq !== mutationSeqRef.current) return
      setDeleteBusy(false)
      for (const item of affected) {
        if (!item.dirty) continue
        // Use the tab's CURRENT draft, not the stale `affected` snapshot: the
        // delete dialog keeps focus in the editor, so the user may have typed
        // after capture, and a failed delete must not roll the staging draft
        // back to older text. force=true also re-writes staging drafts of
        // NON-editable dirty tabs (their scheduleAutosave gate would skip them
        // otherwise), so a failed delete never destroys an orphaned draft.
        // Drop the autosave dedup for this path FIRST: draftTree already
        // tombstoned these drafts, yet lastWriteRef still records the same
        // text, so scheduleAutosave's content-dedup would skip the re-write
        // and the orphaned draft would stay lost until the next edit.
        const fresh = tabsRef.current.find(tab => tab.path === item.path)
        lastWriteRef.current.delete(item.path)
        scheduleAutosave(item.path, fresh?.draft ?? item.draft, true)
      }
      if (error?.name === 'AbortError') return
      setCopyNotice(translate('status.deleteFailed', { message: error instanceof Error ? error.message : String(error) }))
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
        lastWriteRef.current.delete(item.path)
        draftGenerationsRef.current.delete(item.path)
        scrollTopRef.current.delete(item.path)
      }
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
        // delete dialog keeps focus in the editor, so the user may have typed
        // after capture, and a failed delete must not roll the staging draft
        // back to older text. force=true also re-writes staging drafts of
        // NON-editable dirty tabs (their scheduleAutosave gate would skip them
        // otherwise), so a failed delete never destroys an orphaned draft.
        // Drop the autosave dedup for this path FIRST: draftTree already
        // tombstoned these drafts, yet lastWriteRef still records the same
        // text, so scheduleAutosave's content-dedup would skip the re-write
        // and the orphaned draft would stay lost until the next edit.
        const fresh = tabsRef.current.find(tab => tab.path === item.path)
        lastWriteRef.current.delete(item.path)
        scheduleAutosave(item.path, fresh?.draft ?? item.draft, true)
      }
      if (error?.name === 'AbortError') return
      setCopyNotice(translate('status.deleteFailed', { message: error instanceof Error ? error.message : String(error) }))
      clearTimeout(copyNoticeTimer.current)
      copyNoticeTimer.current = setTimeout(() => { if (mounted.current) setCopyNotice(undefined) }, 3000)
    }).finally(() => {
      if (mutationController.current === controller) mutationController.current = undefined
    })
  }, [activatePath, deleteBusy, deleteDialog, draftScopeId, draftTree, invalidateDraftPath, loadDirectory, scheduleAutosave, selected?.path, workspace.workspaceId])
  useEffect(()=>{
    const onKeyDown=event=>{
      if(event.isComposing)return
      const key=event.key
      const withMod=event.ctrlKey||event.metaKey
      const isFileShortcut=(withMod&&(key==='c'||key==='C'||key==='x'||key==='X'||key==='v'||key==='V'))||key==='Delete'
      if(!isFileShortcut)return
      const target=event.target
      const element=target instanceof Element?target:target instanceof Node?target.parentElement:null
      if(element===null)return
      if(element.tagName==='INPUT'||element.tagName==='TEXTAREA'||element.tagName==='SELECT'||element.isContentEditable)return
      // The file shortcuts only fire while a tree row is focused (or the tree
      // context menu is open); editors and inputs keep their native behavior.
      const treeFocused=element.classList.contains('dsh-ws-tree-row')
      if(!treeFocused&&contextMenu===undefined)return
      if(selected===undefined)return
      event.preventDefault()
      event.stopPropagation()
      if(key==='Delete'){openDeleteConfirm(selected);return}
      if(key==='c'||key==='C'){copyEntryToClipboard(selected,false);return}
      if(key==='x'||key==='X'){copyEntryToClipboard(selected,true);return}
      pasteEntry(selected)
    }
    window.addEventListener('keydown',onKeyDown,true)
    return()=>window.removeEventListener('keydown',onKeyDown,true)
  },[contextMenu,copyEntryToClipboard,openDeleteConfirm,pasteEntry,selected])
  const openSessionRename=useCallback(()=>{setTitleContextMenu(undefined);setSessionRenameDraft(sessionTitle ?? '');setSessionRenameError(undefined);setSessionRenameOpen(true)},[sessionTitle])
  const closeSessionRename=useCallback(()=>{if(sessionRenameBusy)return;setSessionRenameOpen(false);setSessionRenameDraft('');setSessionRenameError(undefined)},[sessionRenameBusy])
  const confirmSessionRename=useCallback(()=>{if(sessionRenameBusy||sessionId===undefined)return;const trimmed=sessionRenameDraft.trim();if(trimmed==='')return;setSessionRenameBusy(true);setSessionRenameError(undefined);renameSession(String(sessionId),trimmed).then(()=>{if(!mounted.current)return;setSessionRenameBusy(false);setSessionRenameOpen(false);setSessionRenameDraft('')}).catch(error=>{if(!mounted.current)return;setSessionRenameBusy(false);setSessionRenameError(error instanceof Error?error.message:String(error))})},[renameSession,sessionId,sessionRenameBusy,sessionRenameDraft])
  const runSearch=useCallback(async(query)=>{searchController.current?.abort();if(query.trim()===''){setSearchState({state:'idle'});setSearchExpanded(new Set());return}const controller=new AbortController();searchController.current=controller;setSearchState({state:'searching'});try{const result=await requestSearch(workspace.workspaceId,query,searchCaseSensitive,searchNameOnly,controller.signal);if(searchController.current===controller){setSearchState({state:'done',result});setSearchExpanded(new Set((settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT)?result.files.map(file=>file.path):[]))}}catch(error){if(error?.name==='AbortError')return;if(searchController.current===controller)setSearchState({state:'error',message:error instanceof Error?error.message:String(error)})}},[searchCaseSensitive,searchNameOnly,settings.expandSearchMatches,workspace.workspaceId])
  const closeSearch=useCallback(()=>{searchController.current?.abort();searchController.current=undefined;setSearchExpanded(new Set());setSearchOpen(false)},[])
  const openSearchMatch=useCallback((file,match)=>{const entry={kind:'file',name:file.name,path:file.path,symlink:false};chooseFile(entry);searchRevealToken.current+=1;setSearchReveal({column:match.startLineColumn??match.startColumn,endColumn:match.endLineColumn??match.endColumn,line:match.line,path:file.path,token:searchRevealToken.current})},[chooseFile])
  const openSearchEntry=useCallback((file)=>{const entry={kind:file.kind==='directory'?'directory':'file',name:file.name,path:file.path,symlink:false};if(entry.kind==='directory'){chooseDirectory(entry);closeSearch()}else chooseFile(entry)},[chooseDirectory,chooseFile,closeSearch])
  const toggleSearchFile=useCallback((path)=>{setSearchExpanded(prev=>{const next=new Set(prev);if(next.has(path))next.delete(path);else next.add(path);return next})},[])
  useEffect(()=>{if(!searchOpen)return undefined;const timer=setTimeout(()=>{void runSearch(searchQuery)},300);return()=>clearTimeout(timer)},[runSearch,searchOpen,searchQuery])
  useEffect(()=>{if(contextMenu===undefined)return undefined;const inside=event=>{const node=menuRef.current;return node!==null&&event.target instanceof Node&&node.contains(event.target)};const close=()=>setContextMenu(undefined);const onPointerDown=event=>{if(!inside(event))close()};const onContextMenu=event=>{if(!inside(event))close()};const onKeyDown=event=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',onPointerDown);window.addEventListener('contextmenu',onContextMenu,true);window.addEventListener('keydown',onKeyDown);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('contextmenu',onContextMenu,true);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}},[contextMenu])
  useEffect(()=>{if(tabContextMenu===undefined)return undefined;const inside=event=>{const node=tabMenuRef.current;return node!==null&&event.target instanceof Node&&node.contains(event.target)};const close=()=>setTabContextMenu(undefined);const onPointerDown=event=>{if(!inside(event))close()};const onContextMenu=event=>{if(!inside(event))close()};const onKeyDown=event=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',onPointerDown);window.addEventListener('contextmenu',onContextMenu,true);window.addEventListener('keydown',onKeyDown);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('contextmenu',onContextMenu,true);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}},[tabContextMenu])
  useEffect(()=>{if(titleContextMenu===undefined)return undefined;const inside=event=>{const node=titleMenuRef.current;return node!==null&&event.target instanceof Node&&node.contains(event.target)};const close=()=>setTitleContextMenu(undefined);const onPointerDown=event=>{if(!inside(event))close()};const onContextMenu=event=>{if(!inside(event))close()};const onKeyDown=event=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',onPointerDown);window.addEventListener('contextmenu',onContextMenu,true);window.addEventListener('keydown',onKeyDown);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('contextmenu',onContextMenu,true);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}},[titleContextMenu])
  const openWithEncoding = useCallback((encodingId) => {
    if (dirty) {
      setStatus({ error: true, text: translate('editor.dirtyEncodingSwitch') })
      return
    }
    requestedEncodingRef.current = encodingId
    setReloadToken(token => token + 1)
  }, [dirty])
  const refreshFile = useCallback(() => {
    // Reloading while a draft exists would silently discard unsaved work;
    // refuse loudly instead (the user can save or cancel first).
    if (dirty) {
      setStatus({ error: true, text: translate('editor.refreshBlocked') })
      return
    }
    refreshPendingRef.current = true
    setReloadToken(token => token + 1)
  }, [dirty])
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
      // Close the picker before saving: a three-way conflict opens the
      // SaveConflictDialog, and two stacked modals would block the UI until
      // the conflict resolves. Errors surface in the status bar instead.
      setEncodingDialog(undefined)
      void save(selected)
    }
  }, [encodingDialog, encodingPick, openWithEncoding, save])
  useEffect(() => {
    if (encodingMenu === undefined) return undefined
    const inside = event => { const node = encodingMenuRef.current; return node !== null && event.target instanceof Node && node.contains(event.target) }
    const close = () => setEncodingMenu(undefined)
    const onPointerDown = event => { if (!inside(event)) close() }
    const onContextMenu = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('contextmenu', onContextMenu, true); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [encodingMenu])
  const renderDirectory=(path,depth)=>{const dir=directories.get(path);if(!dir||dir.state==='loading')return h(TreeStatus,{key:`${path}:loading`},translate('tree.loading'));if(dir.state==='error')return h(TreeStatus,{error:true,key:`${path}:error`},dir.message);const rows=dir.entries.map(entry=>{const open=expanded.has(entry.path);const renaming=entryDialog?.mode==='rename'&&entryDialog.entry.path===entry.path;return h(Fragment,{key:entry.path},renaming?h(TreeRenameRow,{busy:entryBusy,depth,entry,error:entryDraft.trim()===entry.name?undefined:entryDialogError,expanded:open,onCancel:closeEntryDialog,onConfirm:submitEntryDialog,onDraft:value=>{setEntryDraft(value);setEntryError(undefined)},value:entryDraft}):h(TreeRow,{cut:clipboard?.cut&&clipboard?.path===entry.path,depth,entry,expanded:open,onContextMenu:openContextMenu,onDirectory:toggleDirectory,onFile:chooseFile,onRename:beginRename,selected:selected?.path===entry.path}),entry.kind==='directory'&&open?renderDirectory(entry.path,depth+1):null)});if(!rows.length)rows.push(h(TreeStatus,{key:`${path}:empty`},translate('tree.empty')));return rows}
  const closeTab = useCallback((path) => {
    const current = tabsRef.current
    const index = current.findIndex(tab => tab.path === path)
    if (index < 0) return
    const closing = current[index]
    // A dirty tab is close-guarded only while EDITABLE: a non-editable file
    // with a leftover draft has no save/cancel path (both gated on
    // editability), so it would be stuck forever — allow closing it and drop
    // its staging draft below.
    const nonEditableDirty = closing.dirty === true && closing.editing === false
    if (closing.saving || (closing.dirty && !nonEditableDirty)) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabClose') }
      if (activePathRef.current === path) setStatus(nextStatus)
      else updateTab(path, { status: nextStatus })
      return
    }
    if (nonEditableDirty) {
      // Discard the orphaned staging draft so the next open does not restore
      // the non-restorable state. Best-effort: the tab is closing anyway.
      void clearDraftFile(path, '', closing.encoding ?? 'utf-8', closing.lineEnding ?? 'none', Boolean(closing.bom), closing.revision ?? null).catch(() => {})
    }
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
      const entry = entryFromPreviewTab(nextTab)
      setSelected(entry)
      revealPath(entry)
    }
  }, [clearDraftFile, forgetPathRefs, publishEditorContext, revealPath, updateTab])
  const closeOtherTabs = useCallback((keepPath) => {
    const current = tabsRef.current
    const keep = current.find(tab => tab.path === keepPath)
    if (keep === undefined) return
    const closing = current.filter(tab => tab.path !== keepPath && !tab.pinned)
    if (closing.length === 0) return
    if (closing.some(tab => tab.dirty || tab.saving)) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabsClose') }
      if (activePathRef.current === keepPath) setStatus(nextStatus)
      else updateTab(keepPath, { status: nextStatus })
      return
    }
    setTabs(current.filter(tab => tab.pinned || tab.path === keepPath))
    for (const tab of closing) forgetPathRefs(tab.path)
    activatePath(keep.path)
    const entry = entryFromPreviewTab(keep)
    setSelected(entry)
    revealPath(entry)
  }, [activatePath, forgetPathRefs, revealPath, updateTab])
  const scrollTabIntoView = useCallback((path) => {
    tabScrollPathRef.current = path
    setPinScrollToken(value => value + 1)
  }, [])
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
      // Move the unpinned tab right after the last pinned one so the pinned
      // block stays grouped at the front.
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
  const updateDropIndex = useCallback((event) => {
    if (draggingPath === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const next = dropIndexFromEvent(event)
    setDropIndex(current => current === next ? current : next)
  }, [draggingPath])
  const handleTabsDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropIndex(null)
  }, [])
  const handleTabsDrop = useCallback((event) => {
    event.preventDefault()
    dropTabAt(dropIndexFromEvent(event))
    setDraggingPath(null)
    setDropIndex(null)
  }, [dropTabAt])
  // Custom floating scrollbar for the tab strip: the native bar is hidden and
  // this thin overlay renders below the tabs (over the panel header) only
  // while the strip is hovered AND has overflow. Pure refs — no state writes.
  const syncPreviewScrollbar = useCallback(() => {
    const strip = previewTabsRef.current
    const track = previewScrollbarRef.current
    const thumb = previewScrollThumbRef.current
    if (strip === null || track === null || thumb === null) return
    const canScroll = strip.scrollWidth > strip.clientWidth + 1
    const visible = canScroll && (tabsHoveredRef.current || scrollbarHoveredRef.current || scrollbarDragRef.current !== null)
    track.dataset.visible = visible ? 'true' : 'false'
    if (!canScroll) return
    const trackWidth = track.clientWidth
    const thumbWidth = Math.max(24, Math.round((trackWidth * strip.clientWidth) / strip.scrollWidth))
    thumb.style.width = `${thumbWidth}px`
    const maxScroll = strip.scrollWidth - strip.clientWidth
    const maxThumb = trackWidth - thumbWidth
    thumb.style.transform = maxScroll > 0 ? `translateX(${(strip.scrollLeft / maxScroll) * maxThumb}px)` : 'translateX(0px)'
  }, [])
  const handleTabsMouseEnter = useCallback(() => {
    tabsHoveredRef.current = true
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleTabsMouseLeave = useCallback(() => {
    tabsHoveredRef.current = false
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleTabsScroll = useCallback(() => { syncPreviewScrollbar() }, [syncPreviewScrollbar])
  const handleScrollbarMouseEnter = useCallback(() => {
    scrollbarHoveredRef.current = true
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarMouseLeave = useCallback(() => {
    scrollbarHoveredRef.current = false
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarPointerDown = useCallback((event) => {
    const strip = previewTabsRef.current
    const track = previewScrollbarRef.current
    if (strip === null || track === null || strip.scrollWidth <= strip.clientWidth + 1) return
    event.preventDefault()
    scrollbarDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: strip.scrollLeft }
    try { track.setPointerCapture(event.pointerId) } catch { /* already released */ }
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarPointerMove = useCallback((event) => {
    const drag = scrollbarDragRef.current
    const strip = previewTabsRef.current
    const track = previewScrollbarRef.current
    if (drag === null || strip === null || track === null) return
    const trackWidth = track.clientWidth
    const thumbWidth = Math.max(24, Math.round((trackWidth * strip.clientWidth) / strip.scrollWidth))
    const maxScroll = strip.scrollWidth - strip.clientWidth
    const maxThumb = trackWidth - thumbWidth
    if (maxScroll <= 0 || maxThumb <= 0) return
    strip.scrollLeft = drag.startScrollLeft + ((event.clientX - drag.startX) * maxScroll) / maxThumb
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarPointerEnd = useCallback((event) => {
    if (scrollbarDragRef.current === null) return
    const track = previewScrollbarRef.current
    if (track !== null && event.pointerId !== undefined) {
      try { if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    }
    scrollbarDragRef.current = null
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  // Refresh the floating scrollbar when the strip's box resizes (panel width)
  // and after every render (tab add/close, pin reorder change scrollWidth).
  useEffect(() => {
    const strip = previewTabsRef.current
    if (strip === null) return undefined
    if (typeof ResizeObserver !== 'function') {
      const frame = requestAnimationFrame(syncPreviewScrollbar)
      return () => cancelAnimationFrame(frame)
    }
    const observer = new ResizeObserver(() => { syncPreviewScrollbar() })
    observer.observe(strip)
    syncPreviewScrollbar()
    return () => { observer.disconnect() }
  }, [syncPreviewScrollbar])
  useEffect(() => {
    const frame = requestAnimationFrame(syncPreviewScrollbar)
    return () => cancelAnimationFrame(frame)
  })
  // Scroll the tab strip so a target tab is fully visible. The target is the
  // tab requested by pin/unpin or a preview-body click; otherwise it is the
  // newly activated tab. One-shot: the requested path is consumed after the
  // check so later active-path changes fall back to the active tab.
  useLayoutEffect(() => {
    const strip = previewTabsRef.current
    const target = tabScrollPathRef.current ?? activePath
    if (strip === null || target === null) return
    let tabNode = null
    for (const child of strip.children) {
      if (child instanceof HTMLElement && child.classList.contains('dsh-ws-preview-tab') && child.dataset.path === target) {
        tabNode = child
        break
      }
    }
    if (tabNode === null) {
      // The requested tab is not (yet) rendered — a pinned tab scrolled for
      // right after closing. Consume a one-shot scroll request so a later
      // unrelated activePath change does not re-target the stale path.
      if (tabScrollPathRef.current === target) tabScrollPathRef.current = null
      return
    }
    const stripRect = strip.getBoundingClientRect()
    const nodeRect = tabNode.getBoundingClientRect()
    if (nodeRect.left >= stripRect.left - 1 && nodeRect.right <= stripRect.right + 1) {
      tabScrollPathRef.current = null
      return
    }
    const delta = nodeRect.left < stripRect.left
      ? nodeRect.left - stripRect.left
      : nodeRect.right - stripRect.right
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior: 'smooth' })
    tabScrollPathRef.current = null
  }, [activePath, pinScrollToken])
  // Hovering the tab strip and rolling the wheel scrolls it horizontally when
  // it overflows; a native non-passive listener is required so the default
  // (page) scroll can be prevented.
  useEffect(() => {
    const strip = previewTabsRef.current
    if (strip === null) return undefined
    const onWheel = (event) => {
      const max = strip.scrollWidth - strip.clientWidth
      if (max <= 0) return
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      strip.scrollLeft = Math.min(Math.max(0, strip.scrollLeft + delta), max)
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => { strip.removeEventListener('wheel', onWheel) }
  }, [tabs.length])
  // Markdown files offer a rendered-preview toggle (same extension table as
  // the tree badge and the editor highlighting).
  const isMarkdown = preview.state === 'ready' && colorGroupOf({ kind: 'file', name: preview.name }) === 'markdown'
  let body
  if (preview.state === 'idle') {
    body = h('div', { className: 'dsh-ws-empty' }, translate('panel.previewHint'))
  } else if (preview.state === 'loading') {
    body = h('div', { className: 'dsh-ws-empty' }, translate('editor.loading'))
  } else if (preview.state === 'error') {
    body = h('div', { className: 'dsh-ws-empty' },
      h('div', { className: 'dsh-ws-error-card' }, preview.message))
  } else {
    const highlightPreset = highlightPresetOf(settings, colorGroupOf({ kind: 'file', name: preview.name }))
    const previewReason = readOnlyReason(preview)
    body = h(Fragment, null,
      preview.truncated ? h('div', { className: 'dsh-ws-banner' }, translate('editor.previewTruncated')) : null,
      previewReason && !preview.truncated ? h('div', { className: 'dsh-ws-banner' }, translate('editor.cannotEdit', { reason: previewReason })) : null,
      h('div', { className: 'dsh-ws-preview-search', ref: searchPanelContainerRef, onContextMenu: (event) => { if (event.button !== 2) event.preventDefault() } }),
      h('div', { className: 'dsh-ws-preview-body', onClick: () => { if (activePathRef.current !== null) scrollTabIntoView(activePathRef.current) } },
        h(CodeEditor, {
          key: `${preview.path}:${preview.encoding}:${readEpoch}`,
          editorRef,
          // Prevent edits once the save snapshot has been captured. The freeze
          // is scoped to the tab being saved (per-tab saving flag), not the
          // global saving state, so switching to another editable file during
          // a save no longer briefly locks it.
          editing: editing && !(activeTab?.saving === true),
          file: preview,
          highlightPreset,
          onRevealApplied: () => setSearchReveal(undefined),
          readEpoch,
          searchPanelContainer: searchPanelContainerRef,
          wrap: settings.wrap === true,
          onContext: publishContextState,
          onDirty: (text) => {
            const nextDirty = text !== baseText.current
            setDraft(text)
            setDirty(nextDirty)
            updateActiveTab({ dirty: nextDirty, draft: text, draftKnown: nextDirty })
            if (nextDirty) {
              scheduleAutosave(activePath, text)
            } else {
              // Reverted exactly to the snapshot: drop the staging draft so a
              // later refresh does not resurrect the intermediate edits.
              lastWriteRef.current.set(activePath, { revision: null, content: text })
              void clearDraftFile(activePath, text, preview.encoding ?? 'utf-8', preview.lineEnding ?? 'none', Boolean(preview.bom), preview.revision ?? null)
            }
          },
          onSaveShortcut: () => { if (editing && !saving) void save() },
          onScroll: (path, scrollTop) => { scrollTopRef.current.set(path, scrollTop) },
          reveal: searchReveal !== undefined && preview.state === 'ready' && activeTab !== undefined && searchReveal.path === activeTab.path
            ? searchReveal
            : null,
          scrollTop: scrollTopRef.current.get(activePath) ?? activeTab?.scrollTop ?? 0,
        }),
        // Rendered-Markdown overlay sits above the (kept-mounted) editor, so
        // switching back never loses caret/undo state or an unsaved draft.
        isMarkdown && mdPreview
          ? h('div', { className: 'dsh-ws-md-preview' }, h(MarkdownText, { text: draft }))
          : null),
      )
  }
  let searchBody
  if (searchState.state === 'idle') {
    searchBody = h('div', { className: 'dsh-ws-empty' }, translate('search.hint'))
  } else if (searchState.state === 'searching') {
    searchBody = h(TreeStatus, null, translate('search.searching'))
  } else if (searchState.state === 'error') {
    searchBody = h('div', { className: 'dsh-ws-empty' },
      h('div', { className: 'dsh-ws-error-card' }, searchState.message))
  } else if (searchState.result.files.length === 0) {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-ws-search-summary' }, translate('search.noResults')),
      h('div', { className: 'dsh-ws-empty' }, translate('search.noResultsFor', { query: searchState.result.query })),
    )
  } else if (searchState.result.nameOnly === true) {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-ws-search-summary' },
        `${translate('search.summaryNameOnly', { files: searchState.result.fileCount })}${searchState.result.truncated ? translate('search.summaryTruncated') : ''}`),
      searchState.result.files.map(file =>
        h('button', {
          className: 'dsh-ws-search-file-header',
          key: file.path,
          onClick: () => openSearchEntry(file),
          title: file.path,
          type: 'button',
        },
          file.kind === 'directory' ? h('span', { 'aria-hidden': true, className: 'dsh-ws-search-kind' }, h(IconFolder)) : null,
          h('span', { className: 'dsh-ws-row-name' }, file.path),
        ),
      ),
    )
  } else {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-ws-search-summary' },
        `${translate('search.summary', { matches: searchState.result.matchCount, files: searchState.result.fileCount })}${searchState.result.truncated ? translate('search.summaryTruncated') : ''}`),
      searchState.result.files.map(file => {
        const expanded = searchExpanded.has(file.path)
        return h('div', { className: 'dsh-ws-search-file', key: file.path },
          h('button', {
            'aria-expanded': expanded,
            className: 'dsh-ws-search-file-header',
            onClick: () => toggleSearchFile(file.path),
            title: file.path,
            type: 'button',
          },
            h('span', { className: 'dsh-ws-chevron' }, expanded ? '▼' : '▶'),
            h('span', { className: 'dsh-ws-row-name' }, file.path),
            file.truncated ? h('span', { className: 'dsh-ws-search-truncated', title: translate('search.partial.title') }, translate('search.partial')) : null,
            h('span', { className: 'dsh-ws-search-file-count' }, `${file.matches.length}`),
          ),
          expanded ? file.matches.map(match => h('button', {
            className: 'dsh-ws-search-row',
            key: `${match.line}:${match.startColumn}`,
            onClick: () => openSearchMatch(file, match),
            title: translate('search.row.title', { path: file.path, line: match.line }),
            type: 'button',
          },
            h('span', { className: 'dsh-ws-search-line' }, String(match.line)),
            h('span', { className: 'dsh-ws-search-text' },
              match.text.slice(0, match.startColumn - 1),
              h('span', { className: 'dsh-ws-search-hit' }, match.text.slice(match.startColumn - 1, match.endColumn - 1)),
              match.text.slice(match.endColumn - 1),
            ),
          )) : null,
        )
      }),
    )
  }
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
  const previewTabNodes = []
  for (const [index, tab] of tabs.entries()) {
    if (draggingPath !== null && dropIndex === index) previewTabNodes.push(h('div', { 'aria-hidden': true, className: 'dsh-ws-preview-drop-indicator', key: `drop:${index}` }))
    previewTabNodes.push(h('div', {
      className: 'dsh-ws-preview-tab',
      'data-active': tab.path === activePath || undefined,
      'data-dragging': draggingPath === tab.path || undefined,
      'data-path': tab.path,
      draggable: true,
      key: tab.path,
      onContextMenu: event => { event.preventDefault(); setTabContextMenu({ path: tab.path, x: event.clientX, y: event.clientY }) },
      onDragEnd: () => { setDraggingPath(null); setDropIndex(null) },
      onDragStart: event => { setDraggingPath(tab.path); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.path) },
      title: tab.path,
    },
      h('button', {
        className: 'dsh-ws-preview-tab-button',
        onClick: () => chooseFile(entryFromPreviewTab(tab)),
        role: 'tab',
        'aria-selected': tab.path === activePath,
        title: tab.path,
        type: 'button',
      }, h('span', { className: 'dsh-ws-preview-tab-name' }, tab.name), tab.dirty ? h('span', { className: 'dsh-ws-dirty', title: translate('tab.dirty') }, '·') : null),
      tab.pinned
        ? h('button', {
          'aria-label': translate('tab.unpinAria', { name: tab.name }),
          className: 'dsh-ws-preview-tab-close',
          'data-pinned': true,
          onClick: event => { event.stopPropagation(); unpinTab(tab.path) },
          title: translate('tab.unpin'),
          type: 'button',
        }, h(IconPinVscode))
        : h('button', {
          'aria-label': translate('tab.closeAria', { name: tab.name }),
          className: 'dsh-ws-preview-tab-close',
          disabled: tab.dirty || tab.saving || undefined,
          onClick: event => { event.stopPropagation(); closeTab(tab.path) },
          title: tab.dirty || tab.saving ? translate('tab.close.title') : translate('tab.close'),
          type: 'button',
        }, h(IconCloseWin10)),
    ))
  }
  if (draggingPath !== null && dropIndex === tabs.length) previewTabNodes.push(h('div', { 'aria-hidden': true, className: 'dsh-ws-preview-drop-indicator', key: 'drop:end' }))
  const tabMenuTarget = tabContextMenu === undefined ? undefined : tabs.find(tab => tab.path === tabContextMenu.path)
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
          h('div', { className: 'dsh-ws-tree-scroll' }, renderDirectory('', 0)),
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
      tabs.length ? h('div', { ref: previewTabsRef, className: 'dsh-ws-preview-tabs', role: 'tablist', 'aria-label': translate('tab.list'), onDragLeave: handleTabsDragLeave, onDragOver: updateDropIndex, onDrop: handleTabsDrop, onMouseEnter: handleTabsMouseEnter, onMouseLeave: handleTabsMouseLeave, onScroll: handleTabsScroll }, previewTabNodes) : null,
      tabs.length ? h('div', { className: 'dsh-ws-preview-scrollbar', onMouseEnter: handleScrollbarMouseEnter, onMouseLeave: handleScrollbarMouseLeave, onPointerCancel: handleScrollbarPointerEnd, onPointerDown: handleScrollbarPointerDown, onPointerMove: handleScrollbarPointerMove, onPointerUp: handleScrollbarPointerEnd, ref: previewScrollbarRef }, h('div', { className: 'dsh-ws-preview-scrollbar-thumb', ref: previewScrollThumbRef })) : null,
      tabContextMenu ? h(TabContextMenu, { menuRef: tabMenuRef, onCloseOthers: () => { setTabContextMenu(undefined); closeOtherTabs(tabContextMenu.path) }, onTogglePin: () => { setTabContextMenu(undefined); if (tabMenuTarget?.pinned) unpinTab(tabContextMenu.path); else pinTab(tabContextMenu.path) }, pinned: Boolean(tabMenuTarget?.pinned), x: tabContextMenu.x, y: tabContextMenu.y }) : null,
      h('header', { className: 'dsh-ws-panel-header dsh-ws-preview-file-header', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) }, ref: previewHeaderRef },
        h('span', { className: 'dsh-ws-preview-file-path', title: activeTab === undefined ? undefined : (activeTab.external ? translate('external.externalFile.title') : activeTab.path) },
          activeTab
            ? (activeTab.external
                ? translate('external.externalFile', { name: activeTab.name })
                : activeTab.path)
            : workspace.title),
        preview.state === 'ready'
          ? h(Fragment, null,
            isMarkdown
              ? h('button', {
                'aria-pressed': mdPreview,
                className: 'dsh-ws-text-button',
                'data-active': mdPreview || undefined,
                onClick: () => setMdPreview(value => !value),
                title: mdPreview ? translate('mdPreview.edit.title') : translate('mdPreview.preview.title'),
                type: 'button',
              }, mdPreview ? translate('editor.edit') : translate('mdPreview.preview'))
              : null,
            h('button', {
              'aria-label': translate('editor.refresh'),
              className: 'dsh-ws-icon-button',
              disabled: Boolean(activeTab?.external),
              onClick: refreshFile,
              title: translate('editor.refresh.title'),
              type: 'button',
            }, h(IconRefresh)),
          )
          : null,
      ),
      body,
      // Merged bottom status bar: an always-visible band holding the action
      // buttons + file meta info (left) and the transient status notice (right).
      h('div', { className: 'dsh-ws-status', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) } },
        h('div', { className: 'dsh-ws-preview-status-actions' },
          preview.state === 'ready'
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
          preview.state === 'ready' && preview.encoding ? h('span', { className: 'dsh-ws-encoding', title: translate('encoding.badge') }, encodingLabel(preview.encoding)) : null,
          preview.state === 'ready' && reason ? h('span', { title: reason }, reason) : null,
        ),
        h('span', { className: 'dsh-ws-preview-status-msg', 'data-error': status?.error || undefined }, status?.text ?? ''),
      ),
      dropActive ? h('div', { className: 'dsh-ws-drop-overlay', role: 'presentation' },
        h('button', { 'aria-label': translate('drop.closeAria'), className: 'dsh-ws-drop-close', onClick: () => { dropSuppressedRef.current = true; setDropActive(false) }, title: translate('drop.closeTitle'), type: 'button' }, '×'),
        h('div', { className: 'dsh-ws-drop-hint' }, translate('drop.releaseFiles'))) : null,
      previewToast ? h(PreviewToast, { headerRef: previewHeaderRef, key: previewToast.seq, onDone: () => setPreviewToast(undefined), text: previewToast.text }) : null,
    ),
  )
}

function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle }) {
  const treeSection = h('section', { className: 'dsh-ws-tree' }, h(PanelHeader, { title: sessionTitle ?? translate('panel.workspaceFiles'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseSession')))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-ws-preview' }, h(PanelHeader, { title: translate('panel.filePreview'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseWorkspaceToBrowse'))))
}function ExplorerSettingsSection({ settingsStore }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const rowHeight = clamp(settings.rowHeight ?? ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)
  const chatFontSize = clamp(settings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX)
  const conflictFontSize = clamp(settings.conflictFontSize ?? CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MIN, CONFLICT_FONT_SIZE_MAX)
  const mindmapSpinSpeed = clampSpinSpeed(settings.mindmapSpinSpeed)
  /* Effective mind-map highlight colors: the user's hex or the theme default
     resolved to a concrete hex (for the color input), plus whether the value
     is customized (drives each reset button's disabled state). */
  const mindmapHoverColorHex = mindmapEffectiveColor(settings.mindmapHoverColor, MINDMAP_HOVER_THEME_VAR, MINDMAP_HOVER_COLOR_FALLBACK)
  const mindmapSelectedColorHex = mindmapEffectiveColor(settings.mindmapSelectedColor, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SELECTED_COLOR_FALLBACK)
  /* "Customized" means the user stored a non-default hex (the store deletes
     the entry when the picked color equals the theme default). Comparing the
     stored value against the EFFECTIVE hex was always true — the store's
     undefined value never equals a hex string — which left both reset buttons
     permanently disabled. */
  const mindmapHoverColorCustom = settings.mindmapHoverColor !== undefined
  const mindmapSelectedColorCustom = settings.mindmapSelectedColor !== undefined
  /* Session-head card accent color: default is the fixed violet (not theme
     adaptive), so the effective hex is simply the stored override or the
     default constant. */
  const mindmapHeadColorHex = settings.mindmapHeadColor ?? MINDMAP_HEAD_COLOR_DEFAULT
  const mindmapHeadColorCustom = settings.mindmapHeadColor !== undefined
  /* End-of-branch card accent color: default is the fixed success green (not
     theme adaptive), so the effective hex is simply the stored override or
     the default constant. */
  const mindmapEndColorHex = settings.mindmapEndColor ?? MINDMAP_END_COLOR_DEFAULT
  const mindmapEndColorCustom = settings.mindmapEndColor !== undefined
  const mindmapMountBulge = clampMountBulge(settings.mindmapMountBulge)
  const customizedCount = Object.keys(settings.fileColors ?? {}).length
  const customizedPresetCount = Object.keys(settings.highlightPresets ?? {}).length
  return h('div', { className: 'dsh-ws-explorer-settings' },
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.session')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-spin-speed' }, translate('settings.mindmapSpinSpeed')),
        h('input', {
          'aria-label': translate('settings.mindmapSpinSpeed'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-mindmap-spin-speed',
          max: MINDMAP_SPIN_SPEED_MAX_X,
          min: MINDMAP_SPIN_SPEED_MIN_X,
          onChange: e => settingsStore.actions.setMindmapSpinSpeed(Number(e.target.value)),
          step: 0.1,
          type: 'range',
          value: mindmapSpinSpeed,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${mindmapSpinSpeed.toFixed(1)}×`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: mindmapSpinSpeed === MINDMAP_SPIN_SPEED_DEFAULT_X || undefined,
          onClick: () => settingsStore.actions.setMindmapSpinSpeed(MINDMAP_SPIN_SPEED_DEFAULT_X),
          title: translate('settings.mindmapSpinSpeed.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.mindmap')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-hover-color' }, translate('settings.mindmapHoverColor')),
        h('input', {
          'aria-label': translate('settings.mindmapHoverColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-hover-color',
          onChange: e => settingsStore.actions.setMindmapHoverColor(e.target.value),
          type: 'color',
          value: mindmapHoverColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapHoverColorCustom,
          onClick: () => settingsStore.actions.resetMindmapHoverColor(),
          title: translate('settings.mindmapHoverColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-selected-color' }, translate('settings.mindmapSelectedColor')),
        h('input', {
          'aria-label': translate('settings.mindmapSelectedColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-selected-color',
          onChange: e => settingsStore.actions.setMindmapSelectedColor(e.target.value),
          type: 'color',
          value: mindmapSelectedColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapSelectedColorCustom,
          onClick: () => settingsStore.actions.resetMindmapSelectedColor(),
          title: translate('settings.mindmapSelectedColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-head-color' }, translate('settings.mindmapHeadColor')),
        h('input', {
          'aria-label': translate('settings.mindmapHeadColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-head-color',
          onChange: e => settingsStore.actions.setMindmapHeadColor(e.target.value),
          type: 'color',
          value: mindmapHeadColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapHeadColorCustom,
          onClick: () => settingsStore.actions.resetMindmapHeadColor(),
          title: translate('settings.mindmapHeadColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-end-color' }, translate('settings.mindmapEndColor')),
        h('input', {
          'aria-label': translate('settings.mindmapEndColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-end-color',
          onChange: e => settingsStore.actions.setMindmapEndColor(e.target.value),
          type: 'color',
          value: mindmapEndColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapEndColorCustom,
          onClick: () => settingsStore.actions.resetMindmapEndColor(),
          title: translate('settings.mindmapEndColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-mount-bulge' }, translate('settings.mindmapMountBulge')),
        h('input', {
          'aria-label': translate('settings.mindmapMountBulge'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-mindmap-mount-bulge',
          max: MINDMAP_MOUNT_BULGE_MAX_X,
          min: MINDMAP_MOUNT_BULGE_MIN_X,
          onChange: e => settingsStore.actions.setMindmapMountBulge(Number(e.target.value)),
          step: 0.5,
          type: 'range',
          value: mindmapMountBulge,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${mindmapMountBulge.toFixed(1)}×`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: mindmapMountBulge === MINDMAP_MOUNT_BULGE_DEFAULT_X || undefined,
          onClick: () => settingsStore.actions.setMindmapMountBulge(MINDMAP_MOUNT_BULGE_DEFAULT_X),
          title: translate('settings.mindmapMountBulge.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.browse')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-row-height' }, translate('settings.rowHeight')),
        h('input', {
          'aria-label': translate('settings.rowHeight'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-row-height',
          max: ROW_HEIGHT_MAX,
          min: ROW_HEIGHT_MIN,
          onChange: e => settingsStore.actions.setRowHeight(Number(e.target.value)),
          step: 2,
          type: 'range',
          value: rowHeight,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${rowHeight}px`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: rowHeight === ROW_HEIGHT_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setRowHeight(ROW_HEIGHT_DEFAULT),
          title: translate('settings.rowHeight.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-search-expand-default' }, translate('settings.searchResult')),
        h('select', {
          'aria-label': translate('settings.searchResult'),
          className: 'dsh-ws-highlight-preset-select',
          id: 'dsh-ws-search-expand-default',
          onChange: e => settingsStore.actions.setExpandSearchMatches(e.target.value === 'expanded'),
          value: (settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT) ? 'expanded' : 'collapsed',
        },
          h('option', { value: 'expanded' }, translate('settings.expanded')),
          h('option', { value: 'collapsed' }, translate('settings.collapsed')))),
      h('div', { className: 'dsh-ws-file-colors-title' }, translate('settings.fileColors')),
      h('div', { className: 'dsh-ws-file-colors' },
        FILE_COLOR_GROUPS.map(({ group }) => { const label = fileColorGroupLabel(group); return h('div', { className: 'dsh-ws-file-color-row', key: group },
          h('span', { className: 'dsh-ws-file-color-name', title: label }, label),
          h('input', {
            'aria-label': translate('settings.fileColor.aria', { label }),
            className: 'dsh-ws-file-color-input',
            onChange: e => settingsStore.actions.setFileColor(group, e.target.value),
            type: 'color',
            value: fileColorOf(settings, group),
          }),
          h('button', {
            className: 'dsh-ws-file-color-reset',
            disabled: settings.fileColors?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetFileColor(group),
            title: translate('settings.fileColor.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetFileColors(),
          type: 'button',
        }, translate('settings.resetAllColors'))),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.content')),
      h('div', { className: 'dsh-ws-file-colors-title' }, translate('settings.presets')),
      h('div', { className: 'dsh-ws-file-colors' },
        FILE_COLOR_GROUPS.map(({ group }) => { const label = fileColorGroupLabel(group); return h('div', { className: 'dsh-ws-file-color-row', key: `preset-${group}` },
          h('span', { className: 'dsh-ws-file-color-name', title: label }, label),
          h('select', {
            'aria-label': translate('settings.preset.aria', { label }),
            className: 'dsh-ws-highlight-preset-select',
            onChange: e => settingsStore.actions.setHighlightPreset(group, e.target.value),
            value: highlightPresetOf(settings, group),
          },
            HIGHLIGHT_PRESETS.map(preset => h('option', { key: preset.id, value: preset.id }, highlightPresetLabel(preset.id)))),
          h('button', {
            className: 'dsh-ws-file-color-reset',
            disabled: settings.highlightPresets?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetHighlightPreset(group),
            title: translate('settings.preset.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedPresetCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetHighlightPresets(),
          type: 'button',
        }, translate('settings.resetAllPresets'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-conflict-font-size' }, translate('settings.conflictFontSize')),
        h('input', {
          'aria-label': translate('settings.conflictFontSize'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-conflict-font-size',
          max: CONFLICT_FONT_SIZE_MAX,
          min: CONFLICT_FONT_SIZE_MIN,
          onChange: e => settingsStore.actions.setConflictFontSize(Number(e.target.value)),
          step: 1,
          type: 'range',
          value: conflictFontSize,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${conflictFontSize}px`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: conflictFontSize === CONFLICT_FONT_SIZE_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setConflictFontSize(CONFLICT_FONT_SIZE_DEFAULT),
          title: translate('settings.conflictFontSize.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-preview-right' }, translate('settings.previewRight')),
        h('input', {
          'aria-label': translate('settings.previewRight'),
          checked: (settings.previewRight ?? PREVIEW_RIGHT_DEFAULT) === true,
          className: 'dsh-ws-settings-checkbox',
          id: 'dsh-ws-preview-right',
          onChange: e => settingsStore.actions.setPreviewRight(e.target.checked),
          type: 'checkbox',
        })),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.dialog')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-chat-font-size' }, translate('settings.chatFont')),
        h('input', {
          'aria-label': translate('settings.chatFont'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-chat-font-size',
          max: CHAT_FONT_SIZE_MAX,
          min: CHAT_FONT_SIZE_MIN,
          onChange: e => settingsStore.actions.setChatFontSize(Number(e.target.value)),
          step: 1,
          type: 'range',
          value: chatFontSize,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${chatFontSize}px`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: chatFontSize === CHAT_FONT_SIZE_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setChatFontSize(CHAT_FONT_SIZE_DEFAULT),
          title: translate('settings.chatFont.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-auto-expand-think' }, translate('settings.autoExpandThink')),
        h('input', {
          'aria-label': translate('settings.autoExpandThink'),
          checked: (settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) === true,
          className: 'dsh-ws-settings-checkbox',
          id: 'dsh-ws-auto-expand-think',
          onChange: e => settingsStore.actions.setAutoExpandThink(e.target.checked),
          type: 'checkbox',
        })),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-think-collapse-delay' }, translate('settings.thinkDelay')),
        h('input', {
          'aria-label': translate('settings.thinkDelay'),
          className: 'dsh-ws-settings-slider',
          disabled: (settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) !== true || undefined,
          id: 'dsh-ws-think-collapse-delay',
          max: THINK_COLLAPSE_DELAY_MAX_S,
          min: THINK_COLLAPSE_DELAY_MIN_S,
          onChange: e => settingsStore.actions.setThinkCollapseDelay(Number(e.target.value)),
          step: THINK_COLLAPSE_DELAY_STEP_S,
          type: 'range',
          value: settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${(settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S).toFixed(1)}s`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: ((settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) !== true || (settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S) === THINK_COLLAPSE_DELAY_DEFAULT_S) || undefined,
          onClick: () => settingsStore.actions.setThinkCollapseDelay(THINK_COLLAPSE_DELAY_DEFAULT_S),
          title: translate('settings.thinkDelay.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.hint')),
  )
}
/* Session-switcher dropdown: rendered in the conversation header's action
   row (order -400, leftmost) as the visible session title — the harness's
   current-title crumb is hidden by CSS (desktop and mobile). Clicking the
   trigger opens a portalled panel listing every session (most recently
   updated first, the current one highlighted, each row showing the session
   title with its workspace name as a distinguishing suffix); clicking a row
   switches session via the same ctx.sessions.open the sidebar list uses.
   The panel is portalled to document.body and fixed-positioned from the
   trigger rect so the chat column's overflow cannot clip it. */
function SessionSwitcherDropdown({ useSessions, useWorkspaces, sessionId, openSession }) {
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  /* The panel is as wide as 33% of the conversation column (the chat section
     that owns the header), re-measured on open and while open on resize so
     the width tracks live layout changes. The 360px floor keeps the panel at
     a readable minimum even when 33% of a narrow column would be smaller. */
  const measurePos = useCallback(() => {
    const trigger = triggerRef.current
    if (trigger === null) return null
    const rect = trigger.getBoundingClientRect()
    const chat = trigger.closest('.dsh-ws-chat')
    const chatRect = chat?.getBoundingClientRect()
    const width = chatRect !== undefined && chatRect.width > 0
      ? Math.max(360, Math.round(chatRect.width * 0.33))
      : Math.max(360, rect.width)
    // Keep the panel horizontally inside the conversation column. On mobile
    // the two leading header icons push the trigger right, so the wide
    // (360px floor) panel anchored at the trigger would overflow the phone
    // column; clamping the left edge makes it lean left to stay on screen.
    // On desktop the trigger sits near the column's left, so the clamp is a
    // no-op and the panel hangs straight under the title.
    const left = chatRect !== undefined && chatRect.width > 0
      ? Math.max(chatRect.left + 4, Math.min(rect.left, chatRect.right - width - 4))
      : rect.left
    return { left, top: rect.bottom + 6, width }
  }, [])
  const toggle = useCallback(() => {
    if (open) { setOpen(false); return }
    // Measure OUTSIDE the setState updater: updaters must stay pure (StrictMode
    // double-invokes them), and the DOM measurement is a side effect.
    const next = measurePos()
    if (next === null) return
    setPos(next)
    setOpen(true)
  }, [measurePos, open])
  useEffect(() => {
    if (!open) return undefined
    const inside = event => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (trigger !== null && event.target instanceof Node && trigger.contains(event.target)) return true
      return panel !== null && event.target instanceof Node && panel.contains(event.target)
    }
    const close = () => setOpen(false)
    const onPointerDown = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    // Re-anchor on resize instead of closing, so the 33%-of-column width keeps
    // tracking layout changes while the panel stays open.
    const onResize = () => { const next = measurePos(); if (next !== null) setPos(next) }
    // Scroll anywhere outside the panel closes it (capture phase). Scrolls
    // inside the panel itself must NOT close it: the panel is scrollable
    // (overflow-y:auto) and closing on its own scroll made long session lists
    // impossible to scroll through.
    const onScroll = event => {
      const panel = panelRef.current
      if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [measurePos, open])
  const currentTitle = sessionId === undefined
    ? undefined
    : (list.byId[sessionId]?.displayTitle ?? String(sessionId))
  const rows = useMemo(() => {
    /* The full session list is only needed while the panel is open. The store
       subscription re-renders this header slot on every session change
       (streaming churn included), so skip building the sorted rows while
       closed — the trigger only needs the current title, which the
       subscription already delivers. */
    if (!open) return []
    const workspaceTitleBySession = new Map()
    for (const item of workspaces) {
      for (const id of item.sessionIds) {
        if (!workspaceTitleBySession.has(id)) workspaceTitleBySession.set(id, item.title)
      }
    }
    const ordered = list.ids
      .filter(id => list.byId[id] !== undefined && !isMindmapBranchDescendant(list, id))
      .map(id => ({ summary: list.byId[id], workspaceTitle: workspaceTitleBySession.get(id) }))
      .sort((a, b) => (b.summary.updatedAt ?? 0) - (a.summary.updatedAt ?? 0))
    return ordered
  }, [list, open, workspaces])
  const trigger = h('button', {
    'aria-expanded': open,
    'aria-haspopup': 'listbox',
    'aria-label': translate('switcher.aria'),
    className: 'dsh-ws-session-switcher-trigger',
    onClick: toggle,
    ref: triggerRef,
    title: translate('switcher.trigger.title'),
    type: 'button',
  },
    h('span', { className: 'dsh-ws-session-switcher-title' }, currentTitle ?? ''),
    h('span', { className: 'dsh-ws-chevron' }, open ? '▲' : '▼'))
  const panel = open && pos !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-session-switcher-panel',
      ref: panelRef,
      role: 'listbox',
      style: { left: pos.left, top: pos.top, width: pos.width },
    },
      rows.length === 0 ? h('div', { className: 'dsh-ws-session-switcher-empty' }, translate('switcher.noSessions'))
        : rows.map(row => h('button', {
          'aria-selected': row.summary.id === sessionId,
          className: row.summary.id === sessionId ? 'dsh-ws-session-switcher-row dsh-ws-session-switcher-current' : 'dsh-ws-session-switcher-row',
          key: row.summary.id,
          onClick: () => { openSession(row.summary.id); setOpen(false) },
          role: 'option',
          type: 'button',
        },
          h('span', { className: 'dsh-ws-session-switcher-row-main' },
            row.summary.displayTitle,
            row.summary.origin === 'subagent' ? h('span', { className: 'dsh-ws-session-switcher-badge' }, translate('switcher.subagent')) : null),
          row.workspaceTitle !== undefined ? h('span', { className: 'dsh-ws-session-switcher-row-ws' }, row.workspaceTitle) : null))),
    document.body,
  ) : null
  return h('div', { className: 'dsh-ws-session-switcher' }, trigger, panel)
}
/* ---------------------------------------------------------------------------
   Mind-map conversation branching ("导图").
   A conversation.view tab backed by a persisted per-root-session document.
   Opening the tab on a session with no document reverse-parses its FULL event
   log into trunk turn cards (1-2-3-4-5) and persists it; the session's row is
   then hidden from the harness sidebar and a self-drawn mind-map session entry
   takes its place. Clicking a card forks a new branch session at that card
   (sessions.fork at the turn/end seq) and opens it; the branch's own new turns
   are folded into the document by the Host sync from the branch session's full
   log, so the document is always the single source of truth.
   --------------------------------------------------------------------------- */

/* A fork-descendant of a mind-map family (a documented branch or any session
   whose ancestry reaches a mind-map root/branch, subagent hops aside). The
   session switcher hides these; the sidebar hider hides the whole family. */
function isMindmapBranchDescendant(list, id) {
  let cursor = list.byId[String(id)]?.parentId
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    if (mindmapRegistry.isRoot(cursor) || mindmapRegistry.isBranch(cursor)) return true
    const summary = list.byId[cursor]
    if (summary === undefined) break
    if (summary.origin === 'subagent') { cursor = summary.parentId; continue }
    cursor = summary.parentId
  }
  return false
}

/* Walk fork lineage to the ordinary root (subagent hops are transparent, so a
   branch's family-root title is the first non-subagent ancestor's title). */
function mindmapRootTitleOf(list, id) {
  let cursor = String(id)
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    const summary = list.byId[cursor]
    if (summary === undefined) return undefined
    if (summary.origin === 'subagent') { cursor = summary.parentId; continue }
    return summary.displayTitle
  }
  return undefined
}

/* Every fork descendant of a session id (the subtree to archive with it). */
function mindmapDescendantsOf(parentOf, rootId) {
  const children = new Map()
  for (const [child, parent] of parentOf) {
    const arr = children.get(parent) ?? []
    arr.push(child)
    children.set(parent, arr)
  }
  const out = []
  const stack = children.get(rootId) ?? []
  while (stack.length > 0) {
    const id = stack.pop()
    out.push(id)
    for (const child of children.get(id) ?? []) stack.push(child)
  }
  return out
}

/* Hard-cut a node label. */
function mindmapClip(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/* ---- document layout ---- */

const mindmapDocKey = (sessionId, seq) => `${sessionId}:${seq}`

/* Key of the VIRTUAL root node (the map's top hub, not a session). */
const MINDMAP_ROOT_KEY = '__mindmap_root__'

/* Key of a session's HEAD node (the identity card at the left of its question
   chain). Shared by the layout and the current-card highlight so the "当前"
   badge can light the session's head. */
const mindmapHeadKey = (sessionId) => mindmapDocKey(String(sessionId), `head:${String(sessionId)}`)

/* Key of a session's placeholder card (a session with no turns yet), shared by
   the layout and the current-card highlight so the "当前" badge can light the
   "等待新问题" card. */
const mindmapEmptyKey = (sessionId) => mindmapDocKey(String(sessionId), `empty:${String(sessionId)}`)

/* Plan of a card deletion (right-click → 删除卡片): the card is removed by
   TRUNCATING its session chain — the card and every later card in the same
   session are cut, the session is re-created from the previous card (a fork
   at its turn/end), and the OLD session is archived so the chat shows the
   truncated conversation. Every session hanging off a removed card is
   archived too. An empty session's placeholder card — or a session's FIRST
   card, with no earlier card in the session to truncate at — removes the
   whole session instead. Removing the LAST remaining session (directly or via
   a subtree prune) is blocked (the map must keep at least one session; the
   root node itself is virtual). The doc records NO tombstones: a removed turn
   only resurfaces through a failed archive of its old session (ACCEPTED —
   pure fork + archive + replace; see docs/mindmap-notes.md). Returns null
   when the target card is not in the doc, or a plan { archiveIds, sessions,
   replaced, wholeBranch, lastSession, next }. */
function mindmapDeletePlan(doc, ownerId, turnSeq, emptyCard) {
  const sessions = (doc?.sessions ?? []).filter(s => s !== null && s !== undefined)
  const ownerIdx = sessions.findIndex(s => String(s?.sessionId) === String(ownerId))
  if (ownerIdx === -1) return null
  const session = sessions[ownerIdx]
  const chain = session.turns ?? []
  const removed = []
  const pruneIds = new Set()
  const pushTurn = (sessionId, turn) => {
    if (turn === null || turn === undefined) return
    removed.push({ sessionId: String(sessionId), seq: Number(turn.seq), n: Number(turn.n) })
  }
  let idx = -1
  let wholeBranch = false
  if (emptyCard) {
    /* An empty session's placeholder: no truncation is possible, the whole
       session (session + subtree) is removed. */
    wholeBranch = true
  } else {
    idx = chain.findIndex(turn => Number(turn?.seq) === Number(turnSeq))
    if (idx === -1) return null
    if (idx === 0) wholeBranch = true
  }
  if (wholeBranch) {
    pruneIds.add(String(ownerId))
    if (chain.length === 0) {
      /* An EMPTY session carries no turns, so the subtree worklist below gets
         no anchor from its own turns: seed it with the session itself so
         descendants whose parent session is this session are still pruned. */
      removed.push({ sessionId: String(ownerId), seq: undefined, n: undefined })
    }
    for (const turn of chain) pushTurn(ownerId, turn)
  } else {
    for (let i = idx; i < chain.length; i += 1) pushTurn(ownerId, chain[i])
  }
  /* Session subtree: every session whose parent card is one of the removed
     cards, recursively (grandchildren hang off the removed sessions' cards).
     An empty-session anchor (seeded above, no card number) matches by session
     identity alone. */
  for (let cursor = 0; cursor < removed.length; cursor += 1) {
    const t = removed[cursor]
    for (const s of sessions) {
      if (pruneIds.has(String(s.sessionId))) continue
      if (String(s?.parentSessionId) === String(t.sessionId)
        && (t.n === undefined || Number(s?.parentTurn) === Number(t.n))) {
        pruneIds.add(String(s.sessionId))
        for (const turn of s?.turns ?? []) pushTurn(s.sessionId, turn)
      }
    }
  }
  const removedBySession = new Map()
  for (const t of removed) {
    if (!removedBySession.has(t.sessionId)) removedBySession.set(t.sessionId, new Set())
    removedBySession.get(t.sessionId).add(t.seq)
  }
  const keep = (sessionId, turn) => !removedBySession.get(String(sessionId))?.has(Number(turn?.seq))
  const nextSessions = sessions
    .filter(s => !pruneIds.has(String(s.sessionId)))
    .map(s => String(s?.sessionId) === String(ownerId) && !wholeBranch
      ? { ...s, turns: (s?.turns ?? []).filter(turn => keep(String(ownerId), turn)) }
      : s)
  /* Removing the last remaining session (directly, or via a subtree prune)
     would leave the map with nothing but the virtual root node — blocked. */
  if (nextSessions.length === 0) return { lastSession: true }
  /* Fresh doc-wide counter: continue after the largest remaining card number,
     so deleted numbers are reused instead of leaving gaps. */
  let maxN = 0
  for (const s of nextSessions) for (const turn of s?.turns ?? []) maxN = Math.max(maxN, Number(turn?.n) || 0)
  return {
    archiveIds: [...pruneIds],
    sessions: nextSessions,
    replaced: wholeBranch
      ? null
      : { sessionId: String(ownerId), forkAt: Number(chain[idx - 1].seq) },
    wholeBranch,
    lastSession: false,
    next: maxN + 1,
  }
}



/* Stable fingerprint of a doc's structure (per-session turn seqs, fork
   anchors + the map's own title), used to skip redundant re-renders after a
   sync that changed nothing. The rootTitle is included so a sidebar rename of
   the map title reaches an open map on the next sync (a seq-only fingerprint
   skipped it). */
function mindmapDocFingerprint(doc) {
  const sessions = (doc?.sessions ?? []).map(s =>
    `${String(s?.sessionId)}:${String(s?.parentSessionId ?? '')}:${String(s?.parentTurn ?? '')}:${(s?.turns ?? []).map(turn => turn?.seq).join(',')}`).join(';')
  return `${String(doc?.rootTitle ?? '')}|${sessions}`
}

/* Deterministic per-session color palette for a streaming card + parent pair
   (the flowing gradient ring on both cards and the flowing edge between
   them): a hash of the session id seeds a PRNG that picks ONE coherent 3-color
   scheme from the curated pool, so every pair looks different while staying
   stable across renders (no per-frame re-rolls). Returns a FLAT 3-color array
   (c1, c2, c3) — a buggy earlier version returned an array of whole palettes,
   which made every stroke/stop an invalid color list and rendered the edge
   black. Palettes are cached by session id so the array identity survives
   layout recomputes and React.memo comparisons. */
const MINDMAP_STREAM_PALETTE = [
  ['#22d3ee', '#818cf8', '#a78bfa'],
  ['#fb923c', '#f472b6', '#e11d48'],
  ['#a3e635', '#34d399', '#2dd4bf'],
  ['#fde047', '#f97316', '#ef4444'],
  ['#38bdf8', '#2dd4bf', '#a3e635'],
  ['#e879f9', '#818cf8', '#38bdf8'],
]
const mindmapStreamPaletteCache = new Map()
const mindmapStreamHash = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const mindmapMulberry32 = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const mindmapGradientId = (sessionId) => {
  const codePoints = [...String(sessionId)].map(char => char.codePointAt(0).toString(16)).join('_')
  return `dsh-ws-mm-grad-${codePoints}`
}
const mindmapStreamPalette = (sessionId) => {
  const sid = String(sessionId)
  const hit = mindmapStreamPaletteCache.get(sid)
  if (hit !== undefined) {
    // Refresh insertion order so the bounded cache evicts the least recently
    // used session without changing a live session's deterministic palette.
    mindmapStreamPaletteCache.delete(sid)
    mindmapStreamPaletteCache.set(sid, hit)
    return hit
  }
  const rng = mindmapMulberry32(mindmapStreamHash(sid))
  const out = MINDMAP_STREAM_PALETTE[Math.floor(rng() * MINDMAP_STREAM_PALETTE.length)].slice()
  if (mindmapStreamPaletteCache.size >= 128) {
    const oldest = mindmapStreamPaletteCache.keys().next().value
    if (oldest !== undefined) mindmapStreamPaletteCache.delete(oldest)
  }
  mindmapStreamPaletteCache.set(sid, out)
  return out
}

/* Doc layout (v3): the VIRTUAL root node sits alone at the top (row 0);
   every session is a horizontal chain of a HEAD node (the session's identity
   card) plus its question cards, laid out one session per row in DFS order —
   top-level sessions (children of the root node) first, then each session's
   nested forks on the rows right after it, indented to the card they hang
   off. A session with no turns renders one placeholder card. An optional
   `streaming` descriptor ({ sessionId, question }) appends an ephemeral live
   card to that session's chain tail (replacing the placeholder of an empty
   session). Returns { nodes, edges, width, height } — nodes carry
   key/kind/sessionId/turn/empty/streaming/row/depth/x/y/width/height, edges
   are { from, to, mount?, d } key pairs with the SVG path precomputed. */
function mindmapDocLayout(doc, streamingList, mountBulgeParam = MINDMAP_MOUNT_BULGE_DEFAULT_X) {
  const nodes = []
  const edges = []
  const sessions = (doc?.sessions ?? []).filter(s => s !== null && s !== undefined)
  const bySession = new Map()
  for (const s of sessions) bySession.set(String(s.sessionId), s)
  /* Children of a specific card, keyed `${parentSessionId}\u0000${cardN}`. */
  const childMap = new Map()
  for (const s of sessions) {
    if (!s.parentSessionId || s.parentTurn === undefined || s.parentTurn === null) continue
    const key = `${String(s.parentSessionId)}\u0000${String(s.parentTurn)}`
    if (!childMap.has(key)) childMap.set(key, [])
    childMap.get(key).push(s)
  }
  /* DFS pre-order (stable): top-level sessions in doc order, then each
     session's children by card order. Every session occupies ONE row. */
  const order = []
  const visited = new Set()
  const visit = (s) => {
    const sid = String(s.sessionId)
    if (visited.has(sid)) return
    visited.add(sid)
    order.push(s)
    const cardCount = Math.max(1, (s.turns ?? []).length)
    for (let k = 0; k < cardCount; k += 1) {
      const n = Number(s.turns?.[k]?.n)
      if (!Number.isSafeInteger(n)) continue
      for (const kid of (childMap.get(`${sid}\u0000${String(n)}`) ?? [])) visit(kid)
    }
  }
  for (const s of sessions) {
    if (!s.parentSessionId) visit(s)
  }
  /* Row + column assignment (row 0 = the virtual root node). A nested
     session's head sits one card column to the right of the card it hangs
     off. */
  const entryBySession = new Map()
  let row = 1
  for (const s of order) {
    let headCol = 0
    if (s.parentSessionId) {
      const parentEntry = entryBySession.get(String(s.parentSessionId))
      const pTurns = bySession.get(String(s.parentSessionId))?.turns ?? []
      const pIdx = pTurns.findIndex(t => Number(t?.n) === Number(s.parentTurn))
      headCol = parentEntry !== undefined && pIdx !== -1 ? parentEntry.headCol + pIdx + 2 : 0
    }
    entryBySession.set(String(s.sessionId), { session: s, headCol, row: row++ })
  }
  /* Build session chains (heads + cards). */
  for (const s of order) {
    const entry = entryBySession.get(String(s.sessionId))
    const sid = String(s.sessionId)
    const turns = s.turns ?? []
    const head = {
      kind: 'head',
      key: mindmapHeadKey(sid),
      sessionId: sid,
      session: s,
      turn: undefined,
      empty: false,
      streaming: false,
      depth: entry.headCol,
      row: entry.row,
      width: MINDMAP_HEAD_W,
      height: MINDMAP_HEAD_H,
    }
    nodes.push(head)
    let prevKey = head.key
    if (turns.length === 0) {
      const key = mindmapEmptyKey(sid)
      nodes.push({
        kind: 'card',
        key,
        sessionId: sid,
        session: s,
        turn: undefined,
        empty: true,
        streaming: false,
        depth: entry.headCol + 1,
        row: entry.row,
        width: MINDMAP_NODE_W,
        height: MINDMAP_NODE_H,
      })
      edges.push({ from: head.key, to: key })
      prevKey = key
    } else {
      turns.forEach((turn, index) => {
        const key = mindmapDocKey(sid, turn.seq)
        nodes.push({
          kind: 'card',
          key,
          sessionId: sid,
          session: s,
          turn,
          empty: false,
          streaming: false,
          depth: entry.headCol + 1 + index,
          row: entry.row,
          width: MINDMAP_NODE_W,
          height: MINDMAP_NODE_H,
        })
        edges.push({ from: prevKey, to: key })
        prevKey = key
      })
    }
  }
  /* Root → top-level head edges + nested mount edges (parent card → child
     head). Both render as the primary dashed mount curve. */
  for (const s of sessions) {
    if (s.parentSessionId) continue
    edges.push({ from: MINDMAP_ROOT_KEY, to: mindmapHeadKey(String(s.sessionId)), mount: true })
  }
  for (const s of order) {
    if (!s.parentSessionId) continue
    const parentEntry = entryBySession.get(String(s.parentSessionId))
    const parentTurns = bySession.get(String(s.parentSessionId))?.turns ?? []
    const pIdx = parentTurns.findIndex(t => Number(t?.n) === Number(s.parentTurn))
    if (parentEntry === undefined || pIdx === -1) continue
    edges.push({
      from: mindmapDocKey(String(s.parentSessionId), parentTurns[pIdx].seq),
      to: mindmapHeadKey(String(s.sessionId)),
      mount: true,
    })
  }
  /* Live streaming cards: every running doc-family session has a turn in
     flight — append a card to each one's chain tail (a session awaiting its
     first turn gets its placeholder replaced instead). The cards are
     ephemeral UI, never part of the doc: the next sync folds each completed
     turn into a normal card. */
  const streamingItems = Array.isArray(streamingList) ? streamingList : []
  for (const streaming of streamingItems) {
    if (streaming === null || streaming === undefined) continue
    const sid = String(streaming.sessionId)
    const entry = entryBySession.get(sid)
    if (entry === undefined) continue
    const chain = nodes.filter(n => String(n.sessionId) === sid)
    const last = chain[chain.length - 1]
    if (last === undefined) continue
    const replaceEmpty = last.empty === true
    const streamingNode = {
      kind: 'card',
      key: `streaming:${sid}`,
      sessionId: sid,
      session: entry.session,
      turn: undefined,
      empty: false,
      streaming: true,
      /* A replaced placeholder keeps its position; an appended card goes
         one depth deeper than the chain tail. */
      depth: replaceEmpty ? last.depth : last.depth + 1,
      row: last.row,
      width: MINDMAP_NODE_W,
      height: MINDMAP_NODE_H,
      question: typeof streaming.question === 'string' ? streaming.question : '',
      parentKey: undefined,
    }
    if (replaceEmpty) {
      /* Replace the placeholder card of a session awaiting its first turn;
         the parent of the ring is the card the placeholder hung off (the
         session's head). */
      const index = nodes.indexOf(last)
      const edge = edges.find(e => e.to === last.key)
      streamingNode.parentKey = edge === undefined ? undefined : edge.from
      nodes[index] = streamingNode
      if (edge !== undefined) edge.to = streamingNode.key
    } else {
      streamingNode.parentKey = last.key
      nodes.push(streamingNode)
      edges.push({ from: last.key, to: streamingNode.key })
    }
  }
  /* Positions: x by column (uniform grid; the head occupies one column slot),
     y by row (row 0 = root height, then card rows). */
  const width = (() => {
    let maxCol = 0
    for (const node of nodes) maxCol = Math.max(maxCol, node.depth)
    return Math.max((maxCol + 1) * (MINDMAP_NODE_W + MINDMAP_DEPTH_GAP) + MINDMAP_DEPTH_GAP,
      MINDMAP_ROOT_W + MINDMAP_DEPTH_GAP * 2)
  })()
  const rootX = (width - MINDMAP_ROOT_W) / 2
  const rootY = MINDMAP_ROW_GAP
  for (const node of nodes) {
    node.x = node.kind === 'root'
      ? rootX
      : mindmapXOf(node.depth)
    /* Row 0 = the virtual root node; every session row is pushed one FULL
       CARD height below it (the root "sits one card position higher" above
       the chains, with the node gaps unchanged). */
    node.y = node.row === 0
      ? rootY
      : rootY + MINDMAP_ROOT_H + MINDMAP_ROW_GAP + MINDMAP_NODE_H + (node.row - 1) * (MINDMAP_NODE_H + MINDMAP_ROW_GAP)
  }
  /* The virtual root node itself. */
  nodes.push({
    kind: 'root',
    key: MINDMAP_ROOT_KEY,
    sessionId: undefined,
    session: undefined,
    turn: undefined,
    empty: false,
    streaming: false,
    depth: 0,
    row: 0,
    x: rootX,
    y: rootY,
    width: MINDMAP_ROOT_W,
    height: MINDMAP_ROOT_H,
  })
  /* Precompute each edge's SVG path from the node positions. Non-mount edges
     (head → card → card → streaming) are orthogonal; mount edges (root →
     top-level head, parent card → child head) are cubic S-curves that enter
     the session head's LEFT side (its left edge at mid-height). The bulge
     factor (user-tunable, default ×5) scales both lobes: the root edge bows
     up near the root then swings into the head's LEFT margin and enters its
     left edge LEVEL (no downward sag, horizontal tangent); the branch edge
     leaves its parent card horizontally, bows OUTWARD (away from the trunk)
     and hooks into the child head — at ×0 each collapses to the straight
     chord. */
  const byKey = new Map()
  for (const node of nodes) byKey.set(node.key, node)
  const mountBulge = clampMountBulge(mountBulgeParam)
  for (const edge of edges) {
    const from = byKey.get(edge.from)
    const to = byKey.get(edge.to)
    if (from === undefined || to === undefined) continue
    if (edge.mount === true) {
      if (from.kind === 'root') {
        const sx = from.x + from.width / 2
        const sy = from.y + from.height
        const tx = to.x
        const ty = to.y + to.height / 2
        const c1x = sx - 61.2 * mountBulge
        const c1y = sy + 5.4 * mountBulge
        const c2x = tx - 24 * mountBulge
        /* The head entry stays LEVEL (control y = the entry mid-height): the
           curve swings into the head's LEFT margin but never sags below the
           entry, and its tangent at the head's left edge is horizontal. */
        const c2y = ty
        edge.d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`
      } else {
        const sx = from.x + from.width
        const sy = from.y + from.height / 2
        const tx = to.x
        const ty = to.y + to.height / 2
        const c1x = sx + 13 * mountBulge
        /* The branch edge leaves the parent card HORIZONTALLY (control y stays
           on the card's mid-height — no upward bow at the start), then bows
           outward and hooks into the child head. Both control offsets are
           balanced so the exit arc (outward, ~13/unit) and the entry arc
           (leftward, ~12/unit) read as the SAME curve: the exit bows right
           about as far as the head side bows left, each staying inside the
           column gap. */
        const c1y = sy
        const c2x = tx - 12 * mountBulge
        const c2y = ty + 1.2 * mountBulge
        edge.d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`
      }
    } else {
      const x1 = from.x + from.width
      const y1 = from.y + from.height / 2
      const x2 = to.x
      const y2 = to.y + to.height / 2
      const mx = (x1 + x2) / 2
      edge.d = `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`
    }
  }
  const lastEntry = order.length > 0 ? entryBySession.get(String(order[order.length - 1].sessionId)) : undefined
  const lastRow = lastEntry === undefined ? 1 : lastEntry.row
  const height = rootY + MINDMAP_ROOT_H + MINDMAP_ROW_GAP + MINDMAP_NODE_H + lastRow * (MINDMAP_NODE_H + MINDMAP_ROW_GAP) - MINDMAP_ROW_GAP
  return { nodes, edges, width, height }
}

const mindmapXOf = depth => MINDMAP_DEPTH_GAP + depth * (MINDMAP_NODE_W + MINDMAP_DEPTH_GAP)

/* The action a click on a layout node performs — 'new' (create a new
   top-level session at the root node), 'fork' (create a nested branch at this
   card) or 'switch' (jump the right-side chat to this node's own session).
   Exact mirror of the openCard decision tree; the hover hint and the click
   handler share it so the hint can never drift from the real behavior. A
   generating session's last completed card is semantically a middle card (its
   real tail is the streaming card), hence it forks. */
const mindmapCardClickAction = (node, doc, runningFamilyIds) => {
  if (node === undefined) return undefined
  if (node.kind === 'root') return 'new'
  if (node.kind === 'head') return 'switch'
  if (node.streaming === true) return 'switch'
  if (node.empty) return 'switch'
  const owner = node.sessionId
  const chain = (doc?.sessions ?? []).find(s => String(s?.sessionId) === String(owner))?.turns ?? []
  const last = chain[chain.length - 1]
  if (last !== undefined && last.seq === node.turn?.seq) {
    return runningFamilyIds.includes(String(owner)) ? 'fork' : 'switch'
  }
  return 'fork'
}

/* Clamp the view translation so the scaled world always keeps a MINIMUM
   fraction on screen instead of a fixed pixel ledge: each axis may be dragged
   out by up to MINDMAP_PAN_OUT_MAX of the world size (e.g. 80%), so the
   opposite 20% stays visible. A map SMALLER than the viewport can also slide
   (it is not pinned to the center); 还原视图 restores the fitted position
   any time the map is pushed out of reach. */
function mindmapClampView(view, worldW, worldH, vw, vh) {
  const sw = worldW * view.zoom
  const sh = worldH * view.zoom
  const out = MINDMAP_PAN_OUT_MAX
  /* x: from the world pushed left (its right 20% at the viewport's left edge)
     to the world pushed right (its left 20% at the viewport's right edge). */
  const tx = sw <= 0 || vw <= 0
    ? view.tx
    : Math.max(-out * sw, Math.min(view.tx, vw - (1 - out) * sw))
  const ty = sh <= 0 || vh <= 0
    ? view.ty
    : Math.max(-out * sh, Math.min(view.ty, vh - (1 - out) * sh))
  return { zoom: view.zoom, tx, ty }
}

/* Initial / "还原视图" view: fit the whole map (capped at 1x, never upscaled);
   a map too large to fit even at the minimum zoom aligns to the top-left so
   the root stays in view. */
function mindmapFitView(worldW, worldH, vw, vh) {
  if (worldW <= 0 || worldH <= 0 || vw <= 0 || vh <= 0) return null
  const zoom = Math.max(Math.min(Math.min(vw / worldW, vh / worldH), 1), MINDMAP_ZOOM_MIN)
  const sw = worldW * zoom
  const sh = worldH * zoom
  const tx = sw <= vw ? (vw - sw) / 2 : MINDMAP_PAN_MARGIN
  const ty = sh <= vh ? (vh - sh) / 2 : MINDMAP_PAN_MARGIN
  return { zoom, tx, ty }
}

/* Narrowed sessions subscription for the floating map. The map only reads
   the doc family's running flags and display titles, but `useSessions(state
   => state)` re-renders every card on ANY session change, including
   streaming churn in unrelated sessions. The selector returns the SAME
   projection object while the family's fields are unchanged, so idle store
   churn never re-renders the map; the projection is rebuilt when a family
   field changes or the family set grows (the caller keeps `familyIdsRef`
   current), and it keeps the latest byId reference so reads stay fresh. */
function useMindmapSessionView(useSessions, familyIdsRef) {
  const cacheRef = useRef(null)
  return useSessions((state) => {
    const byId = state?.byId ?? {}
    const family = familyIdsRef.current
    const runningKey = family.map(id => (byId[id]?.running === true ? '1' : '0')).join('|')
    const titlesKey = family.map(id => byId[id]?.displayTitle ?? '').join('\u0001')
    /* The cache key must also cover the FAMILY MEMBERSHIP itself: a root
       replacement (trunk truncation) swaps the root session id while keeping
       the same titles and running bits, so runningKey+titlesKey alone would
       serve a stale projection whose `titles` still keys the archived root —
       leaving the new root's cards with empty titles until the next store
       change. */
    const familyKey = family.join('\u0002')
    const cache = cacheRef.current
    if (cache !== null && cache.familyKey === familyKey && cache.runningKey === runningKey && cache.titlesKey === titlesKey) {
      cache.view.byId = byId
      return cache.view
    }
    const view = {
      byId,
      runningIds: new Set(family.filter(id => byId[id]?.running === true)),
      titles: Object.fromEntries(family.map(id => [id, byId[id]?.displayTitle ?? ''])),
    }
    cacheRef.current = { familyKey, runningKey, titlesKey, view }
    return view
  })
}

/* One absolutely-positioned map card. Extracted so `memo` can skip rebuilding
   cards whose props are unchanged: a doc-triggered re-render only rebuilds the
   added / changed / current-badge-flipped cards. */
const MindMapCard = memo(function MindMapCard({
  entry, title, isCurrent, isStreaming, isAncestor, isHover, isHoverAncestor, hintAction, isEnd, ringPalette, onOpen, onMenu, onHover,
}) {
  /* Ring cards (the streaming card and its parent, both wearing the flowing
     gradient ring) are the pair's single visual signal: the selection (blue)
     and hover (amber) border/glow effect classes are suppressed on BOTH cards
     so a dashed blue/amber border can never overwrite the ring. The ancestors
     ABOVE the pair and their edges still trace normally — the immunity is
     purely presentational and stops at these two cards. The "当前" badge is
     kept (informational only, no border interference). */
  const ringed = ringPalette !== undefined
  /* Every v3 question card is a branch node (there is no trunk anymore); the
     empty placeholder keeps the dashed pending look (no data-branch), the
     completed cards are solid + primary-tinted. */
  const classes = 'dsh-ws-mindmap-node dsh-ws-mindmap-branchcard'
    + (isEnd && !isStreaming ? ' dsh-ws-mindmap-endcard' : '')
    + (isCurrent && !ringed ? ' dsh-ws-mindmap-node-current' : '')
    + (isStreaming ? ' dsh-ws-mindmap-node-streaming' : '')
    + (ringed ? ' dsh-ws-mindmap-node-ring' : '')
    + (isAncestor && !ringed ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor && !ringed ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover && !ringed ? ' dsh-ws-mindmap-node-hover' : '')
  const turn = entry.turn
  const style = { left: entry.x, top: entry.y, width: entry.width, height: entry.height }
  if (ringPalette !== undefined) {
    style['--dsw-ws-mm-c1'] = ringPalette[0]
    style['--dsw-ws-mm-c2'] = ringPalette[1]
    style['--dsw-ws-mm-c3'] = ringPalette[2]
  }
  return h('div', {
    className: classes,
    'data-branch': entry.empty ? undefined : '',
    key: entry.key,
    onClick: () => { onOpen(entry) },
    /* Hover drives the additive ancestor trace: entering a card traces its
       chain to the root on top of the selection's; leaving clears it. React's
       mouseenter/mouseleave semantics fire only on boundary crossing, so
       moving within a card does not churn the state. */
    onMouseEnter: () => { onHover(entry.key) },
    onMouseLeave: () => { onHover(undefined) },
    onContextMenu: !isStreaming
      ? (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) }
      : undefined,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style,
    title: isStreaming ? translate('mindmap.streaming.click') : translate('mindmap.open.hint'),
  },
    isCurrent ? h('span', { className: 'dsh-ws-mindmap-node-current-badge' }, translate('mindmap.current')) : null,
    h('div', { className: 'dsh-ws-mindmap-node-title' },
      h('span', { className: 'dsh-ws-mindmap-pending-label' + (isEnd ? ' dsh-ws-mindmap-end-label' : '') },
        /* An end-of-branch card (click = jump/switch to its session) carries a
           bullseye chip — the branch's terminal point — instead of the fork
           glyph, so its meaning never gets confused with a fork point. */
        isEnd
          ? h('svg', {
            className: 'dsh-ws-mindmap-pending-icon',
            fill: 'none',
            height: '11',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            viewBox: '0 0 14 14',
            width: '11',
          },
            h('circle', { cx: 7, cy: 7, r: 4.4 }),
            h('circle', { cx: 7, cy: 7, fill: 'currentColor', r: 1.6, stroke: 'none' }))
          : h('svg', {
            className: 'dsh-ws-mindmap-pending-icon',
            fill: 'none',
            height: '11',
            stroke: 'currentColor',
            strokeLinecap: 'round',
            strokeWidth: 1.3,
            viewBox: '0 0 14 14',
            width: '11',
          },
            h('path', { d: 'M1.5 7 H4.5' }),
            h('path', { d: 'M4.5 7 C5.8 2.6 10.6 3 11.4 3.2' }),
            h('path', { d: 'M4.5 7 C5.8 11.4 10.6 11 11.4 10.8' }),
            h('circle', { cx: 11.4, cy: 3.2, fill: 'currentColor', r: 1.4, stroke: 'none' }),
            h('circle', { cx: 11.4, cy: 10.8, fill: 'currentColor', r: 1.4, stroke: 'none' })),
        translate(isEnd ? 'mindmap.endTag' : 'mindmap.branchTag')),
      h('span', { className: 'dsh-ws-mindmap-node-title-text' }, title)),
    entry.empty
      ? h('div', { className: 'dsh-ws-mindmap-pending-title' }, translate('mindmap.pending'))
      : isStreaming
        ? h('div', { className: 'dsh-ws-mindmap-node-q' }, mindmapClip(entry.question || translate('mindmap.streaming'), MINDMAP_TEXT_MAX))
        : h('div', { className: 'dsh-ws-mindmap-node-q' }, mindmapClip(turn.user || translate('mindmap.emptyRound'), MINDMAP_TEXT_MAX)),
    entry.empty
      ? null
      : isStreaming
        ? h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-streaming-status' },
            h('span', { className: 'dsh-ws-mindmap-node-streaming-dot' }),
            h('span', null, translate('mindmap.streaming')))
        : h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-done' }, translate('mindmap.done')),
    /* Hover-only click-action hint chip: tells the user what a click will do
       ('点击分支' / '点击跳转'). pointer-events:none so it never intercepts
       the card's hover or click; absolute so it never shifts the layout. */
    isHover && hintAction !== undefined
      ? h('span', { className: 'dsh-ws-mindmap-node-hint' }, translate(`mindmap.hint.${hintAction}`))
      : null)
})

/* The VIRTUAL root node: the map's top hub. Clicking it creates a new
   top-level session. Not backed by any session — it only exists in the
   layout. */
const MindMapRootNode = memo(function MindMapRootNode({ entry, isAncestor, isHoverAncestor, isHover, onOpen, onMenu, onHover }) {
  const classes = 'dsh-ws-mindmap-root'
    + (isAncestor ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover ? ' dsh-ws-mindmap-node-hover' : '')
  return h('div', {
    className: classes,
    key: entry.key,
    onClick: () => { onOpen(entry) },
    onMouseEnter: () => { onHover(entry.key) },
    onMouseLeave: () => { onHover(undefined) },
    onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style: { left: entry.x, top: entry.y, width: entry.width, height: entry.height },
    title: translate('mindmap.rootNode.hint'),
  },
    h('div', { className: 'dsh-ws-mindmap-root-plus' },
      /* A symmetric inline SVG plus (geometrically centered in the circle, so
         the hover 90° rotation maps it onto itself — no position shift). */
      h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
        h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 2.4 }))),
    h('div', { className: 'dsh-ws-mindmap-root-col' },
      h('div', { className: 'dsh-ws-mindmap-root-title' }, translate('mindmap.rootNode')),
      h('div', { className: 'dsh-ws-mindmap-root-hint' }, translate('mindmap.rootNode.hint'))))
})

/* A session's HEAD node: the identity card at the left of its question chain.
   Shows the session title / round count / status; clicking it switches to the
   session (the "当前" badge sits here); right-click renames the session. */
const MindMapSessionHead = memo(function MindMapSessionHead({
  entry, title, isCurrent, isRunning, isAncestor, isHover, isHoverAncestor, hintAction, ringPalette, onOpen, onMenu, onHover,
}) {
  const ringed = ringPalette !== undefined
  const classes = 'dsh-ws-mindmap-node dsh-ws-mindmap-head'
    + (isCurrent && !ringed ? ' dsh-ws-mindmap-head-current' : '')
    + (ringed ? ' dsh-ws-mindmap-node-ring' : '')
    + (isAncestor && !ringed ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor && !ringed ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover && !ringed ? ' dsh-ws-mindmap-node-hover' : '')
  const turns = entry.session?.turns ?? []
  const countLabel = turns.length > 0
    ? translate('mindmap.rounds', { n: turns.length })
    : translate('mindmap.session.empty')
  const statusLabel = isRunning
    ? translate('mindmap.streaming')
    : (turns.length > 0 ? translate('mindmap.done') : translate('mindmap.session.waiting'))
  const style = { left: entry.x, top: entry.y, width: entry.width, height: entry.height }
  if (ringPalette !== undefined) {
    style['--dsw-ws-mm-c1'] = ringPalette[0]
    style['--dsw-ws-mm-c2'] = ringPalette[1]
    style['--dsw-ws-mm-c3'] = ringPalette[2]
  }
  return h('div', {
    className: classes,
    key: entry.key,
    onClick: () => { onOpen(entry) },
    onMouseEnter: () => { onHover(entry.key) },
    onMouseLeave: () => { onHover(undefined) },
    onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style,
    title: translate('mindmap.open.hint'),
  },
    isCurrent ? h('span', { className: 'dsh-ws-mindmap-node-current-badge' }, translate('mindmap.current')) : null,
    h('div', { className: 'dsh-ws-mindmap-head-row' },
      h('svg', { className: 'dsh-ws-mindmap-head-icon', fill: 'none', viewBox: '0 0 24 24' },
        h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z', stroke: 'currentColor', strokeWidth: '1.7', strokeLinejoin: 'round' })),
      h('span', { className: 'dsh-ws-mindmap-head-title' }, title)),
    h('div', { className: 'dsh-ws-mindmap-head-count' }, countLabel),
    h('div', { className: 'dsh-ws-mindmap-head-status' + (isRunning ? ' dsh-ws-mindmap-head-status-live' : '') },
      isRunning ? h('span', { className: 'dsh-ws-mindmap-node-streaming-dot' }) : null,
      statusLabel),
    isHover && hintAction !== undefined
      ? h('span', { className: 'dsh-ws-mindmap-node-hint' }, translate(`mindmap.hint.${hintAction}`))
      : null)
})

/* The floating mind map: a persisted turn tree (trunk + fork branches)
   rendered from the doc, with pan/zoom and per-card forking. Rendered inside
   the left-side overlay window; card clicks switch the right-side chat. */
function MindMapView({ sessionId, useSessions, loadDoc, saveDoc, syncDoc, deleteDoc, forkAt, createSession, listWorkspaces, openSession, renameSession, archiveSession, previewRight, settingsStore }) {
  const overlay = useMindmapOverlay()
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const [phase, setPhase] = useState({ status: 'loading' })
  const [doc, setDoc] = useState(null)
  const [rootId, setRootId] = useState(null)
  // Latest root id as a ref: applySync guards in-flight responses against THIS
  // (never the closure rootId), so a sync that started before a family switch
  // cannot apply the previous family's doc after the switch.
  const rootIdRef = useRef(null)
  rootIdRef.current = rootId
  /* The doc family ids, kept current BEFORE the narrowed sessions subscription
     below runs (the selector cannot close over doc/rootId directly, and its
     getSnapshot must see the fresh family during this render). */
  const familyIdsRef = useRef([])
  familyIdsRef.current = doc === null || rootId === null
    ? []
    : [...new Set([String(rootId), ...(doc.sessions ?? []).map(s => String(s?.sessionId))])]
  const list = useMindmapSessionView(useSessions, familyIdsRef)
  const loadDocRef = useRef(loadDoc)
  loadDocRef.current = loadDoc
  const saveDocRef = useRef(saveDoc)
  saveDocRef.current = saveDoc
  const syncDocRef = useRef(syncDoc)
  syncDocRef.current = syncDoc
  const deleteDocRef = useRef(deleteDoc)
  deleteDocRef.current = deleteDoc
  const forkAtRef = useRef(forkAt)
  forkAtRef.current = forkAt
  const createSessionRef = useRef(createSession)
  createSessionRef.current = createSession
  const listWorkspacesRef = useRef(listWorkspaces)
  listWorkspacesRef.current = listWorkspaces
  const openSessionRef = useRef(openSession)
  openSessionRef.current = openSession
  const renameSessionRef = useRef(renameSession)
  renameSessionRef.current = renameSession
  const archiveSessionRef = useRef(archiveSession)
  archiveSessionRef.current = archiveSession
  const menuRef = useRef(null)
  const mountedRef = useRef(true)
  const noticeTimerRef = useRef(0)
  const lastFingerprintRef = useRef('')
  const savingRef = useRef(false)
  /* Synchronous gate for in-flight fork writes: the `forking` STATE guard is
     only visible after React re-renders, so a same-tick second trigger would
     otherwise pass it and fork twice (the loser's child then gets adopted back
     as a duplicate branch by the next sync). */
  const forkingRef = useRef(false)
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState(null)
  const [menu, setMenu] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState(null)
  /* Archiving ONE session branch (right-click a session head): archives the
     session + its whole subtree and removes it from the doc. */
  const [archiveBranchTarget, setArchiveBranchTarget] = useState(null)
  const [archiveBranchBusy, setArchiveBranchBusy] = useState(false)
  const [archiveBranchError, setArchiveBranchError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [notice, setNotice] = useState(null)
  /* Live-turn info from the latest sync payload: one { sessionId, turn,
     question } per doc-family session with a turn in flight — drives the
     streaming cards. */
  const [live, setLive] = useState([])
  const [dragging, setDragging] = useState(false)
  /* Key of the card currently under the pointer (undefined when none): drives
     the hover ancestor trace — the same highlight as the selected card's
     chain, but for the hovered card, rendered additively on top of the
     selection trace. */
  const [hoverKey, setHoverKey] = useState(undefined)
  const viewportRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef({ tx: 0, ty: 0, zoom: 1 })
  const dragRef = useRef(null)
  const pendingViewRef = useRef(null)
  const rafRef = useRef(0)
  const fittedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (noticeTimerRef.current !== 0) { clearTimeout(noticeTimerRef.current); noticeTimerRef.current = 0 }
    }
  }, [])
  const showNotice = useCallback((text) => {
    // The notice render expects the object shape ({ error, text }); a bare
    // string has neither field, so it rendered as an empty div and every
    // mind-map success toast was invisible.
    setNotice({ error: false, text })
    if (noticeTimerRef.current !== 0) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = 0
      if (mountedRef.current) setNotice(null)
    }, 3000)
  }, [])
  const showNoticeError = useCallback((text) => {
    setNotice({ error: true, text })
    if (noticeTimerRef.current !== 0) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = 0
      if (mountedRef.current) setNotice(null)
    }, 3000)
  }, [])

  /* Load the doc for the current session: the Host resolves a branch session
     to its root's doc, and builds & persists a fresh doc (full-log split) on
     first access — the conversion step. */
  useEffect(() => {
    /* A session switch INSIDE the loaded family (the map keeps ONE map per
       family — every clickable card belongs to it): only the "当前" highlight
       and the right-side chat follow sessionId; the doc is identical, so a
       reload would rebuild the whole canvas for nothing. Only a session
       OUTSIDE the family (another mind map opened over this one) triggers a
       full reload. rootId/doc are read at call time on purpose. */
    if (rootId !== null && (String(sessionId) === String(rootId)
      || (doc?.sessions ?? []).some(s => String(s?.sessionId) === String(sessionId)))) {
      setForkError(null)
      return undefined
    }
    let cancelled = false
    setDoc(null)
    setRootId(null)
    setLive([])
    setPhase({ status: 'loading' })
    setForkError(null)
    /* A different family loads: drop any hover from the previous map (a stale
       key would match no node in the new layout anyway, but resetting keeps
       the state honest). In-family switches skip this branch on purpose. */
    setHoverKey(undefined)
    /* Switching to a DIFFERENT family (or a fresh doc): reset the view so the
       new map is fitted on load instead of inheriting the old transform
       (fittedRef was only ever set, never reset, so switching maps kept the
       old pan/zoom). */
    fittedRef.current = false
    viewRef.current = { tx: 0, ty: 0, zoom: 1 }
    const id = String(sessionId)
    Promise.resolve(loadDocRef.current(id))
      .then((payload) => {
        if (cancelled) return
        const loaded = payload?.doc
        if (loaded === null || loaded === undefined || (loaded.sessions ?? []).length === 0) {
          mindmapConvertedSessions.delete(id)
          setPhase({ status: 'empty' })
          return
        }
        setRootId(loaded.rootSessionId)
        setDoc(loaded)
        lastFingerprintRef.current = mindmapDocFingerprint(loaded)
        setPhase({ status: 'ready' })
        mindmapRegistry.markDirty()
        if (payload.created === true) showNotice(translate('mindmap.created'))
      })
      .catch((error) => {
        if (cancelled) return
        mindmapConvertedSessions.delete(id)
        setPhase({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { cancelled = true }
  }, [sessionId])

  /* Empty-state refresh: with phase 'empty', rootId stays null and neither
     sync effect can run — poll loadDoc so the FIRST completed turn converts
     the document and the cards appear without a reopen. The probe is cheap: a
     session without turns answers { exists: false } immediately, and the
     state is short-lived by nature. */
  useEffect(() => {
    if (phase.status !== 'empty') return undefined
    let cancelled = false
    const probe = () => {
      const id = String(sessionId)
      Promise.resolve(loadDocRef.current(id))
        .then((payload) => {
          if (cancelled) return
          /* The root was archived by a path OUTSIDE the map (harness/sidebar
             archive): the Host answers { exists: false } and never builds a doc
             for an archived session. Close the floating window like the sync
             path does, instead of polling an empty state forever. */
          if (payload?.exists === false) {
            mindmapConvertedSessions.delete(String(sessionId))
            mindmapOverlayStore.close()
            return
          }
          const loaded = payload?.doc
          if (loaded !== null && loaded !== undefined && (loaded.sessions ?? []).length > 0) {
            setRootId(loaded.rootSessionId)
            setDoc(loaded)
            lastFingerprintRef.current = mindmapDocFingerprint(loaded)
            setPhase({ status: 'ready' })
            mindmapRegistry.markDirty()
            if (payload.created === true) showNotice(translate('mindmap.created'))
          }
        })
        .catch(() => { /* transient: keep polling */ })
    }
    const timer = window.setInterval(probe, MINDMAP_SYNC_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [phase.status, sessionId, showNotice])

  /* Apply one sync payload: fold the refreshed doc (only when the structure
     actually changed) and remember the live-turn info for the streaming card
     (identity-compared so a static question does not re-render the map). */
  const applySync = useCallback((payload, root) => {
    /* Apply a response only when its request still matches the CURRENT family
       (rootIdRef, not the closure rootId) AND no mutation is in flight:
       - family switch: the closure rootId is stale, so `root === rootId` would
         overwrite the freshly loaded doc with the previous family's;
       - fork/delete/truncation: savingRef is set, so a pre-write sync must not
         overwrite the optimistic doc (the next sync re-fetches the persisted
         doc and stays consistent). */
    if (!mountedRef.current || root !== rootIdRef.current || savingRef.current) return
    /* The root was archived outside the map (harness/sidebar archive): the
       Host answers { exists: false } — close the floating window like the
       toolbar-archive path instead of leaving a stale map. */
    if (payload?.exists === false) {
      mindmapOverlayStore.close()
      return
    }
    const next = payload?.doc
    if (next === null || next === undefined) return
    const fp = mindmapDocFingerprint(next)
    if (fp !== lastFingerprintRef.current) {
      lastFingerprintRef.current = fp
      setDoc(next)
    }
    /* The live list is identity-compared so a static set of in-flight
       questions does not re-render the map on every periodic sync. */
    const liveNext = Array.isArray(payload?.live)
      ? payload.live
      : payload?.live !== null && payload?.live !== undefined && typeof payload.live === 'object'
        ? [{
            // Older Hosts return one object and may omit its session id; the
            // first currently-running family id is the compatible fallback.
            sessionId: String(payload.live.sessionId ?? runningFamilyIdsRef.current[0] ?? ''),
            turn: payload.live.turn,
            question: payload.live.question,
          }]
        : []
    setLive(prev => {
      if (prev.length !== liveNext.length) return liveNext
      for (let i = 0; i < liveNext.length; i += 1) {
        const a = prev[i]
        const b = liveNext[i]
        if (a === null || a === undefined || b === null || b === undefined
          || String(a.sessionId) !== String(b.sessionId)
          || Number(a.turn) !== Number(b.turn)
          || String(a.question ?? '') !== String(b.question ?? '')) return liveNext
      }
      return prev
    })
  }, [])

  /* The doc-family sessions currently running: a live streaming card attaches
     to EACH of their chains, regardless of which session the floating map is
     "on", and every sync asks for their in-flight questions. Declared BEFORE
     the debounced effect below — its dependency array reads this binding at
     call time. */
  const runningFamilyIds = useMemo(() => {
    if (doc === null || rootId === null) return []
    const family = [...new Set([String(rootId), ...(doc.sessions ?? []).map(s => String(s?.sessionId))])]
    return family.filter(id => list.runningIds.has(id))
  }, [doc, list, rootId])
  const runningFamilyIdsRef = useRef([])
  runningFamilyIdsRef.current = runningFamilyIds

  /* Periodic sync while mounted: fold new branch turns from the full logs so
     a branch that completes a turn in the chat appears live. */
  useEffect(() => {
    if (rootId === null) return undefined
    const timer = window.setInterval(() => {
      if (savingRef.current) return
      const root = rootId
      Promise.resolve(syncDocRef.current(root, runningFamilyIdsRef.current))
        .then((payload) => { applySync(payload, root) })
        .catch(() => { /* transient sync failure: keep the current doc */ })
    }, MINDMAP_SYNC_MS)
    return () => { clearInterval(timer) }
  }, [applySync, rootId])

  /* Sync shortly after the doc-family running state changes: a run start
     brings the in-flight questions back quickly; a run end folds the just
     completed turn (the map may be showing a different session than the one
     that just ran), debounced against streaming updates. */
  useEffect(() => {
    if (rootId === null) return undefined
    const timer = window.setTimeout(() => {
      if (!mountedRef.current || savingRef.current) return
      const root = rootId
      Promise.resolve(syncDocRef.current(root, runningFamilyIdsRef.current))
        .then((payload) => { applySync(payload, root) })
        .catch(() => { /* transient */ })
    }, 600)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningFamilyIds, rootId])

  /* The live streaming cards: every running doc-family session gets a live
     card appended to its own chain tail. The in-flight question arrives with
     the next sync payload; until then the card shows the streaming label.
     Declared BEFORE the layout memo that consumes them (use-before-declaration
     would throw a TDZ error on every render). */
  const streamingCards = useMemo(() => {
    if (runningFamilyIds.length === 0) return []
    const liveById = new Map()
    for (const item of live) {
      if (item !== null && item !== undefined) liveById.set(String(item.sessionId), item)
    }
    return runningFamilyIds.map((sid) => {
      const liveTurn = liveById.get(String(sid))
      return {
        sessionId: String(sid),
        question: liveTurn === undefined ? '' : (typeof liveTurn.question === 'string' ? liveTurn.question : ''),
      }
    })
  }, [live, runningFamilyIds])

  const mountBulge = clampMountBulge(settings.mindmapMountBulge)
  const layout = useMemo(() => mindmapDocLayout(doc, streamingCards, mountBulge), [doc, streamingCards, mountBulge])

  /* Edge path strings plus per-streaming metadata, derived from the layout
     (edge `d` paths are already precomputed by the layout) and stable between
     doc changes — memoized so a re-render (rare, after A1 the pan/zoom path
     never re-renders) does not rebuild them. */
  const edgeView = useMemo(() => {
    const byKey = new Map()
    for (const node of layout.nodes) byKey.set(node.key, node)
    /* Per-streaming metadata for the SVG <defs> + ring palette lookups. */
    const streamingEntries = []
    for (const node of layout.nodes) {
      if (node.streaming !== true) continue
      const palette = mindmapStreamPalette(node.sessionId)
      const gradId = mindmapGradientId(node.sessionId)
      const entry = { entry: node, parentKey: node.parentKey, palette, gradId }
      const parent = node.parentKey === undefined ? undefined : byKey.get(node.parentKey)
      if (parent !== undefined) {
        entry.bbox = {
          x1: parent.x + parent.width,
          y1: parent.y + parent.height / 2,
          x2: node.x,
          y2: node.y + node.height / 2,
        }
      }
      streamingEntries.push(entry)
    }
    /* An edge that TARGETS a live streaming card (its `to` is a
       `streaming:<sid>` key, by construction) is a flowing pair edge: it
       carries its own gradient id + palette derived from the sid embedded in
       the key, so the flow styling never depends on a node/edge key-matching
       map. */
    const edges = []
    for (const edge of layout.edges) {
      const from = byKey.get(edge.from)
      const to = byKey.get(edge.to)
      if (from === undefined || to === undefined) continue
      /* Keep the edge's from/to identities so the render pass can mark the
         current card's ancestor-trace edges (from/to are strings). */
      let flow
      if (typeof edge.to === 'string' && edge.to.startsWith('streaming:')) {
        const sid = edge.to.slice('streaming:'.length)
        flow = {
          gradId: mindmapGradientId(sid),
          palette: mindmapStreamPalette(sid),
        }
      }
      edges.push({ from: edge.from, to: edge.to, d: edge.d, mount: edge.mount === true, flow })
    }
    return { edges, streamingEntries }
  }, [layout])

  /* Viewport interaction: grab-pan on blank area + wheel zoom anchored at the
     cursor. The transform is applied straight to the canvas element (NOT React
     state): every wheel tick / drag frame used to re-render the whole map, and
     a direct style write keeps interaction at frame rate while React only
     re-renders when the DOC changes. viewRef is the single source of truth. */
  const applyViewTransform = useCallback(() => {
    const el = canvasRef.current
    if (el === null) return
    const cur = viewRef.current
    el.style.transform = `translate(${cur.tx}px, ${cur.ty}px) scale(${cur.zoom})`
  }, [])
  const updateView = useCallback((next) => {
    viewRef.current = next
    applyViewTransform()
  }, [applyViewTransform])
  const scheduleView = useCallback((next) => {
    pendingViewRef.current = next
    if (rafRef.current !== 0) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      const pending = pendingViewRef.current
      pendingViewRef.current = null
      if (pending !== null) updateView(pending)
    })
  }, [updateView])
  const viewportSize = useCallback(() => {
    const el = viewportRef.current
    return el === null ? { vw: 0, vh: 0 } : { vw: el.clientWidth, vh: el.clientHeight }
  }, [])
  const restoreView = useCallback(() => {
    const { vw, vh } = viewportSize()
    const fit = mindmapFitView(layout.width, layout.height, vw, vh)
    if (fit !== null) updateView(fit)
  }, [layout.height, layout.width, updateView, viewportSize])
  /* Fit once when the map first becomes visible; later layout growth keeps the
     user's view and 还原视图 restores the fit at any time. */
  useLayoutEffect(() => {
    if (fittedRef.current) return
    const { vw, vh } = viewportSize()
    const fit = mindmapFitView(layout.width, layout.height, vw, vh)
    if (fit !== null) { fittedRef.current = true; updateView(fit) }
  }, [layout.height, layout.width, updateView, viewportSize])
  /* Replay the transform after every render: the transform is owned by the
     DOM, not React state, so a doc-driven re-render must re-apply the current
     view instead of leaving the canvas at a stale transform. */
  useLayoutEffect(() => {
    applyViewTransform()
  })
  /* Wheel zoom with the cursor as the anchor. React attaches wheel as passive
     at the root, so preventDefault requires a native non-passive listener. */
  useEffect(() => {
    const el = viewportRef.current
    if (el === null) return
    const onWheel = (event) => {
      event.preventDefault()
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      const rect = el.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      const cur = viewRef.current
      const factor = Math.exp(-dy * MINDMAP_WHEEL_STEP)
      const zoom = Math.max(MINDMAP_ZOOM_MIN, Math.min(cur.zoom * factor, MINDMAP_ZOOM_MAX))
      const next = mindmapClampView({
        zoom,
        tx: cx - (cx - cur.tx) * (zoom / cur.zoom),
        ty: cy - (cy - cur.ty) * (zoom / cur.zoom),
      }, layout.width, layout.height, el.clientWidth, el.clientHeight)
      updateView(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [layout.height, layout.width, updateView])
  /* Drop any pending rAF frame on unmount. */
  useEffect(() => () => {
    if (rafRef.current !== 0) { window.cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
  }, [])
  /* Grab-pan: only a press on the viewport/canvas background (not a node)
     starts a drag; pointer capture keeps tracking motion outside the
     element. */
  const startPan = useCallback((event) => {
    if (event.button !== 0) return
    const target = event.target
    if (target !== viewportRef.current && target !== canvasRef.current) return
    event.preventDefault()
    const cur = viewRef.current
    dragRef.current = { startX: event.clientX, startY: event.clientY, tx: cur.tx, ty: cur.ty }
    setDragging(true)
    const el = viewportRef.current
    if (el !== null && typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(event.pointerId) } catch { /* already released */ }
    }
  }, [])
  const movePan = useCallback((event) => {
    const drag = dragRef.current
    if (drag === null) return
    const { vw, vh } = viewportSize()
    scheduleView(mindmapClampView({
      ...viewRef.current,
      tx: drag.tx + (event.clientX - drag.startX),
      ty: drag.ty + (event.clientY - drag.startY),
    }, layout.width, layout.height, vw, vh))
  }, [layout.height, layout.width, scheduleView, viewportSize])
  const endPan = useCallback((event) => {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragging(false)
    const el = viewportRef.current
    if (el !== null && typeof el.releasePointerCapture === 'function') {
      try { el.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
    }
  }, [])

  /* Key of the CURRENT session's chain TAIL for the "当前" highlight (the
     badge + the solid selection highlight + the ancestor trace all derive
     from this). The session HEAD card is only an opening/switch identity
     card and must NEVER carry the badge or the solid current highlight — the
     badge lands on the chain tail: the last question card, the empty
     placeholder of a session with no turns yet, or the ephemeral streaming
     card while the session is generating (which wears its own ring instead
     of the solid border). */
  const currentKey = useMemo(() => {
    if (doc === null || rootId === null) return undefined
    const current = String(sessionId)
    const entry = (doc.sessions ?? []).find(s => String(s?.sessionId) === current)
    if (entry === undefined) return undefined
    if (runningFamilyIds.includes(current)) return `streaming:${current}`
    const turns = entry.turns ?? []
    const last = turns[turns.length - 1]
    return last === undefined ? mindmapEmptyKey(current) : mindmapDocKey(current, last.seq)
  }, [doc, rootId, runningFamilyIds, sessionId])

  /* Ancestor trace of the current card: walk the layout's edges BACKWARD from
     currentKey (`to → from`) to the root (no incoming edge). Yields the set
     of parent-node keys — the card itself keeps the solid highlight, hence
     excluded — and the path's edge identities; the render marks those edges
     dashed primary-blue and those parent nodes with dashed borders. Memoized
     on [currentKey, layout] so an in-family session switch re-traces cheaply
     without touching the pan/zoom path; lookups are O(1) Set reads. */
  const trace = useMemo(() => {
    const ancestorSet = new Set()
    const activeEdgeKeys = new Set()
    if (currentKey === undefined) return { ancestorSet, activeEdgeKeys }
    const parentOf = new Map()
    for (const edge of layout.edges) parentOf.set(edge.to, edge.from)
    let key = currentKey
    while (key !== undefined && parentOf.has(key)) {
      const parentKey = parentOf.get(key)
      if (parentKey === undefined) break
      ancestorSet.add(parentKey)
      activeEdgeKeys.add(`${parentKey}\u0000${key}`)
      key = parentKey
    }
    return { ancestorSet, activeEdgeKeys }
  }, [currentKey, layout])

  /* Hover ancestor trace: the SAME backward walk as `trace` above, but rooted
     at the card currently under the pointer instead of the selected card. The
     two traces are rendered as a union, so hovering adds its chain on top of
     the selection's without disturbing it. A stale hoverKey (e.g. the card
     was replaced by a sync while hovered) matches no node and yields an empty
     trace. */
  const hoverTrace = useMemo(() => {
    const ancestorSet = new Set()
    const activeEdgeKeys = new Set()
    if (hoverKey === undefined) return { ancestorSet, activeEdgeKeys }
    const parentOf = new Map()
    for (const edge of layout.edges) parentOf.set(edge.to, edge.from)
    let key = hoverKey
    while (key !== undefined && parentOf.has(key)) {
      const parentKey = parentOf.get(key)
      if (parentKey === undefined) break
      ancestorSet.add(parentKey)
      activeEdgeKeys.add(`${parentKey}\u0000${key}`)
      key = parentKey
    }
    return { ancestorSet, activeEdgeKeys }
  }, [hoverKey, layout])

  /* Open a session inside the map: the wrapped openSession switches the
     right-side conversation to it and moves the "当前" highlight here; the
     floating overlay itself stays open (there is no view ring anymore). */
  const openBranch = useCallback((id) => {
    openSessionRef.current(String(id))
  }, [])

  /* Fork a new branch session at a card's turn/end seq, record it in the doc
     and persist. The child opens ONLY after the doc write completes, so the
     new branch is already part of the document when shown — its mind-map view
     can never miss the document and split off a new one. The injected forkAt
     no longer opens the child; this function opens it into the chat so the
     conversation continues from the clicked card. */
  const forkBranchAt = useCallback((ownerId, turn) => {
    /* The ref is the authoritative same-tick gate (see forkingRef above); the
       state guard additionally stops a second fork after re-render. */
    if (forkingRef.current || forking || turn === undefined) return
    forkingRef.current = true
    setForkError(null)
    setForking(true)
    const root = rootId
    const currentDoc = doc
    savingRef.current = true
    Promise.resolve(forkAtRef.current(String(ownerId), turn.seq))
      .then(async (childId) => {
        /* A nested fork: the new session hangs off the clicked card. */
        const session = {
          id: `s${Date.now()}`,
          sessionId: String(childId),
          parentSessionId: String(ownerId),
          forkTurn: Number(turn.t),
          parentTurn: Number(turn.n),
          forkSeq: Number(turn.seq),
          turns: [],
        }
        const next = { ...currentDoc, sessions: [...(currentDoc?.sessions ?? []), session], updatedAt: Date.now() }
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        try {
          await saveDocRef.current(root, next)
        } catch (error) {
          /* The branch must not outlive its document entry: archive the
             freshly forked (still empty) session so a failed write cannot
             leave an orphaned branch session behind. */
          try { await archiveSessionRef.current(String(childId)) } catch { /* best effort */ }
          /* Roll the optimistic branch back (unless a concurrent sync has
             since moved the doc on) so a failed fork never leaves a card
             whose session was just archived in the map — the periodic sync
             would otherwise keep showing a dead branch for up to 2.5 s. */
          setDoc(prev => (prev === next ? currentDoc : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(currentDoc)
          throw error
        }
        if (!mountedRef.current) return
        /* Open into chat (the child's default view) so the next message
           extends from exactly the clicked card. */
        openSessionRef.current(String(childId))
      })
      .then(() => {
        if (!mountedRef.current) return
        showNotice(translate('mindmap.forked'))
        mindmapRegistry.markDirty()
      })
      .catch((error) => {
        if (mountedRef.current) setForkError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        forkingRef.current = false
        savingRef.current = false
        if (mountedRef.current) setForking(false)
      })
  }, [doc, forking, rootId, showNotice])

  /* Click the VIRTUAL root node: create a brand-new EMPTY top-level session
     (a fresh harness session with no inherited turns) that hangs directly off
     the root node, record it in the doc and persist, then open it so the user
     can immediately ask the first question. The session is created in the
     workspace the map was CREATED in (doc.workspaceCwd, recorded at
     conversion) so it lands in the same sidebar group regardless of where the
     anchor session currently lives. */
  const addRootSession = useCallback(() => {
    /* The ref is the authoritative same-tick gate (see forkingRef above); the
       state guard additionally stops a second create after re-render. */
    if (forkingRef.current || forking) return
    forkingRef.current = true
    setForkError(null)
    setForking(true)
    const root = rootId
    const currentDoc = doc
    savingRef.current = true
    const recordedCwd = (typeof currentDoc?.workspaceCwd === 'string' && currentDoc.workspaceCwd !== '')
      ? currentDoc.workspaceCwd
      : undefined
    Promise.resolve(createSessionRef.current(recordedCwd, String(root)))
      .then(async (childId) => {
        const session = {
          id: `s${Date.now()}`,
          sessionId: String(childId),
          parentSessionId: null,
          parentTurn: null,
          forkTurn: 0,
          forkSeq: null,
          turns: [],
        }
        const next = { ...currentDoc, sessions: [...(currentDoc?.sessions ?? []), session], updatedAt: Date.now() }
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        try {
          await saveDocRef.current(root, next)
        } catch (error) {
          /* The fresh session must not outlive its document entry: archive it
             so a failed write cannot leave an orphaned session behind. */
          try { await archiveSessionRef.current(String(childId)) } catch { /* best effort */ }
          setDoc(prev => (prev === next ? currentDoc : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(currentDoc)
          throw error
        }
        if (!mountedRef.current) return
        /* Open the new session into chat so the next message starts it. */
        openSessionRef.current(String(childId))
      })
      .then(() => {
        if (!mountedRef.current) return
        showNotice(translate('mindmap.sessionCreated'))
        mindmapRegistry.markDirty()
      })
      .catch((error) => {
        if (mountedRef.current) setForkError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        forkingRef.current = false
        savingRef.current = false
        if (mountedRef.current) setForking(false)
      })
  }, [doc, forking, rootId, showNotice])

  /* Click a node: the root node creates a NEW top-level session; a head node
     switches to its session; a card switches (parked tail / streaming / empty
     placeholder) or forks a nested session (intermediate card, or the last
     completed card of a session that is CURRENTLY generating — its real tail
     is the streaming card). The new session joins the SAME document — never a
     new mind map — and stays hidden from the sidebar list. */
  const openCard = useCallback((node) => {
    if (node === undefined || forking) return
    /* Single source of truth for the click outcome: the same decision tree
       the hover hint uses (mindmapCardClickAction), so the hint can never
       drift from the real behavior. 'new' creates a top-level session at the
       root node; 'switch' opens the node's own session (head / streaming /
       empty placeholder / parked tail); 'fork' branches a new session at this
       card's turn. */
    const action = mindmapCardClickAction(node, doc, runningFamilyIds)
    if (action === 'new') addRootSession()
    else if (action === 'switch') openBranch(node.sessionId)
    else if (action === 'fork') forkBranchAt(node.sessionId, node.turn)
  }, [doc, forking, runningFamilyIds, forkBranchAt, openBranch, addRootSession])

  /* Right-click a node: remember WHICH node so the menu can rename a session
     (head / card) or delete a card; the root node offers no menu (the toolbar
     carries 归档整个导图). */
  const openCardMenu = useCallback((entry, x, y) => {
    if (entry.kind === 'root') {
      /* Root menu: choose the workspace new sessions land in (from the doc's
         workspaceCwd) + archive the whole map. The workspace list is fetched
         synchronously from the host action face. */
      const raw = listWorkspacesRef.current?.()
      const items = Array.isArray(raw) ? raw : []
      const current = (typeof doc?.workspaceCwd === 'string' && doc.workspaceCwd !== '') ? doc.workspaceCwd : ''
      setMenu({ kind: 'root', workspaces: items, current, x, y })
      return
    }
    if (entry.kind === 'head') {
      setMenu({
        kind: 'head',
        sessionId: String(entry.sessionId),
        sessionTitle: (list.titles[String(entry.sessionId)] ?? ''),
        x, y,
      })
      return
    }
    setMenu({
      kind: 'card',
      sessionId: String(entry.sessionId),
      sessionTitle: (list.titles[String(entry.sessionId)] ?? ''),
      question: entry.empty ? undefined : String(entry.turn?.user ?? ''),
      turnSeq: entry.empty ? undefined : Number(entry.turn?.seq),
      turnN: entry.empty ? undefined : Number(entry.turn?.n),
      empty: entry.empty === true,
      x, y,
    })
  }, [doc, list])
  const closeMenu = useCallback(() => { setMenu(null) }, [])
  useEffect(() => {
    if (menu === null) return undefined
    const onPointerDown = event => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      closeMenu()
    }
    const onKeyDown = event => { if (event.key === 'Escape') closeMenu() }
    const onScroll = event => { closeMenu() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu, closeMenu])

  const startRename = useCallback(() => {
    if (menu === null) return
    setMenu(null)
    setRenameError(null)
    setRenameTarget({ sessionId: menu.sessionId, title: list.titles[menu.sessionId] ?? '' })
  }, [menu, list])
  const closeRename = useCallback(() => {
    if (renameBusy) return
    setRenameTarget(null)
    setRenameError(null)
  }, [renameBusy])
  const confirmRename = useCallback(() => {
    if (renameBusy || renameTarget === null) return
    const trimmed = renameTarget.title.trim()
    if (trimmed === '') return
    setRenameBusy(true)
    setRenameError(null)
    Promise.resolve(renameSessionRef.current(renameTarget.sessionId, trimmed))
      .then(() => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameTarget(null)
        showNotice(translate('mindmap.renamed'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameError(error instanceof Error ? error.message : String(error))
      })
  }, [renameBusy, renameTarget, showNotice])

  /* Pick the workspace (from the root node's right-click menu) new top-level
     sessions created by clicking the root node will land in. Persisted to the
     doc's workspaceCwd; '' clears the choice (ungrouped). */
  const selectWorkspace = useCallback((cwd, title) => {
    if (menu === null || menu.kind !== 'root' || doc === null || rootId === null) return
    setMenu(null)
    const next = { ...doc, workspaceCwd: cwd, updatedAt: Date.now() }
    savingRef.current = true
    setDoc(next)
    lastFingerprintRef.current = mindmapDocFingerprint(next)
    Promise.resolve(saveDocRef.current(String(rootId), next))
      .then(() => {
        if (!mountedRef.current) return
        mindmapRegistry.markDirty()
        showNotice(cwd === ''
          ? translate('mindmap.workspace.cleared')
          : translate('mindmap.workspace.set', { name: title ?? cwd }))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setDoc(prev => (prev === next ? doc : prev))
        lastFingerprintRef.current = mindmapDocFingerprint(doc)
        showNoticeError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { savingRef.current = false })
  }, [doc, menu, rootId, showNotice, showNoticeError])

  /* Archive ONE session branch (right-click a session head): archive the
     session + its whole subtree and remove it from the doc. Re-anchors when
     the archived session was the doc's anchor; blocked when it would empty
     the map (use 归档整个导图 instead). */
  const startArchiveBranch = useCallback(() => {
    if (menu === null || menu.kind !== 'head') return
    const plan = mindmapDeletePlan(doc, String(menu.sessionId), undefined, true)
    setMenu(null)
    setArchiveBranchError(null)
    if (plan !== null && plan.lastSession === true) {
      showNoticeError(translate('mindmap.delete.lastSession'))
      return
    }
    setArchiveBranchTarget({
      sessionId: String(menu.sessionId),
      label: menu.sessionTitle || translate('mindmap.session.untitled'),
      willArchiveCurrent: plan !== null && (plan.archiveIds ?? []).includes(String(sessionId)),
    })
  }, [doc, menu, sessionId, showNoticeError])
  const closeArchiveBranch = useCallback(() => {
    if (archiveBranchBusy) return
    setArchiveBranchTarget(null)
    setArchiveBranchError(null)
  }, [archiveBranchBusy])
  const confirmArchiveBranch = useCallback(() => {
    if (archiveBranchBusy || archiveBranchTarget === null) return
    const root = rootId
    const currentDoc = doc
    if (root === null || currentDoc === null) return
    const plan = mindmapDeletePlan(currentDoc, archiveBranchTarget.sessionId, undefined, true)
    if (plan === null || plan.lastSession === true) {
      setArchiveBranchError(translate('mindmap.delete.lastSession'))
      return
    }
    setArchiveBranchBusy(true)
    setArchiveBranchError(null)
    savingRef.current = true
    const next = { ...currentDoc, sessions: plan.sessions, next: plan.next, updatedAt: Date.now() }
    /* Re-anchor when the archived session was the anchor (the doc file moves
       via prevSessionId). */
    let saveRoot = String(root)
    let prevRoot = undefined
    if (!next.sessions.some(s => String(s?.sessionId) === String(saveRoot))) {
      const anchor = next.sessions[0]?.sessionId
      if (anchor !== undefined && anchor !== null && anchor !== '') {
        next.rootSessionId = String(anchor)
        saveRoot = String(anchor)
        prevRoot = String(root)
      }
    }
    setDoc(next)
    lastFingerprintRef.current = mindmapDocFingerprint(next)
    Promise.resolve(saveDocRef.current(saveRoot, next, undefined, prevRoot))
      .then(() => Promise.all(plan.archiveIds.map(id => archiveSessionRef.current(String(id)).catch(() => {}))))
      .then(() => {
        if (!mountedRef.current) return
        if (String(saveRoot) !== String(root)) setRootId(String(saveRoot))
        setArchiveBranchTarget(null)
        mindmapRegistry.markDirty()
        /* If the current chat session was archived, switch to the (re-anchored)
           root so the view is never left on a dead session. */
        if ((plan.archiveIds ?? []).includes(String(sessionId))) openSessionRef.current(String(saveRoot))
        showNotice(translate('mindmap.branchArchived'))
      })
      .catch((error) => {
        if (mountedRef.current) {
          setDoc(prev => (prev === next ? currentDoc : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(currentDoc)
          setArchiveBranchError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        savingRef.current = false
        if (mountedRef.current) setArchiveBranchBusy(false)
      })
  }, [archiveBranchBusy, archiveBranchTarget, doc, rootId, sessionId, showNotice])

  const startArchiveAll = useCallback(() => {
    setArchiveError(null)
    setArchiveTarget({
      title: doc?.rootTitle
        || (rootId !== null ? (list.titles[rootId] ?? '') : '')
        || '',
    })
  }, [doc, list, rootId])
  const closeArchive = useCallback(() => {
    if (archiveBusy) return
    setArchiveTarget(null)
    setArchiveError(null)
  }, [archiveBusy])
  const confirmArchive = useCallback(() => {
    if (archiveBusy || archiveTarget === null) return
    setArchiveBusy(true)
    setArchiveError(null)
    savingRef.current = true
    const run = async () => {
      const root = rootId
      const ids = [root]
      for (const s of doc?.sessions ?? []) ids.push(s?.sessionId)
      const unique = [...new Set(ids)].filter(id => id !== undefined && id !== null && id !== '')
      if (unique.includes(String(sessionId))) openSessionRef.current(root)
      for (const id of unique) await archiveSessionRef.current(String(id))
      if (root !== null && root !== undefined) await deleteDocRef.current(String(root))
      mindmapRegistry.markDirty()
      /* The document is gone: close the floating window instead of leaving
         a stale map (a later sync could otherwise resurrect the doc from
         the root's log). */
      mindmapOverlayStore.close()
    }
    run()
      .then(() => {
        if (!mountedRef.current) return
        setArchiveBusy(false)
        setArchiveTarget(null)
        showNotice(translate('mindmap.archivedAll'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setArchiveBusy(false)
        setArchiveError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { savingRef.current = false })
  }, [archiveBusy, archiveTarget, doc, rootId, sessionId, showNotice])

  const startDelete = useCallback(() => {
    if (menu === null || menu.kind !== 'card') return
    /* Pre-compute the plan so the dialog can warn when the CURRENT session is
       one of the pruned subtree sessions (it will be archived and the view
       switched away). */
    const plan = mindmapDeletePlan(doc, String(menu.sessionId), menu.turnSeq, menu.empty === true)
    setMenu(null)
    setDeleteError(null)
    setDeleteTarget({
      sessionId: String(menu.sessionId),
      turnSeq: menu.turnSeq,
      empty: menu.empty === true,
      label: menu.empty
        ? translate('mindmap.pending')
        : mindmapClip(String(menu.question ?? menu.sessionTitle ?? ''), 20),
      /* The current session is warned when it will be archived: a pruned
         subtree session, or the replaced session of a truncation. */
      willArchiveCurrent: plan !== null && plan.lastSession !== true && (
        (plan.archiveIds ?? []).includes(String(sessionId))
        || (plan.replaced !== null && String(plan.replaced.sessionId) === String(sessionId))),
    })
  }, [doc, menu, sessionId])
  const closeDelete = useCallback(() => {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteError(null)
  }, [deleteBusy])
  /* Escape closes the archive / delete dialogs (rename and the context menu
     already handle their own). The overlay's own Escape handler defers while
     a .dsh-ws-dialog-backdrop is in the DOM, so without this the key would do
     nothing while one of these dialogs is open. */
  useEffect(() => {
    if (archiveTarget === null && deleteTarget === null && archiveBranchTarget === null) return undefined
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      closeArchive()
      closeDelete()
      closeArchiveBranch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [archiveTarget, closeArchive, closeDelete, deleteTarget, archiveBranchTarget, closeArchiveBranch])
  const confirmDelete = useCallback(() => {
    if (deleteBusy || deleteTarget === null) return
    const root = rootId
    const currentDoc = doc
    if (root === null || currentDoc === null) return
    const plan = mindmapDeletePlan(currentDoc, deleteTarget.sessionId, deleteTarget.turnSeq, deleteTarget.empty)
    if (plan === null) { setDeleteError(translate('mindmap.delete.missing')); return }
    if (plan.lastSession === true) { setDeleteError(translate('mindmap.delete.lastSession')); return }
    setDeleteBusy(true)
    setDeleteError(null)
    savingRef.current = true
    let forkedChildId = null
    const next = { ...currentDoc }
    /* A truncation of the ANCHOR session makes the fork child the doc's new
       root (and the map file moves to it): it must not get the branch " ›"
       suffix (forkAt renames branch children to it), so the child is told it
       is replacing the root. A whole-session removal of the anchor re-anchors
       the doc to the first remaining session. Both retire the old root's doc
       file via prevSessionId. */
    const isRootReplacement = plan.replaced !== null && String(plan.replaced.sessionId) === String(root)
    Promise.resolve(
      plan.replaced === null
        ? null
        : forkAtRef.current(String(plan.replaced.sessionId), plan.replaced.forkAt, isRootReplacement))
      .then(async (childId) => {
        if (plan.replaced !== null) {
          /* A truncation fork succeeded: swap the replaced session's entry to
             the fork child. The kept cards keep their display numbers (the
             fork child's seed carries the same turn/end seqs), and every
             surviving session that hung off the replaced session re-anchors
             to it. */
          if (childId === null || childId === undefined) throw new Error(translate('mindmap.delete.missing'))
          forkedChildId = String(childId)
          const replacedId = String(plan.replaced.sessionId)
          next.sessions = plan.sessions.map(s =>
            String(s?.sessionId) === replacedId ? { ...s, sessionId: forkedChildId } : s)
          next.sessions = next.sessions.map(s =>
            String(s?.parentSessionId) === replacedId ? { ...s, parentSessionId: forkedChildId } : s)
          if (isRootReplacement) next.rootSessionId = forkedChildId
          /* No tombstones: the truncated session's log simply lacks the
             removed turns and the old session (plus every pruned subtree
             session) is archived, so nothing is recorded about which turns
             were cut. A failed archive may legitimately resurrect the old
             session or leak a pruned session into the sidebar later (ACCEPTED
             behavior — see docs/mindmap-notes.md). */
        } else {
          /* Whole-session removal: prune the session entry; the session (and
             its subtree) is archived. A failed archive may resurrect the
             placeholder later (ACCEPTED behavior). */
          next.sessions = plan.sessions
        }
        /* Re-anchor when the anchor session itself was removed. */
        let saveRoot = String(root)
        let prevRoot = undefined
        if (!next.sessions.some(s => String(s?.sessionId) === String(saveRoot))) {
          const anchor = next.sessions[0]?.sessionId
          if (anchor !== undefined && anchor !== null && anchor !== '') {
            next.rootSessionId = String(anchor)
            saveRoot = String(anchor)
            prevRoot = String(root)
          }
        }
        next.next = plan.next
        next.updatedAt = Date.now()
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        /* A root replacement retires the old root's doc file in the SAME
           request (the Host writes the new doc and leaves an alias stub at
           the old path), so no stale doc can split the family. */
        await saveDocRef.current(saveRoot, next, undefined, prevRoot)
        /* Archive the pruned subtree sessions AND the replaced session (the
           old session, whose full log now lives only in the archive). */
        const archiveIds = [...plan.archiveIds]
        if (plan.replaced !== null) archiveIds.push(String(plan.replaced.sessionId))
        await Promise.all(archiveIds.map(id => archiveSessionRef.current(String(id)).catch(() => {})))
        if (!mountedRef.current) return
        if (String(saveRoot) !== String(root)) setRootId(String(saveRoot))
        /* Close the dialog before the notice and any session switch. */
        setDeleteTarget(null)
        mindmapRegistry.markDirty()
        /* Switch the chat (and the map highlight) to the truncated session,
           or back to the root when the current one was archived. */
        if (forkedChildId !== null) {
          openSessionRef.current(forkedChildId)
        } else if ((plan.archiveIds ?? []).includes(String(sessionId))) {
          openSessionRef.current(String(saveRoot))
        }
        showNotice(forkedChildId !== null ? translate('mindmap.truncated') : translate('mindmap.deleted'))
      })
      .catch((error) => {
        /* Roll the in-memory doc back; nothing was archived yet. A fork that
           already happened but whose doc write failed must not outlive the
           document: archive the freshly forked (empty) child. The rollback is
           identity-checked (like forkBranchAt) so a doc advanced by a
           concurrent sync mid-operation is preserved instead of reverted. */
        if (mountedRef.current) {
          setDoc(prev => (prev === next ? currentDoc : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(currentDoc)
          setDeleteError(error instanceof Error ? error.message : String(error))
        }
        if (forkedChildId !== null) archiveSessionRef.current(forkedChildId).catch(() => {})
      })
      .finally(() => {
        savingRef.current = false
        if (mountedRef.current) setDeleteBusy(false)
      })
  }, [deleteBusy, deleteTarget, doc, rootId, sessionId, showNotice])

  if (phase.status === 'error') {
    return h('div', { className: 'dsh-ws-mindmap dsh-ws-mindmap-status' },
      h('div', { className: 'dsh-ws-mindmap-error' }, translate('mindmap.error', { message: phase.message ?? '' })))
  }
  if (phase.status === 'loading') {
    return h('div', { className: 'dsh-ws-mindmap dsh-ws-mindmap-status' },
      h('div', { className: 'dsh-ws-mindmap-loading' }, translate('mindmap.loading')))
  }
  if (phase.status === 'empty' || layout.nodes.length === 0) {
    return h('div', { className: 'dsh-ws-mindmap dsh-ws-mindmap-status' },
      h('div', { className: 'dsh-ws-mindmap-empty' }, translate('mindmap.empty')))
  }

  /* The map's header shows the mind map's OWN title (doc.rootTitle), which is
     independent of the root session's title after a sidebar rename; the
     session title is only the fallback when the doc has none. */
  const rootTitle = doc?.rootTitle
    || (rootId !== null && rootId !== undefined ? (list.titles[rootId] ?? '') : '')
    || ''
  const { edges: edgeEdges, streamingEntries } = edgeView

  const nodeViews = layout.nodes.map((entry) => {
    const isStreaming = entry.streaming === true
    const title = list.titles[String(entry.sessionId)] || translate('mindmap.session.untitled')
    const isRunning = runningFamilyIds.includes(String(entry.sessionId))
    /* Ring: the streaming card and its parent node (card or head) both wear
       the pair's flowing gradient border. A node that is the parent of several
       streaming cards (two sessions forked at it, both generating) takes the
       first pair's palette. */
    let ringPalette = undefined
    if (isStreaming) {
      const info = streamingEntries.find(s => s.entry.key === entry.key)
      ringPalette = info?.palette
    } else {
      const info = streamingEntries.find(s => s.parentKey === entry.key)
      ringPalette = info?.palette
    }
    /* Single source of truth for what this node IS / does: the same decision
       tree as openCard and the hover hint. The click action is computed once
       and drives BOTH the hover hint ('fork' → 点击分支 / 'switch' → 点击跳转)
       and the always-visible capsule (fork glyph "分支" vs. end chip "末端"),
       so the hint and the chip can never drift apart. */
    const clickAction = mindmapCardClickAction(entry, doc, runningFamilyIds)
    const common = {
      key: entry.key,
      entry,
      isCurrent: entry.key === currentKey,
      isAncestor: trace.ancestorSet.has(entry.key),
      isHoverAncestor: hoverTrace.ancestorSet.has(entry.key),
      isHover: entry.key === hoverKey,
      hintAction: entry.key === hoverKey ? clickAction : undefined,
      /* End-of-branch: click jumps (switch) instead of forking — the capsule
         chip flips from the fork glyph "分支" to the terminal "末端". */
      isEnd: clickAction === 'switch',
      ringPalette,
      onOpen: openCard,
      onHover: setHoverKey,
    }
    if (entry.kind === 'root') {
      return h(MindMapRootNode, { ...common, onMenu: openCardMenu })
    }
    if (entry.kind === 'head') {
      return h(MindMapSessionHead, {
        ...common,
        title,
        isRunning,
        onMenu: openCardMenu,
      })
    }
    return h(MindMapCard, {
      ...common,
      title,
      isStreaming,
      onMenu: openCardMenu,
    })
  })

  const noticeView = notice === null ? null : h('div', {
    className: notice.error ? 'dsh-ws-mindmap-notice dsh-ws-mindmap-notice-error' : 'dsh-ws-mindmap-notice',
    role: notice.error ? 'alert' : 'status',
  }, notice.text)
  const menuView = menu !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-context-menu' + (menu.kind === 'root' ? ' dsh-ws-context-menu-wide' : ''),
      ref: menuRef,
      role: 'menu',
      style: {
        left: Math.max(4, Math.min(menu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)),
        top: Math.max(4, Math.min(menu.y, window.innerHeight - 92)),
      },
    },
      menu.kind === 'card' ? h(Fragment, null,
        h('button', { className: 'dsh-ws-context-item', onClick: startRename, role: 'menuitem', title: translate('mindmap.menu.rename'), type: 'button' }, translate('mindmap.menu.rename')),
        h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
        h('button', { className: 'dsh-ws-context-item dsh-ws-context-item-danger', onClick: startDelete, role: 'menuitem', title: translate('mindmap.menu.deleteCard'), type: 'button' }, translate('mindmap.menu.deleteCard')))
        : menu.kind === 'head' ? h(Fragment, null,
          h('button', { className: 'dsh-ws-context-item', onClick: startRename, role: 'menuitem', title: translate('mindmap.menu.rename'), type: 'button' }, translate('mindmap.menu.rename')),
          h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
          h('button', { className: 'dsh-ws-context-item dsh-ws-context-item-danger', onClick: startArchiveBranch, role: 'menuitem', title: translate('mindmap.menu.archiveBranch'), type: 'button' }, translate('mindmap.menu.archiveBranch')))
          : h(Fragment, null,
            h('div', { className: 'dsh-ws-context-label' }, translate('mindmap.workspace.title')),
            (menu.workspaces ?? []).map((w) => {
              const isCurrent = typeof w?.path === 'string' && w.path !== '' && w.path === menu.current
              return h('button', {
                className: 'dsh-ws-context-item dsh-ws-context-item-check',
                key: w?.id ?? w?.path ?? 'ws',
                onClick: () => selectWorkspace(typeof w?.path === 'string' ? w.path : '', w?.title ?? w?.path ?? ''),
                role: 'menuitem',
                title: translate('mindmap.workspace.set', { name: w?.title ?? w?.path ?? '' }),
                type: 'button',
              },
                h('span', { className: 'dsh-ws-context-item-text' }, w?.title ?? w?.path ?? ''),
                isCurrent ? h('span', { className: 'dsh-ws-context-item-check-mark' }, '✓') : null)
            }),
            h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
            h('button', {
              className: 'dsh-ws-context-item' + (menu.current === '' ? ' dsh-ws-context-item-check' : ''),
              onClick: () => selectWorkspace('', ''),
              role: 'menuitem',
              title: translate('mindmap.workspace.none'),
              type: 'button',
            },
              h('span', { className: 'dsh-ws-context-item-text' }, translate('mindmap.workspace.none')),
              menu.current === '' ? h('span', { className: 'dsh-ws-context-item-check-mark' }, '✓') : null),
            h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
            h('button', { className: 'dsh-ws-context-item dsh-ws-context-item-danger', onClick: startArchiveAll, role: 'menuitem', title: translate('mindmap.menu.archiveAll'), type: 'button' }, translate('mindmap.menu.archiveAll')))),
    document.body,
  ) : null
  const renameView = renameTarget !== null ? h(SessionRenameDialog, {
    busy: renameBusy,
    draft: renameTarget.title,
    error: renameError,
    onCancel: closeRename,
    onConfirm: confirmRename,
    onDraft: value => { setRenameError(null); setRenameTarget(t => t === null ? t : { ...t, title: value }) },
    title: translate('mindmap.rename.title'),
  }) : null
  const archiveView = archiveTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !archiveBusy) closeArchive() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog', role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.menu.archiveAll')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: archiveBusy, onClick: closeArchive, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' },
          translate('mindmap.archiveAll.message', { name: archiveTarget.title })),
        archiveError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, archiveError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBusy, onClick: closeArchive, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBusy, onClick: confirmArchive, type: 'button' }, archiveBusy ? translate('dialog.processing') : translate('mindmap.archive.action')))))
    : null
  const deleteView = deleteTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !deleteBusy) closeDelete() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog', role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.delete.title')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: deleteBusy, onClick: closeDelete, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.delete.message', { name: deleteTarget.label })),
        deleteTarget.willArchiveCurrent ? h('div', { className: 'dsh-ws-dialog-warning', role: 'alert' }, translate('mindmap.delete.current')) : null,
        deleteError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, deleteError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: deleteBusy, onClick: closeDelete, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: deleteBusy, onClick: confirmDelete, type: 'button' }, deleteBusy ? translate('dialog.processing') : translate('mindmap.delete.action')))))
    : null
  const archiveBranchView = archiveBranchTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !archiveBranchBusy) closeArchiveBranch() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-mindmap-confirm-dialog', role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.archiveBranch.title')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: archiveBranchBusy, onClick: closeArchiveBranch, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.archiveBranch.message', { name: archiveBranchTarget.label })),
        archiveBranchTarget.willArchiveCurrent ? h('div', { className: 'dsh-ws-dialog-warning', role: 'alert' }, translate('mindmap.delete.current')) : null,
        archiveBranchError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, archiveBranchError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBranchBusy, onClick: closeArchiveBranch, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBranchBusy, onClick: confirmArchiveBranch, type: 'button' }, archiveBranchBusy ? translate('dialog.processing') : translate('mindmap.archiveBranch.action')))))
    : null

  return h(Fragment, null,
    h('div', { className: 'dsh-ws-mindmap', 'data-conversation-composer-overlay': '' },
      h('div', { className: 'dsh-ws-mindmap-toolbar' },
        h('button', {
          'aria-pressed': overlay.scope === 'sidebar' ? 'true' : 'false',
          className: 'dsh-ws-mindmap-toolbar-button dsh-ws-mindmap-scope-toggle',
          onClick: () => { mindmapOverlayStore.toggleScope() },
          title: translate(previewRight ? 'mindmap.scope.title.right' : 'mindmap.scope.title'),
          type: 'button',
        }, translate(overlay.scope === 'sidebar'
          ? (previewRight ? 'mindmap.scope.sidebar.right' : 'mindmap.scope.sidebar')
          : (previewRight ? 'mindmap.scope.full.right' : 'mindmap.scope.full'))),
        h('button', { className: 'dsh-ws-mindmap-toolbar-button', onClick: restoreView, title: translate('mindmap.view.restoreTitle'), type: 'button' }, translate('mindmap.view.restore')),
        h('button', { className: 'dsh-ws-mindmap-toolbar-button', onClick: startArchiveAll, title: translate('mindmap.menu.archiveAll'), type: 'button' }, translate('mindmap.menu.archiveAll'))),
      h('div', { className: 'dsh-ws-mindmap-bar' },
        translate('mindmap.rootLabel'),
        h('span', { className: 'dsh-ws-mindmap-bar-title' }, rootTitle)),
      noticeView,
      forkError !== null ? h('div', { className: 'dsh-ws-mindmap-fork-error' }, translate('mindmap.forkFailed', { message: forkError })) : null,
      h('div', { className: 'dsh-ws-mindmap-viewport', 'data-dragging': dragging ? '' : undefined, onPointerCancel: endPan, onPointerDown: startPan, onPointerMove: movePan, onPointerUp: endPan, ref: viewportRef },
        h('div', { className: 'dsh-ws-mindmap-canvas', ref: canvasRef, style: { height: layout.height, width: layout.width } },
          h('svg', { className: 'dsh-ws-mindmap-edges', width: layout.width, height: layout.height },
            h('defs', null,
              streamingEntries.map((item) => item.bbox === undefined
                ? null
                : h('linearGradient', {
                  gradientUnits: 'userSpaceOnUse',
                  id: item.gradId,
                  key: item.gradId,
                  x1: item.bbox.x1,
                  x2: item.bbox.x2,
                  y1: item.bbox.y1,
                  y2: item.bbox.y2,
                },
                  item.palette.map((color, i) => h('stop', {
                    key: i,
                    offset: `${i * 50}%`,
                    stopColor: color,
                  }))))),
            edgeEdges.map((edge, index) => {
              const flow = edge.flow
              if (flow === undefined) {
                return h('path', {
                  className: 'dsh-ws-mindmap-edge'
                    + (edge.mount === true ? ' dsh-ws-mindmap-edge-mount' : '')
                    + (trace.activeEdgeKeys.has(`${edge.from}\u0000${edge.to}`) ? ' dsh-ws-mindmap-edge-active' : '')
                    + (hoverTrace.activeEdgeKeys.has(`${edge.from}\u0000${edge.to}`) ? ' dsh-ws-mindmap-edge-hover-active' : ''),
                  d: edge.d,
                  key: index,
                })
              }
              /* A flowing pair edge renders as a solid underlay (palette c1 —
                 the connection is always visibly colored even if the gradient
                 reference cannot resolve) plus the animated gradient dashes on
                 top. Both strokes are inline styles, which beat every CSS
                 stroke rule (and never fall back to the default gray). Neither
                 the selection (blue) nor the hover (amber) trace class is ever
                 added here, so this edge is immune to both effects — the
                 flowing look is the stronger signal on the pair. */
              return h(Fragment, { key: index },
                h('path', {
                  className: 'dsh-ws-mindmap-edge dsh-ws-mindmap-edge-flow-under',
                  d: edge.d,
                  style: { stroke: flow.palette[0] },
                }),
                h('path', {
                  className: 'dsh-ws-mindmap-edge dsh-ws-mindmap-edge-flow',
                  d: edge.d,
                  style: { stroke: `url(#${flow.gradId})` },
                }))
            })),
          nodeViews))),
    menuView,
    renameView,
    archiveView,
    archiveBranchView,
    deleteView)
}

/* Hides mind-map family sessions (root + every fork descendant) from the
   sidebar list; each mind map is shown by its self-drawn entry instead.
   Rows are matched by title in the workspace browser (role="treeitem"),
   rescanned on every DOM mutation and mind-map index change so a freshly
   converted session hides as soon as its doc exists. A title hides a row
   only when every session with that title is hidden (a visible non-mindmap
   session sharing it keeps it visible); archived sessions add no titles and
   the always-running clearing pass self-heals wrongly hidden rows. */
function installMindmapBranchHider(getSessionList, getArchivedSessionIds) {
  if (typeof document === 'undefined') return () => {}
  let timer = 0
  let lastRun = 0
  const apply = () => {
    timer = 0
    lastRun = Date.now()
    /* No mind-map docs: skip the session walk (the observer fires on every
       body mutation, so this keeps idle streaming from re-scanning the whole
       sidebar), but still clear any previously applied hidden class so rows
       self-heal the moment the last doc disappears. */
    if (mindmapRegistry.getDocs().length === 0) {
      const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
      if (browser !== null) {
        for (const row of browser.querySelectorAll('[role="treeitem"].dsh-ws-mindmap-hidden-row')) {
          row.classList.remove('dsh-ws-mindmap-hidden-row')
        }
      }
      return
    }
    const list = getSessionList()
    const archived = new Set((getArchivedSessionIds?.() ?? []).map(String))
    const byTitle = new Map()
    for (const id of list.ids) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      if (summary.origin === 'subagent' || summary.blank) continue
      if (archived.has(String(id))) continue
      const title = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
      if (title === '') continue
      if (!byTitle.has(title)) byTitle.set(title, { hidden: 0, visible: 0 })
      const entry = byTitle.get(title)
      if (isMindmapFamilySession(list, id)) entry.hidden += 1
      else entry.visible += 1
    }
    const hideTitles = new Set()
    for (const [title, entry] of byTitle) {
      if (entry.hidden > 0 && entry.visible === 0) hideTitles.add(title)
    }
    const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
    if (browser === null) return
    for (const row of browser.querySelectorAll('[role="treeitem"]')) {
      // Workspace group headers expose aria-expanded; they are NOT session
      // rows and must never be hidden, even when a group title equals a
      // family title (the sidebar context-menu matcher applies the same rule).
      if (row.hasAttribute('aria-expanded')) continue
      // Match the row's title by its title span, not any leaf span: message
      // count badges and empty spacer spans would otherwise be caught by a
      // numeric or empty family title.
      const titleSpan = row.querySelector('span[class*="title"]')
      const matched = titleSpan !== null && hideTitles.has((titleSpan.textContent ?? '').trim())
      row.classList.toggle('dsh-ws-mindmap-hidden-row', matched)
    }
  }
  /* Time throttle: the observer fires per DOM mutation (streaming churn), and
     a rAF-only coalesce would still scan up to 60×/s. One scan per throttle
     window keeps the sidebar hiding fresh without global jank. */
  const schedule = () => {
    if (timer !== 0) return
    const wait = Math.max(0, MINDMAP_HIDER_THROTTLE_MS - (Date.now() - lastRun))
    timer = window.setTimeout(() => { timer = 0; apply() }, wait)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const unsubscribe = mindmapRegistry.subscribe(schedule)
  apply()
  return () => {
    observer.disconnect()
    unsubscribe()
    if (timer !== 0) { clearTimeout(timer); timer = 0 }
    /* Restore every row this hider touched so a hot reload / uninstall cannot
       leave the hidden class stuck on the DOM. */
    const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
    if (browser !== null) {
      for (const row of browser.querySelectorAll('[role="treeitem"].dsh-ws-mindmap-hidden-row')) {
        row.classList.remove('dsh-ws-mindmap-hidden-row')
      }
    }
  }
}

/* Whether a session (or any fork ancestor, subagent hops aside) belongs to a
   mind-map family: a documented root/branch or a fork descendant of one. */
function isMindmapFamilySession(list, id) {
  let cursor = String(id)
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    if (mindmapRegistry.isRoot(cursor) || mindmapRegistry.isBranch(cursor)) return true
    const summary = list.byId[cursor]
    if (summary === undefined) break
    if (summary.origin === 'subagent') { cursor = summary.parentId; continue }
    cursor = summary.parentId
  }
  return false
}

const MINDMAP_ICON = h('g', { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5 },
  h('circle', { cx: 5, cy: 5, r: 2 }),
  h('circle', { cx: 19, cy: 5, r: 2 }),
  h('circle', { cx: 12, cy: 19, r: 2 }),
  h('path', { d: 'M7 5h10' }),
  h('path', { d: 'M5 7l7 10' }),
  h('path', { d: 'M19 7l-7 10' }))

/* Self-drawn mind-map entries in the sidebar, replacing the hidden ordinary
   session rows. Rendered per workspace group (groupTitle set): each panel
   shows only docs whose root session belongs to that group's workspace; with
   groupTitle undefined (flat/search fallback) every doc is shown. Clicking an
   entry opens the root session and the floating mind-map overlay. Entries can
   be dragged to reorder (persisted per group in localStorage) and have a
   right-click menu (rename the root session / reveal its workspace in the OS
   explorer). */
const MINDMAP_ORDER_ALL_KEY = '__all__'
function MindmapSessionsPanel({ useSessions, useWorkspaces, groupTitle, openSession, revealSession }) {
  useMindmapRegistry()
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const menuRef = useRef(null)
  const lastDragEndRef = useRef(0)
  const [dragId, setDragId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState(null)
  const docs = mindmapRegistry.getDocs()
  const entries = docs.filter((doc) => {
    if (list.byId[String(doc.sessionId)] === undefined) return false
    if (groupTitle === undefined) return true
    const row = list.byId[String(doc.sessionId)]
    const item = workspaces.find(w => (w.sessionIds ?? []).includes(String(doc.sessionId)))
      || (row?.cwd !== undefined ? workspaces.find(w => w.path === row.cwd) : undefined)
    const docTitle = item?.title
    /* A doc whose workspace resolves to a real Host workspace (accounted by
       sessionIds, or a canonical cwd match) appears ONLY under that
       workspace's group, matched by its exact title. */
    if (docTitle !== undefined) return docTitle === groupTitle
    /* A doc with no resolvable workspace (not accounted by any workspace and
       no cwd match) lives in the ungrouped bucket — the group whose title is
       not any real workspace's title (or the flat fallback seat). Exact-match
       grouping is safe here: real workspace group headers render their
       canonical title and the ungrouped bucket the localized label, so a
       resolved doc never falls through to the ungrouped bucket. */
    return !workspaces.some(w => w.title === groupTitle)
  })
  const groupKey = groupTitle === undefined ? MINDMAP_ORDER_ALL_KEY : groupTitle
  /* Apply the persisted per-group order; unknown docs keep their default
     (registry) order at the end. */
  const storedOrder = readMindmapOrder()[groupKey] ?? []
  const orderIndex = new Map(storedOrder.map((id, index) => [String(id), index]))
  const ordered = [...entries].sort((a, b) => {
    const ia = orderIndex.get(String(a.sessionId))
    const ib = orderIndex.get(String(b.sessionId))
    if (ia === undefined && ib === undefined) return 0
    if (ia === undefined) return 1
    if (ib === undefined) return -1
    return ia - ib
  })
  /* In per-group mode an empty group renders nothing so the seat collapses
     (CSS :empty); only the region-area fallback shows the empty-state hint.
     The injected container is the styled seat, so this renders children
     directly (Fragment) instead of a nested .dsh-ws-sidebar-mindmaps div. */
  /* NOTE: the early return below must come AFTER every hook (React #310
     "rendered more hooks than during the previous render" otherwise). */
  useEffect(() => {
    if (contextMenu === null) return undefined
    const close = () => setContextMenu(null)
    const onPointerDown = event => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      close()
    }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    const onScroll = () => close()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [contextMenu])

  if (entries.length === 0 && groupTitle !== undefined) return null

  const commitDrop = () => {
    const sourceId = dragId
    const target = dropTarget
    setDragId(null)
    setDropTarget(null)
    if (sourceId === null || target === null || sourceId === target.id) return
    const ids = ordered.map(doc => String(doc.sessionId))
    const from = ids.indexOf(sourceId)
    if (from === -1) return
    ids.splice(from, 1)
    const to = ids.indexOf(target.id)
    if (to === -1) return
    ids.splice(target.half === 'after' ? to + 1 : to, 0, sourceId)
    const map = readMindmapOrder()
    map[groupKey] = ids
    writeMindmapOrder(map)
  }
  const entryDragOver = (event, sid) => {
    if (dragId === null || dragId === sid) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget(prev => (prev !== null && prev.id === sid && prev.half === half ? prev : { id: sid, half }))
  }
  const listDragOver = (event) => {
    if (dragId === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    if (first === undefined || last === undefined) return
    const rect = event.currentTarget.getBoundingClientRect()
    const target = event.clientY < rect.top + rect.height / 2
      ? { id: String(first.sessionId), half: 'before' }
      : { id: String(last.sessionId), half: 'after' }
    setDropTarget(prev => (prev !== null && prev.id === target.id && prev.half === target.half ? prev : target))
  }

  const startRename = () => {
    if (contextMenu === null) return
    const sid = contextMenu.sessionId
    /* Renaming edits the MIND MAP's own title (doc.rootTitle), independent of
       the root session's title. */
    const doc = docs.find(d => String(d.sessionId) === String(sid))
    const row = list.byId[sid]
    setContextMenu(null)
    setRenameError(null)
    setRenameTarget({ sessionId: sid, title: doc?.rootTitle ?? row?.displayTitle ?? '' })
  }
  const closeRename = () => {
    if (renameBusy) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBusy || renameTarget === null) return
    const trimmed = renameTarget.title.trim()
    if (trimmed === '') return
    setRenameBusy(true)
    setRenameError(null)
    const sid = renameTarget.sessionId
    renameMindmapDoc(sid, trimmed)
      .then(() => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameTarget(null)
        mindmapRegistry.markDirty()
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameError(error instanceof Error ? error.message : String(error))
      })
  }
  const onReveal = () => {
    if (contextMenu === null) return
    const id = contextMenu.sessionId
    setContextMenu(null)
    revealSession(id)
  }

  const menuView = contextMenu !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-context-menu',
      ref: menuRef,
      role: 'menu',
      style: {
        left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)),
        top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 92)),
      },
    },
      h('button', { className: 'dsh-ws-context-item', onClick: startRename, role: 'menuitem', type: 'button' }, translate('context.renameSession')),
      h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
      h('button', { className: 'dsh-ws-context-item', onClick: onReveal, role: 'menuitem', type: 'button' }, translate('context.reveal'))),
    document.body,
  ) : null
  const renameView = renameTarget !== null ? h(SessionRenameDialog, {
    busy: renameBusy,
    draft: renameTarget.title,
    error: renameError,
    onCancel: closeRename,
    onConfirm: confirmRename,
    onDraft: value => { setRenameError(null); setRenameTarget(t => t === null ? t : { ...t, title: value }) },
    title: translate('mindmap.sidebar.renameTitle'),
  }) : null

  return h(Fragment, null,
    entries.length === 0
      ? h('div', { className: 'dsh-ws-sidebar-mindmaps-empty' }, translate('mindmap.sidebar.empty'))
      : h('div', {
        className: 'dsh-ws-sidebar-mindmaps-list',
        onDragLeave: (event) => { if (!(event.currentTarget.contains(event.relatedTarget))) setDropTarget(null) },
        onDragOver: listDragOver,
        onDrop: (event) => { event.preventDefault(); commitDrop() },
      },
        ordered.map(doc => {
          const row = list.byId[String(doc.sessionId)]
          /* The entry shows the mind map's OWN title (doc.rootTitle), not the
             root session's — the two are independent after a rename. */
          const label = doc.rootTitle ?? row?.displayTitle ?? ''
          const count = (doc.branchSessionIds ?? []).length
          const sid = String(doc.sessionId)
          /* Any family member streaming (summary.running flips at generation
             start, no sync wait) spins the entry's icon — the visible signal
             the hidden ordinary rows would have shown. */
          const running = [sid, ...(doc.branchSessionIds ?? [])].some(id => list.byId[id]?.running === true)
          return h('button', {
            className: 'dsh-ws-sidebar-mindmaps-item',
            'data-dragging': dragId === sid ? '' : undefined,
            'data-drop': dropTarget !== null && dropTarget.id === sid ? dropTarget.half : undefined,
            'data-running': running ? '' : undefined,
            draggable: true,
            key: sid,
            /* A genuine drag ends with a click in some engines; suppress the
               click that lands right after a drag so reordering never opens
               the session by accident. */
            onClick: () => {
              if (Date.now() - lastDragEndRef.current < 400) return
              openSession(sid)
            },
            onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ sessionId: sid, x: event.clientX, y: event.clientY }) },
            onDragEnd: () => { lastDragEndRef.current = Date.now(); setDragId(null); setDropTarget(null) },
            onDragOver: (event) => { entryDragOver(event, sid) },
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = 'move'
              try { event.dataTransfer.setData('text/plain', sid) } catch { /* some engines disallow setData during dragstart */ }
              setDragId(sid)
            },
            title: translate('mindmap.sidebar.open'),
            type: 'button',
          },
            h('svg', { 'aria-hidden': true, className: 'dsh-ws-sidebar-mindmaps-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
            h('span', { className: 'dsh-ws-sidebar-mindmaps-label' }, label),
            count > 0 ? h('span', { className: 'dsh-ws-sidebar-mindmaps-count' }, translate('mindmap.sidebar.branches', { n: count })) : null)
        })),
    menuView,
    renameView)
}
/* Sessions the user has converted to a mind map this app session. The doc
   index registry is only refreshed every 5 s, so right after a conversion
   `isMember` is still false: without this set the header button would re-offer
   the convert dialog on the very next click instead of toggling the overlay.
   Entries become redundant the moment the registry catches up and are pruned
   then (see MindmapHeaderButton), so the set only ever holds in-flight
   conversions. */
const mindmapConvertedSessions = new Set()
/* The session-header mind-map button: opens the floating mind-map overlay
   for the current session (the chat stays visible on the right) instead of
   switching to a full-page map. Clicking again (or the overlay's close
   button / Escape) closes the window. On a NORMAL session (not yet a
   mind-map member) the first click asks for confirmation before converting
   it; only on "yes" does the conversion happen — otherwise nothing changes. */
function MindmapHeaderButton({ sessionId }) {
  const overlay = useMindmapOverlay()
  // Track the doc index so isMember sees a fresh conversion (a normal session
  // becoming a mind-map member) without an unrelated re-render, or the button
  // would keep offering the convert dialog after the conversion.
  const registry = useMindmapRegistry()
  const registryVersion = registry.getVersion()
  const [confirmTarget, setConfirmTarget] = useState(null)
  useEffect(() => {
    if (sessionId !== undefined && sessionId !== null && registry.isMember(String(sessionId))) {
      mindmapConvertedSessions.delete(String(sessionId))
    }
  }, [registryVersion, sessionId])
  /* Escape closes the confirm dialog. The overlay's own Escape handler defers
     while any .dsh-ws-dialog-backdrop is in the DOM, so this window listener
     is required while the dialog is open. It sits BEFORE the early return so
     a transition from sessionId===undefined to a defined id does not change
     the hook count (React #310; closeConfirm is used lazily in the effect, so
     its later declaration is safe). */
  useEffect(() => {
    if (confirmTarget === null) return undefined
    const onKeyDown = event => { if (event.key === 'Escape') closeConfirm() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmTarget])
  /* No current session (hero page / transient): nothing to map yet. */
  if (sessionId === undefined || sessionId === null) return null
  const key = String(sessionId)
  const active = overlay.open && String(overlay.sessionId) === key
  /* The background index may be a few seconds behind a fresh conversion, so
     the "is this already a mind map" check uses the last known registry
     membership (roots + documented branches) plus the in-flight conversions
     this session started (see mindmapConvertedSessions). */
  const member = mindmapRegistry.isMember(key) || mindmapConvertedSessions.has(key)
  const label = translate('view.mindmap')
  const onButtonClick = () => {
    /* Once the registry confirms membership, the converted-set entry is
       redundant — drop it so the set only tracks unconfirmed conversions. */
    if (mindmapRegistry.isMember(key)) mindmapConvertedSessions.delete(key)
    /* Already a mind-map member (root or branch): plain open/close toggle. */
    if (member) { mindmapOverlayStore.toggle(key); return }
    /* The overlay is open on this normal session (e.g. an empty session with
       no turns yet, or the registry has not caught up after a conversion):
       the button still acts as a close toggle. */
    if (active) { mindmapOverlayStore.close(); return }
    /* A normal session: ask before converting it into a mind map. */
    setConfirmTarget(key)
  }
  const closeConfirm = () => setConfirmTarget(null)
  const confirmConvert = () => {
    setConfirmTarget(null)
    /* Remember the conversion so the next click toggles instead of re-asking
       until the background doc index catches up (see mindmapConvertedSessions). */
    mindmapConvertedSessions.add(key)
    mindmapOverlayStore.open(key)
  }
  /* Portal the confirm dialog to body: .dsh-ws-chat clips fixed-position
     descendants, so the modal would be cut to the chat column instead of
     covering the viewport (Escape handling lives in the effect above). */
  const confirmView = confirmTarget !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-dialog-backdrop',
      onMouseDown: event => { if (event.target === event.currentTarget) closeConfirm() },
    },
      h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-mindmap-confirm-dialog', role: 'dialog' },
        h('div', { className: 'dsh-ws-dialog-header' },
          h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.confirm.title')),
          h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', onClick: closeConfirm, title: translate('dialog.close'), type: 'button' }, '×')),
        h('div', { className: 'dsh-ws-dialog-body' },
          h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.confirm.message'))),
        h('div', { className: 'dsh-ws-dialog-footer' },
          h('button', { className: 'dsh-ws-text-button dsh-ws-mindmap-confirm-button dsh-ws-mindmap-confirm-cancel', onClick: closeConfirm, type: 'button' }, translate('dialog.cancel')),
          h('button', { className: 'dsh-ws-text-button dsh-ws-mindmap-confirm-button dsh-ws-mindmap-confirm-ok', onClick: confirmConvert, type: 'button' }, translate('mindmap.confirm.action'))))),
    document.body) : null
  return h(Fragment, null,
    h('button', {
      'aria-label': label,
      'aria-pressed': active,
      className: active ? 'dsh-ws-mindmap-header-button dsh-ws-mindmap-header-button-on' : 'dsh-ws-mindmap-header-button',
      onClick: onButtonClick,
      title: label,
      type: 'button',
    },
      h('svg', { 'aria-hidden': true, className: 'dsh-ws-mindmap-header-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
      h('span', { className: 'dsh-ws-mindmap-header-label' }, label)),
    confirmView)
}
/* The sidebar-footer mobile toggle: switches the layout to the centered
   phone column. Entering mobile opens the floating sidebar drawer by default
   so browsing stays reachable; leaving clears the drawer and file-fullscreen
   sub-states. */
function MobileModeToggle(props) {
  const { on } = useMobile()
  const label = translate('mobile.toggle')
  return h('button', {
    'aria-label': label,
    'aria-pressed': on,
    className: 'dsh-ws-mobile-toggle',
    'data-open': on || undefined,
    'data-rail': !props.wide || undefined,
    onClick: () => { setMobile(!on) },
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-ws-mobile-toggle-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('rect', { x: 7, y: 2.5, width: 10, height: 19, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M11 18.5h2', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.6 })),
    props.wide ? h('span', { className: 'dsh-ws-mobile-toggle-label' }, label) : null,
  )
}
/* The whale button that opens/closes the floating sidebar drawer in mobile
   mode (the shared chrome for the session header and the hero overlay). */
function MobileWhaleButton({ open, onToggle }) {
  const label = open ? translate('mobile.sidebarClose') : translate('mobile.sidebarOpen')
  return h('button', {
    'aria-expanded': open,
    'aria-label': label,
    className: open ? 'dsh-ws-mobile-whale dsh-ws-mobile-active' : 'dsh-ws-mobile-whale',
    onClick: onToggle,
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, fill: 'none', height: 18 * 19.04 / 25.16, stroke: 'currentColor', strokeWidth: 1.4, viewBox: '-1 -1 25.16 19.04', width: 18 },
      h('path', { d: FISH })))
}
/* The file-content-browsing button shared by the session header and the hero
   overlay: toggles file-fullscreen mode (setMobileFiles) and shows its active
   state via dsh-ws-mobile-active. */
function MobileFilesButton() {
  const { files } = useMobile()
  return h('button', {
    'aria-label': translate('mobile.files'),
    'aria-pressed': files,
    className: files ? 'dsh-ws-mobile-files dsh-ws-mobile-active' : 'dsh-ws-mobile-files',
    onClick: () => setMobileFiles(!files),
    title: translate('mobile.files'),
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-ws-mobile-files-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.6 }),
      h('path', { d: 'M14 2v6h6', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.6 })))
}
/* The session-header mobile controls: the whale (drawer toggle) plus the
   file-content-browsing button, at the phone column's top-left. CSS hides
   them outside mobile mode. The drawer's outside-click scrim is drawn by
   AppFrame (its sibling), so it always stacks between page and drawer. */
function MobileHeaderControls() {
  const { drawerOpen } = useMobile()
  return h('div', { className: 'dsh-ws-mobile-controls' },
    h(MobileWhaleButton, { onToggle: () => setDrawerOpen(!drawerOpen), open: drawerOpen }),
    h(MobileFilesButton))
}
/* The hero-page whale + file button, rendered in the shell.overlay seat for
   the blank-session hero, where there is no session header. Visible only
   under the mobile gate + hero page (CSS :has gate, mirroring mobile-preview). */
function MobileHeroControls() {
  const { drawerOpen } = useMobile()
  return h('div', { className: 'dsh-ws-mobile-hero' },
    h(MobileWhaleButton, { onToggle: () => setDrawerOpen(!drawerOpen), open: drawerOpen }),
    h(MobileFilesButton))
}
/* The floating mind-map window, rendered by AppFrame while the overlay is
   open. It spans everything left of the chat column (100% − chat width,
   tracked live so resizing the chat reflows the window); on mobile it takes
   the whole screen. The chat stays visible on the right; card clicks inside
   the map switch the conversation to the clicked session. */
function MindmapOverlayHost({ sessionId, useSessions, actions, chatWidth, mobile, previewRight, previewWidth, sidebarWidth, settingsStore }) {
  const overlay = useMindmapOverlay()
  const closeLabel = translate('mindmap.overlay.close')
  /* Scope 'full' (default) spans everything left of the chat column; scope
     'sidebar' narrows the window to just the sidebar column (the file browser
     area is left visible). When the file browser sits on the RIGHT of the
     conversation column, the window switches sides instead: 'sidebar' fills
     the left sidebar, 'full' fills the right file browser, keeping the chat
     column visible and interactive in the middle. On mobile the window is
     always full screen. */
  const rightPanel = !mobile && previewRight === true && overlay.scope === 'full' && previewWidth > 0
  const width = mobile
    ? '100%'
    : rightPanel
      ? `${Math.max(PREVIEW_MIN, previewWidth)}px`
      : previewRight === true
        /* Right-side layout: 'sidebar' fills the left sidebar; with no visible
           file-browser pane there is nothing on the right to fill, so the full
           window stays on the left column too. */
        ? `${Math.max(SIDEBAR_MIN, sidebarWidth)}px`
        : overlay.scope === 'sidebar'
          /* A collapsed sidebar (width 0) must not leave an invisible-but-open
             overlay: keep a usable minimum width in that state. */
          ? `${Math.max(SIDEBAR_MIN, sidebarWidth)}px`
          : `calc(100% - ${Math.max(0, chatWidth)}px)`
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      /* Let an open dialog/context menu inside the map handle Escape first. */
      if (document.querySelector('.dsh-ws-dialog-backdrop, .dsh-ws-context-menu') !== null) return
      mindmapOverlayStore.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return h('div', { className: 'dsh-ws-mindmap-overlay', 'data-side': rightPanel ? 'right' : undefined, style: { width } },
    h('button', {
      'aria-label': closeLabel,
      className: 'dsh-ws-mindmap-overlay-close',
      onClick: () => { mindmapOverlayStore.close() },
      title: closeLabel,
      type: 'button',
    }, '×'),
    h(MindMapView, {
      archiveSession: actions.archiveSession,
      createSession: actions.createSession,
      deleteDoc: actions.deleteDoc,
      forkAt: actions.forkAt,
      listWorkspaces: actions.listWorkspaces,
      loadDoc: actions.loadDoc,
      openSession: id => { actions.openSession(String(id)); mindmapOverlayStore.setSession(String(id)) },
      previewRight: previewRight === true,
      renameSession: actions.renameSession,
      saveDoc: actions.saveDoc,
      sessionId: String(sessionId),
      settingsStore,
      syncDoc: actions.syncDoc,
      useSessions,
    }))
}

function AppFrame(props) {
  const panels = props.useStore(state => state)
  const previewPanels = useSyncExternalStore(props.previewSessionsStore.subscribe, props.previewSessionsStore.getSnapshot)
  const settings = useSyncExternalStore(props.settingsStore.subscribe, props.settingsStore.getSnapshot)
  const panes = useSyncExternalStore(props.explorerPaneStore.subscribe, props.explorerPaneStore.getSnapshot)
  const mobile = useMobile()
  const overlay = useMindmapOverlay()
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
    // Re-mirror when the VALUE or the CEILING changed: the first mount pass
    // uses the 420 fallback (viewport not measured yet), which would otherwise
    // clamp a wider sidebar in the persisted store forever.
    if (sidebarMirrorRef.current?.value !== panels.sidebar || sidebarMirrorRef.current?.max !== sidebarMax) {
      sidebarMirrorRef.current = { value: panels.sidebar, max: sidebarMax }
      props.explorerPaneStore.actions.setSidebar(panels.sidebar, sidebarMax)
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
    const header = section.querySelector('[data-slot="conversation.session.header"]')
    if (header === null) return undefined
    const measure = () => {
      const height = header.getBoundingClientRect().height
      if (height > 0) setMobileHeaderHeight(height)
    }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => { observer.disconnect() }
  }, [currentSession, mobile.files, mobile.on])
  const chatFontScale = clamp(settings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX) / CHAT_FONT_SIZE_DEFAULT
  /* Sidebar mind-map entry icon spin: user speed multiplier (1.5x default times
     the 0.8 s base = 1.2 s per revolution; larger = faster) becomes the
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
  const [sessionContextMenu, setSessionContextMenu] = useState()
  const sessionContextRowRef = useRef(null)
  const sessionMenuRef = useRef(null)
  const [sessionInlineRename, setSessionInlineRename] = useState()
  const [sessionInlineRenameBusy, setSessionInlineRenameBusy] = useState(false)
  const [sessionInlineRenameError, setSessionInlineRenameError] = useState()
  const [sessionNotice, setSessionNotice] = useState()
  const sessionNoticeTimerRef = useRef()
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const [resizing, setResizing] = useState(false)
  const [chatDropActive, setChatDropActive] = useState(false)
  const workspace = useMemo(() => currentSession !== undefined
    ? workspaces.find(item => item.sessionIds.includes(currentSession) || item.path === currentCwd)
    : workspaces.find(item => item.workspaceId === recent),
  [currentCwd, currentSession, recent, workspaces])
  const workspaceId = workspace?.workspaceId
  const publishEditorContext = useCallback((value) => {
    if (currentSession !== undefined) props.publishEditorContext(String(currentSession), value)
  }, [currentSession, props.publishEditorContext])
  useEffect(() => {
    if (currentSession !== undefined) props.activateEditorSession(String(currentSession))
  }, [currentSession, props.activateEditorSession])
  const previewSessionSelection = selectStoredPreviewSession(previewPanels.previewSessions, workspace, currentSession, workspaceId)
  const previewSessionKey = previewSessionSelection.key
  const storedPreviewSession = previewSessionSelection.value
  // Skip a rewrite when this key-set already holds the same snapshot: each
  // write serializes and stores the whole previewSessions value, so identical
  // repeat writes (e.g. a layout effect firing with unchanged state) are pure
  // cost. Keyed per key-set, since switching sessions legitimately writes the
  // same snapshot to a different key-set.
  const lastPersistedSnapshotRef = useRef(new Map())
  const persistPreviewSession = useCallback((value) => {
    // Write the snapshot to every key restore may pick: the current session
    // (highest priority) and the workspace anchor. The selected key joins
    // them only when it IS one of those two (a session that already owns a
    // snapshot, or the workspace itself). When restore fell back to ANOTHER
    // session's snapshot (priority ②), that key is a borrowed template, not a
    // write target: persisting to it would overwrite (or delete, on an empty
    // snapshot) that session's saved tabs.
    const keys = new Set()
    if (currentSession !== undefined) keys.add(String(currentSession))
    if (workspaceId !== undefined) keys.add(String(workspaceId))
    if (previewSessionKey !== undefined
      && (previewSessionKey === String(currentSession) || previewSessionKey === String(workspaceId))) {
      keys.add(previewSessionKey)
    }
    if (keys.size === 0) return
    const keySet = [...keys].sort().join('|')
    const fingerprint = previewSnapshotFingerprint(value)
    if (lastPersistedSnapshotRef.current.get(keySet) === fingerprint) return
    lastPersistedSnapshotRef.current.set(keySet, fingerprint)
    if (lastPersistedSnapshotRef.current.size > 128) lastPersistedSnapshotRef.current.clear()
    for (const key of keys) props.previewSessionsStore.actions.rememberPreviewSession(key, value)
  }, [currentSession, previewSessionKey, props.previewSessionsStore, workspaceId])
  const last = useRef(currentSession)
  const chatDropSuppressed = useRef(false)
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
  /* The floating mind-map window spans everything left of the chat column:
     track the chat column's live width (it changes when the sidebar/preview
     splitters move the grid) so the window reflows with it. */
  const [chatWidth, setChatWidth] = useState(0)
  useLayoutEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    const measure = () => { setChatWidth(section.getBoundingClientRect().width) }
    measure()
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(section)
    return () => { observer.disconnect() }
  }, [])
  // Chat drop mask: track file drags over the chat pane (capture phase,
  // without stopping propagation, so the harness composer still receives the
  // drop and attaches images as usual). The mask covers only the chat pane;
  // the harness's full-viewport mask is hidden by CSS. Enter/leave use a depth
  // counter (Chrome's dragleave has a null relatedTarget, so a contains()
  // check would hide the mask on the first child transition). Closing the mask
  // suppresses it for the current drag until it ends or is dropped.
  useEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    let depth = 0
    const hide = () => {
      depth = 0
      chatDropSuppressed.current = false
      setChatDropActive(false)
    }
    const onDragEnter = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      depth += 1
      setChatDropActive(true)
    }
    const onDragOver = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      setChatDropActive(true)
    }
    const onDragLeave = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) hide()
    }
    const onDrop = () => { hide() }
    const onDragEnd = () => { hide() }
    section.addEventListener('dragenter', onDragEnter, true)
    section.addEventListener('dragover', onDragOver, true)
    section.addEventListener('dragleave', onDragLeave, true)
    section.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      section.removeEventListener('dragenter', onDragEnter, true)
      section.removeEventListener('dragover', onDragOver, true)
      section.removeEventListener('dragleave', onDragLeave, true)
      section.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])
  // Think disclosure auto behavior: a streaming think block (data-variant=
  // "think", data-state="running") opens once and auto-collapses shortly
  // after finishing (data-state="ok"). The harness renders the expanded body
  // only while the row is open, and the row state is internal, so rows are
  // toggled by clicking the disclosure row (expandOnRowClick). Manual
  // interaction wins: a row collapsed during streaming is not re-opened, a
  // click/keypress cancels a pending auto-collapse, and manually opened rows
  // are never auto-collapsed.
  /* Roots this behavior has already seen persist across effect re-runs (the
     delay slider / feature toggle change the deps): re-mounting must not
     re-open a running block the user already collapsed, only genuinely new
     blocks. */
  const thinkAutoOpenedKnownRef = useRef(new WeakSet())
  useEffect(() => {
    if ((settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) === false) return undefined
    const section = chatSectionRef.current
    if (section === null) return undefined
    const collapseDelayMs = Math.round((settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S) * 1000)
    const autoOpened = new WeakSet()
    const pendingCollapses = new Map()
    const rowOf = root => root.querySelector(':scope [data-disclosure-row]')
    // Flag programmatic row clicks so the interaction listener below does not
    // treat this behavior's own clicks as user interaction.
    let programmatic = false
    const clickRow = row => {
      programmatic = true
      try { row.click() } finally { programmatic = false }
    }
    const openRow = root => {
      if (autoOpened.has(root)) return
      const row = rowOf(root)
      // Track only rows this behavior actually opened. A disclosure that has
      // not rendered yet must be retried on the next child mutation, while a
      // row already opened by the user remains user-owned and is never closed
      // automatically.
      if (row === null || row.getAttribute('aria-expanded') === 'true') return
      thinkAutoOpenedKnownRef.current.add(root)
      autoOpened.add(root)
      clickRow(row)
    }
    const closeRow = root => {
      const row = rowOf(root)
      if (row !== null && row.getAttribute('aria-expanded') === 'true') clickRow(row)
      autoOpened.delete(root)
    }
    const cancelPending = root => {
      const timer = pendingCollapses.get(root)
      if (timer !== undefined) {
        clearTimeout(timer)
        pendingCollapses.delete(root)
      }
    }
    const scheduleClose = root => {
      cancelPending(root)
      pendingCollapses.set(root, setTimeout(() => {
        pendingCollapses.delete(root)
        if (root.isConnected) closeRow(root)
      }, collapseDelayMs))
    }
    // Any user interaction with a Think block takes ownership of it: cancel a
    // pending auto-collapse and stop tracking it.
    const onSectionClick = event => {
      if (programmatic) return
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      cancelPending(root)
      autoOpened.delete(root)
    }
    const onSectionKeyDown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      cancelPending(root)
      autoOpened.delete(root)
    }
    section.addEventListener('click', onSectionClick, true)
    section.addEventListener('keydown', onSectionKeyDown, true)
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-state') {
          const root = mutation.target
          if (root.nodeType !== 1 || !root.matches?.('[data-variant="think"]')) continue
          const state = root.getAttribute('data-state')
          if (state === 'running') openRow(root)
          else if (state === 'ok' && autoOpened.has(root)) scheduleClose(root)
          continue
        }
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches?.('[data-variant="think"]')) {
            if (node.getAttribute('data-state') === 'running') openRow(node)
          } else {
            for (const root of node.querySelectorAll?.('[data-variant="think"][data-state="running"]') ?? []) openRow(root)
          }
        }
      }
    })
    observer.observe(section, { attributes: true, attributeFilter: ['data-state'], childList: true, subtree: true })
    // Catch a block already streaming when the observer attached — but only
    // blocks this behavior has never seen: a re-run (delay slider change) must
    // not re-open a running block the user already collapsed.
    for (const root of section.querySelectorAll('[data-variant="think"][data-state="running"]')) {
      if (!thinkAutoOpenedKnownRef.current.has(root)) openRow(root)
    }
    return () => {
      observer.disconnect()
      section.removeEventListener('click', onSectionClick, true)
      section.removeEventListener('keydown', onSectionKeyDown, true)
      for (const timer of pendingCollapses.values()) clearTimeout(timer)
      pendingCollapses.clear()
    }
  }, [chatSectionRef, settings.autoExpandThink, settings.thinkCollapseDelay])
  const asideRef = useRef(null)
  // The harness sidebar shell owns the New Session button and the browsing
  // region, and its slots cannot be redeclared by this plugin. Instead two
  // DOM containers are created inside the shell — the top actions row
  // (replacing the hidden New Session button) and the files region seat —
  // and this plugin renders its own React content into them via portals. The
  // observer re-asserts the containers on structural rebuilds; in-place React
  // updates leave foreign nodes alone, so nothing flickers.
  const [sidebarChrome, setSidebarChrome] = useState(null)
  useLayoutEffect(() => {
    const aside = asideRef.current
    if (aside === null) return undefined
    const ensure = () => {
      const rootDiv = aside.querySelector('[data-slot="sidebar"] > div')
      if (rootDiv === null) return null
      let top = rootDiv.querySelector(':scope > .dsh-ws-sidebar-top-actions')
      if (top === null) {
        top = document.createElement('div')
        top.className = 'dsh-ws-sidebar-top-actions'
        rootDiv.insertBefore(top, rootDiv.querySelector(':scope > button'))
      }
      const workspacesOutlet = rootDiv.querySelector(':scope [data-slot="sidebar.workspaces"]')
      let files = null
      let fallback = null
      const groups = []
      if (workspacesOutlet !== null) {
        const regionArea = workspacesOutlet.parentElement
        if (regionArea !== null) {
          files = regionArea.querySelector(':scope > .dsh-ws-sidebar-files')
          if (files === null) {
            files = document.createElement('div')
            files.className = 'dsh-ws-sidebar-files'
            regionArea.append(files)
          }
          /* Mind-map seats: one container per workspace group section (after
             its session rows), so entries live inside their workspace's
             session list. Sections are recognized by the header row
             (`role="treeitem"` with `aria-expanded`); the header title names
             the workspace. Flat/search modes have no sections — a single
             region-area seat at the bottom covers them. */
          for (const header of workspacesOutlet.querySelectorAll('[role="treeitem"][aria-expanded]')) {
            const section = header.parentElement
            if (section === null) continue
            let container = section.querySelector(':scope > .dsh-ws-sidebar-mindmaps')
            if (container === null) {
              container = document.createElement('div')
              container.className = 'dsh-ws-sidebar-mindmaps'
              section.append(container)
            }
            /* Keep the seat above the group's "show more sessions" button:
               React appends that button after the seat when it appears, so
               re-anchor it on every pass (insertBefore is a no-op when the
               seat already sits right before the button). */
            const overflow = section.querySelector(':scope > button[aria-expanded]')
            if (overflow !== null) section.insertBefore(container, overflow)
            const titleEl = header.querySelector('span[class*="title"]')
            groups.push({ container, title: titleEl?.textContent?.trim() ?? '' })
          }
          if (groups.length === 0) {
            fallback = regionArea.querySelector(':scope > .dsh-ws-sidebar-mindmaps-fallback')
            if (fallback === null) {
              fallback = document.createElement('div')
              fallback.className = 'dsh-ws-sidebar-mindmaps dsh-ws-sidebar-mindmaps-fallback'
              regionArea.append(fallback)
            }
          } else {
            /* Grouped mode: drop any stale region-area seat from a previous
               flat / search pass. */
            regionArea.querySelector(':scope > .dsh-ws-sidebar-mindmaps-fallback')?.remove()
          }
        }
      }
      return { top, files, fallback, groups }
    }
    const groupsEqual = (a, b) => a.length === b.length
      && a.every((group, index) => group.container === b[index]?.container && group.title === b[index]?.title)
    let current = ensure()
    if (current !== null) setSidebarChrome(current)
    const observer = new MutationObserver(() => {
      const next = ensure()
      if (next === null) return
      setSidebarChrome(prev => (prev !== null && prev.top === next.top && prev.files === next.files
        && prev.fallback === next.fallback && groupsEqual(prev.groups, next.groups) ? prev : next))
    })
    observer.observe(aside, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      setSidebarChrome(null)
      aside.querySelectorAll('.dsh-ws-sidebar-top-actions, .dsh-ws-sidebar-files, .dsh-ws-sidebar-mindmaps').forEach(node => node.remove())
    }
  }, [])
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
  const showSessionNotice = useCallback((text, error = false) => {
    setSessionNotice({ error, text })
    clearTimeout(sessionNoticeTimerRef.current)
    sessionNoticeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSessionNotice(undefined)
    }, error ? 3000 : 1600)
  }, [])
  // Right-click detection on harness session rows. Session rows are
  // `[role="treeitem"]` without `aria-expanded` (workspace group headers carry
  // it); the row carries no session id, so its display title is matched against
  // the sessions snapshot — preferring the current session on duplicate titles.
  // Blank (never-started) sessions get no menu.
  useEffect(() => {
    const onContextMenu = (event) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest('[role="treeitem"]')
      if (row === null) return
      if (row.hasAttribute('aria-expanded')) return
      if (row.closest('[data-slot="sidebar.workspaces"]') === null) return
      const titleSpan = row.querySelector('span[class*="title"]')
      const title = titleSpan?.textContent?.trim() ?? ''
      if (title === '') return
      const snapshot = props.getSessionList()
      const candidates = snapshot.ids.filter(id => snapshot.byId[id]?.displayTitle === title)
      if (candidates.length === 0) return
      let sessionId = candidates[0]
      if (snapshot.current !== undefined && candidates.includes(snapshot.current)) sessionId = snapshot.current
      const summary = snapshot.byId[sessionId]
      if (summary === undefined || summary.blank) return
      event.preventDefault()
      sessionContextRowRef.current = row
      setSessionContextMenu({ sessionId, title, x: event.clientX, y: event.clientY })
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [props.getSessionList])
  // Close the session menu on outside pointer/context/scroll, Escape and resize
  // (same contract as the other plugin context menus).
  useEffect(() => {
    if (sessionContextMenu === undefined) return undefined
    const inside = event => { const node = sessionMenuRef.current; return node !== null && event.target instanceof Node && node.contains(event.target) }
    const close = () => setSessionContextMenu(undefined)
    const onPointerDown = event => { if (!inside(event)) close() }
    const onContextMenu = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [sessionContextMenu])
  const beginSessionInlineRename = useCallback(() => {
    const menu = sessionContextMenu
    if (menu === undefined) return
    setSessionContextMenu(undefined)
    setSessionInlineRenameError(undefined)
    setSessionInlineRename({ sessionId: menu.sessionId, title: menu.title, row: sessionContextRowRef.current })
  }, [sessionContextMenu])
  const cancelSessionInlineRename = useCallback(() => {
    if (sessionInlineRenameBusy) return
    setSessionInlineRename(undefined)
    setSessionInlineRenameError(undefined)
  }, [sessionInlineRenameBusy])
  const confirmSessionInlineRename = useCallback((draft) => {
    const target = sessionInlineRename
    if (target === undefined || sessionInlineRenameBusy) return
    const trimmed = draft.trim()
    if (trimmed === '') return
    if (trimmed === target.title) { setSessionInlineRename(undefined); return }
    setSessionInlineRenameBusy(true)
    setSessionInlineRenameError(undefined)
    props.renameSession(String(target.sessionId), trimmed).then(() => {
      if (!mountedRef.current) return
      setSessionInlineRenameBusy(false)
      setSessionInlineRename(undefined)
    }).catch(error => {
      if (!mountedRef.current) return
      setSessionInlineRenameBusy(false)
      setSessionInlineRenameError(error instanceof Error ? error.message : String(error))
    })
  }, [props.renameSession, sessionInlineRename, sessionInlineRenameBusy])
  const archiveSessionFromMenu = useCallback(() => {
    const menu = sessionContextMenu
    if (menu === undefined) return
    setSessionContextMenu(undefined)
    setSessionInlineRename(undefined)
    // A fork root archives its whole derived branch tree (same rule as the
    // mind map's branch archive); standalone sessions archive just themselves.
    const snapshot = props.getSessionList()
    const parentOf = new Map()
    for (const id of snapshot.ids) {
      const summary = snapshot.byId[id]
      if (summary === undefined || summary.origin === 'subagent' || summary.blank) continue
      const parent = summary.parentId
      if (parent !== undefined) parentOf.set(id, String(parent))
    }
    const ids = [...new Set([String(menu.sessionId), ...mindmapDescendantsOf(parentOf, String(menu.sessionId))])]
    const run = async () => {
      for (const id of ids) await props.archiveSession(id)
      // Archiving a mind-map root removes the whole map: drop its doc so the
      // self-drawn sidebar entry disappears with it.
      if (mindmapRegistry.isRoot(String(menu.sessionId))) {
        try { await props.deleteMindmapDoc(String(menu.sessionId)) } catch { /* best effort */ }
        mindmapRegistry.markDirty()
      }
    }
    run().then(() => {
      if (!mountedRef.current) return
      const count = ids.length
      showSessionNotice(count > 1 ? translate('status.archivedSessions', { n: count }) : translate('status.archivedSession'))
    }).catch(error => {
      if (!mountedRef.current) return
      showSessionNotice(translate('status.archiveFailed', { message: error instanceof Error ? error.message : String(error) }), true)
    })
  }, [props.archiveSession, props.deleteMindmapDoc, props.getSessionList, sessionContextMenu, showSessionNotice])
  /* Reveal a session's workspace in the OS file explorer (shared by the
     session-row context menu and the sidebar mind-map entries' menu). */
  const revealSessionById = useCallback((sessionId) => {
    let workspace
    try {
      const snapshot = props.getSessionList()
      const row = snapshot.byId[String(sessionId)]
      const items = props.getWorkspaceItems()
      workspace = (row !== undefined && items.find(item => item.sessionIds.includes(String(sessionId))))
        || (row?.cwd !== undefined && items.find(item => item.path === row.cwd))
    } catch (error) {
      showSessionNotice(translate('status.revealFailed', { message: error instanceof Error ? error.message : String(error) }), true)
      return
    }
    if (workspace === undefined) {
      showSessionNotice(translate('status.revealNoWorkspace'), true)
      return
    }
    const controller = new AbortController()
    revealInExplorer(String(workspace.workspaceId), '', controller.signal).then(() => {
      if (mountedRef.current) showSessionNotice(translate('status.revealed'))
    }).catch(error => {
      if (!mountedRef.current || error?.name === 'AbortError') return
      showSessionNotice(translate('status.revealFailed', { message: error instanceof Error ? error.message : String(error) }), true)
    })
  }, [props.getSessionList, props.getWorkspaceItems, showSessionNotice])
  const revealSessionFromMenu = useCallback(() => {
    const menu = sessionContextMenu
    if (menu === undefined) return
    setSessionContextMenu(undefined)
    setSessionInlineRename(undefined)
    revealSessionById(menu.sessionId)
  }, [revealSessionById, sessionContextMenu])
  // Sidebar mind-map entries: open the root session (its conversation shows
  // on the right) and open the floating mind-map overlay for its document.
  const openMindmapSession = useCallback((id) => {
    props.openSession(String(id))
    mindmapOverlayStore.open(String(id))
  }, [props.openSession])
  return h('div',{ref:viewportRef,className:'dsh-ws-viewport'},h('main',{className:'dsh-ws-frame','data-explorer-closed':!panes.explorerOpen&&!filesActive||undefined,'data-sidebar-collapsed':collapsed||undefined,'data-sidebar-files':filesActive||undefined,'data-resizing':resizing||undefined,'data-preview-right':settings.previewRight===true||undefined,style:{'--dsh-ws-preview':`${preview}px`,'--dsh-ws-sidebar':`${sidebar}px`,'--dsh-ws-row-height':`${clamp(settings.rowHeight ?? ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)}px`,'--dsh-ws-chat-font-scale':String(chatFontScale),'--dsh-ws-mobile-header-h':`${mobileHeaderHeight}px`,'--dsh-ws-mindmap-spin-duration':mindmapSpinDuration,...fileColorVars}},h('aside',{className:'dsh-ws-sidebar',ref:asideRef},props.renderSlot('sidebar',{collapsed,width:sidebar}),sidebarChrome?.top?createPortal(h(SidebarTopActions,{collapsed,view,width:sidebar,onSelectSessions:()=>{props.actions.setView('sessions')},onSelectFiles:()=>{if(collapsed)props.toggleSidebar();props.actions.setView('files')}}),sidebarChrome.top):null,sidebarChrome&&(sidebarChrome.groups.length>0?sidebarChrome.groups.map(group=>createPortal(h(MindmapSessionsPanel,{useSessions:props.useSessions,useWorkspaces:props.useWorkspaces,groupTitle:group.title,openSession:openMindmapSession,revealSession:revealSessionById}),group.container)):sidebarChrome.fallback?createPortal(h(MindmapSessionsPanel,{useSessions:props.useSessions,useWorkspaces:props.useWorkspaces,groupTitle:undefined,openSession:openMindmapSession,revealSession:revealSessionById}),sidebarChrome.fallback):null)),workspace?h(WorkspaceExplorer,{key:`${workspace.workspaceId}:${sessionId ?? 'workspace'}`,createEntry:props.createEntry,listDirectory:props.listDirectory,persistPreviewSession,publishEditorContext,readFile:props.readFile,renameEntry:props.renameEntry,saveFile:props.saveFile,loadDraft:props.loadDraft,persistDraftFile:props.persistDraftFile,removeDraftFile:props.removeDraftFile,draftTree:props.draftTree,settingsStore:props.settingsStore,storedPreviewSession,sessionTitle,sessionId,renameSession:props.renameSession,treePortalTarget,workspace}):h(EmptyWorkspaceExplorer,{sessionTitle,treePortalTarget}),h('section',{className:'dsh-ws-chat',ref:chatSectionRef},props.renderSlot('conversation',{}),chatDropActive?h('div',{className:'dsh-ws-chat-drop-mask',role:'presentation'},h('button',{'aria-label':translate('drop.closeAria'),className:'dsh-ws-chat-drop-close',onClick:()=>{chatDropSuppressed.current=true;setChatDropActive(false)},title:translate('drop.closeTitle'),type:'button'},'×'),h('div',{className:'dsh-ws-chat-drop-card'},translate('drop.releaseImages'))):null),!collapsed?h(ResizeHandle,{label:translate('resize.sidebar'),left:sidebar,max:sidebarMax,min:SIDEBAR_MIN,onDragging:setResizing,onResize:width=>props.actions.setSidebar(width,sidebarMax),value:sidebar}):null,(panes.explorerOpen||filesActive)?h(ResizeHandle,{label:translate('resize.preview'),left:settings.previewRight===true?Math.max(0,viewportWidth-preview):previewBoundary,max:previewMax,min:PREVIEW_MIN,onDragging:setResizing,onResize:width=>props.explorerPaneStore.actions.setPreview(width,previewMax),value:preview,invert:settings.previewRight===true||undefined}):null,h('aside',{className:'dsh-ws-details','data-closed':!panels.detailsOpen||!detailsCapable||undefined},props.renderSlot('details',{})),mobile.on&&mobile.drawerOpen?h('div',{className:'dsh-ws-mobile-scrim',onClick:()=>setDrawerOpen(false)}):null,h('div',{className:'dsh-ws-overlay','data-shell-overlay':true},props.renderSlot('shell.overlay',{})),sessionContextMenu?h('div',{className:'dsh-ws-context-menu',ref:sessionMenuRef,role:'menu',style:{left:Math.max(4,Math.min(sessionContextMenu.x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top:Math.max(4,Math.min(sessionContextMenu.y,window.innerHeight-52))}},h('button',{className:'dsh-ws-context-item',onClick:beginSessionInlineRename,role:'menuitem',type:'button'},translate('context.renameSession')),h('button',{className:'dsh-ws-context-item',onClick:archiveSessionFromMenu,role:'menuitem',type:'button'},translate('context.archiveSession')),h('div',{className:'dsh-ws-context-separator',role:'separator'}),h('button',{className:'dsh-ws-context-item',onClick:revealSessionFromMenu,role:'menuitem',type:'button'},translate('context.reveal'))):null,sessionInlineRename?h(SessionInlineRename,{busy:sessionInlineRenameBusy,error:sessionInlineRenameError,onCancel:cancelSessionInlineRename,onConfirm:confirmSessionInlineRename,row:sessionInlineRename.row,title:sessionInlineRename.title}):null,sessionNotice?h('div',{className:'dsh-ws-copy-notice','data-error':sessionNotice.error||undefined,role:'status'},sessionNotice.text):null),overlay.open?h(MindmapOverlayHost,{actions:props.mindmapActions,chatWidth,mobile:mobile.on,previewRight:settings.previewRight===true,previewWidth:preview,sessionId:overlay.sessionId,settingsStore:props.settingsStore,sidebarWidth:sidebar,useSessions:props.useSessions}):null)}

export const inject = ['slots', 'theme', 'sessions', 'workspaces']
export function apply(ctx) {
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
      const disposeDicts = localeService.register(EXPLORER_LOCALE_NS, { zh, en })
      translate = localeService.bind(EXPLORER_LOCALE_NS)
      localeFace = localeService
      return () => {
        disposeDicts()
        localeFace = undefined
        translate = zhFallbackTranslate
      }
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

  /* The mind-map action face shared by the floating overlay (formerly the
     conversation.view inject): document IO, fork, rename and archive. forkAt
     does NOT open the child — the view opens it only after the doc write
     completes, so the branch is part of the document when it becomes visible.
     No increaseTitle: the host derives the title from the fork boundary; the
     child is renamed to the family-root title plus " ›" so its header never
     collides with the root (a root-replacement fork — card-deletion
     truncation of the trunk — keeps the plain family title instead, asRoot). */
  const buildMindmapActions = (ctx) => {
    /* Resolve the workspace whose canonical path matches a cwd string (case /
       trailing-separator normalized), so a root-node-created session can be
       created WITH its workspaceId. The harness host attaches a session to a
       workspace only when session.create carries a workspaceId; a cwd-only
       create leaves the session ungrouped, and a blank ungrouped session is
       then hidden from the sidebar as soon as it is not the current session. */
    const mindmapWorkspaceIdForCwd = (cwd) => {
      if (typeof cwd !== 'string' || cwd === '') return undefined
      let items = []
      try {
        items = ctx.workspaces.list.getSnapshot().items
      } catch {
        items = []
      }
      if (!Array.isArray(items)) return undefined
      const normalize = (p) => String(p ?? '').replace(/[\\/]+$/, '').toLowerCase()
      const target = normalize(cwd)
      for (const workspace of items) {
        if (workspace !== null && workspace !== undefined
          && workspace.workspaceId !== undefined
          && workspace.workspaceId !== ''
          && normalize(workspace.path) === target) return String(workspace.workspaceId)
      }
      return undefined
    }
    return {
    archiveSession: async id => { await ctx.workspaces.archiveSession(String(id)) },
    createSession: async (recordedCwd, anchorId) => {
      /* A top-level session (created by clicking the mind-map root node) is a
         brand-new BLANK harness session — no inherited turns. It is created in
         the workspace the map was CREATED in (recordedCwd, from the doc); when
         the doc has none recorded (pre-upgrade / no workspace), fall back to
         the anchor session's current cwd so it still lands in a sidebar group
         instead of the ungrouped bucket. Created via workspaceId (not cwd) so
         the host attaches the session to that workspace; a cwd-only create
         stays ungrouped and the blank session disappears from the sidebar. */
      const snapshot = ctx.sessions.list.getSnapshot()
      const cwd = (typeof recordedCwd === 'string' && recordedCwd !== '')
        ? recordedCwd
        : snapshot.byId[String(anchorId)]?.cwd
      const workspaceId = mindmapWorkspaceIdForCwd(cwd)
      const childId = workspaceId !== undefined
        ? await ctx.sessions.create({ workspaceId })
        : await ctx.sessions.create(cwd === undefined ? {} : { cwd })
      return childId
    },
    deleteDoc: (id, signal) => deleteMindmapDoc(String(id), signal),
    /* All workspaces, for the root node's "选择工作区" menu. */
    listWorkspaces: () => {
      try {
        const items = ctx.workspaces.list.getSnapshot().items
        return Array.isArray(items) ? items : []
      } catch {
        return []
      }
    },
    forkAt: async (id, seq, asRoot) => {
      const childId = await ctx.sessions.fork({ sessionId: String(id), atSeq: seq })
      const rootTitle = mindmapRootTitleOf(ctx.sessions.list.getSnapshot(), String(id))
      if (rootTitle !== undefined && rootTitle !== '') {
        /* Branch children get the family-root title plus " ›" so they never
           collide with the root. A root-replacement fork becomes the NEW root
           itself, so it keeps the plain family title instead. */
        const title = asRoot === true ? rootTitle : (rootTitle.endsWith(' ›') ? rootTitle : `${rootTitle} ›`)
        ctx.sessions.binding(String(childId))?.session.rename(title).catch(() => {})
      }
      return childId
    },
    loadDoc: (id, signal) => fetchMindmapDoc(String(id), signal),
    openSession: id => { ctx.sessions.open(String(id)) },
    renameSession: async (id, title) => {
      const session = ctx.sessions.binding(String(id))?.session
      if (session === undefined) throw new Error(`unknown session "${id}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    saveDoc: (id, doc, signal, prevSessionId) => writeMindmapDoc(String(id), doc, signal, prevSessionId),
    syncDoc: (id, liveSessionIds, signal) => syncMindmapDoc(String(id), liveSessionIds, signal),
    }
  }

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
          // Mind-map sidebar entries open the root session and pop the
          // floating mind-map overlay (the chat column stays visible).
          openSession: sessionId => { ctx.sessions.open(sessionId) },
          deleteMindmapDoc: (sessionId, signal) => deleteMindmapDoc(sessionId, signal),
          // The floating mind-map overlay's document/fork/archive action face.
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
  /* The session-header mind-map button: opens the floating mind-map overlay
     for the current session (the chat column stays visible on the right).
     Persisted full-page mind-map view selections fall back to the chat view
     automatically (the harness treats unknown view ids as the stable Chat
     view). */
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'workspace-mindmap-toggle', order: -350,
  }, MindmapHeaderButton))
  /* Mind-map family sessions (roots + every fork descendant) are hidden from
     the harness sidebar session list; each mind map is represented by its
     self-drawn sidebar entry instead. */
  ctx.effect(() => installMindmapBranchHider(
    () => ctx.sessions.list.getSnapshot(),
    () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
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
  // grouped into file browsing, content browsing, and dialog settings (unset
  // color/preset groups resolve to their defaults).
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'workspace-explorer', order: 5, label: () => translate('settings.section.title'),
    inject: () => ({ settingsStore }),
  }, ExplorerSettingsSection))
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => presenter.apply(snapshot))
    return () => {
      off()
      presenter.dispose()
    }
  }, 'workspace-studio: theme presenter')
}