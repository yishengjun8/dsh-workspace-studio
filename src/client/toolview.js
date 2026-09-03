/* Studio takeover of the chat's edit/write tool rows.
 *
 * The shipped FileMutationRow collapses by default and renders the diff as
 * two stacked blocks (all removed lines, then all added lines). This module
 * registers a keyed `tool.call.toolview` entry for the `edit` and `write` keys
 * at a LOWER priority than the shipped row, so slot cell shadowing (lowest
 * priority renders) replaces it in the chat flow:
 *
 *  - the row opens by default (the user asked for the change to be visible
 *    without a click; manual collapse still works),
 *  - the diff renders as ONE merged view: added text on a green background,
 *    removed text struck through in red, inline within the same line, instead
 *    of the split removed-block / added-block pair.
 *
 * The details panel and every other tool row are untouched: this entry only
 * owns the `edit`/`write` keys in the conversation flow.
 */
import { createElement as h, Fragment, useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import {
  DisclosureRow, StateDot, diffTotals, IconEditOutline16, IconInspectOutline12, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { inlineDiffSegments, myersDiff } from './merge.js'
import { AUTO_EXPAND_EDIT_DIFF_DEFAULT } from './constants.js'

/* The explorer settings store instance, handed over by mountStudio (the
   toolview renders inside the harness renderer, which has no access to the
   plugin's stores). Set once at apply time, before any row can render. The
   stable subscribe/getSnapshot wrappers below read the current instance, so
   useSyncExternalStore never re-subscribes on re-renders. */
let studioSettingsStore = undefined
export function setStudioSettingsStore(store) {
  studioSettingsStore = store
}
const subscribeStudioSettings = (listener) => studioSettingsStore === undefined
  ? () => {}
  : studioSettingsStore.subscribe(listener)
const getStudioSettingsSnapshot = () => studioSettingsStore === undefined
  ? undefined
  : studioSettingsStore.getSnapshot()

/* Diff-body lines the chat row shows before collapsing the middle — the same
   cap the shipped row applies (half the primitive's own default, so the flow
   stays scannable across many calls). */
const CHAT_DIFF_MAX_LINES = 8

/* Above this many old+new lines, skip the line-level alignment (Myers is
   O(N*D) worst case) and fall back to the split removed/added blocks — the
   same graceful degradation the shipped card shows for oversized content. */
const MERGED_DIFF_ALIGN_MAX_LINES = 4000

/* ---- Narrowing helpers (mirror the shipped tool-call models) ---- */

function parseArgs(argsRaw) {
  try {
    return JSON.parse(argsRaw)
  } catch {
    return undefined
  }
}

function pickString(args, keys) {
  if (typeof args !== 'object' || args === null) return undefined
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function firstLine(text) {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/* Strip the workspace root from a workspace-rooted absolute path (display only). */
function relativizeToCwd(text, cwd) {
  if (cwd === undefined || cwd === '') return text
  const root = cwd.replace(/[/\\]+$/, '')
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1)
  return text
}

/* Abbreviate a POSIX home directory for display (`~` / `~/…`). */
function abbreviateHomePath(text, home) {
  if (home === undefined || home === '') return text
  if (/^[A-Za-z]:[/\\]/.test(text) || text.startsWith('\\\\')) return text
  if (/^[A-Za-z]:[/\\]/.test(home) || home.startsWith('\\\\')) return text
  const root = home.replace(/\/+$/, '')
  if (root === '' || root === '/') return text
  if (text.replace(/\/+$/, '') === root) return '~'
  if (text.startsWith(`${root}/`)) return `~${text.slice(root.length)}`
  return text
}

/* Validate the optional escalation pair shared by first-party file tools. */
function validEscalationFields(args) {
  const permission = args.sandbox_permissions
  const justification = args.justification
  if (permission === undefined && justification === undefined) return true
  if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
  return typeof justification === 'string' && justification.trim() !== ''
}

/* Parse the call head paired with one immutable Tool block. */
function parsedToolCall(block) {
  const call = 'kind' in block ? block.call : block
  if (call === null) return null
  const value = parseArgs(call.argsRaw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return { name: call.name, args: value }
}

/* Flatten a settled result's content blocks to display text. */
function resultText(node) {
  const parts = []
  for (const block of node.content) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.join('\n')
}

/* Narrow opaque result metadata's `diffs` to well-formed hunks. */
function narrowDiffs(diffs) {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText } = hunk
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    out.push({ path, oldText, newText })
  }
  return out
}

function appliedDiffs(meta) {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const diffs = meta.diffs
  if (!Array.isArray(diffs)) return null
  if (diffs.length === 0) return 'empty'
  return narrowDiffs(diffs)
}

/* The diff hunks this row shows: the intended change while running, the
   applied diffs once settled (falling back to the intended whole-file diff
   for a write with no applied metadata). Null = no diff card (generic body). */
function diffCardModel(block) {
  if (block.parentCallId !== undefined) return null
  const parsed = parsedToolCall(block)
  if (parsed === null) return null
  const { file_path: path } = parsed.args
  if (typeof path !== 'string' || path.trim() === '') return null
  if (!validEscalationFields(parsed.args)) return null
  if (parsed.name === 'write') {
    const { content } = parsed.args
    if (typeof content !== 'string') return null
    const intended = { path, oldText: null, newText: content }
    if (!('kind' in block)) return [intended]
    if (block.isError) return null
    const applied = appliedDiffs(block.meta)
    if (applied === null || applied === 'empty') return [intended]
    return applied
  }
  if (parsed.name !== 'edit') return null
  const { old_string: oldText, new_string: newText, replace_all: replaceAll } = parsed.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return null
  const intended = { path, oldText: oldText || null, newText }
  if (!('kind' in block)) return [intended]
  if (block.isError) return null
  const applied = appliedDiffs(block.meta)
  if (applied === null || applied === 'empty') return null
  return applied
}

/* One-line summary, state, and openable path for an edit/write row. */
function fileMutationModel(toolName, block, cwd, home) {
  const done = 'kind' in block
  const argsRaw = (done ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state = !done ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const parsed = parseArgs(argsRaw)
  const path = pickString(parsed, ['path', 'file_path'])
  const base = path !== undefined
    ? abbreviateHomePath(relativizeToCwd(path, cwd), home)
    : argsRaw === '' ? block.callId : firstLine(argsRaw)
  const output = done ? (resultText(block) || null) : null
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
  return {
    state,
    titleKey: toolName === 'write' ? 'tool.title.write' : 'tool.title.edit',
    summary: base,
    filePath: path,
    bodyRaw: argsRaw === '' ? null : argsRaw,
    output,
    errorSummary,
  }
}

/* ---- Merged diff card ---- */

/* Split a side's text into its content lines (the same terminator rule the
   shipped DiffBlock applies: a single trailing newline is a terminator, an
   interior blank line survives). */
function contentLines(text) {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/* One hunk's merged rows: unchanged lines plain, whole-line deletions struck,
   whole-line additions on a green background, and matched del/add line pairs
   as a character-level inline diff (removed red strikethrough, added green
   background) — all in ONE block, in file order. */
function mergedHunkRows(oldText, newText) {
  if (oldText === null) {
    return contentLines(newText).map(text => ({ kind: 'add', text }))
  }
  const oldLines = contentLines(oldText)
  const newLines = contentLines(newText)
  if (oldLines.length + newLines.length > MERGED_DIFF_ALIGN_MAX_LINES) {
    return [
      ...oldLines.map(text => ({ kind: 'del', text })),
      ...newLines.map(text => ({ kind: 'add', text })),
    ]
  }
  const changes = myersDiff(oldLines, newLines)
  if (changes === null) {
    return [
      ...oldLines.map(text => ({ kind: 'del', text })),
      ...newLines.map(text => ({ kind: 'add', text })),
    ]
  }
  const rows = []
  let i = 0
  for (const change of changes) {
    for (; i < change.from; i += 1) rows.push({ kind: 'same', text: oldLines[i] })
    const delLines = oldLines.slice(change.from, change.to)
    const addLines = change.added
    const pairCount = Math.max(delLines.length, addLines.length)
    for (let p = 0; p < pairCount; p += 1) {
      const del = delLines[p]
      const add = addLines[p]
      if (del !== undefined && add !== undefined) rows.push({ kind: 'pair', del, add })
      else if (del !== undefined) rows.push({ kind: 'del', text: del })
      else rows.push({ kind: 'add', text: add })
    }
    i = change.to
  }
  for (; i < oldLines.length; i += 1) rows.push({ kind: 'same', text: oldLines[i] })
  return rows
}

/* Flatten the hunks into the merged body rows plus the footer counts. A path
   header opens each new file; a same-file second hunk opens with a `⋯` gap. */
function buildMergedRows(diffs) {
  const rows = []
  const paths = new Set()
  let prevPath
  for (const diff of diffs) {
    paths.add(diff.path)
    if (diff.path !== prevPath) rows.push({ kind: 'path', text: diff.path })
    else rows.push({ kind: 'gap', text: '⋯' })
    prevPath = diff.path
    rows.push(...mergedHunkRows(diff.oldText, diff.newText))
  }
  return { rows, ...diffTotals(diffs), files: paths.size }
}

/* The diff text a reader copies: each row's `-`/`+` prefix and its content,
   exactly what the card shows (a pair row copies both sides of the change). */
function copyText(rows) {
  return rows.map((row) => {
    switch (row.kind) {
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      case 'pair': return `- ${row.del}\n+ ${row.add}`
      default: return row.text
    }
  }).join('\n')
}

/* Localized chrome for the merged diff card (conversation namespace + the
   shared common vocabulary, the same keys the shipped DiffBlock labels use). */
function diffLabels(t) {
  return {
    copy: t('copy'),
    copied: t('copied'),
    collapseAria: t('diff.collapseAria'),
    expandAria: count => t('diff.expandAria', { count }),
    collapse: t('collapse'),
    expand: count => t('diff.expandRest', { count }),
    files: count => t(count === 1 ? 'diff.files.one' : 'diff.files.other', { count }),
  }
}

/* One merged body line: unchanged plain, whole-line deletion struck, whole-
   line addition on a green background, a pair as inline segments. */
function MergedDiffRowView({ row }) {
  if (row.kind === 'path') return h('div', { className: 'dsh-ws-diff-line dsh-ws-diff-path' }, row.text)
  if (row.kind === 'gap') return h('div', { className: 'dsh-ws-diff-line dsh-ws-diff-gap' }, row.text)
  if (row.kind === 'del') return h('div', { className: 'dsh-ws-diff-line dsh-ws-diff-del' }, row.text)
  if (row.kind === 'add') {
    return h('div', { className: 'dsh-ws-diff-line' },
      h('span', { className: 'dsh-ws-diff-ins dsh-ws-diff-ins-line' }, row.text))
  }
  if (row.kind === 'pair') {
    const segments = inlineDiffSegments(row.del, row.add)
    if (segments !== null) {
      return h('div', { className: 'dsh-ws-diff-line' },
        segments.map((segment, index) => {
          if (segment.kind === 'same') return h(Fragment, { key: index }, segment.text)
          if (segment.kind === 'del') return h('span', { key: index, className: 'dsh-ws-diff-del' }, segment.text)
          return h('span', { key: index, className: 'dsh-ws-diff-ins' }, segment.text)
        }))
    }
    return h(Fragment, null,
      h('div', { className: 'dsh-ws-diff-line dsh-ws-diff-del' }, row.del),
      h('div', { className: 'dsh-ws-diff-line' },
        h('span', { className: 'dsh-ws-diff-ins dsh-ws-diff-ins-line' }, row.add)))
  }
  return h('div', { className: 'dsh-ws-diff-line' }, row.text)
}

/* The merged diff card: one block per file change, additions on a green
   background and deletions struck through in red, with the same height cap,
   copy control, and +/- footer as the shipped DiffBlock. When capped, only
   the FIRST maxLines rows are shown and the expand/collapse control sits at
   the bottom of the card (no tail preview), so the change reads continuously
   from the top. */
function StudioDiffBlock({ diffs, labels, maxLines = 16 }) {
  const { rows, added, removed, files } = useMemo(() => buildMergedRows(diffs), [diffs])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  if (rows.length === 0) return null

  const hidden = rows.length - maxLines
  const capped = hidden > 0 && !expanded
  const head = capped ? rows.slice(0, maxLines) : rows

  return h('div', { className: 'dsh-ws-diff-card', 'data-diff': '' },
    h('button', { type: 'button', className: 'dsh-ws-diff-copy', onClick: onCopy },
      copied ? labels.copied : labels.copy),
    h('div', { className: 'dsh-ws-diff-body' },
      head.map((row, index) => h(MergedDiffRowView, { key: index, row })),
      hidden > 0 && h('button', {
        type: 'button', className: 'dsh-ws-diff-expand', onClick: onToggle,
        'aria-expanded': expanded || undefined,
        'aria-label': expanded ? labels.collapseAria : labels.expandAria(hidden),
      }, expanded ? labels.collapse : labels.expand(hidden)),
    ),
    h('div', { className: 'dsh-ws-diff-footer' }, `└ +${added} -${removed} · ${labels.files(files)}`),
  )
}

/* ---- Row ---- */

function stateStatus(state, t) {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/* Format one argument payload when its generic input body becomes visible. */
function formatToolBody(argsRaw) {
  if (argsRaw === '') return null
  const parsed = parseArgs(argsRaw)
  if (parsed === undefined) return argsRaw
  return JSON.stringify(parsed, null, 2)
}

/* The Studio edit/write row: opens by default (unless the user turned the
   auto-expand setting off), shows the merged diff card. */
export function StudioFileMutationRow({ toolName, block, cwd, home, openFile, inspect, t }) {
  const model = useMemo(() => fileMutationModel(toolName, block, cwd, home), [toolName, block, cwd, home])
  const diffs = useMemo(() => diffCardModel(block), [block])
  /* Default open: the change is the point of the row. The initial state reads
     the user's auto-expand setting (on by default); manual collapse still
     works and the per-row state is never re-opened by re-renders or a later
     setting change (the setting governs rows that mount after it). */
  const autoExpandEditDiff = useSyncExternalStore(
    subscribeStudioSettings,
    getStudioSettingsSnapshot,
  )?.autoExpandEditDiff
  const [expanded, setExpanded] = useState(autoExpandEditDiff ?? AUTO_EXPAND_EDIT_DIFF_DEFAULT)
  const labels = useMemo(() => diffLabels(t), [t])
  const expandable = diffs !== null || model.bodyRaw !== null || model.output !== null
  const open = expanded && expandable
  const diffStat = useMemo(() => {
    if (diffs === null) return null
    const { added, removed } = diffTotals(diffs)
    return `+${added} -${removed}`
  }, [diffs])
  const status = stateStatus(model.state, t)
  const failureLine = model.state === 'error' ? model.errorSummary ?? null : null
  const summaryText = failureLine ?? model.summary
  const fileLink = model.filePath !== undefined && openFile !== undefined && failureLine === null
  const toggleExpand = () => { setExpanded(value => !value) }
  const openFileClick = (event) => {
    event.stopPropagation()
    if (model.filePath !== undefined) openFile(model.filePath)
  }
  const fileLinkKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  }
  const leading = model.state === 'error' ? h(StateDot, { state: 'error' })
    : model.state === 'stopped' ? h(StateDot, { state: 'warning' })
      : h(IconEditOutline16, { size: 14 })
  const bodyText = useMemo(
    () => open && diffs === null && model.bodyRaw !== null ? formatToolBody(model.bodyRaw) : null,
    [diffs, model.bodyRaw, open],
  )
  return h('div', { className: 'dsh-ws-tool-row', 'data-tool': toolName, 'data-state': model.state },
    status !== null && h('span', { className: 'dsh-ws-tool-visually-hidden' }, status),
    h(DisclosureRow, {
      className: 'dsh-ws-tool-row',
      rowClassName: 'dsh-ws-tool-rowline',
      leadingClassName: 'dsh-ws-tool-leading',
      titleClassName: 'dsh-ws-tool-title',
      chevronClassName: 'dsh-ws-tool-chevron',
      icon: leading,
      title: t(model.titleKey),
      open,
      expandable,
      expandOnRowClick: true,
      keepContentWhenOpen: true,
      onToggle: toggleExpand,
      collapsedContent: summaryText !== '' && h(Fragment, null,
        h('span', { className: 'dsh-ws-tool-sep', 'aria-hidden': true }),
        fileLink
          ? h('button', {
            type: 'button', className: 'dsh-ws-tool-filelink', onClick: openFileClick, onKeyDown: fileLinkKeyDown,
          }, summaryText)
          : h('span', {
            className: `dsh-ws-tool-summary${failureLine !== null ? ' dsh-ws-tool-error-summary' : ''}`,
          }, summaryText),
        diffStat !== null && h('span', { className: 'dsh-ws-tool-diffstat' }, diffStat),
      ),
    },
      h('div', { className: 'dsh-ws-tool-body' },
        diffs !== null
          ? h(StudioDiffBlock, { diffs, labels, maxLines: CHAT_DIFF_MAX_LINES })
          : (bodyText !== null || model.output !== null) && h('div', { className: 'dsh-ws-tool-io' },
            bodyText !== null && h('div', { className: 'dsh-ws-tool-io-section' },
              h('span', { className: 'dsh-ws-tool-io-label' }, t('row.input')),
              h('span', { className: 'dsh-ws-tool-io-text' }, bodyText)),
            bodyText !== null && model.output !== null && h('span', { className: 'dsh-ws-tool-io-divider', 'aria-hidden': true }),
            model.output !== null && h('div', { className: 'dsh-ws-tool-io-section' },
              h('span', { className: 'dsh-ws-tool-io-label' }, t('row.output')),
              h('span', { className: 'dsh-ws-tool-io-text', 'data-error': model.state === 'error' || undefined }, model.output)),
          ),
        inspect !== undefined && h('button', { type: 'button', className: 'dsh-ws-tool-inspect', onClick: inspect },
          h(IconInspectOutline12, null), t('row.inspect')),
      ),
    ),
  )
}

/* ---- Registration ---- */

/* Take over the shipped edit/write rows: a keyed entry at a lower priority
   than the shipped one (default 0) wins the slot cell (lowest renders), so
   the conversation flow shows this row for both keys. The locale seat binds
   the conversation namespace, the same dictionary the shipped row uses. */
export function registerStudioFileMutationToolview(ctx) {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'edit', locale: 'conversation', priority: -100,
  }, StudioFileMutationRow))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'write', locale: 'conversation', priority: -100,
  }, StudioFileMutationRow))
}
