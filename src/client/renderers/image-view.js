/* Standalone image preview: complete bytes via the readAll Remote, rendered as a blob URL; re-fetches when the read epoch bumps. */
import { createElement as h } from 'react'
import { useEffect, useState } from 'react'
import { translate } from '../locale/index.js'
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
  const [state, setState] = useState({ url: undefined, failure: undefined })
  /* Re-fetch when the Remote faces install or the read epoch bumps. */
  const faces = useRemoteFaces()
  useEffect(() => {
    if (faces === undefined || sessionId === undefined || sessionId === null) {
      setState({ url: undefined, failure: { unavailable: true } })
      return undefined
    }
    const controller = new AbortController()
    setState({ url: undefined, failure: undefined })
    let url
    void faces.readAll(String(sessionId), path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) {
        setState({ url: undefined, failure: result.error })
        return
      }
      const bytes = Uint8Array.from(atob(result.value.data), character => character.charCodeAt(0))
      url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }))
      setState({ url, failure: undefined })
    })
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [faces, name, path, readEpoch, sessionId])
  if (state.failure !== undefined) {
    const message = state.failure?.unavailable === true
      ? translate('renderer.unavailable')
      : translate('renderer.loadFailed', { message: state.failure?.message ?? '' })
    return h('div', { className: 'dsh-ws-renderer-status', 'data-error': '' }, message)
  }
  if (state.url === undefined) {
    return h('div', { className: 'dsh-ws-renderer-status' }, translate('renderer.loading'))
  }
  return h('div', { className: 'dsh-ws-renderer-view dsh-ws-renderer-image' },
    h('img', { alt: name, src: state.url }))
}
