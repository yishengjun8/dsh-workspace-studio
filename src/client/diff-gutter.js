/** Change marks for the editor's gutter: what changed in the buffer relative to the repository base.
 *
 * Pure by design — the base text and the live document text go in, per-line marks and the summary
 * come out — so the mapping rules (including where a pure deletion's triangle lands) are testable
 * without a DOM or a CodeMirror view. The diff itself is the merge module's budgeted Myers, which
 * the save-time three-way merge already uses, so no extra diff implementation ships.
 */
import { DIFF_GUTTER_MAX_LINES } from './constants.js'
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
