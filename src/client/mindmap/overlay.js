import { createElement as h, Fragment, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { PREVIEW_MIN, SIDEBAR_MIN } from '../constants.js'
import { translate } from '../locale/index.js'
import { MindMapView } from './view.js'
import { mindmapConvertedSessions } from './hider.js'
import { MINDMAP_ICON } from './panel.js'
import { mindmapOverlayStore, mindmapRegistry, useMindmapOverlay, useMindmapRegistry } from './registry.js'

/* The session-header mind-map button: opens the floating mind-map overlay
   for the current session (chat stays visible) instead of a full-page map.
   Clicking again / close / Escape closes it. On a NORMAL session the first
   click asks for confirmation before converting; only "yes" converts. */
export function MindmapHeaderButton({ sessionId }) {
  const overlay = useMindmapOverlay()
  // Track the doc index so isMember sees a fresh conversion without an
  // unrelated re-render, or the button keeps offering the convert dialog.
  const registry = useMindmapRegistry()
  const registryVersion = registry.getVersion()
  const [confirmTarget, setConfirmTarget] = useState(null)
  /* Declared BEFORE the Escape effect so the effect can reference it (and list
     it) without the use-before-declaration smell: a reorder keeps the closure
     and the dependency array in sync. */
  const closeConfirm = () => setConfirmTarget(null)
  useEffect(() => {
    if (sessionId !== undefined && sessionId !== null && registry.isMember(String(sessionId))) {
      mindmapConvertedSessions.delete(String(sessionId))
    }
  }, [registryVersion, sessionId])
  /* Escape closes the confirm dialog: the overlay's own Escape handler defers
     while any .dsh-ws-dialog-backdrop is in the DOM, so this window listener
     is required. It sits before the early return so a sessionId transition
     does not change the hook count (React #310). */
  useEffect(() => {
    if (confirmTarget === null) return undefined
    const onKeyDown = event => { if (event.key === 'Escape') closeConfirm() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeConfirm, confirmTarget])
  /* No current session (hero page / transient): nothing to map yet. */
  if (sessionId === undefined || sessionId === null) return null
  const key = String(sessionId)
  const active = overlay.open && String(overlay.sessionId) === key
  /* The background index may lag a fresh conversion, so the membership check
     uses the last known registry state plus in-flight conversions
     (see mindmapConvertedSessions). */
  const member = mindmapRegistry.isMember(key) || mindmapConvertedSessions.has(key)
  const label = translate('view.mindmap')
  const onButtonClick = () => {
    /* Registry confirms membership: drop the redundant converted-set entry. */
    if (mindmapRegistry.isMember(key)) mindmapConvertedSessions.delete(key)
    /* Already a mind-map member (root or branch): plain open/close toggle. */
    if (member) { mindmapOverlayStore.toggle(key); return }
    /* Overlay open on a normal session (empty session / registry not caught
       up): the button still acts as a close toggle. */
    if (active) { mindmapOverlayStore.close(); return }
    /* A normal session: ask before converting it into a mind map. */
    setConfirmTarget(key)
  }
  const confirmConvert = () => {
    setConfirmTarget(null)
    /* Remember the conversion so the next click toggles until the background
       index catches up (see mindmapConvertedSessions). */
    mindmapConvertedSessions.add(key)
    mindmapOverlayStore.open(key)
  }
  /* Portal the confirm dialog to body: .dsh-ws-chat clips fixed-position
     descendants, so the modal would be cut to the chat column. */
  const confirmView = confirmTarget !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-dialog-backdrop',
      onMouseDown: event => { if (event.target === event.currentTarget) closeConfirm() },
    },
      h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-mindmap-confirm-dialog', role: 'dialog' },
        h('div', { className: 'dsh-ws-dialog-header' },
          h('div', { className: 'dsh-ws-dialog-title' }, translate('mindmap.confirm.title')),
          h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', onClick: closeConfirm, title: translate('dialog.close'), type: 'button' }, '×')),
        h('div', { className: 'dsh-ws-dialog-body' },
          h('div', { className: 'dsh-ws-dialog-message' }, translate('mindmap.confirm.message'))),
        h('div', { className: 'dsh-ws-dialog-footer' },
          h('button', { className: 'dsh-ws-text-button dsh-ws-mindmap-confirm-button dsh-ws-mindmap-confirm-cancel', onClick: closeConfirm, type: 'button' }, translate('dialog.cancel')),
          h('button', { className: 'dsh-ws-text-button dsh-ws-mindmap-confirm-button dsh-ws-mindmap-confirm-ok', onClick: confirmConvert, type: 'button' }, translate('mindmap.confirm.action'))))),
    document.body) : null
  return h(Fragment, null,
    h('button', {
      'aria-label': label,
      'aria-pressed': active,
      className: active ? 'dsh-ws-mindmap-header-button dsh-ws-mindmap-header-button-on' : 'dsh-ws-mindmap-header-button',
      onClick: onButtonClick,
      title: label,
      type: 'button',
    },
      h('svg', { 'aria-hidden': true, className: 'dsh-ws-mindmap-header-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
      h('span', { className: 'dsh-ws-mindmap-header-label' }, label)),
    confirmView)
}
/* The sidebar-footer mobile toggle: switches to the centered phone column.
   Entering mobile opens the floating sidebar drawer by default; leaving
   clears the drawer and file-fullscreen sub-states. */
export function MindmapOverlayHost({ sessionId, useSessions, actions, chatWidth, mobile, previewRight, previewWidth, sidebarWidth, settingsStore }) {
  const overlay = useMindmapOverlay()
  const overlayRef = useRef(null)
  const closeLabel = translate('mindmap.overlay.close')
  /* Scope 'full' (default) spans everything left of the chat column; scope
     'sidebar' narrows the window to just the sidebar column (the file browser
     area is left visible). When the file browser sits on the RIGHT of the
     conversation column, the window switches sides instead: 'sidebar' fills
     the left sidebar, 'full' fills the right file browser, keeping the chat
     column visible and interactive in the middle. On mobile the window is
     always full screen. */
  const rightPanel = !mobile && previewRight === true && overlay.scope === 'full' && previewWidth > 0
  const width = mobile
    ? '100%'
    : rightPanel
      ? `${Math.max(PREVIEW_MIN, previewWidth)}px`
      : previewRight === true
        /* Right-side layout: 'sidebar' fills the left sidebar; with no visible
           file-browser pane there is nothing on the right to fill, so the full
           window stays on the left column too. */
        ? `${Math.max(SIDEBAR_MIN, sidebarWidth)}px`
        : overlay.scope === 'sidebar'
          /* A collapsed sidebar (width 0) must not leave an invisible-but-open
             overlay: keep a usable minimum width in that state. */
          ? `${Math.max(SIDEBAR_MIN, sidebarWidth)}px`
          : `calc(100% - ${Math.max(0, chatWidth)}px)`
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      /* Let an open dialog/context menu inside the map handle Escape first. */
      if (document.querySelector('.dsh-ws-dialog-backdrop, .dsh-ws-context-menu') !== null) return
      /* An Escape aimed at a DIFFERENT surface (session-switcher dropdown,
         inline rename input, search popover in the chat column) must not also
         close the map: the target's own handler owns that key, and the target
         lives outside the overlay. Only close when the event target is inside
         the overlay (or not focusable at all). */
      const target = event.target
      if (target instanceof Node && overlayRef.current !== null && !overlayRef.current.contains(target)) return
      mindmapOverlayStore.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return h('div', { className: 'dsh-ws-mindmap-overlay', 'data-side': rightPanel ? 'right' : undefined, ref: overlayRef, style: { width } },
    h('button', {
      'aria-label': closeLabel,
      className: 'dsh-ws-mindmap-overlay-close',
      onClick: () => { mindmapOverlayStore.close() },
      title: closeLabel,
      type: 'button',
    }, '×'),
    h(MindMapView, {
      archiveSession: actions.archiveSession,
      createSession: actions.createSession,
      deleteDoc: actions.deleteDoc,
      forkAt: actions.forkAt,
      listWorkspaces: actions.listWorkspaces,
      loadDoc: actions.loadDoc,
      openSession: id => { actions.openSession(String(id)); mindmapOverlayStore.setSession(String(id)) },
      previewRight: previewRight === true,
      renameDoc: actions.renameDoc,
      renameSession: actions.renameSession,
      saveDoc: actions.saveDoc,
      sessionId: String(sessionId),
      settingsStore,
      syncDoc: actions.syncDoc,
      useSessions,
    }))
}
