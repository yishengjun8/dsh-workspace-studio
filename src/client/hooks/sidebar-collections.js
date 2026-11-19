/** Sidebar DOM work for workspace collections.
 *
 * Two couplings to the Harness sidebar live here (see dev-notes §47):
 *
 *  1. Filtering is a generated STYLESHEET, not a per-frame DOM pass. Harness workspace groups carry
 *     `data-row-key="workspace:<workspaceId>"` (the ungrouped bucket has the empty id) and session
 *     rows carry `data-row-key="session:<sessionId>"`, so one rule per hidden group — using `:has()`,
 *     an idiom this plugin already relies on — hides the whole section (header, sessions and the
 *     mind-map seat inside it) and survives every React re-render without mutation work.
 *  2. The `+N` / "not in this collection" chips are `::after` rules (pure CSS, no injected nodes);
 *     only their tooltip needs a `title` attribute, applied best-effort because the Harness owns
 *     those rows. The permanent per-row collection icon, by contrast, IS a real injected node —
 *     a pseudo-element cannot receive its own click.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COLLECTION_ALL_ID } from '../constants.js'
import { createStyleSheet } from '../style-sheet.js'
import { shouldSkipPoll } from '../poll-gate.js'
import { collectionById, collectionFilterPlan, collectionsOfWorkspace, readHarnessGroupBy } from '../collections.js'
import { dismissesMenuOnScroll } from '../menu-dismiss.js'

/** Re-check the Harness grouping mode this often: its view store belongs to another package and does
 *  not notify us, and 按工作区 ⇄ 按工作区树 can leave the sidebar DOM identical. */
const GROUP_BY_POLL_MS = 1000
const STYLE_ELEMENT_ID = 'dsh-ws-collection-filter'
/* THE sheet this feature paints the collection filter through (see style-sheet.js). */
const collectionFilterSheet = createStyleSheet(STYLE_ELEMENT_ID)
/** The permanent per-row collection control (see useWorkspaceCollectionMenu). */
const ROW_ICON_CLASS = 'dsh-ws-collection-rowicon'
const ROW_ICON_GLYPH = '▤'
/** The one-click "join this collection" chip on a row the shown collection filters out. */
const ROW_JOIN_CLASS = 'dsh-ws-collection-join'
/** How long the error state of the join chip survives before returning to its idle copy. */
const JOIN_ERROR_MS = 6000
/** How long the joined row keeps its confirmation flash. */
const JOIN_FLASH_MS = 700

const escapeAttribute = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')

/* ---- the "join this collection" chip (a real node: a pseudo-element cannot receive its click) ---- */

const NO_JOIN_IDS = new Set()

/** Write the two halves of the chip ("不在本合集" / "＋ 加入"). */
function setJoinCopy(button, state, action) {
  const stateNode = button.firstElementChild
  const actionNode = button.lastElementChild
  const nextState = typeof state === 'string' ? state : ''
  const nextAction = typeof action === 'string' ? action : ''
  if (stateNode !== null && stateNode.textContent !== nextState) stateNode.textContent = nextState
  if (actionNode !== null && actionNode.textContent !== nextAction) actionNode.textContent = nextAction
}

/** The name of the collection on screen; '' when the shown view is not a user collection. */
function currentCollectionName(doc) {
  return collectionById(doc, doc?.selectedId)?.name ?? ''
}

/**
 * Paint one join chip from the current document + copy.
 *
 * A chip mid-flight (busy) or showing an error keeps its own copy: the MutationObserver re-applies
 * this on every sidebar mutation, so repainting those states from the store would wipe the feedback
 * the user is looking at.
 */
function paintJoinButton(button, snapshot, workspaceId) {
  const labels = snapshot?.labels
  const name = currentCollectionName(snapshot?.doc)
  const title = typeof labels?.joinTitle === 'function' ? labels.joinTitle(name) : ''
  if (title !== '') {
    if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title)
    if (button.getAttribute('title') !== title) button.setAttribute('title', title)
  }
  if (button.hasAttribute('data-busy')) return
  const failed = button.hasAttribute('data-error')
  setJoinCopy(
    button,
    failed ? labels?.joinFailed : labels?.joinState,
    failed ? labels?.joinRetry : labels?.joinAction,
  )
}

/**
 * Add the row's workspace to the collection on screen (one Host round trip).
 *
 * The click reads the LIVE store rather than a render-time closure: between the paint and the click
 * the user may have switched, renamed or deleted the collection. The patch carries the FULL member
 * list because the Host merges patches — a bare id would mean "replace the members".
 */
function joinRow(button, live) {
  if (button.hasAttribute('data-busy')) return
  const row = button.parentElement
  const key = row === null ? '' : row.getAttribute('data-row-key') ?? ''
  if (!key.startsWith('workspace:')) return
  const workspaceId = key.slice('workspace:'.length)
  const handler = live.current?.onJoin
  if (typeof handler !== 'function') return
  button.setAttribute('data-busy', '')
  setJoinCopy(button, live.current?.labels?.joinState, live.current?.labels?.joinBusy)
  const settle = (result, rejected) => {
    if (!button.isConnected) return
    button.removeAttribute('data-busy')
    if (rejected !== true && result?.ok === true) {
      /* The patch lands in the store, the plan drops this id, and the next apply removes the chip;
         the flash marks where the click happened. */
      if (row !== null) {
        row.setAttribute('data-join-flash', '')
        setTimeout(() => { row.removeAttribute('data-join-flash') }, JOIN_FLASH_MS)
      }
      return
    }
    button.setAttribute('data-error', '')
    setJoinCopy(button, live.current?.labels?.joinFailed, live.current?.labels?.joinRetry)
    setTimeout(() => {
      if (!button.isConnected) return
      button.removeAttribute('data-error')
      paintJoinButton(button, live.current, workspaceId)
    }, JOIN_ERROR_MS)
  }
  Promise.resolve(handler(workspaceId)).then(result => settle(result, false), () => settle(undefined, true))
}

/** The chip node itself. Its click must not reach the row (the row toggles expand/collapse). */
function createJoinButton(live) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ROW_JOIN_CLASS
  const state = document.createElement('span')
  state.className = 'dsh-ws-collection-join-state'
  const separator = document.createElement('span')
  separator.className = 'dsh-ws-collection-join-sep'
  separator.setAttribute('aria-hidden', 'true')
  const action = document.createElement('span')
  action.className = 'dsh-ws-collection-join-action'
  button.append(state, separator, action)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    joinRow(button, live)
  })
  return button
}

/**
 * The Harness workspace-browser grouping mode, polled (see GROUP_BY_POLL_MS).
 * @returns 'workspace' | 'workspace-tree' | 'flat'.
 */
export function useCollectionGroupBy() {
  const [mode, setMode] = useState(() => readHarnessGroupBy())
  useEffect(() => {
    setMode(readHarnessGroupBy())
    const timer = setInterval(() => {
      if (shouldSkipPoll()) return
      setMode(previous => {
        const next = readHarnessGroupBy()
        return next === previous ? previous : next
      })
    }, GROUP_BY_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return mode
}

/**
 * Apply the collection filter to the Harness sidebar.
 *
 * @param props.doc - normalized collection document.
 * @param props.workspaces - Harness workspace items (membership lives on their sessionIds).
 * @param props.paused - true while the grouping mode is not "按工作区" (no rules at all).
 * @param props.currentWorkspaceId - the viewed session's workspace; when it sits outside the shown
 *   collection its group stays visible, dashed, as the "not in this collection" marker.
 * @param props.labels - localized chip copy: `{ outside, outsideView }`.
 * @returns the filter plan (`{ css, chips, empty, joinIds }`) — `joinIds` is what
 *   useWorkspaceCollectionMenu turns into the one-click "join" chip.
 */
export function useCollectionsFilter({ doc, workspaces, paused, currentWorkspaceId, labels }) {
  const titledRef = useRef(new Set())
  const currentId = doc?.selectedId ?? COLLECTION_ALL_ID

  /* The whole decision is a pure function (collections.js); this hook only paints it. */
  const plan = useMemo(() => collectionFilterPlan({
    currentId,
    currentWorkspaceId,
    doc,
    labels,
    paused,
    workspaces,
  }), [currentId, currentWorkspaceId, doc, labels, paused, workspaces])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    collectionFilterSheet.publish(plan.css)
    return undefined
  }, [plan])

  /* A view filtered down to nothing says so through the generated stylesheet itself (see
     collectionFilterPlan): a pseudo-element on the region cannot be wiped by a React re-render, which
     an injected node could. */

  useEffect(() => () => {
    /* The sheet is meaningless without the dropdown that owns it. */
    collectionFilterSheet.dispose()
  }, [])

  /* Best-effort chip tooltips: the Harness owns these rows, so a title it overwrites is reapplied on
     the next change instead of being fought over. A row that carries the join chip says the same
     thing there as on the chip itself, so hovering the row and hovering the button do not disagree. */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const region = document.querySelector('[data-slot="sidebar.workspaces"]')
    const next = new Set()
    if (region !== null && !paused) {
      for (const chip of plan.chips) {
        const row = region.querySelector(`[data-row-key="workspace:${escapeAttribute(chip.workspaceId)}"]`)
        if (row === null) continue
        const title = chip.kind === 'outside'
          ? (chip.join === true && typeof labels.joinTitle === 'function'
            ? labels.joinTitle(currentCollectionName(doc))
            : labels.outside)
          : chip.names.join('、')
        if (title === '') continue
        row.setAttribute('title', title)
        next.add(chip.workspaceId)
      }
    }
    for (const workspaceId of titledRef.current) {
      if (next.has(workspaceId)) continue
      const row = region?.querySelector(`[data-row-key="workspace:${escapeAttribute(workspaceId)}"]`)
      row?.removeAttribute('title')
    }
    titledRef.current = next
  }, [doc, labels, plan, paused])

  return plan
}

/**
 * The plugin menu on a Harness workspace group row, plus the row's permanent collection icon and the
 * one-click "join this collection" chip.
 *
 * The menu opens from two entry points: a contextmenu on the row (the Harness binds none there, so
 * this is additive and its own `⋯` menu keeps working) and a click on the injected icon.
 *
 * Both controls are REAL nodes, not `::after` chips: a pseudo-element cannot receive its own click,
 * and the Harness's action area (`.rowActions`) is `display:none` until hover, so it cannot host a
 * permanent control either; each is therefore appended as a child of the row (after `.rowActions`)
 * and kept there across React re-renders by a coalesced MutationObserver, as sidebar-chrome.js does
 * for its seats.
 *
 * @param props.doc - normalized collection document (drives the icon's state and tooltip).
 * @param props.labels - localized copy `{ iconNone, iconMember, joinState, joinAction, joinBusy,
 *   joinRetry, joinFailed, joinTitle(name) }`.
 * @param props.joinIds - the filter plan's `joinIds`: rows that keep the "join this collection" chip.
 * @param props.onJoin - `(workspaceId) => Promise<{ ok, error?, doc? }>`, the Host round trip.
 * @returns `{ menu, closeMenu }` where `menu` is `{ workspaceId, x, y }` or undefined.
 */
export function useWorkspaceCollectionMenu({ doc, labels, joinIds, onJoin } = {}) {
  const [menu, setMenu] = useState()
  /* The injected buttons outlive React renders, so their handlers read this ref instead of a
     render-time closure (which would otherwise open the menu or join with a stale document). */
  const live = useRef({ doc, labels, joinIds, onJoin })
  live.current = { doc, labels, joinIds: joinIds ?? NO_JOIN_IDS, onJoin }
  const closeMenu = useCallback(() => setMenu(undefined), [])
  /* The element the open menu points at (the row, or the injected icon that was
     clicked): only a scroll that owns it may close the menu — see
     menu-dismiss.js. */
  const menuAnchorRef = useRef(null)
  const openMenu = useCallback((workspaceId, x, y, anchor) => {
    menuAnchorRef.current = anchor ?? null
    setMenu({ workspaceId, x, y })
  }, [])
  useEffect(() => {
    const onContextMenu = (event) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest('[role="treeitem"][data-row-key]')
      if (row === null) return
      const key = row.getAttribute('data-row-key') ?? ''
      /* Session rows are the session menu's business; `workspace:` with the empty id is Ungrouped. */
      if (!key.startsWith('workspace:') || key === 'workspace:') return
      if (row.closest('[data-slot="sidebar.workspaces"]') === null) return
      event.preventDefault()
      openMenu(key.slice('workspace:'.length), event.clientX, event.clientY, row)
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [openMenu])
  /* Two effects on purpose: the nodes' LIFECYCLE is tied to the region (observer + cleanup), while a
     document or copy change only REPAINTS the buttons that are already there. Folding them together
     would tear every icon down and rebuild it on each document change (visible flicker). */
  const applyRef = useRef(() => {})
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    let frame = 0
    const apply = () => {
      frame = 0
      const region = document.querySelector('[data-slot="sidebar.workspaces"]')
      if (region === null) return
      const { doc: currentDoc, labels: currentLabels } = live.current
      const joins = live.current.joinIds instanceof Set ? live.current.joinIds : NO_JOIN_IDS
      for (const row of region.querySelectorAll('[data-row-key^="workspace:"]')) {
        const key = row.getAttribute('data-row-key') ?? ''
        const workspaceId = key.slice('workspace:'.length)
        if (workspaceId === '') continue
        let button = row.querySelector(`:scope > .${ROW_ICON_CLASS}`)
        if (button === null) {
          button = document.createElement('button')
          button.type = 'button'
          button.className = ROW_ICON_CLASS
          button.textContent = ROW_ICON_GLYPH
          button.addEventListener('click', (event) => {
            /* The row toggles on click: without this, opening the menu would also collapse it. */
            event.preventDefault()
            event.stopPropagation()
            const box = button.getBoundingClientRect()
            openMenu(workspaceId, box.left, box.bottom + 2, button)
          })
          /* Last child on purpose: the Harness reveals its own `+ / ⋯` buttons inside `.rowActions`
             on hover, so anything placed before them gets pushed leftwards. Appending keeps the
             collection icon right-most in both states (the row has no children after rowActions). */
          row.append(button)
        }
        const owned = collectionsOfWorkspace(currentDoc, workspaceId)
        const title = owned.length === 0
          ? currentLabels?.iconNone ?? ''
          : String(currentLabels?.iconMember ?? '').replace('{names}', owned.map(collection => collection.name).join('、'))
        button.dataset.owned = owned.length === 0 ? 'false' : 'true'
        if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title)
        if (button.getAttribute('title') !== title) button.setAttribute('title', title)

        /* The "join this collection" chip: only on the rows the plan kept visible although the shown
           collection filters them out. It must stay the row's LAST control (right-most), so it is
           re-appended whenever something else landed after it. */
        let join = row.querySelector(`:scope > .${ROW_JOIN_CLASS}`)
        if (!joins.has(workspaceId)) {
          if (join !== null) join.remove()
          continue
        }
        if (join === null) join = createJoinButton(live)
        if (row.lastElementChild !== join) row.append(join)
        paintJoinButton(join, live.current, workspaceId)
      }
    }
    applyRef.current = apply
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(apply) }
    apply()
    /* Session rows churn constantly, so this is coalesced into one frame and only ever ensures the
       buttons exist (the work per pass is a handful of attribute reads). */
    const observer = new MutationObserver(schedule)
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
      applyRef.current = () => {}
      document.querySelectorAll(`.${ROW_ICON_CLASS}`).forEach(node => node.remove())
      document.querySelectorAll(`.${ROW_JOIN_CLASS}`).forEach(node => node.remove())
    }
  }, [openMenu])
  useEffect(() => { applyRef.current() }, [doc, joinIds, labels])
  useEffect(() => {
    if (menu === undefined) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      /* Clicks inside the menu belong to it (the submenu is nested in the same element). */
      if (target instanceof Element && target.closest('.dsh-ws-context-menu') !== null) return
      closeMenu()
    }
    const onKeyDown = event => { if (event.key === 'Escape') closeMenu() }
    /* Scrolling the menu's own list (its submenu is nested in the same element)
       belongs to the menu; every other scroll closes it only when it can move
       the anchor. */
    const onScroll = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.dsh-ws-context-menu') !== null) return
      if (dismissesMenuOnScroll(event, menuAnchorRef.current)) closeMenu()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [closeMenu, menu])
  return { menu, closeMenu }
}
