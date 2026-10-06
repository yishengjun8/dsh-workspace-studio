/* The explorer's placeholder for "no workspace": the two sections it would otherwise render, portalled
 * into the sidebar's files region exactly like the real tree.
 *
 * It lives here rather than in components/settings.js: it is explorer chrome, not a settings surface, and
 * that module has no other reason to know about `treePortalTarget`.
 */
import { createElement as h, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { translate } from '../../locale/index.js'
import { PanelHeader } from '../menus.js'

export function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle }) {
  const treeSection = h('section', { className: 'dsh-ws-tree' },
    h(PanelHeader, { title: sessionTitle ?? translate('panel.workspaceFiles'), subtitle: translate('panel.noWorkspace') }),
    h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseSession')))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-ws-preview' },
      h(PanelHeader, { title: translate('panel.filePreview'), subtitle: translate('panel.noWorkspace') }),
      h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseWorkspaceToBrowse'))))
}
