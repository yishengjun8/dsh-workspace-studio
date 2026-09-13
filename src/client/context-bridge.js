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
    /* sessionId: a session switch re-renders this component in a different slot, or the observer keeps watching the old parent. */
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
/* Title detection uses the envelope prefixes WITHOUT the trailing separator:
   the harness fallback title truncates the message to 40 UTF-8 bytes, so a
   polluted title can end mid-sentence ("<selection>The user selected the
   lines") and must still match. */
const TITLE_OPENED_FILE_PREFIX = '<opened_file>The user opened the file'
const TITLE_SELECTION_PREFIX = '<selection>The user selected the lines'

export function isEditorContextEnvelopeTitle(title) {
  return typeof title === 'string'
    && (title.startsWith(TITLE_OPENED_FILE_PREFIX) || title.startsWith(TITLE_SELECTION_PREFIX))
}
const SELECTION_TRAILER = 'This may or may not be related to the current task.'
const SELECTION_CLOSE = '</selection>'
const MESSAGE_CONTEXT_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-pending-steering]'
const MESSAGE_CONTEXT_SUMMARY_ATTR = 'data-dsh-ws-message-context-summary'
const pendingEditorContextDisplays = new Map()
/* Bound the pending-display map: a session switch or rendered-text mismatch can leave entries pending forever, so the oldest drops first. */
const MAX_PENDING_CONTEXT_DISPLAYS = 256
let pendingContextDisplayCount = 0

/* Entries carry a unique handle so a failed send discards exactly its own display. */
let pendingContextDisplaySeq = 0

export function rememberEditorContextDisplay(text, display) {
  /* Bound the global entry count, not just the key count, or a shared key's queue could grow without limit. */
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

export function clearEditorContextDisplays() {
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

export function describeEditorContext(context, raw) {
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
  // Anchor on the last marker whose tail starts with the blank-line separator (or is empty), so a marker inside the envelope body or the user's text is skipped.
  const marker = `${SELECTION_TRAILER}${SELECTION_CLOSE}`
  let markerAt = text.lastIndexOf(marker)
  while (markerAt >= 0) {
    const after = text.slice(markerAt + marker.length)
    if (after === '' || after.startsWith('\n\n') || after.startsWith('\r\n\r\n')) {
      const closeAt = markerAt + marker.length - SELECTION_CLOSE.length
      const body = text.slice(headerEnd + 1, closeAt)
      if (body.endsWith(SELECTION_TRAILER) || body.endsWith(`\r${SELECTION_TRAILER}`)) {
        /* Line-count guard: the envelope body must contain exactly endLine - startLine + 2 lines, stripping the Host's CDATA framing lines before counting. */
        const bodyLinesRaw = body.replace(/\r\n/g, '\n').split('\n')
        let bodyLines = bodyLinesRaw.length
        if (bodyLinesRaw.length >= 3 && bodyLinesRaw[0] === '<![CDATA['
          && bodyLinesRaw[bodyLinesRaw.length - 2] === ']]>') {
          bodyLines -= 2
        }
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
    /* Pending steering messages have no data-time-hover-root ancestor, so without this branch a split envelope never folds. */
    if (current.parentElement?.parentElement?.hasAttribute('data-pending-steering')) return current
  }
  /* The harness reshaped user rows (data-time-hover-root became data-actions-reveal), so descend the row container to the bubble instead of rewriting the whole row; cap the depth so a deeper DOM reshape fails safe. */
  if (!(candidate instanceof HTMLElement)
    || (!candidate.hasAttribute('data-chat-flow-kind') && !candidate.hasAttribute('data-pending-steering'))) {
    return candidate instanceof HTMLElement ? candidate : null
  }
  const containerText = candidate.textContent ?? ''
  if (!containerText.startsWith(OPENED_FILE_PREFIX) && !containerText.startsWith(SELECTION_PREFIX)) {
    return candidate
  }
  let current = candidate
  for (let depth = 0; depth < 8; depth += 1) {
    let next = null
    for (const child of current.children) {
      if (child instanceof HTMLElement && child.tagName === 'DIV') {
        const text = child.textContent ?? ''
        if (text.startsWith(OPENED_FILE_PREFIX) || text.startsWith(SELECTION_PREFIX)) {
          next = child
          break
        }
      }
    }
    if (next === null) return current
    current = next
  }
  return current
}

function findEditorContextCandidate(container) {
  /* First envelope wins: compacting the first rewrites the container's text and schedules the observer again, so the next envelope is found by the next pass. */
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
  return row
}

export function installEditorContextMessageCompactor() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  const originals = new Map()
  const compactBubble = (bubble) => {
    const text = bubble.textContent ?? ''
    const context = parseEditorContextEnvelope(text)
    if (context === null) return
    /* Store the summary row reference so cleanup can remove it even after the bubble left the document. */
    originals.set(bubble, { text, summary: renderEditorContextSummary(bubble, consumeEditorContextDisplay(text) ?? context) })
    bubble.classList.add('dsh-ws-message-context-bubble')
    if (context.visibleText === '') bubble.setAttribute('data-dsh-ws-empty-prompt', '')
    else bubble.removeAttribute('data-dsh-ws-empty-prompt')
    bubble.textContent = context.visibleText
  }
  /* Cache each container's leading text slice (WeakMap keys let removed containers be collected) and skip the read while it is unchanged. */
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
    /* Release bubbles that left the document, removing their summary rows first so no ghost "↳ file" line lingers. */
    for (const [bubble, original] of originals) {
      if (!bubble.isConnected) {
        if (original?.summary instanceof HTMLElement && original.summary.isConnected) original.summary.remove()
        originals.delete(bubble)
      }
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
    for (const [bubble, original] of originals) {
      /* A disconnected bubble still owns its summary row: remove it, or a ghost "↳ file" line lingers until refresh. */
      if (original?.summary instanceof HTMLElement && original.summary.isConnected) original.summary.remove()
      if (!bubble.isConnected) continue
      bubble.classList.remove('dsh-ws-message-context-bubble')
      bubble.removeAttribute('data-dsh-ws-empty-prompt')
      bubble.textContent = original?.text ?? ''
    }
    originals.clear()
  }
}
