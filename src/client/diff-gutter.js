/** Change marks for the editor's gutter: what changed in the buffer relative to the repository base.
 *
 * Pure by design — the base text and the live document text go in, per-line marks and the summary
 * come out — so the mapping rules (including where a pure deletion's triangle lands) are testable
 * without a DOM or a CodeMirror view. The diff itself is the merge module's budgeted Myers, which
 * the save-time three-way merge already uses, so no extra diff implementation ships.
 */
import { DIFF_GUTTER_MAX_LINES, DIFF_RULER_MAX_RUNS } from './constants.js'
import { diffColorDefault } from './format.js'
import { myersDiff } from './merge.js'

/** Split text into lines exactly like a CodeMirror document does (CRLF / CR / LF, no terminators).
 *  An empty text is ONE empty line, matching `Text.lines`. */
export function splitLines(text) {
  return String(text ?? '').split(/\r\n|\r|\n/)
}

/** The counts the status bar shows. */
function emptySummary() {
  return { added: 0, modified: 0, deleted: 0 }
}

/**
 * Per-line change marks of one document against its base revision.
 *
 * Mark kinds: `kind: 'added' | 'modified'` draws the colour bar on that line; `deleted: 'top'` draws
 * the triangle at the line's top edge (the content that was removed sat before it), `deleted:
 * 'bottom'` at its bottom edge (a removal at end of file). A line can carry both (a replacement
 * with a partial deletion next to it).
 *
 * @param baseText - the base revision's text (HEAD / SVN BASE), or undefined when unavailable.
 * @param docText - the live editor text.
 * @returns `{ status: 'ok', marks, summary }` or `{ status: 'unavailable', reason }` with reason
 *          `'no-base' | 'too-large' | 'budget'`.
 */
export function diffMarks(baseText, docText) {
  if (typeof baseText !== 'string') return { status: 'unavailable', reason: 'no-base' }
  const baseLines = splitLines(baseText)
  const docLines = splitLines(docText)
  if (baseLines.length > DIFF_GUTTER_MAX_LINES || docLines.length > DIFF_GUTTER_MAX_LINES) {
    return { status: 'unavailable', reason: 'too-large' }
  }
  /* Budgeted Myers: null means the trace exceeded the memory budget (a very noisy file). */
  const changes = myersDiff(baseLines, docLines)
  if (changes === null) return { status: 'unavailable', reason: 'budget' }
  const marks = new Map()
  const mark = (line, patch) => {
    const current = marks.get(line)
    marks.set(line, { ...(current ?? {}), ...patch })
  }
  const summary = emptySummary()
  let basePos = 0
  let docPos = 0
  for (const change of changes) {
    /* Unchanged base lines before this change map one-to-one onto document lines. */
    docPos += change.from - basePos
    basePos = change.from
    const removed = change.to - change.from
    const inserted = change.added.length
    if (inserted > 0) {
      /* Insertions stand alone (pure add) or replace removed lines (a modification). */
      const kind = removed > 0 ? 'modified' : 'added'
      for (let index = 0; index < inserted; index += 1) mark(docPos + index + 1, { kind })
      if (kind === 'modified') summary.modified += inserted
      else summary.added += inserted
    }
    if (removed > 0 && inserted === 0) {
      summary.deleted += removed
      /* Nothing in the document represents the removed lines, so the triangle sits on the line the
         removal preceded — or on the last line's bottom edge when the removal was at end of file. */
      const atEnd = docPos >= docLines.length
      mark(atEnd ? Math.max(1, docLines.length) : docPos + 1, { deleted: atEnd ? 'bottom' : 'top' })
    }
    docPos += inserted
    basePos = change.to
  }
  return {
    status: 'ok',
    /* Sorted by line: the gutter builds a RangeSet from it, which requires ascending positions. */
    marks: [...marks.entries()].map(([line, value]) => ({ line, ...value })).sort((left, right) => left.line - right.line),
    summary,
  }
}

/** Whether a summary carries any change at all (drives the status-bar item's visibility). */
export function summaryHasChanges(summary) {
  return summary !== undefined && summary !== null
    && (summary.added > 0 || summary.modified > 0 || summary.deleted > 0)
}

/** Cap the band count without dropping the map: past the cap, consecutive runs collapse into one
 *  band whose tone is the group's longest run (a coarser map beats a megabyte-long style value). */
function coalesceRuns(runs, cap) {
  if (runs.length <= cap) return runs
  const perGroup = Math.ceil(runs.length / cap)
  const merged = []
  for (let index = 0; index < runs.length; index += perGroup) {
    const group = runs.slice(index, index + perGroup)
    let longest = group[0]
    for (const run of group) {
      if (run.to - run.from > longest.to - longest.from) longest = run
    }
    merged.push({ from: group[0].from, to: group[group.length - 1].to, kind: longest.kind })
  }
  return merged
}

/**
 * Scrollbar-ruler geometry: the same per-line marks, folded onto the vertical track's height.
 *
 * The track is painted through a `background-image` on the scrollbar pseudo-element, so the marks
 * come out as two CSS gradients — one for the added/modified bands, one for the pure-deletion ticks
 * (the deletion has no line of its own, so it is a 2px line at its boundary). Positions are PERCENT
 * of the track height and every band is floored at 2px, so a single changed line stays visible in a
 * long file. Nothing is measured: the percentages follow the track through resizes, zoom and font
 * changes, and the tones stay `var()` references so recolouring in Settings needs no recompute.
 *
 * @param marks - `diffMarks`' mark list (1-based `line`, optional `kind` / `deleted`).
 * @param totalLines - the live document's line count (the same base the marks were built against).
 * @returns `{ bands, ticks }` — either may be null — or null when there is nothing to draw.
 */
export function rulerLayers(marks, totalLines) {
  const total = Number.isFinite(totalLines) && totalLines > 0 ? Math.floor(totalLines) : 0
  if (total === 0 || !Array.isArray(marks) || marks.length === 0) return null
  const pct = line => `calc(100% * ${line} / ${total})`
  const tone = kind => `var(--dsh-ws-diff-${kind},${diffColorDefault(kind)})`
  const runs = []
  const tickLines = new Set()
  for (const mark of marks) {
    if (mark === null || typeof mark !== 'object') continue
    if (!Number.isFinite(mark.line)) continue
    const line = Math.min(total, Math.max(1, Math.floor(mark.line)))
    if (mark.kind === 'added' || mark.kind === 'modified') {
      const last = runs[runs.length - 1]
      /* Consecutive same-tone lines extend the run; a repeated line (defensive — diffMarks keys by
         line, so it cannot happen from there) must not add a second identical band. */
      if (last !== undefined && last.kind === mark.kind && (last.to === line || last.to === line - 1)) {
        if (line > last.to) last.to = line
      } else {
        runs.push({ from: line, to: line, kind: mark.kind })
      }
    }
    if (mark.deleted === 'top' || mark.deleted === 'bottom') {
      /* 'top' = the removal sat before this line, so its boundary is the line's top edge;
         'bottom' = the removal was at end of file, i.e. the boundary after the last line. */
      tickLines.add(Math.min(total, Math.max(0, mark.deleted === 'top' ? line - 1 : line)))
    }
  }
  const bandRuns = coalesceRuns(runs, DIFF_RULER_MAX_RUNS)
  let bands = null
  if (bandRuns.length > 0) {
    const parts = ['transparent 0']
    let cursor = 0
    for (const run of bandRuns) {
      const startLine = run.from - 1
      const start = pct(startLine)
      /* The leading stop already covers everything above the first band. */
      if (startLine > 0 && startLine > cursor) parts.push(`transparent ${pct(cursor)} ${start}`)
      /* max() is the 2px floor: one line of a 20k-line file would otherwise be a 0.1% sliver. */
      parts.push(`${tone(run.kind)} ${start} max(${pct(run.to)},calc(${start} + 2px))`)
      cursor = run.to
    }
    if (cursor < total) parts.push(`transparent ${pct(cursor)} 100%`)
    bands = `linear-gradient(to bottom,${parts.join(',')})`
  }
  let ticks = null
  if (tickLines.size > 0) {
    const parts = ['transparent 0']
    let cursor = '0'
    for (const line of [...tickLines].sort((left, right) => left - right)) {
      const top = `calc(${pct(line)} - 1px)`
      const bottom = `calc(${pct(line)} + 1px)`
      parts.push(`transparent ${cursor} ${top}`)
      parts.push(`${tone('deleted')} ${top} ${bottom}`)
      cursor = bottom
    }
    parts.push(`transparent ${cursor} 100%`)
    ticks = `linear-gradient(to bottom,${parts.join(',')})`
  }
  /* Nothing to draw at all (a clean file, or marks the ruler cannot use): say so, so the caller
     clears the track instead of writing an all-transparent gradient. */
  if (bands === null && ticks === null) return null
  return { bands, ticks }
}

/** Why the marks could not be computed, in the status bar's own words. */
const DIFF_REASON_KEYS = Object.freeze({
  'no-base': 'diff.reason.noBase',
  'missing-base': 'diff.reason.missingBase',
  'no-repo': 'diff.reason.noRepo',
  'vcs-unavailable': 'diff.reason.unavailable',
  disabled: 'diff.reason.disabled',
  'too-large': 'diff.reason.tooLarge',
  'file-too-large': 'diff.reason.tooLarge',
  budget: 'diff.reason.budget',
  binary: 'diff.reason.binary',
  'invalid-encoding': 'diff.reason.encoding',
  timeout: 'diff.reason.timeout',
  'fetch-failed': 'diff.reason.fetchFailed',
})

/** Locale key explaining one `unavailable` reason. */
export function diffReasonKey(reason) {
  return DIFF_REASON_KEYS[reason] ?? 'diff.reason.unknown'
}
