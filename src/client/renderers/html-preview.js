/* Rendered HTML preview: the draft stays the iframe's source, with relative scripts/stylesheets packed in via the readBytes(baseFile) Remote face (which also serves a document OUTSIDE the workspace); packing is debounced, and a pack failure falls back to the raw draft with a notice. */
import { createElement as h } from 'react'
import { useEffect, useRef, useState } from 'react'
import { translate } from '../locale/index.js'
import { useRemoteFaces } from './remote.js'
import { createHtmlDocument, packHtml } from './html-pack.js'

const PACK_DEBOUNCE_MS = 400

export function HtmlPreview({ sessionId, path, draft }) {
  const [srcDoc, setSrcDoc] = useState(draft ?? '')
  const [assetFailed, setAssetFailed] = useState(false)
  const packSeqRef = useRef(0)
  /* Re-pack when the Remote faces install (a view mounted before the harness
     Remote was ready). */
  const faces = useRemoteFaces()
  useEffect(() => {
    setSrcDoc(draft ?? '')
    setAssetFailed(false)
    if (faces === undefined || sessionId === undefined || sessionId === null) return undefined
    const seq = ++packSeqRef.current
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      /* Bind a package reader to the original HTML file's session and directory, preserving Host failures as rejections. */
      const readRelative = (reference, signal) => {
        const suffix = reference.search(/[?#]/u)
        const relativePath = decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix))
        if (relativePath.length === 0 || /^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(relativePath)
          || relativePath.includes('\0') || relativePath.includes('\\')) {
          return Promise.reject(new Error('HTML dependency must use a relative file path'))
        }
        return faces.readRelated(String(sessionId), path, relativePath, signal).then((result) => {
          if (!result.ok) throw new Error(result.error.message)
          /* Native bytes, not base64 (DSH 0.1.7 readBytes). */
          return { data: result.value.data }
        })
      }
      void packHtml(draft ?? '', readRelative, controller.signal).then((bundle) => {
        if (seq !== packSeqRef.current || controller.signal.aborted) return
        setSrcDoc(createHtmlDocument(bundle))
        setAssetFailed(false)
      }).catch(() => {
        if (seq !== packSeqRef.current || controller.signal.aborted) return
        // Asset read failure: keep the raw draft (live preview without assets).
        setAssetFailed(true)
      })
    }, PACK_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      packSeqRef.current += 1
    }
  }, [draft, faces, path, sessionId])
  return h('div', { className: 'dsh-ws-html-preview' },
    assetFailed ? h('div', { className: 'dsh-ws-banner' }, translate('renderer.assetFailed')) : null,
    h('iframe', {
      sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads',
      srcDoc,
      title: translate('htmlPreview.preview'),
    }))
}
