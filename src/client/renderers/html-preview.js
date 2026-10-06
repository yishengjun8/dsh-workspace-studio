/* Rendered HTML preview: the draft stays the iframe's source.
   Primary path: the Host mints a token for the document's directory, installed as the frame's
   <base>, so the BROWSER resolves every relative URL — images, fonts, media, CSS url() references,
   scripts, stylesheets, and paths a page script builds at runtime — through the token-gated site
   route inside the workspace. Without that route a srcdoc document resolves relative URLs against
   the embedding application page and every one of them 404s.
   Fallback path (no token: an older Host, or a tab the route refuses): relative classic scripts and
   stylesheets are packed through the readBytes(baseFile) Remote face. Packing is debounced, and a
   required-asset failure then falls back to the raw draft with a notice. */
import { createElement as h } from 'react'
import { useEffect, useRef, useState } from 'react'
import { translate } from '../locale/index.js'
import { mintPreviewSite } from '../api.js'
import { isAbsoluteWorkspacePath } from '../paths.js'
import { useRemoteFaces } from './remote.js'
import { createHtmlDocument, packHtml } from './html-pack.js'

const PACK_DEBOUNCE_MS = 400

export function HtmlPreview({ sessionId, path, draft, readEpoch, workspaceId }) {
  const [srcDoc, setSrcDoc] = useState(draft ?? '')
  const [assetFailed, setAssetFailed] = useState(false)
  const packSeqRef = useRef(0)
  /* Bytes of the assets already read for the document currently open (session + path + read
     epoch). Only the fallback path reads assets, but it re-runs on every debounced draft change,
     and re-reading a file each keystroke would be waste. Failed reads are not cached (the next
     pack retries them) and a reload, which moves the epoch, drops the whole set. */
  const assetCacheRef = useRef({ key: '', entries: new Map() })
  /* The site base of the open document: minted once per document and kept with it, so a draft
     change re-packs without asking the Host for a new capability. */
  const siteCacheRef = useRef({ key: '', base: undefined })
  /* Re-pack when the Remote faces install (a view mounted before the harness
     Remote was ready). */
  const faces = useRemoteFaces()
  useEffect(() => {
    setSrcDoc(draft ?? '')
    setAssetFailed(false)
    /* A file OUTSIDE the workspace has no site route (the Host refuses to serve an outside
       directory tree), and its content does not come from the workspace Remote either: there is
       nothing this renderer can pack for it. */
    const outside = isAbsoluteWorkspacePath(path)
    /* Only the fallback path needs the workspace-files Remote, so the site route works even when
       that face never installed. */
    if (sessionId === undefined || sessionId === null) return undefined
    const cache = assetCacheRef.current
    const cacheKey = `${String(sessionId)}\u0000${path}\u0000${String(readEpoch ?? 0)}`
    if (cache.key !== cacheKey) {
      cache.key = cacheKey
      cache.entries = new Map()
    }
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
        const cached = cache.entries.get(relativePath)
        if (cached !== undefined) return Promise.resolve(cached)
        return faces.readRelated(String(sessionId), path, relativePath, signal).then((result) => {
          if (!result.ok) throw new Error(result.error.message)
          /* Native bytes, not base64 (the readBytes Remote). */
          const value = { data: result.value.data }
          cache.entries.set(relativePath, value)
          return value
        })
      }
      const site = siteCacheRef.current
      const siteKey = `${String(sessionId)}\u0000${String(workspaceId ?? '')}\u0000${path}\u0000${String(readEpoch ?? 0)}`
      const base = outside
        ? Promise.resolve(undefined)
        : site.key === siteKey
          ? site.base
          : mintPreviewSite(workspaceId, path, controller.signal).then((prefix) => {
            /* Cache only while this attempt is still the current one: a stale resolution must not
               install a base minted for a document the user already navigated away from. */
            if (siteCacheRef.current === site) {
              site.key = siteKey
              site.base = prefix
            }
            return prefix
          }).catch(() => undefined)
      void Promise.resolve(base).then((resolved) => resolved === undefined
        /* No site route: keep the pre-site behaviour and pack the relative js/css we can read. */
        ? packHtml(draft ?? '', readRelative, controller.signal).then(bundle => createHtmlDocument(bundle))
        : createHtmlDocument({ html: draft ?? '', assets: [] }, resolved))
        .then((document) => {
          if (seq !== packSeqRef.current || controller.signal.aborted) return
          setSrcDoc(document)
          setAssetFailed(false)
        })
        .catch(() => {
          if (seq !== packSeqRef.current || controller.signal.aborted) return
          // Required-asset read failure: keep the raw draft (live preview without assets).
          setAssetFailed(true)
        })
    }, PACK_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      packSeqRef.current += 1
    }
  }, [draft, faces, path, readEpoch, sessionId, workspaceId])
  return h('div', { className: 'dsh-ws-html-preview' },
    assetFailed ? h('div', { className: 'dsh-ws-banner' }, translate('renderer.assetFailed')) : null,
    /* The rendered page is a preview state: the preview text size sizes the source editor only, and
       the header hides its control here, so the frame keeps the page's own type sizes. */
    h('iframe', {
      sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads',
      srcDoc,
      title: translate('htmlPreview.preview'),
    }),
  )
}
