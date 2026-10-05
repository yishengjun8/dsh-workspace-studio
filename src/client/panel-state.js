/* The one "this whole panel has nothing to show" message: a sentence, an optional error tone, and an
 * optional action button.
 *
 * Five places had grown their own copy of this shape — the image / PDF-Office / read-only-browse renderers
 * (which shared `renderers/status.js`), the plan tab, the change-review tab, the token panel's state box,
 * and the preview / search failure cards. The pieces that must not drift are the `data-error` marker, the
 * `role` (a `status` region is announced — that is the point of the plan/review sentences), and the retry
 * affordance.
 *
 * The props are the three axes the five sites genuinely differ on, and nothing more:
 *   - `className` — each place styles its message differently (a card, a centred sentence, a boxed state);
 *     collapsing the classes would be a redesign that needs a visual check, not a refactor;
 *   - `layout` — `'plain'` puts the message in the panel (and, with a retry, into a `${className}-stack`
 *     so a tall message keeps its button below it); `'inline'` renders the message as a span with the
 *     action beside it;
 *   - `retryClassName` — the renderer area styles its own retry button; everything else uses the generic
 *     text button.
 *
 * Every call site reproduces the DOM it had before, so adopting this component changes nothing visually.
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
