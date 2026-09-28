import { createElement as h } from 'react'
import { translate } from '../../locale/index.js'
import { DISK_STATE_CLEAN, DISK_STATE_CONFLICT, DISK_STATE_GONE, DISK_STATE_STALE } from '../../constants.js'
import { isPlanTab, isReviewTab, isSyntheticTab, isTemporaryTab } from '../../preview-tabs.js'
import { IconCloseWin10, IconPinVscode } from '../../icons.js'

/* One 12px slot between the name and the close button carries every runtime tab state:
   a filled dot for unsaved edits, a hollow ring for "the disk moved", a two-tone dot
   for both at once, and a slashed red ring for a deleted file. Only `stale` is
   interactive — clicking it reloads that path; the other states deliberately offer no
   reload, because one would discard unsaved work (conflict) or has nothing to read
   (gone, closed with the × instead). */
function tabMark(tab, onReload) {
  const state = typeof tab.diskState === 'string' ? tab.diskState : DISK_STATE_CLEAN
  const dirty = tab.dirty === true
  const kind = state === DISK_STATE_GONE ? 'gone'
    : state === DISK_STATE_CONFLICT ? 'conflict'
      : state === DISK_STATE_STALE ? (dirty ? 'conflict' : 'stale')
        : (dirty ? 'dirty' : null)
  if (kind === null) return null
  const title = kind === 'dirty' ? translate('tab.dirty')
    : kind === 'stale' ? translate('tab.diskChanged')
      : kind === 'conflict' ? translate('tab.diskChangedDirty')
        : translate('tab.diskRemoved')
  if (kind === 'stale') {
    return h('button', {
      'aria-label': translate('tab.reloadAria', { name: tab.name }),
      className: 'dsh-ws-preview-tab-mark',
      'data-kind': 'stale',
      onClick: event => { event.stopPropagation(); onReload(tab.path) },
      title,
      type: 'button',
    },
      h('span', { 'aria-hidden': true, className: 'dsh-ws-mark-core' }),
      h('span', { 'aria-hidden': true, className: 'dsh-ws-mark-reload' }, '↻'))
  }
  return h('span', { className: 'dsh-ws-preview-tab-mark', 'data-kind': kind, title },
    h('span', { 'aria-hidden': true, className: 'dsh-ws-mark-core' }))
}

/* Preview tab strip: one tab per open file with pin/close, drag reordering, and context-menu trigger; all interactions are callbacks. */
export function PreviewTabs({ tabs, activePath, draggingPath, dropIndex, containerRef, onChoose, onClose, onContextMenu, onDragEnd, onDragStart, onDragLeave, onDragOver, onDrop, onMouseEnter, onMouseLeave, onPromote, onReload, onScroll, onUnpin }) {
  const nodes = []
  for (const [index, tab] of tabs.entries()) {
    /* A synthetic tab's path addresses a map, a plan, or a change review, not a file: its label is its name, never the path. */
    const tabTitle = isSyntheticTab(tab) ? tab.name : tab.path
    if (draggingPath !== null && dropIndex === index) nodes.push(h('div', { 'aria-hidden': true, className: 'dsh-ws-preview-drop-indicator', key: `drop:${index}` }))
    nodes.push(h('div', {
      className: 'dsh-ws-preview-tab',
      'data-active': tab.path === activePath || undefined,
      'data-dragging': draggingPath === tab.path || undefined,
      /* Transient runtime flag set by an AUTO-mode reload, cleared by its timer: the CSS animation restarts only when the attribute comes back, so the flag is never persisted. */
      'data-flash': tab.flash === true || undefined,
      'data-path': tab.path,
      /* A single-click preview tab is italic (styled in styles.js) until it is made permanent by a double-click, an edit, or a pin. */
      'data-temporary': isTemporaryTab(tab) || undefined,
      draggable: true,
      key: tab.path,
      onContextMenu: event => { event.preventDefault(); onContextMenu(tab.path, event.clientX, event.clientY) },
      onDragEnd: () => onDragEnd(),
      onDragStart: event => onDragStart(tab.path, event),
      title: tabTitle,
    },
      /* Small tabbed-panel glyph marks a docked mind map. */
      tab.kind === 'mindmap'
        ? h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tab-mindmap' },
          h('svg', { viewBox: '0 0 16 16' },
            h('path', {
              d: 'M2.5 6.5A1.5 1.5 0 0 1 4 5h8a1.5 1.5 0 0 1 1.5 1.5V11A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11ZM5.5 5V3.5A.5.5 0 0 1 6 3h4a.5.5 0 0 1 .5.5V5',
              fill: 'none',
              stroke: 'currentColor',
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              strokeWidth: 1.5,
            })))
        : null,
      /* A document glyph marks an opened plan. */
      isPlanTab(tab)
        ? h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tab-plan' },
          h('svg', { viewBox: '0 0 16 16' },
            h('path', {
              d: 'M3.5 2.5h6L13 6v7.5H3.5ZM9.5 2.5V6H13M5.5 8.5h5M5.5 11h5',
              fill: 'none',
              stroke: 'currentColor',
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              strokeWidth: 1.5,
            })))
        : null,
      /* A comparison glyph marks an opened change review. */
      isReviewTab(tab)
        ? h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tab-review' },
          h('svg', { viewBox: '0 0 16 16' },
            h('path', {
              d: 'M3 4.5h6M3 8h10M7 11.5h6',
              fill: 'none',
              stroke: 'currentColor',
              strokeLinecap: 'round',
              strokeWidth: 1.5,
            })))
        : null,
      h('button', {
        className: 'dsh-ws-preview-tab-button',
        onClick: () => onChoose(tab),
        onDoubleClick: () => onPromote(tab.path),
        role: 'tab',
        'aria-selected': tab.path === activePath,
        title: tabTitle,
        type: 'button',
      }, h('span', { className: 'dsh-ws-preview-tab-name' }, tab.name)),
      tabMark(tab, onReload),
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
          /* A dirty tab is close-guarded only while editable: a non-editable file with a leftover draft has no save/cancel path, so its close stays enabled. */
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
