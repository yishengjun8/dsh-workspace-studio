import { translate } from './locale/index.js'
import { languageFor } from './languages.js'

/* Localized label of one file-color group; language-neutral names (TypeScript, JSON, ...) fall back to the constant label. */
export function fileColorGroupLabel(group) {
  const localized = translate(`fileColor.${group}`)
  if (localized !== `fileColor.${group}`) return localized
  return FILE_COLOR_GROUPS.find(item => item.group === group)?.label ?? group
}
/* Localized label of one highlight preset; language-neutral names (Python (VS Code), ...) fall back to the constant label. */
export function highlightPresetLabel(id) {
  const localized = translate(`preset.${id}`)
  if (localized !== `preset.${id}`) return localized
  return HIGHLIGHT_PRESETS.find(item => item.id === id)?.label ?? id
}


/* File-tree badge color groups. Each group owns one accent color for the
   leading type badge (text + translucent tint), user-recolorable in settings
   with unset groups falling back to their default. Directory and blocked
   entries are groups like any file type. */
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
export const DEFAULT_FILE_COLOR = '#9aa3ad'
export const FILE_COLOR_DEFAULTS = Object.fromEntries(FILE_COLOR_GROUPS.map(({ group, color }) => [group, color]))
/** The accent color a group falls back to when the user has not set one. */
export function fileColorDefault(group) {
  return FILE_COLOR_DEFAULTS[group] ?? DEFAULT_FILE_COLOR
}
/** Resolve one group's effective color: the user's customization, else the default. */
export function fileColorOf(settings, group) {
  return settings?.fileColors?.[group] ?? fileColorDefault(group)
}

/* Extension -> color group. Mirrors EXTENSION_LANGUAGES so a file's badge
   and editor highlighting agree; unknown suffixes land in 'other'. */
export const FILE_GROUP_BY_EXTENSION = Object.freeze({
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
export const FILE_GROUP_BY_EXACT_NAME = Object.freeze({
  'package.json': 'json', 'tsconfig.json': 'json',
  '.gitignore': 'config', '.npmrc': 'config', '.editorconfig': 'config', '.env': 'config',
  'dockerfile': 'config', 'dockerfile.dev': 'config', 'dockerfile.prod': 'config', 'dockerfile.test': 'config',
  'makefile': 'config', 'license': 'config',
})
export const DEFAULT_FILE_GROUP = 'other'
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

/* Editor syntax-highlight presets. Each non-default preset overrides the
   --shiki-token-* variables on the editor host (light/dark variants via the
   body attribute), so the HighlightStyle keeps its single var() mapping.
   'default' leaves the app theme's shiki palette untouched. */
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
/* Per-group default highlight presets; a group with no entry here and no user
   pick follows the app theme's shiki palette ('default'). */
export const HIGHLIGHT_PRESET_DEFAULT_BY_GROUP = Object.freeze({
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

/* Read-only reason codes the preview may carry, mapped to dictionary keys
   (including server alias spellings). */
export const READ_ONLY_REASON_KEYS = Object.freeze({
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

export function readOnlyReason(preview) {
  if (preview.truncated) return translate('readonly.truncated')
  if (preview.lineEnding === 'mixed') return translate('readonly.mixed_line_endings')
  if (preview.editable !== false && !preview.readOnlyReason) return null
  return translate(READ_ONLY_REASON_KEYS[preview.readOnlyReason] ?? 'readonly.fallback')
}

export const fileLabel = name => languageFor(name).label
export const clamp = (value, min, max) => {
  const rounded = Math.round(value)
  // NaN must not leak through Math.min/max into state; non-numeric input
  // resolves to the lower bound as a safe default.
  return Number.isFinite(rounded) ? Math.min(max, Math.max(min, rounded)) : min
}
export function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes < 0) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`; return `${(bytes / 1048576).toFixed(1)} MB` }