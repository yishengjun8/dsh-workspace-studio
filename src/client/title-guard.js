/* Session-title guard: when an editor-context envelope (opened_file / selection)
   is merged into a sent user message, the harness's automatic session-title
   fallback derives the title from the leading words of that message, which then
   starts with the raw envelope signature (`<selection>The user selected ...`).
   This module watches the sessions list's durable `title` projection and
   renames the session with a clean derivation ONLY when an automatic title with
   an envelope-marker prefix appears (the harness fallback, never a provider or
   user title). A single live entry per session, first candidate wins: the
   fallback always derives from the OLDEST eligible message, which is the first
   context send. */
import { OPENED_FILE_PREFIX, SELECTION_PREFIX } from './context-bridge.js'

/* Derived-title limits: local constants, only used when this plugin renames.
   No need to mirror the harness fallback config - the goal is a clean, short,
   terminal-safe title for the user's own words. */
export const TITLE_GUARD_WORDS = 12
export const TITLE_GUARD_BYTES = 200
/* How long to keep watching for a marker-prefixed automatic title. The harness
   fallback lands quickly after a user message; a slow LLM provider may win the
   race first with a non-marker title, so the entry stays armed (without
   renaming) until the watchdog expires, catching an out-of-order fallback. */
const TITLE_GUARD_TTL_MS = 60_000

/* Mirror the harness title normalizer (packages/session/session-title
   normalize.ts): strip escape/control/directional sequences, collapse
   whitespace, trim. */

const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const ESC_SEQUENCE = /\u001B[@-_]/gu
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

function cleanTitleText(input) {
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function leadingWords(input, maxWords) {
  return cleanTitleText(input).split(' ').filter(Boolean).slice(0, maxWords).join(' ')
}

/* UTF-8 byte truncation that never splits a code point: walk the byte boundary
   back across continuation bytes, then decode the prefix. */
function truncateTitleUtf8(input, maxBytes) {
  const bytes = new TextEncoder().encode(input)
  if (bytes.byteLength <= maxBytes) return input
  let end = maxBytes
  while (end > 0 && (bytes[end - 1] & 0xC0) === 0x80) end -= 1
  return new TextDecoder().decode(bytes.subarray(0, end))
}

/** Clean fallback title from the user's own prompt words. */
export function deriveCleanPromptTitle(text) {
  return truncateTitleUtf8(leadingWords(text, TITLE_GUARD_WORDS), TITLE_GUARD_BYTES).trimEnd()
}

function isEnvelopeMarkerTitle(title) {
  return title.startsWith(OPENED_FILE_PREFIX) || title.startsWith(SELECTION_PREFIX)
}

/**
 * Single-shot per-session guard. `arm()` registers the clean rename candidate
 * after a context send succeeded; `observe(byId)` runs on every sessions-list
 * emit and renames exactly once only when the durable title starts with an
 * envelope marker (the harness fallback over the combined message). Non-marker
 * titles (provider-generated, user-pinned) never trigger a rename, and do not
 * disarm the entry - the fallback may land after a slow provider title.
 */
export class TitleGuard {
  constructor(renameSession) {
    /* renameSession(id, title) -> Promise; must never throw synchronously. */
    this.renameSession = renameSession
    this.entries = new Map()
  }

  arm(sessionId, candidate) {
    const id = String(sessionId)
    /* First candidate wins: one live entry per session until it settles, so a
       burst of context sends cannot overwrite the candidate for the oldest
       eligible message the harness fallback actually reads. */
    if (this.entries.has(id)) return
    const timer = setTimeout(() => { this.entries.delete(id) }, TITLE_GUARD_TTL_MS)
    this.entries.set(id, { candidate, timer })
  }

  observe(byId) {
    if (this.entries.size === 0) return
    for (const [id, entry] of this.entries) {
      const row = byId?.[id]
      if (row === undefined) {
        /* Session left the list: nothing left to fix. */
        this.detach(id)
        continue
      }
      const title = typeof row.title === 'string' ? row.title : undefined
      if (title === undefined) continue
      if (!isEnvelopeMarkerTitle(title)) continue
      /* Marker-prefixed automatic title landed: replace it with the clean
         candidate, then drop the entry. The rename pins the title (harness
         user-source semantics), which is exactly what we want here. */
      this.detach(id)
      const { candidate } = entry
      Promise.resolve()
        .then(() => this.renameSession(id, candidate))
        .catch((error) => {
          console.warn(`workspace-studio: session-title cleanup rename failed for ${id}: ${String(error?.message ?? error)}`)
        })
    }
  }

  detach(id) {
    const entry = this.entries.get(id)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    this.entries.delete(id)
  }

  dispose() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
  }
}
