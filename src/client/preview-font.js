/* Preview text size: the one place where the two components that own it talk to each other.
 *
 * The per-tab size belongs to the file header (inside the explorer), while the base size and its
 * "clear every tab's own value" action belong to the settings page — a slot contribution mounted
 * in a completely different part of the tree, with no shared parent to thread a callback through.
 * The explorer registers one handler while it is mounted; the settings page calls it. No state
 * lives here (the handler clears the caller's own tab state), so nothing has to be kept in sync.
 *
 * Deliberately one handler per mounted explorer: a session switch remounts the explorer, whose
 * cleanup unregisters the previous one, so a stale mount can never be asked to clear its tabs.
 */
const handlers = new Set()

/** Register the explorer's "clear every tab's own size" handler. Returns its unsubscribe. */
export function registerPreviewFontReset(handler) {
  handlers.add(handler)
  return () => { handlers.delete(handler) }
}

/** Ask every mounted explorer to drop its tabs' own sizes (each falls back to the base size). */
export function clearPreviewFontOverrides() {
  for (const handler of handlers) handler()
}
