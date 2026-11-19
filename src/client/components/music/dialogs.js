/* Music workshop dialogs: save-as (directory + file name) and open (score files in one
 * workspace directory). Both reuse the shared Modal skeleton, so focus trapping, Escape
 * and the busy rules stay in one place. */
import { createElement as h, useState } from 'react'
import { translate } from '../../locale/index.js'
import { Modal } from '../dialogs.js'

export function MusicSaveDialog({ busy, defaultDir, defaultName, error, onCancel, onConfirm }) {
  const [dir, setDir] = useState(defaultDir)
  const [fileName, setFileName] = useState(defaultName)
  const trimmedDir = dir.trim().replace(/\/+$/u, '')
  const trimmedName = fileName.trim()
  const path = trimmedName === '' ? '' : (trimmedDir === '' ? trimmedName : `${trimmedDir}/${trimmedName}`)
  return h(Modal, {
    actions: [
      { key: 'cancel', label: translate('dialog.cancel'), onClick: onCancel, disabled: busy },
      {
        key: 'save',
        label: busy ? translate('music.saving') : translate('music.save.confirm'),
        onClick: () => onConfirm(trimmedDir, trimmedName),
        disabled: busy || trimmedName === '',
      },
    ],
    busy,
    onCancel,
    title: translate('music.save.title'),
  },
  h('div', { className: 'dsh-ws-music-dialog-body' },
    h('label', { className: 'dsh-ws-music-dialog-field' },
      h('span', null, translate('music.save.dir')),
      h('input', {
        className: 'dsh-ws-dialog-input',
        disabled: busy,
        onChange: event => setDir(event.target.value),
        placeholder: translate('music.save.dirPlaceholder'),
        spellCheck: false,
        type: 'text',
        value: dir,
      })),
    h('label', { className: 'dsh-ws-music-dialog-field' },
      h('span', null, translate('music.save.name')),
      h('input', {
        className: 'dsh-ws-dialog-input',
        disabled: busy,
        onChange: event => setFileName(event.target.value),
        spellCheck: false,
        type: 'text',
        value: fileName,
      })),
    h('p', { className: 'dsh-ws-music-dialog-path' }, path === '' ? '—' : path),
    h('p', { className: 'dsh-ws-music-dialog-hint' }, translate('music.save.hint')),
    error ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, error) : null,
  ))
}

export function MusicOpenDialog({ busy, dir, error, files, loading, onCancel, onDir, onPick }) {
  const listNode = loading
    ? h('div', { className: 'dsh-ws-music-open-empty' }, translate('music.open.loading'))
    : files.length === 0
      ? h('div', { className: 'dsh-ws-music-open-empty' }, translate('music.open.empty'))
      : h('div', { className: 'dsh-ws-music-open-list', role: 'list' }, files.map(file => h('button', {
        className: 'dsh-ws-music-open-item',
        disabled: busy,
        key: file.path,
        onClick: () => onPick(file.path),
        role: 'listitem',
        title: file.path,
        type: 'button',
      },
      h('span', { className: 'dsh-ws-music-open-name' }, file.name),
      h('span', { className: 'dsh-ws-music-open-meta' }, `${(file.size / 1024).toFixed(1)} KB · ${new Date(file.mtimeMs).toLocaleString()}`))))
  return h(Modal, {
    actions: [{ key: 'cancel', label: translate('dialog.close'), onClick: onCancel, disabled: busy }],
    busy,
    onCancel,
    title: translate('music.open.title'),
  },
  h('div', { className: 'dsh-ws-music-dialog-body' },
    h('div', { className: 'dsh-ws-music-open-bar' },
      h('input', {
        'aria-label': translate('music.save.dir'),
        className: 'dsh-ws-dialog-input',
        disabled: busy,
        onChange: event => onDir(event.target.value),
        spellCheck: false,
        type: 'text',
        value: dir,
      }),
      h('button', {
        className: 'dsh-ws-text-button',
        disabled: busy || loading,
        onClick: () => onDir(dir, true),
        type: 'button',
      }, translate('music.open.refresh'))),
    listNode,
    error ? h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, error) : null,
    h('p', { className: 'dsh-ws-music-dialog-hint' }, translate('music.open.hint')),
  ))
}
/* Shortening a score would delete whatever sits after the new last bar. */
export function MusicDurationDialog({ bars, busy, onCancel, onConfirm, removed, seconds }) {
  const time = (Math.round((Number(seconds) || 0) * 10) / 10).toFixed(1)
  return h(Modal, {
    actions: [
      { key: 'cancel', label: translate('dialog.cancel'), onClick: onCancel, disabled: busy },
      { key: 'shorten', label: translate('music.duration.confirmAction'), onClick: onConfirm, danger: true, disabled: busy },
    ],
    busy,
    onCancel,
    title: translate('music.duration.confirmTitle'),
  },
  h('p', { className: 'dsh-ws-dialog-message' }, translate('music.duration.confirmMessage', {
    bars: String(bars),
    count: String(removed),
    seconds: time,
  })))
}

/* Small confirmation used when opening a saved score would discard unsaved edits. */
export function MusicDiscardDialog({ busy, onCancel, onConfirm }) {
  return h(Modal, {
    actions: [
      { key: 'cancel', label: translate('dialog.cancel'), onClick: onCancel, disabled: busy },
      { key: 'discard', label: translate('music.open.discardConfirm'), onClick: onConfirm, danger: true, disabled: busy },
    ],
    busy,
    onCancel,
    title: translate('music.open.discardTitle'),
  },
  h('p', { className: 'dsh-ws-dialog-message' }, translate('music.open.discardMessage')))
}




