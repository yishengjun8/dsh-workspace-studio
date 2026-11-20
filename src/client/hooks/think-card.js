/** Think-card behavior: keeps every Think block open as a card so the harness
 *  renders its body, scroll-pins the viewport to the newest text while the
 *  block streams, and never force-reopens a row the user collapsed. Each card's
 *  header also gains a copy button appended after the disclosure row — the
 *  harness exposes no reasoning header accessory slot — which puts the block's
 *  visible text on the clipboard in one click. */
import { useEffect, useRef } from 'react'
import { CONVERSATION_SCROLLPORT_SELECTOR, installScrollGate } from '../scroll-gate.js'
import { CHECK_ICON_MARKUP, COPY_ICON_MARKUP } from '../icons.js'
import { translate } from '../locale/index.js'
import { copyText } from '../paths.js'

/* The body class may be hashed, so match the "thinkBody" substring. */
const THINK_BODY_SELECTOR = '[class*="thinkBody"]'
/* Injected header copy control: the marker attribute drives both the stylesheet and idempotent
   injection, and COPY_STRIP_SELECTOR names the card chrome that is not reasoning prose — a code
   card's language banner and its own copy control must not land in the pasted text. */
const COPY_BUTTON_SELECTOR = '[data-dsh-ws-think-copy]'
const COPY_STRIP_SELECTOR = 'button, svg, [data-code-block-banner], script, style'
/* Feedback dwell: success is a blink, a failure stays long enough to be read. */
const COPY_DONE_MS = 1200
const COPY_FAILED_MS = 2000
/* Scroll positions within this many px of the bottom count as "at bottom". */
const THINK_BOTTOM_TOLERANCE_PX = 4
/* An upward scroll must clear this far from the bottom before pin-tracking stops. */
const THINK_UNPIN_DISTANCE_PX = 8

/**
 * Read the displayed text of a card body. The body renders Markdown, so the paragraph breaks have to
 * survive: innerText is what carries them (textContent joins every block into one run), and innerText
 * needs a rendered host — hence the cleaned clone parked offscreen. A detached source works the same
 * way, which is what makes the collapsed-card cache possible.
 * @param body - the card body element, attached or already detached.
 * @returns the copyable text, trimmed, without runs of blank lines.
 */
function copyableTextOf(body) {
  const clone = body.cloneNode(true)
  for (const node of clone.querySelectorAll(COPY_STRIP_SELECTOR)) node.remove()
  clone.style.position = 'fixed'
  clone.style.top = '0'
  clone.style.left = '-9999px'
  clone.style.maxHeight = 'none'
  clone.style.overflow = 'visible'
  clone.setAttribute('aria-hidden', 'true')
  document.body.append(clone)
  let text
  try {
    text = clone.innerText
  } finally {
    clone.remove()
  }
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function useThinkCard({ chatSectionRef }) {
  /* Think roots the user has interacted with are never force-opened again.
     DOM identity dies with every ChatView remount (session switch), so the
     decision ALSO consults a content-fingerprint Set that survives the
     remount: a re-rendered block with the same text stays closed. Mid-stream
     interactions fingerprint the partial text (key drift is accepted — no
     worse than the identity WeakSet), and identical leading text in two
     blocks collapses both conservatively. */
  const userInteractedRef = useRef(new WeakSet())
  const interactedKeysRef = useRef(new Set())
  /* Per think root, the attached body tracker: { body, observer, resize, onScroll, pinned, gate }. */
  const trackersRef = useRef(new Map())
  useEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    const userInteracted = userInteractedRef.current
    const trackers = trackersRef.current
    /* Think roots whose disclosure row had not rendered yet are retried on every later mutation batch. */
    const pendingRoots = new Set()
    /* Text of a body that left the DOM (the card collapsed): the disclosure unmounts its body, so this
       cache is what keeps the header's copy button working on a collapsed card. */
    const retiredText = new WeakMap()
    /* Feedback timer per button, released with the effect — a stray timer would repaint a removed node. */
    const copyTimers = new Map()
    // Flag programmatic row clicks so the listener below ignores this hook's own clicks.
    let programmatic = false
    const rowOf = root => root.querySelector(':scope [data-disclosure-row]')
    const bodyOf = root => root.querySelector(THINK_BODY_SELECTOR)
    /* The card's OWN header: the body may hold a nested card (a diff fence) with a header of its own, so a
       header only counts when this root is its nearest think wrapper. The running status span sits beside
       the disclosure root, which is why this is a scan rather than a first-child read. */
    const headerOf = root => {
      for (const header of root.querySelectorAll('[data-disclosure-header]')) {
        if (header.closest('[data-variant="think"]') === root) return header
      }
      return null
    }
    /* Remount-stable interaction key: the root's collapsed leading text. Bounded so a long session cannot grow the set forever. */
    const thinkKeyOf = root => {
      const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
      return text === '' ? null : text
    }
    const rememberInteraction = root => {
      userInteracted.add(root)
      const key = thinkKeyOf(root)
      if (key === null) return
      const keys = interactedKeysRef.current
      if (keys.size >= 500) keys.delete(keys.values().next().value)
      keys.add(key)
    }
    const clickRow = row => {
      programmatic = true
      try { row.click() } finally { programmatic = false }
    }
    const openRow = root => {
      if (userInteracted.has(root)) return
      const key = thinkKeyOf(root)
      if (key !== null && interactedKeysRef.current.has(key)) return
      const row = rowOf(root)
      if (row === null) {
        pendingRoots.add(root)
        return
      }
      pendingRoots.delete(root)
      if (row.getAttribute('aria-expanded') === 'true') return
      clickRow(row)
    }
    /* ---- header copy control -------------------------------------------------------------------
       Injected after the disclosure row, so it is the header's rightmost element AND lives outside the
       disclosure target: clicking it can never collapse the card. The harness re-renders this header
       on every stream tick but only ever reconciles the children it owns, so an appended node
       survives; every injection point re-checks for the marker anyway, which makes it idempotent and
       self-healing after a remount. */
    const paintCopyButton = (button, state) => {
      if (state === 'copied') button.setAttribute('data-state', 'copied')
      else if (state === 'failed') button.setAttribute('data-state', 'failed')
      else button.removeAttribute('data-state')
      button.innerHTML = state === 'copied' ? CHECK_ICON_MARKUP : COPY_ICON_MARKUP
      const label = state === 'copied'
        ? translate('think.copy.done')
        : state === 'failed' ? translate('think.copy.failed') : translate('think.copy')
      button.title = label
      button.setAttribute('aria-label', label)
    }
    /* The effect is not re-run on a locale switch, so re-resolve the idle label on entry/focus. */
    const syncCopyLabel = button => {
      if (button.hasAttribute('data-state')) return
      const label = translate('think.copy')
      if (button.getAttribute('aria-label') === label) return
      button.title = label
      button.setAttribute('aria-label', label)
    }
    const copyTextOfRoot = root => {
      const body = bodyOf(root)
      if (body !== null) {
        const live = copyableTextOf(body)
        if (live !== '') return live
      }
      return retiredText.get(root) ?? ''
    }
    const createCopyButton = root => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-ws-think-copy'
      button.setAttribute('data-dsh-ws-think-copy', '')
      paintCopyButton(button, 'idle')
      button.addEventListener('pointerenter', () => syncCopyLabel(button))
      button.addEventListener('focus', () => syncCopyLabel(button))
      button.addEventListener('click', event => {
        /* The section's capture listener sees this click before we do: keeping it from bubbling (and
           exempting it there) is what stops a copy from being read as a collapse interaction. */
        event.preventDefault()
        event.stopPropagation()
        const text = copyTextOfRoot(root)
        if (text === '') return
        void (async () => {
          const ok = await copyText(text)
          if (!button.isConnected) return
          paintCopyButton(button, ok ? 'copied' : 'failed')
          const previous = copyTimers.get(button)
          if (previous !== undefined) clearTimeout(previous)
          copyTimers.set(button, setTimeout(() => {
            copyTimers.delete(button)
            if (button.isConnected) paintCopyButton(button, 'idle')
          }, ok ? COPY_DONE_MS : COPY_FAILED_MS))
          if (!ok) console.warn('workspace-studio: copying a Think block failed')
        })()
      })
      return button
    }
    const ensureCopyButton = root => {
      const header = headerOf(root)
      if (header === null) return
      if (header.querySelector(COPY_BUTTON_SELECTOR) !== null) return
      header.append(createCopyButton(root))
    }
    /* Every preparation of a root goes through here, so a late-rendered header or a remount cannot
       leave a card without its button. */
    const prepareRoot = root => {
      ensureCopyButton(root)
      openRow(root)
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
      /* Snapshot the text before the body goes: after a collapse this cache is the only copy source. */
      const text = copyableTextOf(tracker.body)
      if (text !== '') retiredText.set(root, text)
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
      /* Copying is not a collapse interaction: the card must stay force-openable afterwards. */
      if (target.closest(COPY_BUTTON_SELECTOR) !== null) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      rememberInteraction(root)
    }
    const onSectionKeyDown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(COPY_BUTTON_SELECTOR) !== null) return
      const root = target.closest('[data-variant="think"]')
      if (root === null) return
      rememberInteraction(root)
    }
    section.addEventListener('click', onSectionClick, true)
    section.addEventListener('keydown', onSectionKeyDown, true)
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches?.('[data-variant="think"]')) prepareRoot(node)
          else {
            for (const root of node.querySelectorAll?.('[data-variant="think"]') ?? []) prepareRoot(root)
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
        prepareRoot(root)
      }
      /* Drop trackers whose body or root left the DOM. */
      for (const [root, tracker] of [...trackers]) {
        if (!tracker.body.isConnected || !root.isConnected) detachTracker(root)
      }
    })
    observer.observe(section, { childList: true, subtree: true })
    /* Catch blocks already present when the observer attached. */
    for (const root of section.querySelectorAll('[data-variant="think"]')) {
      prepareRoot(root)
      const body = bodyOf(root)
      if (body !== null) attachTracker(root, body)
    }
    return () => {
      observer.disconnect()
      section.removeEventListener('click', onSectionClick, true)
      section.removeEventListener('keydown', onSectionKeyDown, true)
      for (const timer of copyTimers.values()) clearTimeout(timer)
      copyTimers.clear()
      for (const tracker of trackers.values()) {
        tracker.observer.disconnect()
        tracker.resize?.disconnect()
        tracker.body.removeEventListener('scroll', tracker.onScroll)
        tracker.gate()
      }
      trackers.clear()
      for (const button of section.querySelectorAll(COPY_BUTTON_SELECTOR)) button.remove()
    }
  }, [chatSectionRef])
}
