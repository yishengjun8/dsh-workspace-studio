import React from 'react'
import { createPortal } from 'react-dom'
import { createSnapshotStore, defineStore } from '@deepseek-ai/dsh-client-runtime/client'
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
const PACKAGE_ID = '@deepseek-ai/dsh-workspace-explorer-layout'
const API_PREFIX = '/workspace-explorer-layout/api'
const EDITOR_CONTEXT_PROVIDER = 'workspace-editor-context'
const SEND_SESSION_BRIDGE_MARKER = Symbol('workspace-explorer-layout.send-session-bridge')
const PREVIEW_SESSION_STORE_KEY = 'dsh.workspace.explorer.preview-sessions.v1'
const PREVIEW_SESSION_MAX = 25
const SIDEBAR_DEFAULT = 280, SIDEBAR_COLLAPSED = 56, SIDEBAR_MIN = 240, SIDEBAR_MAX_RATIO = 0.8, SIDEBAR_MAX_FALLBACK = 420
const EXPLORER_MAX_RATIO = 0.8
const TREE_DEFAULT = 280, TREE_MIN = 220, TREE_MAX = 520
const PREVIEW_DEFAULT = 420, PREVIEW_MIN = 280, PREVIEW_MAX = 760, RESIZE_STEP = 12
const CONTEXT_MENU_WIDTH = 176, CONTEXT_MENU_HEIGHT = 280
const ROW_HEIGHT_DEFAULT = 20, ROW_HEIGHT_MIN = 12, ROW_HEIGHT_MAX = 36
const CHAT_FONT_SIZE_DEFAULT = 16, CHAT_FONT_SIZE_MIN = 13, CHAT_FONT_SIZE_MAX = 20
/* Font size of the comparison text inside the save-conflict dialog (px). The
 * default matches the pre-existing .dsh-wel-conflict-code font-size. */
const CONFLICT_FONT_SIZE_DEFAULT = 12, CONFLICT_FONT_SIZE_MIN = 6, CONFLICT_FONT_SIZE_MAX = 24
/* Whether search results show each file's matched rows expanded by default;
 * the explorer settings page lets the user choose (default: expanded). */
const SEARCH_MATCH_EXPAND_DEFAULT = true
/* Whether a streaming Think disclosure in the chat pane is opened while its
 * reasoning text is being output and closed again once it finishes; the
 * explorer settings page lets the user disable the behavior (default: on). */
const AUTO_EXPAND_THINK_DEFAULT = true
/* Delay (seconds) before an auto-expanded Think disclosure collapses after
 * the block finishes; adjustable from the explorer settings page (0-10 s,
 * 0.1 s steps). Manual interaction with the block cancels a pending
 * collapse. */
const THINK_COLLAPSE_DELAY_DEFAULT_S = 3
const THINK_COLLAPSE_DELAY_MIN_S = 0
const THINK_COLLAPSE_DELAY_MAX_S = 10
const THINK_COLLAPSE_DELAY_STEP_S = 0.1
const EXPLORER_SETTINGS_STORE_KEY = 'dsh.workspace.explorer.settings.v1'
const EXPLORER_LAYOUT_STORE_KEY = 'dsh.workspace.explorer.layout.v1'
/* Debounce (ms) before a dirty tab's draft is auto-saved to disk. Auto-save
   persists the temporary edits so a page refresh restores them from disk; it
   never clears the dirty marker (only an explicit save does). */
const AUTOSAVE_DELAY_MS = 1000
/* Above this many base lines the save-time three-way merge is skipped and a
   conflict prompt is shown directly (the Myers diff is O(N*D) worst case). */
const MERGE_MAX_LINES = 20000
/* Myers stores one full frontier per edit-distance step. Bound the aggregate
   frontier cells so highly divergent files fall back to an explicit whole-file
   conflict instead of exhausting the browser heap. */
const MYERS_TRACE_CELL_LIMIT = 4_000_000
/* Mobile (phone-column) mode, mirroring the dsh-mobile-preview approach: a
   document-class gate drives every layout override, and the floating-drawer
   and file-fullscreen states ride sibling classes so the whole chrome stays in
   sync. The state is transient (not persisted): a reload returns to the
   desktop layout. */
const MOBILE_CLASS = 'dsh-wel-mobile-on'
const MOBILE_DRAWER_CLASS = 'dsh-wel-mobile-drawer-open'
const MOBILE_FILES_CLASS = 'dsh-wel-mobile-files-on'
const MOBILE_WIDTH = 430
const MOBILE_DRAWER_WIDTH = 280
const MOBILE_HEADER_FALLBACK_H = 52
/* Mind-map conversation branching ("导图"): a floating window on the left of
   the page (everything except the chat column) rendering a persisted
   per-root-session document as a left-to-right turn tree. The document
   (trunk = the root session's turns reverse-parsed from its full log, plus
   every fork branch cut at a card) is the single source of truth; branch
   sessions are ordinary forks hidden from the harness sidebar session list
   so only the self-drawn mind-map session entries stay there. */
const MINDMAP_NODE_W = 236
/* Turn cards carry a branch-title row, a clamped two-line question and a
   status row — tall enough for all three. */
const MINDMAP_NODE_H = 124
const MINDMAP_DEPTH_GAP = 64
const MINDMAP_ROW_GAP = 12
const MINDMAP_TEXT_MAX = 88
/* Padding around the live-streaming frame (the box enclosing the streaming
   card and its parent card). */
const MINDMAP_FRAME_PAD = 14
/* Mind-map viewport interaction bounds: wheel-zoom range, the overhang that
   keeps the map from being panned completely out of view, and the exponential
   zoom step per wheel delta pixel. MINDMAP_PAN_MARGIN is the legacy fixed
   overhang (still used by the fit view's top-left alignment); the pan clamp
   itself is proportional to the map size via MINDMAP_PAN_OUT_MAX, so a map may
   be dragged away by up to 80% of its own width/height (at least 20% of it
   stays visible) instead of being pinned to a 48 px ledge. */
const MINDMAP_ZOOM_MIN = 0.25
const MINDMAP_ZOOM_MAX = 3
const MINDMAP_PAN_MARGIN = 48
/* Max fraction of the map (per axis, at the current zoom) that may be dragged
   out of view: 0.8 = the map can go away by 80%, 20% of it must stay on
   screen. Applies to grab-pan AND wheel-zoom anchoring alike. */
const MINDMAP_PAN_OUT_MAX = 0.8
const MINDMAP_WHEEL_STEP = 0.0016
/* Background refresh interval of the mind-map doc index (the sidebar panel and
   the branch hider read it); the view also bumps it on every doc mutation. */
const MINDMAP_INDEX_REFRESH_MS = 5000
/* While the mind-map view is mounted, re-sync the doc this often so a branch
   that completes a turn in the chat is folded in live. */
const MINDMAP_SYNC_MS = 2500
/* Minimum interval between two sidebar branch-hider scans. The hider observes
   EVERY body mutation (streaming text included); a time throttle keeps it to
   a bounded number of full scans per second instead of one per frame. */
const MINDMAP_HIDER_THROTTLE_MS = 400
/* DeepSeek fish logo path (ui-primitives FishLogo); the svg uses a padded
   viewBox so the 1.4-wide stroke is not clipped. */
const FISH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

/* File encodings offered by the right-click encoding actions. The server owns
 * the authoritative list (<API_PREFIX>/encodings); this fallback mirrors it so
 * the menu and badge work even before (or without) the fetch succeeding. */
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
/* Fetch the server's authoritative encoding list once; keep the fallback if
 * the request fails so the encoding actions never dead-end. */
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

/* ---- Locale support ---- The plugin follows the harness language setting
   (Settings -> General -> Language, provided by the dsh-client-locale
   plugin): zh is the source of truth and en mirrors every key. All product
   copy goes through the `translate` function below; render code re-subscribes
   through useLocaleText() so a language switch re-renders the UI. Without the
   locale service the plugin degrades to the zh dictionary (the historical
   behavior). */
const EXPLORER_LOCALE_NS = 'workspace.explorer'
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
  'tree.truncated': '此目录条目过多，仅显示前一部分。',
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
  'editor.refreshBlocked': '存在未保存的更改，请先保存或取消后再刷新。',
  'editor.refreshed': '已从磁盘重新读取。',
  'editor.searchResize': '拖拽调整搜索框宽度',
  'editor.saved': '保存成功。',
  'editor.savingWith': '正在保存（{encoding}）…',
  'editor.savedAs': '已保存为 {encoding}。',
  'editor.saveConflict': '保存冲突：文件已在磁盘上被其他工具修改。草稿已保留，请重新读取或选择保留版本。',
  'editor.saveFailed': '保存失败：{message}。草稿已保留。',
  'editor.saveAsFailed': '无法另存为编码：{reason}',
  'editor.cancelRestored': '已取消编辑，已从磁盘重新读取源文件。',
  'editor.cancelFailed': '取消失败：{message}。草稿已保留。',
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
  'settings.section.title': '资源管理器设置',
  'settings.group.browse': '文件浏览设置',
  'settings.group.content': '内容浏览设置',
  'settings.group.dialog': '对话框设置',
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
  'settings.resetDefault': '恢复默认',
  'settings.hint': '文件浏览设置：调整左侧文件树的行高、搜索结果显示方式与图标徽标配色；内容浏览设置：为每种文件类型选择编辑器代码高亮预设，并调整保存冲突弹窗中对比文本的字号；对话框设置：调整对话文字大小，开启思考过程自动展开后，聊天中正在输出的思考内容会自动展开、结束后按设定延迟自动收起（0–10 秒，分度 0.1 秒），期间手动操作可取消；未修改的项使用默认值。',
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
  'mindmap.rootLabel': '主会话',
  'mindmap.current': '当前',
  'mindmap.pending': '等待新问题…',
  'mindmap.streaming': '生成中…',
  'mindmap.thinking': '正在思考…',
  'mindmap.done': '已完成',
  'mindmap.emptyRound': '（本轮无文本）',
  'mindmap.open.hint': '从这张卡片创建分支并继续对话',
  'mindmap.empty': '该会话还没有可展示的对话轮次。完成一轮对话后，可在此将全部轮次切成卡片，并从任意卡片创建分支。',
  'mindmap.loading': '正在加载导图会话…',
  'mindmap.error': '加载导图会话失败：{message}',
  'mindmap.forkFailed': '创建分支失败：{message}',
  'mindmap.created': '已创建导图会话，并已替换左侧会话列表。',
  'mindmap.forked': '已在此处创建分支。',
  'mindmap.branchTag': '分支',
  'mindmap.turnTag': '第 {n} 轮',
  'mindmap.rounds': '{n} 轮',
  'mindmap.moreRounds': '还有 {n} 轮历史',
  'mindmap.menu.rename': '重命名分支',
  'mindmap.menu.archiveAll': '归档整个导图',
  'mindmap.rename.title': '重命名分支',
  'mindmap.archiveAll.message': '确定归档整个导图「{name}」吗？其所有分支会话也将一并归档并从列表中移除。',
  'mindmap.archive.action': '归档',
  'mindmap.archivedAll': '已归档整个导图。',
  'mindmap.renamed': '已重命名分支。',
  'mindmap.menu.deleteCard': '删除卡片',
  'mindmap.delete.title': '删除卡片',
  'mindmap.delete.message': '确定删除卡片「{name}」吗？将从这里截断：该卡片及之后的内容、由此衍生的所有分支都会被移除，原会话将被归档（当前无恢复入口）。',
  'mindmap.delete.action': '删除',
  'mindmap.delete.current': '当前会话将被归档，删除后将自动切换到截断后的新会话。',
  'mindmap.delete.lastTrunk': '不能删除第一张主干卡片，导图至少需要保留一张主干卡片。',
  'mindmap.delete.missing': '找不到要删除的卡片，文档可能已变化，请重试。',
  'mindmap.deleted': '已删除卡片及其派生内容。',
  'mindmap.truncated': '已截断会话并归档原会话。',
  'mindmap.view.restore': '还原视图',
  'mindmap.view.restoreTitle': '将视图大小与位置还原',
  'mindmap.scope.full': '当前填充模式：全部',
  'mindmap.scope.sidebar': '当前填充模式：仅侧栏',
  'mindmap.scope.title': '切换导图范围：填充（侧边栏 + 文件浏览） / 仅侧边栏',
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
  'tree.truncated': 'This directory has too many entries; only the first part is shown.',
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
  'editor.refreshBlocked': 'There are unsaved changes; save or cancel them before reloading.',
  'editor.refreshed': 'Reloaded from disk.',
  'editor.searchResize': 'Drag to resize the search box width',
  'editor.saved': 'Saved.',
  'editor.savingWith': 'Saving ({encoding})…',
  'editor.savedAs': 'Saved as {encoding}.',
  'editor.saveConflict': 'Save conflict: the file was changed on disk by another tool. Your draft was kept; reload or pick which version to keep.',
  'editor.saveFailed': 'Save failed: {message}. Your draft was kept.',
  'editor.saveAsFailed': 'Cannot save as encoding: {reason}',
  'editor.cancelRestored': 'Edit canceled; reloaded the source file from disk.',
  'editor.cancelFailed': 'Cancel failed: {message}. Your draft was kept.',
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
  'settings.section.title': 'Explorer Settings',
  'settings.group.browse': 'File Browsing',
  'settings.group.content': 'Content Browsing',
  'settings.group.dialog': 'Dialog Settings',
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
  'settings.resetDefault': 'Reset',
  'settings.hint': 'File Browsing: adjust the tree row height, how search results are shown, and the file icon badge colors. Content Browsing: pick a highlight preset per file type, and adjust the save-conflict dialog comparison text size. Dialog Settings: adjust the chat font size; when auto-expand thinking is on, streaming thinking blocks expand automatically and collapse after the configured delay (0–10 s, 0.1 s steps), and manual interaction cancels a pending collapse. Unchanged items use their defaults.',
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
  'mindmap.rootLabel': 'Main session',
  'mindmap.current': 'Current',
  'mindmap.pending': 'Awaiting a new question…',
  'mindmap.streaming': 'Generating…',
  'mindmap.thinking': 'Thinking…',
  'mindmap.done': 'Done',
  'mindmap.emptyRound': '(no text this round)',
  'mindmap.open.hint': 'Create a branch from this card and keep chatting',
  'mindmap.empty': 'This session has no turns to show yet. Once a turn completes, you can split all turns into cards here and branch from any card.',
  'mindmap.loading': 'Loading mind-map session…',
  'mindmap.error': 'Failed to load mind-map session: {message}',
  'mindmap.forkFailed': 'Failed to create branch: {message}',
  'mindmap.created': 'Mind-map session created; the sidebar session list was replaced.',
  'mindmap.forked': 'Branch created here.',
  'mindmap.branchTag': 'branch',
  'mindmap.turnTag': 'Turn {n}',
  'mindmap.rounds': '{n} turns',
  'mindmap.moreRounds': '{n} more turns in history',
  'mindmap.menu.rename': 'Rename branch',
  'mindmap.menu.archiveAll': 'Archive entire mind map',
  'mindmap.rename.title': 'Rename Branch',
  'mindmap.archiveAll.message': 'Archive the entire mind map "{name}"? All its branch sessions will be archived and removed from all lists too.',
  'mindmap.archive.action': 'Archive',
  'mindmap.archivedAll': 'Mind map archived.',
  'mindmap.renamed': 'Branch renamed.',
  'mindmap.menu.deleteCard': 'Delete card',
  'mindmap.delete.title': 'Delete Card',
  'mindmap.delete.message': 'Delete card "{name}"? The conversation will be truncated here: this card, everything after it, and every branch derived from them will be removed, and the original session will be archived (currently no restore path).',
  'mindmap.delete.action': 'Delete',
  'mindmap.delete.current': 'The current session will be archived; the view will switch to the truncated session afterwards.',
  'mindmap.delete.lastTrunk': 'The first trunk card cannot be deleted; a mind map must keep at least one trunk card.',
  'mindmap.delete.missing': 'The card to delete was not found; the document may have changed, please retry.',
  'mindmap.deleted': 'Card and its derived content deleted.',
  'mindmap.truncated': 'Session truncated; the original was archived.',
  'mindmap.view.restore': 'Restore view',
  'mindmap.view.restoreTitle': 'Reset the view size and position',
  'mindmap.scope.full': 'Current fill mode: Full',
  'mindmap.scope.sidebar': 'Current fill mode: Sidebar only',
  'mindmap.scope.title': 'Toggle mind-map scope: full (sidebar + file browser) / sidebar only',
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
   apply() when available; the zh fallback preserves the historical behavior
   in compositions without the locale plugin. */
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
/* Whether the active surface is Chinese: the default (no locale service) and
   the zh locale both keep the historical wording. */
function localeIsZh() {
  return localeFace === undefined || localeFace.getSnapshot().active !== 'en'
}
/* ---- Mobile mode state ---- The document classes are the single source of
   truth (the CSS gates and this store read the same classes), so a remount
   re-derives the state instead of losing it. Components subscribe through
   useMobile(); setMobile turns the gate on (and opens the floating drawer) or
   off (and clears the drawer/files sub-states). */
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
/* Localize a plugin-API error: the Chinese surface keeps the server's own
   message verbatim; the English surface replaces known error codes with the
   dictionary and falls back to the server message or the client-side wrapper
   key otherwise. */
function apiErrorMessage(code, serverMessage, fallbackKey, params) {
  if (localeIsZh() && typeof serverMessage === 'string' && serverMessage !== '') return serverMessage
  if (code !== undefined) {
    const localized = translate(`error.${code}`)
    if (localized !== `error.${code}`) return localized
  }
  if (typeof serverMessage === 'string' && serverMessage !== '') return serverMessage
  return translate(fallbackKey, params)
}
/* Localized display label of one file-color group; language-neutral group
   names (TypeScript, JSON, ...) fall back to the constant label. */
function fileColorGroupLabel(group) {
  const localized = translate(`fileColor.${group}`)
  if (localized !== `fileColor.${group}`) return localized
  return FILE_COLOR_GROUPS.find(item => item.group === group)?.label ?? group
}
/* Localized display label of one highlight preset; language-neutral preset
   names (Python (VS Code), ...) fall back to the constant label. */
function highlightPresetLabel(id) {
  const localized = translate(`preset.${id}`)
  if (localized !== `preset.${id}`) return localized
  return HIGHLIGHT_PRESETS.find(item => item.id === id)?.label ?? id
}

const styles = `
.dsh-wel-viewport{position:relative;height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-wel-frame{--dsh-wel-sidebar:280px;--dsh-wel-preview:420px;position:relative;display:grid;grid-template-columns:var(--dsh-wel-sidebar) var(--dsh-wel-preview) minmax(0,1fr);grid-template-rows:100%;width:100%;min-width:0;height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-wel-frame[data-resizing]{transition:none;user-select:none}.dsh-wel-sidebar,.dsh-wel-tree,.dsh-wel-preview,.dsh-wel-chat{min-width:0;height:100%;overflow:hidden}.dsh-wel-sidebar{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}
.dsh-wel-tree,.dsh-wel-preview{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-wel-frame[data-explorer-closed] .dsh-wel-tree,.dsh-wel-frame[data-explorer-closed] .dsh-wel-preview{visibility:hidden;pointer-events:none;border-right:0}.dsh-wel-chat{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base)}
.dsh-wel-panel-header{display:flex;align-items:center;gap:8px;min-height:52px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}.dsh-wel-panel-title{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}.dsh-wel-panel-title strong{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-panel-title>span{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
/* Preview page top rows (file tabs + active-file name) share the harness left
   sidebar fill so the file browsing page reads as one band with the sidebar. */
.dsh-wel-preview .dsh-wel-panel-header{background:var(--dsw-specific-sidebar-fill)}
.dsh-wel-panel-actions{display:flex;flex:none;align-items:center;gap:2px}.dsh-wel-icon-button,.dsh-wel-text-button{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dsh-wel-icon-button{width:30px;padding:0;font-size:18px}.dsh-wel-icon-button svg{display:block;width:16px;height:16px}.dsh-wel-icon-button:hover,.dsh-wel-text-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-icon-button:disabled,.dsh-wel-text-button:disabled{cursor:not-allowed;opacity:.55}
.dsh-wel-icon-button:focus-visible,.dsh-wel-text-button:focus-visible,.dsh-wel-tree-row:focus-visible,.dsh-wel-preview-tab-button:focus-visible,.dsh-wel-preview-tab-close:focus-visible,.dsh-wel-splitter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-wel-tree-scroll{flex:1;min-height:0;overflow:auto;padding:8px 6px 16px}.dsh-wel-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-wel-row-height,28px);padding:0 7px 0 calc(7px + var(--dsh-wel-depth,0) * 15px);border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-wel-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-tree-row[data-selected]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-wel-tree-row:disabled{cursor:not-allowed;opacity:.55}.dsh-wel-tree-row[data-cut]{opacity:.55}
.dsh-wel-chevron{display:inline-flex;align-items:center;justify-content:center;flex:0 0 12px;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-wel-file-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;border-radius:4px;background:color-mix(in srgb,var(--dsh-wel-file-accent,var(--dsw-alias-label-tertiary)) 16%,transparent);color:var(--dsh-wel-file-accent,var(--dsw-alias-label-tertiary));font-size:8px;font-weight:600;text-transform:uppercase}.dsh-wel-file-mark[data-group='directory']{--dsh-wel-file-accent:var(--dsh-wel-file-directory,#3b82f6)}.dsh-wel-file-mark[data-group='typescript']{--dsh-wel-file-accent:var(--dsh-wel-file-typescript,#3178c6)}.dsh-wel-file-mark[data-group='javascript']{--dsh-wel-file-accent:var(--dsh-wel-file-javascript,#e5c158)}.dsh-wel-file-mark[data-group='json']{--dsh-wel-file-accent:var(--dsh-wel-file-json,#e07a3c)}.dsh-wel-file-mark[data-group='markup']{--dsh-wel-file-accent:var(--dsh-wel-file-markup,#e04a3c)}.dsh-wel-file-mark[data-group='style']{--dsh-wel-file-accent:var(--dsh-wel-file-style,#a855f7)}.dsh-wel-file-mark[data-group='markdown']{--dsh-wel-file-accent:var(--dsh-wel-file-markdown,#12a5a0)}.dsh-wel-file-mark[data-group='log']{--dsh-wel-file-accent:var(--dsh-wel-file-log,#d99a2b)}.dsh-wel-file-mark[data-group='python']{--dsh-wel-file-accent:var(--dsh-wel-file-python,#4b8bb8)}.dsh-wel-file-mark[data-group='shell']{--dsh-wel-file-accent:var(--dsh-wel-file-shell,#22a06b)}.dsh-wel-file-mark[data-group='config']{--dsh-wel-file-accent:var(--dsh-wel-file-config,#8a95a5)}.dsh-wel-file-mark[data-group='c-family']{--dsh-wel-file-accent:var(--dsh-wel-file-c-family,#5a7ba6)}.dsh-wel-file-mark[data-group='csharp']{--dsh-wel-file-accent:var(--dsh-wel-file-csharp,#a25fd0)}.dsh-wel-file-mark[data-group='other']{--dsh-wel-file-accent:var(--dsh-wel-file-other,#9aa3ad)}.dsh-wel-file-mark[data-group='blocked']{--dsh-wel-file-accent:var(--dsh-wel-file-blocked,#e5484d)}.dsh-wel-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-symlink{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-wel-tree-status{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsh-wel-tree-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-wel-empty{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center}
.dsh-wel-preview-header-meta{display:flex;align-items:center;gap:6px;min-width:0}.dsh-wel-preview-header-meta>span:not(.dsh-wel-language):not(.dsh-wel-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-language{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-wel-encoding{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-wel-dirty{color:var(--dsw-alias-state-warn-label);font-size:12px}.dsh-wel-preview-tabs{display:flex;align-items:stretch;gap:4px;min-width:0;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}.dsh-wel-preview-tab{flex:none;display:flex;align-items:center;gap:5px;min-width:0;max-width:220px;height:28px;padding:0 5px 0 9px;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:grab;box-sizing:border-box;white-space:nowrap}.dsh-wel-preview-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-preview-tab[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-wel-preview-tab[data-dragging]{opacity:.7}.dsh-wel-preview-drop-indicator{flex:none;width:3px;height:20px;border-radius:2px;background:var(--dsw-alias-state-business-primary);align-self:center;pointer-events:none}.dsh-wel-preview-tab-button{display:flex;flex:1;align-items:center;gap:5px;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dsh-wel-preview-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.dsh-wel-preview-tab-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}.dsh-wel-preview-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.dsh-wel-preview-tab-close:disabled{cursor:not-allowed;opacity:.45}.dsh-wel-preview-body{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-markdown-code-block)}.dsh-wel-editor-host{height:100%;min-width:0}.dsh-wel-editor-host .cm-editor{height:100%;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary)}.dsh-wel-editor-host .cm-scroller{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:19px;overflow:auto}.dsh-wel-editor-host .cm-gutters{background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-wel-editor-host .cm-activeLine,.dsh-wel-editor-host .cm-activeLineGutter{background:var(--dsw-alias-interactive-bg-hover)}.dsh-wel-editor-host .cm-selectionBackground,.dsh-wel-editor-host .cm-content ::selection{background:var(--dsw-alias-interactive-bg-active)!important}.dsh-wel-editor-host .cm-cursor{border-left-color:var(--dsw-alias-label-primary)}.dsh-wel-editor-host .cm-foldPlaceholder{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}.dsh-wel-editor-host .cm-panels{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-wel-editor-host .cm-panel input{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-wel-context-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;width:min(var(--dsh-composer-card-max-width),max(0px,calc(100% - (var(--dsh-composer-side-clearance) * 2))));margin:0 auto;padding:0}.dsh-wel-context-prefix{display:flex;flex:1;align-items:center;gap:6px;min-width:0;min-height:28px;padding:5px 8px 5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer}.dsh-wel-context-prefix:hover{color:var(--dsw-alias-label-primary)}.dsh-wel-context-prefix:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dsh-wel-context-prefix[data-inactive]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);filter:grayscale(1)}.dsh-wel-context-prefix-mark{flex:none;font-size:12px}.dsh-wel-context-prefix-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-message-context-summary{box-sizing:border-box;display:flex;align-items:center;align-self:flex-end;gap:6px;max-width:100%;min-height:24px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}.dsh-wel-message-context-summary-mark{flex:none;font-size:12px}.dsh-wel-message-context-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-message-context-summary-range{flex:none;color:var(--dsw-alias-label-caption)}.dsh-wel-message-context-bubble[data-dsh-wel-empty-prompt]{display:none}
.dsh-wel-banner{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}.dsh-wel-banner-actions{display:flex;gap:6px;margin-top:5px}.dsh-wel-status{flex:none;box-sizing:border-box;width:100%;padding:4px 12px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:right}.dsh-wel-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-wel-error-card{max-width:300px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:19px;text-align:left}.dsh-wel-dialog-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.38));box-sizing:border-box}.dsh-wel-dialog{width:min(360px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-wel-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-wel-dialog-title{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-wel-dialog-body{display:flex;flex-direction:column;gap:8px;padding:14px}.dsh-wel-dialog-input{width:100%;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;box-sizing:border-box}.dsh-wel-dialog-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dsh-wel-dialog-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-wel-dialog-message{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.dsh-wel-dialog-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-wel-danger-button{color:var(--dsw-alias-state-error-primary)}.dsh-wel-dialog-footer{display:flex;justify-content:flex-end;gap:8px;padding:0 14px 14px}.dsh-wel-conflict-region{display:flex;flex-direction:column;gap:8px;min-height:0}.dsh-wel-conflict-region-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-wel-conflict-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px;min-height:0;flex:1}.dsh-wel-conflict-cols-final{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-wel-conflict-col{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.dsh-wel-conflict-col-label{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-wel-conflict-mine .dsh-wel-conflict-col-label{color:var(--dsw-alias-state-warn-label)}.dsh-wel-conflict-theirs .dsh-wel-conflict-col-label{color:var(--dsw-alias-state-business-primary)}.dsh-wel-conflict-code{margin:0;min-height:0;flex:1;overflow:auto;padding:10px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:var(--dsh-wel-conflict-font-size,12px);line-height:20px;white-space:pre;box-sizing:border-box}.dsh-wel-inline-add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-wel-inline-del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-radius:3px;opacity:.9;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-wel-conflict-code-row{display:inline;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-wel-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 16%,transparent)}.dsh-wel-conflict-mine .dsh-wel-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 20%,transparent);color:var(--dsw-alias-state-warn-label)}.dsh-wel-conflict-theirs .dsh-wel-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-wel-conflict-code-row[data-kind='del']{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);opacity:.85}.dsh-wel-conflict-dialog{width:66vw;max-width:66vw;max-height:min(90vh,1000px);display:flex;flex-direction:column}.dsh-wel-conflict-dialog .dsh-wel-dialog-body{flex:1;min-height:0;overflow:auto}.dsh-wel-conflict-progress{margin-left:8px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:18px;white-space:nowrap}
.dsh-wel-frame [data-slot='sidebar.footer.action']{display:flex!important;flex-direction:column;align-items:stretch;width:100%;min-width:0}
.dsh-wel-splitter{position:absolute;top:0;bottom:0;z-index:8;width:8px;margin-left:-4px;border:0;background:transparent;cursor:col-resize;touch-action:none}.dsh-wel-splitter::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-wel-splitter:hover::after,.dsh-wel-splitter[data-dragging]::after,.dsh-wel-splitter:focus-visible::after{background:var(--dsw-alias-state-business-primary)}.dsh-wel-details{position:absolute;z-index:16;top:0;right:0;bottom:0;width:min(440px,45vw);overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px var(--dsw-alias-bg-mask-1));transform:translateX(0);opacity:1;transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-wel-details[data-closed]{pointer-events:none;visibility:hidden;transform:translateX(100%);opacity:0}.dsh-wel-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}.dsh-wel-overlay>*{pointer-events:auto}.dsh-wel-tree{position:relative}.dsh-wel-context-menu{position:fixed;z-index:40;min-width:168px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-wel-context-item{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:30px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-wel-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-context-item-danger{color:var(--dsw-alias-state-error-primary)}.dsh-wel-context-item-danger:hover{color:var(--dsw-alias-state-error-primary)}.dsh-wel-context-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-wel-context-item:disabled{cursor:not-allowed;opacity:.5}.dsh-wel-context-item:disabled:hover{background:transparent;color:var(--dsw-alias-label-primary)}.dsh-wel-context-separator{height:1px;margin:4px 0;border:0;background:var(--dsw-alias-border-l2)}.dsh-wel-copy-notice{position:absolute;right:10px;bottom:10px;z-index:12;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}@media(prefers-reduced-motion:reduce){.dsh-wel-frame,.dsh-wel-details,.dsh-wel-splitter::after{transition:none}}
.dsh-wel-search-header{flex-direction:column;align-items:stretch;gap:8px;padding:8px}
.dsh-wel-search-input-row{display:flex;align-items:center;gap:6px}
.dsh-wel-search-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}
.dsh-wel-search-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-search-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-wel-search-case{width:34px;padding:0;font-size:11px;font-weight:600}
.dsh-wel-icon-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-wel-text-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-wel-search-summary{padding:8px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-wel-search-file{margin:2px 0}
.dsh-wel-search-file-header{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-wel-search-file-header:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-wel-search-file-count{flex:none;color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-wel-search-truncated{flex:none;color:var(--dsw-alias-state-warn-label);font-size:10px}
.dsh-wel-search-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:22px;padding:2px 7px 2px 18px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-wel-search-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-wel-search-line{flex:none;width:32px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;text-align:right}
.dsh-wel-search-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-search-hit{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-radius:2px}
.dsh-wel-settings-row{display:flex;align-items:center;gap:10px}.dsh-wel-settings-label{flex:none;min-width:64px;color:var(--dsw-alias-label-primary);font-size:13px}.dsh-wel-settings-slider{flex:1;min-width:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-wel-settings-checkbox{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-wel-settings-value{flex:none;min-width:48px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}.dsh-wel-settings-hint{padding:0 14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-wel-explorer-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:560px}.dsh-wel-explorer-settings .dsh-wel-settings-label{min-width:88px}.dsh-wel-explorer-settings .dsh-wel-settings-slider{max-width:320px}.dsh-wel-explorer-settings .dsh-wel-settings-hint{padding:0}.dsh-wel-settings-group{display:flex;flex-direction:column;gap:10px}.dsh-wel-settings-group-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:22px}.dsh-wel-settings-group-title::before{content:'';flex:none;width:3px;height:14px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}.dsh-wel-explorer-divider{height:1px;margin:0;border:0;background:var(--dsw-alias-border-l2)}.dsh-wel-file-colors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px}.dsh-wel-file-colors-title{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}.dsh-wel-file-color-row{display:flex;align-items:center;gap:10px;min-height:26px}.dsh-wel-file-color-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dsh-wel-file-color-input{flex:none;width:32px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;cursor:pointer;box-sizing:border-box}.dsh-wel-file-color-input::-webkit-color-swatch-wrapper{padding:2px}.dsh-wel-file-color-input::-webkit-color-swatch{border:0;border-radius:2px}.dsh-wel-file-color-reset{flex:none;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:24px;cursor:pointer}.dsh-wel-file-color-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-file-color-reset:disabled{cursor:not-allowed;opacity:.55}.dsh-wel-file-colors-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding-top:2px}
.dsh-wel-chat{--dsw-font-markdown-h1:700 calc(24px * var(--dsh-wel-chat-font-scale,1)) / calc(34px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h2:700 calc(22px * var(--dsh-wel-chat-font-scale,1)) / calc(32px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h3:700 calc(20px * var(--dsh-wel-chat-font-scale,1)) / calc(30px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-h4:600 calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base:calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-strong:600 calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-italic:italic calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-base-strong-italic:italic 600 calc(16px * var(--dsh-wel-chat-font-scale,1)) / calc(28px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-table:calc(15px * var(--dsh-wel-chat-font-scale,1)) / calc(25px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-table-head:500 calc(15px * var(--dsh-wel-chat-font-scale,1)) / calc(25px * var(--dsh-wel-chat-font-scale,1)) var(--dsw-font-family);--dsw-font-markdown-code:calc(14px * var(--dsh-wel-chat-font-scale,1)) / calc(22px * var(--dsh-wel-chat-font-scale,1)) var(--ds-font-family-code);--dsw-font-markdown-code-block:calc(13px * var(--dsh-wel-chat-font-scale,1)) / calc(22px * var(--dsh-wel-chat-font-scale,1)) var(--ds-font-family-code);--dsw-font-markdown-code-block-small:calc(12px * var(--dsh-wel-chat-font-scale,1)) / calc(18px * var(--dsh-wel-chat-font-scale,1)) var(--ds-font-family-code)}
.dsh-wel-chat [data-chat-flow-kind='user'] [data-time-hover-root] > div:first-child > div:last-child,.dsh-wel-chat [data-chat-flow-kind='steering'] [data-time-hover-root] > div:first-child > div:last-child,.dsh-wel-chat [data-pending-steering] > div:first-child > div:last-child{font-size:calc(16px * var(--dsh-wel-chat-font-scale,1));line-height:calc(24px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-tool],.dsh-wel-chat [data-sample='bash'],.dsh-wel-chat [data-variant='think']{font-size:calc(14px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-tool] [data-disclosure-row] :is(span,button),.dsh-wel-chat [data-sample='bash'] span,.dsh-wel-chat [data-variant='think'] span,.dsh-wel-chat [data-variant='think'] > div > div{font-size:1em}
.dsh-wel-chat [data-chat-flow]{gap:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] [data-slot='conversation.chat.node'] > div > div{gap:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] p:not(li p),.dsh-wel-chat [data-chat-flow-kind='assistant-step'] :where(ul,ol,h4,h5,h6,pre){margin-top:calc(12px * var(--dsh-wel-chat-font-scale,1));margin-bottom:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] :where(h1,h2,h3){margin-top:calc(24px * var(--dsh-wel-chat-font-scale,1));margin-bottom:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] hr{margin:calc(24px * var(--dsh-wel-chat-font-scale,1)) 0}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] blockquote{margin-top:calc(12px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] li:not(:first-child){margin-top:calc(4px * var(--dsh-wel-chat-font-scale,1))}
.dsh-wel-chat [data-chat-flow-kind='assistant-step'] li > p{margin:calc(6px * var(--dsh-wel-chat-font-scale,1)) 0}
.dsh-wel-preview-tab-close[data-pinned]{color:var(--dsw-alias-state-business-primary);width:22px;height:22px}
.dsh-wel-preview-tab-close[data-pinned] svg{display:block;width:18px;height:18px}
.dsh-wel-highlight-preset-select{flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}.dsh-wel-highlight-preset-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#0451a5;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#4ec9b0;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#ce9178;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6}
.dsh-wel-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#b4452c;--shiki-token-string:#8a5a00;--shiki-token-comment:#a06a4a;--shiki-token-keyword:#c2410c;--shiki-token-parameter:#d97706;--shiki-token-function:#be185d;--shiki-token-string-expression:#9a3412;--shiki-token-punctuation:#6b4a3f;--shiki-token-link:#9a3412}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#ff8a65;--shiki-token-string:#ffd54f;--shiki-token-comment:#c8a48c;--shiki-token-keyword:#ff9e6d;--shiki-token-parameter:#ffb74d;--shiki-token-function:#f472b6;--shiki-token-string-expression:#ffcc80;--shiki-token-punctuation:#e0c8bb;--shiki-token-link:#ffab91}
.dsh-wel-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#1971c2;--shiki-token-string:#0f766e;--shiki-token-comment:#6f7d94;--shiki-token-keyword:#364fc7;--shiki-token-parameter:#0b7285;--shiki-token-function:#7048e8;--shiki-token-string-expression:#099268;--shiki-token-punctuation:#49576b;--shiki-token-link:#1c7ed6}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#4dabf7;--shiki-token-string:#38d9a9;--shiki-token-comment:#8fa3c2;--shiki-token-keyword:#91a7ff;--shiki-token-parameter:#22b8cf;--shiki-token-function:#b197fc;--shiki-token-string-expression:#63e6be;--shiki-token-punctuation:#b6c2d6;--shiki-token-link:#74c0fc}
.dsh-wel-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#3f3f3f;--shiki-token-string:#2e2e2e;--shiki-token-comment:#9d9d9d;--shiki-token-keyword:#e8590c;--shiki-token-parameter:#565656;--shiki-token-function:#7a7a7a;--shiki-token-string-expression:#4a4a4a;--shiki-token-punctuation:#8a8a8a;--shiki-token-link:#a0a0a0}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#d0d0d0;--shiki-token-string:#e2e2e2;--shiki-token-comment:#6e6e6e;--shiki-token-keyword:#ffa94d;--shiki-token-parameter:#a8a8a8;--shiki-token-function:#bfbfbf;--shiki-token-string-expression:#cfcfcf;--shiki-token-punctuation:#8f8f8f;--shiki-token-link:#7d7d7d}
/* VS Code default theme (Light+/Dark+) XML palette: tag names ride the
   function token (tagName -> typeName), attribute names the parameter token
   (attributeName -> propertyName), values/entities the string token, and the
   two extra vars cover angle brackets and entity characters. */
.dsh-wel-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#008000;--shiki-token-function:#800000;--shiki-token-parameter:#e50000;--shiki-token-string:#a31515;--shiki-token-string-expression:#0000ff;--dsh-wel-token-xml-punctuation:#800000;--dsh-wel-token-xml-entity:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#6A9955;--shiki-token-function:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-string:#ce9178;--shiki-token-string-expression:#569cd6;--dsh-wel-token-xml-punctuation:#808080;--dsh-wel-token-xml-entity:#569cd6}
/* VS Code default theme (Light+/Dark+) shared token palette: one rule serves
   every non-XML vscode-* preset, since VS Code colors all languages with the
   same theme. */
.dsh-wel-editor-host[data-highlight-preset='vscode-python'],.dsh-wel-editor-host[data-highlight-preset='vscode-json'],.dsh-wel-editor-host[data-highlight-preset='vscode-typescript'],.dsh-wel-editor-host[data-highlight-preset='vscode-javascript'],.dsh-wel-editor-host[data-highlight-preset='vscode-css'],.dsh-wel-editor-host[data-highlight-preset='vscode-markdown'],.dsh-wel-editor-host[data-highlight-preset='vscode-shell'],.dsh-wel-editor-host[data-highlight-preset='vscode-config'],.dsh-wel-editor-host[data-highlight-preset='vscode-cpp'],.dsh-wel-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#795e26;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-python'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-json'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-typescript'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-javascript'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-css'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-markdown'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-shell'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-config'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-cpp'],body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#b5cea8;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#dcdcaa;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6}
.dsh-wel-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#000000;--shiki-token-function:#2b91af;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff}
body[data-ds-dark-theme] .dsh-wel-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#b5cea8;--shiki-token-string:#d69d85;--shiki-token-comment:#57a64a;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#dcdcdc;--shiki-token-function:#4ec9b0;--shiki-token-string-expression:#d69d85;--shiki-token-punctuation:#b4b4b4;--shiki-token-link:#569cd6}
/* Preprocessor directive color (C# #if/#region, ...): purple on both themes,
   lighter in dark for contrast; overridable per preset. */
.dsh-wel-editor-host{--dsh-wel-token-directive:#8e44ad}
body[data-ds-dark-theme] .dsh-wel-editor-host{--dsh-wel-token-directive:#c586c0}
/* Sidebar top actions: the harness New Session button (the root div's only
   direct button) is hidden and the plugin draws its own two-button row —
   New Session / workspace files — in the same flow position. */
.dsh-wel-frame [data-slot="sidebar"] > div > button{display:none}
.dsh-wel-sidebar-top-actions{flex:none;min-width:0;display:flex;align-items:stretch;gap:6px;height:38px;margin:0 2px 8px;box-sizing:border-box}
.dsh-wel-sidebar-top-action{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden;white-space:nowrap}
.dsh-wel-sidebar-top-action:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-wel-sidebar-top-action[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-primary)}
.dsh-wel-sidebar-top-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-wel-sidebar-top-icon{flex:none;width:14px;height:14px}
.dsh-wel-sidebar-top-icon svg{display:block;width:100%;height:100%}
.dsh-wel-sidebar-top-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Collapsed rail: the two controls become icon-only 36px buttons, stacked. */
.dsh-wel-sidebar-top-actions[data-rail]{flex-direction:column;align-items:flex-start;gap:0;height:auto;margin:0 0 12px;position:relative;z-index:10}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-action{flex:none;width:36px;height:36px;padding:0;gap:0;border-color:transparent;background:transparent}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-icon{width:18px;height:18px}
.dsh-wel-sidebar-top-actions[data-rail] .dsh-wel-sidebar-top-label{display:none}
/* Collapsed rail: hide the harness workspace browser's rail controls (search
   + add workspace) — the plugin's two nav tabs are the only region icons. */
.dsh-wel-frame[data-sidebar-collapsed] [data-slot="sidebar.workspaces"] > *{display:none}
/* Sidebar files region: the harness workspace browser is hidden while the
   plugin's file tree fills the region seat (fused into the sidebar). */
.dsh-wel-sidebar-files{display:none}
.dsh-wel-frame[data-sidebar-files] [data-slot="sidebar.workspaces"] > :not(.dsh-wel-sidebar-files){display:none}
/* The sidebar shell hides nested scrollbars until the pointer is over the
   column (quietBars); the file list is scroll-heavy, so its scrollbar stays
   visible. The files panel is inset 12px on both sides (the harness region
   otherwise extends flush to the right edge) so it reads as a symmetric card. */
.dsh-wel-frame[data-sidebar-files] .dsh-wel-sidebar-files{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;margin-right:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-wel-frame[data-sidebar-files] .dsh-wel-sidebar-files .dsh-wel-tree{flex:1;min-height:0;height:auto;border-right:0}
/* CodeMirror search panel (Ctrl+F): rendered by panels({ topContainer }) into
   the .dsh-wel-preview-search strip between the status bar and the preview
   body, so the panel rules are scoped to that container. !important keeps the
   controls legible regardless of the harness's global control styles; the
   alias tokens adapt to the active GUI theme. Match marks live in the editor
   content, so they stay scoped to the editor host. */
.dsh-wel-preview-search{flex:none;min-width:0;background:var(--dsw-alias-bg-layer-1);user-select:none}
.dsh-wel-preview-search .cm-panels.cm-panels-top{background:var(--dsw-alias-bg-layer-1)!important;color:var(--dsw-alias-label-primary)!important;border-bottom:1px solid var(--dsw-alias-border-l2)!important}
.dsh-wel-preview-search .cm-panel.cm-search{padding:5px 36px 5px 6px}
.dsh-wel-preview-search .cm-panel.cm-search .cm-textfield{height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:6px;background:var(--dsw-alias-bg-base)!important;color:var(--dsw-alias-label-primary)!important;font:inherit!important;font-size:12px!important;box-sizing:border-box;user-select:text}
.dsh-wel-preview-search .cm-panel.cm-search .cm-textfield:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-preview-search .cm-panel.cm-search .cm-button{height:26px;padding:0 8px;border:0!important;border-radius:6px;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font:inherit!important;font-size:12px!important;cursor:pointer}
.dsh-wel-preview-search .cm-panel.cm-search .cm-button:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
.dsh-wel-preview-search .cm-panel.cm-search label{display:inline-flex;align-items:center;gap:3px;height:28px;transform:translateY(3px);color:var(--dsw-alias-label-secondary)!important}
.dsh-wel-preview-search .cm-panel.cm-search input[type=checkbox]{margin:2px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-state-business-primary)}
.dsh-wel-preview-search .cm-panel.cm-search [name=close]{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:absolute!important;top:50%!important;right:4px!important;transform:translateY(-50%)!important;width:30px!important;height:30px!important;padding:0 0 2px!important;margin:0!important;border:0!important;border-radius:8px!important;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font-size:18px!important;line-height:1!important;cursor:pointer!important;box-sizing:border-box!important}
.dsh-wel-preview-search .cm-panel.cm-search [name=close]:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
/* The search field is wrapped (see CodeEditor) with a col-resize grip on its
   right edge so the user can drag it wider/narrower. */
.dsh-wel-preview-search .dsh-wel-search-field-wrap{display:inline-flex;align-items:center;vertical-align:middle}
.dsh-wel-preview-search .dsh-wel-search-field-wrap .cm-textfield{flex:none;min-width:60px}
.dsh-wel-preview-search .dsh-wel-search-resize{flex:none;width:6px;height:16px;margin:0 2px 0 4px;border-radius:3px;background:var(--dsw-alias-border-l2);cursor:col-resize;opacity:.65}
.dsh-wel-preview-search .dsh-wel-search-resize:hover{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-wel-preview-search .dsh-wel-search-resize:active{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-wel-editor-host .cm-searchMatch{background-color:var(--dsw-alias-state-business-tertiary)!important}
.dsh-wel-editor-host .cm-searchMatch-selected{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent)!important}
.dsh-wel-editor-host .cm-selectionMatch{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)!important}
.dsh-wel-editor-host .cm-searchMatch .cm-selectionMatch{background-color:transparent!important}
.dsh-wel-drop-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);pointer-events:none}
.dsh-wel-drop-hint{display:inline-flex;align-items:center;padding:8px 14px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-business-primary);font-size:12px;box-shadow:var(--dsw-shadow-elevated,0 8px 24px rgba(0,0,0,.18))}
.dsh-wel-preview[data-drop-active] .dsh-wel-preview-tabs,.dsh-wel-preview[data-drop-active] .dsh-wel-panel-header,.dsh-wel-preview[data-drop-active] .dsh-wel-editor-host{pointer-events:none}
/* Hide the harness's full-viewport chat drop mask (ui-attachment DropOverlay,
   the only role="status" element portaled directly to body — verified against
   the harness tree; its Toast uses role="alert" and every other role="status"
   lives inside the app tree); the layout draws its own chat-confined mask
   below so the mask covers the chat pane instead of the whole page. */
body > [role="status"]{display:none!important}
.dsh-wel-chat-drop-mask{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.32));backdrop-filter:blur(6px);pointer-events:none}
.dsh-wel-chat-drop-card{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-wel-chat-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-wel-chat-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Close button on the preview drop hint, matching the chat drop mask. */
.dsh-wel-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-wel-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Transient top-center banner matching the harness conversation Toast look
   (contrast fill, inverted label, slide-in, hold-and-fade) so a failed
   external-file open announces like the composer's image-intake rejections.
   Positioned inside the preview pane (not a viewport portal) so the notice
   stays scoped to the panel. */
.dsh-wel-toast{position:absolute;top:12px;left:50%;z-index:60;pointer-events:none;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 48px));padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);animation:dsh-wel-toast-in 160ms ease-out,dsh-wel-toast-fade 1000ms ease 3000ms forwards}
.dsh-wel-toast-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-state-warn-label)}
.dsh-wel-toast-text{min-width:0}
@keyframes dsh-wel-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes dsh-wel-toast-fade{to{opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-wel-toast{animation:dsh-wel-toast-fade 1000ms ease 3000ms forwards}}
/* ── Session switcher (right-header title → quick-switch dropdown) ──────
   The conversation header's current-title crumb (the last crumb segment) is
   hidden so the switcher trigger — rendered in
   conversation.session.header.actions at order -400 — becomes the visible
   session title; subagent parent breadcrumbs stay (only the self crumb is
   hidden). The panel is portalled to body with fixed positioning, so the
   chat column's overflow never clips it. */
[data-slot="conversation.session.header"] > header > div:first-child > div:first-child > nav > span:last-child{display:none}
.dsh-wel-session-switcher{display:inline-flex;align-items:center;min-width:0;flex:0 0 auto}
.dsh-wel-session-switcher-trigger{display:inline-flex;align-items:center;gap:4px;max-width:min(320px,60vw);min-width:0;padding:2px 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;box-sizing:border-box}
.dsh-wel-session-switcher-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-wel-session-switcher-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-wel-session-switcher-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-session-switcher .dsh-wel-chevron{flex:none;font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary)}
.dsh-wel-session-switcher-panel{position:fixed;z-index:60;max-height:min(60vh,420px);overflow-y:auto;padding:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-wel-session-switcher-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dsh-wel-session-switcher-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-wel-session-switcher-row.dsh-wel-session-switcher-current{color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-wel-session-switcher-row-main{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-session-switcher-badge{flex:none;margin-left:4px;padding:0 5px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:400}
.dsh-wel-session-switcher-row-ws{flex:none;max-width:40%;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
.dsh-wel-session-switcher-empty{padding:8px 10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
/* ── Mobile (phone-column) mode ─────────────────────────────────────────
   Mirror of dsh-mobile-preview: the document-class gate (dsh-wel-mobile-on)
   drives every override; the floating sidebar drawer and the file-fullscreen
   view ride sibling classes. Desktop layout is untouched when the gate is
   absent. In-flow order of the frame is aside(1) preview(2) chat(3); the
   aside becomes an absolute drawer, so explicit grid-column keeps each
   section in the phone track. */
.dsh-wel-mobile-toggle{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:0;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left}.dsh-wel-mobile-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-wel-mobile-toggle[data-open]{color:var(--dsw-alias-brand-primary)}.dsh-wel-mobile-toggle[data-rail]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-wel-mobile-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-wel-mobile-toggle-icon{flex:none;width:16px;height:16px}.dsh-wel-mobile-toggle[data-rail] .dsh-wel-mobile-toggle-icon{width:18px;height:18px}.dsh-wel-mobile-toggle-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html.dsh-wel-mobile-on .dsh-wel-frame{grid-template-columns:0 minmax(0,430px) 0!important;justify-content:center}
html.dsh-wel-mobile-on .dsh-wel-chat{grid-column:2}
html.dsh-wel-mobile-on .dsh-wel-preview{display:none}
html.dsh-wel-mobile-on .dsh-wel-sidebar{position:absolute;top:0;bottom:0;left:0;z-index:30;width:min(280px,85vw);box-shadow:8px 0 24px #0000002e;transform:translateX(-100%);transition:transform .2s var(--ds-ease-in-out)}
html.dsh-wel-mobile-on .dsh-wel-sidebar [data-slot="sidebar"] > div{width:100%!important}
html.dsh-wel-mobile-on.dsh-wel-mobile-drawer-open .dsh-wel-sidebar{transform:translateX(0)}
html.dsh-wel-mobile-on .dsh-wel-splitter{display:none}
html.dsh-wel-mobile-on .dsh-wel-details{display:none}
html.dsh-wel-mobile-on [data-slot="sidebar"] > div > div:first-child > button:last-child{display:none}
.dsh-wel-mobile-scrim{position:absolute;inset:0;z-index:25;background:#00000047}
/* File content browsing fills the phone column below the pinned conversation
   header (height measured into --dsh-wel-mobile-header-h); the chat's scroll
   area (messages + composer) is hidden so only the header stays reachable. */
html.dsh-wel-mobile-on.dsh-wel-mobile-files-on .dsh-wel-frame{grid-template-columns:0 minmax(0,430px) 0!important}
html.dsh-wel-mobile-on.dsh-wel-mobile-files-on .dsh-wel-preview{display:flex;grid-column:2;visibility:visible;pointer-events:auto;box-sizing:border-box;padding-top:var(--dsh-wel-mobile-header-h,52px)}
html.dsh-wel-mobile-on.dsh-wel-mobile-files-on .dsh-wel-chat{position:fixed;top:0;left:50%;width:min(430px,100%);margin-left:calc(min(430px,100%) / -2);z-index:3;height:var(--dsh-wel-mobile-header-h,52px);overflow:hidden}
html.dsh-wel-mobile-on.dsh-wel-mobile-files-on .dsh-wel-chat [data-slot="conversation"] [data-conversation-scroll]{display:none}
/* In file-fullscreen the conversation's view tabs (chat/trajectory) are pinned
   with the title row; they belong to the chat, not the file page, so they are
   hidden and the file content starts flush under the title row (which is also
   what --dsh-wel-mobile-header-h measures after this rule applies). */
html.dsh-wel-mobile-on.dsh-wel-mobile-files-on [data-slot="conversation.session.header"] > header > div[role="tablist"]{display:none}
/* Session-header controls: hidden outside mobile, inline at the phone column's
   top-left in mobile (whale first, file button right after it). */
.dsh-wel-mobile-controls{display:none;align-items:center;gap:2px}
html.dsh-wel-mobile-on .dsh-wel-mobile-controls{display:flex;order:-1}
.dsh-wel-mobile-whale,.dsh-wel-mobile-files{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-wel-mobile-whale:hover,.dsh-wel-mobile-files:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-wel-mobile-active{color:var(--dsw-alias-brand-primary)}
.dsh-wel-mobile-files-icon{width:16px;height:16px}
html.dsh-wel-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child,html.dsh-wel-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child > div:nth-child(2){display:contents}
html.dsh-wel-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > nav{flex:1}
html.dsh-wel-mobile-on [data-slot="conversation.session.header.utilities"]{display:none!important}
/* Hero whale + file button: a frame-level overlay visible only on the
   blank-session hero (the :has gate mirrors ConversationRoot's own hero
   decision). */
.dsh-wel-mobile-hero{display:none;position:absolute;top:10px;left:calc(max(0px,50% - 215px) + 8px)}
html.dsh-wel-mobile-on:has([data-slot="conversation"] [data-phase="hero"]) .dsh-wel-mobile-hero{display:flex;align-items:center;gap:2px}
/* Settings dialog (the harness Settings panel from the sidebar.settings seat):
   in mobile the centered 800px modal becomes a fullscreen phone panel with the
   section nav as a horizontal bar at the bottom, mirroring dsh-mobile-preview.
   The drawer keeps a transform even when open (translateX(0)), which would
   make the dialog's position:fixed overlay resolve against the 280px drawer
   instead of the viewport; dropping the transform while the dialog is open
   frees the modal to cover the phone column. */
html.dsh-wel-mobile-on .dsh-wel-sidebar:has([data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]){transform:none;transition:none}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav){width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0;flex-direction:column;overflow:hidden}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav{order:2;flex:none;display:flex;flex-direction:row;align-items:center;gap:8px;width:100%;padding:8px 12px 10px;box-sizing:border-box;overflow-x:auto;scrollbar-width:thin}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:last-child{display:flex;flex-direction:row;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:last-child > button{flex:none}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:first-child{position:absolute;top:0;left:0;z-index:1;display:flex;align-items:center;height:54px;padding:0 16px;box-sizing:border-box;white-space:nowrap}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > div{flex:1;min-height:0;display:flex;flex-direction:column}
html.dsh-wel-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > div > div:first-child{height:auto;min-height:54px;align-items:center;padding:12px 16px}
.dsh-wel-tree-rename{box-sizing:border-box;width:100%;padding:0 7px 0 calc(7px + var(--dsh-wel-depth,0) * 15px)}
.dsh-wel-tree-rename-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-wel-row-height,28px);box-sizing:border-box}
.dsh-wel-tree-rename-input{flex:1;min-width:0;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;box-sizing:border-box}
.dsh-wel-tree-rename-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-wel-tree-rename-error{padding:2px 0 4px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:15px}
.dsh-wel-session-rename-overlay{position:fixed;z-index:45;box-sizing:border-box;padding:0}
.dsh-wel-session-rename-input{width:100%;height:100%;box-sizing:border-box;padding:0 4px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.dsh-wel-session-rename-input:disabled{opacity:.7;cursor:not-allowed}
.dsh-wel-session-rename-error{position:fixed;z-index:45;max-width:280px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}
.dsh-wel-copy-notice[data-error]{color:var(--dsw-alias-state-error-primary)}
/* Mind-map conversation branching view ("导图") and the sidebar branch-row
   hider (fork children are hidden from the harness session list; branches
   live in the mind map). */
.dsh-wel-mindmap{height:100%;position:relative;box-sizing:border-box;padding:14px 16px 190px;display:flex;flex-direction:column;overflow:hidden}
.dsh-wel-mindmap-toolbar{flex:none;display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dsh-wel-mindmap-toolbar-button{flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-wel-mindmap-toolbar-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
/* The window-scope toggle (full left area vs sidebar column only): pressed
   state mirrors the session-header button pattern; hidden on mobile where the
   overlay is always full screen. */
.dsh-wel-mindmap-toolbar-button[aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}
html.dsh-wel-mobile-on .dsh-wel-mindmap-scope-toggle{display:none}
.dsh-wel-mindmap-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dsh-wel-mindmap-viewport[data-dragging]{cursor:grabbing;user-select:none}
/* The floating mind-map window: everything left of the chat column (width =
   100% - chat width, tracked live), the chat stays visible on the right. */
.dsh-wel-mindmap-overlay{position:fixed;top:0;bottom:0;left:0;z-index:30;display:flex;flex-direction:column;min-width:0;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24))}
.dsh-wel-mindmap-overlay .dsh-wel-mindmap{flex:1;min-height:0;padding-bottom:14px}
.dsh-wel-mindmap-overlay-close{position:absolute;top:10px;right:10px;z-index:2;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box}
.dsh-wel-mindmap-overlay-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* The convert-to-mind-map confirm dialog: a roomier modal than the default
   dialog (larger width, more padding) with pill buttons — the cancel button
   gets a neutral border, the confirm button a primary-colored border. */
.dsh-wel-mindmap-confirm-dialog{width:min(440px,100%)}
.dsh-wel-mindmap-confirm-dialog .dsh-wel-dialog-body{padding:18px 20px}
.dsh-wel-mindmap-confirm-dialog .dsh-wel-dialog-message{font-size:14px;line-height:22px}
.dsh-wel-mindmap-confirm-dialog .dsh-wel-dialog-footer{padding:0 20px 18px;gap:10px}
.dsh-wel-mindmap-confirm-button{height:34px;padding:0 18px;border-radius:999px;font-size:13px}
.dsh-wel-mindmap-confirm-cancel{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-wel-mindmap-confirm-cancel:hover{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}
.dsh-wel-mindmap-confirm-ok{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dsh-wel-mindmap-confirm-ok:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);border-color:var(--dsw-alias-state-business-primary)}
/* The session-header 导图 toggle button. */
.dsh-wel-mindmap-header-button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;box-sizing:border-box}
.dsh-wel-mindmap-header-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-wel-mindmap-header-button-on,.dsh-wel-mindmap-header-button[aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}
.dsh-wel-mindmap-header-icon{width:14px;height:14px;flex:none}
html.dsh-wel-mobile-on .dsh-wel-mindmap-header-button{display:none}
.dsh-wel-mindmap-canvas{position:absolute;left:0;top:0;transform-origin:0 0}
.dsh-wel-mindmap-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}
.dsh-wel-mindmap-edge{fill:none;stroke:var(--dsw-alias-border-l2,#8a8f98);stroke-width:1.5;opacity:.85}
.dsh-wel-mindmap-node{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px;text-align:left;cursor:pointer;overflow:hidden;transition:border-color .12s ease,box-shadow .12s ease}
.dsh-wel-mindmap-node:hover{border-color:var(--dsw-alias-state-business-primary)}
.dsh-wel-mindmap-node-current{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-wel-mindmap-node-title{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsh-wel-mindmap-node-q{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);flex:1;min-height:0}
.dsh-wel-mindmap-node-status{flex:none;font-size:11px;line-height:15px}
.dsh-wel-mindmap-node-thinking{color:var(--dsw-alias-state-business-primary)}
.dsh-wel-mindmap-node-done{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsh-wel-mindmap-node-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.dsh-wel-mindmap-branch{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-wel-mindmap-branch:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-wel-mindmap-branch:disabled{opacity:.55;cursor:not-allowed}
.dsh-wel-mindmap-node-current-badge{position:absolute;top:3px;right:8px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);font-size:10px;line-height:14px}
/* Branch cards: fork children that cannot be connected to the shared trunk by
   overlapping windows render as their own card (always visible), with a head
   row (tag + branch title) and, when the branch has visible rounds, a preview
   list with a per-round branch action. */
.dsh-wel-mindmap-pending{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch}
.dsh-wel-mindmap-branchcard{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsw-alias-state-business-primary) 6%)}
/* The live streaming card (a turn in flight, ephemeral UI — replaced by the
   normal card once the turn completes) and the frame that encloses it with
   its parent card as one unit. */
.dsh-wel-mindmap-node-streaming{border-color:var(--dsw-alias-state-business-primary);cursor:default;animation:dsh-wel-mindmap-node-streaming-pulse 1.6s ease-in-out infinite}
.dsh-wel-mindmap-node-frame-parent{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,var(--dsw-alias-border-l2));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent)}
.dsh-wel-mindmap-node-streaming-status{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-business-primary)}
.dsh-wel-mindmap-node-streaming-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);animation:dsh-wel-mindmap-dot-pulse 1s ease-in-out infinite}
.dsh-wel-mindmap-frame{position:absolute;border:1.5px dashed var(--dsw-alias-state-business-primary);border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,transparent);pointer-events:none}
@keyframes dsh-wel-mindmap-node-streaming-pulse{0%,100%{box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}}
@keyframes dsh-wel-mindmap-dot-pulse{0%,100%{opacity:1}50%{opacity:.25}}
.dsh-wel-mindmap-pending-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-wel-mindmap-pending-label{flex:none;padding:1px 7px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:999px;color:var(--dsw-alias-state-business-primary);font-size:10px;line-height:14px}
.dsh-wel-mindmap-pending-title{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-mindmap-pending-count{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-wel-mindmap-branch-round{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:8px;row-gap:1px;align-items:center;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1,transparent);border-radius:8px;background:var(--dsw-alias-bg-base)}
.dsh-wel-mindmap-branch-round .dsh-wel-mindmap-node-q{grid-column:1;font-size:11px;line-height:15px;flex:none;-webkit-line-clamp:1}
.dsh-wel-mindmap-branch-round .dsh-wel-mindmap-node-status{grid-column:1;font-size:11px;line-height:15px}
.dsh-wel-mindmap-branch-round .dsh-wel-mindmap-branch{grid-column:2;grid-row:1 / span 2;align-self:center}
.dsh-wel-mindmap-more{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsh-wel-mindmap-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-wel-mindmap-bar-title{font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-mindmap-status{display:flex;align-items:flex-start;justify-content:center;padding:48px 24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:center}
.dsh-wel-mindmap-error{color:var(--dsw-alias-state-error-primary)}
.dsh-wel-mindmap-fork-error{position:sticky;top:0;z-index:2;margin-bottom:10px;padding:6px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:17px}
.dsh-wel-mindmap-notice{margin-bottom:10px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px}
.dsh-wel-mindmap-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-wel-mindmap-node[data-branch]{border-style:solid}
/* Selected-card ancestor trace: the current (solid-highlighted) card's chain
   back to the root — every connecting edge turns into a dashed primary-blue
   line, every parent node gets a dashed primary-blue border. The ancestor
   selector is a two-class compound so it beats the branch node rule
   dsh-wel-mindmap-node[data-branch] { border-style:solid } (same specificity,
   later in source). */
.dsh-wel-mindmap-edge-active{stroke:var(--dsw-alias-state-business-primary);stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-wel-mindmap-node.dsh-wel-mindmap-node-ancestor{border-style:dashed;border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsh-wel-mindmap-hidden-row{display:none!important}
/* Sidebar mind-map session entries: rendered INSIDE each workspace group's
   session list (one container appended to its group section), so a mind map
   shows among the ordinary sessions of the workspace it belongs to. In flat /
   search list modes (no group sections) a single region-area fallback seat is
   used instead. Entries are draggable to reorder (order persisted per group)
   and carry a right-click menu (rename / reveal). Empty containers collapse. */
.dsh-wel-sidebar-mindmaps{min-width:0;display:flex;flex-direction:column;gap:2px;padding:2px 8px 4px;box-sizing:border-box}
.dsh-wel-sidebar-mindmaps:empty{display:none}
.dsh-wel-sidebar-mindmaps-fallback{flex:none;padding:2px 2px 6px}
.dsh-wel-sidebar-mindmaps-empty{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;line-height:16px;padding:0 4px}
.dsh-wel-sidebar-mindmaps-list{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-wel-sidebar-mindmaps-item{display:flex;align-items:center;gap:6px;min-width:0;height:30px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;text-align:left;cursor:grab}
.dsh-wel-sidebar-mindmaps-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-wel-sidebar-mindmaps-item[data-dragging]{opacity:.45}
.dsh-wel-sidebar-mindmaps-item[data-drop="before"]{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary)}
.dsh-wel-sidebar-mindmaps-item[data-drop="after"]{box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary)}
.dsh-wel-sidebar-mindmaps-icon{flex:none;width:14px;height:14px;color:var(--dsw-alias-state-business-primary)}
.dsh-wel-sidebar-mindmaps-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-wel-sidebar-mindmaps-count{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-wel-frame[data-sidebar-files] .dsh-wel-sidebar-mindmaps{display:none}
.dsh-wel-frame[data-sidebar-collapsed] .dsh-wel-sidebar-mindmaps{display:none}
`

const tokenHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--shiki-token-comment)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--shiki-token-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--shiki-token-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--shiki-token-constant)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.typeName, tags.className, tags.namespace], color: 'var(--shiki-token-function)' },
  // Name-definition tokens (class/namespace/type names in declaration
  // position) ride the type color; StreamLanguage emits these as
  // `variableName.definition`, which the bare variableName rule above does not
  // catch — without this they would fall through to the fallback highlighter.
  { tag: [tags.definition(tags.variableName), tags.definition(tags.typeName), tags.definition(tags.propertyName)], color: 'var(--shiki-token-function)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--shiki-token-parameter)' },
  { tag: [tags.heading, tags.link, tags.url], color: 'var(--shiki-token-link)' },
  // Preprocessor directives: purple via the directive variable, with a purple
  // fallback so a directive never silently renders as a string when the
  // variable is unavailable.
  { tag: tags.meta, color: 'var(--dsh-wel-token-directive, #8e44ad)' },
  { tag: [tags.inserted, tags.meta], color: 'var(--shiki-token-string-expression)' },
  { tag: tags.punctuation, color: 'var(--shiki-token-punctuation)' },
  // Markup (XML/HTML) tokens. angleBracket was unstyled and character already
  // rides the string color; the fallbacks preserve that unless a markup preset
  // (e.g. the VS Code XML preset) sets the override variables.
  { tag: tags.angleBracket, color: 'var(--dsh-wel-token-xml-punctuation, inherit)' },
  { tag: tags.character, color: 'var(--dsh-wel-token-xml-entity, var(--shiki-token-string))' },
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
/* C# legacy mode: replicates the clike `csharp` export (keywords, types, and
   the @"..." verbatim-string hook) and adds the C/C++-style preprocessor hook
   so #if/#define/#region lines render as directives instead of plain
   identifiers (the shipped csharp export has no '#' hook). */
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
   dictionary keys (some server codes have historical aliases). */
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
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)))
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

/* Compact, budgeted Myers diff: the edit script turning `base` into `mine`,
   as a list of { from, to, added }, or null when the trace would exceed the
   browser-memory budget. Adjacent operations are coalesced so a replacement is
   one change rather than a deletion followed by an insertion. */
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
  if (leftInsertion) return left.from >= right.from && left.from <= right.to
  if (rightInsertion) return right.from >= left.from && right.from <= left.to
  return left.from < right.to && right.from < left.to
}

function changeTouchesSpan(change, start, end) {
  return change.from === change.to
    ? change.from >= start && change.from <= end
    : change.from < end && change.to > start
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
    throw new Error('workspace-explorer-layout: incomplete conflict choices')
  }
  const output = []
  for (const part of parts) {
    if (part.kind === 'text') output.push(...part.lines)
    else {
      const conflict = conflicts[part.id]
      if (conflict === undefined) throw new Error('workspace-explorer-layout: invalid conflict part')
      output.push(...conflict[choices[part.id]])
    }
  }
  return output.join('\n')
}

/* Merge both edit scripts by collecting every transitively overlapping change
   into one cluster. The cluster closure is what makes one-large-vs-many-small
   overlaps terminate: no change whose coordinate is behind the cursor remains
   after a conflict is emitted. Conflict placement stays structural (`parts`),
   so user text can never collide with a marker string. */
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
  if (conflicts.length > 0) return { status: 'conflict', conflicts, parts }
  return { status: 'clean', merged: resolveMergeParts(parts, [], []) }
}

/* Character-level diff of one conflict side against the common base: coalesced
   { text, kind } segments (kind 'same' | 'add' | 'del') over the whole side
   text. Unchanged characters keep their original color, characters this side
   added render green, and characters this side removed render as a red
   strikethrough — all inline on the same line. Splitting on codepoints (not
   UTF-16 code units) keeps surrogate pairs intact. Returns null when the input
   is too large to diff safely (the caller falls back to line-level marks). */
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

/* React nodes for one conflict side against the common base. The primary path
   is a character-level inline diff: unchanged text renders as plain (original
   color), added characters as green, removed characters as a red strikethrough,
   all on the same line. Newline characters inside any segment keep the <pre>'s
   exact line layout. Oversized regions fall back to line-level marks. */
function diffRows(baseLines, sideLines) {
  const segments = inlineDiffSegments(baseLines.join('\n'), sideLines.join('\n'))
  if (segments !== null) {
    const nodes = []
    for (const segment of segments) {
      nodes.push(segment.kind === 'same'
        ? segment.text
        : h('span', { className: `dsh-wel-inline-${segment.kind}` }, segment.text))
    }
    return nodes
  }
  // Fallback: line-level diff rows (whole deleted lines struck, whole added
  // lines highlighted) for content too large for the character diff.
  const rows = diffSideLines(baseLines, sideLines)
  const nodes = []
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0) nodes.push('\n')
    nodes.push(h('span', { className: 'dsh-wel-conflict-code-row', 'data-kind': rows[i].kind }, rows[i].text))
  }
  return nodes
}

/* Line-level diff rows for one conflict side against the common base: returns
   { text, kind }[] where kind is 'same' (unchanged), 'add' (line added/changed
   by this side), or 'del' (base line removed by this side). Used only as the
   oversized fallback for the inline character diff. */
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

// Whether a dropped File is an image. Images belong to the chat composer, not
// the preview pane: the drag highlight is withheld for them, but an actual
// drop still reaches the upload endpoint and the server rejects it as binary,
// so the user gets an explicit "cannot preview as text" toast instead of a
// silent no-op — intentional, see development-notes §17. Empty MIME types are
// treated as normal files and the server decides text-likeness.
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
// Whether the drag carries at least one non-image file. This only controls the
// drop HIGHLIGHT: during dragover the File objects may not be inspectable yet,
// so any file drag counts as "normal". The drop itself does NOT filter images
// (see isImageFile / handlePreviewDrop) — they are uploaded and rejected by
// the server with an explicit toast, by design (development-notes §17).
function hasNormalFile(event) {
  if (!hasDraggedFiles(event)) return false
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return true
  for (const file of files) if (!isImageFile(file)) return true
  return false
}
// The persisted sidebar width lives with the explorer pane geometry
// (EXPLORER_LAYOUT_STORE_KEY): the live value rides the root layout store,
// which cannot persist its whole value (it also carries large file drafts), so
// the explorer pane store mirrors it on change and this rehydrates it on load.
// 0 means the sidebar is collapsed; missing or invalid persisted data falls
// back to the default width (render-time clamping still applies the viewport
// ceiling).
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
      drafts: {},
      // Sidebar browsing region: 'sessions' shows the harness workspace/session
      // browser; 'files' swaps the same region for the workspace file tree.
      view: 'sessions',
    }),
    actions: {
      setSidebar: (draft, width, max = SIDEBAR_MAX_FALLBACK) => { draft.sidebar = clamp(width, SIDEBAR_MIN, max) },
      toggleSidebar: (draft) => { draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0 },
      openDetails: (draft) => { draft.detailsOpen = true },
      closeDetails: (draft) => { draft.detailsOpen = false },
      rememberDraft: (draft, workspaceId, value) => { draft.drafts[String(workspaceId)] = value },
      clearDraft: (draft, workspaceId) => {
        // Only mutate when the key actually exists: a no-op delete still
        // bumps the store snapshot, which re-renders AppFrame and can sustain
        // a remount loop that aborts every in-flight request.
        const key = String(workspaceId)
        if (draft.drafts[key] !== undefined) delete draft.drafts[key]
      },
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
      setSidebar: (draft, width) => { draft.sidebar = width === 0 ? 0 : Math.max(SIDEBAR_MIN, Math.round(width)) },
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
      fileColors: {},
      highlightPresets: {},
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
    },
  })
}
class LayoutController { attach(actions){this.actions=actions} requireActions(){if(!this.actions)throw new Error('workspace-explorer-layout: root store actions are not attached');return this.actions} toggleSidebar(){this.requireActions().toggleSidebar()} openDetails(){this.requireActions().openDetails()} closeDetails(){this.requireActions().closeDetails()} }

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
  return h('div', { className: 'dsh-wel-context-row', ref: rowRef, style: queueDockGap === 0 ? undefined : { marginTop: `${queueDockGap}px` } },
    h('button', {
      'aria-label': title,
      'aria-pressed': context.active,
      className: 'dsh-wel-context-prefix',
      'data-inactive': !context.active || undefined,
      onClick: toggle,
      title,
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-wel-context-prefix-mark' }, context.active ? '↳' : '○'),
    h('span', { className: 'dsh-wel-context-prefix-label' }, label)))
}

const OPENED_FILE_PREFIX = '<opened_file>The user opened the file '
const OPENED_FILE_SUFFIX = ' in the IDE. This may or may not be related to the current task.</opened_file>'
const SELECTION_PREFIX = '<selection>The user selected the lines '
const SELECTION_TRAILER = 'This may or may not be related to the current task.'
const SELECTION_CLOSE = '</selection>'
const MESSAGE_CONTEXT_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-pending-steering]'
const MESSAGE_CONTEXT_SUMMARY_ATTR = 'data-dsh-wel-message-context-summary'
const pendingEditorContextDisplays = new Map()

function rememberEditorContextDisplay(text, display) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined) pendingEditorContextDisplays.set(text, [display])
  else queue.push(display)
}

function consumeEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return null
  const display = queue.shift()
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
  return display ?? null
}

function discardLastEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return
  queue.pop()
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
}

function clearEditorContextDisplays() {
  pendingEditorContextDisplays.clear()
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
  // cannot truncate the fold/summary early.
  const marker = `${SELECTION_TRAILER}${SELECTION_CLOSE}`
  const markerAt = text.indexOf(marker, headerEnd + 1)
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
    row.className = 'dsh-wel-message-context-summary'
    parent.insertBefore(row, bubble)
  }
  row.setAttribute('title', context.raw ?? context.title)
  row.replaceChildren(
    Object.assign(document.createElement('span'), {
      className: 'dsh-wel-message-context-summary-mark',
      textContent: '↳',
    }),
    Object.assign(document.createElement('span'), {
      className: 'dsh-wel-message-context-summary-label',
      textContent: context.fileName,
    }),
    ...(context.range === null ? [] : [Object.assign(document.createElement('span'), {
      className: 'dsh-wel-message-context-summary-range',
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
    bubble.classList.add('dsh-wel-message-context-bubble')
    if (context.visibleText === '') bubble.setAttribute('data-dsh-wel-empty-prompt', '')
    else bubble.removeAttribute('data-dsh-wel-empty-prompt')
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
      bubble.classList.remove('dsh-wel-message-context-bubble')
      bubble.removeAttribute('data-dsh-wel-empty-prompt')
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
      throw new Error('workspace-explorer-layout requires the Harness 0.1.x conversation.sendSession seam')
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
        console.error(`workspace-explorer-layout: session ${id} input submit/steer seams unavailable; editor context will not attach`)
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
      console.error(`workspace-explorer-layout: failed to patch input seams for session ${id}:`, error)
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
// per-root-session document (trunk turns + fork branches) that the Host builds
// by reverse-parsing the FULL session logs and serves as the single source of
// truth. The client only re-syncs (fold new turns from the full logs) and
// persists structural changes (forks, branch removal).
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
const syncMindmapDoc = (sessionId, liveSessionId, signal) => mindmapRequest('/sync', {
  method: 'POST',
  body: liveSessionId === undefined || liveSessionId === null
    ? { sessionId: String(sessionId) }
    : { sessionId: String(sessionId), liveSessionId: String(liveSessionId) },
  signal,
})
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

/* Module-wide mind-map index registry: the sidebar mind-map session panel and
   the sidebar branch hider both need to know which sessions belong to a mind
   map (roots + documented branches), but they cannot fetch on every render.
   A background refresh keeps the index current (new docs appear after the
   first 导图 conversion); components subscribe through useSyncExternalStore
   and the hider reads the sets synchronously. */
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
       branch set, or an updatedAt bump from a folded turn) must bump the
       version and re-render the subscribers — an unconditional notify made
       the sidebar panel and the hider re-run on every idle poll. The
       updatedAt is included so a doc that just gained a turn re-sorts to the
       top of its sidebar group instead of staying at a stale position. */
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
   snapshot object is replaced only on change so useSyncExternalStore sees a
   stable reference between updates. */
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
     file browser), 'sidebar' covers only the sidebar column. A view
     preference, kept across open/close and session switches while the app is
     alive (not persisted). */
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
const MINDMAP_ORDER_STORE_KEY = 'dsh.workspace.explorer.mindmap-order.v1'
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
// restore the whole editing session (content + snapshot) without localStorage
// carrying it. The owner is the session scope; the generation fence on the
// Host rejects stale writes from a discarded or previous mount.
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
   the long-lived authority, but an unload cannot reliably finish a 1 MiB fetch;
   the local mirror closes that durability gap and is reconciled on restore. */
const EMERGENCY_DRAFT_DB = 'dsh-workspace-explorer-layout'
const EMERGENCY_DRAFT_STORE = 'drafts-v1'
let emergencyDraftDbPromise
const emergencyDraftTails = new Map()
function emergencyDraftKey(workspaceId, scopeId, path) {
  return JSON.stringify([String(workspaceId), String(scopeId), path])
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
    request.onsuccess = () => { resolveDb(request.result) }
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
  const value = { key, workspaceId: String(workspaceId), scopeId: String(scopeId), path, ...payload, updatedAt: Date.now() }
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
  return new Promise((resolveRewrite, reject) => {
    const transaction = db.transaction(EMERGENCY_DRAFT_STORE, 'readwrite')
    const store = transaction.objectStore(EMERGENCY_DRAFT_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      for (const value of request.result ?? []) {
        if (value.workspaceId !== String(workspaceId) || value.scopeId !== String(scopeId)) continue
        const path = rewriteRelativePath(value.path, from, to)
        if (path === value.path) continue
        store.delete(value.key)
        store.put({ ...value, key: emergencyDraftKey(workspaceId, scopeId, path), path, updatedAt: Date.now() })
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB draft rewrite failed')) }
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
async function requestSearch(workspaceId, query, caseSensitive, signal) {
  const params = new URLSearchParams({ workspaceId: String(workspaceId), q: query, caseSensitive: caseSensitive ? 'true' : 'false' })
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
  // The "正在保存…" status only exists while a save is in flight; a persisted
  // copy must not resurrect it as a stale banner after refresh.
  if (tab.saving) clone.status = undefined
  // Dropped non-workspace files are session-only previews: their content lives
  // only in memory (persisting it would re-introduce the localStorage quota
  // blow-up the slim serialization was written to prevent), so refresh drops
  // them and they are excluded from every persisted snapshot.
  if (clone.external) return null
  // localStorage keeps ONLY the dirty marker and tab metadata, never file
  // content or the snapshot: the editing content and snapshot live in the
  // draft file (~/.dsh-plugin/.../drafts) and are re-read on restore. Dropping
  // the content from every tab also keeps the localStorage value small.
  clone.baseText = ''
  clone.draft = ''
  return clone
}
/* Cap the stored session count so the value stays bounded forever. The key
 * being written is freshest and always survives; others keep the most
 * recently updated PREVIEW_SESSION_MAX entries. */
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
function previewSessionWithDraft(value, storedDraft) {
  const session = normalizePreviewSession(value)
  if (storedDraft === undefined || storedDraft === null || typeof storedDraft.path !== 'string') return session
  if (!session.tabs.some(tab => tab.path === storedDraft.path)) {
    session.tabs.push({
      baseText: typeof storedDraft.baseContent === 'string' ? storedDraft.baseContent : '',
      bom: Boolean(storedDraft.bom),
      dirty: true,
      draft: typeof storedDraft.content === 'string' ? storedDraft.content : '',
      editing: true,
      encoding: typeof storedDraft.encoding === 'string' && storedDraft.encoding !== '' ? storedDraft.encoding : 'utf-8',
      lineEnding: typeof storedDraft.lineEnding === 'string' ? storedDraft.lineEnding : 'none',
      name: typeof storedDraft.name === 'string' && storedDraft.name !== ''
        ? storedDraft.name
        : storedDraft.path.slice(storedDraft.path.lastIndexOf('/') + 1),
      path: storedDraft.path,
      pinned: false,
      revision: storedDraft.revision ?? null,
      saving: false,
      scrollTop: 0,
      size: Number.isFinite(storedDraft.size) ? storedDraft.size : null,
      status: storedDraft.revision === null || storedDraft.revision === undefined
        ? { error: true, text: translate('status.draftRestored') }
        : undefined,
      symlink: false,
    })
  }
  session.activePath = storedDraft.path
  return session
}
function selectStoredPreviewSession(previewSessions, workspace, currentSession, workspaceId) {
  if (currentSession !== undefined) {
    const currentKey = String(currentSession)
    const currentValue = previewSessions[currentKey]
    if (currentValue !== undefined) return { key: currentKey, value: currentValue }
    if (workspaceId !== undefined) {
      const workspaceKey = String(workspaceId)
      const workspaceValue = previewSessions[workspaceKey]
      if (workspaceValue !== undefined) return { key: workspaceKey, value: workspaceValue }
    }
    return { key: currentKey, value: undefined }
  }
  if (workspace !== undefined) {
    for (const sessionId of workspace.sessionIds) {
      const key = String(sessionId)
      const value = previewSessions[key]
      if (value !== undefined) return { key, value }
    }
  }
  if (workspaceId !== undefined) {
    const workspaceKey = String(workspaceId)
    const workspaceValue = previewSessions[workspaceKey]
    if (workspaceValue !== undefined) return { key: workspaceKey, value: workspaceValue }
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
   directories). Volatile fields (status, scrollTop, draft/baseText content)
   must NOT participate — the localStorage serialization drops content anyway,
   and treating status/scroll changes as new snapshots would rewrite the store
   every render, which re-renders the app (updatedAt) and remounts the
   explorer, aborting every in-flight request. */
function previewSnapshotFingerprint(value) {
  const tabs = Array.isArray(value?.tabs) ? value.tabs : []
  const tabPart = tabs.map(tab => `${tab.path}:${tab.dirty ? 1 : 0}:${tab.pinned ? 1 : 0}`).join(',')
  const expandedPart = Array.isArray(value?.expanded) ? value.expanded.join(',') : ''
  return `${value?.activePath ?? ''}|${tabPart}|${expandedPart}`
}
function dropIndexFromEvent(event) {
  const tabNodes = event.currentTarget.querySelectorAll('.dsh-wel-preview-tab')
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
function IconPin(){return h('svg',{'aria-hidden':true,fill:'none',stroke:'currentColor',strokeLinecap:'round',strokeLinejoin:'round',strokeWidth:1.8,viewBox:'5 2 14 19'},h('line',{x1:12,x2:12,y1:17,y2:21}),h('path',{d:'M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z'}))}
function IconFolder(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M1.8 4.3h4l1.2 1.4h7.2v6.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z',stroke:'currentColor',strokeLinejoin:'round',strokeWidth:1.3}))}
function IconSessionList(){return h('svg',{'aria-hidden':true,fill:'none',viewBox:'0 0 16 16'},h('path',{d:'M2.5 3.2h11M2.5 8h11M2.5 12.8h7',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.3}))}
/* The sidebar's two-button segment replacing the harness New Session button:
   two exclusive navigation tabs — Session List / Workspace Files — that only
   switch the browsing region (no session creation, no toggle-off on repeat).
   Each button is flex:1 (50%) so the pair tracks the sidebar width while it
   is dragged; the collapsed rail stacks icon-only controls. */
function SidebarTopActions({ collapsed, view, width, onSelectSessions, onSelectFiles }) {
  // The row is hosted inside the harness sidebar shell, which does not stretch
  // foreign nodes reliably, so its width is bound to the sidebar width
  // explicitly (root padding 12px x2 plus the row's 2px x2 margins) instead of
  // relying on the parent flex stretch; AppFrame re-renders on every drag tick.
  const rowStyle = collapsed ? undefined : { width: `${Math.max(0, width - 28)}px` }
  return h('div', { className: 'dsh-wel-sidebar-top-actions', 'data-rail': collapsed || undefined, style: rowStyle },
    h('button', {
      'aria-label': translate('nav.sessions'),
      className: 'dsh-wel-sidebar-top-action',
      'data-active': view !== 'files' || undefined,
      onClick: onSelectSessions,
      title: translate('nav.sessions'),
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-wel-sidebar-top-icon' }, h(IconSessionList)), h('span', { className: 'dsh-wel-sidebar-top-label' }, translate('nav.sessions'))),
    h('button', {
      'aria-label': translate('nav.files'),
      className: 'dsh-wel-sidebar-top-action',
      'data-active': view === 'files' || undefined,
      onClick: onSelectFiles,
      title: translate('nav.files'),
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-wel-sidebar-top-icon' }, h(IconFolder)), h('span', { className: 'dsh-wel-sidebar-top-label' }, translate('nav.files'))),
  )
}

function ResizeHandle({label,left,value,min,max,onResize,onDragging}){const[dragging,setDragging]=useState(false),origin=useRef(0),base=useRef(0);const start=useCallback(e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);origin.current=e.clientX;base.current=value;setDragging(true);onDragging(true)},[onDragging,value]);const move=useCallback(e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))onResize(clamp(base.current+e.clientX-origin.current,min,max))},[max,min,onResize]);const end=useCallback(e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;e.currentTarget.releasePointerCapture(e.pointerId);onResize(clamp(base.current+e.clientX-origin.current,min,max));setDragging(false);onDragging(false)},[max,min,onDragging,onResize]);return h('div',{'aria-label':label,'aria-orientation':'vertical','aria-valuemax':max,'aria-valuemin':min,'aria-valuenow':value,className:'dsh-wel-splitter','data-dragging':dragging||undefined,onKeyDown:e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onResize(clamp(value+(e.key==='ArrowLeft'?-RESIZE_STEP:RESIZE_STEP),min,max))}},onLostPointerCapture:()=>{setDragging(false);onDragging(false)},onPointerCancel:end,onPointerDown:start,onPointerMove:move,onPointerUp:end,role:'separator',style:{left},tabIndex:0})}
function HeaderAction({action}){return h('button',{'aria-label':action.label,className:'dsh-wel-icon-button','data-active':action.active||undefined,disabled:action.disabled||undefined,onClick:action.onClick,title:action.title??action.label,type:'button'},action.icon)}
function PanelHeader({title,subtitle,action,actionLabel,actions=[],onContextMenu}){const items=[...actions];if(action)items.push({label:actionLabel,onClick:action,icon:h(IconRefresh)});return h('header',{className:'dsh-wel-panel-header'},h('div',{className:'dsh-wel-panel-title',onContextMenu},h('strong',{title},title),subtitle?h('span',{title:subtitle},subtitle):null),items.length?h('div',{className:'dsh-wel-panel-actions'},items.map(item=>h(HeaderAction,{action:item,key:item.label}))):null)}
/* Memoized: the tree re-renders when tabs change (typing, tab drags), but a
   row's own props only change on selection/expansion/directory data, so
   scrolling and typing skip most row reconciliation entirely. */
const TreeRow = memo(function TreeRow({entry,depth,expanded,selected,cut,onContextMenu,onDirectory,onFile,onRename}){useLocaleText();const directory=entry.kind==='directory',blocked=entry.kind==='blocked'||entry.kind==='other',label=directory?'dir':fileLabel(entry.name);return h('button',{'aria-expanded':directory?expanded:undefined,className:'dsh-wel-tree-row','data-cut':cut||undefined,'data-selected':selected||undefined,disabled:blocked,onClick:directory?()=>onDirectory(entry):()=>onFile(entry),onContextMenu:e=>onContextMenu(e,entry),onKeyDown:e=>{if(e.key==='F2'){e.preventDefault();onRename(entry)}},style:{'--dsh-wel-depth':depth},title:`${entry.path}${entry.symlink?translate('tree.symlink'):''}`,type:'button'},h('span',{className:'dsh-wel-chevron'},directory?(expanded?'▼':'▶'):''),h('span',{className:'dsh-wel-file-mark','data-kind':entry.kind,'data-group':colorGroupOf(entry)},label.slice(0,3)),h('span',{className:'dsh-wel-row-name'},entry.name),entry.symlink?h('span',{className:'dsh-wel-symlink'},'↗'):null)})
/* In-place rename of a tree row: the normal TreeRow is swapped for an input
   that mirrors the row layout (same depth indent, chevron and file mark), so
   the edit happens exactly where the name sits — no modal dialog. Enter
   confirms (IME-safe); Escape or blur cancels and restores the original name.
   An unchanged name closes quietly (no-op); invalid/duplicate input keeps the
   editor open and shows an inline error below the row. */
function TreeRenameRow({busy,depth,entry,expanded,error,onCancel,onConfirm,onDraft,value}){const composingRef=useRef(false),inputRef=useRef(null);const directory=entry.kind==='directory',label=directory?'dir':fileLabel(entry.name);useEffect(()=>{const input=inputRef.current;if(input!==null){input.focus();input.select()}},[]);return h('div',{className:'dsh-wel-tree-rename',style:{'--dsh-wel-depth':depth}},h('div',{className:'dsh-wel-tree-rename-row'},h('span',{className:'dsh-wel-chevron'},directory?(expanded?'▼':'▶'):''),h('span',{className:'dsh-wel-file-mark','data-kind':entry.kind,'data-group':colorGroupOf(entry)},label.slice(0,3)),h('input',{'aria-label':translate('dialog.name'),autoFocus:true,className:'dsh-wel-tree-rename-input',disabled:busy,onBlur:()=>{if(!busy)onCancel()},onChange:event=>onDraft(event.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();if(!busy)onCancel()}else if(event.key==='Enter'&&!composingRef.current){event.preventDefault();if(value.trim()===entry.name){onCancel();return}onConfirm()}},ref:inputRef,value})),error?h('div',{className:'dsh-wel-tree-rename-error',role:'alert'},error):null)}
const TreeStatus=({children,error})=>h('div',{className:'dsh-wel-tree-status','data-error':error||undefined},children)
function TreeContextMenu({entry,menuRef,onRename,onCopyName,onCopyPath,onReveal,onCopy,onPaste,onCut,onDelete,pasteDisabled,pasteTitle,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{'aria-label':entry.path,className:'dsh-wel-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-wel-context-item',onClick:()=>onRename(entry),role:'menuitem',title:translate('context.rename.title'),type:'button'},translate('context.rename')),h('button',{className:'dsh-wel-context-item',onClick:()=>onCopyName(entry),role:'menuitem',title:translate('context.copyName.title'),type:'button'},translate('context.copyName')),h('button',{className:'dsh-wel-context-item',onClick:()=>onCopyPath(entry,false),role:'menuitem',title:translate('context.copyPath.title'),type:'button'},translate('context.copyPath')),h('button',{className:'dsh-wel-context-item',onClick:()=>onCopyPath(entry,true),role:'menuitem',title:translate('context.copyRelative.title'),type:'button'},translate('context.copyRelative')),h('div',{className:'dsh-wel-context-separator',role:'separator'}),h('button',{className:'dsh-wel-context-item',onClick:()=>onReveal(entry),role:'menuitem',title:translate('context.reveal.title'),type:'button'},translate('context.reveal')),h('div',{className:'dsh-wel-context-separator',role:'separator'}),h('button',{className:'dsh-wel-context-item',onClick:()=>onCopy(entry),role:'menuitem',title:translate('context.copy.title'),type:'button'},translate('context.copy')),h('button',{className:'dsh-wel-context-item',disabled:pasteDisabled,onClick:()=>onPaste(entry),role:'menuitem',title:pasteDisabled?pasteTitle:translate('context.paste.title'),type:'button'},translate('context.paste')),h('button',{className:'dsh-wel-context-item',onClick:()=>onCut(entry),role:'menuitem',title:translate('context.cut.title'),type:'button'},translate('context.cut')),h('button',{className:'dsh-wel-context-item',onClick:()=>onDelete(entry),role:'menuitem',title:translate('context.delete.title'),type:'button'},translate('context.delete')))}
function TabContextMenu({menuRef,onCloseOthers,onTogglePin,pinned,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{className:'dsh-wel-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-wel-context-item',onClick:onTogglePin,role:'menuitem',title:pinned?translate('tab.unpin.title'):translate('tab.pin.title'),type:'button'},pinned?translate('tab.unpin'):translate('tab.pin')),h('button',{className:'dsh-wel-context-item',onClick:onCloseOthers,role:'menuitem',title:translate('tab.closeOthers.title'),type:'button'},translate('tab.closeOthers')))}
function EntryDialog({dialog,draft,error,busy,blocked,composingRef,onCancel,onConfirm,onDraft}){if(!dialog)return null;const title=entryDialogTitle(dialog),action=entryDialogAction(dialog);return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},title),h('button',{'aria-label':translate('dialog.close'),className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('input',{'aria-label':translate('dialog.name'),autoFocus:true,className:'dsh-wel-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();onCancel()}else if(e.key==='Enter'&&!composingRef.current){e.preventDefault();onConfirm()}},value:draft}),error?h('div',{className:'dsh-wel-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-wel-text-button',disabled:blocked,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):action))))}
function EncodingMenu({menuRef,onOpen,onSave,canOpen,canSave,x,y}){const left=Math.max(4,Math.min(x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top=Math.max(4,Math.min(y,window.innerHeight-CONTEXT_MENU_HEIGHT-4));return h('div',{className:'dsh-wel-context-menu',ref:menuRef,role:'menu',style:{left,top}},h('button',{className:'dsh-wel-context-item',disabled:!canOpen,onClick:onOpen,role:'menuitem',title:canOpen?translate('encoding.open.title'):translate('encoding.open.titleDirty'),type:'button'},translate('encoding.open')),h('button',{className:'dsh-wel-context-item',disabled:!canSave,onClick:onSave,role:'menuitem',title:canSave?translate('encoding.save.title'):translate('encoding.save.titleReadonly'),type:'button'},translate('encoding.save')))}
/* In-place session rename: an input overlaid exactly on the harness session
   row's title span. The row itself is harness-rendered, so the plugin never
   mutates its DOM; the overlay is fixed-positioned at the span's rect. Enter
   confirms (IME-safe), Escape/blur cancels; a row that detaches (session
   removed, list rebuilt) cancels too. */
function SessionInlineRename({busy,error,onCancel,onConfirm,row,title}){const composingRef=useRef(false),inputRef=useRef(null);const[draft,setDraft]=useState(title);useEffect(()=>{if(row===null||!row.isConnected){onCancel();return}const input=inputRef.current;if(input!==null){input.focus();input.select()}},[/* mount-only */]);useEffect(()=>{if(row!==null&&row.isConnected)return undefined;onCancel();return undefined},[onCancel,row]);const span=row===null?null:row.querySelector('span[class*="title"]');const rect=span===null?null:span.getBoundingClientRect();const overlayStyle=rect===null||rect.width===0?undefined:{left:rect.left,top:rect.top,width:Math.max(rect.width,140),height:rect.height};return h(Fragment,null,h('div',{className:'dsh-wel-session-rename-overlay',style:overlayStyle},h('input',{'aria-label':translate('dialog.sessionName'),autoFocus:true,className:'dsh-wel-session-rename-input',disabled:busy,onBlur:()=>{if(!busy)onCancel()},onChange:event=>{setDraft(event.target.value)},onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();if(!busy)onCancel()}else if(event.key==='Enter'&&!composingRef.current){event.preventDefault();onConfirm(draft)}},ref:inputRef,value:draft})),error?h('div',{className:'dsh-wel-session-rename-error',role:'alert',style:rect===null?undefined:{left:rect.left,top:rect.bottom+4}},error):null)}
/* Transient banner mirroring the harness conversation Toast look: same
   contrast fill, hold-then-fade timing and warning icon, so a failed
   external-file open reads exactly like the composer's image-intake
   rejection. Rendered inside the preview pane (absolute top-center of the
   section) instead of a viewport portal. The owner remounts it per show
   (keyed by seq) to restart the animation for repeated identical messages. */
const WEL_TOAST_HOLD_MS = 3000
const WEL_TOAST_FADE_MS = 1000
const welToastIcon = h('svg',{fill:'none',height:16,viewBox:'0 0 16 16',width:16},h('circle',{cx:8,cy:8,r:6.5,stroke:'currentColor',strokeWidth:1.5}),h('path',{d:'M8 4.75v3.5',stroke:'currentColor',strokeLinecap:'round',strokeWidth:1.5}),h('circle',{cx:8,cy:11.25,fill:'currentColor',r:0.9}))
function PreviewToast({text,onDone,headerRef}){const[top,setTop]=useState(null);useLayoutEffect(()=>{const header=headerRef?.current;if(header===null||header===undefined)return;const section=header.parentElement;if(section===null)return;const headerBottom=header.getBoundingClientRect().bottom;const sectionTop=section.getBoundingClientRect().top;setTop(headerBottom-sectionTop+8)},[headerRef]);useEffect(()=>{const timer=setTimeout(onDone,WEL_TOAST_HOLD_MS+WEL_TOAST_FADE_MS);return()=>clearTimeout(timer)},[onDone]);return h('div',{className:'dsh-wel-toast',role:'alert',style:top===null?undefined:{top}},h('span',{'aria-hidden':true,className:'dsh-wel-toast-icon'},welToastIcon),h('span',{className:'dsh-wel-toast-text'},text))}
function EncodingDialog({dialog,options,value,busy,onCancel,onPick,onConfirm}){if(dialog===undefined)return null;const title=dialog.mode==='open'?translate('encoding.dialog.open'):translate('encoding.dialog.save'),action=dialog.mode==='open'?translate('encoding.dialog.openAction'):translate('encoding.dialog.saveAction');return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},title),h('button',{'aria-label':translate('dialog.close'),className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('label',{className:'dsh-wel-settings-label',htmlFor:'dsh-wel-encoding-select'},translate('encoding.badge')),h('select',{'aria-label':translate('encoding.badge'),className:'dsh-wel-highlight-preset-select',disabled:busy,id:'dsh-wel-encoding-select',onChange:e=>onPick(e.target.value),value},options.map(enc=>h('option',{key:enc.id,value:enc.id},encodingLabel(enc.id))))),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-wel-text-button',disabled:busy||options.length===0,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):action))))}
function SessionRenameDialog({draft,busy,error,onCancel,onConfirm,onDraft,title}){const composingRef=useRef(false);return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},title ?? translate('dialog.renameSession')),h('button',{'aria-label':translate('dialog.close'),className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('input',{'aria-label':translate('dialog.sessionName'),autoFocus:true,className:'dsh-wel-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();onCancel()}else if(e.key==='Enter'&&!composingRef.current){e.preventDefault();onConfirm()}},value:draft}),error?h('div',{className:'dsh-wel-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-wel-text-button',disabled:busy||draft.trim()==='',onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):translate('dialog.rename')))))}
function DeleteDialog({entry,busy,dirtyWarning,onCancel,onConfirm}){if(entry===undefined)return null;return h('div',{className:'dsh-wel-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-wel-dialog',role:'dialog'},h('div',{className:'dsh-wel-dialog-header'},h('div',{className:'dsh-wel-dialog-title'},translate('dialog.deleteTitle')),h('button',{'aria-label':translate('dialog.close'),className:'dsh-wel-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-wel-dialog-body'},h('div',{className:'dsh-wel-dialog-message'},translate('dialog.deleteMessage',{name:entry.name})),dirtyWarning?h('div',{className:'dsh-wel-dialog-warning',role:'alert'},translate('dialog.deleteDirtyWarning')):null),h('div',{className:'dsh-wel-dialog-footer'},h('button',{className:'dsh-wel-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-wel-danger-button dsh-wel-text-button',disabled:busy,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):translate('dialog.deleteAction')))))}
/* Save-time three-way merge conflict prompt: the file changed on disk by
   another tool and the changes overlap the local edits. Each conflicting
   region is reviewed one at a time (mine vs theirs) in a large dialog; the
   footer walks the regions and the final pick set is handed back as
   { choices } (one 'mine'/'theirs' per conflict, in order) or 'cancel'. */
function SaveConflictDialog({conflict,fontSize,onResolve}) {
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState([])
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
  return h('div', { className: 'dsh-wel-dialog-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onResolve('cancel') } },
    h('div', { 'aria-modal': true, className: 'dsh-wel-dialog dsh-wel-conflict-dialog', role: 'dialog', style: fontSize === undefined ? undefined : { '--dsh-wel-conflict-font-size': `${fontSize}px` } },
      h('div', { className: 'dsh-wel-dialog-header' },
        h('div', { className: 'dsh-wel-dialog-title' },
          translate('dialog.saveConflictTitle'),
          total > 1 ? h('span', { className: 'dsh-wel-conflict-progress' }, `${current + 1} / ${total}`) : null),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-wel-icon-button', onClick: () => onResolve('cancel'), title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-wel-dialog-body' },
        h('div', { className: 'dsh-wel-dialog-message' }, translate('dialog.saveConflictMessage')),
        h('div', { className: 'dsh-wel-conflict-region' },
          h('div', { className: 'dsh-wel-conflict-region-title' },
            translate('dialog.saveConflictRegion', { lines: regionLines })),
          h('div', { className: 'dsh-wel-conflict-cols' },
            h('div', { className: 'dsh-wel-conflict-col dsh-wel-conflict-mine' },
              h('div', { className: 'dsh-wel-conflict-col-label' }, translate('dialog.saveConflictMine')),
              h('pre', { className: 'dsh-wel-conflict-code' }, region.display === 'plain' ? region.mine.join('\n') : diffRows(region.base, region.mine))),
            h('div', { className: 'dsh-wel-conflict-col dsh-wel-conflict-theirs' },
              h('div', { className: 'dsh-wel-conflict-col-label' }, translate('dialog.saveConflictTheirs')),
              h('pre', { className: 'dsh-wel-conflict-code' }, region.display === 'plain' ? region.theirs.join('\n') : diffRows(region.base, region.theirs)))),
          h('div', { className: 'dsh-wel-conflict-cols dsh-wel-conflict-cols-final' },
            h('div', { className: 'dsh-wel-conflict-col dsh-wel-conflict-mine' },
              h('div', { className: 'dsh-wel-conflict-col-label' }, translate('dialog.saveConflictMineFinal')),
              h('pre', { className: 'dsh-wel-conflict-code' }, region.mine.join('\n'))),
            h('div', { className: 'dsh-wel-conflict-col dsh-wel-conflict-theirs' },
              h('div', { className: 'dsh-wel-conflict-col-label' }, translate('dialog.saveConflictTheirsFinal')),
              h('pre', { className: 'dsh-wel-conflict-code' }, region.theirs.join('\n'))))),
      h('div', { className: 'dsh-wel-dialog-footer' },
        h('button', { className: 'dsh-wel-text-button', onClick: () => onResolve('cancel'), type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-wel-text-button', disabled: current === 0, onClick: goBack, type: 'button' }, translate('dialog.saveConflictPrev')),
        h('button', { className: 'dsh-wel-text-button', onClick: () => pick('theirs'), type: 'button' }, translate('dialog.saveConflictKeepTheirs')),
        h('button', { className: 'dsh-wel-danger-button dsh-wel-text-button', onClick: () => pick('mine'), type: 'button' }, translate('dialog.saveConflictKeepMine'))))))}


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
    const enhance = () => {
      const input = container.querySelector('.cm-panel.cm-search [main-field]')
      if (input === null || input.dataset.dshWelResize === '1') return
      input.dataset.dshWelResize = '1'
      const wrap = document.createElement('span')
      wrap.className = 'dsh-wel-search-field-wrap'
      const handle = document.createElement('span')
      handle.className = 'dsh-wel-search-resize'
      handle.title = translate('editor.searchResize')
      input.before(wrap)
      wrap.append(input, handle)
      let startX = 0
      let startWidth = 0
      const onPointerDown = (event) => {
        event.preventDefault()
        startX = event.clientX
        startWidth = input.getBoundingClientRect().width
        const onPointerMove = (moveEvent) => {
          input.style.width = `${Math.max(60, Math.min(480, startWidth + (moveEvent.clientX - startX)))}px`
        }
        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }
      handle.addEventListener('pointerdown', onPointerDown)
    }
    enhance()
    const observer = new MutationObserver(enhance)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [searchPanelContainer])

  return h('div', { className: 'dsh-wel-editor-host', 'data-highlight-preset': highlightPreset ?? HIGHLIGHT_PRESET_DEFAULT, ref: host })
}

function WorkspaceExplorer({
  workspace, treePortalTarget, sessionTitle, sessionId, renameSession, publishEditorContext, listDirectory, readFile, saveFile, createEntry, renameEntry, storedDraft, storedPreviewSession, persistDraft, persistPreviewSession, clearDraft, settingsStore, loadDraft, persistDraftFile, removeDraftFile, draftTree,
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const draftScopeId = sessionId === undefined ? `workspace:${workspace.workspaceId}` : `session:${sessionId}`
  const initialPreviewSession = previewSessionWithDraft(storedPreviewSession, storedDraft)
  const [directories, setDirectories] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set(['', ...(initialPreviewSession.expanded ?? [])]))
  const [tabs, setTabs] = useState(() => initialPreviewSession.tabs)
  const [activePath, setActivePath] = useState(() => initialPreviewSession.activePath)
  const [selected, setSelected] = useState(() => {
    if (initialPreviewSession.activePath === null) return storedDraft ? { path: storedDraft.path, name: storedDraft.name, kind: 'file' } : undefined
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
  // Set by the preview-header 刷新 action; the file-read effect consumes it at
  // the start of its next pass and surfaces a "reloaded" status on success.
  const refreshPendingRef = useRef(false)
  // Set by the preview-header 取消 action; like refreshPendingRef but surfaces
  // the cancel-specific "reloaded from disk" status once the discard re-read
  // completes.
  const cancelRestoreRef = useRef(null)
  const previewTabsRef = useRef(null)
  const previewSectionRef = useRef(null)
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
  const latestDraft = useRef(undefined)
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
  // draftGenerationsRef keeps the per-path generation for the staleness check
  // in enqueueDraftOperation.
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
    const meaningful = previewTabsBootstrapped.current || tabsRef.current.length !== 0 || activePathRef.current !== null || hasTreeExpansion
    // Skip until this session has established any state: a bare empty mount
    // must not clobber the workspace-key snapshot of another session. Once
    // established, keep writing (an empty snapshot deletes the stale entry in
    // the store action), so collapsing everything back to root also persists.
    if (!meaningful && !sessionEstablishedRef.current) return
    if (meaningful) sessionEstablishedRef.current = true
    // Merge the live scroll positions (kept out of React state so scrolling
    // never re-renders or triggers a write) into the serialized copy only.
    const snapshotTabs = tabsRef.current.map(tab => {
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

  // The layout-store draft fallback is retired (the draft file is now the
  // authoritative store): writing panels.drafts on unmount re-rendered
  // AppFrame, remounting WorkspaceExplorer and aborting every in-flight
  // request in a loop. Keep the ref (other paths still clear it) but never
  // populate it.
  latestDraft.current = undefined

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
      next.set(path, { state: 'loading', entries: prior?.entries ?? [], truncated: false })
      return next
    })
    try {
      const result = await listDirectory(workspace.workspaceId, path, controller.signal)
      setDirectories(cur => {
        const next = new Map(cur)
        next.set(path, { state: 'ready', entries: result.entries, truncated: result.truncated })
        return next
      })
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setDirectories(cur => {
          const next = new Map(cur)
          next.set(path, {
            state: 'error',
            entries: [],
            truncated: false,
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
    const next = previewSessionWithDraft(storedPreviewSession, storedDraft)
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
  }, [activatePath, revealPath, storedDraft, storedPreviewSession])
  // Late-arriving restore for tree expansion: if storedPreviewSession becomes
  // available only after mount, merge its expanded paths and load them. The
  // hasAll guard keeps this idempotent across store updates.
  useLayoutEffect(() => {
    const stored = previewSessionWithDraft(storedPreviewSession, storedDraft)
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
  }, [storedDraft, storedPreviewSession])
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
  const rewriteRuntimePaths = useCallback((from, to) => {
    lastWriteRef.current = rewritePathMap(lastWriteRef.current, from, to)
    draftGenerationsRef.current = rewritePathMap(draftGenerationsRef.current, from, to)
    scrollTopRef.current = rewritePathMap(scrollTopRef.current, from, to)
  }, [])
  const submitEntryDialog=useCallback(()=>{if(entryBusy||entryDialog===undefined)return;const trimmed=entryDraft.trim();const message=entryNameError(entryDraft);if(message!==undefined){setEntryError(message);return}const parentPathValue=entryDialog.mode==='create'?entryDialog.parentPath:parentPath(entryDialog.entry.path);const siblings=directories.get(parentPathValue)?.entries??[];if(entryDialog.mode==='create'){if(siblings.some(entry=>entry.name===trimmed)){setEntryError(translate('entry.duplicate'));return}}else if(trimmed===entryDialog.entry.name||siblings.some(entry=>entry.name===trimmed&&entry.path!==entryDialog.entry.path)){setEntryError(trimmed===entryDialog.entry.name?translate('entry.nameUnchanged'):translate('entry.duplicate'));return}const controller=new AbortController();mutationController.current=controller;setEntryBusy(true);setEntryError(undefined);const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;const request=(async()=>{if(entryDialog.mode==='rename'){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:entryDialog.entry.path,toPath:entryPath(parentPath(entryDialog.entry.path),trimmed)},controller.signal)}return entryDialog.mode==='create'?createEntry(workspace.workspaceId,entryDialog.parentPath,entryDialog.kind,trimmed,controller.signal):renameEntry(workspace.workspaceId,entryDialog.entry.path,trimmed,controller.signal)})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;const mode=entryDialog.mode;const sourcePath=mode==='create'?entryDialog.parentPath:entryDialog.entry.path;const nextStatus=mode==='create'?result.kind==='directory'?translate('status.createdFolder'):translate('status.createdFile'):result.kind==='directory'?translate('status.renamedFolder'):translate('status.renamedFile');composingRef.current=false;setEntryBusy(false);setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);setStatus({text:nextStatus});if(mode==='create'){setExpanded(cur=>{const next=new Set(cur);next.add(sourcePath);if(result.kind==='directory')next.add(result.path);return next});if(result.kind==='file'){previewTabsBootstrapped.current = true;setTabs(cur=>cur.some(tab=>tab.path===result.path)?cur:[...cur,{baseText:'',dirty:false,draft:'',editing:false,name:result.name,path:result.path,pinned:false,saving:false,scrollTop:0,size:null,status:undefined,symlink:Boolean(result.symlink),bom:false,lineEnding:'none',revision:null}]);activatePath(result.path)}setSelected(result);void loadDirectory(sourcePath);if(result.kind==='directory')void loadDirectory(result.path)}else{setDirectories(cur=>rewriteDirectoryMap(cur,sourcePath,result.path,result));setExpanded(cur=>rewritePathSet(cur,sourcePath,result.path));setTabs(cur=>rewritePreviewTabs(cur,sourcePath,result.path,result));rewriteRuntimePaths(sourcePath,result.path);migratePendingAutosavesRef.current?.(sourcePath,result.path);void rewriteEmergencyDraftPath(workspace.workspaceId,draftScopeId,sourcePath,result.path).catch(error=>{if(mounted.current)setStatus({error:true,text:translate('editor.autosaveFailed',{message:error instanceof Error?error.message:String(error)})})});{const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,sourcePath,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath)}setSelected(result);void loadDirectory(parentPath(sourcePath))}}).catch(error=>{if(error?.name==='AbortError'||!mounted.current||mutationSeq!==mutationSeqRef.current){return}if(entryDialog?.mode==='rename'&&draftMoveGeneration!==undefined){void rollbackDraftTree(entryDialog.entry.path,entryPath(parentPath(entryDialog.entry.path),trimmed))}setEntryBusy(false);setEntryError(error instanceof Error?error.message:String(error))}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined;if(mounted.current)setEntryBusy(false)})},[createEntry,directories,draftScopeId,entryBusy,entryDialog,entryDraft,loadDirectory,renameEntry,rewriteRuntimePaths,workspace.workspaceId])
  useLayoutEffect(() => {
    // A user-requested file refresh (preview header 刷新 action) is tracked
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
      ?? (storedDraft?.path === activePath
        ? {
            baseText: typeof storedDraft.baseContent === 'string' ? storedDraft.baseContent : '',
            bom: Boolean(storedDraft.bom),
            dirty: true,
            draft: typeof storedDraft.content === 'string' ? storedDraft.content : '',
            editing: true,
            lineEnding: typeof storedDraft.lineEnding === 'string' ? storedDraft.lineEnding : 'none',
            name: typeof storedDraft.name === 'string' && storedDraft.name !== ''
              ? storedDraft.name
              : activePath.slice(activePath.lastIndexOf('/') + 1),
            path: activePath,
            revision: storedDraft.revision ?? null,
            saving: false,
            scrollTop: 0,
            size: Number.isFinite(storedDraft.size) ? storedDraft.size : null,
            status: storedDraft.revision === null || storedDraft.revision === undefined
              ? { error: true, text: translate('status.draftRestored') }
              : undefined,
            symlink: false,
          }
        : undefined)
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
      // the editing session from disk rather than localStorage. A failed draft
      // read is non-critical: fall back to legacy persisted content or source.
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
        const stored = tab?.dirty ? tab : undefined
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
        const hasStoredContent = stored !== undefined && typeof stored.draft === 'string'
          && stored.draft !== '' && stored.draft !== result.content
        const restored = hasDiskDraft
          ? {
              content: draftData.draft,
              baseText: typeof draftData.baseText === 'string' ? draftData.baseText : result.content,
              baseRevision: typeof draftData.baseRevision === 'string' ? draftData.baseRevision : result.revision,
            }
          : hasStoredContent
            ? { content: stored.draft, baseText: stored.baseText, baseRevision: stored.revision }
            : { content: result.content, baseText: result.content, baseRevision: result.revision }
        const content = restored.content
        const hasRestoredContent = hasDiskDraft || hasStoredContent
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
        const notRestorableStatus = (hasDiskDraft || hasStoredContent) && !editable
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
          if (storedDraft?.path === activePath) clearDraft()
        } else if (hasDiskDraft || hasStoredContent) {
          setStatus(notRestorableStatus)
          if (storedDraft?.path === activePath) clearDraft()
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
          editing: editable,
          encoding: result.encoding ?? effectiveEncoding,
          lineEnding: result.lineEnding ?? 'none',
          name: selection.name,
          revision: result.revision ?? null,
          saving: false,
          scrollTop: tab?.scrollTop ?? 0,
          size: Number.isFinite(result.size) ? result.size : null,
          status: cancelRestore ? { text: translate('editor.cancelRestored') } : (refreshPending ? { text: translate('editor.refreshed') } : (canRestore ? restoredStatus : ((hasDiskDraft || hasStoredContent) ? notRestorableStatus : tab?.status))),
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
    // The workspace draft arrives with the first render (the layout store is
    // synchronous), never late, so it must not be a dependency: the restore
    // path clears the draft, and that change must not re-read the file.
  }, [activePath, clearDraft, draftScopeId, loadDraft, publishEditorContext, readFile, reloadToken, removeDraftFile, updateTab, workspace.workspaceId])

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
    draftGenerationsRef.current.delete(path)
    scrollTopRef.current.delete(path)
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
      await deleteEmergencyDraft(workspace.workspaceId, draftScopeId, path, generation)
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
        console.warn('workspace-explorer-layout: draft cleanup after save failed:', error)
      }
      if (!mounted.current) return false
      lastWriteRef.current.set(path, { revision: null, content })
      updateTab(path, {
        baseText: content,
        baseRevision: result.revision ?? revision ?? null,
        bom: savedBom,
        dirty: false,
        draft: content,
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
        latestDraft.current = undefined
        clearDraft()
        setPreview(current => current.state === 'ready' && current.path === path
          ? { ...current, content, encoding: savedEncoding, bom: savedBom, revision: result.revision ?? current.revision, size }
          : current)
        setStatus(savedStatus)
      }
      return true
    } finally {
      if (saveController.current === controller) saveController.current = undefined
    }
  }, [activePathRef, clearDraft, clearDraftFile, saveFile, updateTab, workspace.workspaceId])

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

  const scheduleAutosave = useCallback((path, text) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined || tab.external || tab.saving || tab.editing !== true) return
    // Drop the pending timer first, so an edit that reverts to the last-written
    // text cannot let an earlier (different-content) timer fire afterwards; the
    // dedup return below skips the generation bump, so the stale timer would
    // not be caught by the enqueueDraftOperation staleness check either.
    clearAutosaveTimer(path)
    // Skip a redundant write when the draft already equals the last content
    // this owner persisted for the path (the dedup documented in
    // development-notes §15 but never wired): typing back to the last-written
    // text must neither rewrite the staging file nor the IndexedDB mirror.
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
     pending auto-save (debounced, not yet flushed to the Host) must follow the
     path. Re-keying the pending map alone is not enough: the old timer
     callback still captures the old path, and the tree operation has advanced
     the owner generation fence, so the old generation would be rejected. So
     cancel the old timers, drop the stale entries, and flush each snapshot at
     the new path with a fresh generation. Without this the newest edits would
     survive only in the IndexedDB mirror, which the restore discards because
     its generation is older than the moved Host draft's (the tree op bumped
     the shared counter past the pending auto-save's). */
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
  // depends on performAutosave, which depends on `preview`, so its identity
  // changes on every preview transition; listing it in the deps would re-run
  // this effect on each transition and its cleanup would abort every in-flight
  // request (tree listing + active file read), leaving both stuck loading.
  // Snapshot the cleanup callbacks in refs so the effect stays stable.
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
    updateTab(path, { draft: text, dirty: true, saving: true, status: savingStatus })
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
        return await commitTab(path, text, diskRevision ?? sourceRevision, encoding, savedStatusText)
      }
      if (diskText === baseAtSave) {
        // The source is untouched since our snapshot: silent write-back.
        return await commitTab(path, text, diskRevision ?? sourceRevision, encoding, savedStatusText)
      }
      // The source changed externally → three-way merge against the snapshot.
      const merged = threeWayMerge(baseAtSave, text, diskText)
      if (merged.status === 'clean') {
        const ok = await commitTab(path, merged.merged, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok && activePathRef.current === path) {
          // Show the merged result (it differs from both sides).
          const view = editorRef.current
          if (view !== undefined) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: merged.merged } })
          }
        }
        return ok
      }
      // Overlapping changes → ask the user to pick; keep the tab busy so no
      // auto-save races the pending decision. Non-conflicting text and conflict
      // positions remain structural, so file content cannot collide with an
      // implementation marker.
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
      updateTab(path, { dirty: true, draft: text, editing: true, saving: false, status: { error: true, text: failure } })
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
  }, [activeTab, baseText, commitTab, dirty, draft, preview, readFile, saving, updateTab, workspace.workspaceId])

  /* Resolve the pending save conflict. The dialog walks the conflicts one at a
     time and calls back with { choices } (one 'mine'/'theirs' per conflict, in
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
      latestDraft.current = undefined
      clearDraft()
      lastWriteRef.current.set(path, { generation: draftGenerationsRef.current.get(path) ?? 0, content: diskContent })
      updateTab(path, { dirty: false, draft: '', editing: true, saving: false, status: { text: translate('editor.cancelRestored') } })
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
      updateTab(path, { dirty: true, draft: discardedText, editing: true, saving: false, status: failure })
      if (activePathRef.current === path) {
        setDraft(discardedText)
        setDirty(true)
        setStatus(failure)
      }
    } finally {
      if (mounted.current && activePathRef.current === path) setSaving(false)
    }
  }, [activeTab, clearDraft, clearDraftFile, dirty, draft, preview, saving, updateTab])
  const refresh=useCallback(()=>{if(hasDirtyTabs){setStatus({error:true,text:translate('tree.refreshBlocked')});return}abortDirectoryRequests();setEntryDialog(undefined);setEntryDraft('');setEntryError(undefined);composingRef.current=false;setDirectories(new Map());setExpanded(new Set(['']));setStatus(undefined);void loadDirectory('')},[abortDirectoryRequests,hasDirtyTabs,loadDirectory])
  const toggleDirectory=useCallback(entry=>{const path=entry.path;const opening=!expanded.has(path);setExpanded(cur=>{const next=new Set(cur);opening?next.add(path):next.delete(path);return next});if(opening){if(directories.get(path)?.state!=='ready')void loadDirectory(path);chooseDirectory(entry)}else setSelected(entry)},[chooseDirectory,directories,expanded,loadDirectory])
  const openContextMenu=useCallback((event,entry)=>{event.preventDefault();setSelected(entry);setContextMenu({entry,x:event.clientX,y:event.clientY})},[])
  const copyEntryPath=useCallback((entry,relative)=>{const value=relative?entry.path:joinAbsolutePath(workspace.path,entry.path);void copyText(value).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?(relative?translate('status.copiedRelative'):translate('status.copiedPath')):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[workspace.path])
  const copyEntryName=useCallback((entry)=>{void copyText(entry.name).then(ok=>{if(!mounted.current)return;setContextMenu(undefined);setCopyNotice(ok?translate('status.copiedName'):translate('status.copyFailed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)})},[])
  const openInExplorer=useCallback((entry)=>{setContextMenu(undefined);const controller=new AbortController();revealInExplorer(workspace.workspaceId,entry.path,controller.signal).then(()=>{if(!mounted.current)return;setCopyNotice(translate('status.revealed'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)}).catch(error=>{if(!mounted.current||error?.name==='AbortError')return;setCopyNotice(translate('status.revealFailed',{message:error instanceof Error?error.message:String(error)}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)})},[workspace.workspaceId])
  const copyEntryToClipboard=useCallback((entry,cut)=>{setContextMenu(undefined);setClipboard({workspaceId:workspace.workspaceId,path:entry.path,name:entry.name,kind:entry.kind,cut});setCopyNotice(cut?translate('status.cut'):translate('status.copied'));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},1600)},[workspace.workspaceId])
  const pasteEntry=useCallback((targetEntry)=>{if(clipboard===undefined||clipboard.workspaceId!==workspace.workspaceId)return;const targetDir=targetEntry.kind==='directory'?targetEntry.path:parentPath(targetEntry.path);const targetPath=entryPath(targetDir,pathBaseName(clipboard.path));if(clipboard.cut&&clipboard.path===targetPath)return;const wasCut=clipboard.cut;const affectedPrefix=clipboard.path===''?'':`${clipboard.path}/`;if(wasCut&&tabsRef.current.some(tab=>{if(!tab.dirty&&!tab.saving)return false;return tab.path===clipboard.path||(affectedPrefix!==''&&tab.path.startsWith(affectedPrefix))})){setStatus({error:true,text:translate('editor.unsavedBlocked')});return}const controller=new AbortController();mutationController.current=controller;const mutationSeq=mutationSeqRef.current+=1;let draftMoveGeneration;let draftMoveFailed=false;const request=(async()=>{const result=await requestFsOperation(workspace.workspaceId,{action:wasCut?'move':'copy',source:clipboard.path,target:targetPath},controller.signal);if(wasCut){draftMoveGeneration=nextDraftGeneration('__tree__');await draftTree(workspace.workspaceId,{action:'move',owner:draftScopeId,generation:draftMoveGeneration,fromPath:clipboard.path,toPath:result.path},controller.signal).catch(async error=>{if(!mounted.current)return;draftMoveFailed=true;console.warn('workspace-explorer-layout: draft move after fs move failed:',error);setStatus({error:true,text:translate('status.movedDraftWarning')});try{await draftTree(workspace.workspaceId,{action:'delete',owner:draftScopeId,generation:nextDraftGeneration('__tree__'),path:clipboard.path},controller.signal)}catch(cleanupError){if(mounted.current)console.warn('workspace-explorer-layout: draft cleanup after failed move also failed:',cleanupError)}})}return result})();request.then(result=>{if(!mounted.current||mutationSeq!==mutationSeqRef.current)return;setContextMenu(undefined);setStatus(draftMoveFailed?{error:true,text:translate('status.movedDraftWarning')}:{text:wasCut?translate('status.moved'):translate('status.pasted')});if(wasCut){const source=clipboard.path;setClipboard(undefined);setSelected(result);setDirectories(cur=>rewriteDirectoryMap(cur,source,result.path,result));setExpanded(cur=>rewritePathSet(cur,source,result.path));setTabs(cur=>rewritePreviewTabs(cur,source,result.path,result));rewriteRuntimePaths(source,result.path);migratePendingAutosavesRef.current?.(source,result.path);void rewriteEmergencyDraftPath(workspace.workspaceId,draftScopeId,source,result.path).catch(error=>{if(mounted.current)setStatus({error:true,text:translate('editor.autosaveFailed',{message:error instanceof Error?error.message:String(error)})})});const nextActivePath=activePathRef.current===null?null:rewriteRelativePath(activePathRef.current,source,result.path);if(nextActivePath!==activePathRef.current)setActivePath(nextActivePath);void loadDirectory(parentPath(source));void loadDirectory(targetDir)}else{void loadDirectory(targetDir)}}).catch(error=>{if(error?.name==='AbortError'||!mounted.current||mutationSeq!==mutationSeqRef.current)return;setCopyNotice(translate(wasCut?'status.cutFailed':'status.pasteFailed',{message:error instanceof Error?error.message:String(error)}));clearTimeout(copyNoticeTimer.current);copyNoticeTimer.current=setTimeout(()=>{if(mounted.current)setCopyNotice(undefined)},3000)}).finally(()=>{if(mutationController.current===controller)mutationController.current=undefined})},[clipboard,draftScopeId,draftTree,loadDirectory,nextDraftGeneration,rewriteRuntimePaths,workspace.workspaceId])
  const openDeleteConfirm=useCallback(entry=>{setContextMenu(undefined);setDeleteDialog(entry);setDeleteBusy(false)},[])
  const closeDeleteDialog=useCallback(()=>{if(deleteBusy)return;setDeleteDialog(undefined)},[deleteBusy])
  const confirmDelete = useCallback(async () => {
    if (deleteBusy || deleteDialog === undefined) return
    const entry = deleteDialog
    const prefix = entry.path === '' ? '' : `${entry.path}/`
    const affected = tabsRef.current
      .filter(tab => tab.path === entry.path || (prefix !== '' && tab.path.startsWith(prefix)))
      .map(tab => ({ path: tab.path, draft: tab.draft, dirty: tab.dirty || tab.saving, saving: tab.saving }))
    // Deleting under an in-flight save would race it: the save's PUT then hits
    // a 404 and its failure toast lands on a tab that no longer exists. Refuse
    // and close the dialog instead (the warning row now also mentions saving
    // tabs, so the reason is visible before confirming).
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
      for (const item of affected) if (item.dirty) scheduleAutosave(item.path, item.draft)
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
      for (const item of affected) if (item.dirty) scheduleAutosave(item.path, item.draft)
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
      const treeFocused=element.classList.contains('dsh-wel-tree-row')
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
  const runSearch=useCallback(async(query)=>{searchController.current?.abort();if(query.trim()===''){setSearchState({state:'idle'});setSearchExpanded(new Set());return}const controller=new AbortController();searchController.current=controller;setSearchState({state:'searching'});try{const result=await requestSearch(workspace.workspaceId,query,searchCaseSensitive,controller.signal);if(searchController.current===controller){setSearchState({state:'done',result});setSearchExpanded(new Set((settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT)?result.files.map(file=>file.path):[]))}}catch(error){if(error?.name==='AbortError')return;if(searchController.current===controller)setSearchState({state:'error',message:error instanceof Error?error.message:String(error)})}},[searchCaseSensitive,settings.expandSearchMatches,workspace.workspaceId])
  const closeSearch=useCallback(()=>{searchController.current?.abort();searchController.current=undefined;setSearchExpanded(new Set());setSearchOpen(false)},[])
  const openSearchMatch=useCallback((file,match)=>{const entry={kind:'file',name:file.name,path:file.path,symlink:false};chooseFile(entry);searchRevealToken.current+=1;setSearchReveal({column:match.startLineColumn??match.startColumn,endColumn:match.endLineColumn??match.endColumn,line:match.line,path:file.path,token:searchRevealToken.current})},[chooseFile])
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
    })
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
      void save(selected).then(ok => {
        if (mounted.current && ok) setEncodingDialog(undefined)
      })
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
  const renderDirectory=(path,depth)=>{const dir=directories.get(path);if(!dir||dir.state==='loading')return h(TreeStatus,{key:`${path}:loading`},translate('tree.loading'));if(dir.state==='error')return h(TreeStatus,{error:true,key:`${path}:error`},dir.message);const rows=dir.entries.map(entry=>{const open=expanded.has(entry.path);const renaming=entryDialog?.mode==='rename'&&entryDialog.entry.path===entry.path;return h(Fragment,{key:entry.path},renaming?h(TreeRenameRow,{busy:entryBusy,depth,entry,error:entryDraft.trim()===entry.name?undefined:entryDialogError,expanded:open,onCancel:closeEntryDialog,onConfirm:submitEntryDialog,onDraft:value=>{setEntryDraft(value);setEntryError(undefined)},value:entryDraft}):h(TreeRow,{cut:clipboard?.cut&&clipboard?.path===entry.path,depth,entry,expanded:open,onContextMenu:openContextMenu,onDirectory:toggleDirectory,onFile:chooseFile,onRename:beginRename,selected:selected?.path===entry.path}),entry.kind==='directory'&&open?renderDirectory(entry.path,depth+1):null)});if(dir.truncated)rows.push(h(TreeStatus,{key:`${path}:truncated`},translate('tree.truncated')));if(!rows.length)rows.push(h(TreeStatus,{key:`${path}:empty`},translate('tree.empty')));return rows}
  const closeTab = useCallback((path) => {
    const current = tabsRef.current
    const index = current.findIndex(tab => tab.path === path)
    if (index < 0) return
    const closing = current[index]
    if (closing.dirty || closing.saving) {
      const nextStatus = { error: true, text: translate('editor.unsavedTabClose') }
      if (activePathRef.current === path) setStatus(nextStatus)
      else updateTab(path, { status: nextStatus })
      return
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
  }, [forgetPathRefs, publishEditorContext, revealPath, updateTab])
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
  // Scroll the tab strip so a target tab is fully visible. The target is the
  // tab requested by pin/unpin or a preview-body click; otherwise (a file
  // opened from the tree) it is the newly activated tab. One-shot: the
  // requested path is consumed after the check so later active-path changes
  // fall back to the active tab again.
  useLayoutEffect(() => {
    const strip = previewTabsRef.current
    const target = tabScrollPathRef.current ?? activePath
    if (strip === null || target === null) return
    let tabNode = null
    for (const child of strip.children) {
      if (child instanceof HTMLElement && child.classList.contains('dsh-wel-preview-tab') && child.dataset.path === target) {
        tabNode = child
        break
      }
    }
    if (tabNode === null) return
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
  let body
  if (preview.state === 'idle') {
    body = h('div', { className: 'dsh-wel-empty' }, translate('panel.previewHint'))
  } else if (preview.state === 'loading') {
    body = h('div', { className: 'dsh-wel-empty' }, translate('editor.loading'))
  } else if (preview.state === 'error') {
    body = h('div', { className: 'dsh-wel-empty' },
      h('div', { className: 'dsh-wel-error-card' }, preview.message))
  } else {
    const highlightPreset = highlightPresetOf(settings, colorGroupOf({ kind: 'file', name: preview.name }))
    const previewReason = readOnlyReason(preview)
    body = h(Fragment, null,
      preview.truncated ? h('div', { className: 'dsh-wel-banner' }, translate('editor.previewTruncated')) : null,
      previewReason && !preview.truncated ? h('div', { className: 'dsh-wel-banner' }, translate('editor.cannotEdit', { reason: previewReason })) : null,
      h('div', { className: 'dsh-wel-preview-search', ref: searchPanelContainerRef, onContextMenu: (event) => { if (event.button !== 2) event.preventDefault() } }),
      h('div', { className: 'dsh-wel-preview-body', onClick: () => { if (activePathRef.current !== null) scrollTabIntoView(activePathRef.current) } },
        h(CodeEditor, {
          key: `${preview.path}:${preview.encoding}:${readEpoch}`,
          editorRef,
          // Prevent edits after the save snapshot has been captured. The freeze
          // is scoped to the tab being saved (its per-tab saving flag), not the
          // global saving state, so switching to another editable file during a
          // save no longer briefly locks that file.
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
            updateActiveTab({ dirty: nextDirty, draft: text })
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
        })),
      // Bottom status bar: transient notices sit below the editor body at the
      // panel's bottom edge (right-aligned), not above the search strip.
      status ? h('div', { className: 'dsh-wel-status', 'data-error': status.error || undefined }, status.text) : null)
  }
  let searchBody
  if (searchState.state === 'idle') {
    searchBody = h('div', { className: 'dsh-wel-empty' }, translate('search.hint'))
  } else if (searchState.state === 'searching') {
    searchBody = h(TreeStatus, null, translate('search.searching'))
  } else if (searchState.state === 'error') {
    searchBody = h('div', { className: 'dsh-wel-empty' },
      h('div', { className: 'dsh-wel-error-card' }, searchState.message))
  } else if (searchState.result.files.length === 0) {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-wel-search-summary' }, translate('search.noResults')),
      h('div', { className: 'dsh-wel-empty' }, translate('search.noResultsFor', { query: searchState.result.query })),
    )
  } else {
    searchBody = h(Fragment, null,
      h('div', { className: 'dsh-wel-search-summary' },
        `${translate('search.summary', { matches: searchState.result.matchCount, files: searchState.result.fileCount })}${searchState.result.truncated ? translate('search.summaryTruncated') : ''}`),
      searchState.result.files.map(file => {
        const expanded = searchExpanded.has(file.path)
        return h('div', { className: 'dsh-wel-search-file', key: file.path },
          h('button', {
            'aria-expanded': expanded,
            className: 'dsh-wel-search-file-header',
            onClick: () => toggleSearchFile(file.path),
            title: file.path,
            type: 'button',
          },
            h('span', { className: 'dsh-wel-chevron' }, expanded ? '▼' : '▶'),
            h('span', { className: 'dsh-wel-row-name' }, file.path),
            file.truncated ? h('span', { className: 'dsh-wel-search-truncated', title: translate('search.partial.title') }, translate('search.partial')) : null,
            h('span', { className: 'dsh-wel-search-file-count' }, `${file.matches.length}`),
          ),
          expanded ? file.matches.map(match => h('button', {
            className: 'dsh-wel-search-row',
            key: `${match.line}:${match.startColumn}`,
            onClick: () => openSearchMatch(file, match),
            title: translate('search.row.title', { path: file.path, line: match.line }),
            type: 'button',
          },
            h('span', { className: 'dsh-wel-search-line' }, String(match.line)),
            h('span', { className: 'dsh-wel-search-text' },
              match.text.slice(0, match.startColumn - 1),
              h('span', { className: 'dsh-wel-search-hit' }, match.text.slice(match.startColumn - 1, match.endColumn - 1)),
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
    if (draggingPath !== null && dropIndex === index) previewTabNodes.push(h('div', { 'aria-hidden': true, className: 'dsh-wel-preview-drop-indicator', key: `drop:${index}` }))
    previewTabNodes.push(h('div', {
      className: 'dsh-wel-preview-tab',
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
        className: 'dsh-wel-preview-tab-button',
        onClick: () => chooseFile(entryFromPreviewTab(tab)),
        role: 'tab',
        'aria-selected': tab.path === activePath,
        title: tab.path,
        type: 'button',
      }, h('span', { className: 'dsh-wel-preview-tab-name' }, tab.name), tab.dirty ? h('span', { className: 'dsh-wel-dirty', title: translate('tab.dirty') }, '·') : null),
      tab.pinned
        ? h('button', {
          'aria-label': translate('tab.unpinAria', { name: tab.name }),
          className: 'dsh-wel-preview-tab-close',
          'data-pinned': true,
          onClick: event => { event.stopPropagation(); unpinTab(tab.path) },
          title: translate('tab.unpin'),
          type: 'button',
        }, h(IconPin))
        : h('button', {
          'aria-label': translate('tab.closeAria', { name: tab.name }),
          className: 'dsh-wel-preview-tab-close',
          disabled: tab.dirty || tab.saving || undefined,
          onClick: event => { event.stopPropagation(); closeTab(tab.path) },
          title: tab.dirty || tab.saving ? translate('tab.close.title') : translate('tab.close'),
          type: 'button',
        }, '×'),
    ))
  }
  if (draggingPath !== null && dropIndex === tabs.length) previewTabNodes.push(h('div', { 'aria-hidden': true, className: 'dsh-wel-preview-drop-indicator', key: 'drop:end' }))
  const tabMenuTarget = tabContextMenu === undefined ? undefined : tabs.find(tab => tab.path === tabContextMenu.path)
  const treeSection = h('section', { className: 'dsh-wel-tree' },
      searchOpen
        ? h(Fragment, null,
          h('header', { className: 'dsh-wel-panel-header dsh-wel-search-header' },
            h('div', { className: 'dsh-wel-search-input-row' },
              h('input', {
                'aria-label': translate('search.placeholder'),
                autoFocus: true,
                className: 'dsh-wel-search-input',
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
                className: 'dsh-wel-icon-button dsh-wel-search-case',
                'data-active': searchCaseSensitive || undefined,
                onClick: () => setSearchCaseSensitive(value => !value),
                title: searchCaseSensitive ? translate('search.caseSensitive') : translate('search.caseInsensitive'),
                type: 'button',
              }, 'Aa'),
              h('button', {
                'aria-label': translate('search.closeAria'),
                className: 'dsh-wel-icon-button',
                onClick: closeSearch,
                title: translate('search.close.title'),
                type: 'button',
              }, '×'),
            ),
          ),
          h('div', { className: 'dsh-wel-tree-scroll' }, searchBody),
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
          h('div', { className: 'dsh-wel-tree-scroll' }, renderDirectory('', 0)),
          contextMenu ? h(TreeContextMenu, { entry: contextMenu.entry, menuRef, onRename: entry => { setContextMenu(undefined); beginRename(entry) }, onCopyName: copyEntryName, onCopyPath: copyEntryPath, onReveal: openInExplorer, onCopy: entry => copyEntryToClipboard(entry, false), onPaste: pasteEntry, onCut: entry => copyEntryToClipboard(entry, true), onDelete: openDeleteConfirm, pasteDisabled: clipboard === undefined || clipboard.workspaceId !== workspace.workspaceId, pasteTitle: clipboard === undefined ? translate('context.paste.titleEmpty') : clipboard.workspaceId !== workspace.workspaceId ? translate('context.paste.titleForeign') : translate('context.paste.title'), x: contextMenu.x, y: contextMenu.y }) : null,
          titleContextMenu ? h('div', { className: 'dsh-wel-context-menu', ref: titleMenuRef, role: 'menu', style: { left: Math.max(4, Math.min(titleContextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)), top: Math.max(4, Math.min(titleContextMenu.y, window.innerHeight - 52)) } }, h('button', { className: 'dsh-wel-context-item', onClick: openSessionRename, role: 'menuitem', title: translate('dialog.renameSession'), type: 'button' }, translate('dialog.renameSession'))) : null,
          copyNotice ? h('div', { className: 'dsh-wel-copy-notice', role: 'status' }, copyNotice) : null,
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
    h('section', { 'data-drop-active': dropActive || undefined, className: 'dsh-wel-preview', ref: previewSectionRef },
      tabs.length ? h('div', { ref: previewTabsRef, className: 'dsh-wel-preview-tabs', role: 'tablist', 'aria-label': translate('tab.list'), onDragLeave: handleTabsDragLeave, onDragOver: updateDropIndex, onDrop: handleTabsDrop }, previewTabNodes) : null,
      tabContextMenu ? h(TabContextMenu, { menuRef: tabMenuRef, onCloseOthers: () => { setTabContextMenu(undefined); closeOtherTabs(tabContextMenu.path) }, onTogglePin: () => { setTabContextMenu(undefined); if (tabMenuTarget?.pinned) unpinTab(tabContextMenu.path); else pinTab(tabContextMenu.path) }, pinned: Boolean(tabMenuTarget?.pinned), x: tabContextMenu.x, y: tabContextMenu.y }) : null,
      h('header', { className: 'dsh-wel-panel-header', onContextMenu: (event) => { event.preventDefault(); if (preview.state === 'ready' && activeTab !== undefined && !activeTab.external) setEncodingMenu({ x: event.clientX, y: event.clientY }) }, ref: previewHeaderRef },
        h('div', { className: 'dsh-wel-panel-title' },
          h('strong', { title: activeTab?.external ? activeTab.name : (activeTab?.path ?? translate('panel.filePreview')) }, activeTab?.name ?? translate('panel.filePreview'), dirty ? h('span', { className: 'dsh-wel-dirty', title: translate('tab.dirty') }, '·') : null),
          h('div', { className: 'dsh-wel-preview-header-meta' },
            activeTab
              ? (activeTab.external
                  ? h('span', { title: translate('external.externalFile.title') }, translate('external.externalFile', { name: activeTab.name }))
                  : h('span', { title: activeTab.path }, activeTab.path))
              : h('span', null, workspace.title),
            activeTab ? h('span', { className: 'dsh-wel-language' }, fileLabel(activeTab.name)) : null,
            size ? h('span', null, size) : null,
            preview.state === 'ready' && preview.encoding ? h('span', { className: 'dsh-wel-encoding', title: translate('encoding.badge') }, encodingLabel(preview.encoding)) : null,
          ),
        ),
        preview.state === 'ready'
          ? h(Fragment, null,
            h('button', {
              className: 'dsh-wel-text-button',
              disabled: Boolean(activeTab?.external),
              onClick: refreshFile,
              title: translate('editor.refresh.title'),
              type: 'button',
            }, translate('editor.refresh')),
            h('button', {
              'aria-pressed': settings.wrap === true,
              className: 'dsh-wel-text-button',
              'data-active': settings.wrap === true || undefined,
              onClick: () => settingsStore.actions.setWrap(settings.wrap !== true),
              title: settings.wrap === true ? translate('editor.wrap.off.title') : translate('editor.wrap.on.title'),
              type: 'button',
            }, translate('editor.wrap')),
            reason === null
              ? h(Fragment, null,
                h('button', { className: 'dsh-wel-text-button', disabled: !dirty || saving, onClick: cancel, type: 'button' }, translate('editor.cancel')),
                h('button', { className: 'dsh-wel-text-button', disabled: !dirty || saving, onClick: () => void save(), type: 'button' }, saving ? translate('editor.saving') : translate('editor.save')),
              )
              : null,
          )
          : null,
      ),
      body,
      dropActive ? h('div', { className: 'dsh-wel-drop-overlay', role: 'presentation' },
        h('button', { 'aria-label': translate('drop.closeAria'), className: 'dsh-wel-drop-close', onClick: () => { dropSuppressedRef.current = true; setDropActive(false) }, title: translate('drop.closeTitle'), type: 'button' }, '×'),
        h('div', { className: 'dsh-wel-drop-hint' }, translate('drop.releaseFiles'))) : null,
      previewToast ? h(PreviewToast, { headerRef: previewHeaderRef, key: previewToast.seq, onDone: () => setPreviewToast(undefined), text: previewToast.text }) : null,
    ),
  )
}

function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle }) {
  const treeSection = h('section', { className: 'dsh-wel-tree' }, h(PanelHeader, { title: sessionTitle ?? translate('panel.workspaceFiles'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-wel-empty' }, translate('panel.chooseSession')))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-wel-preview' }, h(PanelHeader, { title: translate('panel.filePreview'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-wel-empty' }, translate('panel.chooseWorkspaceToBrowse'))))
}function ExplorerSettingsSection({ settingsStore }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const rowHeight = clamp(settings.rowHeight ?? ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)
  const chatFontSize = clamp(settings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX)
  const conflictFontSize = clamp(settings.conflictFontSize ?? CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MIN, CONFLICT_FONT_SIZE_MAX)
  const customizedCount = Object.keys(settings.fileColors ?? {}).length
  const customizedPresetCount = Object.keys(settings.highlightPresets ?? {}).length
  return h('div', { className: 'dsh-wel-explorer-settings' },
    h('div', { className: 'dsh-wel-settings-group' },
      h('div', { className: 'dsh-wel-settings-group-title' }, translate('settings.group.browse')),
      h('div', { className: 'dsh-wel-settings-row' },
        h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-row-height' }, translate('settings.rowHeight')),
        h('input', {
          'aria-label': translate('settings.rowHeight'),
          className: 'dsh-wel-settings-slider',
          id: 'dsh-wel-row-height',
          max: ROW_HEIGHT_MAX,
          min: ROW_HEIGHT_MIN,
          onChange: e => settingsStore.actions.setRowHeight(Number(e.target.value)),
          step: 2,
          type: 'range',
          value: rowHeight,
        }),
        h('span', { className: 'dsh-wel-settings-value' }, `${rowHeight}px`),
        h('button', {
          className: 'dsh-wel-text-button',
          disabled: rowHeight === ROW_HEIGHT_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setRowHeight(ROW_HEIGHT_DEFAULT),
          title: translate('settings.rowHeight.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-wel-settings-row' },
        h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-search-expand-default' }, translate('settings.searchResult')),
        h('select', {
          'aria-label': translate('settings.searchResult'),
          className: 'dsh-wel-highlight-preset-select',
          id: 'dsh-wel-search-expand-default',
          onChange: e => settingsStore.actions.setExpandSearchMatches(e.target.value === 'expanded'),
          value: (settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT) ? 'expanded' : 'collapsed',
        },
          h('option', { value: 'expanded' }, translate('settings.expanded')),
          h('option', { value: 'collapsed' }, translate('settings.collapsed')))),
      h('div', { className: 'dsh-wel-file-colors-title' }, translate('settings.fileColors')),
      h('div', { className: 'dsh-wel-file-colors' },
        FILE_COLOR_GROUPS.map(({ group }) => { const label = fileColorGroupLabel(group); return h('div', { className: 'dsh-wel-file-color-row', key: group },
          h('span', { className: 'dsh-wel-file-color-name', title: label }, label),
          h('input', {
            'aria-label': translate('settings.fileColor.aria', { label }),
            className: 'dsh-wel-file-color-input',
            onChange: e => settingsStore.actions.setFileColor(group, e.target.value),
            type: 'color',
            value: fileColorOf(settings, group),
          }),
          h('button', {
            className: 'dsh-wel-file-color-reset',
            disabled: settings.fileColors?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetFileColor(group),
            title: translate('settings.fileColor.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-wel-file-colors-actions' },
        h('button', {
          className: 'dsh-wel-text-button',
          disabled: customizedCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetFileColors(),
          type: 'button',
        }, translate('settings.resetAllColors'))),
    ),
    h('div', { className: 'dsh-wel-explorer-divider' }),
    h('div', { className: 'dsh-wel-settings-group' },
      h('div', { className: 'dsh-wel-settings-group-title' }, translate('settings.group.content')),
      h('div', { className: 'dsh-wel-file-colors-title' }, translate('settings.presets')),
      h('div', { className: 'dsh-wel-file-colors' },
        FILE_COLOR_GROUPS.map(({ group }) => { const label = fileColorGroupLabel(group); return h('div', { className: 'dsh-wel-file-color-row', key: `preset-${group}` },
          h('span', { className: 'dsh-wel-file-color-name', title: label }, label),
          h('select', {
            'aria-label': translate('settings.preset.aria', { label }),
            className: 'dsh-wel-highlight-preset-select',
            onChange: e => settingsStore.actions.setHighlightPreset(group, e.target.value),
            value: highlightPresetOf(settings, group),
          },
            HIGHLIGHT_PRESETS.map(preset => h('option', { key: preset.id, value: preset.id }, highlightPresetLabel(preset.id)))),
          h('button', {
            className: 'dsh-wel-file-color-reset',
            disabled: settings.highlightPresets?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetHighlightPreset(group),
            title: translate('settings.preset.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-wel-file-colors-actions' },
        h('button', {
          className: 'dsh-wel-text-button',
          disabled: customizedPresetCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetHighlightPresets(),
          type: 'button',
        }, translate('settings.resetAllPresets'))),
      h('div', { className: 'dsh-wel-settings-row' },
        h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-conflict-font-size' }, translate('settings.conflictFontSize')),
        h('input', {
          'aria-label': translate('settings.conflictFontSize'),
          className: 'dsh-wel-settings-slider',
          id: 'dsh-wel-conflict-font-size',
          max: CONFLICT_FONT_SIZE_MAX,
          min: CONFLICT_FONT_SIZE_MIN,
          onChange: e => settingsStore.actions.setConflictFontSize(Number(e.target.value)),
          step: 1,
          type: 'range',
          value: conflictFontSize,
        }),
        h('span', { className: 'dsh-wel-settings-value' }, `${conflictFontSize}px`),
        h('button', {
          className: 'dsh-wel-text-button',
          disabled: conflictFontSize === CONFLICT_FONT_SIZE_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setConflictFontSize(CONFLICT_FONT_SIZE_DEFAULT),
          title: translate('settings.conflictFontSize.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-wel-explorer-divider' }),
    h('div', { className: 'dsh-wel-settings-group' },
      h('div', { className: 'dsh-wel-settings-group-title' }, translate('settings.group.dialog')),
      h('div', { className: 'dsh-wel-settings-row' },
        h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-chat-font-size' }, translate('settings.chatFont')),
        h('input', {
          'aria-label': translate('settings.chatFont'),
          className: 'dsh-wel-settings-slider',
          id: 'dsh-wel-chat-font-size',
          max: CHAT_FONT_SIZE_MAX,
          min: CHAT_FONT_SIZE_MIN,
          onChange: e => settingsStore.actions.setChatFontSize(Number(e.target.value)),
          step: 1,
          type: 'range',
          value: chatFontSize,
        }),
        h('span', { className: 'dsh-wel-settings-value' }, `${chatFontSize}px`),
        h('button', {
          className: 'dsh-wel-text-button',
          disabled: chatFontSize === CHAT_FONT_SIZE_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setChatFontSize(CHAT_FONT_SIZE_DEFAULT),
          title: translate('settings.chatFont.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-wel-settings-row' },
        h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-auto-expand-think' }, translate('settings.autoExpandThink')),
        h('input', {
          'aria-label': translate('settings.autoExpandThink'),
          checked: (settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) === true,
          className: 'dsh-wel-settings-checkbox',
          id: 'dsh-wel-auto-expand-think',
          onChange: e => settingsStore.actions.setAutoExpandThink(e.target.checked),
          type: 'checkbox',
        })),
      h('div', { className: 'dsh-wel-settings-row' },
        h('label', { className: 'dsh-wel-settings-label', htmlFor: 'dsh-wel-think-collapse-delay' }, translate('settings.thinkDelay')),
        h('input', {
          'aria-label': translate('settings.thinkDelay'),
          className: 'dsh-wel-settings-slider',
          disabled: (settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) !== true || undefined,
          id: 'dsh-wel-think-collapse-delay',
          max: THINK_COLLAPSE_DELAY_MAX_S,
          min: THINK_COLLAPSE_DELAY_MIN_S,
          onChange: e => settingsStore.actions.setThinkCollapseDelay(Number(e.target.value)),
          step: THINK_COLLAPSE_DELAY_STEP_S,
          type: 'range',
          value: settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S,
        }),
        h('span', { className: 'dsh-wel-settings-value' }, `${(settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S).toFixed(1)}s`)),
    ),
    h('div', { className: 'dsh-wel-settings-hint' }, translate('settings.hint')),
  )
}
/* The session-switcher dropdown: rendered in the conversation header's action
   row (order -400, leftmost) as the visible session title — the harness's
   current-title crumb is hidden by CSS (desktop and mobile). Clicking the
   trigger opens a portalled panel listing every session (most recently
   updated first, the current one highlighted, each row showing the session
   title with its workspace name as a distinguishing suffix); clicking a row
   switches to that session through the same ctx.sessions.open the sidebar
   list uses. The panel is portalled to document.body and fixed-positioned
   from the trigger rect, so the chat column's overflow cannot clip it. */
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
    const chat = trigger.closest('.dsh-wel-chat')
    const chatRect = chat?.getBoundingClientRect()
    const width = chatRect !== undefined && chatRect.width > 0
      ? Math.max(360, Math.round(chatRect.width * 0.33))
      : Math.max(360, rect.width)
    // Keep the panel horizontally inside the conversation column. In mobile
    // the header's two leading icons push the trigger right, so the wide
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
    setOpen(prev => {
      if (prev) return false
      const next = measurePos()
      if (next === null) return false
      setPos(next)
      return true
    })
  }, [measurePos])
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
  }, [list, workspaces])
  const trigger = h('button', {
    'aria-expanded': open,
    'aria-haspopup': 'listbox',
    'aria-label': translate('switcher.aria'),
    className: 'dsh-wel-session-switcher-trigger',
    onClick: toggle,
    ref: triggerRef,
    title: translate('switcher.trigger.title'),
    type: 'button',
  },
    h('span', { className: 'dsh-wel-session-switcher-title' }, currentTitle ?? ''),
    h('span', { className: 'dsh-wel-chevron' }, open ? '▲' : '▼'))
  const panel = open && pos !== null ? createPortal(
    h('div', {
      className: 'dsh-wel-session-switcher-panel',
      ref: panelRef,
      role: 'listbox',
      style: { left: pos.left, top: pos.top, width: pos.width },
    },
      rows.length === 0 ? h('div', { className: 'dsh-wel-session-switcher-empty' }, translate('switcher.noSessions'))
        : rows.map(row => h('button', {
          'aria-selected': row.summary.id === sessionId,
          className: row.summary.id === sessionId ? 'dsh-wel-session-switcher-row dsh-wel-session-switcher-current' : 'dsh-wel-session-switcher-row',
          key: row.summary.id,
          onClick: () => { openSession(row.summary.id); setOpen(false) },
          role: 'option',
          type: 'button',
        },
          h('span', { className: 'dsh-wel-session-switcher-row-main' },
            row.summary.displayTitle,
            row.summary.origin === 'subagent' ? h('span', { className: 'dsh-wel-session-switcher-badge' }, translate('switcher.subagent')) : null),
          row.workspaceTitle !== undefined ? h('span', { className: 'dsh-wel-session-switcher-row-ws' }, row.workspaceTitle) : null))),
    document.body,
  ) : null
  return h('div', { className: 'dsh-wel-session-switcher' }, trigger, panel)
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

/* Key of a branch's placeholder card (a forked session with no turns yet),
   shared by the layout and the current-card highlight so the "当前" badge can
   light the "等待新问题" card. */
const mindmapEmptyKey = (sessionId) => mindmapDocKey(String(sessionId), `empty:${String(sessionId)}`)

/* Plan of a card deletion (right-click → 删除卡片): the card is removed by
   TRUNCATING its session chain — the card and every later card in the same
   session are cut, the session is re-created from the previous card (a fork
   at its turn/end), and the OLD session is archived, so the chat truly shows
   the truncated conversation. Every branch hanging off a removed card is
   archived too. An empty branch's placeholder card — or a branch's FIRST
   card, which has no earlier card in the branch to truncate at — removes the
   whole branch instead (the session and its subtree are archived). The doc
   records NO tombstones: a removed turn can only resurface through a failed
   archive of its old session, which is ACCEPTED behavior (the deletion is a
   pure fork + archive + replace; see docs/mindmap-notes.md). Returns null
   when the target card is not in the doc, or a plan { archiveIds, trunk,
   branches, replaced, wholeBranch, firstTrunk, next }. */
function mindmapDeletePlan(doc, ownerId, turnSeq, emptyCard) {
  const root = String(doc?.rootSessionId ?? '')
  const branches = doc?.branches ?? []
  const ownerIsRoot = String(ownerId) === root
  const branch = ownerIsRoot ? undefined : branches.find(b => String(b?.sessionId) === String(ownerId))
  const chain = ownerIsRoot ? (doc?.trunk ?? []) : (branch?.turns ?? [])
  const removed = []
  const pruneIds = new Set()
  const pushTurn = (sessionId, turn) => {
    if (turn === null || turn === undefined) return
    removed.push({ sessionId: String(sessionId), seq: Number(turn.seq), n: Number(turn.n) })
  }
  let idx = -1
  let wholeBranch = false
  if (emptyCard) {
    /* An empty branch's placeholder: no truncation is possible, the whole
       branch (session + subtree) is removed. */
    if (ownerIsRoot) return null
    wholeBranch = true
  } else {
    idx = chain.findIndex(turn => Number(turn?.seq) === Number(turnSeq))
    if (idx === -1) return null
    if (ownerIsRoot && idx === 0) return { firstTrunk: true }
    if (idx === 0) wholeBranch = true
  }
  if (wholeBranch) {
    pruneIds.add(String(ownerId))
    for (const turn of chain) pushTurn(ownerId, turn)
  } else {
    for (let i = idx; i < chain.length; i += 1) pushTurn(ownerId, chain[i])
  }
  /* Branch subtree: every branch whose parent card is one of the removed
     cards, recursively (grandchildren hang off the removed branches' cards). */
  for (let cursor = 0; cursor < removed.length; cursor += 1) {
    const t = removed[cursor]
    for (const b of branches) {
      if (b === null || b === undefined) continue
      if (pruneIds.has(String(b.sessionId))) continue
      if (String(b?.parentSessionId) === String(t.sessionId) && Number(b?.parentTurn) === Number(t.n)) {
        pruneIds.add(String(b.sessionId))
        for (const turn of b?.turns ?? []) pushTurn(b.sessionId, turn)
      }
    }
  }
  const removedBySession = new Map()
  for (const t of removed) {
    if (!removedBySession.has(t.sessionId)) removedBySession.set(t.sessionId, new Set())
    removedBySession.get(t.sessionId).add(t.seq)
  }
  const keep = (sessionId, turn) => !removedBySession.get(String(sessionId))?.has(Number(turn?.seq))
  const nextTrunk = !wholeBranch && ownerIsRoot
    ? (doc?.trunk ?? []).filter(turn => keep(root, turn))
    : (doc?.trunk ?? [])
  const nextBranches = branches
    .filter(b => b !== null && b !== undefined && !pruneIds.has(String(b.sessionId)))
    .map(b => String(b?.sessionId) === String(ownerId) && !wholeBranch
      ? { ...b, turns: (b?.turns ?? []).filter(turn => keep(String(ownerId), turn)) }
      : b)
  /* Fresh doc-wide counter: continue after the largest remaining card number,
     so deleted numbers are reused instead of leaving gaps. */
  let maxN = 0
  for (const turn of nextTrunk) maxN = Math.max(maxN, Number(turn?.n) || 0)
  for (const b of nextBranches) for (const turn of b?.turns ?? []) maxN = Math.max(maxN, Number(turn?.n) || 0)
  return {
    archiveIds: [...pruneIds],
    trunk: nextTrunk,
    branches: nextBranches,
    replaced: wholeBranch
      ? null
      : { sessionId: String(ownerId), forkAt: Number(chain[idx - 1].seq) },
    wholeBranch,
    firstTrunk: false,
    next: maxN + 1,
  }
}

/* Stable fingerprint of a doc's structure (turn seqs + the map's own title),
   used to skip redundant re-renders after a sync that changed nothing. The
   rootTitle is included so a sidebar rename of the map title reaches an open
   map on the next sync (a seq-only fingerprint skipped it). */
function mindmapDocFingerprint(doc) {
  const trunk = (doc?.trunk ?? []).map(turn => turn?.seq).join(',')
  const branches = (doc?.branches ?? []).map(branch =>
    `${branch?.sessionId}:${(branch?.turns ?? []).map(turn => turn?.seq).join(',')}`).join(';')
  return `${String(doc?.rootTitle ?? '')}|${trunk}|${branches}`
}

/* Doc layout: trunk turns are one left-to-right chain; each branch's turn
   chain hangs off its parent card (parentSessionId + display turn n). A branch
   with no turns yet renders one placeholder card. Branch rows are ordered by
   the mount position on the trunk (see below). An optional `streaming`
   descriptor ({ sessionId, question }) appends an ephemeral live card to that
   session's chain tail (replacing the placeholder of an empty branch).
   Returns { nodes, edges, width, height } — nodes carry key/sessionId/turn/
   branch/empty/streaming/depth/row/y/height, edges are { from, to } key
   pairs. */
function mindmapDocLayout(doc, streaming) {
  const nodes = []
  const edges = []
  const rootId = doc?.rootSessionId
  const trunk = doc?.trunk ?? []
  const branches = doc?.branches ?? []
  trunk.forEach((turn, index) => {
    nodes.push({
      key: mindmapDocKey(rootId, turn?.seq),
      sessionId: rootId,
      turn,
      branch: undefined,
      empty: false,
      depth: index,
      row: 0,
      height: MINDMAP_NODE_H,
    })
    if (index > 0) {
      edges.push({
        from: mindmapDocKey(rootId, trunk[index - 1].seq),
        to: mindmapDocKey(rootId, turn.seq),
      })
    }
  })
  /* Branch row order follows the MOUNT position on the trunk, not the
     creation order: each branch's row is assigned after grouping branches by
     the trunk card they hang off (walking the fork lineage for cascaded
     branches), so a branch is never pushed down by branches of a different
     group. Branches of the same group keep their creation order. */
  const trunkNIndex = new Map()
  trunk.forEach((turn, index) => { if (turn?.n !== undefined) trunkNIndex.set(Number(turn.n), index) })
  const anchorOf = new Map()
  for (const branch of branches) {
    if (branch === null || branch === undefined) continue
    let cursor = branch
    const seen = new Set()
    while (cursor !== undefined && !seen.has(String(cursor.sessionId))) {
      seen.add(String(cursor.sessionId))
      if (String(cursor.parentSessionId) === String(rootId)) {
        const anchor = trunkNIndex.get(Number(cursor.parentTurn))
        anchorOf.set(String(branch.sessionId), anchor === undefined ? trunk.length : anchor)
        break
      }
      cursor = branches.find(b => b !== null && b !== undefined
        && String(b.sessionId) === String(cursor.parentSessionId))
    }
    /* Unresolvable mount (legacy/inconsistent doc): keep the branch stable at
       the end instead of colliding with a real group. */
    if (!anchorOf.has(String(branch.sessionId))) anchorOf.set(String(branch.sessionId), trunk.length)
  }
  const orderedBranches = branches
    .filter(b => b !== null && b !== undefined)
    .map((branch, branchIndex) => ({
      branch,
      branchIndex,
      anchor: anchorOf.get(String(branch.sessionId)) ?? trunk.length,
    }))
    .sort((a, b) => a.anchor - b.anchor || a.branchIndex - b.branchIndex)
    .map(entry => entry.branch)
  orderedBranches.forEach((branch, branchIndex) => {
    const parent = nodes.find(n => String(n.sessionId) === String(branch.parentSessionId)
      && Number(n.turn?.n) === Number(branch.parentTurn))
    const startDepth = parent === undefined ? 0 : parent.depth + 1
    const turns = Array.isArray(branch.turns) && branch.turns.length > 0 ? branch.turns : [undefined]
    let prevKey = parent === undefined ? undefined : parent.key
    turns.forEach((turn, index) => {
      const empty = turn === undefined
      const key = empty ? mindmapEmptyKey(branch.sessionId) : mindmapDocKey(branch.sessionId, turn.seq)
      nodes.push({
        key,
        sessionId: branch.sessionId,
        turn,
        branch,
        empty,
        depth: startDepth + index,
        row: 1 + branchIndex,
        height: MINDMAP_NODE_H,
      })
      if (prevKey !== undefined) edges.push({ from: prevKey, to: key })
      prevKey = key
    })
  })
  /* Live streaming card: the map's own session has a turn in flight — append
     a card to its chain tail (a branch awaiting its first turn gets its
     placeholder card replaced instead). The card is ephemeral UI, never part
     of the doc: once the completed turn is folded by the next sync it is
     replaced by the normal card. */
  if (streaming !== null && streaming !== undefined) {
    const sid = String(streaming.sessionId)
    const isRoot = sid === String(rootId)
    const branch = isRoot
      ? undefined
      : branches.find(b => b !== null && b !== undefined && String(b?.sessionId) === sid)
    const chain = isRoot
      ? nodes.filter(n => n.branch === undefined)
      : nodes.filter(n => String(n.sessionId) === sid)
    const last = chain[chain.length - 1]
    if (last !== undefined) {
      const replaceEmpty = last.empty === true
      const streamingNode = {
        key: `streaming:${sid}`,
        sessionId: sid,
        turn: undefined,
        branch,
        empty: false,
        streaming: true,
        /* A replaced placeholder keeps its position; an appended card goes
           one depth deeper than the chain tail. */
        depth: replaceEmpty ? last.depth : last.depth + 1,
        row: last.row,
        height: MINDMAP_NODE_H,
        question: typeof streaming.question === 'string' ? streaming.question : '',
        turnN: isRoot ? ((Number.isSafeInteger(last.turn?.n) ? Number(last.turn.n) : 0) + 1) : undefined,
        parentKey: undefined,
      }
      if (replaceEmpty) {
        /* Replace the placeholder card of a branch awaiting its first turn;
           the parent of the frame is the card the placeholder hung off. */
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
  }
  const rows = new Map()
  for (const node of nodes) {
    if (!rows.has(node.row)) rows.set(node.row, [])
    rows.get(node.row).push(node)
  }
  let y = MINDMAP_ROW_GAP
  for (const rowNodes of rows.values()) {
    for (const node of rowNodes) node.y = y
    y += MINDMAP_NODE_H + MINDMAP_ROW_GAP
  }
  let maxDepth = 0
  for (const node of nodes) maxDepth = Math.max(maxDepth, node.depth)
  const width = (maxDepth + 1) * (MINDMAP_NODE_W + MINDMAP_DEPTH_GAP) + MINDMAP_DEPTH_GAP
  const height = y - MINDMAP_ROW_GAP
  return { nodes, edges, width, height }
}

const mindmapXOf = depth => MINDMAP_DEPTH_GAP + depth * (MINDMAP_NODE_W + MINDMAP_DEPTH_GAP)

/* Clamp a view translation so the scaled world always keeps a MINIMUM fraction
   on screen instead of a fixed pixel ledge: each axis may be dragged out by up
   to MINDMAP_PAN_OUT_MAX of the world size (e.g. 80%), so the opposite 20% of
   the map stays visible. Unlike the old clamp this also lets a map SMALLER
   than the viewport slide around (it is no longer pinned to the center) —
   panning up/down/left/right feels looser, and the "还原视图" button restores
   the fitted position any time the map is pushed out of reach. */
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

/* Narrowed sessions subscription for the floating map. The map only reads the
   doc family's running flags and display titles, but `useSessions(state =>
   state)` re-renders every card on ANY session change (including streaming
   churn in unrelated sessions). The selector returns the SAME projection
   object while the family's fields are unchanged, so idle store churn never
   re-renders the map; the projection is rebuilt when a family field changes
   or the family set grows (the caller keeps `familyIdsRef` current). The
   projection also keeps the latest byId reference so reads stay fresh. */
function useMindmapSessionView(useSessions, familyIdsRef) {
  const cacheRef = useRef(null)
  return useSessions((state) => {
    const byId = state?.byId ?? {}
    const family = familyIdsRef.current
    const runningKey = family.map(id => (byId[id]?.running === true ? '1' : '0')).join('|')
    const titlesKey = family.map(id => byId[id]?.displayTitle ?? '').join('\u0001')
    const cache = cacheRef.current
    if (cache !== null && cache.runningKey === runningKey && cache.titlesKey === titlesKey) {
      cache.view.byId = byId
      return cache.view
    }
    const view = {
      byId,
      runningIds: new Set(family.filter(id => byId[id]?.running === true)),
      titles: Object.fromEntries(family.map(id => [id, byId[id]?.displayTitle ?? ''])),
    }
    cacheRef.current = { runningKey, titlesKey, view }
    return view
  })
}

/* One absolutely-positioned map card. Extracted so `memo` can skip rebuilding
   cards whose props are unchanged: a doc-triggered re-render only rebuilds the
   added / changed / current-badge-flipped cards. */
const MindMapCard = memo(function MindMapCard({
  entry, title, isCurrent, isStreaming, isFrameParent, isAncestor, onOpen, onMenu,
}) {
  const classes = (entry.branch !== undefined
    ? 'dsh-wel-mindmap-node dsh-wel-mindmap-branchcard'
    : 'dsh-wel-mindmap-node')
    + (isCurrent ? ' dsh-wel-mindmap-node-current' : '')
    + (isStreaming ? ' dsh-wel-mindmap-node-streaming' : '')
    + (isFrameParent ? ' dsh-wel-mindmap-node-frame-parent' : '')
    + (isAncestor ? ' dsh-wel-mindmap-node-ancestor' : '')
  const turn = entry.turn
  return h('div', {
    className: classes,
    'data-branch': entry.branch !== undefined ? '' : undefined,
    key: entry.key,
    onClick: () => { onOpen(entry) },
    onContextMenu: !isStreaming
      ? (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) }
      : undefined,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style: { left: mindmapXOf(entry.depth), top: entry.y, width: MINDMAP_NODE_W, height: entry.height },
    title: isStreaming ? translate('mindmap.streaming') : translate('mindmap.open.hint'),
  },
    isCurrent ? h('span', { className: 'dsh-wel-mindmap-node-current-badge' }, translate('mindmap.current')) : null,
    h('div', { className: 'dsh-wel-mindmap-node-title' },
      entry.branch !== undefined ? h('span', { className: 'dsh-wel-mindmap-pending-label' }, translate('mindmap.branchTag')) : null,
      title),
    entry.empty
      ? h('div', { className: 'dsh-wel-mindmap-pending-title' }, translate('mindmap.pending'))
      : isStreaming
        ? h('div', { className: 'dsh-wel-mindmap-node-q' }, mindmapClip(entry.question || translate('mindmap.streaming'), MINDMAP_TEXT_MAX))
        : h('div', { className: 'dsh-wel-mindmap-node-q' }, mindmapClip(turn.user || translate('mindmap.emptyRound'), MINDMAP_TEXT_MAX)),
    entry.empty
      ? null
      : isStreaming
        ? h('div', { className: 'dsh-wel-mindmap-node-status dsh-wel-mindmap-node-streaming-status' },
            h('span', { className: 'dsh-wel-mindmap-node-streaming-dot' }),
            h('span', null, translate('mindmap.streaming')))
        : h('div', { className: 'dsh-wel-mindmap-node-status dsh-wel-mindmap-node-done' }, translate('mindmap.done')))
})

/* The floating mind map: a persisted turn tree (trunk + fork branches)
   rendered from the doc, with pan/zoom and per-card forking. Rendered inside
   the left-side overlay window; card clicks switch the right-side chat. */
function MindMapView({ sessionId, useSessions, loadDoc, saveDoc, syncDoc, deleteDoc, forkAt, openSession, renameSession, archiveSession }) {
  const overlay = useMindmapOverlay()
  const [phase, setPhase] = useState({ status: 'loading' })
  const [doc, setDoc] = useState(null)
  const [rootId, setRootId] = useState(null)
  /* The doc family ids, kept current BEFORE the narrowed sessions subscription
     below runs (the selector cannot close over doc/rootId directly, and its
     getSnapshot must see the fresh family during this render). */
  const familyIdsRef = useRef([])
  familyIdsRef.current = doc === null || rootId === null
    ? []
    : [String(rootId), ...(doc.branches ?? []).map(b => String(b?.sessionId))]
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
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState(null)
  const [menu, setMenu] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [notice, setNotice] = useState(null)
  /* Latest sync payload's live-turn info ({ sessionId, turn, question } or
     null) for the overlay's own session, driving the streaming card. */
  const [live, setLive] = useState(null)
  const [dragging, setDragging] = useState(false)
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
    setNotice(text)
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
    /* A session switch INSIDE the loaded document family (the floating map
       keeps ONE map per family — every clickable card belongs to it): the
       "当前" highlight (currentKey) and the right-side chat follow the
       sessionId prop, the document itself is identical, so reloading it
       would rebuild the whole canvas for nothing. Only a session OUTSIDE
       the family (another mind map opened over this one) triggers a full
       reload. rootId/doc are read at call time on purpose. */
    if (rootId !== null && (String(sessionId) === String(rootId)
      || (doc?.branches ?? []).some(b => String(b?.sessionId) === String(sessionId)))) {
      setForkError(null)
      return undefined
    }
    let cancelled = false
    setDoc(null)
    setRootId(null)
    setLive(null)
    setPhase({ status: 'loading' })
    setForkError(null)
    /* A full reload switches to a DIFFERENT document family (or a fresh doc):
       reset the view so the new map is fitted on load instead of inheriting
       the previous family's transform (fittedRef was only ever set, never
       reset, so switching maps kept the old pan/zoom). */
    fittedRef.current = false
    viewRef.current = { tx: 0, ty: 0, zoom: 1 }
    const id = String(sessionId)
    Promise.resolve(loadDocRef.current(id))
      .then((payload) => {
        if (cancelled) return
        const loaded = payload?.doc
        if (loaded === null || loaded === undefined || (loaded.trunk ?? []).length === 0) {
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
        setPhase({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { cancelled = true }
  }, [sessionId])

  /* Empty-state refresh: when the map opened on a session with no completed
     turn (phase 'empty'), rootId stays null and neither sync effect below can
     run — poll loadDoc so the FIRST completed turn converts the document and
     the cards appear without a reopen (the empty-state copy promises exactly
     this). The probe is cheap: a session without turns answers { exists:
     false } immediately, and the state is short-lived by nature. */
  useEffect(() => {
    if (phase.status !== 'empty') return undefined
    let cancelled = false
    const probe = () => {
      const id = String(sessionId)
      Promise.resolve(loadDocRef.current(id))
        .then((payload) => {
          if (cancelled) return
          const loaded = payload?.doc
          if (loaded !== null && loaded !== undefined && (loaded.trunk ?? []).length > 0) {
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
    if (!mountedRef.current || root !== rootId) return
    /* The doc's root was archived by a path OUTSIDE the map (the harness's own
       archive, the sidebar root archive): the Host answers { exists: false }.
       Close the floating window like the toolbar-archive path does instead of
       leaving a stale map behind. */
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
    const liveNext = payload?.live ?? null
    setLive(prev => (prev === null && liveNext === null)
      || (prev !== null && liveNext !== null
        && String(prev.sessionId) === String(liveNext.sessionId)
        && Number(prev.turn) === Number(liveNext.turn)
        && String(prev.question ?? '') === String(liveNext.question ?? ''))
      ? prev : liveNext)
  }, [rootId])

  /* The doc-family session that is currently running (at most one in
     practice): the live streaming card attaches to ITS chain regardless of
     which session the floating map is "on", and every sync asks for that
     session's in-flight question text. Declared BEFORE the debounced effect
     below — its dependency array reads this binding at call time. */
  const runningFamilyId = useMemo(() => {
    if (doc === null || rootId === null) return undefined
    const family = [String(rootId), ...(doc.branches ?? []).map(b => String(b?.sessionId))]
    return family.find(id => list.runningIds.has(id))
  }, [doc, list, rootId])
  const runningFamilyIdRef = useRef(undefined)
  runningFamilyIdRef.current = runningFamilyId

  /* Periodic sync while mounted: fold new branch turns from the full logs so
     a branch that completes a turn in the chat appears live. */
  useEffect(() => {
    if (rootId === null) return undefined
    const timer = window.setInterval(() => {
      if (savingRef.current) return
      const root = rootId
      Promise.resolve(syncDocRef.current(root, runningFamilyIdRef.current))
        .then((payload) => { applySync(payload, root) })
        .catch(() => { /* transient sync failure: keep the current doc */ })
    }, MINDMAP_SYNC_MS)
    return () => { clearInterval(timer) }
  }, [applySync, rootId])

  /* Sync shortly after the doc-family running state changes: a run start
     brings the in-flight question back quickly; a run end folds the just
     completed turn (the map may be showing a different session than the one
     that just ran), debounced against streaming updates. */
  useEffect(() => {
    if (rootId === null) return undefined
    const timer = window.setTimeout(() => {
      if (!mountedRef.current || savingRef.current) return
      const root = rootId
      Promise.resolve(syncDocRef.current(root, runningFamilyIdRef.current))
        .then((payload) => { applySync(payload, root) })
        .catch(() => { /* transient */ })
    }, 600)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningFamilyId, rootId])

  /* The live streaming card: the running doc-family session has a turn in
     flight — a live card is appended to its chain tail. The in-flight
     question arrives with the next sync payload; until then the card shows
     the streaming label. Declared BEFORE the layout memo that consumes it
     (use-before-declaration would throw a TDZ error on every render). */
  const streamingCard = useMemo(() => {
    if (runningFamilyId === undefined) return null
    const liveTurn = (live !== null && String(live.sessionId) === String(runningFamilyId)) ? live : null
    return {
      sessionId: String(runningFamilyId),
      question: liveTurn === null ? '' : (typeof liveTurn.question === 'string' ? liveTurn.question : ''),
    }
  }, [live, runningFamilyId])

  const layout = useMemo(() => mindmapDocLayout(doc, streamingCard), [doc, streamingCard])

  /* Edge path strings and the streaming frame, derived from the layout and
     stable between doc changes — memoized so a re-render (rare, after A1 the
     pan/zoom path never re-renders) does not rebuild them. */
  const edgeView = useMemo(() => {
    const byKey = new Map()
    for (const node of layout.nodes) byKey.set(node.key, node)
    const edges = []
    for (const edge of layout.edges) {
      const from = byKey.get(edge.from)
      const to = byKey.get(edge.to)
      if (from === undefined || to === undefined) continue
      const x1 = mindmapXOf(from.depth) + MINDMAP_NODE_W
      const y1 = from.y + from.height / 2
      const x2 = mindmapXOf(to.depth)
      const y2 = to.y + to.height / 2
      const mx = (x1 + x2) / 2
      /* Keep the edge's from/to identities so the render pass can mark the
         current card's ancestor-trace edges (from/to are strings). */
      edges.push({ from: edge.from, to: edge.to, d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}` })
    }
    /* The live streaming node (if any) and its parent card: the frame encloses
       exactly these two cards as one unit while a turn is in flight. */
    const streamingEntry = layout.nodes.find(n => n.streaming === true)
    let frame = null
    let streamingParentKey = undefined
    if (streamingEntry !== undefined) {
      streamingParentKey = streamingEntry.parentKey
      const parent = streamingEntry.parentKey === undefined ? undefined : byKey.get(streamingEntry.parentKey)
      const cards = parent === undefined ? [streamingEntry] : [streamingEntry, parent]
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const card of cards) {
        const x = mindmapXOf(card.depth)
        left = Math.min(left, x)
        top = Math.min(top, card.y)
        right = Math.max(right, x + MINDMAP_NODE_W)
        bottom = Math.max(bottom, card.y + card.height)
      }
      frame = {
        left: left - MINDMAP_FRAME_PAD,
        top: top - MINDMAP_FRAME_PAD,
        width: right - left + MINDMAP_FRAME_PAD * 2,
        height: bottom - top + MINDMAP_FRAME_PAD * 2,
      }
    }
    return { edges, streamingEntry, streamingParentKey, frame }
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
  /* Replay the transform after every render: the transform is owned by the DOM
     (not React state), so a doc-driven re-render must re-apply the current
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
     starts a drag; pointer capture keeps the motion tracked outside the box. */
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

  /* Key of the current session's last card (root tail or branch tail), for
     the "current" highlight. While the CURRENT session is generating, its
     chain tail is the live streaming card (key `streaming:<sid>`): point the
     badge at it — for an empty branch the placeholder card was replaced by
     the streaming card, so a doc-derived key would match nothing and the
     badge would vanish for the whole generation. */
  const currentKey = useMemo(() => {
    if (doc === null || rootId === null) return undefined
    const current = String(sessionId)
    if (runningFamilyId !== undefined && String(runningFamilyId) === current) {
      return `streaming:${current}`
    }
    if (current === String(rootId)) {
      const trunk = doc.trunk ?? []
      const last = trunk[trunk.length - 1]
      return last === undefined ? undefined : mindmapDocKey(rootId, last.seq)
    }
    const branch = (doc.branches ?? []).find(b => String(b?.sessionId) === current)
    if (branch === undefined) return undefined
    const turns = branch.turns ?? []
    const last = turns[turns.length - 1]
    return last === undefined ? mindmapEmptyKey(branch.sessionId) : mindmapDocKey(branch.sessionId, last.seq)
  }, [doc, rootId, runningFamilyId, sessionId])

  /* Ancestor trace of the selected (current) card: walk the layout's edges
     BACKWARD from currentKey (each edge's `to → from`) until the root (no
     incoming edge). Yields the set of parent-node keys — the selected card
     itself keeps the solid highlight and is therefore excluded — and the set
     of edge identities on the path; the render marks those edges dashed
     primary-blue and those parent nodes with dashed borders. Memoized on
     [currentKey, layout] so a session switch inside the family re-traces
     cheaply without touching the pan/zoom path; lookups are O(1) Set reads. */
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

  /* Open a session inside the map: the wrapped openSession switches the
     right-side conversation to it and moves the "当前" highlight here; the
     floating overlay itself stays open (there is no view ring anymore). */
  const openBranch = useCallback((id) => {
    openSessionRef.current(String(id))
  }, [])

  /* Fork a new branch session at one card's turn/end seq, record it in the
     doc and persist. The child is opened ONLY after the doc write completes,
     so the new branch is already part of the document when it is shown —
     loading its mind-map view can never miss the document and accidentally
     split off a new one. The injected forkAt no longer opens the child; this
     function opens it into the chat so the conversation continues from the
     clicked card. */
  const forkBranchAt = useCallback((ownerId, turn) => {
    if (forking || turn === undefined) return
    setForkError(null)
    setForking(true)
    const root = rootId
    const currentDoc = doc
    savingRef.current = true
    Promise.resolve(forkAtRef.current(String(ownerId), turn.seq))
      .then(async (childId) => {
        const branch = {
          id: `b${Date.now()}`,
          sessionId: String(childId),
          parentSessionId: String(ownerId),
          forkTurn: Number(turn.t),
          parentTurn: Number(turn.n),
          forkSeq: Number(turn.seq),
          turns: [],
        }
        const next = { ...currentDoc, branches: [...(currentDoc?.branches ?? []), branch], updatedAt: Date.now() }
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
        savingRef.current = false
        if (mountedRef.current) setForking(false)
      })
  }, [doc, forking, rootId, showNotice])

  /* Click a card: switch-first, fork-as-fallback. A card where some session
     (root or a branch) is parked — the card is that session's chain tail —
     opens that session (the right-side chat follows, the "当前" highlight
     moves here, the overlay stays); an empty branch card is the tail of a
     forked session waiting for its first question, so it follows the same
     path; any other (middle) card forks a NEW branch at this card, which
     joins the SAME document — never a new mind map — and its session stays
     hidden from the sidebar list. */
  const openCard = useCallback((node) => {
    if (node === undefined || forking || node.streaming === true) return
    /* An empty branch card is that session's chain tail too (it is parked
       waiting for a new question): follow the same switch-first path as any
       tail card — open the session and keep the map up, so the "当前" badge
       lights the clicked card instead of jumping into the chat. */
    if (node.empty) { openBranch(node.sessionId); return }
    const owner = node.sessionId
    const chain = String(owner) === String(doc?.rootSessionId)
      ? (doc?.trunk ?? [])
      : ((doc?.branches ?? []).find(b => String(b?.sessionId) === String(owner))?.turns ?? [])
    const last = chain[chain.length - 1]
    if (last !== undefined && last.seq === node.turn?.seq) {
      /* The owner session is parked at this card: switch to it (stay on the
         mind-map tab so branches are switched freely from the map). */
      openBranch(owner)
      return
    }
    /* Middle card (or a card of a session that moved on): fork a new branch. */
    forkBranchAt(owner, node.turn)
  }, [doc, forking, forkBranchAt, openBranch])

  /* Right-click a card: remember WHICH card (not just its session) so the
     menu can rename/archive a branch card or delete any card (the trunk cards
     get the delete-only menu). */
  const openCardMenu = useCallback((entry, x, y) => {
    setMenu({
      sessionId: String(entry.sessionId),
      turnSeq: entry.empty ? undefined : Number(entry.turn?.seq),
      turnN: entry.empty ? undefined : Number(entry.turn?.n),
      empty: entry.empty === true,
      isBranch: entry.branch !== undefined,
      x, y,
    })
  }, [])
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
      for (const branch of doc?.branches ?? []) ids.push(branch.sessionId)
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
    if (menu === null) return
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
      label: menu.empty ? translate('mindmap.pending') : translate('mindmap.turnTag', { n: menu.turnN ?? '' }),
      /* The current session is warned when it will be archived: a pruned
         subtree session, or the replaced session of a truncation. */
      willArchiveCurrent: plan !== null && plan.firstTrunk !== true && (
        (plan.archiveIds ?? []).includes(String(sessionId))
        || (plan.replaced !== null && String(plan.replaced.sessionId) === String(sessionId))),
    })
  }, [doc, menu, sessionId])
  const closeDelete = useCallback(() => {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteError(null)
  }, [deleteBusy])
  /* Escape closes the archive / delete dialogs (the rename dialog and the
     context menu already handle their own Escape). The overlay's own Escape
     handler defers while any .dsh-wel-dialog-backdrop is in the DOM, so
     without this the key would do nothing while one of these dialogs is open. */
  useEffect(() => {
    if (archiveTarget === null && deleteTarget === null) return undefined
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      closeArchive()
      closeDelete()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [archiveTarget, closeArchive, closeDelete, deleteTarget])
  const confirmDelete = useCallback(() => {
    if (deleteBusy || deleteTarget === null) return
    const root = rootId
    const currentDoc = doc
    if (root === null || currentDoc === null) return
    const plan = mindmapDeletePlan(currentDoc, deleteTarget.sessionId, deleteTarget.turnSeq, deleteTarget.empty)
    if (plan === null) { setDeleteError(translate('mindmap.delete.missing')); return }
    if (plan.firstTrunk === true) { setDeleteError(translate('mindmap.delete.lastTrunk')); return }
    setDeleteBusy(true)
    setDeleteError(null)
    savingRef.current = true
    let forkedChildId = null
    const next = { ...currentDoc }
    /* A trunk truncation makes the fork child the NEW root of the family: it
       must not get the branch " ›" suffix (forkAt renames branch children to
       it), so the child is told it is replacing the root. */
    const isRootReplacement = plan.replaced !== null && String(plan.replaced.sessionId) === String(root)
    Promise.resolve(
      plan.replaced === null
        ? null
        : forkAtRef.current(String(plan.replaced.sessionId), plan.replaced.forkAt, isRootReplacement))
      .then(async (childId) => {
        if (plan.replaced !== null) {
          /* A truncation fork succeeded: re-point the doc at the truncated
             session. The kept cards keep their display numbers (the fork
             child's seed carries the same turn/end seqs), and every surviving
             branch that hung off the replaced session re-anchors to it. */
          if (childId === null || childId === undefined) throw new Error(translate('mindmap.delete.missing'))
          forkedChildId = String(childId)
          const replacedId = String(plan.replaced.sessionId)
          next.trunk = plan.trunk
          next.branches = plan.branches
          if (isRootReplacement) {
            next.rootSessionId = forkedChildId
          } else {
            next.branches = (next.branches ?? []).map(b =>
              b !== null && b !== undefined && String(b?.sessionId) === replacedId
                ? { ...b, sessionId: forkedChildId }
                : b)
          }
          next.branches = (next.branches ?? []).map(b =>
            b !== null && b !== undefined && String(b?.parentSessionId) === replacedId
              ? { ...b, parentSessionId: forkedChildId }
              : b)
          /* No tombstones: a deletion is a pure fork + archive + replace. The
             truncated session's log simply lacks the removed turns, and the
             old session (plus every pruned subtree branch) is archived, so
             nothing is recorded about which turns were cut. A failed archive
             may legitimately resurrect the old session or leak a pruned
             branch into the sidebar later (ACCEPTED behavior — see
             docs/mindmap-notes.md). */
        } else {
          /* Whole-branch removal: prune the branch entry; the branch session
             (and its subtree) is archived. A failed archive may resurrect the
             branch placeholder later (ACCEPTED behavior). */
          next.trunk = plan.trunk
          next.branches = plan.branches
        }
        next.next = plan.next
        next.updatedAt = Date.now()
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        /* A root replacement retires the old root's doc file in the SAME
           request (the Host writes the new doc and leaves an alias stub at
           the old path), so no stale doc can split the family. */
        await saveDocRef.current(
          isRootReplacement ? forkedChildId : String(root),
          next,
          undefined,
          isRootReplacement ? String(root) : undefined)
        /* Archive the pruned subtree sessions AND the replaced session (the
           old root/branch, whose full log now lives only in the archive). */
        const archiveIds = [...plan.archiveIds]
        if (plan.replaced !== null) archiveIds.push(String(plan.replaced.sessionId))
        await Promise.all(archiveIds.map(id => archiveSessionRef.current(String(id)).catch(() => {})))
        if (!mountedRef.current) return
        if (isRootReplacement) setRootId(forkedChildId)
        /* Close the dialog before the notice and any session switch. */
        setDeleteTarget(null)
        mindmapRegistry.markDirty()
        /* Switch the chat (and the map highlight) to the truncated session,
           or back to the root when the current one was archived. */
        if (forkedChildId !== null) {
          openSessionRef.current(forkedChildId)
        } else if ((plan.archiveIds ?? []).includes(String(sessionId))) {
          openSessionRef.current(String(root))
        }
        showNotice(forkedChildId !== null ? translate('mindmap.truncated') : translate('mindmap.deleted'))
      })
      .catch((error) => {
        /* Roll the in-memory doc back; nothing was archived yet. A fork that
           already happened but whose doc write failed must not outlive the
           document: archive the freshly forked (empty) child. */
        if (mountedRef.current) {
          setDoc(currentDoc)
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
    return h('div', { className: 'dsh-wel-mindmap dsh-wel-mindmap-status' },
      h('div', { className: 'dsh-wel-mindmap-error' }, translate('mindmap.error', { message: phase.message ?? '' })))
  }
  if (phase.status === 'loading') {
    return h('div', { className: 'dsh-wel-mindmap dsh-wel-mindmap-status' },
      h('div', { className: 'dsh-wel-mindmap-loading' }, translate('mindmap.loading')))
  }
  if (phase.status === 'empty' || layout.nodes.length === 0) {
    return h('div', { className: 'dsh-wel-mindmap dsh-wel-mindmap-status' },
      h('div', { className: 'dsh-wel-mindmap-empty' }, translate('mindmap.empty')))
  }

  /* The map's header shows the mind map's OWN title (doc.rootTitle), which is
     independent of the root session's title after a sidebar rename; the
     session title is only the fallback for legacy docs without one. */
  const rootTitle = doc?.rootTitle
    || (rootId !== null && rootId !== undefined ? (list.titles[rootId] ?? '') : '')
    || ''
  const { edges: edgeEdges, streamingEntry, streamingParentKey, frame } = edgeView

  const nodeViews = layout.nodes.map((entry) => {
    const isStreaming = entry.streaming === true
    const isBranch = entry.branch !== undefined
    const title = isBranch
      ? (list.titles[entry.sessionId] ?? '')
      : translate('mindmap.turnTag', { n: (isStreaming ? entry.turnN : entry.turn?.n) ?? '' })
    return h(MindMapCard, {
      entry,
      title,
      isCurrent: entry.key === currentKey,
      isStreaming,
      isFrameParent: entry.key === streamingParentKey,
      isAncestor: trace.ancestorSet.has(entry.key),
      onOpen: openCard,
      onMenu: openCardMenu,
    })
  })

  const noticeView = notice === null ? null : h('div', {
    className: notice.error ? 'dsh-wel-mindmap-notice dsh-wel-mindmap-notice-error' : 'dsh-wel-mindmap-notice',
    role: notice.error ? 'alert' : 'status',
  }, notice.text)
  const menuView = menu !== null ? createPortal(
    h('div', {
      className: 'dsh-wel-context-menu',
      ref: menuRef,
      role: 'menu',
      style: {
        left: Math.max(4, Math.min(menu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)),
        top: Math.max(4, Math.min(menu.y, window.innerHeight - 92)),
      },
    },
      menu.isBranch ? h(Fragment, null,
        h('button', { className: 'dsh-wel-context-item', onClick: startRename, role: 'menuitem', title: translate('mindmap.menu.rename'), type: 'button' }, translate('mindmap.menu.rename')),
        h('div', { className: 'dsh-wel-context-separator', role: 'separator' })) : null,
      h('button', { className: 'dsh-wel-context-item dsh-wel-context-item-danger', onClick: startDelete, role: 'menuitem', title: translate('mindmap.menu.deleteCard'), type: 'button' }, translate('mindmap.menu.deleteCard'))),
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
    className: 'dsh-wel-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !archiveBusy) closeArchive() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-wel-dialog', role: 'dialog' },
      h('div', { className: 'dsh-wel-dialog-header' },
        h('div', { className: 'dsh-wel-dialog-title' }, translate('mindmap.menu.archiveAll')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-wel-icon-button', disabled: archiveBusy, onClick: closeArchive, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-wel-dialog-body' },
        h('div', { className: 'dsh-wel-dialog-message' },
          translate('mindmap.archiveAll.message', { name: archiveTarget.title })),
        archiveError !== null ? h('div', { className: 'dsh-wel-dialog-error', role: 'alert' }, archiveError) : null),
      h('div', { className: 'dsh-wel-dialog-footer' },
        h('button', { className: 'dsh-wel-text-button', disabled: archiveBusy, onClick: closeArchive, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-wel-text-button', disabled: archiveBusy, onClick: confirmArchive, type: 'button' }, archiveBusy ? translate('dialog.processing') : translate('mindmap.archive.action')))))
    : null
  const deleteView = deleteTarget !== null ? h('div', {
    className: 'dsh-wel-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !deleteBusy) closeDelete() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-wel-dialog', role: 'dialog' },
      h('div', { className: 'dsh-wel-dialog-header' },
        h('div', { className: 'dsh-wel-dialog-title' }, translate('mindmap.delete.title')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-wel-icon-button', disabled: deleteBusy, onClick: closeDelete, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-wel-dialog-body' },
        h('div', { className: 'dsh-wel-dialog-message' }, translate('mindmap.delete.message', { name: deleteTarget.label })),
        deleteTarget.willArchiveCurrent ? h('div', { className: 'dsh-wel-dialog-warning', role: 'alert' }, translate('mindmap.delete.current')) : null,
        deleteError !== null ? h('div', { className: 'dsh-wel-dialog-error', role: 'alert' }, deleteError) : null),
      h('div', { className: 'dsh-wel-dialog-footer' },
        h('button', { className: 'dsh-wel-text-button', disabled: deleteBusy, onClick: closeDelete, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-wel-text-button', disabled: deleteBusy, onClick: confirmDelete, type: 'button' }, deleteBusy ? translate('dialog.processing') : translate('mindmap.delete.action')))))
    : null

  return h(Fragment, null,
    h('div', { className: 'dsh-wel-mindmap', 'data-conversation-composer-overlay': '' },
      h('div', { className: 'dsh-wel-mindmap-toolbar' },
        h('button', {
          'aria-pressed': overlay.scope === 'sidebar' ? 'true' : 'false',
          className: 'dsh-wel-mindmap-toolbar-button dsh-wel-mindmap-scope-toggle',
          onClick: () => { mindmapOverlayStore.toggleScope() },
          title: translate('mindmap.scope.title'),
          type: 'button',
        }, translate(overlay.scope === 'sidebar' ? 'mindmap.scope.sidebar' : 'mindmap.scope.full')),
        h('button', { className: 'dsh-wel-mindmap-toolbar-button', onClick: restoreView, title: translate('mindmap.view.restoreTitle'), type: 'button' }, translate('mindmap.view.restore')),
        h('button', { className: 'dsh-wel-mindmap-toolbar-button', onClick: startArchiveAll, title: translate('mindmap.menu.archiveAll'), type: 'button' }, translate('mindmap.menu.archiveAll'))),
      h('div', { className: 'dsh-wel-mindmap-bar' },
        translate('mindmap.rootLabel'),
        h('span', { className: 'dsh-wel-mindmap-bar-title' }, rootTitle)),
      noticeView,
      forkError !== null ? h('div', { className: 'dsh-wel-mindmap-fork-error' }, translate('mindmap.forkFailed', { message: forkError })) : null,
      h('div', { className: 'dsh-wel-mindmap-viewport', 'data-dragging': dragging ? '' : undefined, onPointerCancel: endPan, onPointerDown: startPan, onPointerMove: movePan, onPointerUp: endPan, ref: viewportRef },
        h('div', { className: 'dsh-wel-mindmap-canvas', ref: canvasRef, style: { height: layout.height, width: layout.width } },
          h('svg', { className: 'dsh-wel-mindmap-edges', width: layout.width, height: layout.height },
            edgeEdges.map((edge, index) => h('path', {
              className: 'dsh-wel-mindmap-edge'
                + (trace.activeEdgeKeys.has(`${edge.from}\u0000${edge.to}`) ? ' dsh-wel-mindmap-edge-active' : ''),
              d: edge.d,
              key: index,
            }))),
          frame !== null
            ? h('div', { className: 'dsh-wel-mindmap-frame', style: { left: frame.left, top: frame.top, width: frame.width, height: frame.height } })
            : null,
          nodeViews))),
    menuView,
    renameView,
    archiveView,
    deleteView)
}

/* Hides mind-map family sessions (the root plus every fork descendant,
   documented or not) from the harness sidebar session list; each mind map is
   represented by its self-drawn sidebar entry instead. Rows are matched by
   title text inside the sidebar's workspace browser (role="treeitem"),
   re-applied on every DOM mutation AND on mind-map index changes so a freshly
   converted session is hidden as soon as its doc exists. A title hides a row
   ONLY when every session with that title is hidden (a visible non-mindmap
   session sharing the title keeps it visible). Archived sessions contribute no
   titles and the clearing pass always runs, so a wrongly hidden row
   self-heals on the next scan. */
function installMindmapBranchHider(getSessionList, getArchivedSessionIds) {
  if (typeof document === 'undefined') return () => {}
  let timer = 0
  let lastRun = 0
  const apply = () => {
    timer = 0
    lastRun = Date.now()
    /* Nothing to hide when no mind-map doc exists: skip the session walk and
       the DOM scan entirely (this observer fires on EVERY body mutation, so
       the guard keeps idle streaming from re-scanning the whole sidebar). */
    if (mindmapRegistry.getDocs().length === 0) return
    const list = getSessionList()
    const archived = new Set((getArchivedSessionIds?.() ?? []).map(String))
    const byTitle = new Map()
    for (const id of list.ids) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      if (summary.origin === 'subagent' || summary.blank) continue
      if (archived.has(String(id))) continue
      const title = summary.displayTitle
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
      let matched = false
      for (const span of row.querySelectorAll('span')) {
        if (span.childElementCount === 0 && hideTitles.has(span.textContent ?? '')) { matched = true; break }
      }
      row.classList.toggle('dsh-wel-mindmap-hidden-row', matched)
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
  }
}

/* Whether a session (or any of its fork ancestors, subagent hops aside)
   belongs to a mind-map family: it is a documented root/branch, or a fork
   descendant of one. */
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

/* The self-drawn mind-map session entries in the sidebar, replacing the hidden
   ordinary session rows. Rendered per workspace group (groupTitle set): each
   panel shows only the docs whose root session belongs to that group's
   workspace; with groupTitle undefined (flat/search list fallback) every doc
   is shown. Clicking an entry opens the root session and switches the
   conversation view ring to the mind-map tab; entries can be dragged to
   reorder (persisted per group in localStorage) and have a right-click menu
   (rename the root session / reveal its workspace in the OS explorer). */
const MINDMAP_ORDER_ALL_KEY = '__all__'
function MindmapSessionsPanel({ useSessions, useWorkspaces, groupTitle, openSession, revealSession }) {
  useMindmapRegistry()
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
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
    /* A doc without a resolvable workspace lives in the ungrouped bucket:
       the group whose title is not any real workspace's title. */
    if (docTitle !== undefined) return docTitle === groupTitle
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
     directly (Fragment) instead of a nested .dsh-wel-sidebar-mindmaps div. */
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
        setRenameBusy(false)
        setRenameTarget(null)
        mindmapRegistry.markDirty()
      })
      .catch((error) => { setRenameBusy(false); setRenameError(error instanceof Error ? error.message : String(error)) })
  }
  const onReveal = () => {
    if (contextMenu === null) return
    const id = contextMenu.sessionId
    setContextMenu(null)
    revealSession(id)
  }

  const menuView = contextMenu !== null ? createPortal(
    h('div', {
      className: 'dsh-wel-context-menu',
      ref: menuRef,
      role: 'menu',
      style: {
        left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)),
        top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 92)),
      },
    },
      h('button', { className: 'dsh-wel-context-item', onClick: startRename, role: 'menuitem', type: 'button' }, translate('context.renameSession')),
      h('div', { className: 'dsh-wel-context-separator', role: 'separator' }),
      h('button', { className: 'dsh-wel-context-item', onClick: onReveal, role: 'menuitem', type: 'button' }, translate('context.reveal'))),
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
      ? h('div', { className: 'dsh-wel-sidebar-mindmaps-empty' }, translate('mindmap.sidebar.empty'))
      : h('div', {
        className: 'dsh-wel-sidebar-mindmaps-list',
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
          return h('button', {
            className: 'dsh-wel-sidebar-mindmaps-item',
            'data-dragging': dragId === sid ? '' : undefined,
            'data-drop': dropTarget !== null && dropTarget.id === sid ? dropTarget.half : undefined,
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
            h('svg', { 'aria-hidden': true, className: 'dsh-wel-sidebar-mindmaps-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
            h('span', { className: 'dsh-wel-sidebar-mindmaps-label' }, label),
            count > 0 ? h('span', { className: 'dsh-wel-sidebar-mindmaps-count' }, translate('mindmap.sidebar.branches', { n: count })) : null)
        })),
    menuView,
    renameView)
}
/* The session-header 导图 button: opens the floating mind-map overlay for
   the current session (the chat column stays visible on the right) instead
   of switching the conversation panel to a full-page map. Clicking it again
   (or the overlay's close button / Escape) closes the window. On a NORMAL
   session (not yet a member of any mind map) the first click asks for
   confirmation before the session is converted into a mind-map session;
   only on "yes" does the conversion happen — otherwise nothing changes. */
function MindmapHeaderButton({ sessionId }) {
  const overlay = useMindmapOverlay()
  const [confirmTarget, setConfirmTarget] = useState(null)
  /* No current session (hero page / transient): nothing to map yet. */
  if (sessionId === undefined || sessionId === null) return null
  const key = String(sessionId)
  const active = overlay.open && String(overlay.sessionId) === key
  /* The background index may be a few seconds behind a fresh conversion, so
     the "is this already a mind map" check uses the last known registry
     membership (roots + documented branches). */
  const member = mindmapRegistry.isMember(key)
  const label = translate('view.mindmap')
  const onButtonClick = () => {
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
    mindmapOverlayStore.open(key)
  }
  /* Escape closes the confirm dialog. The overlay's own Escape handler defers
     while any .dsh-wel-dialog-backdrop is in the DOM, so without this window
     listener the key would do nothing while the dialog is open. */
  useEffect(() => {
    if (confirmTarget === null) return undefined
    const onKeyDown = event => { if (event.key === 'Escape') closeConfirm() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmTarget])
  /* The confirm dialog must escape the session-header slot: its container
     (.dsh-wel-chat) clips fixed-position descendants, so the modal would be
     cut to the chat column instead of covering the viewport. Portal it to
     body like every other floating overlay (context menus, etc.). */
  const confirmView = confirmTarget !== null ? createPortal(
    h('div', {
      className: 'dsh-wel-dialog-backdrop',
      onMouseDown: event => { if (event.target === event.currentTarget) closeConfirm() },
    },
      h('div', { 'aria-modal': true, className: 'dsh-wel-dialog dsh-wel-mindmap-confirm-dialog', role: 'dialog' },
        h('div', { className: 'dsh-wel-dialog-header' },
          h('div', { className: 'dsh-wel-dialog-title' }, translate('mindmap.confirm.title')),
          h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-wel-icon-button', onClick: closeConfirm, title: translate('dialog.close'), type: 'button' }, '×')),
        h('div', { className: 'dsh-wel-dialog-body' },
          h('div', { className: 'dsh-wel-dialog-message' }, translate('mindmap.confirm.message'))),
        h('div', { className: 'dsh-wel-dialog-footer' },
          h('button', { className: 'dsh-wel-text-button dsh-wel-mindmap-confirm-button dsh-wel-mindmap-confirm-cancel', onClick: closeConfirm, type: 'button' }, translate('dialog.cancel')),
          h('button', { className: 'dsh-wel-text-button dsh-wel-mindmap-confirm-button dsh-wel-mindmap-confirm-ok', onClick: confirmConvert, type: 'button' }, translate('mindmap.confirm.action'))))),
    document.body) : null
  return h(Fragment, null,
    h('button', {
      'aria-label': label,
      'aria-pressed': active,
      className: active ? 'dsh-wel-mindmap-header-button dsh-wel-mindmap-header-button-on' : 'dsh-wel-mindmap-header-button',
      onClick: onButtonClick,
      title: label,
      type: 'button',
    },
      h('svg', { 'aria-hidden': true, className: 'dsh-wel-mindmap-header-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
      h('span', { className: 'dsh-wel-mindmap-header-label' }, label)),
    confirmView)
}
/* The sidebar-footer mobile-mode toggle: a compact button that turns the
   whole layout into the centered phone column. Entering mobile opens the
   floating sidebar drawer (its default), so the browsing content stays
   reachable; leaving it clears the drawer and file-fullscreen sub-states. */
function MobileModeToggle(props) {
  const { on } = useMobile()
  const label = translate('mobile.toggle')
  return h('button', {
    'aria-label': label,
    'aria-pressed': on,
    className: 'dsh-wel-mobile-toggle',
    'data-open': on || undefined,
    'data-rail': !props.wide || undefined,
    onClick: () => { setMobile(!on) },
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-wel-mobile-toggle-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('rect', { x: 7, y: 2.5, width: 10, height: 19, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M11 18.5h2', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.6 })),
    props.wide ? h('span', { className: 'dsh-wel-mobile-toggle-label' }, label) : null,
  )
}
/* The whale button that opens/closes the floating sidebar drawer in mobile
   mode (the shared chrome for the session header and the hero overlay). */
function MobileWhaleButton({ open, onToggle }) {
  const label = open ? translate('mobile.sidebarClose') : translate('mobile.sidebarOpen')
  return h('button', {
    'aria-expanded': open,
    'aria-label': label,
    className: open ? 'dsh-wel-mobile-whale dsh-wel-mobile-active' : 'dsh-wel-mobile-whale',
    onClick: onToggle,
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, fill: 'none', height: 18 * 19.04 / 25.16, stroke: 'currentColor', strokeWidth: 1.4, viewBox: '-1 -1 25.16 19.04', width: 18 },
      h('path', { d: FISH })))
}
/* The file-content-browsing button shared by the session header and the hero
   overlay: toggles file-fullscreen mode (setMobileFiles) and shows its active
   state via dsh-wel-mobile-active. */
function MobileFilesButton() {
  const { files } = useMobile()
  return h('button', {
    'aria-label': translate('mobile.files'),
    'aria-pressed': files,
    className: files ? 'dsh-wel-mobile-files dsh-wel-mobile-active' : 'dsh-wel-mobile-files',
    onClick: () => setMobileFiles(!files),
    title: translate('mobile.files'),
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-wel-mobile-files-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.6 }),
      h('path', { d: 'M14 2v6h6', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.6 })))
}
/* The session-header mobile controls: the whale (floating-drawer toggle)
   followed by the file-content-browsing button, at the phone column's
   top-left. CSS hides them outside mobile mode. The drawer's outside-click
   scrim is drawn by AppFrame (sibling of the drawer), not here, so it always
   stacks between the page and the drawer. */
function MobileHeaderControls() {
  const { drawerOpen } = useMobile()
  return h('div', { className: 'dsh-wel-mobile-controls' },
    h(MobileWhaleButton, { onToggle: () => setDrawerOpen(!drawerOpen), open: drawerOpen }),
    h(MobileFilesButton))
}
/* The hero-page whale + file button: rendered in the shell.overlay seat for
   the blank-session hero, where there is no session header. The controls only
   show under the mobile gate + hero page (CSS :has gate, mirroring
   mobile-preview). */
function MobileHeroControls() {
  const { drawerOpen } = useMobile()
  return h('div', { className: 'dsh-wel-mobile-hero' },
    h(MobileWhaleButton, { onToggle: () => setDrawerOpen(!drawerOpen), open: drawerOpen }),
    h(MobileFilesButton))
}
/* The floating mind-map window: rendered by AppFrame while the overlay is
   open. It spans everything left of the chat column (width = 100% − chat
   width, tracked live so resizing the chat column reflows the window); on
   mobile it takes the whole screen. The chat stays visible on the right, and
   card clicks inside the map switch the right-side conversation to the
   clicked session. */
function MindmapOverlayHost({ sessionId, useSessions, actions, chatWidth, mobile, sidebarWidth }) {
  const overlay = useMindmapOverlay()
  const closeLabel = translate('mindmap.overlay.close')
  /* Scope 'full' (default) spans everything left of the chat column; scope
     'sidebar' narrows the window to just the sidebar column (the file browser
     area is left visible). On mobile the window is always full screen. */
  const width = mobile
    ? '100%'
    : overlay.scope === 'sidebar'
      ? `${Math.max(0, sidebarWidth)}px`
      : `calc(100% - ${Math.max(0, chatWidth)}px)`
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      /* Let an open dialog/context menu inside the map handle Escape first. */
      if (document.querySelector('.dsh-wel-dialog-backdrop, .dsh-wel-context-menu') !== null) return
      mindmapOverlayStore.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return h('div', { className: 'dsh-wel-mindmap-overlay', style: { width } },
    h('button', {
      'aria-label': closeLabel,
      className: 'dsh-wel-mindmap-overlay-close',
      onClick: () => { mindmapOverlayStore.close() },
      title: closeLabel,
      type: 'button',
    }, '×'),
    h(MindMapView, {
      archiveSession: actions.archiveSession,
      deleteDoc: actions.deleteDoc,
      forkAt: actions.forkAt,
      loadDoc: actions.loadDoc,
      openSession: id => { actions.openSession(String(id)); mindmapOverlayStore.setSession(String(id)) },
      renameSession: actions.renameSession,
      saveDoc: actions.saveDoc,
      sessionId: String(sessionId),
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
  // Mirror the runtime sidebar width into the persisted explorer pane store:
  // the layout store owns the live value but cannot persist wholesale (it also
  // carries large file drafts), so the pane store's small layout value is the
  // durable copy, rehydrated into the layout store's init on the next load.
  const sidebarMirrorRef = useRef(null)
  useLayoutEffect(() => {
    if (sidebarMirrorRef.current !== panels.sidebar) {
      sidebarMirrorRef.current = panels.sidebar
      props.explorerPaneStore.actions.setSidebar(panels.sidebar)
    }
  }, [panels.sidebar, props.explorerPaneStore])
  // In mobile file-fullscreen the conversation header stays pinned above the
  // file browsing page; its live height feeds --dsh-wel-mobile-header-h so the
  // preview fills the phone column below it.
  const [mobileHeaderHeight, setMobileHeaderHeight] = useState(MOBILE_HEADER_FALLBACK_H)
  useLayoutEffect(() => {
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
  }, [mobile.files, mobile.on])
  const chatFontScale = clamp(settings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX) / CHAT_FONT_SIZE_DEFAULT
  // One accent custom property per color group; unset groups resolve to their
  // default inside the CSS rule's var() fallback (the value here is the
  // effective color either way, so the fallback is only a safety net).
  const fileColorVars = {}
  for (const { group } of FILE_COLOR_GROUPS) fileColorVars[`--dsh-wel-file-${group}`] = fileColorOf(settings, group)
  const currentSession = props.useSessions(state => state.current)
  const sessionIds = props.useSessions(state => state.ids)
  // The session rename dialog targets the current session id.
  const sessionId = currentSession
  // The workspace-files panel header names the current session (its durable
  // title) instead of a fixed label, so the browsing panel reads as belonging
  // to the session being worked on; fall back when no session is selected.
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
  useEffect(() => () => { mountedRef.current = false }, [])
  const [resizing, setResizing] = useState(false)
  const [chatDropActive, setChatDropActive] = useState(false)
  // Migration: entries persisted before clean-tab drafts were slimmed carry
  // full file text on every tab; re-serializing them on every write keeps the
  // whole value over the localStorage quota. Re-write them once through the
  // slimming path (dirty drafts are preserved, clean text dropped). Idempotent:
  // after migration no entry has fat clean tabs, so the guard skips.
  useEffect(() => {
    const sessions = previewPanels?.previewSessions
    if (sessions === undefined || typeof sessions !== 'object') return
    const hasFat = Object.values(sessions).some(value =>
      (value?.tabs ?? []).some(tab => tab?.dirty === false && typeof tab?.draft === 'string' && tab.draft !== ''))
    if (!hasFat) return
    for (const key of Object.keys(sessions)) {
      const value = sessions[key]
      if (value === undefined) continue
      const fat = (value?.tabs ?? []).some(tab => tab?.dirty === false && typeof tab?.draft === 'string' && tab.draft !== '')
      if (!fat) continue
      props.previewSessionsStore.actions.rememberPreviewSession(key, serializePreviewSession(value.activePath, value.tabs, value.expanded ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  const persistWorkspaceDraft = useCallback((value) => {
    if (workspaceId !== undefined) props.actions.rememberDraft(String(workspaceId), value)
  }, [props.actions, workspaceId])
  const clearWorkspaceDraft = useCallback(() => {
    if (workspaceId !== undefined) props.actions.clearDraft(String(workspaceId))
  }, [props.actions, workspaceId])
  const previewSessionSelection = selectStoredPreviewSession(previewPanels.previewSessions, workspace, currentSession, workspaceId)
  const previewSessionKey = previewSessionSelection.key
  const storedPreviewSession = previewSessionSelection.value
  // Skip a redundant 3-key rewrite when this exact key-set already holds the
  // same snapshot: each write serializes and stores the whole previewSessions
  // value, so repeated identical writes (e.g. a persisted layout effect firing
  // with unchanged state) are pure cost. Keyed per key-set, because switching
  // sessions legitimately writes the same snapshot to a different key-set.
  const lastPersistedSnapshotRef = useRef(new Map())
  const persistPreviewSession = useCallback((value) => {
    // Write the latest snapshot to every key the restore may pick: the current
    // session key (highest restore priority), the selected key (which falls
    // back to the workspace key when the session has no own snapshot yet), and
    // the workspace anchor. Writing only the selected key left the session key
    // stale once the workspace fallback took over, and the restore then
    // preferred that stale session snapshot ("tabs reverted to old state").
    const keys = new Set()
    if (previewSessionKey !== undefined) keys.add(previewSessionKey)
    if (currentSession !== undefined) keys.add(String(currentSession))
    if (workspaceId !== undefined) keys.add(String(workspaceId))
    if (keys.size === 0) return
    const keySet = [...keys].sort().join('|')
    const fingerprint = previewSnapshotFingerprint(value)
    if (lastPersistedSnapshotRef.current.get(keySet) === fingerprint) return
    lastPersistedSnapshotRef.current.set(keySet, fingerprint)
    if (lastPersistedSnapshotRef.current.size > 128) lastPersistedSnapshotRef.current.clear()
    for (const key of keys) props.previewSessionsStore.actions.rememberPreviewSession(key, value)
  }, [currentSession, previewSessionKey, props.previewSessionsStore, workspaceId])
  const last = useRef(currentSession)
  const viewportRef = useRef(null)
  const chatSectionRef = useRef(null)
  const chatDropSuppressed = useRef(false)
  const [viewportWidth, setViewportWidth] = useState(0)
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
  // Chat drop mask: track file drags over the chat pane (capture phase, but
  // without stopping propagation so the harness composer still receives the
  // drop and attaches images per its original behavior). The mask is drawn by
  // this layout and covers only the chat pane; the harness's full-viewport
  // mask is hidden by CSS. Enter/leave use a depth counter (dragleave's
  // relatedTarget is null in Chrome, so a contains() check would hide the mask
  // on the first child transition). Closing the mask suppresses it for the
  // current drag until the drag ends or is dropped.
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
  // Think disclosure auto behavior: a reasoning block streaming in the chat
  // (data-variant="think", data-state="running") is opened once, and an
  // auto-opened block collapses again shortly after it finishes
  // (data-state="ok"). The harness renders the expanded body only while the
  // row is open and its state is internal to the component, so the row is
  // toggled by clicking the disclosure row (expandOnRowClick). Manual
  // interaction wins: a row the user collapses during streaming is not
  // re-opened, a user click or key press on the block cancels a pending
  // auto-collapse, and rows the user opened by hand are never collapsed by
  // this behavior.
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
    // Catch a block already streaming when the observer attached.
    for (const root of section.querySelectorAll('[data-variant="think"][data-state="running"]')) openRow(root)
    return () => {
      observer.disconnect()
      section.removeEventListener('click', onSectionClick, true)
      section.removeEventListener('keydown', onSectionKeyDown, true)
      for (const timer of pendingCollapses.values()) clearTimeout(timer)
      pendingCollapses.clear()
    }
  }, [chatSectionRef, settings.autoExpandThink, settings.thinkCollapseDelay])
  const asideRef = useRef(null)
  // The sidebar shell (harness ui-sidebar SidebarRoot) owns the New Session
  // button and the browsing region, and its slots cannot be redeclared by this
  // plugin. Instead two DOM containers are maintained inside the shell — the
  // top actions row (replacing the hidden New Session button) and the files
  // region seat — and this plugin renders its own React content into them via
  // portals. The observer re-asserts the containers on structural rebuilds;
  // in-place React updates leave foreign nodes alone, so nothing flickers.
  const [sidebarChrome, setSidebarChrome] = useState(null)
  useLayoutEffect(() => {
    const aside = asideRef.current
    if (aside === null) return undefined
    const ensure = () => {
      const rootDiv = aside.querySelector('[data-slot="sidebar"] > div')
      if (rootDiv === null) return null
      let top = rootDiv.querySelector(':scope > .dsh-wel-sidebar-top-actions')
      if (top === null) {
        top = document.createElement('div')
        top.className = 'dsh-wel-sidebar-top-actions'
        rootDiv.insertBefore(top, rootDiv.querySelector(':scope > button'))
      }
      const workspacesOutlet = rootDiv.querySelector(':scope [data-slot="sidebar.workspaces"]')
      let files = null
      let fallback = null
      const groups = []
      if (workspacesOutlet !== null) {
        const regionArea = workspacesOutlet.parentElement
        if (regionArea !== null) {
          files = regionArea.querySelector(':scope > .dsh-wel-sidebar-files')
          if (files === null) {
            files = document.createElement('div')
            files.className = 'dsh-wel-sidebar-files'
            regionArea.append(files)
          }
          /* Mind-map seats: one container appended to EACH workspace group
             section (after its session rows), so the entries live inside the
             session list of the workspace they belong to. Group sections are
             recognised by their header row (`role="treeitem"` with
             `aria-expanded`); the header title names the workspace. Flat /
             search list modes have no sections — a single region-area seat at
             the bottom of the workspace region covers them. */
          for (const header of workspacesOutlet.querySelectorAll('[role="treeitem"][aria-expanded]')) {
            const section = header.parentElement
            if (section === null) continue
            let container = section.querySelector(':scope > .dsh-wel-sidebar-mindmaps')
            if (container === null) {
              container = document.createElement('div')
              container.className = 'dsh-wel-sidebar-mindmaps'
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
            fallback = regionArea.querySelector(':scope > .dsh-wel-sidebar-mindmaps-fallback')
            if (fallback === null) {
              fallback = document.createElement('div')
              fallback.className = 'dsh-wel-sidebar-mindmaps dsh-wel-sidebar-mindmaps-fallback'
              regionArea.append(fallback)
            }
          } else {
            /* Grouped mode: drop any stale region-area seat from a previous
               flat / search pass. */
            regionArea.querySelector(':scope > .dsh-wel-sidebar-mindmaps-fallback')?.remove()
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
      aside.querySelectorAll('.dsh-wel-sidebar-top-actions, .dsh-wel-sidebar-files, .dsh-wel-sidebar-mindmaps').forEach(node => node.remove())
    }
  }, [])
  const collapsed = panels.sidebar === 0
  // Mobile mode expands the sidebar so the floating drawer shows the full
  // browsing content (the rail has no drawer affordance); the previous
  // collapsed state is restored when mobile turns off (mirroring mobile-
  // preview's forceExpanded behavior). Declared after `collapsed` so the
  // dependency array reads an initialized binding (TDZ-safe).
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
  const sidebarMax = viewportWidth > 0
    ? Math.max(SIDEBAR_MIN, Math.floor(viewportWidth * SIDEBAR_MAX_RATIO))
    : SIDEBAR_MAX_FALLBACK
  const sidebar = collapsed ? SIDEBAR_COLLAPSED : clamp(panels.sidebar, SIDEBAR_MIN, sidebarMax)
  // Measure the viewport, not the grid frame: the conversation column can now shrink without a fixed floor.
  const leftStackMax = viewportWidth > 0
    ? Math.max(sidebar + TREE_MIN + PREVIEW_MIN, Math.floor(viewportWidth * EXPLORER_MAX_RATIO))
    : SIDEBAR_MAX_FALLBACK + TREE_MAX + PREVIEW_MAX
  const explorerMax = Math.max(TREE_MIN + PREVIEW_MIN, leftStackMax - sidebar)
  // The workspace file tree lives exclusively in the sidebar files region and
  // is revealed there only in the files view; the main frame's tree track
  // stays at zero, so opening the explorer shows only the file preview next to
  // the chat. The tree always portals into the sidebar seat (hidden while in
  // the sessions view) and the preview is never displaced by it.
  const tree = 0
  const previewMax = Math.max(PREVIEW_MIN, explorerMax - tree)
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
  return h('div',{ref:viewportRef,className:'dsh-wel-viewport'},h('main',{className:'dsh-wel-frame','data-explorer-closed':!panes.explorerOpen&&!filesActive||undefined,'data-sidebar-collapsed':collapsed||undefined,'data-sidebar-files':filesActive||undefined,'data-resizing':resizing||undefined,style:{'--dsh-wel-preview':`${preview}px`,'--dsh-wel-sidebar':`${sidebar}px`,'--dsh-wel-row-height':`${clamp(settings.rowHeight ?? ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)}px`,'--dsh-wel-chat-font-scale':String(chatFontScale),'--dsh-wel-mobile-header-h':`${mobileHeaderHeight}px`,...fileColorVars}},h('aside',{className:'dsh-wel-sidebar',ref:asideRef},props.renderSlot('sidebar',{collapsed,width:sidebar}),sidebarChrome?.top?createPortal(h(SidebarTopActions,{collapsed,view,width:sidebar,onSelectSessions:()=>{props.actions.setView('sessions')},onSelectFiles:()=>{if(collapsed)props.toggleSidebar();props.actions.setView('files')}}),sidebarChrome.top):null,sidebarChrome&&(sidebarChrome.groups.length>0?sidebarChrome.groups.map(group=>createPortal(h(MindmapSessionsPanel,{useSessions:props.useSessions,useWorkspaces:props.useWorkspaces,groupTitle:group.title,openSession:openMindmapSession,revealSession:revealSessionById}),group.container)):sidebarChrome.fallback?createPortal(h(MindmapSessionsPanel,{useSessions:props.useSessions,useWorkspaces:props.useWorkspaces,groupTitle:undefined,openSession:openMindmapSession,revealSession:revealSessionById}),sidebarChrome.fallback):null)),workspace?h(WorkspaceExplorer,{key:`${workspace.workspaceId}:${sessionId ?? 'workspace'}`,clearDraft:clearWorkspaceDraft,createEntry:props.createEntry,listDirectory:props.listDirectory,persistDraft:persistWorkspaceDraft,persistPreviewSession,publishEditorContext,readFile:props.readFile,renameEntry:props.renameEntry,saveFile:props.saveFile,loadDraft:props.loadDraft,persistDraftFile:props.persistDraftFile,removeDraftFile:props.removeDraftFile,draftTree:props.draftTree,settingsStore:props.settingsStore,storedDraft:panels.drafts[String(workspace.workspaceId)],storedPreviewSession,sessionTitle,sessionId,renameSession:props.renameSession,treePortalTarget,workspace}):h(EmptyWorkspaceExplorer,{sessionTitle,treePortalTarget}),h('section',{className:'dsh-wel-chat',ref:chatSectionRef},props.renderSlot('conversation',{}),chatDropActive?h('div',{className:'dsh-wel-chat-drop-mask',role:'presentation'},h('button',{'aria-label':translate('drop.closeAria'),className:'dsh-wel-chat-drop-close',onClick:()=>{chatDropSuppressed.current=true;setChatDropActive(false)},title:translate('drop.closeTitle'),type:'button'},'×'),h('div',{className:'dsh-wel-chat-drop-card'},translate('drop.releaseImages'))):null),!collapsed?h(ResizeHandle,{label:translate('resize.sidebar'),left:sidebar,max:sidebarMax,min:SIDEBAR_MIN,onDragging:setResizing,onResize:width=>props.actions.setSidebar(width,sidebarMax),value:sidebar}):null,(panes.explorerOpen||filesActive)?h(ResizeHandle,{label:translate('resize.preview'),left:previewBoundary,max:previewMax,min:PREVIEW_MIN,onDragging:setResizing,onResize:width=>props.explorerPaneStore.actions.setPreview(width,previewMax),value:preview}):null,h('aside',{className:'dsh-wel-details','data-closed':!panels.detailsOpen||!detailsCapable||undefined},props.renderSlot('details',{})),mobile.on&&mobile.drawerOpen?h('div',{className:'dsh-wel-mobile-scrim',onClick:()=>setDrawerOpen(false)}):null,h('div',{className:'dsh-wel-overlay','data-shell-overlay':true},props.renderSlot('shell.overlay',{})),sessionContextMenu?h('div',{className:'dsh-wel-context-menu',ref:sessionMenuRef,role:'menu',style:{left:Math.max(4,Math.min(sessionContextMenu.x,window.innerWidth-CONTEXT_MENU_WIDTH-4)),top:Math.max(4,Math.min(sessionContextMenu.y,window.innerHeight-52))}},h('button',{className:'dsh-wel-context-item',onClick:beginSessionInlineRename,role:'menuitem',type:'button'},translate('context.renameSession')),h('button',{className:'dsh-wel-context-item',onClick:archiveSessionFromMenu,role:'menuitem',type:'button'},translate('context.archiveSession')),h('div',{className:'dsh-wel-context-separator',role:'separator'}),h('button',{className:'dsh-wel-context-item',onClick:revealSessionFromMenu,role:'menuitem',type:'button'},translate('context.reveal'))):null,sessionInlineRename?h(SessionInlineRename,{busy:sessionInlineRenameBusy,error:sessionInlineRenameError,onCancel:cancelSessionInlineRename,onConfirm:confirmSessionInlineRename,row:sessionInlineRename.row,title:sessionInlineRename.title}):null,sessionNotice?h('div',{className:'dsh-wel-copy-notice','data-error':sessionNotice.error||undefined,role:'status'},sessionNotice.text):null),overlay.open?h(MindmapOverlayHost,{actions:props.mindmapActions,chatWidth,mobile:mobile.on,sessionId:overlay.sessionId,sidebarWidth:sidebar,useSessions:props.useSessions}):null)}

export const inject = ['slots', 'theme', 'sessions', 'workspaces']
export function apply(ctx) {
  const layout = new LayoutController()
  const layoutStore = createLayoutStore()
  const previewSessionsStore = createPreviewSessionStore().create()
  const settingsStore = createExplorerSettingsStore().create()
  const explorerPaneStore = createExplorerPaneStore().create()
  // The explorer footer toggle was removed; keep the panes always on-screen.
  // Persisted `explorerOpen:false` from the removed toggle (users who had
  // closed it) self-heals here, since nothing else can reopen it anymore.
  explorerPaneStore.actions.setExplorerOpen(true)
  const editorContexts = new EditorContextController()
  /* Follow the harness language setting (Settings -> General -> Language) when
     the locale plugin is present: register this plugin's dictionaries, bind
     the active-locale translator, and expose the locale face to useLocaleText.
     Without the service everything stays on the zh dictionary (historical
     behavior). */
  const locale = ctx.get('locale')
  if (locale !== undefined) {
    ctx.effect(() => {
      const disposeDicts = locale.register(EXPLORER_LOCALE_NS, { zh, en })
      translate = locale.bind(EXPLORER_LOCALE_NS)
      localeFace = locale
      return () => {
        disposeDicts()
        localeFace = undefined
        translate = zhFallbackTranslate
      }
    }, 'workspace-explorer-layout: locale dictionaries')
  }
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    for (const stale of document.querySelectorAll(`style[data-plugin-css="${PACKAGE_ID}/layout"]`)) stale.remove()
    const tag = document.createElement('style')
    tag.dataset.plugin = PACKAGE_ID
    tag.dataset.pluginCss = `${PACKAGE_ID}/layout`
    tag.textContent = styles
    document.head.append(tag)
    return () => tag.remove()
  }, 'workspace-explorer-layout: styles')
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    // Mobile mode is intentionally transient and the document classes are
    // plugin-owned global state. Clear stale classes both on activation and on
    // disposal so hot reload/uninstall cannot leak layout gates to the shell.
    setMobile(false)
    return () => { setMobile(false) }
  }, 'workspace-explorer-layout: mobile class lifecycle')
  ctx.effect(() => installEditorContextMessageCompactor(), 'workspace-explorer-layout: compact logged editor context')
  const listDirectory = (workspaceId, path, signal) => requestJson('tree', String(workspaceId), path, signal)
  const readFile = (workspaceId, path, signal, encoding) => requestJson('file', String(workspaceId), path, signal, encoding)
  const saveFile = (workspaceId, path, content, revision, signal, encoding) => putFile(workspaceId, path, content, revision, signal, encoding)
  const loadDraft = (workspaceId, path, signal, owner) => readDraft(String(workspaceId), path, signal, owner)
  const persistDraftFile = (workspaceId, path, payload, signal) => writeDraft(String(workspaceId), path, payload, signal)
  const removeDraftFile = (workspaceId, path, signal, owner, generation) => deleteDraft(String(workspaceId), path, signal, owner, generation)
  const draftTree = (workspaceId, payload, signal) => requestDraftTree(String(workspaceId), payload, signal)

  /* The mind-map action face shared by the floating overlay (it used to be
     the conversation.view inject): document IO, fork, rename and archive.
     forkAt does NOT open the child — the view opens it only after the doc
     write completes, so the branch is already part of the document when it
     becomes visible (no split). No increaseTitle: the host generates a title
     from the fork boundary; the child is renamed to the family-root title
     plus " ›" so its header stays clean and never collides with the root (a
     root-replacement fork — card-deletion truncation of the trunk — keeps
     the plain family title instead, asRoot). */
  const buildMindmapActions = (ctx) => ({
    archiveSession: async id => { await ctx.workspaces.archiveSession(String(id)) },
    deleteDoc: (id, signal) => deleteMindmapDoc(String(id), signal),
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
    syncDoc: (id, liveSessionId, signal) => syncMindmapDoc(String(id), liveSessionId, signal),
  })

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
          // Right-click session-list actions: archive through the harness
          // workspaces service and imperatively read the sessions/workspaces
          // snapshots (the AppFrame context-menu listener must not subscribe
          // through hooks to decide whether to open the menu).
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
  }, 'workspace-explorer-layout: service and root registration')
  const promptContextBridge = new PromptContextBridge(ctx, editorContexts)
  ctx.inject(['conversation'], scope => {
    scope.effect(
      () => promptContextBridge.install(),
      'workspace-explorer-layout: prompt context bridge',
    )
  })
  /* The /init slash command: a popupSelect contribution that resolves the
     session's workspace, shows the target root, and hands the model a Claude
     Code /init-style instruction through the session's own send seam. Only
     direct sessions can run it. Registered when the ui-commands service is
     present; without it the command simply does not exist. */
  ctx.inject(['commandUi'], scope => {
    scope.effect(() => {
      const commandUi = scope.get('commandUi')
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
    }, 'workspace-explorer-layout: init command')
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
  ctx.effect(() => () => { editorContexts.dispose() }, 'workspace-explorer-layout: editor context state')
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
  // the current crumb; the trigger renders here at -400, leftmost). Switching
  // reuses ctx.sessions.open — the same call the sidebar session list uses —
  // so the whole layout (workspace, preview, chat) follows the new current.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'workspace-session-switcher', order: -400,
    inject: () => ({ openSession: sessionId => { ctx.sessions.open(sessionId) } }),
  }, SessionSwitcherDropdown))
  /* The session-header 导图 button: opens the floating mind-map overlay for
     the current session (the chat column stays visible on the right). The
     old full-page mind-map conversation view was removed — persisted mindmap
     view selections fall back to the chat view automatically (the harness
     treats unknown view ids as the stable Chat view). */
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'workspace-mindmap-toggle', order: -350,
  }, MindmapHeaderButton))
  /* Mind-map family sessions (roots + every fork descendant) are hidden from
     the harness sidebar session list; each mind map is represented by its
     self-drawn sidebar entry instead. */
  ctx.effect(() => installMindmapBranchHider(
    () => ctx.sessions.list.getSnapshot(),
    () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
  ), 'workspace-explorer-layout: mind-map branch hider')
  /* Background mind-map doc index (feeds the sidebar entries and the hider). */
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    mindmapRegistry.start()
    return () => mindmapRegistry.stop()
  }, 'workspace-explorer-layout: mind-map index registry')
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
  }, 'workspace-explorer-layout: theme presenter')
}