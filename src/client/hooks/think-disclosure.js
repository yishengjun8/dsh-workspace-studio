/** Think-block disclosure auto behavior: a streaming block (data-state
 *  "running") opens once and auto-collapses shortly after finishing; user
 *  interaction wins (a collapsed running block is not re-opened, a click or
 *  keypress cancels a pending auto-collapse, manually opened rows are never
 *  auto-collapsed). */
import { useEffect, useRef } from 'react'
import { AUTO_EXPAND_THINK_DEFAULT, THINK_COLLAPSE_DELAY_DEFAULT_S, THINK_COLLAPSE_DELAY_MAX_S, THINK_COLLAPSE_DELAY_MIN_S } from '../constants.js'

export function useThinkDisclosure({ chatSectionRef, autoExpandThink, thinkCollapseDelay }) {
  /* Roots this behavior has already seen persist across effect re-runs (the
     delay slider / feature toggle change the deps): re-mounting must not
     re-open a running block the user already collapsed, only genuinely new
     blocks. */
  const thinkAutoOpenedKnownRef = useRef(new WeakSet())
  /* Which running blocks THIS behavior auto-opened — persisted across effect
     re-runs (a delay-slider change re-creates autoOpened otherwise, and a block
     auto-opened before the re-run would never be auto-collapsed when it ends:
     the `state === 'ok' && autoOpened.has(root)` check would miss it). */
  const thinkAutoOpenedRef = useRef(new WeakSet())
  useEffect(() => {
    if ((autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) === false) {
      /* Toggle off: drop the auto-open tracking so re-enabling starts fresh
         (and no stale entry survives to skip an auto-collapse). */
      thinkAutoOpenedRef.current = new WeakSet()
      return undefined
    }
    const section = chatSectionRef.current
    if (section === null) return undefined
    /* Clamp + round to the store's 0.1 s resolution BEFORE converting to ms:
       a legacy/hand-written out-of-range value (e.g. 50, NaN) must not become
       a 50 s (or instant NaN) auto-collapse delay. */
    const rawDelay = Number(thinkCollapseDelay)
    const delaySeconds = Number.isFinite(rawDelay)
      ? Math.min(THINK_COLLAPSE_DELAY_MAX_S, Math.max(THINK_COLLAPSE_DELAY_MIN_S, rawDelay))
      : THINK_COLLAPSE_DELAY_DEFAULT_S
    const collapseDelayMs = Math.round(Math.round(delaySeconds * 10) / 10 * 1000)
    const autoOpened = thinkAutoOpenedRef.current
    const pendingCollapses = new Map()
    /* Think roots whose disclosure row had not rendered yet when the root was
       seen: retried on every later mutation (the row usually lands one frame
       after the root — the old code claimed a retry but only scanned the added
       node's DESCENDANTS, and a think root is the row's ANCESTOR, so the retry
       never fired). */
    const pendingRoots = new Set()
    const rowOf = root => root.querySelector(':scope [data-disclosure-row]')
    // Flag programmatic row clicks so the interaction listener below does not
    // treat this behavior's own clicks as user interaction.
    let programmatic = false
    const clickRow = row => {
      programmatic = true
      try { row.click() } finally { programmatic = false }
    }
    const openRow = root => {
      if (autoOpened.has(root)) return
      const row = rowOf(root)
      // Track only rows this behavior actually opened. A disclosure that has
      // not rendered yet is parked in pendingRoots and retried on the next
      // mutation, while a row already opened by the user remains user-owned
      // and is never closed automatically.
      if (row === null) {
        pendingRoots.add(root)
        return
      }
      pendingRoots.delete(root)
      if (row.getAttribute('aria-expanded') === 'true') return
      thinkAutoOpenedKnownRef.current.add(root)
      autoOpened.add(root)
      clickRow(row)
    }
    const closeRow = root => {
      const row = rowOf(root)
      if (row !== null && row.getAttribute('aria-expanded') === 'true') clickRow(row)
      autoOpened.delete(root)
    }
    const cancelPending = root => {
      const timer = pendingCollapses.get(root)
      if (timer !== undefined) {
        clearTimeout(timer)
        pendingCollapses.delete(root)
      }
    }
    const scheduleClose = root => {
      cancelPending(root)
      pendingCollapses.set(root, setTimeout(() => {
        pendingCollapses.delete(root)
        if (root.isConnected) closeRow(root)
      }, collapseDelayMs))
    }
    // Any user interaction with a Think block takes ownership of it: cancel a
    // pending auto-collapse and stop tracking it.
    const onSectionClick = event => {
      if (programmatic) return
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      cancelPending(root)
      autoOpened.delete(root)
    }
    const onSectionKeyDown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      cancelPending(root)
      autoOpened.delete(root)
    }
    section.addEventListener('click', onSectionClick, true)
    section.addEventListener('keydown', onSectionKeyDown, true)
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-state') {
          const root = mutation.target
          if (root.nodeType !== 1 || !root.matches?.('[data-variant="think"]')) continue
          const state = root.getAttribute('data-state')
          if (state === 'running') {
            /* Re-streaming on the same block (ok → running): cancel any
               pending auto-collapse left over from the previous run BEFORE
               re-opening, or the stale timer would collapse the block
               mid-stream. */
            cancelPending(root)
            openRow(root)
          } else if (state === 'ok' && autoOpened.has(root)) scheduleClose(root)
          continue
        }
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches?.('[data-variant="think"]')) {
            if (node.getAttribute('data-state') === 'running') openRow(node)
          } else {
            for (const root of node.querySelectorAll?.('[data-variant="think"][data-state="running"]') ?? []) openRow(root)
          }
        }
      }
      /* Retry parked roots (row not rendered yet) on every mutation batch. */
      for (const root of [...pendingRoots]) {
        if (!root.isConnected) {
          pendingRoots.delete(root)
          continue
        }
        openRow(root)
      }
    })
    observer.observe(section, { attributes: true, attributeFilter: ['data-state'], childList: true, subtree: true })
    // Catch a block already streaming when the observer attached — but only
    // blocks this behavior has never seen: a re-run (delay slider change) must
    // not re-open a running block the user already collapsed.
    for (const root of section.querySelectorAll('[data-variant="think"][data-state="running"]')) {
      if (!thinkAutoOpenedKnownRef.current.has(root)) openRow(root)
    }
    /* A re-run (delay slider change) also dropped the pending-collapse timers
       (they live in the effect-local Map): an auto-opened block that already
       finished (state ok) must be re-scheduled, or it would stay expanded
       forever. On a first mount autoOpened is empty, so this is a no-op. */
    for (const root of section.querySelectorAll('[data-variant="think"][data-state="ok"]')) {
      if (autoOpened.has(root)) scheduleClose(root)
    }
    return () => {
      observer.disconnect()
      section.removeEventListener('click', onSectionClick, true)
      section.removeEventListener('keydown', onSectionKeyDown, true)
      for (const timer of pendingCollapses.values()) clearTimeout(timer)
      pendingCollapses.clear()
    }
  }, [chatSectionRef, autoExpandThink, thinkCollapseDelay])
}
