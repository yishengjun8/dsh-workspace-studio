/** Scroll gating for card viewports (Think-card body, edit-card diff/io
 *  bodies): while the card is not "armed" (no click inside its viewport yet),
 *  wheel events are forwarded to the conversation scrollport, so hovering
 *  alone never scrolls the card. A click inside the viewport arms the card;
 *  any click outside disarms it. The armed state is published as a
 *  data-scroll-armed attribute for a light visual cue. */
export const CONVERSATION_SCROLLPORT_SELECTOR = '[data-conversation-scroll]'

/* Firefox wheel events report deltaMode 1 (lines); approximate a line as 16 px. */
const WHEEL_LINE_PX = 16

export function installScrollGate({ card, viewport, outer }) {
  let armed = false
  const setArmed = (value) => {
    if (armed === value) return
    armed = value
    if (value) card.setAttribute('data-scroll-armed', '')
    else card.removeAttribute('data-scroll-armed')
  }
  const outerOf = () => (typeof outer === 'function' ? outer() : outer) ?? null
  /* Capture on the card: wheel over any scrollable descendant is gated as one unit. */
  const onWheel = (event) => {
    if (armed) return
    event.preventDefault()
    const el = outerOf()
    if (el === null) return
    const dy = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY
    el.scrollTop += dy
  }
  const onViewportClick = () => { setArmed(true) }
  const onDocumentClick = (event) => {
    if (!(event.target instanceof Node) || !viewport.contains(event.target)) setArmed(false)
  }
  card.addEventListener('wheel', onWheel, { capture: true, passive: false })
  viewport.addEventListener('click', onViewportClick)
  document.addEventListener('click', onDocumentClick, true)
  return () => {
    card.removeEventListener('wheel', onWheel, { capture: true })
    viewport.removeEventListener('click', onViewportClick)
    document.removeEventListener('click', onDocumentClick, true)
    setArmed(false)
  }
}
