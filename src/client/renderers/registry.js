/* Renderer registry: extension-matched view modes for the preview pane, mirroring the harness document-preview pipeline (extension band first, then longest suffix). */
import { useMemo } from 'react'
import { translate } from '../locale/index.js'

export const VIEW_EDIT = 'edit'
export const VIEW_PREVIEW = 'preview'

export const RENDERER_MARKDOWN = 'markdown'
export const RENDERER_HTML = 'html'
export const RENDERER_IMAGE = 'image'
export const RENDERER_CODE = 'code'
/* Byte renderers: their content never travels through the Host text preview,
   which rejects binary files by design. `pdf` renders the file itself, `office`
   renders a Host-converted PDF of a doc/docx/ppt/pptx/xls/xlsx source. */
export const RENDERER_PDF = 'pdf'
export const RENDERER_OFFICE = 'office'

/* One renderer definition: id + recognized suffixes (no leading dot). */
const RENDERERS = Object.freeze([
  { id: RENDERER_OFFICE, extensions: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'] },
  { id: RENDERER_PDF, extensions: ['pdf'] },
  { id: RENDERER_MARKDOWN, extensions: ['md', 'markdown', 'mdx'] },
  { id: RENDERER_HTML, extensions: ['html', 'htm'] },
  { id: RENDERER_IMAGE, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'] },
  { id: RENDERER_CODE, extensions: [] },
])

/* Rank matching renderers: longest suffix first, then registration order. */
export function matchingRenderers(name) {
  const normalized = String(name ?? '').replaceAll('\\', '/').toLowerCase()
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return RENDERERS
    .map(renderer => ({
      renderer,
      length: Math.max(0, ...renderer.extensions
        .map(extension => extension.toLowerCase().replace(/^\./u, ''))
        .filter(extension => base.endsWith(`.${extension}`))
        .map(extension => extension.length)),
    }))
    .filter(candidate => candidate.length > 0)
    .sort((left, right) => right.length - left.length || RENDERERS.indexOf(left.renderer) - RENDERERS.indexOf(right.renderer))
    .map(candidate => candidate.renderer)
}

/* File suffixes mapped to grammars supported by the shared CodeBlock (shiki ids, not the CodeMirror ids of languages.js). */
const SHIKI_LANGUAGE_BY_EXTENSION = Object.freeze({
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  json: 'json', jsonc: 'json', jsonl: 'json', ndjson: 'json',
  py: 'python', pyw: 'python', pyi: 'python',
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
  go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  kt: 'kotlin', kts: 'kotlin', swift: 'swift', php: 'php',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  html: 'html', htm: 'html', xhtml: 'html',
  css: 'css', scss: 'scss', less: 'less', sql: 'sql',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml',
  lua: 'lua',
})
/* The shared CodeBlock's grammar hint for one file name; undefined = plain. */
export function shikiLanguageFor(name) {
  const lower = String(name ?? '').toLowerCase()
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return SHIKI_LANGUAGE_BY_EXTENSION[extension]
}

export function isMarkdownName(name) {
  return matchingRenderers(name).some(renderer => renderer.id === RENDERER_MARKDOWN)
}
export function isHtmlName(name) {
  return matchingRenderers(name).some(renderer => renderer.id === RENDERER_HTML)
}
export function isImageName(name) {
  return matchingRenderers(name).some(renderer => renderer.id === RENDERER_IMAGE)
}
export function isPdfName(name) {
  return matchingRenderers(name).some(renderer => renderer.id === RENDERER_PDF)
}
export function isOfficeName(name) {
  return matchingRenderers(name).some(renderer => renderer.id === RENDERER_OFFICE)
}
/* Whether a preview `kind` renders bytes instead of text (no draft, no editor,
   no editor-context envelope). */
export function isByteKind(kind) {
  return kind === RENDERER_IMAGE || kind === RENDERER_PDF || kind === RENDERER_OFFICE
}
/* The byte renderer a file name selects, or undefined for a text file. */
export function byteKindOf(name) {
  if (isImageName(name)) return RENDERER_IMAGE
  if (isPdfName(name)) return RENDERER_PDF
  if (isOfficeName(name)) return RENDERER_OFFICE
  return undefined
}

/* The viewer-menu items for the active file: 'edit' is always present for text files; 'preview' is the rendered view. Read-only text files offer a paged browse of the full file; a tab the workspace-files Remote cannot read at all (a dropped-in file, whose content lives only in memory) never offers it — a file OUTSIDE the workspace is not such a tab (the Remote reads its absolute path), so its caller passes external=false. Byte-rendered files (image, PDF, Office) have a single auto-selected view. */
export function viewerCandidates(preview, name, external) {
  if (isImageName(name)) return [{ id: RENDERER_IMAGE, label: translate('renderer.image') }]
  if (isPdfName(name)) return [{ id: RENDERER_PDF, label: translate('renderer.pdf') }]
  if (isOfficeName(name)) return [{ id: RENDERER_OFFICE, label: translate('renderer.office') }]
  if (isMarkdownName(name)) {
    return [
      { id: VIEW_EDIT, label: translate('editor.edit') },
      { id: VIEW_PREVIEW, label: translate('mdPreview.preview') },
    ]
  }
  if (isHtmlName(name)) {
    return [
      { id: VIEW_EDIT, label: translate('editor.edit') },
      { id: VIEW_PREVIEW, label: translate('htmlPreview.preview') },
    ]
  }
  if (external !== true && preview?.state === 'ready' && (preview.editable === false || preview.readOnlyReason)) {
    return [
      { id: VIEW_EDIT, label: translate('editor.edit') },
      { id: VIEW_PREVIEW, label: translate('renderer.browse') },
    ]
  }
  return [{ id: VIEW_EDIT, label: translate('editor.edit') }]
}

/* Localized chrome for the shared MarkdownText primitive: the harness component requires a reference-stable MarkdownLabels object (it memoizes on its identity), so the memo keys on the three translated strings and rebuilds only when the active locale changes them. */
export function useMarkdownLabels() {
  const copyLabel = translate('renderer.copy')
  const copiedLabel = translate('renderer.copied')
  const footnotes = translate('renderer.footnotes')
  return useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
}
