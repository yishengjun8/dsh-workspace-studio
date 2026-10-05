/* Read-only browse view: pages the full file via the read Remote (the editor is capped at maxPreviewBytes) and renders it as MarkdownText / CodeBlock / plain text. */
import { createElement as h } from 'react'
import { useCallback } from 'react'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { translate } from '../locale/index.js'
import { shikiLanguageFor, useMarkdownLabels } from './registry.js'
import { usePagedText } from './paged-text.js'
import { RendererStatus } from './status.js'

export function BrowseView({ sessionId, path, name, kind, readEpoch }) {
  const markdownLabels = useMarkdownLabels()
  const { text, eof, loading, failure, loadMore } = usePagedText(sessionId, path, readEpoch)
  const onScroll = useCallback((event) => {
    const body = event.currentTarget
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 1) loadMore()
  }, [loadMore])
  if (failure !== undefined) {
    const message = failure?.unavailable === true
      ? translate('renderer.unavailable')
      : translate('renderer.loadFailed', { message: failure?.message ?? '' })
    return h(RendererStatus, { message, error: true })
  }
  if (text === '' && loading) {
    return h(RendererStatus, { message: translate('renderer.loading') })
  }
  const copyLabel = translate('renderer.copy')
  const copiedLabel = translate('renderer.copied')
  return h('div', { className: 'dsh-ws-renderer-view dsh-ws-renderer-browse', onScroll },
    /* The paged browse is a preview state: the preview text size sizes the source editor only, and
       the header hides its control here, so these harness primitives keep their own type sizes. */
    kind === 'markdown'
      ? h(MarkdownText, { text, streaming: !eof, labels: markdownLabels })
      : h(CodeBlock, {
        code: text,
        copyLabel,
        copiedLabel,
        lang: shikiLanguageFor(name),
        lineNumbers: true,
        streaming: !eof,
      }),
    !eof
      ? h('button', {
        className: 'dsh-ws-renderer-more',
        disabled: loading,
        onClick: loadMore,
        type: 'button',
      }, loading ? translate('renderer.loading') : translate('renderer.loadMore'))
      : null,
  )
}
