/** Think-card behavior: keeps every Think block open as a card so the harness
 *  renders its body, scroll-pins the viewport to the newest text while the
 *  block streams, and never force-reopens a row the user collapsed. */
import { useEffect, useRef } from 'react'
import { CONVERSATION_SCROLLPORT_SELECTOR, installScrollGate } from '../scroll-gate.js'

/* The body class may be hashed, so match the "thinkBody" substring. */
const THINK_BODY_SELECTOR = '[class*="thinkBody"]'
/* Scroll positions within this many px of the bottom count as "at bottom". */
const THINK_BOTTOM_TOLERANCE_PX = 4
/* An upward scroll must clear this far from the bottom before pin-tracking stops. */
const THINK_UNPIN_DISTANCE_PX = 8

export function useThinkCard({ chatSectionRef }) {
  /* Think roots the user has interacted with are never force-opened again. */
  const userInteractedRef = useRef(new WeakSet())
  /* Per think root, the attached body tracker: { body, observer, resize, onScroll, pinned }. */
  const trackersRef = useRef(new Map())
  useEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    const userInteracted = userInteractedRef.current
    const trackers = trackersRef.current
    /* Think roots whose disclosure row had not rendered yet are retried on every later mutation batch. */
    const pendingRoots = new Set()
    // Flag programmatic row clicks so the listener below ignores this hook's own clicks.
    let programmatic = false
    const rowOf = root => root.querySelector(':scope [data-disclosure-row]')
    const bodyOf = root => root.querySelector(THINK_BODY_SELECTOR)
    const clickRow = row => {
      programmatic = true
      try { row.click() } finally { programmatic = false }
    }
    const openRow = root => {
      if (userInteracted.has(root)) return
      const row = rowOf(root)
      if (row === null) {
        pendingRoots.add(root)
        return
      }
      pendingRoots.delete(root)
      if (row.getAttribute('aria-expanded') === 'true') return
      clickRow(row)
    }
    const attachTracker = (root, body) => {
      if (trackers.has(root)) return
      const pinned = { value: true }
      const pinSoon = () => {
        // Pin on the next frame so scrollHeight is final for this update.
        requestAnimationFrame(() => {
          if (pinned.value && body.isConnected) body.scrollTop = body.scrollHeight
        })
      }
      const onScroll = () => {
        const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - THINK_BOTTOM_TOLERANCE_PX
        if (atBottom) { pinned.value = true; return }
        if (body.scrollTop < body.scrollHeight - body.clientHeight - THINK_UNPIN_DISTANCE_PX) pinned.value = false
      }
      /* The ResizeObserver also catches external reflows (column resize, font change) that no text mutation accompanies. */
      const observer = new MutationObserver(pinSoon)
      observer.observe(body, { childList: true, characterData: true, subtree: true })
      const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(pinSoon) : null
      resize?.observe(body)
      body.addEventListener('scroll', onScroll)
      /* Hovering alone must not scroll the card body — wheel is forwarded to the conversation until the user clicks inside. */
      const gate = installScrollGate({
        card: root,
        viewport: body,
        outer: () => section.querySelector(CONVERSATION_SCROLLPORT_SELECTOR),
      })
      trackers.set(root, { body, observer, resize, onScroll, pinned, gate })
      pinSoon()
    }
    const detachTracker = root => {
      const tracker = trackers.get(root)
      if (tracker === undefined) return
      tracker.observer.disconnect()
      tracker.resize?.disconnect()
      tracker.body.removeEventListener('scroll', tracker.onScroll)
      tracker.gate()
      trackers.delete(root)
    }
    const detachTrackerForBody = body => {
      for (const [root, tracker] of [...trackers]) {
        if (tracker.body === body) { detachTracker(root); return }
      }
    }
    // Any user interaction with a Think block takes ownership: it is never force-opened again.
    const onSectionClick = event => {
      if (programmatic) return
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      userInteracted.add(root)
    }
    const onSectionKeyDown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      userInteracted.add(root)
    }
    section.addEventListener('click', onSectionClick, true)
    section.addEventListener('keydown', onSectionKeyDown, true)
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches?.('[data-variant="think"]')) openRow(node)
          else {
            for (const root of node.querySelectorAll?.('[data-variant="think"]') ?? []) openRow(root)
          }
          if (node.matches?.(THINK_BODY_SELECTOR)) {
            const root = node.closest?.('[data-variant="think"]')
            if (root !== null && root !== undefined) attachTracker(root, node)
          } else {
            for (const body of node.querySelectorAll?.(THINK_BODY_SELECTOR) ?? []) {
              const root = body.closest?.('[data-variant="think"]')
              if (root !== null && root !== undefined) attachTracker(root, body)
            }
          }
        }
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches?.(THINK_BODY_SELECTOR)) { detachTrackerForBody(node); continue }
          for (const body of node.querySelectorAll?.(THINK_BODY_SELECTOR) ?? []) detachTrackerForBody(body)
        }
      }
      /* Retry parked roots on every mutation batch. */
      for (const root of [...pendingRoots]) {
        if (!root.isConnected) { pendingRoots.delete(root); continue }
        openRow(root)
      }
      /* Drop trackers whose body or root left the DOM. */
      for (const [root, tracker] of [...trackers]) {
        if (!tracker.body.isConnected || !root.isConnected) detachTracker(root)
      }
    })
    observer.observe(section, { childList: true, subtree: true })
    /* Catch blocks already present when the observer attached. */
    for (const root of section.querySelectorAll('[data-variant="think"]')) {
      openRow(root)
      const body = bodyOf(root)
      if (body !== null) attachTracker(root, body)
    }
    return () => {
      observer.disconnect()
      section.removeEventListener('click', onSectionClick, true)
      section.removeEventListener('keydown', onSectionKeyDown, true)
      for (const tracker of trackers.values()) {
        tracker.observer.disconnect()
        tracker.resize?.disconnect()
        tracker.body.removeEventListener('scroll', tracker.onScroll)
        tracker.gate()
      }
      trackers.clear()
    }
  }, [chatSectionRef])
}
