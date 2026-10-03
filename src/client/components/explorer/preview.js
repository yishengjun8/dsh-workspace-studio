import { createElement as h, Fragment } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { translate } from '../../locale/index.js'
import { colorGroupOf, diffColorVars, highlightPresetOf, readOnlyReason } from '../../format.js'
import { CodeEditor } from '../editor.js'
import { BrowseView } from '../../renderers/browse-view.js'
import { ConvertedView } from '../../renderers/converted-view.js'
import { HtmlPreview } from '../../renderers/html-preview.js'
import { ImageView } from '../../renderers/image-view.js'
import { useMarkdownLabels } from '../../renderers/registry.js'
import { isRunnableName } from '../../run-detect.js'
import { isSyntheticTab } from '../../preview-tabs.js'
import { RunConsole } from './run-panel.js'

/* Preview pane body: idle/loading/error states, the CodeMirror editor (kept mounted under the rendered-Markdown overlay so switching back keeps caret, undo history and the draft), and the search-panel mount point. Renderer dispatch is registry-driven: images render standalone, read-only text files browse as a paged view, and everything else keeps the editor with Markdown/HTML overlays in preview mode.
 *
 * An executable file additionally gets the run console: the body becomes the UPPER half of a
 * two-part split and the console the lower one (see run-panel.js). Only workspace files are
 * eligible — a dropped-in or outside-workspace tab has no workspace-relative path for the Host's
 * runner, and a synthetic tab (map/plan/review) is not a file at all. */
export function PreviewPane({ preview, settings, editing, activeTab, draft, viewMode, isMarkdown, isHtmlFile, isBrowse, browseKind, sessionId, searchReveal, readEpoch, activePath, editorRef, searchPanelContainerRef, scrollTopRef, restore, onViewState, onDirty, onSaveShortcut, onScroll, onRevealApplied, onBodyClick, onSearchPanelContextMenu, onContext, diffBase, onDiffSummary, workspaceId }) {
  const markdownLabels = useMarkdownLabels()
  /* The tab a run console can belong to: a real workspace file whose name is on the runner's
     whitelist. Everything else renders exactly as before, with no extra wrapper at all. */
  const runTab = activeTab !== undefined
    && !isSyntheticTab(activeTab)
    && activeTab.external !== true
    && activeTab.outside !== true
    && isRunnableName(activeTab.name)
    ? activeTab
    : undefined
  /* Wrap one rendered body in the split, or hand it back untouched when there is no console. */
  const withRun = (node) => runTab === undefined
    ? node
    : h('div', { className: 'dsh-ws-run-split' },
      h('div', { className: 'dsh-ws-run-code' }, node),
      h(RunConsole, { key: runTab.path, name: runTab.name, path: runTab.path, workspaceId }))
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
  /* Image files never enter the text read path; the standalone view fetches complete bytes through the standard workspace-files Remote. */
  if (preview.kind === 'image') {
    return withRun(h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(ImageView, { name: preview.name, path: preview.path, readEpoch, sessionId })))
  }
  /* PDF and Office documents render from bytes too: a PDF as it is, an Office
     source as the Host-converted PDF of it (see ConvertedView). */
  if (preview.kind === 'pdf' || preview.kind === 'office') {
    return withRun(h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(ConvertedView, { kind: preview.kind, name: preview.name, path: preview.path, readEpoch, sessionId })))
  }
  /* Read-only browse: paged full-file view for non-editable text files. */
  if (isBrowse) {
    return withRun(h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(BrowseView, { key: preview.path, kind: browseKind, name: preview.name, path: preview.path, readEpoch, sessionId })))
  }
  const highlightPreset = highlightPresetOf(settings, colorGroupOf({ kind: 'file', name: preview.name }))
  const previewReason = readOnlyReason(preview)
  return withRun(h(Fragment, null,
    preview.truncated ? h('div', { className: 'dsh-ws-banner' }, translate('editor.previewTruncated')) : null,
    previewReason && !preview.truncated ? h('div', { className: 'dsh-ws-banner' }, translate('editor.cannotEdit', { reason: previewReason })) : null,
    h('div', { className: 'dsh-ws-preview-search', ref: searchPanelContainerRef, onContextMenu: onSearchPanelContextMenu }),
    h('div', { className: 'dsh-ws-preview-body', onClick: onBodyClick },
      h(CodeEditor, {
        key: `${preview.path}:${preview.encoding}:${readEpoch}`,
        editorRef,
        // Freeze edits only for the tab being saved (per-tab flag), so switching files during a save doesn't lock the new one.
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
        onDirty,
        onSaveShortcut,
        onScroll,
        /* Change gutter: the base text (HEAD / SVN BASE), its tone palette and the line wash; the
           editor diffs the base against its own live buffer and reports the counts back. */
        diffBase: diffBase ?? null,
        diffColors: diffColorVars(settings),
        diffLineTint: settings.diffLineTint !== false,
        onDiffSummary,
        reveal: searchReveal !== undefined && preview.state === 'ready' && activeTab !== undefined && searchReveal.path === activeTab.path
          ? searchReveal
          : null,
        scrollTop: scrollTopRef.current.get(activePath) ?? activeTab?.scrollTop ?? 0,
      }),
      // Rendered-Markdown overlay sits above the kept-mounted editor so switching back keeps caret/undo state and the draft. The preview text size is not applied here: it sizes the source editor, which is why the header hides its control in this view.
      isMarkdown && viewMode === 'preview'
        ? h('div', { className: 'dsh-ws-md-preview' }, h(MarkdownText, { text: draft, labels: markdownLabels }))
        : null,
      // Rendered-page overlay for HTML files: the iframe draws the current draft via srcDoc, sandboxed to a unique origin so scripts run but cannot read dsh storage or call the plugin API; relative classic scripts/stylesheets are packed in, and every other relative URL (images, fonts, CSS url(), runtime-built paths) resolves through the token-gated site route installed as the frame's <base>.
      isHtmlFile && viewMode === 'preview'
        ? h(HtmlPreview, { draft, path: preview.path, readEpoch, sessionId, workspaceId })
        : null),
  ))
}
