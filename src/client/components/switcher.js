import { createElement as h, useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { translate } from '../locale/index.js'
import { isMindmapBranchDescendant } from '../mindmap/helpers.js'

export function SessionSwitcherDropdown({ useSessions, useWorkspaces, sessionId, openSession }) {
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  /* Panel width = 33% of the conversation column, re-measured on open and on resize so it
     tracks live layout changes. The 360px floor keeps it readable on a narrow column, but
     it must never exceed the column itself (a 320px chat column would overflow). */
  const measurePos = useCallback(() => {
    const trigger = triggerRef.current
    if (trigger === null) return null
    const rect = trigger.getBoundingClientRect()
    const chat = trigger.closest('.dsh-ws-chat')
    const chatRect = chat?.getBoundingClientRect()
    const width = chatRect !== undefined && chatRect.width > 0
      ? Math.min(Math.max(360, Math.round(chatRect.width * 0.33)), Math.max(120, chatRect.width - 8))
      : Math.max(360, rect.width)
    // Keep the panel inside the conversation column: on mobile the header icons push the
    // trigger right, so the clamp leans the panel left to stay on screen (desktop: no-op).
    const left = chatRect !== undefined && chatRect.width > 0
      ? Math.max(chatRect.left + 4, Math.min(rect.left, chatRect.right - width - 4))
      : rect.left
    return { left, top: rect.bottom + 6, width }
  }, [])
  const toggle = useCallback(() => {
    if (open) { setOpen(false); return }
    // Measure OUTSIDE the setState updater: updaters must stay pure (StrictMode double-invokes them).
    const next = measurePos()
    if (next === null) return
    setPos(next)
    setOpen(true)
  }, [measurePos, open])
  useEffect(() => {
    if (!open) return undefined
    const inside = event => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (trigger !== null && event.target instanceof Node && trigger.contains(event.target)) return true
      return panel !== null && event.target instanceof Node && panel.contains(event.target)
    }
    const close = () => setOpen(false)
    const onPointerDown = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    // Re-anchor on resize so the 33%-of-column width keeps tracking layout changes while open.
    const onResize = () => {
      const next = measurePos()
      if (next === null) return
      setPos(prev => prev !== null && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next)
    }
    // Scroll outside the panel closes it (capture phase); scrolls inside the scrollable panel
    // must NOT close it — that made long session lists impossible to scroll through.
    const onScroll = event => {
      const panel = panelRef.current
      if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    /* The chat column width also changes when the sidebar/preview splitters
       move (no window resize fires on those drags): observe the column itself
       so the panel re-anchors and keeps its 33%-of-column width live. */
    let chatObserver
    const chat = triggerRef.current?.closest('.dsh-ws-chat')
    if (chat !== null && chat !== undefined && typeof ResizeObserver === 'function') {
      chatObserver = new ResizeObserver(onResize)
      chatObserver.observe(chat)
    }
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      chatObserver?.disconnect()
    }
  }, [measurePos, open])
  const currentTitle = sessionId === undefined
    ? undefined
    : (list.byId[sessionId]?.displayTitle ?? String(sessionId))
  const rows = useMemo(() => {
    /* The full sorted list is only needed while open; the store re-renders this slot on every
       session change (streaming churn included), so skip building rows while closed — the
       trigger only needs the current title the subscription already delivers. */
    if (!open) return []
    const workspaceTitleBySession = new Map()
    for (const item of workspaces) {
      // Malformed workspace items (missing sessionIds) must not throw in the render path.
      for (const id of Array.isArray(item?.sessionIds) ? item.sessionIds : []) {
        if (!workspaceTitleBySession.has(id)) workspaceTitleBySession.set(id, item.title)
      }
    }
    const ordered = list.ids
      .filter(id => list.byId[id] !== undefined && !isMindmapBranchDescendant(list, id))
      .map(id => ({ summary: list.byId[id], workspaceTitle: workspaceTitleBySession.get(id) }))
      .sort((a, b) => (b.summary.updatedAt ?? 0) - (a.summary.updatedAt ?? 0))
    return ordered
  }, [list, open, workspaces])
  const trigger = h('button', {
    'aria-expanded': open,
    'aria-haspopup': 'listbox',
    'aria-label': translate('switcher.aria'),
    className: 'dsh-ws-session-switcher-trigger',
    onClick: toggle,
    ref: triggerRef,
    title: translate('switcher.trigger.title'),
    type: 'button',
  },
    h('span', { className: 'dsh-ws-session-switcher-title' }, currentTitle ?? ''),
    h('span', { className: 'dsh-ws-chevron' }, open ? '▲' : '▼'))
  const panel = open && pos !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-session-switcher-panel',
      ref: panelRef,
      role: 'listbox',
      style: { left: pos.left, top: pos.top, width: pos.width },
    },
      rows.length === 0 ? h('div', { className: 'dsh-ws-session-switcher-empty' }, translate('switcher.noSessions'))
        : rows.map(row => h('button', {
          'aria-selected': row.summary.id === sessionId,
          className: row.summary.id === sessionId ? 'dsh-ws-session-switcher-row dsh-ws-session-switcher-current' : 'dsh-ws-session-switcher-row',
          key: row.summary.id,
          onClick: () => { openSession(row.summary.id); setOpen(false) },
          role: 'option',
          type: 'button',
        },
          h('span', { className: 'dsh-ws-session-switcher-row-main' },
            row.summary.displayTitle,
            row.summary.origin === 'subagent' ? h('span', { className: 'dsh-ws-session-switcher-badge' }, translate('switcher.subagent')) : null),
          row.workspaceTitle !== undefined ? h('span', { className: 'dsh-ws-session-switcher-row-ws' }, row.workspaceTitle) : null))),
    document.body,
  ) : null
  return h('div', { className: 'dsh-ws-session-switcher' }, trigger, panel)
}
/* ---------------------------------------------------------------------------
   Mind-map conversation branching ("导图"): a conversation.view tab backed by a
   persisted per-root-session document. Opening a session with no document
   reverse-parses its FULL event log into session turn cards and persists it;
   the session's row then hides from the sidebar and a self-drawn mind-map entry
   takes its place. Clicking a card forks a new branch session at that card and
   opens it; Host sync folds the branch's own new turns in from its full log, so
   the document stays the single source of truth.
   --------------------------------------------------------------------------- */

/* A fork-descendant of a mind-map family (any session whose ancestry reaches a mind-map
   root/branch, subagent hops aside). The switcher hides these; the sidebar hider hides the family. */