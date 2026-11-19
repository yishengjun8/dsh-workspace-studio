/* The one status line every renderer view draws: a failure line with a `data-error` marker (plus the
 * converted view's retry button) and a loading placeholder, kept in one place so marker, classes and
 * retry affordance cannot drift. A PRESET over the shared panel message (panel-state.js), not a
 * second implementation: the renderer family is the only one with its own class pair, so the three
 * views stay aligned.
 */
import { createElement as h } from 'react'
import { PanelState } from '../panel-state.js'

/**
 * @param message - already localized copy.
 * @param error - draw the error tone (`data-error`).
 * @param onRetry - when given, the line also offers the retry button (manual re-conversion).
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
