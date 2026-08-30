import { createElement as h, memo } from 'react'
import { MINDMAP_TEXT_MAX } from '../constants.js'
import { translate } from '../locale/index.js'
import { clamp } from '../format.js'
import { mindmapClip } from './helpers.js'

/* One absolutely-positioned map card, extracted so `memo` only rebuilds cards
   whose props actually changed on a doc-triggered re-render. */

export const MindMapCard = memo(function MindMapCard({
  entry, title, isCurrent, isStreaming, isSummarizing, summary, streamingQuestion, isAncestor, isHover, isHoverAncestor, hintAction, isEnd, ringPalette, onOpen, onMenu, onHover,
}) {
  /* Ring cards (the streaming card + its parent, both wearing the flowing
     gradient ring) are the pair's single visual signal: selection/hover
     border/glow classes are suppressed on BOTH so a dashed border never
     overwrites the ring — the immunity stops at these two cards, ancestors
     above still trace normally, and the "当前" badge is kept (informational). */
  const ringed = ringPalette !== undefined
  /* Every v3 question card is a branch node (no trunk anymore): the empty
     placeholder keeps the dashed pending look (no data-branch), completed
     cards are solid + primary-tinted. */
  const classes = 'dsh-ws-mindmap-node dsh-ws-mindmap-branchcard'
    + (isEnd && !isStreaming ? ' dsh-ws-mindmap-endcard' : '')
    + (isCurrent && !ringed ? ' dsh-ws-mindmap-node-current' : '')
    + (isStreaming ? ' dsh-ws-mindmap-node-streaming' : '')
    + (ringed ? ' dsh-ws-mindmap-node-ring' : '')
    + (isAncestor && !ringed ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor && !ringed ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover && !ringed ? ' dsh-ws-mindmap-node-hover' : '')
  const turn = entry.turn
  /* The AI summary arrives as a plain string prop (from the CURRENT doc via
     summaryByKey — the layout node's turn object may predate the write). The
     FULL original text stays one hover away via the title attribute below. */
  const style = { left: entry.x, top: entry.y, width: entry.width, height: entry.height }
  if (ringPalette !== undefined) {
    style['--dsw-ws-mm-c1'] = ringPalette[0]
    style['--dsw-ws-mm-c2'] = ringPalette[1]
    style['--dsw-ws-mm-c3'] = ringPalette[2]
  }
  return h('div', {
    className: classes,
    'data-branch': entry.empty ? undefined : '',
    key: entry.key,
    onClick: () => { onOpen(entry) },
    /* Hover drives the additive ancestor trace: entering traces the card's
       chain to the root over the selection's; leaving clears it (React fires
       these only on boundary crossing, so intra-card motion is a no-op). */
    onMouseEnter: () => { onHover(entry.key) },
    onMouseLeave: () => { onHover(undefined) },
    onContextMenu: !isStreaming
      ? (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) }
      : undefined,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style,
    title: isStreaming
      ? translate('mindmap.streaming.click')
      /* A summarized card shows the FULL original question on hover (the
         summary is a lossy replacement, so the source text must stay reachable);
         while the summary is still being generated the placeholder hides the
         original text (no original→summary flicker), so hover shows it there
         too. Without either, the card already shows the text — keep the hint. */
      : (summary !== undefined || isSummarizing)
        ? String(turn?.user ?? '') || translate('mindmap.open.hint')
        : translate('mindmap.open.hint'),
  },
    isCurrent ? h('span', { className: 'dsh-ws-mindmap-node-current-badge' }, translate('mindmap.current')) : null,
    h('div', { className: 'dsh-ws-mindmap-node-title' },
      h('span', { className: 'dsh-ws-mindmap-pending-label' + (isEnd ? ' dsh-ws-mindmap-end-label' : '') },
        /* An end-of-branch card (click switches to its session) carries a
           bullseye chip — the branch's terminal point — instead of the fork
           glyph, so it is never confused with a fork point. */
        isEnd
          ? h('svg', {
            className: 'dsh-ws-mindmap-pending-icon',
            fill: 'none',
            height: '11',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            viewBox: '0 0 14 14',
            width: '11',
          },
            h('circle', { cx: 7, cy: 7, r: 4.4 }),
            h('circle', { cx: 7, cy: 7, fill: 'currentColor', r: 1.6, stroke: 'none' }))
          : h('svg', {
            className: 'dsh-ws-mindmap-pending-icon',
            fill: 'none',
            height: '11',
            stroke: 'currentColor',
            strokeLinecap: 'round',
            strokeWidth: 1.3,
            viewBox: '0 0 14 14',
            width: '11',
          },
            h('path', { d: 'M1.5 7 H4.5' }),
            h('path', { d: 'M4.5 7 C5.8 2.6 10.6 3 11.4 3.2' }),
            h('path', { d: 'M4.5 7 C5.8 11.4 10.6 11 11.4 10.8' }),
            h('circle', { cx: 11.4, cy: 3.2, fill: 'currentColor', r: 1.4, stroke: 'none' }),
            h('circle', { cx: 11.4, cy: 10.8, fill: 'currentColor', r: 1.4, stroke: 'none' })),
        translate(isEnd ? 'mindmap.endTag' : 'mindmap.branchTag')),
      h('span', { className: 'dsh-ws-mindmap-node-title-text' }, title)),
    entry.empty
      ? h('div', { className: 'dsh-ws-mindmap-pending-title' }, translate('mindmap.pending'))
      : isStreaming
        ? h('div', { className: 'dsh-ws-mindmap-node-q' }, mindmapClip(streamingQuestion || entry.question || translate('mindmap.streaming'), MINDMAP_TEXT_MAX))
        : h('div', { className: 'dsh-ws-mindmap-node-q' + (isSummarizing && summary === undefined ? ' dsh-ws-mindmap-node-q-summarizing' : '') },
          /* Three-level card text (A1): summary once ready; a muted
             "generating" placeholder while the background queue owns the turn
             (so the original text never flashes in between); the original
             question otherwise (off / failed / not yet enqueued). */
          summary !== undefined
            ? mindmapClip(summary, MINDMAP_TEXT_MAX)
            : isSummarizing
              ? mindmapClip(translate('mindmap.summary.generating'), MINDMAP_TEXT_MAX)
              : mindmapClip(turn.user || translate('mindmap.emptyRound'), MINDMAP_TEXT_MAX)),
    entry.empty
      ? null
      : isStreaming
        ? h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-streaming-status' },
            h('span', { className: 'dsh-ws-mindmap-node-streaming-dot' }),
            h('span', null, translate('mindmap.streaming')))
        : isSummarizing
          ? h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-summarizing' },
              h('span', { className: 'dsh-ws-mindmap-node-streaming-dot' }),
              h('span', null, translate('mindmap.summary.generating')))
          : h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-done' }, translate('mindmap.done')),
    /* Hover-only hint chip: tells the user what a click will do. pointer-events
       none so it never intercepts hover/click; absolute so it never shifts
       the layout. */
    isHover && hintAction !== undefined
      ? h('span', { className: 'dsh-ws-mindmap-node-hint' }, translate(`mindmap.hint.${hintAction}`))
      : null)
})

/* The VIRTUAL root node: the map's top hub. Clicking it creates a new
   top-level session; not backed by any session — it only exists in the
   layout. */
export const MindMapRootNode = memo(function MindMapRootNode({ entry, isAncestor, isHoverAncestor, isHover, onOpen, onMenu, onHover }) {
  const classes = 'dsh-ws-mindmap-root'
    + (isAncestor ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover ? ' dsh-ws-mindmap-node-hover' : '')
  return h('div', {
    className: classes,
    key: entry.key,
    onClick: () => { onOpen(entry) },
    onMouseEnter: () => { onHover(entry.key) },
    onMouseLeave: () => { onHover(undefined) },
    onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style: { left: entry.x, top: entry.y, width: entry.width, height: entry.height },
    title: translate('mindmap.rootNode.hint'),
  },
    h('div', { className: 'dsh-ws-mindmap-root-plus' },
      /* A symmetric inline SVG plus, centered so the hover 90° rotation maps
         it onto itself — no position shift. */
      h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
        h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 2.4 }))),
    h('div', { className: 'dsh-ws-mindmap-root-col' },
      h('div', { className: 'dsh-ws-mindmap-root-title' }, translate('mindmap.rootNode')),
      h('div', { className: 'dsh-ws-mindmap-root-hint' }, translate('mindmap.rootNode.hint'))))
})

/* A session's HEAD node: the identity card at the left of its question chain.
   Shows the session title / round count / status; clicking switches to the
   session (the "当前" badge sits here); right-click renames it. */
export const MindMapSessionHead = memo(function MindMapSessionHead({
  entry, title, isCurrent, isRunning, isAncestor, isHover, isHoverAncestor, hintAction, ringPalette, onOpen, onMenu, onHover, summary, isSummarizing,
}) {
  const ringed = ringPalette !== undefined
  const classes = 'dsh-ws-mindmap-node dsh-ws-mindmap-head'
    + (isCurrent && !ringed ? ' dsh-ws-mindmap-head-current' : '')
    + (ringed ? ' dsh-ws-mindmap-node-ring' : '')
    + (isAncestor && !ringed ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor && !ringed ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover && !ringed ? ' dsh-ws-mindmap-node-hover' : '')
  const turns = entry.session?.turns ?? []
  const countLabel = turns.length > 0
    ? translate('mindmap.rounds', { n: turns.length })
    : translate('mindmap.session.empty')
  /* Status priority: streaming (生成中…) > session summary in flight
     (正在总结中…) > done / waiting. */
  const statusLabel = isRunning
    ? translate('mindmap.streaming')
    : isSummarizing
      ? translate('mindmap.sessionSummary.summarizing')
      : (turns.length > 0 ? translate('mindmap.done') : translate('mindmap.session.waiting'))
  const statusLive = isRunning || isSummarizing
  /* Session-level AI summary (persisted on the session entry, read from the
     CURRENT doc — the layout's session object is structure-memoized and would
     be stale). Shown in the card's remaining space; the FULL text is one hover
     away via the title attribute. */
  const hasSummary = typeof summary === 'string' && summary !== ''
  const style = { left: entry.x, top: entry.y, width: entry.width, height: entry.height }
  if (ringPalette !== undefined) {
    style['--dsw-ws-mm-c1'] = ringPalette[0]
    style['--dsw-ws-mm-c2'] = ringPalette[1]
    style['--dsw-ws-mm-c3'] = ringPalette[2]
  }
  return h('div', {
    className: classes,
    key: entry.key,
    onClick: () => { onOpen(entry) },
    onMouseEnter: () => { onHover(entry.key) },
    onMouseLeave: () => { onHover(undefined) },
    onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); onMenu(entry, event.clientX, event.clientY) },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) }
    },
    role: 'button',
    tabIndex: 0,
    style,
    title: hasSummary ? summary : translate('mindmap.open.hint'),
  },
    isCurrent ? h('span', { className: 'dsh-ws-mindmap-node-current-badge' }, translate('mindmap.current')) : null,
    h('div', { className: 'dsh-ws-mindmap-head-row' },
      h('svg', { className: 'dsh-ws-mindmap-head-icon', fill: 'none', viewBox: '0 0 24 24' },
        h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z', stroke: 'currentColor', strokeWidth: '1.7', strokeLinejoin: 'round' })),
      h('span', { className: 'dsh-ws-mindmap-head-title' }, title)),
    /* Row 2: turn count + completion status merged (the old count/status rows
       collapsed into one line so the summary gets the remaining space). */
    h('div', { className: 'dsh-ws-mindmap-head-meta' + (statusLive ? ' dsh-ws-mindmap-head-meta-live' : '') },
      statusLive ? h('span', { className: 'dsh-ws-mindmap-node-streaming-dot' }) : null,
      h('span', null, `${countLabel} · ${statusLabel}`)),
    /* Remaining space: the session summary, smaller font, 4-line clamp. */
    h('div', { className: 'dsh-ws-mindmap-head-summary' + (hasSummary ? '' : ' dsh-ws-mindmap-head-summary-empty') },
      hasSummary ? summary : (turns.length > 0 ? translate('mindmap.head.summaryEmpty') : '')),
    isHover && hintAction !== undefined
      ? h('span', { className: 'dsh-ws-mindmap-node-hint' }, translate(`mindmap.hint.${hintAction}`))
      : null)
})

/* Toolbar badge icons (scheme D): 16-viewBox stroke glyphs matching the
   plus badge's line style, rendered inside .dsh-ws-mindmap-toolbar-badge.
   One path (possibly several M/Z sub-segments) + one stroke width each. */
export const MINDMAP_TOOLBAR_ICONS = {
  /* Expand/bracket corners — "fill scope" toggle. */
  scope: { d: 'M4 7V5.5C4 4.67 4.67 4 5.5 4H7M9 4h1.5c.83 0 1.5.67 1.5 1.5V7M12 9v1.5c0 .83-.67 1.5-1.5 1.5H9M7 12H5.5C4.67 12 4 11.33 4 10.5V9', sw: 1.7 },
  /* Counter-clockwise return arrow — "restore view". */
  restore: { d: 'M3 12a9 9 0 1 0 2.64-6.36L3 8M3 3v5h5', sw: 1.7 },
  /* Twin sparkles — "regenerate all summaries". */
  regen: { d: 'M8 2.5L9.22 6.78 13.5 8 9.22 9.22 8 13.5 6.78 9.22 2.5 8 6.78 6.78ZM13.4 3.2 13.9 4.6 15.3 5.1 13.9 5.6 13.4 7 12.9 5.6 11.5 5.1 12.9 4.6Z', sw: 1.4 },
  /* Archive box with slot — "archive entire mind map". */
  archive: { d: 'M2.5 4h11M3 4v8.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V4M6.5 8h3', sw: 1.5 },
}
