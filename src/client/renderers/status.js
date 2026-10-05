/* The one status line every renderer view draws.
 *
 * The image, PDF/Office and read-only browse views each copied the same two blocks: a failure line
 * with a `data-error` marker (plus a retry button on the converted view) and a loading placeholder.
 * They live here once so the marker, the classes and the retry affordance cannot drift between views.
 *
 * A PRESET over the shared panel message (panel-state.js), not a second implementation: the renderer
 * family is the only place with its own class pair, and pinning it here is what keeps the three views
 * from drifting apart.
 */
import { createElement as h } from 'react'
import { PanelState } from '../panel-state.js'

/**
 * @param message - already localized copy.
 * @param error - draw the error tone (`data-error`).
 * @param onRetry - when given, the line also offers the retry button (the converted view's manual
 *   re-conversion).
 * @param retryLabel - its localized label.
 */
export function RendererStatus({ message, error = false, onRetry, retryLabel }) {
  return h(PanelState, {
    className: 'dsh-ws-renderer-status',
    error,
    message,
    retry: onRetry,
    retryClassName: 'dsh-ws-renderer-retry',
    retryLabel,
  })
}
