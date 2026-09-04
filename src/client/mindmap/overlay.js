import { createElement as h, Fragment, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { translate } from '../locale/index.js'
import { mindmapConvertedSessions } from './hider.js'
import { MINDMAP_ICON } from './panel.js'
import { mindmapDockStore, mindmapRegistry, useMindmapRegistry } from './registry.js'

/* The session-header mind-map button: opens the current session's mind map as
   a preview tab (dsh-ws-preview) — the map lives in the tab strip and can be
   switched freely against file tabs. On a NORMAL session the first click asks
   for confirmation before converting; only "yes" converts. */
export function MindmapHeaderButton({ sessionId }) {
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
  /* Escape closes the confirm dialog. */
  useEffect(() => {
    if (confirmTarget === null) return undefined
    const onKeyDown = event => { if (event.key === 'Escape') closeConfirm() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeConfirm, confirmTarget])
  /* No current session (hero page / transient): nothing to map yet. */
  if (sessionId === undefined || sessionId === null) return null
  const key = String(sessionId)
  /* The background index may lag a fresh conversion, so the membership check
     uses the last known registry state plus in-flight conversions
     (see mindmapConvertedSessions). */
  const member = mindmapRegistry.isMember(key) || mindmapConvertedSessions.has(key)
  const label = translate('view.mindmap')
  /* Resolve the map's ROOT session (a branch click must dock the SAME tab as
     the root — the doc is keyed by root) and its title from the doc index. */
  const rootDocOf = (id) => {
    const docs = mindmapRegistry.getDocs()
    for (const doc of docs) {
      if (String(doc?.sessionId) === String(id)) return doc
      if ((doc?.branchSessionIds ?? []).some(b => String(b) === String(id))) return doc
    }
    return null
  }
  const dockMap = (id) => {
    const doc = rootDocOf(id)
    const rootId = doc?.sessionId ?? String(id)
    /* expectFamily = the map's root: the header button docks the CURRENT
       session's own map, whose family the mounted explorer already matches
       (member sessions share the root's previewSessionId; a fresh conversion
       keys on the session id itself), so the click-time explorer consumes it
       exactly as before — the gate only stops OTHER sessions' mounts. */
    mindmapDockStore.dock(rootId, doc?.rootTitle ?? '', rootId)
  }
  const onButtonClick = () => {
    /* Registry confirms membership: drop the redundant converted-set entry. */
    if (mindmapRegistry.isMember(key)) mindmapConvertedSessions.delete(key)
    /* Already a mind-map member (root or branch): dock the map as a tab. */
    if (member) { dockMap(key); return }
    /* A normal session: ask before converting it into a mind map. */
    setConfirmTarget(key)
  }
  const confirmConvert = () => {
    setConfirmTarget(null)
    /* Remember the conversion so the next click docks until the background
       index catches up (see mindmapConvertedSessions). */
    mindmapConvertedSessions.add(key)
    dockMap(key)
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
      className: 'dsh-ws-mindmap-header-button',
      onClick: onButtonClick,
      title: label,
      type: 'button',
    },
      h('svg', { 'aria-hidden': true, className: 'dsh-ws-mindmap-header-icon', fill: 'none', viewBox: '0 0 24 24' }, MINDMAP_ICON),
      h('span', { className: 'dsh-ws-mindmap-header-label' }, label)),
    confirmView)
}
