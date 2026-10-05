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
import { useCallback, useState } from 'react'
import { translate } from '../locale/index.js'
import { useRemoteBytes } from './remote-bytes.js'
import { RendererStatus } from './status.js'
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
  /* Manual retry after a conversion failure (a locked source, a transient engine
     fault): bumping the nonce re-runs the read below and bypasses its cache. */
  const [retry, setRetry] = useState(0)
  const source = kind === 'office' ? office : faces
  const decorate = useCallback(
    value => (Array.isArray(value?.missingFonts) ? value.missingFonts : []),
    [],
  )
  const { url, failure, extra } = useRemoteBytes({
    scope: kind === 'office' ? 'office' : 'pdf',
    read: source === undefined ? undefined : (kind === 'office' ? source.renderOffice : source.readAll),
    sessionId,
    path,
    mime: 'application/pdf',
    readEpoch,
    retry,
    decorate,
  })
  if (failure !== undefined) {
    return h(RendererStatus, {
      message: failureMessage(failure),
      error: true,
      onRetry: () => setRetry(value => value + 1),
      retryLabel: translate('renderer.retry'),
    })
  }
  if (url === undefined) {
    return h(RendererStatus, {
      message: kind === 'office' ? translate('renderer.officeLoading') : translate('renderer.pdfLoading'),
    })
  }
  return h('div', { className: 'dsh-ws-renderer-view dsh-ws-renderer-converted' },
    Array.isArray(extra) && extra.length > 0
      ? h('div', { className: 'dsh-ws-banner' }, translate('renderer.officeMissingFonts', { fonts: extra.join(', ') }))
      : null,
    h('iframe', {
      className: 'dsh-ws-pdf-frame',
      src: url,
      title: name === undefined || name === null || name === '' ? translate('renderer.pdf') : String(name),
    }))
}
