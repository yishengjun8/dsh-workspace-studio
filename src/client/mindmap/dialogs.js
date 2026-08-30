/** Mind-map confirmation dialogs: rename (shared component), archive branch,
 *  delete card, regenerate-all confirm, and archive whole map. Pure forwarding —
 *  all state and handlers stay in the view. */
import { Fragment, createElement as h } from 'react'
import { translate } from '../locale/index.js'
import { SessionRenameDialog } from '../components/dialogs.js'

export function MindMapDialogs({
  renameTarget, renameBusy, renameError, onRenameCancel, onRenameConfirm, onRenameDraft,
  archiveTarget, archiveBusy, archiveError, onArchiveCancel, onArchiveConfirm,
  deleteTarget, deleteBusy, deleteError, onDeleteCancel, onDeleteConfirm,
  archiveBranchTarget, archiveBranchBusy, archiveBranchError, onArchiveBranchCancel, onArchiveBranchConfirm,
  regenerateAllTarget, regenerateAllBusy, regenerateAllError, onRegenerateAllCancel, onRegenerateAllConfirm,
}) {
  const renameView = renameTarget !== null ? h(SessionRenameDialog, {
    busy: renameBusy,
    draft: renameTarget.title,
    error: renameError,
    onCancel: onRenameCancel,
    onConfirm: onRenameConfirm,
    onDraft: onRenameDraft,
    title: translate('mindmap.rename.title'),
  }) : null
  const archiveView = archiveTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !archiveBusy) onArchiveCancel() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-mindmap-archive-dialog', role: 'dialog' },
      /* Red→amber warning band across the very top of the dialog. */
      h('div', { className: 'dsh-ws-mindmap-archive-band' }),
      h('div', { className: 'dsh-ws-dialog-header' },
        /* Amber ⚠ badge: the "warning" cue before the title. */
        h('span', { 'aria-hidden': true, className: 'dsh-ws-mindmap-archive-badge' },
          h('svg', { viewBox: '0 0 24 24' },
            h('path', { d: 'M12 3 2.8 20.2A1 1 0 0 0 3.7 21.7h16.6a1 1 0 0 0 .9-1.5Z', fill: 'none', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.9 }),
            h('path', { d: 'M12 9.5v4.4M12 16.9v.2', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 2 }))),
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.menu.archiveAll')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: archiveBusy, onClick: onArchiveCancel, title: translate('dialog.close'), type: 'button' },
          h('svg', { 'aria-hidden': true, viewBox: '0 0 24 24' },
            h('path', { d: 'M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 2.2 })))),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' },
          translate('mindmap.archiveAll.message', { name: archiveTarget.title })),
        archiveError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, archiveError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBusy, onClick: onArchiveCancel, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button dsh-ws-mindmap-archive-ok', disabled: archiveBusy, onClick: onArchiveConfirm, type: 'button' }, archiveBusy ? translate('dialog.processing') : translate('mindmap.archive.action')))))
    : null
  const deleteView = deleteTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !deleteBusy) onDeleteCancel() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog', role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.delete.title')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: deleteBusy, onClick: onDeleteCancel, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.delete.message', { name: deleteTarget.label })),
        deleteTarget.willArchiveCurrent ? h('div', { className: 'dsh-ws-dialog-warning', role: 'alert' }, translate('mindmap.delete.current')) : null,
        deleteError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, deleteError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: deleteBusy, onClick: onDeleteCancel, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: deleteBusy, onClick: onDeleteConfirm, type: 'button' }, deleteBusy ? translate('dialog.processing') : translate('mindmap.delete.action')))))
    : null
  const archiveBranchView = archiveBranchTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !archiveBranchBusy) onArchiveBranchCancel() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-mindmap-confirm-dialog', role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.archiveBranch.title')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: archiveBranchBusy, onClick: onArchiveBranchCancel, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.archiveBranch.message', { name: archiveBranchTarget.label })),
        archiveBranchTarget.willArchiveCurrent ? h('div', { className: 'dsh-ws-dialog-warning', role: 'alert' }, translate('mindmap.delete.current')) : null,
        archiveBranchError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, archiveBranchError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBranchBusy, onClick: onArchiveBranchCancel, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: archiveBranchBusy, onClick: onArchiveBranchConfirm, type: 'button' }, archiveBranchBusy ? translate('dialog.processing') : translate('mindmap.archiveBranch.action')))))
    : null
  const regenerateAllView = regenerateAllTarget !== null ? h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => { if (event.target === event.currentTarget && !regenerateAllBusy) onRegenerateAllCancel() },
  },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-mindmap-confirm-dialog', role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.summary.regenerateAll')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', disabled: regenerateAllBusy, onClick: onRegenerateAllCancel, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
        h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.summary.regenerateAll.message', { n: regenerateAllTarget.count })),
        regenerateAllError !== null ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, regenerateAllError) : null),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', disabled: regenerateAllBusy, onClick: onRegenerateAllCancel, type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: regenerateAllBusy, onClick: onRegenerateAllConfirm, type: 'button' }, regenerateAllBusy ? translate('dialog.processing') : translate('mindmap.summary.regenerateAll.action')))))
    : null
  return h(Fragment, null, renameView, archiveView, deleteView, archiveBranchView, regenerateAllView)
}
