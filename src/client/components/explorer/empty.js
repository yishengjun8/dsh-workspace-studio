/* The explorer's placeholder for "no workspace": the two sections it would otherwise render, portalled
 * into the sidebar's files region exactly like the real tree.
 *
 * `loading` covers the other reason this placeholder can be on screen: the harness workspace/session
 * lists are still arriving, so there is no workspace to name yet. Reporting "no workspace selected"
 * there would be a lie about settled state — the same lie the removed guessed-workspace mount told.
 *
 * It lives here rather than in components/settings.js: it is explorer chrome, not a settings surface, and
 * that module has no other reason to know about `treePortalTarget`.
 */
import { createElement as h, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { translate } from '../../locale/index.js'
import { PanelHeader } from '../menus.js'

export function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle, loading = false }) {
  /* The subtitle reuses the tree's own in-flight wording; only the body needs copy of
     its own, so the dictionaries grow by exactly one key. */
  const subtitle = loading ? translate('tree.loading') : translate('panel.noWorkspace')
  const treeBody = loading ? translate('panel.loadingWorkspaces') : translate('panel.chooseSession')
  const previewBody = loading ? translate('panel.loadingWorkspaces') : translate('panel.chooseWorkspaceToBrowse')
  const treeSection = h('section', { className: 'dsh-ws-tree' },
    h(PanelHeader, { title: sessionTitle ?? translate('panel.workspaceFiles'), subtitle }),
    h('div', { className: 'dsh-ws-empty' }, treeBody))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-ws-preview' },
      h(PanelHeader, { title: translate('panel.filePreview'), subtitle }),
      h('div', { className: 'dsh-ws-empty' }, previewBody)))
}
