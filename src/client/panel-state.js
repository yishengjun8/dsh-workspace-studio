/* The one "this whole panel has nothing to show" message: a sentence, an optional error tone, and an
 * optional action button.
 *
 * The pieces that must not drift are the `data-error` marker, the `role` (a `status` region is
 * announced — the point of the plan/review sentences) and the retry affordance.
 *
 * `className` stays per site: each place styles its message differently (card, centred sentence,
 * boxed state) and collapsing the classes would be a redesign needing a visual check, not a
 * refactor. `'plain'` layout with a retry wraps message and button in a `${className}-stack` so a tall
 * message keeps its button below; `'inline'` renders the message as a span with the action beside
 * it. `retryClassName` exists because the renderer area styles its own retry button.
 */
import { createElement as h } from 'react'

/**
 * @param message - already localized copy.
 * @param className - the site's styling hook.
 * @param layout - `'plain'` (default) or `'inline'`.
 * @param error - draw the error tone (`data-error`); the class usually carries the rest.
 * @param role - ARIA role for the region.
 * @param retry - when given, the panel also offers the action button.
 * @param retryLabel - its localized label.
 * @param retryClassName - the action button's class (defaults to the generic text button).
 */
export function PanelState({
  message,
  className,
  layout = 'plain',
  error = false,
  role,
  retry,
  retryLabel,
  retryClassName = 'dsh-ws-text-button',
}) {
  const attributes = {
    className,
    ...(role === undefined ? {} : { role }),
    ...(error ? { 'data-error': '' } : {}),
  }
  const button = retry === undefined
    ? null
    : h('button', { className: retryClassName, onClick: retry, type: 'button' }, retryLabel)
  if (layout === 'inline') return h('div', attributes, h('span', null, message), button)
  if (button === null) return h('div', attributes, message)
  return h('div', attributes, h('div', { className: `${className}-stack` }, h('div', null, message), button))
}
