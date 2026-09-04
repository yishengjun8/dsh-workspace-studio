/** Chat tail-pin compensation (DOM-driven; the harness is not modified).
 *
 *  The harness (ui-chat ChatView) restores the resident conversation
 *  scrollport per session from an in-memory absolute position (anchor row +
 *  offset) and arms its "follow the tail" ownership (atBottomRef) from scroll
 *  samples. Under its restore races — anchor row not yet rendered when the
 *  one-shot restore runs, clamp-corrected scrollTop on the resident scroller
 *  across session switches, and the Think cards reopening (height churn) right
 *  after a ChatView remount — the restored viewport can land above the true
 *  tail and no scroll sample ever re-arms the ownership, so the position
 *  stays stuck off the end.
 *
 *  This hook tracks whether the user was at the tail when they last left each
 *  session (geometry samples from scroll events; the harness's own toBottom
 *  writes fire events, so passive watching keeps the flag true) and, on
 *  returning to a tail-left session, runs a short settle-pin loop that drags
 *  the viewport to the actual floor and stops once the flow height
 *  stabilizes (or the user scrolls). Our first write lands the viewport at
 *  the floor; the harness's next scroll sample then normalizes its own
 *  at-bottom ownership from the geometry, so later streaming follows again. */
import { useEffect, useRef } from 'react'

/* Same tolerance the harness uses to decide "at bottom" (FOLLOW_THRESHOLD). */
const TAIL_THRESHOLD_PX = 24
/* Stop re-pinning after this many consecutive frames with a stable flow
   height (the harness's own follow machinery takes over from then on). */
const SETTLE_FRAMES = 2
/* Hard cap for the settle window; content still moving after this is left to
   the harness's follow machinery (re-armed by our first write). */
const SETTLE_TIMEOUT_MS = 800
const SCROLLPORT_SELECTOR = '[data-conversation-scroll]'

export function useChatTailPin({ chatSectionRef, currentSession }) {
  const sectionRef = chatSectionRef
  const currentSessionRef = useRef(currentSession)
  currentSessionRef.current = currentSession
  /* Per-session "user was at the tail when they last left" flags. */
  const tailPinnedRef = useRef(new Map())
  const scrollportRef = useRef(null)
  const userAbortRef = useRef(false)

  /* Finder + scroll/gate listeners stay mounted across session switches. */
  useEffect(() => {
    const section = sectionRef.current
    if (section === null) return undefined
    const tailPinned = tailPinnedRef.current
    const nearBottom = (el) => (
      el.scrollHeight - el.scrollTop - el.clientHeight <= TAIL_THRESHOLD_PX
    )
    const onScroll = () => {
      const el = scrollportRef.current
      const id = currentSessionRef.current
      if (el === null || id === undefined) return
      const pinned = nearBottom(el)
      const key = String(id)
      tailPinned.set(key, pinned)
    }
    let attached = null
    const attach = (el) => {
      if (attached === el) return
      if (attached !== null) attached.removeEventListener('scroll', onScroll)
      el.addEventListener('scroll', onScroll)
      attached = el
    }
    const sample = () => {
      const el = section.querySelector(SCROLLPORT_SELECTOR)
      if (el === null) return
      scrollportRef.current = el
      attach(el)
    }
    sample()
    /* The conversation may mount a frame after the plugin boots; retry on
       every section mutation until the scrollport exists. */
    const observer = new MutationObserver(() => {
      const current = scrollportRef.current
      if (current !== null && current.isConnected) return
      sample()
    })
    observer.observe(section, { childList: true, subtree: true })
    /* User-gesture latch: any wheel/pointer/touch/keyboard scroll aborts a
       running settle-pin loop on its next frame. */
    const abort = () => { userAbortRef.current = true }
    document.addEventListener('wheel', abort, true)
    document.addEventListener('pointerdown', abort, true)
    document.addEventListener('touchstart', abort, true)
    document.addEventListener('keydown', abort, true)
    return () => {
      observer.disconnect()
      if (attached !== null) attached.removeEventListener('scroll', onScroll)
      document.removeEventListener('wheel', abort, true)
      document.removeEventListener('pointerdown', abort, true)
      document.removeEventListener('touchstart', abort, true)
      document.removeEventListener('keydown', abort, true)
    }
  }, [sectionRef])

  /* Returning to a session the user left at the tail: settle-pin the
     viewport to the real floor until the flow height stabilizes. */
  useEffect(() => {
    if (currentSession === undefined) return undefined
    const key = String(currentSession)
    if (tailPinnedRef.current.get(key) !== true) return undefined
    const el = sectionRef.current?.querySelector(SCROLLPORT_SELECTOR) ?? null
    if (el === null) return undefined
    scrollportRef.current = el
    userAbortRef.current = false
    let lastHeight = -1
    let stable = 0
    let rafId = 0
    let timerId = 0
    const startedAt = Date.now()
    const tick = () => {
      if (userAbortRef.current) return
      if (Date.now() - startedAt > SETTLE_TIMEOUT_MS) return
      el.scrollTop = el.scrollHeight
      const height = el.scrollHeight
      stable = height === lastHeight ? stable + 1 : 0
      lastHeight = height
      if (stable >= SETTLE_FRAMES) return
      if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick)
      else timerId = window.setTimeout(tick, 16)
    }
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick)
    else timerId = window.setTimeout(tick, 16)
    return () => {
      if (rafId !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      if (timerId !== 0) window.clearTimeout(timerId)
    }
  }, [currentSession, sectionRef])
}
