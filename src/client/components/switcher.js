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
  /* Panel width = 33% of the conversation column (360px floor, never exceeding the column), re-measured on open and resize. */
  const measurePos = useCallback(() => {
    const trigger = triggerRef.current
    if (trigger === null) return null
    const rect = trigger.getBoundingClientRect()
    const chat = trigger.closest('.dsh-ws-chat')
    const chatRect = chat?.getBoundingClientRect()
    const width = chatRect !== undefined && chatRect.width > 0
      /* The outer Math.min keeps the panel inside the column (1px floor so a degenerate measure never yields a non-positive width). */
      ? Math.min(Math.max(360, Math.round(chatRect.width * 0.33)), Math.max(1, chatRect.width - 8))
      : Math.max(360, rect.width)
    // Keep the panel inside the conversation column; on mobile the clamp leans it left to stay on screen.
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
    // Scroll outside the panel closes it; scrolls inside the scrollable panel must not.
    const onScroll = event => {
      const panel = panelRef.current
      if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    /* Observe the chat column itself, since splitter drags change its width without a window resize. */
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
    /* Build rows only while open, since the store re-renders this slot on every session change. */
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
      // Session summaries carry a numeric updatedAt; sort newest first.
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
   Mind-map conversation branching ("导图"): a docked preview tab backed by a
   persisted per-root-session document; clicking a card forks a new branch
   session, and Host sync keeps the document the single source of truth.
   --------------------------------------------------------------------------- */