/* Whether a periodic poll should skip this tick.
 *
 * Two independent reasons, shared by every poll here:
 *   - the DOCUMENT is hidden (a background tab must not keep waking up every second to read a store it
 *     cannot show);
 *   - the PANE it feeds is not visible (the user switched preview tabs, so the poll's result would be
 *     discarded on arrival).
 *
 * Skipping is lossless: each poll re-reads from an offset cursor or recomputes from scratch next
 * tick, so the first tick after the tab or pane returns catches up.
 *
 * @param isVisible - optional pane predicate; omit for a poll whose pane is always up while mounted.
 */
export function shouldSkipPoll(isVisible) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true
  return isVisible !== undefined && isVisible() === false
}
