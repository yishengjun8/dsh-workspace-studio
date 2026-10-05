/** Workspace-collection surfaces: the section-title dropdown (switch / rename / create / delete /
 *  reorder / manage members) and the workspace-row context menu that feeds it.
 *
 * Every write goes through `onPatch` (one Host round trip that answers the merged store), so these
 * components hold editing state only: a half-typed name, which row menu is open, the drag's landing
 * slot. What exists is always the store's answer.
 */
import { createElement as h, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COLLECTION_ALL_ID, COLLECTION_LIMIT, COLLECTION_UNOWNED_ID, CONTEXT_MENU_WIDTH } from '../constants.js'
import { dismissesMenuOnScroll, anchorBox } from '../menu-dismiss.js'
import { translate, useLocaleText } from '../locale/index.js'
import { clamp } from '../format.js'
import { collectionById, collectionWorkspaceCount, isBuiltinCollection } from '../collections.js'
import { Modal } from './dialogs.js'

const MENU_WIDTH = 250
const MENU_ROW_HEIGHT = 28
/* Title row + separator + the create row (the list itself is sized from the row count). */
const MENU_CHROME_HEIGHT = 70
const WORKSPACE_MENU_HEIGHT = 96
const SUBMENU_HEIGHT = 150

/** Duplicate-name and limit failures use the text the user is looking at; anything else keeps the
 *  Host's message (already localized by apiErrorMessage). */
function patchErrorMessage(error, name, fallbackKey) {
  if (error?.code === 'collections-name-taken') return translate('collections.name.dup', { name })
  if (error?.code === 'collections-limit') return translate('collections.limit', { n: COLLECTION_LIMIT })
  const message = error instanceof Error ? error.message : ''
  return message === '' ? translate(fallbackKey) : message
}

/** Fixed-position popup placement for the section-title dropdown: anchored to the button's rect, then
 *  clamped into the viewport by the plugin's one menu-placement rule (anchorBox). */
function collectionMenuBox(anchor, height) {
  const rect = anchor === null || anchor === undefined ? null : anchor.getBoundingClientRect()
  return anchorBox(rect === null ? 8 : rect.left, rect === null ? 8 : rect.bottom + 4, MENU_WIDTH, height)
}

/** The built-in views, pinned above the user collections in this order. They are not stored, cannot be
 *  renamed / deleted / dragged, and their counts come from collectionWorkspaceCount. */
const BUILTIN_ROWS = [
  { id: COLLECTION_ALL_ID, nameKey: 'collections.all' },
  { id: COLLECTION_UNOWNED_ID, nameKey: 'collections.unowned' },
]

/** One collection row: grip + check + name + count + row-menu trigger. */
function CollectionRow({ row, count, isCurrent, dragging, onOpenMenu, onSelect, drag }) {
  const builtin = row.builtin === true
  return h('button', {
    'aria-selected': isCurrent,
    className: 'dsh-ws-collection-row',
    'data-builtin': builtin || undefined,
    'data-coll': row.id,
    'data-current': isCurrent || undefined,
    'data-dragging': dragging || undefined,
    draggable: builtin ? undefined : true,
    /* Every row selects, the built-in one included: it is the only way back to the total view, and
       without it a user who switched into a collection is stuck there (the regression that made this
       line unconditional). Dragging is what the built-in row does NOT do. */
    onClick: () => onSelect(row.id),
    onDragEnd: drag.onEnd,
    onDragOver: event => drag.onOver(event, row),
    onDragStart: event => drag.onStart(event, row),
    onDrop: event => drag.onDrop(event, row),
    role: 'option',
    type: 'button',
  },
  h('span', {
    'aria-hidden': true,
    className: 'dsh-ws-collection-grip',
    title: builtin ? undefined : translate('collections.drag.title'),
  }, builtin ? '' : '⠿'),
  h('span', { 'aria-hidden': true, className: 'dsh-ws-collection-check' }, isCurrent ? '✓' : ''),
  h('span', { className: 'dsh-ws-collection-rowname', title: row.name }, row.name),
  h('span', { className: 'dsh-ws-collection-count' }, String(count)),
  builtin
    ? null
    : h('span', {
      'aria-label': translate('collections.rowMenu'),
      className: 'dsh-ws-collection-dots',
      onClick: event => { event.stopPropagation(); onOpenMenu(row.id) },
      role: 'button',
      tabIndex: 0,
    }, '⋯'))
}

/**
 * The collection dropdown that replaces the Harness section title.
 *
 * @param props.doc - normalized collection document (`{ selectedId, collections }`).
 * @param props.workspaces - Harness workspace snapshot items (row counts; dangling ids are ignored).
 * @param props.onSelect - switch to a collection id (the frame persists the selection and jumps).
 * @param props.onPatch - `(patch) => Promise<{ ok, error?, doc? }>`.
 * @param props.notice - `(text, error?) => void`, the frame's transient notice channel.
 * @param props.unavailable - true while the Host store could not be read (an older Host without the
 *   `/collections` route yet, or a failed request): the popup then says so instead of pretending the
 *   profile simply has no collections, and creating stays disabled until a reload succeeds.
 */
export function CollectionsDropdown({ doc, workspaces, onSelect, onPatch, notice, unavailable }) {
  const [open, setOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState()
  const [renaming, setRenaming] = useState()
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [newDraft, setNewDraft] = useState('')
  const [error, setError] = useState()
  const [dragId, setDragId] = useState()
  const [dropAt, setDropAt] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [membersTarget, setMembersTarget] = useState()
  const [box, setBox] = useState({ left: 8, top: 8 })
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const current = collectionById(doc, doc.selectedId)
  /* Two built-in views are not stored collections, so they are named by id. */
  const currentName = current !== undefined
    ? current.name
    : doc.selectedId === COLLECTION_UNOWNED_ID ? translate('collections.unowned') : translate('collections.all')
  const atLimit = doc.collections.length >= COLLECTION_LIMIT
  /* The built-in rows are pinned above the user collections and can never be dragged, renamed or
     deleted; they only select. `localeRevision` keeps their names in the active language. */
  const localeRevision = useLocaleText()
  const rows = useMemo(() => [
    ...BUILTIN_ROWS.map((builtin, index) => ({ id: builtin.id, name: translate(builtin.nameKey), builtin: true, index })),
    ...doc.collections.map((collection, index) => ({ ...collection, index: index + BUILTIN_ROWS.length })),
  ], [doc.collections, localeRevision])
  const menuHeight = MENU_CHROME_HEIGHT + rows.length * MENU_ROW_HEIGHT

  const closeAll = useCallback(() => {
    setOpen(false)
    setRowMenu(undefined)
    setRenaming(undefined)
    setCreating(false)
    setError(undefined)
    setDragId(undefined)
    setDropAt(-1)
  }, [])

  /* Outside pointer / Escape / resize / scroll close the popup, like the plugin's other menus. */
  useEffect(() => {
    if (!open) return undefined
    const inside = event => {
      const target = event.target
      if (!(target instanceof Node)) return false
      return (menuRef.current !== null && menuRef.current.contains(target))
        || (buttonRef.current !== null && buttonRef.current.contains(target))
    }
    const onPointerDown = event => { if (!inside(event)) closeAll() }
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      if (renaming !== undefined || creating) { setRenaming(undefined); setCreating(false); setError(undefined) }
      else closeAll()
    }
    const onMove = () => closeAll()
    /* The popup's own list scrolls (long collection lists): that scroll belongs
       to the menu, not to the region behind it, so it must not close it. */
    const onScroll = event => {
      const target = event.target
      if (menuRef.current !== null && target instanceof Node && menuRef.current.contains(target)) return
      if (dismissesMenuOnScroll(event, buttonRef.current)) closeAll()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [closeAll, creating, open, renaming])

  /** Selecting a collection is a completed action: the popup closes with it (like every edit). */
  const selectCollection = useCallback((id) => {
    closeAll()
    onSelect(id)
  }, [closeAll, onSelect])

  /** Run one patch; on failure either return the error (inline editing) or notice it (row verbs). */
  const run = useCallback(async (patch, message, inline) => {
    setBusy(true)
    const result = await onPatch(patch)
    setBusy(false)
    if (result?.ok === true) {
      if (message !== undefined) notice(message)
      return result
    }
    if (inline !== true) notice(patchErrorMessage(result?.error, '', 'collections.failed'), true)
    return result
  }, [notice, onPatch])

  const commitRename = useCallback(async () => {
    const id = renaming
    if (id === undefined || busy) return
    const name = draft.trim()
    if (name === '') { setError(translate('collections.name.empty')); return }
    if (name === collectionById(doc, id)?.name) { setRenaming(undefined); setError(undefined); return }
    const result = await run({ upsert: [{ id, name }] }, translate('collections.renamed', { name }), true)
    if (result?.ok === true) { closeAll(); return }
    setError(patchErrorMessage(result?.error, name, 'collections.rename.failed'))
  }, [busy, closeAll, doc, draft, renaming, run])

  const commitCreate = useCallback(async () => {
    const name = newDraft.trim()
    if (busy) return
    if (name === '') { setError(translate('collections.name.empty')); return }
    const result = await run({ upsert: [{ name }] }, undefined, true)
    if (result?.ok !== true) {
      setError(patchErrorMessage(result?.error, name, 'collections.create.failed'))
      return
    }
    closeAll()
    /* Names are unique, so the created collection is the one carrying this name. */
    const created = result.doc.collections.find(collection => collection.name === name)
    notice(translate('collections.created', { name }))
    if (created !== undefined) onSelect(created.id)
  }, [busy, closeAll, newDraft, notice, onSelect, run])

  const removeCollection = useCallback(async (id) => {
    const collection = collectionById(doc, id)
    if (collection === undefined) return
    if (typeof window !== 'undefined' && !window.confirm(translate('collections.delete.confirm', { name: collection.name }))) return
    const patch = { remove: [id] }
    /* Deleting the collection being shown has to reselect in the same patch: the Host refuses a
       selection that does not exist after the merge. */
    if (doc.selectedId === id) patch.selectedId = COLLECTION_ALL_ID
    const result = await run(patch, translate('collections.deleted', { name: collection.name }))
    if (result?.ok === true) {
      closeAll()
      if (doc.selectedId === id) onSelect(COLLECTION_ALL_ID)
    }
  }, [closeAll, doc, onSelect, run])

  /**
   * Commit a drag. The rows start with the built-in views, so a landing slot of `index` (insert
   * before that row) is slot `index - BUILTIN_ROWS.length` in the stored user order.
   */
  const commitOrder = useCallback(async (fromId, displayIndex) => {
    const ids = doc.collections.map(collection => collection.id)
    const from = ids.indexOf(fromId)
    if (from < 0) return
    ids.splice(from, 1)
    /* Display rows start with the built-in views, so a display slot maps to the user order by
       subtracting them; dragging DOWN lands one slot earlier because the item was just removed. */
    const target = displayIndex - BUILTIN_ROWS.length
    const at = clamp(from < target ? target - 1 : target, 0, ids.length)
    ids.splice(at, 0, fromId)
    const stored = doc.collections.map(collection => collection.id)
    if (ids.every((id, index) => id === stored[index])) return
    const name = collectionById(doc, fromId)?.name ?? ''
    await run({ order: ids }, translate('collections.moved', { name }))
  }, [doc, run])

  const keyboardMove = useCallback(async (id, delta) => {
    const ids = doc.collections.map(collection => collection.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    const name = collectionById(doc, id)?.name ?? ''
    await run({ order: ids }, translate('collections.moved', { name }))
  }, [doc, run])

  const onKeyDown = useCallback(event => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const target = rowMenu ?? (renaming === undefined ? doc.selectedId : undefined)
      /* Alt+↑/↓ moves USER collections; a built-in view is pinned at the top, never a move target. */
      if (target === undefined || isBuiltinCollection(target)) return
      event.preventDefault()
      void keyboardMove(target, event.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (event.key !== 'Enter' || event.isComposing) return
    if (renaming !== undefined) { event.preventDefault(); void commitRename() }
    else if (creating) { event.preventDefault(); void commitCreate() }
  }, [commitCreate, commitRename, creating, doc.selectedId, keyboardMove, renaming, rowMenu])

  const drag = useMemo(() => ({
    onStart: (event, row) => {
      if (row.builtin === true) { event.preventDefault(); return }
      setDragId(row.id)
      setDropAt(-1)
    },
    onOver: (event, row) => {
      if (dragId === undefined || row.builtin === true) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const below = rect.height > 0 && event.clientY > rect.top + rect.height / 2
      setDropAt(below ? row.index + 1 : row.index)
    },
    onDrop: (event, row) => {
      if (dragId === undefined || row.builtin === true) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const below = rect.height > 0 && event.clientY > rect.top + rect.height / 2
      const landing = below ? row.index + 1 : row.index
      const moved = dragId
      setDragId(undefined)
      setDropAt(-1)
      void commitOrder(moved, landing)
    },
    onEnd: () => { setDragId(undefined); setDropAt(-1) },
  }), [commitOrder, dragId])

  return h(Fragment, null,
    h('button', {
      'aria-expanded': open,
      'aria-haspopup': 'listbox',
      className: 'dsh-ws-collection-button',
      onClick: () => { if (open) closeAll(); else { setBox(collectionMenuBox(buttonRef.current, menuHeight)); setOpen(true) } },
      onKeyDown,
      ref: buttonRef,
      title: translate('collections.title'),
      type: 'button',
    },
    h('span', { 'aria-hidden': true, className: 'dsh-ws-collection-glyph' }, '▤'),
    h('span', { className: 'dsh-ws-collection-name' }, currentName),
    h('span', { 'aria-hidden': true, className: 'dsh-ws-collection-caret' }, '▾')),
    open
      ? h('div', {
        'aria-label': translate('collections.title'),
        className: 'dsh-ws-collection-menu',
        onKeyDown,
        ref: menuRef,
        role: 'listbox',
        style: {
          left: `${box.left}px`,
          top: `${box.top}px`,
          maxHeight: `${Math.max(MENU_ROW_HEIGHT * 3, window.innerHeight - box.top - 12)}px`,
        },
      },
      h('div', { className: 'dsh-ws-collection-menu-title' }, translate('collections.title')),
      rows.map(row => h(Fragment, { key: row.id },
        dropAt === row.index ? h('div', { className: 'dsh-ws-collection-insert' }) : null,
        renaming === row.id
          ? h('div', { className: 'dsh-ws-collection-edit' },
            h('input', {
              'aria-label': translate('collections.name'),
              autoFocus: true,
              className: 'dsh-ws-collection-input',
              'data-invalid': error === undefined ? undefined : true,
              disabled: busy,
              onBlur: () => { if (!busy) { setRenaming(undefined); setError(undefined) } },
              onChange: event => { setDraft(event.target.value); setError(undefined) },
              onKeyDown: event => {
                if (event.key === 'Escape') { event.preventDefault(); setRenaming(undefined); setError(undefined) }
                else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void commitRename() }
              },
              value: draft,
            }))
          : h(CollectionRow, {
            count: collectionWorkspaceCount(doc, row.id, workspaces),
            drag,
            dragging: dragId === row.id,
            isCurrent: doc.selectedId === row.id,
            onOpenMenu: id => setRowMenu(previous => (previous === id ? undefined : id)),
            onSelect: selectCollection,
            row,
          }),
        renaming === row.id && error !== undefined
          ? h('div', { className: 'dsh-ws-collection-error', role: 'alert' }, error)
          : null,
        rowMenu === row.id
          ? h('div', { className: 'dsh-ws-collection-rowmenu', role: 'menu' },
            h('button', {
              className: 'dsh-ws-collection-rowitem',
              disabled: busy,
              onClick: () => { setRenaming(row.id); setDraft(row.name); setError(undefined); setRowMenu(undefined) },
              role: 'menuitem',
              type: 'button',
            }, translate('collections.rename')),
            h('button', {
              className: 'dsh-ws-collection-rowitem',
              disabled: busy,
              onClick: () => { setMembersTarget(row.id); setRowMenu(undefined); setOpen(false) },
              role: 'menuitem',
              type: 'button',
            }, translate('collections.members')),
            h('button', {
              className: 'dsh-ws-collection-rowitem dsh-ws-collection-rowitem-danger',
              disabled: busy,
              onClick: () => { void removeCollection(row.id) },
              role: 'menuitem',
              type: 'button',
            }, translate('collections.delete')))
          : null)),
      h('div', { className: 'dsh-ws-collection-separator', role: 'separator' }),
      creating
        ? h(Fragment, null,
          h('div', { className: 'dsh-ws-collection-edit' },
            h('input', {
              'aria-label': translate('collections.name'),
              autoFocus: true,
              className: 'dsh-ws-collection-input',
              'data-invalid': error === undefined ? undefined : true,
              disabled: busy,
              onChange: event => { setNewDraft(event.target.value); setError(undefined) },
              onKeyDown: event => {
                if (event.key === 'Escape') { event.preventDefault(); setCreating(false); setError(undefined) }
                else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void commitCreate() }
              },
              placeholder: translate('collections.name'),
              value: newDraft,
            }),
            h('button', {
              className: 'dsh-ws-collection-ok',
              disabled: busy,
              onClick: () => { void commitCreate() },
              type: 'button',
            }, translate('collections.create'))),
          error !== undefined ? h('div', { className: 'dsh-ws-collection-error', role: 'alert' }, error) : null)
        : h('button', {
          className: 'dsh-ws-collection-new',
          disabled: busy || atLimit || unavailable === true,
          onClick: () => { setCreating(true); setNewDraft(''); setError(undefined) },
          title: unavailable === true
            ? translate('collections.loadFailed')
            : atLimit ? translate('collections.limit', { n: COLLECTION_LIMIT }) : undefined,
          type: 'button',
        }, `＋ ${translate('collections.new')}`),
      atLimit ? h('div', { className: 'dsh-ws-collection-hint' }, translate('collections.limit', { n: COLLECTION_LIMIT })) : null,
      unavailable === true
        ? h('div', { className: 'dsh-ws-collection-error', role: 'alert' }, translate('collections.loadFailed'))
        : doc.collections.length === 0
          ? h('div', { className: 'dsh-ws-collection-hint' }, translate('collections.none'))
          : null)
      : null,
    membersTarget === undefined
      ? null
      : h(CollectionsMembersDialog, {
        collection: collectionById(doc, membersTarget),
        onClose: () => setMembersTarget(undefined),
        onSave: async ids => {
          const target = collectionById(doc, membersTarget)
          const result = await run({
            upsert: [{ id: membersTarget, name: target?.name ?? '', workspaceIds: ids }],
          }, translate('collections.members.saved', { name: target?.name ?? '' }))
          if (result?.ok === true) setMembersTarget(undefined)
          return result
        },
        workspaces,
      }))
}

/**
 * Member picker: every registered workspace with a checkbox. Membership is many-to-many, so a
 * workspace already in another collection is still offered here (the hint says so).
 */
function CollectionsMembersDialog({ collection, workspaces, onClose, onSave }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set(collection?.workspaceIds ?? []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState()
  const needle = query.trim().toLowerCase()
  const rows = (workspaces ?? []).filter(workspace => needle === ''
    || String(workspace?.title ?? workspace?.path ?? '').toLowerCase().includes(needle))
  const toggle = (id) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return h(Modal, {
    actions: [
      { key: 'cancel', className: 'dsh-ws-text-button dsh-ws-collection-cancel', disabled: busy, label: translate('dialog.cancel'), onClick: onClose },
      {
        key: 'ok',
        className: 'dsh-ws-text-button dsh-ws-collection-ok',
        disabled: busy,
        label: translate('collections.members.save'),
        onClick: async () => {
          setBusy(true)
          setError(undefined)
          const result = await onSave([...selected])
          setBusy(false)
          if (result?.ok !== true) setError(patchErrorMessage(result?.error, collection?.name ?? '', 'collections.members.failed'))
        },
      },
    ],
    busy,
    className: 'dsh-ws-collection-dialog',
    /* Never dismissible by a backdrop click: the checkbox set below is an unsaved choice, so a stray
       click outside would discard it silently (the × and Cancel stay explicit). */
    dismissOnBackdrop: false,
    onCancel: onClose,
    title: translate('collections.members.title', { name: collection?.name ?? '' }),
  },
    h('input', {
      'aria-label': translate('collections.members.search'),
      className: 'dsh-ws-dialog-input',
      onChange: event => setQuery(event.target.value),
      placeholder: translate('collections.members.search'),
      value: query,
    }),
    h('div', { className: 'dsh-ws-collection-members' },
      rows.length === 0
        ? h('div', { className: 'dsh-ws-collection-hint' }, translate('collections.members.empty'))
        : rows.map((workspace) => {
          const id = String(workspace.workspaceId)
          return h('label', { className: 'dsh-ws-collection-member', key: id },
            h('input', { checked: selected.has(id), onChange: () => toggle(id), type: 'checkbox' }),
            h('span', { className: 'dsh-ws-collection-membertext' },
              h('span', { className: 'dsh-ws-collection-membername' }, String(workspace.title ?? workspace.path ?? id)),
              h('span', { className: 'dsh-ws-collection-memberpath' }, String(workspace.path ?? ''))),
            h('span', { className: 'dsh-ws-collection-membercount' },
              translate('collections.members.sessions', { n: (workspace.sessionIds ?? []).length })))
        })),
    h('div', { className: 'dsh-ws-collection-hint' }, translate('collections.members.hint')),
    error === undefined ? null : h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, error))
}

/**
 * The plugin's menu on a Harness WORKSPACE group row: membership in/out of the shown collection plus
 * a nested collection picker (with inline creation that adds this workspace in the same patch).
 * Rename and delete stay on the row's own `⋯` button (the Harness menu), which this does not replace.
 *
 * @param props.workspaceId - the row's workspace id.
 * @param props.doc - normalized collection document.
 * @param props.workspaces - Harness workspace items (for the title).
 * @param props.anchor - `{ x, y }` of the originating contextmenu event.
 * @param props.onPatch - patch runner (same contract as the dropdown's).
 * @param props.notice - transient notice channel.
 * @param props.onClose - close request (outside click / Escape).
 */
export function CollectionsWorkspaceMenu({ workspaceId, doc, workspaces, anchor, onPatch, notice, onClose }) {
  const [submenu, setSubmenu] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newDraft, setNewDraft] = useState('')
  const [error, setError] = useState()
  const [busy, setBusy] = useState(false)
  const id = String(workspaceId)
  const workspace = (workspaces ?? []).find(item => String(item?.workspaceId) === id)
  const memberIds = new Set((doc.collections ?? [])
    .filter(collection => collection.workspaceIds.includes(id))
    .map(collection => collection.id))
  const inCurrent = doc.selectedId !== COLLECTION_ALL_ID && memberIds.has(doc.selectedId)
  const { left, top } = anchorBox(anchor.x, anchor.y, CONTEXT_MENU_WIDTH, WORKSPACE_MENU_HEIGHT)
  const run = async (patch, message, inline) => {
    setBusy(true)
    const result = await onPatch(patch)
    setBusy(false)
    if (result?.ok === true) {
      notice(message)
      onClose()
      return result
    }
    if (inline === true) setError(patchErrorMessage(result?.error, newDraft.trim(), 'collections.failed'))
    else notice(patchErrorMessage(result?.error, '', 'collections.failed'), true)
    return result
  }
  const setMembership = (collection, member) => {
    const next = member
      ? collection.workspaceIds.filter(entry => entry !== id)
      : [...collection.workspaceIds, id]
    return run({ upsert: [{ id: collection.id, name: collection.name, workspaceIds: next }] },
      translate(member ? 'collections.removed' : 'collections.added', { name: collection.name }))
  }
  return h('div', { className: 'dsh-ws-context-menu', role: 'menu', style: { left: `${left}px`, top: `${top}px` } },
    h('div', { className: 'dsh-ws-context-label' },
      translate('collections.workspaceMenu.title', { name: String(workspace?.title ?? workspace?.path ?? id) })),
    h('button', {
      'aria-expanded': submenu,
      className: 'dsh-ws-context-item',
      disabled: busy,
      onClick: () => setSubmenu(value => !value),
      role: 'menuitem',
      type: 'button',
    }, translate('collections.addTo'), h('span', { className: 'dsh-ws-collection-submark' }, '▸')),
    submenu
      ? h('div', { className: 'dsh-ws-context-menu dsh-ws-collection-submenu', role: 'menu' },
        doc.collections.length === 0 && !creating
          ? h('div', { className: 'dsh-ws-context-label' }, translate('collections.none'))
          : doc.collections.map(collection => {
            const member = memberIds.has(collection.id)
            return h('button', {
              className: 'dsh-ws-context-item',
              disabled: busy,
              key: collection.id,
              onClick: () => { void setMembership(collection, member) },
              role: 'menuitem',
              type: 'button',
            }, h('span', { 'aria-hidden': true, className: 'dsh-ws-collection-check' }, member ? '✓' : ''), collection.name)
          }),
        creating
          ? h('div', { className: 'dsh-ws-collection-edit dsh-ws-collection-subedit' },
            h('input', {
              'aria-label': translate('collections.name'),
              autoFocus: true,
              className: 'dsh-ws-collection-input',
              'data-invalid': error === undefined ? undefined : true,
              disabled: busy,
              onChange: event => { setNewDraft(event.target.value); setError(undefined) },
              onKeyDown: event => {
                if (event.key === 'Escape') { event.preventDefault(); setCreating(false); setError(undefined) }
                else if (event.key === 'Enter' && !event.isComposing) {
                  event.preventDefault()
                  const name = newDraft.trim()
                  if (name === '') { setError(translate('collections.name.empty')); return }
                  void run({ upsert: [{ name, workspaceIds: [id] }] }, translate('collections.createdWith', { name }), true)
                }
              },
              placeholder: translate('collections.name'),
              value: newDraft,
            }))
          : h('button', {
            className: 'dsh-ws-context-item dsh-ws-collection-new',
            disabled: busy || doc.collections.length >= COLLECTION_LIMIT,
            onClick: () => { setCreating(true); setNewDraft(''); setError(undefined) },
            role: 'menuitem',
            type: 'button',
          }, `＋ ${translate('collections.new')}`),
        error === undefined ? null : h('div', { className: 'dsh-ws-collection-error', role: 'alert' }, error))
      : null,
    h('button', {
      className: 'dsh-ws-context-item',
      disabled: busy || !inCurrent,
      onClick: () => {
        const collection = collectionById(doc, doc.selectedId)
        if (collection === undefined) return
        void setMembership(collection, true)
      },
      role: 'menuitem',
      type: 'button',
    }, translate('collections.removeFrom')))
}





