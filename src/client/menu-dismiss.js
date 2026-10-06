/**
 * Whether a capture-phase scroll event must dismiss a floating menu.
 *
 * Every floating menu closes on an outside scroll, so it never floats away from
 * the element it points at. The window listener is capture-phase, so it sees
 * EVERY element's scroll (a scroll event does not bubble, but capture still
 * walks from window down to its target). The conversation writes its own
 * scrollTop on every streamed chunk — the Harness follows its tail and
 * compensates content growth while the reader is scrolled up — so an unfiltered
 * listener closed a menu the user had just opened on the sidebar or the preview
 * pane as soon as the chat produced its next token.
 *
 * A menu is anchored at a point inside ONE region, so only a scrollport that
 * OWNS that anchor — the anchor itself, or an ancestor of it — can move it, and
 * only such a scroll may dismiss it. While no anchor can be named (the region
 * was replaced under an open menu) the test degrades to "any scrollport except
 * the conversation column", keeping the streaming-scroll bug from coming back
 * through a missing anchor.
 */
import { clamp } from './format.js'
import { CONVERSATION_SCROLLPORT_SELECTOR } from './scroll-gate.js'

/* Every floating menu keeps a 4 px gutter from the window edge; the ceiling is floored at the gutter
   so a menu wider/taller than the viewport still starts on screen. */
const MENU_GUTTER = 4

/**
 * Where a floating menu goes: `x`/`y` are the preferred left/top (a click point or an anchor's edge)
 * and `width`/`height` its measured size. One implementation for every menu, so the trailing gutter
 * cannot be forgotten on one caller and kept on another — as it was while this rule was copy-pasted
 * into five call sites.
 */
export function anchorBox(x, y, width, height) {
  return {
    left: clamp(x, MENU_GUTTER, Math.max(MENU_GUTTER, window.innerWidth - width - MENU_GUTTER)),
    top: clamp(y, MENU_GUTTER, Math.max(MENU_GUTTER, window.innerHeight - height - MENU_GUTTER)),
  }
}

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
