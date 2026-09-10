import { createElement as h, Fragment } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { translate } from '../../locale/index.js'
import { colorGroupOf, highlightPresetOf, readOnlyReason } from '../../format.js'
import { CodeEditor } from '../editor.js'
import { BrowseView } from '../../renderers/browse-view.js'
import { HtmlPreview } from '../../renderers/html-preview.js'
import { ImageView } from '../../renderers/image-view.js'

/* Preview pane body: idle/loading/error states, the CodeMirror editor (kept
   mounted under the rendered-Markdown overlay so switching back keeps caret,
   undo history and the draft), and the search-panel mount point. All editor
   callbacks (dirty/save/scroll/context) are props from the explorer shell.
   Renderer dispatch (registry-driven, mirroring the harness right-Sidebar
   document-preview pipeline): image files render standalone from complete
   bytes; read-only text files in browse mode render a paged full-file view;
   everything else keeps the editor, with Markdown/HTML overlays in preview
   mode. */
export function PreviewPane({ preview, settings, editing, activeTab, draft, viewMode, isMarkdown, isHtmlFile, isBrowse, browseKind, sessionId, searchReveal, readEpoch, activePath, editorRef, searchPanelContainerRef, scrollTopRef, restore, onViewState, onDirty, onSaveShortcut, onScroll, onRevealApplied, onBodyClick, onSearchPanelContextMenu, onContext }) {
  if (preview.state === 'idle') {
    return h('div', { className: 'dsh-ws-empty' }, translate('panel.previewHint'))
  }
  if (preview.state === 'loading') {
    return h('div', { className: 'dsh-ws-empty' }, translate('editor.loading'))
  }
  if (preview.state === 'error') {
    return h('div', { className: 'dsh-ws-empty' },
      h('div', { className: 'dsh-ws-error-card' }, preview.message))
  }
  /* Image files never enter the text read path: the standalone view fetches
     complete bytes through the standard workspace-files Remote. */
  if (preview.kind === 'image') {
    return h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(ImageView, { name: preview.name, path: preview.path, readEpoch, sessionId }))
  }
  /* Read-only browse: paged full-file view for non-editable text files. */
  if (isBrowse) {
    return h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(BrowseView, { key: preview.path, kind: browseKind, name: preview.name, path: preview.path, readEpoch, sessionId }))
  }
  const highlightPreset = highlightPresetOf(settings, colorGroupOf({ kind: 'file', name: preview.name }))
  const previewReason = readOnlyReason(preview)
  return h(Fragment, null,
    preview.truncated ? h('div', { className: 'dsh-ws-banner' }, translate('editor.previewTruncated')) : null,
    previewReason && !preview.truncated ? h('div', { className: 'dsh-ws-banner' }, translate('editor.cannotEdit', { reason: previewReason })) : null,
    h('div', { className: 'dsh-ws-preview-search', ref: searchPanelContainerRef, onContextMenu: onSearchPanelContextMenu }),
    h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(CodeEditor, {
        key: `${preview.path}:${preview.encoding}:${readEpoch}`,
        editorRef,
        // Freeze edits only for the tab being saved (per-tab saving flag, not the global
        // saving state), so switching to another editable file during a save doesn't lock it.
        editing: editing && !(activeTab?.saving === true),
        file: preview,
        highlightPreset,
        onRevealApplied: onRevealApplied,
        onViewState,
        readEpoch,
        restore,
        searchPanelContainer: searchPanelContainerRef,
        wrap: settings.wrap === true,
        onContext: onContext,
        onDirty: onDirty,
        onSaveShortcut: onSaveShortcut,
        onScroll: onScroll,
        reveal: searchReveal !== undefined && preview.state === 'ready' && activeTab !== undefined && searchReveal.path === activeTab.path
          ? searchReveal
          : null,
        scrollTop: scrollTopRef.current.get(activePath) ?? activeTab?.scrollTop ?? 0,
      }),
      // Rendered-Markdown overlay sits above the kept-mounted editor, so switching back keeps caret/undo state and the draft.
      isMarkdown && viewMode === 'preview'
        ? h('div', { className: 'dsh-ws-md-preview' }, h(MarkdownText, { text: draft }))
        : null,
      // Rendered-page overlay for HTML files: the iframe draws the current
      // draft via srcDoc (relative scripts/stylesheets packed in through the
      // standard readRelated Remote), sandboxed to a unique origin — scripts
      // run, but the page cannot read dsh storage or call the plugin API with
      // credentials.
      isHtmlFile && viewMode === 'preview'
        ? h(HtmlPreview, { draft, path: preview.path, sessionId })
        : null),
  )
}
