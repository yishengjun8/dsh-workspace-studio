/* Add-instrument picker: one modal, categories on top, an instrument card grid below. */
import { createElement as h, useState } from 'react'
import { translate } from '../../locale/index.js'
import { Modal } from '../dialogs.js'
import { INSTRUMENT_CATEGORIES, INSTRUMENT_LIST, instrumentGlyph } from './instruments.js'

export function InstrumentPicker({ onAdd, onCancel }) {
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState('piano')
  const list = INSTRUMENT_LIST.filter(item => category === 'all' || item.cat === category)
  return h(Modal, {
    actions: [
      { key: 'cancel', label: translate('dialog.cancel'), onClick: onCancel },
      { key: 'add', label: translate('music.picker.add'), onClick: () => onAdd(selected) },
    ],
    bodyClassName: 'dsh-ws-music-picker-body',
    className: 'dsh-ws-music-picker-dialog',
    onCancel,
    title: translate('music.picker.title'),
  },
  h('div', { className: 'dsh-ws-music-picker' },
    h('div', { className: 'dsh-ws-music-picker-sub' }, translate('music.picker.subtitle')),
    h('div', { className: 'dsh-ws-music-picker-cats', role: 'tablist', 'aria-label': translate('music.picker.categories') },
      INSTRUMENT_CATEGORIES.map(id => h('button', {
        'aria-selected': category === id,
        className: 'dsh-ws-music-picker-cat',
        'data-active': category === id || undefined,
        key: id,
        onClick: () => setCategory(id),
        role: 'tab',
        type: 'button',
      }, translate(`music.instcat.${id}`)))),
    h('div', { className: 'dsh-ws-music-picker-grid' },
      list.map(item => h('button', {
        'aria-pressed': selected === item.id,
        className: 'dsh-ws-music-inst-card',
        'data-selected': selected === item.id || undefined,
        key: item.id,
        onClick: () => setSelected(item.id),
        style: { '--inst-c': item.color },
        type: 'button',
      },
      h('span', { className: 'dsh-ws-music-inst-glyph' }, instrumentGlyph(item.icon, 15)),
      h('b', null, translate(item.nameKey)),
      h('span', { className: 'dsh-ws-music-inst-desc' }, translate(item.descKey)))))))
}

