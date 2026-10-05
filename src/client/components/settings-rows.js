/* The settings page's row/card design system.
 *
 * Every card in the settings page is the same three-column grid — label | control | reset slot — so the
 * controls line up down the page, and every card body is the same collapsible shell. These primitives
 * therefore do not belong to any one card: they live here so a card module can be moved out of
 * settings.js without dragging the whole page (or re-implementing a row) with it.
 *
 * The search/filter that walks this markup (applySettingsFilter, in settings.js) keys off the
 * `data-unit` / `data-block` / `data-label` attributes set here — those three attributes are the
 * contract between this file and that filter, so they stay in one place.
 */
import { createElement as h, useState } from 'react'
import { translate } from '../locale/index.js'
import { IconRefresh } from '../icons.js'
import { HIGHLIGHT_PRESETS, highlightPresetLabel } from '../format.js'

/* A note entry is either a key or `{ key, params }`. */
function noteKey(entry) {
  return typeof entry === 'string' ? entry : entry.key
}
function noteParams(entry) {
  return typeof entry === 'string' ? undefined : entry.params
}

/* ↺ reset control: hidden for a value still at its default, revealed on row hover, always visible once changed. */
export function Reset({ title, custom, disabled, onClick }) {
  return h('button', {
    'aria-label': title,
    className: 'dsh-ws-reset',
    'data-custom': custom === true ? '' : undefined,
    disabled: custom !== true || disabled === true || undefined,
    onClick,
    title,
    type: 'button',
  }, h(IconRefresh))
}

/* The shared row grid. `reset` may be null — the slot is always rendered so every row's right edge lines up. */
export function Row({ label, labelTitle, badge, note, reset, control, dataLabel }) {
  return h('div', { className: 'dsh-ws-row', 'data-label': dataLabel, 'data-unit': '' },
    h('div', { className: 'dsh-ws-row-label' },
      h('span', { className: 'dsh-ws-row-label-text', title: labelTitle }, label),
      badge ?? null),
    h('div', { className: 'dsh-ws-row-control' }, control),
    h('span', { className: 'dsh-ws-row-reset' }, reset ?? null),
    note === null || note === undefined ? null : h('div', { className: 'dsh-ws-row-note' }, note))
}

/* Slider row: label | track + value | ↺. */
export function SliderRow({ label, hint, min, max, step, value, unit, disabled, onChange, resetTitle, onReset, custom }) {
  return h(Row, {
    label,
    reset: h(Reset, { title: resetTitle, custom, disabled, onClick: onReset }),
    control: [
      h('input', {
        'aria-label': label,
        className: 'dsh-ws-slider',
        disabled: disabled === true || undefined,
        key: 'slider',
        max,
        min,
        onChange: event => onChange(Number(event.target.value)),
        step,
        title: disabled === true ? translate('settings.disabledByParent') : hint,
        type: 'range',
        value,
      }),
      h('span', { className: 'dsh-ws-value', key: 'value' }, unit),
    ],
  })
}

/* Boolean row: label | switch | ↺. */
export function SwitchRow({ label, hint, checked, disabled, onChange, resetTitle, onReset, custom }) {
  return h(Row, {
    label,
    reset: h(Reset, { title: resetTitle, custom, disabled, onClick: onReset }),
    control: h('input', {
      'aria-label': label,
      checked: checked === true,
      className: 'dsh-ws-switch',
      disabled: disabled === true || undefined,
      onChange: event => onChange(event.target.checked),
      title: disabled === true ? translate('settings.disabledByParent') : hint,
      type: 'checkbox',
    }),
  })
}

/* Color row (single swatch, used by the mind-map accents). */
export function ColorRow({ label, value, onChange, resetTitle, onReset, custom }) {
  return h(Row, {
    label,
    reset: h(Reset, { title: resetTitle, custom, onClick: onReset }),
    control: h('input', { 'aria-label': label, className: 'dsh-ws-color', onChange: event => onChange(event.target.value), type: 'color', value }),
  })
}

/* Sub-block: rows that only make sense while their parent switch is on. */
export function Sub({ off, children }) {
  return h('div', { className: 'dsh-ws-sub', 'data-block': '', 'data-off': off === true ? '' : undefined }, children)
}

/* A titled section: the title plus everything it owns, as ONE searchable block. Without the
   wrapper a trailing untitled row would keep an earlier title (and its card) visible. */
export function Section({ label, action, children }) {
  return h('div', { className: 'dsh-ws-section', 'data-block': '', 'data-label': label },
    h('div', { className: 'dsh-ws-subtitle' },
      h('span', { className: 'dsh-ws-subtitle-text' }, label),
      action ?? null),
    children)
}

/* One color swatch cell inside a palette grid. */
export function ColorCell({ label, value, onChange, resetTitle, onReset, custom }) {
  return h('div', { className: 'dsh-ws-cell', 'data-label': label, 'data-unit': '' },
    h('input', {
      'aria-label': translate('settings.fileColor.aria', { label }),
      className: 'dsh-ws-cell-color',
      onChange: event => onChange(event.target.value),
      type: 'color',
      value,
    }),
    h('span', { className: 'dsh-ws-cell-name', title: label }, label),
    h(Reset, { title: resetTitle, custom, onClick: onReset }))
}

/* One highlight-preset cell (a per-file-type select). */
export function PresetCell({ label, value, onChange, resetTitle, onReset, custom }) {
  return h('div', { className: 'dsh-ws-cell', 'data-label': `${label} ${translate('settings.presets')}`, 'data-unit': '' },
    h('span', { className: 'dsh-ws-cell-name', title: label }, label),
    h('select', {
      'aria-label': translate('settings.preset.aria', { label }),
      className: 'dsh-ws-cell-select',
      onChange: event => onChange(event.target.value),
      value,
    }, HIGHLIGHT_PRESETS.map(preset => h('option', { key: preset.id, value: preset.id }, highlightPresetLabel(preset.id)))),
    h(Reset, { title: resetTitle, custom, onClick: onReset }))
}

/* Card shell: title + (changed count) + header actions + 说明 toggle, then the collapsed 说明 body, then rows. */
export function Card({ id, title, meta, actions, notes, children }) {
  const [open, setOpen] = useState(false)
  const entries = notes ?? []
  return h('section', { className: 'dsh-ws-card', 'data-card': '', 'data-label': title, id: `dsh-ws-card-${id}` },
    h('div', { className: 'dsh-ws-card-head' },
      h('span', { className: 'dsh-ws-card-title' }, title),
      meta === null || meta === undefined ? null : h('span', { className: 'dsh-ws-card-meta' }, meta),
      actions ?? null,
      entries.length === 0 ? null : h('button', {
        'aria-expanded': open ? 'true' : 'false',
        className: 'dsh-ws-notes-toggle',
        onClick: () => setOpen(value => !value),
        title: translate(open ? 'settings.notes.collapse' : 'settings.notes.expand'),
        type: 'button',
      }, translate('settings.notes'), h('i', { className: 'dsh-ws-notes-caret' }))),
    open && entries.length > 0
      ? h('div', { className: 'dsh-ws-notes' }, entries.map((entry, index) => h('p', { key: `${noteKey(entry)}-${index}` }, translate(noteKey(entry), noteParams(entry)))))
      : null,
    h('div', { className: 'dsh-ws-card-body' }, children))
}
