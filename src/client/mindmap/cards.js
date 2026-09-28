import { createElement as h, Fragment, memo } from 'react'
import { MINDMAP_TEXT_MAX } from '../constants.js'
import { translate } from '../locale/index.js'
import { clamp } from '../format.js'
import { mindmapClip } from './helpers.js'

/* One absolutely-positioned map card, extracted so `memo` only rebuilds cards
   whose props actually changed on a doc-triggered re-render. */

/* The hover fold pill: a text capsule that sits exactly where the
   status row was (see styles.js) and cross-fades with it while the card is
   hovered. It is rendered ONLY on cards that own a foldable completed turn —
   empty placeholder, streaming, head and root nodes never get one — so the
   element's presence is constant per card kind and `memo` keeps working.
   Appearance is pure CSS (card :hover), no per-hover React state. A pill click
   must never reach the card (that would fork / switch / peek the run), hence
   the propagation stop before the action runs. `side` picks the corner: the
   bottom-left slot (default, where the status text sits) or the bottom-right
   one, which a peeked card lends to 立刻折叠 instead of the hint chip. */
const foldPill = ({ label, title, tone, side, run }) => h('button', {
  className: 'dsh-ws-mindmap-node-foldpill' + (side === 'right' ? ' dsh-ws-mindmap-node-foldpill-right' : ''),
  'data-tone': tone,
  onClick: (event) => { event.preventDefault(); event.stopPropagation(); run() },
  tabIndex: -1,
  title,
  type: 'button',
}, label)

export const MindMapCard = memo(function MindMapCard({
  entry, title, isCurrent, isStreaming, isSummarizing, summary, streamingQuestion, isAncestor, isHover, isHoverAncestor, hintAction, isEnd, ringPalette, onOpen, onMenu, onHover, peeked, onFoldPill, onFoldNowPill, onUnfoldCardPill,
}) {
  /* Ring cards (the streaming card + its parent) are the pair's single visual
     signal: selection/hover border/glow classes are suppressed on both so a
     dashed border never overwrites the ring. */
  const ringed = ringPalette !== undefined
  /* Every question card is a branch node: the empty placeholder keeps the
     dashed pending look (no data-branch), completed cards are solid +
     primary-tinted. */
  const classes = 'dsh-ws-mindmap-node dsh-ws-mindmap-branchcard'
    + (isEnd && !isStreaming ? ' dsh-ws-mindmap-endcard' : '')
    + (isCurrent && !ringed ? ' dsh-ws-mindmap-node-current' : '')
    + (isStreaming ? ' dsh-ws-mindmap-node-streaming' : '')
    + (ringed ? ' dsh-ws-mindmap-node-ring' : '')
    + (isAncestor && !ringed ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor && !ringed ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover && !ringed ? ' dsh-ws-mindmap-node-hover' : '')
  const turn = entry.turn
  /* The AI summary arrives as a plain string prop from the current doc; the
     full original text stays one hover away via the title attribute. */
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
      /* A summarized or still-generating card shows the full original question
         on hover, since the summary is a lossy replacement. */
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
          /* Three-level card text: summary once ready, a muted "generating"
             placeholder while the background queue owns the turn, otherwise the
             original question. */
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
          /* A peeked card: a folded-marked turn temporarily expanded, so the
             status row says folded instead of done. */
          : peeked
            ? h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-peeked-status' }, translate('mindmap.fold.status'))
            : h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-done' }, translate('mindmap.done')),
    /* Hover fold pill: only for a real, completed turn (the empty placeholder
       and the streaming card carry no foldable turn). A PEEKED card — a
       folded-marked turn temporarily expanded — carries TWO pills instead:
       bottom-LEFT 取消折叠 permanently unfolds THIS single card (the exact path
       of unchecking the menu's fold box on a peeked card: the run's other turns
       keep their folded marks and collapse again), bottom-RIGHT 立刻折叠 folds
       the whole temporary expansion back into the folded card (pure view state,
       no doc write) and keeps the amber tone, so the peek signal survives the
       status row's cross-fade. */
    entry.empty || isStreaming || !Number.isSafeInteger(entry.turn?.seq)
      ? null
      : peeked
        ? h(Fragment, null,
          onUnfoldCardPill === undefined
            ? null
            : foldPill({
              label: translate('mindmap.card.unfold'),
              title: translate('mindmap.card.unfold.title'),
              run: () => { onUnfoldCardPill(entry.sessionId, entry.turn.seq) },
            }),
          onFoldNowPill === undefined
            ? null
            : foldPill({
              label: translate('mindmap.menu.foldNow'),
              title: translate('mindmap.card.foldNow.title'),
              tone: 'peek',
              side: 'right',
              run: () => { onFoldNowPill(entry.sessionId, entry.turn.seq) },
            }))
        : (onFoldPill === undefined
          ? null
          : foldPill({
            label: translate('mindmap.card.fold'),
            title: translate('mindmap.card.fold.title'),
            run: () => { onFoldPill(entry.sessionId, entry.turn.seq) },
          })),
    /* Hover-only hint chip: tells the user what a click will do. pointer-events
       none so it never intercepts hover/click; absolute so it never shifts
       the layout. A peeked card does NOT render it: its bottom-right corner is
       taken by the 立刻折叠 pill (the same "action wins the bottom-right corner"
       rule the session head card follows). */
    isHover && hintAction !== undefined && peeked !== true
      ? h('span', { className: 'dsh-ws-mindmap-node-hint' }, translate(`mindmap.hint.${hintAction}`))
      : null)
})

/* A FOLDED card: one compact card standing in for a maximal run of consecutive
   folded turns, showing the run's count badge + the first turn's text (or its
   AI summary). Clicking temporarily expands the run (peek); right-click offers
   fold (uncheck = permanently unfold the run) and delete. It deliberately
   carries NO hover pill: the single-card unfold belongs to the PEEKED cards the
   click produces, and the run-wide unfold stays on the menu's fold box. */
export const MindMapFoldedCard = memo(function MindMapFoldedCard({
  entry, title, isCurrent, isAncestor, isHover, isHoverAncestor, hintAction, ringPalette, onOpen, onMenu, onHover, summary,
}) {
  const ringed = ringPalette !== undefined
  const classes = 'dsh-ws-mindmap-node dsh-ws-mindmap-branchcard dsh-ws-mindmap-folded'
    + (isCurrent && !ringed ? ' dsh-ws-mindmap-node-current' : '')
    + (ringed ? ' dsh-ws-mindmap-node-ring' : '')
    + (isAncestor && !ringed ? ' dsh-ws-mindmap-node-ancestor' : '')
    + (isHoverAncestor && !ringed ? ' dsh-ws-mindmap-node-hover-ancestor' : '')
    + (isHover && !ringed ? ' dsh-ws-mindmap-node-hover' : '')
  const count = Number.isSafeInteger(entry.foldCount) && entry.foldCount > 0 ? entry.foldCount : 1
  const body = summary !== undefined && summary !== ''
    ? summary
    : String(entry.turn?.user ?? '')
  const style = { left: entry.x, top: entry.y, width: entry.width, height: entry.height }
  if (ringPalette !== undefined) {
    style['--dsw-ws-mm-c1'] = ringPalette[0]
    style['--dsw-ws-mm-c2'] = ringPalette[1]
    style['--dsw-ws-mm-c3'] = ringPalette[2]
  }
  return h('div', {
    className: classes,
    'data-branch': '',
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
    title: translate('mindmap.folded', { n: count }),
  },
    isCurrent ? h('span', { className: 'dsh-ws-mindmap-node-current-badge' }, translate('mindmap.current')) : null,
    h('div', { className: 'dsh-ws-mindmap-node-title' },
      h('span', { className: 'dsh-ws-mindmap-pending-label dsh-ws-mindmap-fold-label' },
        /* Folded-corner page glyph: the run's "folded" identity. */
        h('svg', { className: 'dsh-ws-mindmap-pending-icon', fill: 'none', height: '11', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.4, viewBox: '0 0 16 16', width: '11' },
          h('path', { d: 'M4 2.5h6l2.5 2.5V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z' }),
          h('path', { d: 'M10 2.5V5h2.5' }))),
      h('span', { className: 'dsh-ws-mindmap-node-title-text' }, title),
      h('span', { className: 'dsh-ws-mindmap-fold-count' }, `×${count}`)),
    h('div', { className: 'dsh-ws-mindmap-node-q dsh-ws-mindmap-node-q-folded' },
      mindmapClip(body || translate('mindmap.emptyRound'), MINDMAP_TEXT_MAX)),
    h('div', { className: 'dsh-ws-mindmap-node-status dsh-ws-mindmap-node-folded-status' }, translate('mindmap.fold.status')),
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
   session (the current badge sits here); right-click renames it. On hover (or
   keyboard focus) a bottom action row appears: archive this session + its
   branches on the left, summarize this session on the right. */
export const MindMapSessionHead = memo(function MindMapSessionHead({
  entry, title, isCurrent, isRunning, isAncestor, isHover, isHoverAncestor, ringPalette, onOpen, onMenu, onHover, summary, isSummarizing, isQueued,
  onArchive, onSummarize, canSummarize, summaryEnabled,
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
  /* Status priority: streaming > session summary in flight > queued behind
     another session's summary > done / waiting. */
  const statusLabel = isRunning
    ? translate('mindmap.streaming')
    : isSummarizing
      ? translate('mindmap.sessionSummary.summarizing')
      : isQueued
        ? translate('mindmap.sessionSummary.queued')
        : (turns.length > 0 ? translate('mindmap.done') : translate('mindmap.session.waiting'))
  const statusLive = isRunning || isSummarizing || isQueued
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
    /* Row 2: turn count + completion status merged into one line so the
       summary gets the remaining space. */
    h('div', { className: 'dsh-ws-mindmap-head-meta' + (statusLive ? ' dsh-ws-mindmap-head-meta-live' : '') },
      statusLive ? h('span', { className: 'dsh-ws-mindmap-node-streaming-dot' }) : null,
      h('span', null, `${countLabel} · ${statusLabel}`)),
    /* Remaining space: the session summary, smaller font, 4-line clamp. */
    h('div', { className: 'dsh-ws-mindmap-head-summary' + (hasSummary ? '' : ' dsh-ws-mindmap-head-summary-empty') },
      hasSummary ? summary : (turns.length > 0 ? translate('mindmap.head.summaryEmpty') : '')),
    /* Hover-only action row (bottom-left archive / bottom-right summarize):
       revealed by CSS on card hover or focus-within, so it never shifts the
       fixed card box and stays keyboard reachable. Both buttons stop the
       bubbling of click/keydown — the card's own handlers would otherwise
       switch the session on the same event. Summarize is only offered while
       the AI-summary feature is on (with it off the Host rejects the request). */
    h('div', { className: 'dsh-ws-mindmap-head-actions' },
      h('button', {
        className: 'dsh-ws-mindmap-head-action dsh-ws-mindmap-head-action-danger',
        onClick: (event) => { event.stopPropagation(); onArchive(String(entry.sessionId)) },
        onKeyDown: (event) => { event.stopPropagation() },
        title: translate('mindmap.menu.archiveBranch'),
        type: 'button',
      }, translate('mindmap.head.archive')),
      summaryEnabled === true
        ? h('button', {
          className: 'dsh-ws-mindmap-head-action',
          disabled: canSummarize !== true || isSummarizing === true || isQueued === true,
          onClick: (event) => { event.stopPropagation(); onSummarize(String(entry.sessionId)) },
          onKeyDown: (event) => { event.stopPropagation() },
          title: isSummarizing === true
            ? translate('mindmap.sessionSummary.summarizing')
            : isQueued === true
              ? translate('mindmap.sessionSummary.queued')
              : translate('mindmap.menu.summarizeSession'),
          type: 'button',
        }, translate('mindmap.head.summarize'))
        : null))
})

/* Toolbar badge icons: 16-viewBox stroke glyphs matching the
   plus badge's line style, rendered inside .dsh-ws-mindmap-toolbar-badge.
   One path (possibly several M/Z sub-segments) + one stroke width each. */
export const MINDMAP_TOOLBAR_ICONS = {
  /* Counter-clockwise return arrow — "restore view". */
  restore: { d: 'M3 12a9 9 0 1 0 2.64-6.36L3 8M3 3v5h5', sw: 1.7 },
  /* Twin sparkles — "regenerate all summaries". */
  regen: { d: 'M8 2.5L9.22 6.78 13.5 8 9.22 9.22 8 13.5 6.78 9.22 2.5 8 6.78 6.78ZM13.4 3.2 13.9 4.6 15.3 5.1 13.9 5.6 13.4 7 12.9 5.6 11.5 5.1 12.9 4.6Z', sw: 1.4 },
  /* Two session rows + one sparkle — "regenerate all SESSION summaries"
     (deliberately distinct from the card batch's twin sparkles). */
  regenSessions: { d: 'M2.2 4.4h8.6M2.2 8.2h4.8M12 5.6L12.62 7.68 14.7 8.3 12.62 8.92 12 11 11.38 8.92 9.3 8.3 11.38 7.68Z', sw: 1.5 },
  /* Archive box with slot — "archive entire mind map". */
  archive: { d: 'M2.5 4h11M3 4v8.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V4M6.5 8h3', sw: 1.5 },
}
