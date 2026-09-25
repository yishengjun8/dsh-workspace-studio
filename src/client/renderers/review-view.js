/* Change-review viewer: the body of a `review` preview tab.
 *
 * One turn's changed files behind a file list, with the selected file's
 * turn-start and turn-end comparison drawn as a unified diff. Both reads come
 * from the Host routes ui-deliverables serves (the summary and one file's
 * comparison) through `changes-review.js`; this module only draws them. The tab
 * is session-only: the review lives while the turn's Session does, so nothing
 * here is persisted, and a closed tab simply reads again when reopened.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { translate } from '../locale/index.js'
import { cappedHunks, hunkHeader, hunkRows, loadChangesDiff, loadChangesSummary, MAX_RENDERED_LINES, parseChangesReviewAddress, readReviewSplit, resolveReviewFilePath, reviewListBounds, setReviewSplitWidth, subscribeReviewSplit } from '../changes-review.js'
import { requestFileOpen } from '../open-resource.js'
import { ResizeHandle } from '../components/menus.js'

/* One line's worth of chrome: `add` / `del` / `context` map to the same CSS class suffix. */
function DiffLine({ row }) {
  return h('div', { className: `dsh-ws-review-line dsh-ws-review-line-${row.kind}` },
    h('span', { className: 'dsh-ws-review-number' }, row.old ?? ''),
    h('span', { className: 'dsh-ws-review-number' }, row.new ?? ''),
    h('span', { className: 'dsh-ws-review-sign' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '),
    h('span', { className: 'dsh-ws-review-text' }, row.text))
}

/* Added / deleted counts, or the label that stands in for them. */
function Counts({ file }) {
  if (file.binary === true) return h('span', { className: 'dsh-ws-review-label' }, translate('review.binary'))
  if (file.oversized === true) return h('span', { className: 'dsh-ws-review-label' }, translate('review.oversized'))
  return h('span', { className: 'dsh-ws-review-counts' },
    h('span', { className: 'dsh-ws-review-added' }, translate('review.addedCount', { count: String(file.added) })),
    h('span', { className: 'dsh-ws-review-deleted' }, translate('review.deletedCount', { count: String(file.deleted) })))
}

/* One status sentence, optionally with a retry. */
function Message({ text, role, retry, retryLabel }) {
  return h('div', { className: 'dsh-ws-review-message', role: role ?? undefined },
    h('span', null, text),
    retry === undefined ? null : h('button', { type: 'button', className: 'dsh-ws-text-button', onClick: retry }, retryLabel))
}

/* The one-line fact about a text comparison worth stating above its hunks, if any. */
function noteOf(diff) {
  if (!diff.before) return 'review.created'
  if (!diff.after) return 'review.deletedFile'
  if (diff.hunks.length === 0) return 'review.unchanged'
  return undefined
}

/* The comparison itself: notes, hunk headers, and numbered lines. */
function DiffBody({ diff, onRetry }) {
  if (diff === undefined || diff === 'loading') return h(Message, { text: translate('review.loading'), role: 'status' })
  if (diff === 'missing') return h(Message, { text: translate('review.missing') })
  if (diff === 'error') return h(Message, { text: translate('review.error'), retry: onRetry, retryLabel: translate('review.retry') })
  if (diff.kind === 'binary') return h(Message, { text: translate('review.binary') })
  if (diff.kind === 'oversized') return h(Message, { text: translate('review.oversized') })
  const { hunks, truncated } = cappedHunks(diff.hunks)
  const note = noteOf(diff)
  return h('div', { className: 'dsh-ws-review-diff-body' },
    note === undefined ? null : h('p', { className: 'dsh-ws-review-note' }, translate(note)),
    diff.coarse ? h('p', { className: 'dsh-ws-review-note' }, translate('review.coarse')) : null,
    truncated ? h('p', { className: 'dsh-ws-review-note' }, translate('review.truncated', { count: String(MAX_RENDERED_LINES) })) : null,
    hunks.map((hunk, position) => h('section', { className: 'dsh-ws-review-hunk', key: position },
      h('div', { className: 'dsh-ws-review-hunk-header' }, hunkHeader(hunk)),
      hunkRows(hunk).map((row, at) => h(DiffLine, { key: at, row })))))
}

/**
 * Render one turn's changed files with the selected file's comparison.
 * @param props - the review address, the file index a navigation asked for, its
 * revision, and the workspace context the open action needs.
 * @returns the review body.
 */
export function ReviewView({ address, initialIndex, navSeq, workspace, sessionCwdOf }) {
  const coordinates = useMemo(() => parseChangesReviewAddress(address), [address])
  const sessionId = coordinates?.sessionId
  const seq = coordinates?.seq
  const [summary, setSummary] = useState('loading')
  const [index, setIndex] = useState(initialIndex)
  const [diffReload, setDiffReload] = useState(0)
  const [diff, setDiff] = useState('loading')
  /* A navigation onto this tab (the chat's card clicked on another row) re-seeds
     the selection; the tab itself keeps its state between navigations. */
  useEffect(() => { setIndex(initialIndex) }, [initialIndex, navSeq])
  useEffect(() => {
    if (sessionId === undefined || seq === undefined) return undefined
    const controller = new AbortController()
    setSummary('loading')
    loadChangesSummary(sessionId, seq, controller.signal).then((state) => {
      // An aborted read must not publish: the tab was closed or re-navigated.
      if (!controller.signal.aborted) setSummary(state)
    }, () => {})
    return () => { controller.abort() }
  }, [sessionId, seq])
  const files = typeof summary === 'object' && summary !== null ? summary.files : null
  /* A navigated index the summary does not list falls back to the first file. */
  const selected = files !== null && files[index] !== undefined ? index : 0
  const file = files === null ? undefined : files[selected]
  const diffKey = file === undefined ? null : selected
  useEffect(() => {
    if (sessionId === undefined || seq === undefined || diffKey === null) return undefined
    const controller = new AbortController()
    setDiff('loading')
    loadChangesDiff(sessionId, seq, diffKey, controller.signal).then((state) => {
      if (!controller.signal.aborted) setDiff(state)
    }, () => {})
    return () => { controller.abort() }
  }, [sessionId, seq, diffKey, diffReload])
  /* The inner split's container width drives its clamp; it is measured rather
     than assumed, because the preview column is itself user-resizable. The body
     only exists once the summary is in hand, so `files` is the mount signal. */
  const bodyRef = useRef(null)
  const [bodyWidth, setBodyWidth] = useState(0)
  const splitStored = useSyncExternalStore(subscribeReviewSplit, readReviewSplit).width
  const [splitDragging, setSplitDragging] = useState(false)
  const bodyMounted = files !== null
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null) return undefined
    const measure = () => { setBodyWidth(body.getBoundingClientRect().width) }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(body)
    return () => { observer.disconnect() }
  }, [bodyMounted])
  const split = reviewListBounds(splitStored, bodyWidth)
  const cwd = sessionId === undefined || typeof sessionCwdOf !== 'function' ? undefined : sessionCwdOf(sessionId)
  const openTarget = file === undefined ? undefined : resolveReviewFilePath(cwd, file.path)
  const openFile = useCallback(() => {
    if (file === undefined || openTarget === undefined || workspace === undefined) return
    requestFileOpen(workspace.workspaceId, workspace.path, openTarget, openTarget.slice(openTarget.lastIndexOf('/') + 1), undefined)
  }, [file, openTarget, workspace])
  const summaryState = summary === 'loading' ? 'loading' : summary === 'missing' ? 'missing' : 'ready'
  return h('div', { className: 'dsh-ws-review', 'data-changes-review': true, 'data-review-state': summaryState },
    h('div', { className: 'dsh-ws-review-header' },
      h('span', { className: 'dsh-ws-review-title' }, coordinates === undefined
        ? translate('review.error')
        : translate('review.tabName', { turn: String(coordinates.turn) })),
      file === undefined ? null : h('span', { className: 'dsh-ws-review-path', title: file.display }, file.display),
      file === undefined ? null : h(Counts, { file }),
      h('span', { className: 'dsh-ws-review-spacer' }),
      file === undefined || workspace === undefined
        ? null
        : h('button', {
          type: 'button',
          className: 'dsh-ws-text-button',
          disabled: openTarget === undefined || undefined,
          title: openTarget === undefined ? translate('review.openFileUnavailable') : translate('review.openFileAria', { name: file.display }),
          onClick: openFile,
        }, translate('review.openFile'))),
    coordinates === undefined
      ? h(Message, { text: translate('review.error') })
      : summary === 'loading'
        ? h(Message, { text: translate('review.loading'), role: 'status' })
        : summary === 'missing'
          ? h(Message, { text: translate('review.missing') })
          : h('div', {
            className: 'dsh-ws-review-body',
            ref: bodyRef,
            'data-resizing': splitDragging || undefined,
            style: { '--dsh-ws-review-list': `${split.width}px` },
          },
            h('div', { className: 'dsh-ws-review-list', role: 'listbox', 'aria-label': translate('review.selectFile') },
              files.map((entry, at) => h('button', {
                type: 'button',
                key: `${at}:${entry.path}`,
                role: 'option',
                'aria-selected': at === selected,
                className: 'dsh-ws-review-row',
                'data-active': at === selected || undefined,
                'data-changes-file': entry.path,
                title: entry.display,
                onClick: () => { setIndex(at) },
              }, h('span', { className: 'dsh-ws-review-row-path' }, entry.display), h(Counts, { file: entry })))),
            /* The list/comparison separator: one in-memory width shared by every
               mounted review tab, so a drag follows into any other review tab. */
            h(ResizeHandle, {
              label: translate('resize.reviewList'),
              left: split.width,
              value: split.width,
              min: split.min,
              max: split.max,
              onResize: width => { setReviewSplitWidth(width) },
              onDragging: setSplitDragging,
            }),
            /* A listed file drives the comparison pane: an empty summary (the card
               is not drawn for one) leaves the pane blank rather than loading. */
            h('div', { className: 'dsh-ws-review-diff' },
              file === undefined ? null : h(DiffBody, { diff, onRetry: () => { setDiffReload(value => value + 1) } }))))
}
