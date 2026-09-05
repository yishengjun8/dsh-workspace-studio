import { createElement as h, Fragment } from 'react'
import { translate } from '../../locale/index.js'
import { TreeRenameRow, TreeRow, TreeStatus } from '../menus.js'

/* Pure render of the explorer's tree state; all interactions are callbacks. */
export function ExplorerTree({ directories, expanded, entryDialog, entryBusy, entryDraft, entryDialogError, clipboard, selected, onCloseEntryDialog, onConfirmEntryDialog, onDraftEntry, onContextMenu, onDirectory, onFile, onSelect, onRename, containerRef }) {
  const renderDirectory = (path, depth) => {
    const dir = directories.get(path)
    if (!dir || dir.state === 'loading') return h(TreeStatus, { key: `${path}:loading` }, translate('tree.loading'))
    if (dir.state === 'error') return h(TreeStatus, { error: true, key: `${path}:error` }, dir.message)
    const rows = dir.entries.map(entry => {
      const open = expanded.has(entry.path)
      const renaming = entryDialog?.mode === 'rename' && entryDialog.entry.path === entry.path
      return h(Fragment, { key: entry.path },
        renaming
          ? h(TreeRenameRow, { busy: entryBusy, depth, entry, error: entryDraft.trim() === entry.name ? undefined : entryDialogError, expanded: open, onCancel: onCloseEntryDialog, onConfirm: onConfirmEntryDialog, onDraft: onDraftEntry, value: entryDraft })
          /* Focus follows selection (and vice versa): a row reached by Tab must
             become the keyboard target (Delete/Copy/Cut/Paste operate on
             `selected`, so a focus-only row would delete the WRONG entry). */
          : h(TreeRow, { cut: clipboard?.cut && clipboard?.path === entry.path, depth, entry, expanded: open, onContextMenu: onContextMenu, onDirectory: onDirectory, onFile: onFile, onFocus: onSelect === undefined ? undefined : () => onSelect(entry), onRename: onRename, selected: selected?.path === entry.path }),
        entry.kind === 'directory' && open ? renderDirectory(entry.path, depth + 1) : null)
    })
    if (!rows.length) rows.push(h(TreeStatus, { key: `${path}:empty` }, translate('tree.empty')))
    return rows
  }
  return h('div', { className: 'dsh-ws-tree-scroll', ref: containerRef }, renderDirectory('', 0))
}
