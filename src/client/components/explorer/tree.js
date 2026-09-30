import { createElement as h, Fragment } from 'react'
import { translate } from '../../locale/index.js'
import { isIgnoredPath, vcsDirectoryBadge, vcsRowFilter } from '../../vcs.js'
import { TreeRenameRow, TreeRow, TreeStatus } from '../menus.js'

/* Pure render of the explorer's tree state; all interactions are callbacks.
 *
 * `overlay` is the version-control view model (badges, directory roll-ups, deleted ghosts); it is
 * empty-but-defined for a workspace without a repository, where every row renders exactly as it did
 * before. `changesOnly` keeps only the paths (and their ancestor directories) that carry a change;
 * `hideMetadataDirs` drops `.git` / `.svn` from the display only — search and file operations are
 * unaffected because they never go through this render. */
export function ExplorerTree({ directories, expanded, entryDialog, entryBusy, entryDraft, entryDialogError, clipboard, selected, overlay, changesOnly, changesLoading, hideMetadataDirs, onCloseEntryDialog, onConfirmEntryDialog, onDraftEntry, onContextMenu, onDirectory, onFile, onFilePermanent, onSelect, onRename, containerRef }) {
  const hasOverlay = overlay !== undefined
  /* Hidden metadata directories and the changes-only filter live in the pure vcsRowFilter. */
  const visible = vcsRowFilter(overlay, { changesOnly, hideMetadataDirs })
  const badgeOf = entry => {
    if (!hasOverlay) return undefined
    const known = overlay.byPath.get(entry.path)
    if (known !== undefined) return known.badge
    return entry.kind === 'directory' ? vcsDirectoryBadge(overlay, entry.path) : undefined
  }
  const renderDirectory = (path, depth) => {
    const dir = directories.get(path)
    if (!dir || dir.state === 'loading') return h(TreeStatus, { key: `${path}:loading` }, translate('tree.loading'))
    if (dir.state === 'error') return h(TreeStatus, { error: true, key: `${path}:error` }, dir.message)
    const rows = dir.entries.filter(visible).map(entry => {
      const open = expanded.has(entry.path)
      const renaming = entryDialog?.mode === 'rename' && entryDialog.entry.path === entry.path
      return h(Fragment, { key: entry.path },
        renaming
          ? h(TreeRenameRow, { busy: entryBusy, depth, entry, error: entryDraft.trim() === entry.name ? undefined : entryDialogError, expanded: open, onCancel: onCloseEntryDialog, onConfirm: onConfirmEntryDialog, onDraft: onDraftEntry, value: entryDraft })
          /* Focus follows selection so a Tab-reached row becomes the keyboard target (Delete/Copy/Cut/Paste act on `selected`). */
          : h(TreeRow, {
            badge: badgeOf(entry),
            cut: clipboard?.cut && clipboard?.path === entry.path,
            depth,
            entry,
            expanded: open,
            ignored: isIgnoredPath(overlay?.ignoredPrefixes, entry.path),
            onContextMenu: onContextMenu,
            onDirectory: onDirectory,
            onFile: onFile,
            onFilePermanent: onFilePermanent,
            onFocus: onSelect === undefined ? undefined : () => onSelect(entry),
            onRename: onRename,
            selected: selected?.path === entry.path,
          }),
        entry.kind === 'directory' && open ? renderDirectory(entry.path, depth + 1) : null)
    })
    /* Deleted paths are gone from the directory listing, so their only in-tree representation is a
       ghost row appended under the (still existing) parent directory. */
    const ghosts = overlay?.ghostsByDir?.get(path)
    if (ghosts !== undefined) {
      for (const ghost of ghosts) {
        rows.push(h(TreeRow, {
          badge: ghost.badge,
          deleted: true,
          depth,
          entry: { kind: 'file', name: ghost.name, path: ghost.path, symlink: false },
          expanded: false,
          key: `ghost:${ghost.path}`,
          onContextMenu: onContextMenu,
          onDirectory: onDirectory,
          onFile: onFile,
          onFilePermanent: onFilePermanent,
          onRename: onRename,
        }))
      }
    }
    if (!rows.length) {
      /* The changes-only root says "no changes" only once the status read has answered; while it is
         still in flight an empty tree would wrongly claim the workspace is clean. */
      const emptyKey = changesOnly === true && path === ''
        ? (changesLoading === true ? 'tree.loading' : 'vcs.changes.treeEmpty')
        : 'tree.empty'
      rows.push(h(TreeStatus, { key: `${path}:empty` }, translate(emptyKey)))
    }
    return rows
  }
  return h('div', { className: 'dsh-ws-tree-scroll', ref: containerRef }, renderDirectory('', 0))
}
