import { createElement as h } from 'react'
import { translate } from '../../locale/index.js'
import { DISK_STATE_CLEAN, DISK_STATE_CONFLICT, DISK_STATE_GONE, DISK_STATE_STALE } from '../../constants.js'
import { isMusicTab, isPermissionTab, isPlanTab, isReviewTab, isSyntheticTab, isTemporaryTab } from '../../preview-tabs.js'
import { getRunEntry, useRunVersion } from '../../run-store.js'
import { IconCloseWin10, IconPinVscode } from '../../icons.js'

/* One 12px slot between the name and the close button carries every runtime tab state: a filled dot for
   unsaved edits, a hollow ring for "the disk moved", a two-tone dot for both at once, and a slashed red
   ring for a deleted file. Only `stale` is interactive — clicking it reloads that path; the others
   deliberately offer no reload, because one would discard unsaved work (conflict) or has nothing to read
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

/* Collapse icon of the bottom pane: two stacked rows with the lower one folding away. */
const collapsePaneIcon = h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
  h('path', {
    d: 'M3.5 4.5h9M5.2 8l2.8 2.8L10.8 8',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.4,
  }))

/* Preview tab strip: one tab per open file with pin/close, drag reordering, and context-menu trigger; all interactions are callbacks. `bottom` marks the optional lower pane and adds the pane-collapse control. */
export function PreviewTabs({ tabs, activePath, bottom, draggingPath, dropIndex, containerRef, onBlankContextMenu, onChoose, onClose, onClosePane, onContextMenu, onDragEnd, onDragStart, onDragLeave, onDragOver, onDrop, onMouseEnter, onMouseLeave, onPromote, onReload, onScroll, onUnpin }) {
  /* Subscribe once to the run store: a process outlives the tab it was started in, so any open
     tab whose file is still running carries a badge — but per-tab hooks in a loop are not a thing. */
  useRunVersion()
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
      /* The whole tab is a target, not only its name: in the split layout clicking anywhere on
         the inactive pane's tab must focus that pane and activate the tab. The name button and
         the close button stop propagation so one click stays one activation. */
      onClick: () => onChoose(tab),
      onContextMenu: event => { event.preventDefault(); onContextMenu(tab.path, event.clientX, event.clientY) },
      onDragEnd: () => onDragEnd(),
      onDragStart: event => onDragStart(tab.path, event),
      title: tabTitle,
    },
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
      isMusicTab(tab)
        ? h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tab-music' },
          h('svg', { viewBox: '0 0 16 16' },
            /* Two beamed eighth notes: one beam+stem silhouette, then two tilted oval heads. */
            h('path', { d: 'M5.72 3.57 13.32 2.45 13.32 4.1 5.72 5.22Z', fill: 'currentColor' }),
            h('rect', { fill: 'currentColor', height: 7.28, width: 1.5, x: 5.72, y: 4.82 }),
            h('rect', { fill: 'currentColor', height: 7.5, width: 1.5, x: 11.82, y: 3.7 }),
            h('ellipse', { cx: 4.5, cy: 12.05, fill: 'currentColor', rx: 2.05, ry: 1.55, transform: 'rotate(-16 4.5 12.05)' }),
            h('ellipse', { cx: 10.6, cy: 11.15, fill: 'currentColor', rx: 2.05, ry: 1.55, transform: 'rotate(-16 10.6 11.15)' })))
        : null,
      isPermissionTab(tab)
        ? h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tab-permissions' },
          h('svg', { viewBox: '0 0 16 16' },
            h('path', { d: 'M8 1.8 13 3.8v3.6c0 3-2 5.2-5 6.6-3-1.4-5-3.6-5-6.6V3.8Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
            h('path', { d: 'm5.8 8 1.5 1.5 3-3.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' })))
        : null,
      h('button', {
        className: 'dsh-ws-preview-tab-button',
        onClick: event => { event.stopPropagation(); onChoose(tab) },
        onDoubleClick: () => onPromote(tab.path),
        role: 'tab',
        'aria-selected': tab.path === activePath,
        title: tabTitle,
        type: 'button',
      }, h('span', { className: 'dsh-ws-preview-tab-name' }, tab.name)),
      /* A live process on this file: a small pulsing dot, so a run started in one tab is visible
         from any other tab (and the console keeps collecting its output in the background). */
      getRunEntry(tab.path)?.status === 'running'
        ? h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tab-run', title: translate('run.tab.running') })
        : null,
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
  /* The strip owns the blank space right of the last tab: a right-click there is a strip-level
     menu (the workshop entry), while a right-click ON a tab keeps its own tab menu. */
  return h('div', {
    'aria-label': translate(bottom === true ? 'preview.pane.bottom' : 'preview.pane.top'),
    className: 'dsh-ws-preview-tabs',
    onContextMenu: event => {
      if (event.target.closest('.dsh-ws-preview-tab') !== null) return
      event.preventDefault()
      onBlankContextMenu?.(event.clientX, event.clientY)
    },
    onDragLeave,
    onDragOver,
    onDrop,
    onMouseEnter,
    onMouseLeave,
    onScroll,
    ref: containerRef,
    role: 'tablist',
  }, nodes,
  h('span', { 'aria-hidden': true, className: 'dsh-ws-preview-tabs-fill' }),
  h('button', {
    'aria-label': translate('tab.music.open'),
    className: 'dsh-ws-preview-tab-add',
    onClick: event => {
      const rect = event.currentTarget.getBoundingClientRect()
      onBlankContextMenu?.(Math.round(rect.left), Math.round(rect.bottom + 4))
    },
    title: translate('tab.music.open.title'),
    type: 'button',
  }, '＋'),
  bottom === true && onClosePane !== undefined
    ? h('button', {
      'aria-label': translate('preview.split.close'),
      className: 'dsh-ws-preview-pane-close',
      onClick: onClosePane,
      title: translate('preview.split.close.title'),
      type: 'button',
    }, collapsePaneIcon)
    : null)
}


