/* Complete text of a file read through the harness workspace-files Remote.
 *
 * Used for the read-only preview of a path OUTSIDE the workspace: the plugin's
 * own API is workspace-confined and cannot serve such a path at all, while the
 * harness `workspaceFiles.read` reads any path the Session's filesystem
 * authority allows (the deployment's sandbox policy still decides). Pages are
 * pulled one at a time so a huge file is bounded by OUTSIDE_PREVIEW_MAX_BYTES
 * instead of being held whole by the transport.
 *
 * Returns null when the Remote faces are not installed (the caller reports the
 * renderer as unavailable) and throws the Remote failure otherwise. */
import { OUTSIDE_PREVIEW_MAX_BYTES } from '../constants.js'
import { remoteFaces } from './remote.js'

export async function readRemoteText(sessionId, path, signal) {
  const faces = remoteFaces()
  if (faces === undefined) return null
  const encoder = new TextEncoder()
  let offset = 1
  let text = ''
  let bytes = 0
  let truncated = false
  for (;;) {
    const result = await faces.readPage(String(sessionId), path, offset, signal)
    if (!result.ok) throw new Error(result.error?.message ?? '')
    const page = result.value ?? {}
    const chunk = typeof page.text === 'string' ? page.text : ''
    if (chunk !== '') bytes += encoder.encode(chunk).byteLength
    /* A page boundary IS a line boundary: the empty line between pages keeps
       the joined text identical to the file. */
    text = text === '' ? chunk : `${text}\n${chunk}`
    if (bytes > OUTSIDE_PREVIEW_MAX_BYTES) {
      truncated = true
      break
    }
    if (page.eof === true) break
    const lines = Number.isFinite(page.lines) ? Math.max(1, page.lines) : 1
    const next = (Number.isFinite(page.offset) ? page.offset : offset) + lines
    /* Defensive: a page that neither advances nor reports EOF would spin. */
    if (next <= offset) break
    offset = next
  }
  return { text, truncated }
}
