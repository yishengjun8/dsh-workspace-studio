/* Read-only browse view: pages the FULL file through the standard
   workspaceFiles.read Remote (the editor is capped at maxPreviewBytes) and
   renders it as MarkdownText / CodeBlock / plain text. Scroll-to-bottom
   appends the next page; a load-more button covers the no-scrollport case. */
import { createElement as h } from 'react'
import { useCallback } from 'react'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { translate } from '../locale/index.js'
import { shikiLanguageFor } from './registry.js'
import { usePagedText } from './paged-text.js'

export function BrowseView({ sessionId, path, name, kind, readEpoch }) {
  const { text, eof, loading, failure, loadMore } = usePagedText(sessionId, path, readEpoch)
  const onScroll = useCallback((event) => {
    const body = event.currentTarget
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 1) loadMore()
  }, [loadMore])
  if (failure !== undefined) {
    const message = failure?.unavailable === true
      ? translate('renderer.unavailable')
      : translate('renderer.loadFailed', { message: failure?.message ?? '' })
    return h('div', { className: 'dsh-ws-renderer-status', 'data-error': '' }, message)
  }
  if (text === '' && loading) {
    return h('div', { className: 'dsh-ws-renderer-status' }, translate('renderer.loading'))
  }
  const copyLabel = translate('renderer.copy')
  const copiedLabel = translate('renderer.copied')
  return h('div', { className: 'dsh-ws-renderer-view dsh-ws-renderer-browse', onScroll },
    kind === 'markdown'
      ? h(MarkdownText, { text, streaming: !eof })
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
