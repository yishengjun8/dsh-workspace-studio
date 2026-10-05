import { translate } from './locale/index.js'
import { languageFor } from './languages.js'

/* Localized label of one file-color group; language-neutral names fall back to the constant label. */
export function fileColorGroupLabel(group) {
  const localized = translate(`fileColor.${group}`)
  if (localized !== `fileColor.${group}`) return localized
  return FILE_COLOR_GROUPS.find(item => item.group === group)?.label ?? group
}
/* Localized label of one highlight preset; language-neutral names fall back to the constant label. */
export function highlightPresetLabel(id) {
  const localized = translate(`preset.${id}`)
  if (localized !== `preset.${id}`) return localized
  return HIGHLIGHT_PRESETS.find(item => item.id === id)?.label ?? id
}


/* File-tree badge color groups: each owns one accent color for the leading type badge, user-recolorable in settings. */
export const FILE_COLOR_GROUPS = Object.freeze([
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
export function fileColorDefault(group) {
  return FILE_COLOR_DEFAULTS[group] ?? DEFAULT_FILE_COLOR
}
/** Resolve one group's effective color: the user's customization, else the default. */
export function fileColorOf(settings, group) {
  return settings?.fileColors?.[group] ?? fileColorDefault(group)
}

/* VCS status-badge accents, one per TONE (several status letters share a tone: renamed/copied,
   added/untracked). Defaults mirror the app's state palette, so an untouched install matches the
   theme; the user can recolor each tone in settings like the file-type badges. */
export const VCS_STATUS_GROUPS = Object.freeze([
  { group: 'modified', label: '已修改', color: '#b7791f' },
  { group: 'added', label: '已新增', color: '#1a7f37' },
  { group: 'untracked', label: '未跟踪', color: '#1a7f37' },
  { group: 'deleted', label: '已删除', color: '#d92f24' },
  { group: 'renamed', label: '已重命名', color: '#1a63d8' },
  { group: 'conflict', label: '冲突', color: '#d92f24' },
  { group: 'ignored', label: '已忽略', color: '#8a9099' },
])
const DEFAULT_VCS_STATUS_COLOR = '#8a9099'
const VCS_STATUS_DEFAULTS = Object.fromEntries(VCS_STATUS_GROUPS.map(({ group, color }) => [group, color]))
/** Localized label of one VCS tone; falls back to the constant label. */
export function vcsStatusGroupLabel(group) {
  const localized = translate(`vcsColor.${group}`)
  if (localized !== `vcsColor.${group}`) return localized
  return VCS_STATUS_GROUPS.find(item => item.group === group)?.label ?? group
}
/** The accent a VCS tone falls back to when the user has not set one. */
export function vcsStatusColorDefault(group) {
  return VCS_STATUS_DEFAULTS[group] ?? DEFAULT_VCS_STATUS_COLOR
}
/** Resolve one VCS tone's effective color: the user's customization, else the default. */
export function vcsStatusColorOf(settings, group) {
  return settings?.vcsColors?.[group] ?? vcsStatusColorDefault(group)
}
/** CSS custom properties for every VCS tone, spread onto the tree panel so its badges inherit them. */
export function vcsStatusColorVars(settings) {
  const vars = {}
  for (const { group } of VCS_STATUS_GROUPS) vars[`--dsh-ws-vcs-${group}`] = vcsStatusColorOf(settings, group)
  return vars
}

/* Editor change-gutter tones. Deliberately their own palette (not the tree's badge tones): the
   gutter follows the code-editor convention — green added, BLUE modified, red deleted — while the
   tree keeps its amber "modified" badge. User-recolorable in Workspace Settings → Version Control. */
export const DIFF_TONE_GROUPS = Object.freeze([
  { group: 'added', label: '新增', color: '#1a7f37' },
  { group: 'modified', label: '修改', color: '#1a63d8' },
  { group: 'deleted', label: '删除', color: '#d92f24' },
])
const DEFAULT_DIFF_COLOR = '#8a9099'
const DIFF_TONE_DEFAULTS = Object.fromEntries(DIFF_TONE_GROUPS.map(({ group, color }) => [group, color]))
/** Localized label of one gutter tone; falls back to the constant label. */
export function diffGroupLabel(group) {
  const localized = translate(`diffTone.${group}`)
  if (localized !== `diffTone.${group}`) return localized
  return DIFF_TONE_GROUPS.find(item => item.group === group)?.label ?? group
}
/** The color a gutter tone falls back to when the user has not set one. */
export function diffColorDefault(group) {
  return DIFF_TONE_DEFAULTS[group] ?? DEFAULT_DIFF_COLOR
}
/** Resolve one gutter tone's effective color: the user's customization, else the default. */
export function diffColorOf(settings, group) {
  return settings?.diffColors?.[group] ?? diffColorDefault(group)
}
/** CSS custom properties for the gutter tones, spread onto the editor host so its marks inherit them. */
export function diffColorVars(settings) {
  const vars = {}
  for (const { group } of DIFF_TONE_GROUPS) vars[`--dsh-ws-diff-${group}`] = diffColorOf(settings, group)
  return vars
}

/* Extension -> color group; mirrors EXTENSION_LANGUAGES so badge and editor highlighting agree. */
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
export function colorGroupOf(entry) {
  if (entry.kind === 'directory') return 'directory'
  if (entry.kind === 'blocked' || entry.kind === 'other') return 'blocked'
  const lower = String(entry.name).toLowerCase()
  const exact = FILE_GROUP_BY_EXACT_NAME[lower]
  if (exact !== undefined) return exact
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return FILE_GROUP_BY_EXTENSION[extension] ?? DEFAULT_FILE_GROUP
}

/* Editor syntax-highlight presets: each non-default preset overrides the --shiki-token-* variables on the editor host; 'default' leaves the app theme's palette untouched. */
export const HIGHLIGHT_PRESETS = Object.freeze([
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
export const HIGHLIGHT_PRESET_DEFAULT = 'default'
/* Per-group default highlight presets; a group with no entry here follows the app theme's palette ('default'). */
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
export function highlightPresetDefaultFor(group) {
  return HIGHLIGHT_PRESET_DEFAULT_BY_GROUP[group] ?? HIGHLIGHT_PRESET_DEFAULT
}
/** The preset one file-type group resolves to: the user's pick, else the group's default. */
export function highlightPresetOf(settings, group) {
  return settings?.highlightPresets?.[group] ?? highlightPresetDefaultFor(group)
}

export function lineSeparator(value) {
  if (value === 'crlf' || value === '\r\n') return '\r\n'
  if (value === 'cr' || value === '\r') return '\r'
  return '\n'
}

/* Read-only reason codes the preview may carry, mapped to dictionary keys (including server alias spellings). */
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
  /* A file outside the workspace renders read-only through the harness Remote:
     the plugin's own editable API is workspace-confined by design. */
  'outside-workspace': 'readonly.outside-workspace',
})

export function readOnlyReason(preview) {
  if (preview.truncated) return translate('readonly.truncated')
  if (preview.lineEnding === 'mixed') return translate('readonly.mixed_line_endings')
  if (preview.editable !== false && !preview.readOnlyReason) return null
  return translate(READ_ONLY_REASON_KEYS[preview.readOnlyReason] ?? 'readonly.fallback')
}

export const fileLabel = name => languageFor(name).label
export const clamp = (value, min, max) => {
  const rounded = Math.round(value)
  // NaN must not leak through Math.min/max into state; non-numeric input resolves to the lower bound.
  return Number.isFinite(rounded) ? Math.min(max, Math.max(min, rounded)) : min
}
export function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes < 0) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`; return `${(bytes / 1048576).toFixed(1)} MB` }