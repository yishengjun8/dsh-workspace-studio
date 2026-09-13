/* Session-title guard. The harness derives a fresh session's fallback title
 * from the first human message verbatim (first 5 whitespace words, capped at
 * 40 UTF-8 bytes — the base bundle's session-title config), so an
 * editor-context envelope sent as the message prefix leaks into the title
 * ("<selection>The user selected the lines"). When such a title lands on a
 * direct session this bridge actually sent context from, rename the session
 * through the harness seam: session.rename() appends a user-source title
 * event, which both overwrites the polluted fallback and pins the title
 * against further automatic generation. Sessions without a recorded context
 * send (legacy pollution) are left untouched and stay manually renameable.
 */
import { isEditorContextEnvelopeTitle } from './context-bridge.js'

/* Mirror the harness fallback caps so a cleaned title reads like a native
 * one; session.rename() re-normalizes and enforces its own maxTitleBytes. */
const TITLE_MAX_WORDS = 5
const TITLE_MAX_BYTES = 40
/* Non-whitespace C0/C1 controls, mirroring the harness title sanitizer. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu

function truncateUtf8(input, maxBytes) {
  const encoder = new TextEncoder()
  if (encoder.encode(input).byteLength <= maxBytes) return input
  let output = ''
  let used = 0
  for (const character of input) {
    const bytes = encoder.encode(character).byteLength
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/* Same shape as the harness fallback: control-stripped, whitespace-collapsed,
 * leading words, byte-truncated without splitting a code point. */
export function cleanedSessionTitle(candidate) {
  const remainder = typeof candidate?.remainder === 'string' ? candidate.remainder : ''
  const words = remainder.replace(CONTROL_CHARACTER, '').replace(/\s+/gu, ' ').trim().split(' ').filter(Boolean)
  const derived = truncateUtf8(words.slice(0, TITLE_MAX_WORDS).join(' '), TITLE_MAX_BYTES)
  if (derived !== '') return derived
  /* Context-only send (empty remainder): title by the attached file. */
  const fileName = typeof candidate?.fileName === 'string' ? candidate.fileName : ''
  const range = typeof candidate?.range === 'string' ? candidate.range : ''
  return truncateUtf8(range === '' ? fileName : `${fileName} · ${range}`, TITLE_MAX_BYTES)
}

export function installTitleGuard(ctx, cleanedTitles) {
  const renaming = new Set()
  /* sessionId -> last polluted title already acted on: a failed rename must
   * not retry on every store update, and a clean title needs no state. */
  const handled = new Map()
  const check = () => {
    try {
      const list = ctx.sessions.list.getSnapshot()
      for (const id of list.ids) {
        const key = String(id)
        const row = list.byId[id]
        if (row === undefined || row.origin === 'subagent') continue
        const title = typeof row.displayTitle === 'string' ? row.displayTitle : ''
        if (!isEditorContextEnvelopeTitle(title) || handled.get(key) === title || renaming.has(key)) continue
        const cleaned = cleanedTitles.get(key)
        if (cleaned === undefined) {
          /* No recorded context send for this session: never guess a
             replacement, the user can rename it manually. */
          handled.set(key, title)
          continue
        }
        const session = ctx.sessions.binding(key)?.session
        if (session === undefined || typeof session.rename !== 'function') continue
        handled.set(key, title)
        renaming.add(key)
        Promise.resolve()
          .then(() => {
            /* Re-check right before renaming: an LLM title may have landed
               meanwhile, and a user-source rename would pin over it. */
            const current = ctx.sessions.list.getSnapshot().byId[key]?.displayTitle
            if (!isEditorContextEnvelopeTitle(typeof current === 'string' ? current : '')) return
            return session.rename(cleaned)
          })
          .then(() => { cleanedTitles.delete(key) })
          .catch((error) => {
            console.warn(`workspace-studio: session-title guard rename failed for session ${key}: ${error instanceof Error ? error.message : String(error)}`)
          })
          .finally(() => { renaming.delete(key) })
      }
    } catch (error) {
      /* A guard failure must never escape into the sessions-list subscription
         dispatch; the title stays polluted but the session keeps working. */
      console.warn(`workspace-studio: session-title guard check failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const off = ctx.sessions.list.subscribe(check)
  check()
  return off
}