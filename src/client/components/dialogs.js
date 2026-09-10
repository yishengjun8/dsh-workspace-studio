import { createElement as h, useRef, useState, useEffect } from 'react'
import { translate } from '../locale/index.js'
import { diffRows, resolveMergeParts } from '../merge.js'
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

export function EntryDialog({dialog,draft,error,busy,blocked,composingRef,onCancel,onConfirm,onDraft}){const dialogFocusRef=useDialogFocusTrap();if(!dialog)return null;const title=entryDialogTitle(dialog),action=entryDialogAction(dialog);return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',ref:dialogFocusRef,role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},title),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('input',{'aria-label':translate('dialog.name'),autoFocus:true,className:'dsh-ws-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();if(!busy)onCancel()}else if(e.key==='Enter'&&!composingRef.current){e.preventDefault();/* Enter must not bypass the confirm button's disabled (blocked) state. */if(!busy&&!blocked)onConfirm()}},value:draft}),error?h('div',{className:'dsh-ws-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-text-button',disabled:blocked,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):action))))}

export function EncodingDialog({dialog,options,value,busy,onCancel,onPick,onConfirm}){const dialogFocusRef=useDialogFocusTrap();useDialogEscape(onCancel,busy);if(!dialog)return null;const title=dialog.mode==='open'?translate('encoding.dialog.open'):translate('encoding.dialog.save'),action=dialog.mode==='open'?translate('encoding.dialog.openAction'):translate('encoding.dialog.saveAction');return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',ref:dialogFocusRef,role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},title),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('label',{className:'dsh-ws-settings-label',htmlFor:'dsh-ws-encoding-select'},translate('encoding.badge')),h('select',{'aria-label':translate('encoding.badge'),className:'dsh-ws-highlight-preset-select',disabled:busy,id:'dsh-ws-encoding-select',onChange:e=>onPick(e.target.value),value},options.map(enc=>h('option',{key:enc.id,value:enc.id},encodingLabel(enc.id))))),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-text-button',disabled:busy||options.length===0,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):action))))}
export function SessionRenameDialog({draft,busy,error,onCancel,onConfirm,onDraft,title}){const composingRef=useRef(false),dialogFocusRef=useDialogFocusTrap();return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',ref:dialogFocusRef,role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},title ?? translate('dialog.renameSession')),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('input',{'aria-label':translate('dialog.sessionName'),autoFocus:true,className:'dsh-ws-dialog-input',disabled:busy,onChange:e=>onDraft(e.target.value),onCompositionEnd:()=>{composingRef.current=false},onCompositionStart:()=>{composingRef.current=true},onFocus:e=>e.target.select(),onKeyDown:e=>{if(e.key==='Escape'){if(busy)return;e.preventDefault();onCancel()}else if(e.key==='Enter'&&!composingRef.current){/* Enter must not bypass the confirm button's disabled (empty draft) state. */if(busy||draft.trim()==='')return;e.preventDefault();onConfirm()}},value:draft}),error?h('div',{className:'dsh-ws-dialog-error',role:'alert'},error):null),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-text-button',disabled:busy||draft.trim()==='',onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):translate('dialog.rename')))))}
export function DeleteDialog({entry,busy,dirtyWarning,onCancel,onConfirm}){const dialogFocusRef=useDialogFocusTrap();useDialogEscape(onCancel,busy);if(!entry)return null;return h('div',{className:'dsh-ws-dialog-backdrop',onMouseDown:e=>{if(e.target===e.currentTarget&&!busy)onCancel()}},h('div',{'aria-modal':true,className:'dsh-ws-dialog',ref:dialogFocusRef,role:'dialog'},h('div',{className:'dsh-ws-dialog-header'},h('div',{className:'dsh-ws-dialog-title'},translate('dialog.deleteTitle')),h('button',{'aria-label':translate('dialog.close'),className:'dsh-ws-icon-button',disabled:busy,onClick:onCancel,title:translate('dialog.close'),type:'button'},'×')),h('div',{className:'dsh-ws-dialog-body'},h('div',{className:'dsh-ws-dialog-message'},translate('dialog.deleteMessage',{name:entry.name})),dirtyWarning?h('div',{className:'dsh-ws-dialog-warning',role:'alert'},translate('dialog.deleteDirtyWarning')):null),h('div',{className:'dsh-ws-dialog-footer'},h('button',{className:'dsh-ws-text-button',disabled:busy,onClick:onCancel,type:'button'},translate('dialog.cancel')),h('button',{className:'dsh-ws-danger-button dsh-ws-text-button',disabled:busy,onClick:onConfirm,type:'button'},busy?translate('dialog.processing'):translate('dialog.deleteAction')))))}
/* Save-time three-way merge conflict: each region is reviewed one at a time (mine vs theirs); the footer hands back { choices } or 'cancel'. */export function SaveConflictDialog({conflict,fontSize,onResolve}) {
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState([])
  /* Synchronous mirror of `choices` so two rapid clicks on the last region can't both resolve with only their own choice. */
  const choicesRef = useRef([])
  // Escape cancels the whole save, same as backdrop / ×; it must not leak to the mind-map overlay's Escape-to-close.
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') onResolve('cancel')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onResolve])
  const dialogFocusRef = useDialogFocusTrap()
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
    setChoices(prev => {
      const sliced = prev.slice(0, current - 1)
      choicesRef.current = sliced
      return sliced
    })
  }
  return h('div', { className: 'dsh-ws-dialog-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onResolve('cancel') } },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-conflict-dialog', ref: dialogFocusRef, role: 'dialog', style: fontSize === undefined ? undefined : { '--dsh-ws-conflict-font-size': `${fontSize}px` } },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' },
          translate('dialog.saveConflictTitle'),
          total > 1 ? h('span', { className: 'dsh-ws-conflict-progress' }, `${current + 1} / ${total}`) : null),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', onClick: () => onResolve('cancel'), title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body' },
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
              h('pre', { className: 'dsh-ws-conflict-code' }, region.theirs.join('\n'))))),
      h('div', { className: 'dsh-ws-dialog-footer' },
        h('button', { className: 'dsh-ws-text-button', onClick: () => onResolve('cancel'), type: 'button' }, translate('dialog.cancel')),
        h('button', { className: 'dsh-ws-text-button', disabled: current === 0, onClick: goBack, type: 'button' }, translate('dialog.saveConflictPrev')),
        h('button', { className: 'dsh-ws-text-button', onClick: () => pick('theirs'), type: 'button' }, translate('dialog.saveConflictKeepTheirs')),
        h('button', { className: 'dsh-ws-danger-button dsh-ws-text-button', onClick: () => pick('mine'), type: 'button' }, translate('dialog.saveConflictKeepMine'))))))}

