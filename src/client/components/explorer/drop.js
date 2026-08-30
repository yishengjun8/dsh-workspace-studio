import { createElement as h } from 'react'
import { translate } from '../../locale/index.js'

/* Full-pane drop overlay shown while external files are dragged over the
   preview column: closing it suppresses the drop for this drag (the ref is
   read by the window-level drop handler). */
export function DropOverlay({ active, suppressedRef, onClose }) {
  if (!active) return null
  return h('div', { className: 'dsh-ws-drop-overlay', role: 'presentation' },
    h('button', { 'aria-label': translate('drop.closeAria'), className: 'dsh-ws-drop-close', onClick: () => { suppressedRef.current = true; onClose() }, title: translate('drop.closeTitle'), type: 'button' }, '×'),
    h('div', { className: 'dsh-ws-drop-hint' }, translate('drop.releaseFiles')))
}
