/** Session-row context menu + inline rename, archive and reveal feedback, owned here because the target rows live in the harness sidebar slot this component renders. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../locale/index.js'
import { revealInExplorer } from '../api.js'
import { mindmapDescendantsOf } from '../mindmap/helpers.js'
import { mindmapDockStore, mindmapRegistry, readMindmapLastSession } from '../mindmap/registry.js'

export function useSessionMenu({ props, mountedRef }) {
  const [sessionContextMenu, setSessionContextMenu] = useState()
  const sessionContextRowRef = useRef(null)
  const sessionMenuRef = useRef(null)
  const [sessionInlineRename, setSessionInlineRename] = useState()
  const [sessionInlineRenameBusy, setSessionInlineRenameBusy] = useState(false)
  const [sessionInlineRenameError, setSessionInlineRenameError] = useState()
  const [sessionNotice, setSessionNotice] = useState()
  const sessionNoticeTimerRef = useRef()
  /* Abort in-flight reveal requests on unmount and supersede the previous one per call. */
  const revealControllerRef = useRef()
  const showSessionNotice = useCallback((text, error = false) => {
    setSessionNotice({ error, text })
    clearTimeout(sessionNoticeTimerRef.current)
    sessionNoticeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSessionNotice(undefined)
    }, error ? 3000 : 1600)
  }, [])
  useEffect(() => {
    return () => {
      clearTimeout(sessionNoticeTimerRef.current)
      revealControllerRef.current?.abort()
    }
  }, [])
  // Right-click detection on harness session rows: match the row's display title against the sessions snapshot, preferring the current session on duplicate titles.
  useEffect(() => {
    const onContextMenu = (event) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest('[role="treeitem"]')
      if (row === null) return
      if (row.hasAttribute('aria-expanded')) return
      if (row.closest('[data-slot="sidebar.workspaces"]') === null) return
      const titleSpan = row.querySelector('span[class*="title"]')
      const title = titleSpan?.textContent?.trim() ?? ''
      if (title === '') return
      const snapshot = props.getSessionList()
      const candidates = snapshot.ids.filter(id => {
        const summary = snapshot.byId[id]
        /* Exclude subagent and blank sessions: they must never win the duplicate-title match and shadow a real session's row. */
        return summary !== undefined && summary.origin !== 'subagent' && summary.blank !== true && summary.displayTitle === title
      })
      if (candidates.length === 0) return
      let sessionId = candidates[0]
      if (snapshot.current !== undefined && candidates.includes(snapshot.current)) sessionId = snapshot.current
      const summary = snapshot.byId[sessionId]
      if (summary === undefined || summary.blank) return
      /* Duplicate titles are ambiguous: flag the menu so items show the target id and archive asks for confirmation. */
      const ambiguous = candidates.length > 1
      event.preventDefault()
      sessionContextRowRef.current = row
      setSessionContextMenu({ sessionId, title, x: event.clientX, y: event.clientY, ambiguous })
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [props.getSessionList])
  // Close the session menu on outside pointer/context/scroll, Escape and resize.
  useEffect(() => {
    if (sessionContextMenu === undefined) return undefined
    const inside = event => { const node = sessionMenuRef.current; return node !== null && event.target instanceof Node && node.contains(event.target) }
    const close = () => setSessionContextMenu(undefined)
    const onPointerDown = event => { if (!inside(event)) close() }
    const onContextMenu = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [sessionContextMenu])
  const beginSessionInlineRename = useCallback(() => {
    const menu = sessionContextMenu
    if (menu === undefined) return
    setSessionContextMenu(undefined)
    setSessionInlineRenameError(undefined)
    setSessionInlineRename({ sessionId: menu.sessionId, title: menu.title, row: sessionContextRowRef.current })
  }, [sessionContextMenu])
  const cancelSessionInlineRename = useCallback(() => {
    if (sessionInlineRenameBusy) return
    setSessionInlineRename(undefined)
    setSessionInlineRenameError(undefined)
  }, [sessionInlineRenameBusy])
  const confirmSessionInlineRename = useCallback((draft) => {
    const target = sessionInlineRename
    if (target === undefined || sessionInlineRenameBusy) return
    const trimmed = draft.trim()
    if (trimmed === '') return
    if (trimmed === target.title) { setSessionInlineRename(undefined); return }
    setSessionInlineRenameBusy(true)
    setSessionInlineRenameError(undefined)
    props.renameSession(String(target.sessionId), trimmed).then(() => {
      if (!mountedRef.current) return
      setSessionInlineRenameBusy(false)
      setSessionInlineRename(undefined)
    }).catch(error => {
      if (!mountedRef.current) return
      setSessionInlineRenameBusy(false)
      setSessionInlineRenameError(error instanceof Error ? error.message : String(error))
    })
  }, [props.renameSession, sessionInlineRename, sessionInlineRenameBusy])
  const archiveSessionFromMenu = useCallback(() => {
    const menu = sessionContextMenu
    if (menu === undefined) return
    /* A duplicate-title match may target the wrong session, so require explicit confirmation naming it. */
    if (menu.ambiguous === true) {
      const shortId = String(menu.sessionId).slice(0, 8)
      if (typeof window === 'undefined' || !window.confirm(translate('context.archiveAmbiguousConfirm', { id: shortId }))) return
    }
    setSessionContextMenu(undefined)
    setSessionInlineRename(undefined)
    // A fork root archives its whole derived branch tree; standalone sessions archive just themselves.
    const snapshot = props.getSessionList()
    const parentOf = new Map()
    for (const id of snapshot.ids) {
      const summary = snapshot.byId[id]
      if (summary === undefined || summary.origin === 'subagent' || summary.blank) continue
      const parent = summary.parentId
      if (parent !== undefined) parentOf.set(id, String(parent))
    }
    const ids = [...new Set([String(menu.sessionId), ...mindmapDescendantsOf(parentOf, String(menu.sessionId))])]
    const run = async () => {
      for (const id of ids) await props.archiveSession(id)
      // Archiving a mind-map root removes the whole map: drop its doc so the sidebar entry disappears with it.
      if (mindmapRegistry.isRoot(String(menu.sessionId))) {
        try { await props.deleteMindmapDoc(String(menu.sessionId)) } catch { /* best effort */ }
        mindmapRegistry.markDirty()
      }
    }
    run().then(() => {
      if (!mountedRef.current) return
      const count = ids.length
      showSessionNotice(count > 1 ? translate('status.archivedSessions', { n: count }) : translate('status.archivedSession'))
    }).catch(error => {
      if (!mountedRef.current) return
      showSessionNotice(translate('status.archiveFailed', { message: error instanceof Error ? error.message : String(error) }), true)
    })
  }, [props.archiveSession, props.deleteMindmapDoc, props.getSessionList, sessionContextMenu, showSessionNotice])
  /* Reveal a session's workspace in the OS file explorer. */
  const revealSessionById = useCallback((sessionId) => {
    let workspace
    try {
      const snapshot = props.getSessionList()
      const row = snapshot.byId[String(sessionId)]
      const items = props.getWorkspaceItems()
      // Malformed workspace items (missing sessionIds) must not throw.
      workspace = (row !== undefined && items.find(item => Array.isArray(item?.sessionIds) && item.sessionIds.includes(String(sessionId))))
        || (row?.cwd !== undefined && items.find(item => item.path === row.cwd))
    } catch (error) {
      showSessionNotice(translate('status.revealFailed', { message: error instanceof Error ? error.message : String(error) }), true)
      return
    }
    if (workspace === undefined) {
      showSessionNotice(translate('status.revealNoWorkspace'), true)
      return
    }
    const controller = new AbortController()
    revealControllerRef.current?.abort()
    revealControllerRef.current = controller
    revealInExplorer(String(workspace.workspaceId), '', controller.signal).then(() => {
      if (mountedRef.current) showSessionNotice(translate('status.revealed'))
    }).catch(error => {
      if (!mountedRef.current || (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError')) return
      const message = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
        ? translate('editor.requestTimeout')
        : (error instanceof Error ? error.message : String(error))
      showSessionNotice(translate('status.revealFailed', { message }), true)
    })
  }, [props.getSessionList, props.getWorkspaceItems, showSessionNotice])
  const revealSessionFromMenu = useCallback(() => {
    const menu = sessionContextMenu
    if (menu === undefined) return
    setSessionContextMenu(undefined)
    setSessionInlineRename(undefined)
    revealSessionById(menu.sessionId)
  }, [revealSessionById, sessionContextMenu])
  // Sidebar mind-map entries: land the chat on the map first, then dock it as
  // a preview tab. The dock request is only consumed by the explorer whose
  // previewSessionId matches, so the map's tab never leaks into the leaving
  // session's snapshot. The switch targets the map's remembered session while
  // it still resolves to this map's root, else falls back to the root.
  const openMindmapSession = useCallback((id, name) => {
    const rootId = String(id)
    const remembered = readMindmapLastSession(rootId)
    const target = remembered !== null
      && props.getSessionList().byId[String(remembered)] !== undefined
      && mindmapRegistry.rootOf(String(remembered)) === rootId
      ? String(remembered)
      : rootId
    props.mindmapActions?.openSession(target)
    mindmapDockStore.dock(rootId, name, rootId)
  }, [props.getSessionList, props.mindmapActions])
  return {
    sessionContextMenu, sessionMenuRef, sessionInlineRename, sessionInlineRenameBusy,
    sessionInlineRenameError, sessionNotice, beginSessionInlineRename,
    cancelSessionInlineRename, confirmSessionInlineRename, archiveSessionFromMenu,
    revealSessionById, revealSessionFromMenu, openMindmapSession,
  }
}
