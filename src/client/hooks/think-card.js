/** Think-card behavior: every Think block stays open as a card so the harness
 *  renders its body (the expanded content `.thinkBody` only exists while the
 *  disclosure row is open — the component's open state is internal React
 *  state, and CSS cannot force it). The card body viewport is limited to the
 *  latest --dsh-ws-think-lines rows by injected CSS; this hook additionally
 *  keeps the viewport scroll-pinned to the newest text while the block
 *  streams, so the "latest ten lines" stay visible without user action.
 *  User interaction owns a block: a row the user collapsed (click/keyboard)
 *  is never force-reopened, matching the pre-card auto-disclosure contract. */
import { useEffect, useRef } from 'react'
import { CONVERSATION_SCROLLPORT_SELECTOR, installScrollGate } from '../scroll-gate.js'

/* The body class is a CSS-module name (may be hashed in the bundle), so body
   detection matches the "thinkBody" substring, not the exact class. */
const THINK_BODY_SELECTOR = '[class*="thinkBody"]'
/* Scroll positions within this many px of the bottom count as "at bottom". */
const THINK_BOTTOM_TOLERANCE_PX = 4
/* An upward scroll must clear at least this far from the bottom before
   pin-tracking stops (a hair of scroll must not fight the user). */
const THINK_UNPIN_DISTANCE_PX = 8

export function useThinkCard({ chatSectionRef }) {
  /* Think roots the user has interacted with: those are never force-opened
     again. Persists across effect re-runs (a re-mount must not forget). */
  const userInteractedRef = useRef(new WeakSet())
  /* Per think root, the attached body tracker: { body, observer, resize,
     onScroll, pinned }. A root has at most one live body at a time (the
     harness unmounts and remounts it on collapse/reopen). */
  const trackersRef = useRef(new Map())
  useEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    const userInteracted = userInteractedRef.current
    const trackers = trackersRef.current
    /* Think roots whose disclosure row had not rendered yet when the root was
       seen (the row usually lands one frame after the root): retried on every
       later mutation batch. */
    const pendingRoots = new Set()
    // Flag programmatic row clicks so the interaction listener below does not
    // treat this hook's own clicks as user interaction.
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
        // Layout is not necessarily flushed inside the mutation callback;
        // pin on the next frame so scrollHeight is final for this update.
        requestAnimationFrame(() => {
          if (pinned.value && body.isConnected) body.scrollTop = body.scrollHeight
        })
      }
      const onScroll = () => {
        const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - THINK_BOTTOM_TOLERANCE_PX
        if (atBottom) { pinned.value = true; return }
        if (body.scrollTop < body.scrollHeight - body.clientHeight - THINK_UNPIN_DISTANCE_PX) pinned.value = false
      }
      /* Streaming appends and long-line wraps change the body's text and
         height; the ResizeObserver also catches external reflows (column
         resize, font change) that no text mutation accompanies. */
      const observer = new MutationObserver(pinSoon)
      observer.observe(body, { childList: true, characterData: true, subtree: true })
      const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(pinSoon) : null
      resize?.observe(body)
      body.addEventListener('scroll', onScroll)
      /* Scroll gating: hovering alone must not scroll the card body — wheel
         is forwarded to the conversation until the user clicks inside. */
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
    // Any user interaction with a Think block takes ownership of it: it is
    // never force-opened again by this behavior.
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
      /* Drop trackers whose body is gone (collapse unmounts the body while
         the root stays) or whose root left the DOM entirely (session switch
         or conversation reset — no mutation lands inside the old subtree). */
      for (const [root, tracker] of [...trackers]) {
        if (!tracker.body.isConnected || !root.isConnected) detachTracker(root)
      }
    })
    observer.observe(section, { childList: true, subtree: true })
    /* Catch the blocks already present when the observer attached: every
       Think block becomes a card (running or finished alike), and expanded
       blocks get their body tracker attached. */
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
