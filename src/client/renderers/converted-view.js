/* PDF and Office document preview: complete bytes rendered as a PDF inside the pane.
 *
 * Two sources, one presentation:
 *   - `kind === 'pdf'` reads the file's own bytes through the workspace-files
 *     Remote (`readBytes`, which never rejects binary content);
 *   - `kind === 'office'` asks the harness Host provider to convert a
 *     doc/docx/ppt/pptx/xls/xlsx source through the `officeToPdf` Remote
 *     (LibreOffice, bounded queue, content-addressed cache), returning PDF bytes.
 *
 * The bytes become one blob URL handed to the browser's own PDF viewer, which
 * keeps zoom, paging, text selection and printing without pulling a PDF engine
 * into this bundle. Nothing here touches the plugin's text preview: the Host
 * refuses binary content by design, so these tabs never read text, hold no
 * draft, and publish no editor context.
 *
 * Failure handling mirrors the image view: a missing Remote face is reported as
 * "unavailable" rather than thrown inside an effect (a synchronous throw there
 * trips the harness root error boundary, which replaces the whole layout). */
import { createElement as h } from 'react'
import { useEffect, useState } from 'react'
import { translate } from '../locale/index.js'
import { useOfficeFaces, useRemoteFaces } from './remote.js'

/* Localized copy for one Remote failure. The conversion provider declares its
   own reasons under `document-render/failed`; gateway codes mean the service
   itself is not mounted in this deployment. */
function failureMessage(failure) {
  const code = failure?.code
  if (failure?.unavailable === true || code === 'gateway/invocation-unavailable'
    || code === 'gateway/service-unavailable') {
    return translate('renderer.officeUnavailable')
  }
  if (code === 'document-render/failed') {
    const reason = failure?.details?.reason
    if (reason === 'input-too-large' || reason === 'output-too-large') return translate('renderer.officeTooLarge')
    if (reason === 'invalid-document' || reason === 'unsupported-format' || reason === 'invalid-output') return translate('renderer.officeInvalid')
    if (reason === 'timeout') return translate('renderer.officeTimeout')
    if (reason === 'busy') return translate('renderer.officeBusy')
    if (reason === 'source-changed') return translate('renderer.officeChanged')
    if (reason === 'unavailable') return translate('renderer.officeUnavailable')
    return translate('renderer.officeFailed')
  }
  return translate('renderer.loadFailed', { message: failure?.message ?? '' })
}

export function ConvertedView({ kind, sessionId, path, name, readEpoch }) {
  const faces = useRemoteFaces()
  const office = useOfficeFaces()
  const [state, setState] = useState({ url: undefined, failure: undefined, fonts: undefined })
  /* Manual retry after a conversion failure (a locked source, a transient engine
     fault): bumping the nonce re-runs the effect below. */
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const source = kind === 'office' ? office : faces
    const read = source === undefined ? undefined : (kind === 'office' ? source.renderOffice : source.readAll)
    if (typeof read !== 'function' || sessionId === undefined || sessionId === null) {
      setState({ url: undefined, failure: { unavailable: true }, fonts: undefined })
      return undefined
    }
    const controller = new AbortController()
    setState({ url: undefined, failure: undefined, fonts: undefined })
    let url
    Promise.resolve()
      .then(() => read(String(sessionId), path, controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setState({ url: undefined, failure: result.error, fonts: undefined })
          return
        }
        const fonts = Array.isArray(result.value?.missingFonts) ? result.value.missingFonts : []
        /* Native bytes, never base64 (DSH 0.1.7 readBytes / the Office Remote). */
        url = URL.createObjectURL(new Blob([result.value.data], { type: 'application/pdf' }))
        setState({ url, failure: undefined, fonts })
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setState({
          url: undefined,
          failure: { code: 'renderer-remote-failed', message: error instanceof Error ? error.message : String(error) },
          fonts: undefined,
        })
      })
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [faces, kind, office, path, readEpoch, retry, sessionId])
  if (state.failure !== undefined) {
    return h('div', { className: 'dsh-ws-renderer-status', 'data-error': '' },
      h('div', { className: 'dsh-ws-renderer-status-stack' },
        h('div', null, failureMessage(state.failure)),
        h('button', {
          className: 'dsh-ws-renderer-retry',
          type: 'button',
          onClick: () => setRetry(value => value + 1),
        }, translate('renderer.retry'))))
  }
  if (state.url === undefined) {
    return h('div', { className: 'dsh-ws-renderer-status' },
      kind === 'office' ? translate('renderer.officeLoading') : translate('renderer.pdfLoading'))
  }
  return h('div', { className: 'dsh-ws-renderer-view dsh-ws-renderer-converted' },
    state.fonts !== undefined && state.fonts.length > 0
      ? h('div', { className: 'dsh-ws-banner' }, translate('renderer.officeMissingFonts', { fonts: state.fonts.join(', ') }))
      : null,
    h('iframe', {
      className: 'dsh-ws-pdf-frame',
      src: state.url,
      title: name === undefined || name === null || name === '' ? translate('renderer.pdf') : String(name),
    }))
}
