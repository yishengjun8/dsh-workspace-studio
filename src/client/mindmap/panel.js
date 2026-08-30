import { createElement as h, Fragment, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CONTEXT_MENU_WIDTH } from '../constants.js'
import { translate } from '../locale/index.js'
import { renameMindmapDoc } from '../api.js'
import { SessionRenameDialog } from '../components/dialogs.js'
import { mindmapRegistry, readMindmapOrder, updateMindmapOrder, useMindmapRegistry, writeMindmapOrder } from './registry.js'
import { normalizeMindmapWorkspacePath } from './helpers.js'

export function isMindmapFamilySession(list, id) {
  let cursor = String(id)
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    if (mindmapRegistry.isRoot(cursor) || mindmapRegistry.isBranch(cursor)) return true
    const summary = list.byId[cursor]
    if (summary === undefined) break
    if (summary.origin === 'subagent') { cursor = summary.parentId; continue }
    cursor = summary.parentId
  }
  return false
}

export const MINDMAP_ICON = h('g', { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5 },
  h('circle', { cx: 5, cy: 5, r: 2 }),
  h('circle', { cx: 19, cy: 5, r: 2 }),
  h('circle', { cx: 12, cy: 19, r: 2 }),
  h('path', { d: 'M7 5h10' }),
  h('path', { d: 'M5 7l7 10' }),
  h('path', { d: 'M19 7l-7 10' }))

/* Self-drawn sidebar entries replacing the hidden ordinary session rows.
   Rendered per workspace group: only docs whose root session belongs to that
   group's workspace; with groupTitle undefined (flat/search) every doc is
   shown. Clicking opens the root session + floating mind-map overlay; drag
   reorders (persisted per group in localStorage); right-click renames the
   root session or reveals its workspace in the OS explorer. */
export const MINDMAP_ORDER_ALL_KEY = '__all__'
export function MindmapSessionsPanel({ useSessions, useWorkspaces, groupTitle, openSession, revealSession }) {
  useMindmapRegistry()
  /* Narrow selector: only byId is consumed here, so session-list churn for
     UNRELATED sessions (streaming updates elsewhere) must not re-render the
     panel on every tick. */
  const byId = useSessions(state => state.byId)
  const workspaces = useWorkspaces(state => state.items)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const menuRef = useRef(null)
  const lastDragEndRef = useRef(0)
  const [dragId, setDragId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState(null)
  /* The persisted per-group order only changes through THIS component's drag
     handler, so read it once per mount (a state seed) instead of parsing
     localStorage on every render. */
  const [mindmapOrder, setMindmapOrder] = useState(() => readMindmapOrder())
  const docs = mindmapRegistry.getDocs()
  const entries = docs.filter((doc) => {
    if (byId[String(doc.sessionId)] === undefined) return false
    if (groupTitle === undefined) return true
    const row = byId[String(doc.sessionId)]
    const item = workspaces.find(w => (w.sessionIds ?? []).includes(String(doc.sessionId)))
      /* Same normalized path comparison as the root-node workspace resolver:
         an exact `w.path === row.cwd` match would miss on trailing slashes,
         case differences or mixed separators, dropping the doc into the wrong
         (ungrouped) bucket. */
      || (row?.cwd !== undefined ? workspaces.find(w => normalizeMindmapWorkspacePath(w.path) === normalizeMindmapWorkspacePath(row.cwd)) : undefined)
    const docTitle = item?.title
    /* A doc whose workspace resolves to a real Host workspace appears ONLY
       under that workspace's group, matched by its exact title. */
    if (docTitle !== undefined) return docTitle === groupTitle
    /* A doc with no resolvable workspace lives in the ungrouped bucket (its
       title matches no real workspace). Exact-match grouping is safe: real
       workspace headers render their canonical title and the ungrouped bucket
       the localized label, so a resolved doc never falls through. */
    return !workspaces.some(w => w.title === groupTitle)
  })
  const groupKey = groupTitle === undefined ? MINDMAP_ORDER_ALL_KEY : groupTitle
  /* Apply the persisted per-group order; unknown docs keep registry order. */
  const storedOrder = mindmapOrder[groupKey] ?? []
  const orderIndex = new Map(storedOrder.map((id, index) => [String(id), index]))
  const ordered = [...entries].sort((a, b) => {
    const ia = orderIndex.get(String(a.sessionId))
    const ib = orderIndex.get(String(b.sessionId))
    if (ia === undefined && ib === undefined) return 0
    if (ia === undefined) return 1
    if (ib === undefined) return -1
    return ia - ib
  })
  /* In per-group mode an empty group renders nothing (CSS :empty collapses
     the seat); only the fallback shows the empty hint. The injected container
     is the styled seat, so children render directly (Fragment). */
  /* NOTE: the early return below must come after every hook (React #310). */
  useEffect(() => {
    if (contextMenu === null) return undefined
    const close = () => setContextMenu(null)
    const onPointerDown = event => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      close()
    }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    /* Same inside-menu guard as pointerdown: a scrollable menu must not close
       itself while its list is being scrolled. */
    const onScroll = event => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [contextMenu])

  if (entries.length === 0 && groupTitle !== undefined) return null

  const commitDrop = () => {
    const sourceId = dragId
    const target = dropTarget
    setDragId(null)
    setDropTarget(null)
    if (sourceId === null || target === null || sourceId === target.id) return
    const ids = ordered.map(doc => String(doc.sessionId))
    const from = ids.indexOf(sourceId)
    if (from === -1) return
    ids.splice(from, 1)
    const to = ids.indexOf(target.id)
    if (to === -1) return
    ids.splice(target.half === 'after' ? to + 1 : to, 0, sourceId)
    /* Read-modify-write INSIDE the Web Lock (updateMindmapOrder re-reads under
       the lock): a concurrent tab's drag must not be clobbered by a stale
       in-memory order. The merged map keeps the local copy in step. */
    void updateMindmapOrder(groupKey, ids).then(map => {
      if (map !== undefined) setMindmapOrder({ ...map })
    })
  }
  const entryDragOver = (event, sid) => {
    if (dragId === null || dragId === sid) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget(prev => (prev !== null && prev.id === sid && prev.half === half ? prev : { id: sid, half }))
  }
  const listDragOver = (event) => {
    if (dragId === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    if (first === undefined || last === undefined) return
    const rect = event.currentTarget.getBoundingClientRect()
    const target = event.clientY < rect.top + rect.height / 2
      ? { id: String(first.sessionId), half: 'before' }
      : { id: String(last.sessionId), half: 'after' }
    setDropTarget(prev => (prev !== null && prev.id === target.id && prev.half === target.half ? prev : target))
  }

  const startRename = () => {
    if (contextMenu === null) return
    const sid = contextMenu.sessionId
    /* Renaming edits the MIND MAP's own title (doc.rootTitle), independent of
       the root session's title. */
    const doc = docs.find(d => String(d.sessionId) === String(sid))
    const row = byId[sid]
    setContextMenu(null)
    setRenameError(null)
    setRenameTarget({ sessionId: sid, title: doc?.rootTitle ?? row?.displayTitle ?? '' })
  }
  const closeRename = () => {
    if (renameBusy) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBusy || renameTarget === null) return
    const trimmed = renameTarget.title.trim()
    if (trimmed === '') return
    setRenameBusy(true)
    setRenameError(null)
    const sid = renameTarget.sessionId
    renameMindmapDoc(sid, trimmed)
      .then(() => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameTarget(null)
        mindmapRegistry.markDirty()
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameError(error instanceof Error ? error.message : String(error))
      })
  }
  const onReveal = () => {
    if (contextMenu === null) return
    const id = contextMenu.sessionId
    setContextMenu(null)
    revealSession(id)
  }

  const menuView = contextMenu !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-context-menu',
      ref: menuRef,
      role: 'menu',
      style: {
        left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)),
        top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 92)),
      },
    },
      h('button', { className: 'dsh-ws-context-item', onClick: startRename, role: 'menuitem', type: 'button' }, translate('context.renameSession')),
      h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
      h('button', { className: 'dsh-ws-context-item', onClick: onReveal, role: 'menuitem', type: 'button' }, translate('context.reveal'))),
    document.body,
  ) : null
  const renameView = renameTarget !== null ? h(SessionRenameDialog, {
    busy: renameBusy,
    draft: renameTarget.title,
    error: renameError,
    onCancel: closeRename,
    onConfirm: confirmRename,
    onDraft: value => { setRenameError(null); setRenameTarget(t => t === null ? t : { ...t, title: value }) },
    title: translate('mindmap.sidebar.renameTitle'),
  }) : null

  return h(Fragment, null,
    entries.length === 0
      ? h('div', { className: 'dsh-ws-sidebar-mindmaps-empty' }, translate('mindmap.sidebar.empty'))
      : h('div', {
        className: 'dsh-ws-sidebar-mindmaps-list',
        onDragLeave: (event) => { if (!(event.currentTarget.contains(event.relatedTarget))) setDropTarget(null) },
        onDragOver: listDragOver,
        onDrop: (event) => { event.preventDefault(); commitDrop() },
      },
        ordered.map(doc => {
          const row = byId[String(doc.sessionId)]
          /* The entry shows the mind map's OWN title (doc.rootTitle), not the
             root session's — the two are independent after a rename. */
          const label = doc.rootTitle ?? row?.displayTitle ?? ''
          const count = (doc.branchSessionIds ?? []).length
          const sid = String(doc.sessionId)
          /* Any family member streaming (summary.running flips at generation
             start) spins the entry's icon — the signal the hidden rows would
             have shown. */
          const running = [sid, ...(doc.branchSessionIds ?? [])].some(id => byId[id]?.running === true)
          return h('button', {
            className: 'dsh-ws-sidebar-mindmaps-item',
            'data-dragging': dragId === sid ? '' : undefined,
            'data-drop': dropTarget !== null && dropTarget.id === sid ? dropTarget.half : undefined,
            'data-running': running ? '' : undefined,
            draggable: true,
            key: sid,
            /* A genuine drag ends with a click in some engines; suppress the
               click right after a drag so reordering never opens the session. */
            onClick: () => {
              if (Date.now() - lastDragEndRef.current < 400) return
              openSession(sid)
            },
            onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ sessionId: sid, x: event.clientX, y: event.clientY }) },
            onDragEnd: () => { lastDragEndRef.current = Date.now(); setDragId(null); setDropTarget(null) },
            onDragOver: (event) => { entryDragOver(event, sid) },
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = 'move'
              try { event.dataTransfer.setData('text/plain', sid) } catch { /* some engines disallow setData during dragstart */ }
              setDragId(sid)
            },
            title: translate('mindmap.sidebar.open'),
            type: 'button',
          },
            h('svg', { 'aria-hidden': true, className: 'dsh-ws-sidebar-mindmaps-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
            h('span', { className: 'dsh-ws-sidebar-mindmaps-label' }, label),
            count > 0 ? h('span', { className: 'dsh-ws-sidebar-mindmaps-count' }, translate('mindmap.sidebar.branches', { n: count })) : null)
        })),
    menuView,
    renameView)
}