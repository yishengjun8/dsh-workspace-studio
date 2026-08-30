import { createElement as h } from 'react'
import { translate } from '../../locale/index.js'
import { IconCloseWin10, IconPinVscode } from '../../icons.js'

/* Preview tab strip: one tab per open file, with pin/close actions, drag
   reordering (drop indicators), and the tab context menu trigger. All
   interactions are callbacks; the container ref + scroll handlers live here. */
export function PreviewTabs({ tabs, activePath, draggingPath, dropIndex, containerRef, onChoose, onClose, onContextMenu, onDragEnd, onDragStart, onDragLeave, onDragOver, onDrop, onMouseEnter, onMouseLeave, onScroll, onUnpin }) {
  const nodes = []
  for (const [index, tab] of tabs.entries()) {
    if (draggingPath !== null && dropIndex === index) nodes.push(h('div', { 'aria-hidden': true, className: 'dsh-ws-preview-drop-indicator', key: `drop:${index}` }))
    nodes.push(h('div', {
      className: 'dsh-ws-preview-tab',
      'data-active': tab.path === activePath || undefined,
      'data-dragging': draggingPath === tab.path || undefined,
      'data-path': tab.path,
      draggable: true,
      key: tab.path,
      onContextMenu: event => { event.preventDefault(); onContextMenu(tab.path, event.clientX, event.clientY) },
      onDragEnd: () => onDragEnd(),
      onDragStart: event => onDragStart(tab.path, event),
      title: tab.path,
    },
      h('button', {
        className: 'dsh-ws-preview-tab-button',
        onClick: () => onChoose(tab),
        role: 'tab',
        'aria-selected': tab.path === activePath,
        title: tab.path,
        type: 'button',
      }, h('span', { className: 'dsh-ws-preview-tab-name' }, tab.name), tab.dirty ? h('span', { className: 'dsh-ws-dirty', title: translate('tab.dirty') }, '·') : null),
      tab.pinned
        ? h('button', {
          'aria-label': translate('tab.unpinAria', { name: tab.name }),
          className: 'dsh-ws-preview-tab-close',
          'data-pinned': true,
          onClick: event => { event.stopPropagation(); onUnpin(tab.path) },
          title: translate('tab.unpin'),
          type: 'button',
        }, h(IconPinVscode))
        : h('button', {
          'aria-label': translate('tab.closeAria', { name: tab.name }),
          className: 'dsh-ws-preview-tab-close',
          /* A dirty tab is close-guarded only while EDITABLE: a non-editable
             file with a leftover draft has no save/cancel path, so its close
             must stay enabled (closeTab drops the staging draft — the escape
             documented in development-notes §15). */
          disabled: (tab.dirty && tab.editing !== false) || tab.saving || undefined,
          onClick: event => { event.stopPropagation(); onClose(tab.path) },
          title: (tab.dirty && tab.editing !== false) || tab.saving ? translate('tab.close.title') : translate('tab.close'),
          type: 'button',
        }, h(IconCloseWin10)),
    ))
  }
  if (draggingPath !== null && dropIndex === tabs.length) nodes.push(h('div', { 'aria-hidden': true, className: 'dsh-ws-preview-drop-indicator', key: 'drop:end' }))
  return h('div', { ref: containerRef, className: 'dsh-ws-preview-tabs', role: 'tablist', 'aria-label': translate('tab.list'), onDragLeave, onDragOver, onDrop, onMouseEnter, onMouseLeave, onScroll }, nodes)
}
