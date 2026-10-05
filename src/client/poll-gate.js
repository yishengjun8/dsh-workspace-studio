/* Whether a periodic poll should skip this tick.
 *
 * Two independent reasons, and every poll in this client shares both:
 *   - the DOCUMENT is hidden (a background tab must not keep waking up every second to read a store it
 *     cannot show);
 *   - the PANE it feeds is not visible (the user switched preview tabs, so the poll's result would be
 *     discarded on arrival).
 *
 * The explorer's VCS hook had spelled both checks out inline while the other five periodic polls
 * (collection grouping, auto-sync, run console, mind-map index, mind-map sync) had neither. Skipping is
 * always lossless for these polls: each either re-reads from an offset cursor or recomputes from
 * scratch on the next tick, so the first tick after the tab or pane comes back catches up.
 *
 * @param isVisible - optional predicate for the pane check; omit for a poll whose pane is always up
 *   while it is mounted.
 */
export function shouldSkipPoll(isVisible) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true
  return isVisible !== undefined && isVisible() === false
}
