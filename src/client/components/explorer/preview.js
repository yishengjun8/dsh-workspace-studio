import { createElement as h, Fragment } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { translate } from '../../locale/index.js'
import { colorGroupOf, highlightPresetOf, readOnlyReason } from '../../format.js'
import { CodeEditor } from '../editor.js'

/* Preview pane body: idle/loading/error states, the CodeMirror editor (kept
   mounted under the rendered-Markdown overlay so switching back keeps caret,
   undo history and the draft), and the search-panel mount point. All editor
   callbacks (dirty/save/scroll/context) are props from the explorer shell. */
export function PreviewPane({ preview, settings, editing, activeTab, draft, mdPreview, isMarkdown, searchReveal, readEpoch, activePath, editorRef, searchPanelContainerRef, scrollTopRef, onDirty, onSaveShortcut, onScroll, onRevealApplied, onBodyClick, onSearchPanelContextMenu, onContext }) {
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
        readEpoch,
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
      isMarkdown && mdPreview
        ? h('div', { className: 'dsh-ws-md-preview' }, h(MarkdownText, { text: draft }))
        : null),
  )
}
