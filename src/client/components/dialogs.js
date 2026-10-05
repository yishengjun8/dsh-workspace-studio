import { createElement as h, Fragment, useRef, useState, useEffect } from 'react'
import { translate } from '../locale/index.js'
import { diffRows } from '../merge.js'
import { entryDialogAction, entryDialogTitle } from '../paths.js'
import { encodingLabel } from '../api.js'

/* Modal a11y: trap Tab inside the open dialog and restore focus to the previously focused element on close; the `open` flag arms the trap only while the dialog subtree is visible. */
export function useDialogFocusTrap(open = true) {
  const dialogRef = useRef(null)
  /* Pre-dialog focus captured by the ref callback, which still sees the outside element before autoFocus moves it. */
  const previouslyFocusedRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
    if (dialog === null) return undefined
    const previouslyFocused = previouslyFocusedRef.current ?? document.activeElement
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const activeInside = dialog.contains(document.activeElement)
      if (event.shiftKey && (!activeInside || document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!activeInside || document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [open])
  const setDialogRef = (node) => {
    dialogRef.current = node
    if (node === null) {
      previouslyFocusedRef.current = null
    } else if (node.isConnected && previouslyFocusedRef.current === null) {
      previouslyFocusedRef.current = document.activeElement
    }
  }
  return setDialogRef
}

/* Window-level Escape for the modals without their own text input; busy states never cancel (same rule as the × / backdrop). */
function useDialogEscape(onCancel, busy) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (busy) return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, busy])
}

/**
 * The one dialog skeleton: backdrop (a click outside cancels), a titled panel with the close button, the
 * body, and a footer of buttons.
 *
 * Four of this module's five dialogs were the same twelve lines with different copy, so the skeleton —
 * including the focus trap and the busy rules for the × and the backdrop — lives here once. What actually
 * differs per dialog is data: the title, the body, the dialog's extra class/style for the wide merge
 * dialog, and the buttons.
 *
 * @param busy - locks the × / backdrop cancel (a dialog that must not be dismissed mid-request). The
 *   caller also passes `disabled: busy` on its own cancel BUTTON, since a dialog may need a different
 *   confirm rule.
 * @param onCancel - backdrop and × handler.
 * @param title - the title; pass an array to append inline extras (the merge dialog's "2 / 3" progress).
 * @param className - extra class on the panel (e.g. `dsh-ws-conflict-dialog`).
 * @param bodyClassName - extra class on the body (e.g. the token panel's own padding).
 * @param style - inline style on the panel (the merge dialog's font-size variable).
 * @param foot - content between the body and the footer (the token panel's summary line, which must sit
 *   outside the scrolling body).
 * @param dismissOnBackdrop - default true; false for a dialog holding an unsaved choice, where a stray
 *   click outside would silently discard it.
 * @param actions - footer buttons: `{ key, label, onClick, disabled, danger, className }`. `danger` picks
 *   the danger style; `className` replaces the button class entirely for a dialog with its own styling
 *   hooks. An empty list means the dialog has no footer at all (the × / backdrop / Escape are its only
 *   ways out).
 */
export function Modal({ busy, onCancel, title, className, bodyClassName, style, foot, dismissOnBackdrop = true, actions, children }) {
  const dialogFocusRef = useDialogFocusTrap()
  return h('div', {
    className: 'dsh-ws-dialog-backdrop',
    onMouseDown: event => {
      if (!dismissOnBackdrop) return
      if (event.target === event.currentTarget && !busy) onCancel()
    },
  },
  h('div', {
    'aria-modal': true,
    className: className === undefined ? 'dsh-ws-dialog' : `dsh-ws-dialog ${className}`,
    ref: dialogFocusRef,
    role: 'dialog',
    style,
  },
  h('div', { className: 'dsh-ws-dialog-header' },
    h('div', { className: 'dsh-ws-dialog-title' }, title),
    h('button', {
      'aria-label': translate('dialog.close'),
      className: 'dsh-ws-icon-button',
      disabled: busy,
      onClick: onCancel,
      title: translate('dialog.close'),
      type: 'button',
    }, '×')),
  h('div', { className: bodyClassName === undefined ? 'dsh-ws-dialog-body' : `dsh-ws-dialog-body ${bodyClassName}` }, children),
  foot ?? null,
  actions.length === 0 ? null : h('div', { className: 'dsh-ws-dialog-footer' },
    actions.map(action => action.element !== undefined
      /* An entry may be a raw node instead of a button (the interpreter dialog puts a spacer between
         its left-aligned "clear" and the right-aligned cancel/save pair). */
      ? h(Fragment, { key: action.key }, action.element)
      : h('button', {
        className: action.className ?? (action.danger === true ? 'dsh-ws-danger-button dsh-ws-text-button' : 'dsh-ws-text-button'),
        disabled: action.disabled === true,
        key: action.key,
        onClick: action.onClick,
        type: 'button',
      }, action.label)))))
}

/** The standard cancel + confirm pair, so the two-button rule (cancel always locks while busy) is stated once. */
function confirmActions({ busy, onCancel, onConfirm, confirmLabel, confirmDisabled, danger }) {
  return [
    { key: 'cancel', label: translate('dialog.cancel'), onClick: onCancel, disabled: busy === true },
    { key: 'confirm', label: confirmLabel, onClick: onConfirm, disabled: confirmDisabled === true, danger },
  ]
}

export function EntryDialog({ dialog, draft, error, busy, blocked, composingRef, onCancel, onConfirm, onDraft }) {
  if (!dialog) return null
  const title = entryDialogTitle(dialog)
  const action = entryDialogAction(dialog)
  return h(Modal, {
    busy,
    onCancel,
    title,
    actions: confirmActions({
      busy,
      onCancel,
      onConfirm,
      confirmLabel: busy ? translate('dialog.processing') : action,
      confirmDisabled: blocked,
    }),
  },
  h('input', {
    'aria-label': translate('dialog.name'),
    autoFocus: true,
    className: 'dsh-ws-dialog-input',
    disabled: busy,
    onChange: e => onDraft(e.target.value),
    onCompositionEnd: () => { composingRef.current = false },
    onCompositionStart: () => { composingRef.current = true },
    onFocus: e => e.target.select(),
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!busy) onCancel()
      } else if (e.key === 'Enter' && !composingRef.current) {
        e.preventDefault()
        /* Enter must not bypass the confirm button's disabled (blocked) state. */
        if (!busy && !blocked) onConfirm()
      }
    },
    value: draft,
  }),
  error ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, error) : null)
}

export function EncodingDialog({ dialog, options, value, busy, onCancel, onPick, onConfirm }) {
  useDialogEscape(onCancel, busy)
  if (!dialog) return null
  const title = dialog.mode === 'open' ? translate('encoding.dialog.open') : translate('encoding.dialog.save')
  const action = dialog.mode === 'open' ? translate('encoding.dialog.openAction') : translate('encoding.dialog.saveAction')
  return h(Modal, {
    busy,
    onCancel,
    title,
    actions: confirmActions({
      busy,
      onCancel,
      onConfirm,
      confirmLabel: busy ? translate('dialog.processing') : action,
      confirmDisabled: busy || options.length === 0,
    }),
  },
  h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-encoding-select' }, translate('encoding.badge')),
  h('select', {
    'aria-label': translate('encoding.badge'),
    className: 'dsh-ws-highlight-preset-select',
    disabled: busy,
    id: 'dsh-ws-encoding-select',
    onChange: e => onPick(e.target.value),
    value,
  }, options.map(enc => h('option', { key: enc.id, value: enc.id }, encodingLabel(enc.id)))))
}

export function SessionRenameDialog({ draft, busy, error, onCancel, onConfirm, onDraft, title }) {
  const composingRef = useRef(false)
  return h(Modal, {
    busy,
    onCancel,
    title: title ?? translate('dialog.renameSession'),
    actions: confirmActions({
      busy,
      onCancel,
      onConfirm,
      confirmLabel: busy ? translate('dialog.processing') : translate('dialog.rename'),
      confirmDisabled: busy || draft.trim() === '',
    }),
  },
  h('input', {
    'aria-label': translate('dialog.sessionName'),
    autoFocus: true,
    className: 'dsh-ws-dialog-input',
    disabled: busy,
    onChange: e => onDraft(e.target.value),
    onCompositionEnd: () => { composingRef.current = false },
    onCompositionStart: () => { composingRef.current = true },
    onFocus: e => e.target.select(),
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        if (busy) return
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && !composingRef.current) {
        /* Enter must not bypass the confirm button's disabled (empty draft) state. */
        if (busy || draft.trim() === '') return
        e.preventDefault()
        onConfirm()
      }
    },
    value: draft,
  }),
  error ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, error) : null)
}

export function DeleteDialog({ entry, busy, dirtyWarning, onCancel, onConfirm }) {
  useDialogEscape(onCancel, busy)
  if (!entry) return null
  return h(Modal, {
    busy,
    onCancel,
    title: translate('dialog.deleteTitle'),
    actions: confirmActions({
      busy,
      onCancel,
      onConfirm,
      confirmLabel: busy ? translate('dialog.processing') : translate('dialog.deleteAction'),
      confirmDisabled: busy,
      danger: true,
    }),
  },
  h('div', { className: 'dsh-ws-dialog-message' }, translate('dialog.deleteMessage', { name: entry.name })),
  dirtyWarning ? h('div', { className: 'dsh-ws-dialog-warning', role: 'alert' }, translate('dialog.deleteDirtyWarning')) : null)
}

/* Save-time three-way merge conflict: each region is reviewed one at a time (mine vs theirs); the footer hands back { choices } or 'cancel'. */
export function SaveConflictDialog({ conflict, fontSize, onResolve }) {
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState([])
  /* Synchronous mirror of `choices` so two rapid clicks on the last region can't both resolve with only their own choice. */
  const choicesRef = useRef([])
  // Escape cancels the whole save, same as backdrop / ×.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onResolve('cancel')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onResolve])
  if (conflict === undefined) return null
  const total = conflict.conflicts.length
  /* Defensive: a malformed conflict with zero regions renders nothing rather than indexing conflicts[-1]. */
  if (total === 0) return null
  const current = Math.min(index, total - 1)
  const region = conflict.conflicts[current]
  /* A single-line region and a degenerate insertion-only region both show one line number. */
  const regionLines = region.end - region.start <= 1
    ? String(region.start + 1)
    : `${region.start + 1}–${region.end}`
  const pick = (side) => {
    const next = [...choicesRef.current, side]
    choicesRef.current = next
    // Key the decision to the actual choices length, not the display index, so back+re-pick never mismatches counts.
    if (next.length < total) {
      setChoices(next)
      setIndex(next.length)
    } else {
      onResolve({ choices: next })
    }
  }
  const goBack = () => {
    if (current === 0) return
    // Revisiting `current - 1` must drop its stale choice, or the array grows too long and save fails.
    setIndex(current - 1)
    setChoices((prev) => {
      const sliced = prev.slice(0, current - 1)
      choicesRef.current = sliced
      return sliced
    })
  }
  return h(Modal, {
    /* The conflict dialog is never dismissible mid-flight (there is no request in flight), so `busy` stays unset and the backdrop/× always cancel — exactly as before. */
    onCancel: () => onResolve('cancel'),
    title: [
      translate('dialog.saveConflictTitle'),
      total > 1 ? h('span', { className: 'dsh-ws-conflict-progress' }, `${current + 1} / ${total}`) : null,
    ],
    className: 'dsh-ws-conflict-dialog',
    style: fontSize === undefined ? undefined : { '--dsh-ws-conflict-font-size': `${fontSize}px` },
    actions: [
      { key: 'cancel', label: translate('dialog.cancel'), onClick: () => onResolve('cancel') },
      { key: 'prev', label: translate('dialog.saveConflictPrev'), onClick: goBack, disabled: current === 0 },
      { key: 'theirs', label: translate('dialog.saveConflictKeepTheirs'), onClick: () => pick('theirs') },
      { key: 'mine', label: translate('dialog.saveConflictKeepMine'), onClick: () => pick('mine'), danger: true },
    ],
  },
  h('div', { className: 'dsh-ws-dialog-message' }, translate('dialog.saveConflictMessage')),
  h('div', { className: 'dsh-ws-conflict-region' },
    h('div', { className: 'dsh-ws-conflict-region-title' },
      translate('dialog.saveConflictRegion', { lines: regionLines })),
    h('div', { className: 'dsh-ws-conflict-cols' },
      h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-mine' },
        h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictMine')),
        h('pre', { className: 'dsh-ws-conflict-code' }, region.display === 'plain' ? region.mine.join('\n') : diffRows(region.base, region.mine))),
      h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-theirs' },
        h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictTheirs')),
        h('pre', { className: 'dsh-ws-conflict-code' }, region.display === 'plain' ? region.theirs.join('\n') : diffRows(region.base, region.theirs)))),
    h('div', { className: 'dsh-ws-conflict-cols dsh-ws-conflict-cols-final' },
      h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-mine' },
        h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictMineFinal')),
        h('pre', { className: 'dsh-ws-conflict-code' }, region.mine.join('\n'))),
      h('div', { className: 'dsh-ws-conflict-col dsh-ws-conflict-theirs' },
        h('div', { className: 'dsh-ws-conflict-col-label' }, translate('dialog.saveConflictTheirsFinal')),
        h('pre', { className: 'dsh-ws-conflict-code' }, region.theirs.join('\n'))))))
}
