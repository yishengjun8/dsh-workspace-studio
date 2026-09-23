/* Plan viewer: the body of a `plan` preview tab.
 *
 * Two document sources, matching the two addresses ui-plan publishes:
 * - a temporary review (`dsh-resource://plan-review/…`) carries its Markdown in
 *   the navigation params, kept in plan-open's in-memory map;
 * - a logged plan (`dsh-resource://plan/…`) is read through the harness `plan`
 *   resource provider, so the session-history read stays owned by ui-plan.
 * The tab holds its resource open while it is mounted (the provider ends its
 * stream after the first frame, so this costs nothing beyond the hold).
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { translate } from '../locale/index.js'
import { useMarkdownLabels } from './registry.js'
import { isPlanReviewAddress, normalizePlanDocument, planDocuments, planResourceSource } from '../plan-open.js'

/* One stable snapshot for "no source installed": a fresh object per read would
   make useSyncExternalStore re-render forever. */
const NO_SOURCE = { status: 'none', value: undefined, failure: undefined }

/* A no-op unsubscribe shared by the source-less snapshot. */
const NO_SUBSCRIBE = () => () => {}

/**
 * Render one plan document as Markdown.
 * @param props - the plan address and a title reporter for the tab label.
 * @returns the plan body, or the localized loading / failure / expired state.
 */
export function PlanView({ address, onTitle }) {
  const markdownLabels = useMarkdownLabels()
  const temporaryReview = isPlanReviewAddress(address)
  /* The temporary document is set before the tab is created, so a render-time
     read is enough; a logged plan has no in-memory copy. */
  const temporary = useMemo(() => (temporaryReview ? planDocuments.get(address) : undefined), [address, temporaryReview])
  const source = useMemo(
    () => (temporaryReview ? undefined : planResourceSource(address)),
    [address, temporaryReview],
  )
  const subscribe = useCallback(listener => (source === undefined ? NO_SUBSCRIBE(listener) : source.subscribe(listener)), [source])
  const read = useCallback(() => (source === undefined ? NO_SOURCE : source.getSnapshot()), [source])
  const snapshot = useSyncExternalStore(subscribe, read, read)
  const document = useMemo(
    () => temporary ?? normalizePlanDocument(snapshot.value),
    [temporary, snapshot],
  )
  /* Report the resolved title once so the tab strip shows the plan's heading
     instead of the generic label. The last reported title is remembered here
     as well as in the explorer, so an unstable onTitle prop cannot re-report. */
  const reportedRef = useRef('')
  useEffect(() => {
    if (document === undefined || typeof onTitle !== 'function' || document.title === '') return
    if (reportedRef.current === document.title) return
    reportedRef.current = document.title
    onTitle(document.title)
  }, [document, onTitle])
  if (document === undefined) {
    const text = temporaryReview
      ? translate('plan.expired')
      : source === undefined || snapshot.status === 'failed'
        ? translate('plan.failed')
        : translate('plan.loading')
    return h('div', { className: 'dsh-ws-plan-message', role: 'status' }, text)
  }
  return h(MarkdownText, { labels: markdownLabels, text: document.markdown })
}
