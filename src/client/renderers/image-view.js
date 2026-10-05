/* Standalone image preview: complete bytes via the readBytes Remote face, rendered as a blob URL.
   The read (and its blob-URL cache) lives in remote-bytes.js, shared with the PDF/Office view. */
import { createElement as h } from 'react'
import { translate } from '../locale/index.js'
import { useRemoteBytes } from './remote-bytes.js'
import { RendererStatus } from './status.js'
import { useRemoteFaces } from './remote.js'

const MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
})

function mimeOf(name) {
  const lower = String(name ?? '').toLowerCase()
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

export function ImageView({ sessionId, path, name, readEpoch }) {
  const faces = useRemoteFaces()
  const { url, failure } = useRemoteBytes({
    scope: 'image',
    read: faces?.readAll,
    sessionId,
    path,
    mime: mimeOf(name),
    readEpoch,
  })
  if (failure !== undefined) {
    const message = failure?.unavailable === true
      ? translate('renderer.unavailable')
      : translate('renderer.loadFailed', { message: failure?.message ?? '' })
    return h(RendererStatus, { message, error: true })
  }
  if (url === undefined) {
    return h(RendererStatus, { message: translate('renderer.loading') })
  }
  return h('div', { className: 'dsh-ws-renderer-view dsh-ws-renderer-image' },
    h('img', { alt: name, src: url }))
}
