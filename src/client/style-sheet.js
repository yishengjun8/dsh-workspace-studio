/* One lazily-created `<style id>` in the document head, written only when its text actually changes.
 *
 * Four properties matter, and getting one wrong is silent:
 *   - create on first use, in <head>;
 *   - REUSE an element a previous install left behind (a remount must not stack sheets);
 *   - write nothing when the decision did not change (the sidebar re-renders on every poll);
 *   - remove it on dispose, so a disabled feature stops hiding rows immediately.
 *
 * Compared against the live `textContent`, not a cached copy: an outside rewrite is still noticed.
 */
export function createStyleSheet(id) {
  const resolve = () => {
    let node = document.getElementById(id)
    if (node === null) {
      node = document.createElement('style')
      node.id = id
      document.head.append(node)
    }
    return node
  }
  return {
    /** Publish `css` (an identical sheet writes nothing). */
    publish(css) {
      const node = resolve()
      if (node.textContent !== css) node.textContent = css
    },
    /** Remove the sheet; a later publish re-creates it. */
    dispose() {
      document.getElementById(id)?.remove()
    },
  }
}
