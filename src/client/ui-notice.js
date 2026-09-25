/* Module-wide transient notice for interactions the router cannot complete.
 *
 * The openResource router hands addresses of types this layout does not host
 * back to the harness, whose implementation requires the right-Sidebar seat and
 * therefore fails. That failure used to be an uncaught throw inside a React
 * event handler — a console error and a dead click. The router now publishes one
 * notice here instead, and the frame renders it in the corner.
 */

/* How long one notice stays on screen. */
const NOTICE_MS = 6000

let snapshot = null
let timer = 0
const listeners = new Set()

function publish() {
  for (const listener of [...listeners]) listener()
}

export const resourceNoticeStore = {
  subscribe(listener) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot() { return snapshot },
}

/**
 * Show one transient notice.
 * @param text - already-localized text.
 */
export function showResourceNotice(text) {
  snapshot = { error: false, text: String(text ?? '') }
  if (timer !== 0) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = 0
    snapshot = null
    publish()
  }, NOTICE_MS)
  publish()
}
