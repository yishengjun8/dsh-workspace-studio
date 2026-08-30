import { createElement as h, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { translate } from './locale/index.js'

export function EditorContextPrefix({ useEditorContext, useSessions, toggle, ensureSession, sessionId }) {
  const rowRef = useRef(null)
  const [queueDockGap, setQueueDockGap] = useState(0)
  const context = useEditorContext(value => value)
  const direct = useSessions(state => state.byId[sessionId] !== undefined && state.byId[sessionId].origin !== 'subagent')
  useEffect(() => { ensureSession(String(sessionId)) }, [ensureSession, sessionId])
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row === null) return
    const parent = row.parentElement
    if (parent === null) return
    const updateGap = () => {
      const prev = row.previousElementSibling
      setQueueDockGap(prev instanceof HTMLElement && prev.hasAttribute('data-queue-dock') ? 9 : 0)
    }
    updateGap()
    const observer = new MutationObserver(updateGap)
    observer.observe(parent, { childList: true })
    return () => { observer.disconnect() }
    /* sessionId: a session switch re-renders this component in a different
       slot — without it the observer keeps watching the OLD parent (leaking
       until present/direct change) and the gap stops tracking the new row. */
  }, [context.present, direct, sessionId])
  if (!context.present || !direct) return null
  const range = context.selection === undefined
    ? ''
    : ` · L${context.selection.startLine}:C${context.selection.startColumn}-L${context.selection.endLine}:C${context.selection.endColumn}`
  const label = `${context.path}${range}`
  const title = context.active
    ? translate('context.active', { path: label })
    : translate('context.inactive', { path: label })
  return h('div', { className: 'dsh-ws-context-row', ref: rowRef, style: queueDockGap === 0 ? undefined : { marginTop: `${queueDockGap}px` } },
    h('button', {
      'aria-label': title,
      'aria-pressed': context.active,
      className: 'dsh-ws-context-prefix',
      'data-inactive': !context.active || undefined,
      onClick: toggle,
      title,
      type: 'button',
    }, h('span', { 'aria-hidden': true, className: 'dsh-ws-context-prefix-mark' }, context.active ? '↳' : '○'),
    h('span', { className: 'dsh-ws-context-prefix-label' }, label)))
}

const OPENED_FILE_PREFIX = '<opened_file>The user opened the file '
const OPENED_FILE_SUFFIX = ' in the IDE. This may or may not be related to the current task.</opened_file>'
const SELECTION_PREFIX = '<selection>The user selected the lines '
const SELECTION_TRAILER = 'This may or may not be related to the current task.'
const SELECTION_CLOSE = '</selection>'
const MESSAGE_CONTEXT_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-pending-steering]'
const MESSAGE_CONTEXT_SUMMARY_ATTR = 'data-dsh-ws-message-context-summary'
const pendingEditorContextDisplays = new Map()
/* The queue is consumed only when the message mounts and compacts; a session
   switch, rendered-text mismatch, or skipped fast-path can leave an entry
   pending forever. Bound the map so a long session can't grow it without
   limit — the oldest pending display drops first (the envelope still renders;
   only the rich summary is lost, the same as a never-consumed entry). */
const MAX_PENDING_CONTEXT_DISPLAYS = 256
let pendingContextDisplayCount = 0

/* Entries carry a unique handle so a failed send can discard EXACTLY its own
   display: popping the queue tail by text key would remove a DIFFERENT
   concurrent send's entry when two identical messages (same context + same
   user text) are in flight and the first one fails. */
let pendingContextDisplaySeq = 0

function rememberEditorContextDisplay(text, display) {
  /* Bound the GLOBAL entry count, not just the key count: repeated context-only
     sends with the same selection produce the same key, and that key's queue
     would otherwise grow without limit when consumption fails (session switch,
     rendered-text mismatch, skipped fast-path). Evict the oldest key's whole
     queue once the cap is reached. */
  if (pendingContextDisplayCount >= MAX_PENDING_CONTEXT_DISPLAYS) {
    const oldest = pendingEditorContextDisplays.keys().next().value
    if (oldest !== undefined) {
      const queue = pendingEditorContextDisplays.get(oldest)
      pendingContextDisplayCount -= queue.length
      pendingEditorContextDisplays.delete(oldest)
    }
  }
  const handle = { key: text, seq: pendingContextDisplaySeq++ }
  const entry = { display, handle }
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined) pendingEditorContextDisplays.set(text, [entry])
  else queue.push(entry)
  pendingContextDisplayCount += 1
  return handle
}

function consumeEditorContextDisplay(text) {
  const queue = pendingEditorContextDisplays.get(text)
  if (queue === undefined || queue.length === 0) return null
  const entry = queue.shift()
  pendingContextDisplayCount -= 1
  if (queue.length === 0) pendingEditorContextDisplays.delete(text)
  return entry?.display ?? null
}

function discardEditorContextDisplay(handle) {
  if (handle === undefined || handle === null) return
  const queue = pendingEditorContextDisplays.get(handle.key)
  if (queue === undefined || queue.length === 0) return
  const index = queue.findIndex(entry => entry.handle.seq === handle.seq)
  if (index === -1) return
  queue.splice(index, 1)
  pendingContextDisplayCount -= 1
  if (queue.length === 0) pendingEditorContextDisplays.delete(handle.key)
}

function clearEditorContextDisplays() {
  pendingEditorContextDisplays.clear()
  pendingContextDisplayCount = 0
}

function promptRemainder(text, end) {
  const rest = text.slice(end)
  if (rest.startsWith('\r\n\r\n')) return rest.slice(4)
  if (rest.startsWith('\n\n')) return rest.slice(2)
  return rest
}

function displayFileName(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function displayLineRange(startLine, endLine) {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
}

function displaySelectionRange(selection) {
  return `L${selection.startLine}:C${selection.startColumn}-L${selection.endLine}:C${selection.endColumn}`
}

function describeEditorContext(context, raw) {
  const fileName = displayFileName(context.path)
  if (context.selection === undefined) {
    return { path: context.path, fileName, range: null, title: context.path, raw }
  }
  const range = displaySelectionRange(context.selection)
  return { path: context.path, fileName, range, title: `${context.path} · ${range}`, raw }
}

function parseOpenedFileContext(text) {
  if (!text.startsWith(OPENED_FILE_PREFIX)) return null
  const suffixAt = text.indexOf(OPENED_FILE_SUFFIX, OPENED_FILE_PREFIX.length)
  if (suffixAt < 0) return null
  const path = text.slice(OPENED_FILE_PREFIX.length, suffixAt)
  const end = suffixAt + OPENED_FILE_SUFFIX.length
  return {
    path,
    fileName: displayFileName(path),
    range: null,
    title: path,
    raw: text.slice(0, end),
    visibleText: promptRemainder(text, end),
  }
}

function parseSelectionContext(text) {
  if (!text.startsWith(SELECTION_PREFIX)) return null
  const headerEnd = text.indexOf('\n')
  if (headerEnd < 0) return null
  const header = text.slice(0, headerEnd).replace(/\r$/, '')
  const headerMatch = /^<selection>The user selected the lines (\d+) to (\d+) from (.*):$/.exec(header)
  if (headerMatch === null) return null
  const startLine = Number(headerMatch[1])
  const endLine = Number(headerMatch[2])
  // The envelope ALWAYS closes with the trailer line directly before
  // `</selection>`, and the bridge appends the user's own text after a blank
  // line (`rendered + '\n\n' + text`). Anchor on the LAST marker whose tail
  // starts with that blank-line separator (or is empty): a marker inside the
  // envelope body can't truncate the fold early, and a marker inside the
  // user's own text (which would otherwise be picked by a bare lastIndexOf,
  // folding part of the user's message) is skipped.
  const marker = `${SELECTION_TRAILER}${SELECTION_CLOSE}`
  let markerAt = text.lastIndexOf(marker)
  while (markerAt >= 0) {
    const after = text.slice(markerAt + marker.length)
    if (after === '' || after.startsWith('\n\n') || after.startsWith('\r\n\r\n')) {
      const closeAt = markerAt + marker.length - SELECTION_CLOSE.length
      const body = text.slice(headerEnd + 1, closeAt)
      if (body.endsWith(SELECTION_TRAILER) || body.endsWith(`\r${SELECTION_TRAILER}`)) {
        /* Line-count guard (U2 audit): the envelope body is the selection
           text plus the trailer line, so it must contain exactly
           endLine - startLine + 2 lines (the header declares the selection's
           line span; the trailing newline of a selection ending in \n is
           already accounted for by split). A marker inside the USER's own
           text would make the body longer than the header declares — reject
           that marker and keep searching for the real envelope end. */
        const bodyLines = body.replace(/\r\n/g, '\n').split('\n').length
        if (bodyLines === endLine - startLine + 2) break
      }
    }
    markerAt = text.lastIndexOf(marker, markerAt - 1)
  }
  if (markerAt < 0) return null
  const closeAt = markerAt + marker.length - SELECTION_CLOSE.length
  const body = text.slice(headerEnd + 1, closeAt)
  const path = headerMatch[3]
  const end = closeAt + SELECTION_CLOSE.length
  return {
    path,
    fileName: displayFileName(path),
    range: displayLineRange(startLine, endLine),
    title: `${path} · ${displayLineRange(startLine, endLine)}`,
    raw: text.slice(0, end),
    visibleText: promptRemainder(text, end),
  }
}

function parseEditorContextEnvelope(text) {
  return parseOpenedFileContext(text) ?? parseSelectionContext(text)
}

function findEditorContextBubble(candidate) {
  for (let current = candidate; current instanceof HTMLElement; current = current.parentElement) {
    if (current.parentElement?.parentElement?.hasAttribute('data-time-hover-root')) return current
    /* Pending steering messages render as
       [data-pending-steering] > div:first-child > div:last-child WITHOUT a
       data-time-hover-root ancestor (see the CSS at .dsh-ws-chat
       [data-pending-steering]): the bubble is the last child of the first
       child of the pending container. Without this branch the walk falls
       through to body and returns the DEEPEST prefix-matching element (often
       just the header paragraph), so a split envelope never folds. */
    if (current.parentElement?.parentElement?.hasAttribute('data-pending-steering')) return current
  }
  return candidate instanceof HTMLElement ? candidate : null
}

function findEditorContextCandidate(container) {
  /* FIRST envelope wins (was: last-wins). Compacting the first one rewrites
     the container's text and schedules the observer again, so the second
     envelope is found by the next pass — with last-wins, everything before
     the final envelope stayed unfolded forever (the prefix cache saw an
     unchanged container start and never re-scanned). */
  let candidate = null
  const elements = [container, ...container.querySelectorAll('div,span,p,pre')]
  for (const element of elements) {
    const text = element.textContent ?? ''
    if (text.startsWith(OPENED_FILE_PREFIX) || text.startsWith(SELECTION_PREFIX)) {
      candidate = element
      break
    }
  }
  return candidate
}

function renderEditorContextSummary(bubble, context) {
  const parent = bubble.parentElement
  if (parent === null) return
  let row = bubble.previousElementSibling
  if (!(row instanceof HTMLElement) || !row.hasAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR)) {
    row = document.createElement('div')
    row.setAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR, '')
    row.className = 'dsh-ws-message-context-summary'
    parent.insertBefore(row, bubble)
  }
  row.setAttribute('title', context.raw ?? context.title)
  row.replaceChildren(
    Object.assign(document.createElement('span'), {
      className: 'dsh-ws-message-context-summary-mark',
      textContent: '↳',
    }),
    Object.assign(document.createElement('span'), {
      className: 'dsh-ws-message-context-summary-label',
      textContent: context.fileName,
    }),
    ...(context.range === null ? [] : [Object.assign(document.createElement('span'), {
      className: 'dsh-ws-message-context-summary-range',
      textContent: context.range,
    })]),
  )
}

export function installEditorContextMessageCompactor() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  const originals = new Map()
  const compactBubble = (bubble) => {
    const text = bubble.textContent ?? ''
    const context = parseEditorContextEnvelope(text)
    if (context === null) return
    originals.set(bubble, text)
    renderEditorContextSummary(bubble, consumeEditorContextDisplay(text) ?? context)
    bubble.classList.add('dsh-ws-message-context-bubble')
    if (context.visibleText === '') bubble.setAttribute('data-dsh-ws-empty-prompt', '')
    else bubble.removeAttribute('data-dsh-ws-empty-prompt')
    bubble.textContent = context.visibleText
  }
  /* Per-container prefix fingerprint: reading textContent of every user
     message on every mutation batch is O(total text) per batch during
     streaming. The envelope markers sit at the very start of the text, so
     cache the leading slice per container and skip the read (and the element
     scan) while it is unchanged. WeakMap keys let removed containers be
     collected automatically. */
  const containerPrefixes = new WeakMap()
  const ENVELOPE_PREFIX_LEN = Math.max(OPENED_FILE_PREFIX.length, SELECTION_PREFIX.length)
  const compactContainer = (container) => {
    const text = container.textContent ?? ''
    const prefix = text.slice(0, ENVELOPE_PREFIX_LEN)
    if (containerPrefixes.get(container) === prefix) return
    containerPrefixes.set(container, prefix)
    if (!text.startsWith(OPENED_FILE_PREFIX) && !text.startsWith(SELECTION_PREFIX)) return
    const candidate = findEditorContextCandidate(container)
    const bubble = candidate === null ? null : findEditorContextBubble(candidate)
    if (bubble !== null) compactBubble(bubble)
  }
  const compactAll = () => {
    for (const container of document.querySelectorAll(MESSAGE_CONTEXT_SELECTOR)) compactContainer(container)
    /* Release bubbles that left the document (message cleared, session
       removed): their DOM refs and full text must not accumulate until the
       plugin is disposed. */
    for (const bubble of originals.keys()) {
      if (!bubble.isConnected) originals.delete(bubble)
    }
  }
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      compactAll()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  compactAll()
  return () => {
    observer.disconnect()
    clearEditorContextDisplays()
    for (const [bubble, text] of originals) {
      /* A disconnected bubble (message cleared / session removed) still owns
         its summary row: remove the row even when the bubble itself is gone,
         or a ghost "↳ file" line would linger in the chat until refresh. */
      const summary = bubble.previousElementSibling
      if (summary instanceof HTMLElement && summary.hasAttribute(MESSAGE_CONTEXT_SUMMARY_ATTR)) summary.remove()
      if (!bubble.isConnected) continue
      bubble.classList.remove('dsh-ws-message-context-bubble')
      bubble.removeAttribute('data-dsh-ws-empty-prompt')
      bubble.textContent = text
    }
    originals.clear()
  }
}
