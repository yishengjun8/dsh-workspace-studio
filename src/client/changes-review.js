/* Change-review resources: the bridge from the harness chat's
 * `ctx.sidebarRight.openResource` path into this plugin's own preview column.
 *
 * The chat's changed-files card asks ui-deliverables to open
 * `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>` in the harness
 * right Sidebar. This root layout never mounts that seat, so the address would
 * reach no surface and the shipped implementation would throw "no session surface
 * is mounted". This module recognizes the address, carries the requested file
 * index to the mounted explorer, and reads the two Host routes ui-deliverables
 * itself reads — the summary and one file's comparison — so the plugin renders
 * the review without re-deriving anything the Host already computed and without
 * writing to the session log.
 *
 * The address grammar, the route paths, and the payload shapes are mirrored from
 * @deepseek-ai/dsh-client-ui-deliverables' changes.ts/host-read-store.ts so the
 * bundle needs no new harness dependency.
 */
import { REVIEW_DIFF_MIN, REVIEW_LIST_DEFAULT, REVIEW_LIST_MAX_FALLBACK, REVIEW_LIST_MIN } from './constants.js'
import { isAbsoluteWorkspacePath, joinAbsolutePath, normalizeAbsolutePath } from './paths.js'

/* Resource-address prefix of one turn's review; the tail is
   `<percent-encoded sessionId>/<seq>/<turn>`. */
const REVIEW_PREFIX = 'dsh-resource://changes-review/session/'

/* Document-relative Host routes (no leading slash), the same URLs the harness
   client fetches: they sit inside the connection's authentication fence, so a
   same-origin fetch from this bundle is authenticated exactly like the harness's
   own read. */
export const CHANGES_SUMMARY_ROUTE = 'api/changes.summary'
export const CHANGES_DIFF_ROUTE = 'api/changes.diff'

/* The view draws at most this many comparison lines, the same cap
   ui-deliverables applies in its own review tab. */
export const MAX_RENDERED_LINES = 5000

/**
 * Recognize a change-review resource address.
 * @param address - a caller-supplied `dsh-resource://…` address.
 * @returns the review coordinates, or undefined for any other address.
 */
export function parseChangesReviewAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(REVIEW_PREFIX)) return undefined
  const parts = address.slice(REVIEW_PREFIX.length).split('/')
  if (parts.length !== 3) return undefined
  const [rawId, seq, turn] = parts
  if (rawId === '' || !/^\d+$/.test(seq) || !/^[1-9]\d*$/.test(turn)) return undefined
  const seqNumber = Number(seq)
  const turnNumber = Number(turn)
  if (!Number.isSafeInteger(seqNumber) || !Number.isSafeInteger(turnNumber)) return undefined
  try {
    return { sessionId: decodeURIComponent(rawId), seq: seqNumber, turn: turnNumber }
  } catch {
    // decodeURIComponent throws URIError on a malformed escape: not an address this package minted.
    return undefined
  }
}

/**
 * The authenticated URL of one announced change summary.
 * @param sessionId - viewed Session.
 * @param seq - the announcing event's sequence.
 * @returns the document-relative route with its coordinates.
 */
export function changesSummaryUrl(sessionId, seq) {
  return `${CHANGES_SUMMARY_ROUTE}?${new URLSearchParams({ sessionId: String(sessionId), seq: String(seq) })}`
}

/**
 * The authenticated URL of one listed file's turn-start and turn-end comparison.
 * @param sessionId - viewed Session.
 * @param seq - the announcing event's sequence.
 * @param index - the file's index in the summary.
 * @returns the document-relative route with its coordinates.
 */
export function changesDiffUrl(sessionId, seq, index) {
  return `${CHANGES_DIFF_ROUTE}?${new URLSearchParams({ sessionId: String(sessionId), seq: String(seq), index: String(index) })}`
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * Validate one changed-file record read from the summary route.
 * @param value - decoded JSON.
 * @returns whether the record carries a path, a display path, and line counts.
 */
export function isChangedFile(value) {
  if (!isRecord(value)) return false
  const { path, display, added, deleted, binary, oversized } = value
  return typeof path === 'string' && path.length > 0 && typeof display === 'string' && display.length > 0
    && isCount(added) && isCount(deleted)
    && (binary === undefined || binary === true) && (oversized === undefined || oversized === true)
}

/**
 * Validate a summary read from the summary route.
 * @param value - decoded JSON.
 * @returns whether the value identifies a turn, a complete file list, and the line totals.
 */
export function isChangesSummary(value) {
  if (!isRecord(value)) return false
  const { turn, files, total, added, deleted } = value
  return Number.isSafeInteger(turn) && turn >= 1 && isCount(total) && isCount(added) && isCount(deleted)
    && Array.isArray(files) && files.every(isChangedFile)
}

function isHunk(value) {
  if (!isRecord(value)) return false
  const { oldStart, oldLines, newStart, newLines, lines } = value
  return [oldStart, oldLines, newStart, newLines].every(isCount)
    && Array.isArray(lines) && lines.every(line => typeof line === 'string' && /^[+ -]/.test(line))
}

/**
 * Validate a comparison read from the comparison route.
 * @param value - decoded JSON.
 * @returns whether the value is a text comparison with well-formed hunks, or a binary or oversized refusal.
 */
export function isChangesDiff(value) {
  if (!isRecord(value)) return false
  const { kind, path, display } = value
  if (typeof path !== 'string' || path.length === 0 || typeof display !== 'string' || display.length === 0) return false
  if (kind === 'binary' || kind === 'oversized') return true
  if (kind !== 'text') return false
  const { before, after, hunks, coarse } = value
  return typeof before === 'boolean' && typeof after === 'boolean' && typeof coarse === 'boolean'
    && Array.isArray(hunks) && hunks.every(isHunk)
}

/* One drawn line of a hunk, numbered on each side: context counts on both,
   deletions on the old side, additions on the new side (the shipped rule). */
export function hunkRows(hunk) {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  return hunk.lines.map((line) => {
    const text = line.slice(1)
    switch (line[0]) {
      case '+': return { kind: 'add', old: undefined, new: newNo++, text }
      case '-': return { kind: 'del', old: oldNo++, new: undefined, text }
      default: return { kind: 'context', old: oldNo++, new: newNo++, text }
    }
  })
}

/**
 * The `@@ … @@` header of one hunk.
 * @param hunk - a served hunk.
 * @returns its unified-diff range header.
 */
export function hunkHeader(hunk) {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * The hunks to draw, cut at {@link MAX_RENDERED_LINES} lines in total: a turn
 * that rewrote a huge file must not build an unbounded DOM.
 * @param hunks - served hunks.
 * @returns the hunks with the last one shortened as needed, and whether anything was cut.
 */
export function cappedHunks(hunks) {
  const kept = []
  let budget = MAX_RENDERED_LINES
  for (const hunk of hunks) {
    if (budget === 0) return { hunks: kept, truncated: true }
    kept.push(hunk.lines.length <= budget ? hunk : { ...hunk, lines: hunk.lines.slice(0, budget) })
    budget -= Math.min(budget, hunk.lines.length)
  }
  return { hunks: kept, truncated: kept.some((hunk, at) => hunk !== hunks[at]) }
}

/**
 * Resolve one listed file's `path` into what a file-open request needs.
 *
 * The summary spells `path` relative to the Session's cwd, and may spell it
 * absolute for a file outside it. With the cwd known the result is absolute, so
 * the request decides inside-versus-outside against the workspace root; without
 * it only a path that stays inside the root can be requested at all — a `..`
 * segment with no cwd is exactly the case that cannot be resolved here.
 * @param cwd - the Session's working directory, when known.
 * @param path - the summary's `path`.
 * @returns the resolved path, or undefined when it cannot be resolved safely.
 */
export function resolveReviewFilePath(cwd, path) {
  if (typeof path !== 'string' || path === '') return undefined
  const normalized = path.replace(/\\/g, '/')
  if (isAbsoluteWorkspacePath(normalized)) return normalizeAbsolutePath(normalized)
  if (typeof cwd === 'string' && cwd !== '') return normalizeAbsolutePath(joinAbsolutePath(cwd, normalized))
  return normalized.split('/').includes('..') ? undefined : normalized
}

/* Read one JSON route into its view state. The response decides: a non-OK answer
   is the `failed` state, a payload that fails validation is that same state (the
   Host and this bundle disagree about the shape, which is not something the view
   could render), and an aborted read stays a rejection so its caller ignores it.
   Nothing is cached module-wide: one mounted tab holds its own state, so a Host
   restart can never leave a stale "missing" answer standing for the page. */
async function readJson(url, signal, failed, decode) {
  const response = await fetch(url, { signal })
  if (!response.ok) return failed
  let value
  try {
    value = await response.json()
  } catch {
    return failed
  }
  return decode(value) ?? failed
}

/**
 * Read one announced change summary.
 * @param sessionId - viewed Session.
 * @param seq - the announcing event's sequence.
 * @param signal - cancels the read.
 * @returns the summary, or `'missing'` once the Host no longer serves it (or the read failed).
 */
export function loadChangesSummary(sessionId, seq, signal) {
  return readJson(changesSummaryUrl(sessionId, seq), signal, 'missing',
    value => (isChangesSummary(value) ? value : undefined)).catch((error) => {
    if (error?.name === 'AbortError') throw error
    // A transport failure is the same dead end as a summary the Host no longer has.
    return 'missing'
  })
}

/**
 * Read one listed file's comparison.
 * @param sessionId - viewed Session.
 * @param seq - the announcing event's sequence.
 * @param index - the file's index in the summary.
 * @param signal - cancels the read.
 * @returns the comparison, or the `'missing'` / `'error'` state a retry may replace.
 */
export function loadChangesDiff(sessionId, seq, index, signal) {
  return fetch(changesDiffUrl(sessionId, seq, index), { signal }).then(async (response) => {
    if (response.status === 404) return 'missing'
    if (!response.ok) return 'error'
    let value
    try {
      value = await response.json()
    } catch {
      return 'error'
    }
    return isChangesDiff(value) ? value : 'error'
  }).catch((error) => {
    if (error?.name === 'AbortError') throw error
    return 'error'
  })
}

/* Module-wide open-request bridge: the openResource router publishes one review
   open, and the explorer whose previewSessionId matches the request's
   expectFamily consumes it. An unrelated session's explorer never adopts a
   request aimed at another session, and a mount that arrives later still
   consumes the pending request. */
export const reviewOpenStore = {
  _snapshot: { seq: 0, request: null },
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getSnapshot() { return this._snapshot },
  open(address, index, expectFamily) {
    this._snapshot = {
      seq: this._snapshot.seq + 1,
      request: {
        address: String(address),
        index: Number.isSafeInteger(index) && index >= 0 ? index : 0,
        expectFamily: expectFamily === undefined || expectFamily === null ? null : String(expectFamily),
      },
    }
    for (const listener of [...this._listeners]) listener()
  },
  consume() {
    if (this._snapshot.request === null) return
    this._snapshot = { seq: this._snapshot.seq + 1, request: null }
    for (const listener of [...this._listeners]) listener()
  },
}

/* The review tab's inner split: the file list beside the comparison. The width
   lives in memory for the page — it survives switching preview tabs, sessions,
   and workspaces (each of which remounts the explorer) but is deliberately never
   persisted: a review tab itself does not survive a reload, so a durable width
   would restore a pane nothing could show. */

/**
 * The split's bounds and the width to draw for one container width.
 * @param stored - the user's stored list width.
 * @param bodyWidth - the measured body width, or 0 before the first measure.
 * @returns the separator's min/max and a width always inside them.
 */
export function reviewListBounds(stored, bodyWidth) {
  const measured = Number.isFinite(bodyWidth) && bodyWidth > 0
  /* Before the first measure the stored value must stand as the user left it:
     the fallback ceiling is generous rather than derived from a width of zero. */
  const room = measured ? bodyWidth - REVIEW_DIFF_MIN : REVIEW_LIST_MAX_FALLBACK
  /* `max` never drops below `min`: in too narrow a column the list takes its
     minimum and the comparison scrolls, instead of the clamp inverting. */
  const max = Math.max(REVIEW_LIST_MIN, Math.min(room, REVIEW_LIST_MAX_FALLBACK))
  const requested = Number.isFinite(stored) ? stored : REVIEW_LIST_DEFAULT
  return { min: REVIEW_LIST_MIN, max, width: Math.max(REVIEW_LIST_MIN, Math.min(requested, max)) }
}

/* The split's accessors are plain functions, NOT object methods: the review body
   hands them to React's `useSyncExternalStore` as bare references, where a
   `this`-based accessor would read `this` as undefined and return nothing. */
let splitSnapshot = { width: REVIEW_LIST_DEFAULT }
const splitListeners = new Set()

/**
 * Subscribe to the split width.
 * @param listener - called after every width change.
 * @returns the unsubscribe function.
 */
export function subscribeReviewSplit(listener) {
  splitListeners.add(listener)
  return () => { splitListeners.delete(listener) }
}

/**
 * The current split width snapshot. Stable between changes, as React requires.
 * @returns the snapshot object.
 */
export function readReviewSplit() { return splitSnapshot }

/**
 * Set the split width for every mounted review tab. An unusable value is ignored
 * and an unchanged one notifies nobody, so a same-pixel drag step costs nothing.
 * @param width - the new list width in pixels.
 */
export function setReviewSplitWidth(width) {
  const next = Number.isFinite(width) ? Math.round(width) : splitSnapshot.width
  if (next === splitSnapshot.width) return
  splitSnapshot = { width: next }
  for (const listener of [...splitListeners]) listener()
}
