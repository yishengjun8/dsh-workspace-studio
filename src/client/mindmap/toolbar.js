/** Mind-map toolbar: new top-level session, restore view, regenerate-all
 *  summaries and archive the whole map. */
import { createElement as h } from 'react'
import { translate } from '../locale/index.js'
import { MINDMAP_TOOLBAR_ICONS } from './cards.js'

export function MindMapToolbar({ settings, restoreView, addRootSession, startArchiveAll, startRegenerateAll }) {
  return h('div', { className: 'dsh-ws-mindmap-toolbar' },
        /* Create a new top-level empty session — the same action as clicking
           the virtual root node (addRootSession), exposed as a highlighted
           toolbar button (light-blue pill + plus badge echoing the root). */
        h('button', {
          className: 'dsh-ws-mindmap-toolbar-button dsh-ws-mindmap-toolbar-button-new',
          onClick: addRootSession,
          title: translate('mindmap.newSessionTitle'),
          type: 'button',
        },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-mindmap-toolbar-button-new-plus' },
            /* Same symmetric plus as the root node badge; the hover 90°
               rotation maps it onto itself — no position shift. */
            h('svg', { viewBox: '0 0 16 16' },
              h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 2.4 }))),
          translate('mindmap.newSession')),
        h('button', { className: 'dsh-ws-mindmap-toolbar-button', onClick: restoreView, title: translate('mindmap.view.restoreTitle'), type: 'button' },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-mindmap-toolbar-badge' },
            h('svg', { viewBox: '0 0 16 16' },
              h('path', {
                d: MINDMAP_TOOLBAR_ICONS.restore.d,
                fill: 'none',
                stroke: 'currentColor',
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                strokeWidth: MINDMAP_TOOLBAR_ICONS.restore.sw,
              }))),
          translate('mindmap.view.restore')),
        /* 重新生成全部摘要: only meaningful with the AI-summary feature on (no
           model to regenerate with otherwise) — same gate as the card menu item. */
        settings.mindmapSummaryEnabled === true
          ? h('button', { className: 'dsh-ws-mindmap-toolbar-button', onClick: startRegenerateAll, title: translate('mindmap.summary.regenerateAll'), type: 'button' },
            h('span', { 'aria-hidden': true, className: 'dsh-ws-mindmap-toolbar-badge' },
              h('svg', { viewBox: '0 0 16 16' },
                h('path', {
                  d: MINDMAP_TOOLBAR_ICONS.regen.d,
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: MINDMAP_TOOLBAR_ICONS.regen.sw,
                }))),
            translate('mindmap.summary.regenerateAll'))
          : null,
        /* Archive the whole map: pushed to the right end of the toolbar
           (margin-left:auto). Red = destructive warning. */
        h('button', { className: 'dsh-ws-mindmap-toolbar-button dsh-ws-mindmap-toolbar-button-danger dsh-ws-mindmap-toolbar-archive', onClick: startArchiveAll, title: translate('mindmap.menu.archiveAll'), type: 'button' },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-mindmap-toolbar-badge' },
            h('svg', { viewBox: '0 0 16 16' },
              h('path', {
                d: MINDMAP_TOOLBAR_ICONS.archive.d,
                fill: 'none',
                stroke: 'currentColor',
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                strokeWidth: MINDMAP_TOOLBAR_ICONS.archive.sw,
              }))),
          translate('mindmap.menu.archiveAll')))
}
