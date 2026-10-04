/**
 * Whether a capture-phase scroll event must dismiss a floating menu.
 *
 * Every floating menu in this plugin closes on an outside scroll, so it never
 * floats away from the element it points at. The listener is registered on
 * window in the CAPTURE phase, which sees EVERY element's scroll: a scroll
 * event does not bubble, but the capture phase still walks from window down to
 * its target. The conversation writes its own scrollTop on every streamed chunk
 * (the Harness follows its tail, and compensates content growth while the
 * reader is scrolled up), so an unfiltered listener closed any menu the user
 * had just opened on the sidebar or the preview pane the moment the chat
 * produced its next token.
 *
 * A menu is anchored at a point inside ONE region, so only a scrollport that
 * OWNS that anchor — the anchor itself, or an ancestor of it — can move it, and
 * only such a scroll may dismiss the menu. While no anchor can be named (the
 * region was replaced under an open menu) the same test degrades to "any
 * scrollport except the conversation column", which keeps the streaming-scroll
 * bug from coming back through a missing anchor.
 */
import { CONVERSATION_SCROLLPORT_SELECTOR } from './scroll-gate.js'

/**
 * @param event - the capture-phase scroll event (window listener).
 * @param anchor - the element the open menu points at, or null when unknown.
 * @returns whether the menu must close.
 */
export function dismissesMenuOnScroll(event, anchor) {
  const target = event.target
  /* A document-level scroll (or a synthetic event with no element target) moves
     every fixed-position anchor: always dismiss. */
  if (!(target instanceof Element)) return true
  if (anchor instanceof Element) {
    /* The anchor left the document (view switch, region remount): the menu has
       nothing left to point at. */
    if (!anchor.isConnected) return true
    return target.contains(anchor)
  }
  /* No anchor: ignore the conversation's own scrolling (see the header) and keep
     dismissing on every other scrollport. */
  return target.closest(CONVERSATION_SCROLLPORT_SELECTOR) === null
}
