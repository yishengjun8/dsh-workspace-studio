/* Floating multi-select popover for the AI composer's instrumentation.
 *
 * It renders as a fixed layer so a bubble anchored to a button inside the scrollable music
 * card is not clipped by the card's overflow. The selection is a draft: only Apply writes it back.
 */
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { translate } from '../../locale/index.js'
import { MUSIC_DEFAULT_INSTRUMENTS, MUSIC_INSTRUMENT_IDS } from '../../../shared/music-score.js'
import { INSTRUMENT_CATEGORIES, INSTRUMENT_LIST, instrumentGlyph } from './instruments.js'

const POPOVER_WIDTH = 480
const POPOVER_MAX_HEIGHT = 560
const POPOVER_MARGIN = 8

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function orderSelection(ids) {
  const wanted = new Set(ids)
  return MUSIC_INSTRUMENT_IDS.filter(id => wanted.has(id))
}

export function ComposeInstrumentsPopover({ anchorRef, selected, onApply, onCancel }) {
  const panelRef = useRef(null)
  const [draft, setDraft] = useState(() => orderSelection(selected))
  const [position, setPosition] = useState(null)
  const [side, setSide] = useState('below')
  const [arrowLeft, setArrowLeft] = useState(24)

  useEffect(() => {
    const onPointer = (event) => {
      const panel = panelRef.current
      const anchor = anchorRef.current
      if (panel !== null && panel.contains(event.target)) return
      if (anchor !== null && anchor.contains(event.target)) return
      onCancel()
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onCancel])

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const rect = anchor.getBoundingClientRect()
      const root = anchor.closest('.dsh-ws-music')
      const rootRect = root === null ? { left: 0, top: 0, width: window.innerWidth, bottom: window.innerHeight } : root.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, rootRect.width - POPOVER_MARGIN * 2, window.innerWidth - POPOVER_MARGIN * 2)
      const below = rootRect.bottom - rect.bottom - POPOVER_MARGIN
      const above = rect.top - rootRect.top - POPOVER_MARGIN
      const nextSide = below < 300 && above > below ? 'above' : 'below'
      const maxHeight = Math.max(220, Math.min(POPOVER_MAX_HEIGHT, (nextSide === 'below' ? below : above) - 8))
      const left = clamp(rect.left - rootRect.left, POPOVER_MARGIN, rootRect.width - width - POPOVER_MARGIN)
      const top = nextSide === 'below'
        ? rect.bottom - rootRect.top + 8
        : Math.max(8, rect.top - rootRect.top - maxHeight - 8)
      setSide(nextSide)
      setArrowLeft(clamp(rect.left - rootRect.left + rect.width / 2 - left, 18, width - 18))
      setPosition({ left, width, maxHeight, top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef])

  useEffect(() => {
    const panel = panelRef.current
    if (panel !== null) panel.focus({ preventScroll: true })
  }, [])

  const groups = useMemo(() => INSTRUMENT_CATEGORIES
    .filter(category => category !== 'all')
    .map(category => ({
      category,
      items: INSTRUMENT_LIST.filter(info => info.cat === category),
    }))
    .filter(group => group.items.length > 0), [])

  const toggle = (id) => {
    setDraft(current => (current.includes(id)
      ? current.filter(item => item !== id)
      : orderSelection([...current, id])))
  }

  const apply = () => {
    if (draft.length === 0) return
    onApply(orderSelection(draft))
  }

  const panel = h('div', {
    'aria-label': translate('music.compose.instrumentTitle'),
    className: 'dsh-ws-music-inst-popover',
    'data-side': side,
    ref: panelRef,
    role: 'dialog',
    style: {
      left: `${position?.left ?? 0}px`,
      width: `${position?.width ?? POPOVER_WIDTH}px`,
      maxHeight: `${position?.maxHeight ?? POPOVER_MAX_HEIGHT}px`,
      visibility: position === null ? 'hidden' : undefined,
      '--dsh-ws-music-arrow-left': `${arrowLeft}px`,
      ...(position?.top === undefined ? {} : { top: `${position.top}px` }),
      ...(position?.bottom === undefined ? {} : { bottom: `${position.bottom}px` }),
    },
    tabIndex: -1,
  },
  h('span', { 'aria-hidden': true, className: 'dsh-ws-music-inst-arrow' }),
  h('div', { className: 'dsh-ws-music-inst-head' },
    h('div', { className: 'dsh-ws-music-inst-title' }, translate('music.compose.instrumentTitle')),
    h('div', { className: 'dsh-ws-music-inst-sub' }, translate('music.compose.instrumentHint')),
    h('div', { className: 'dsh-ws-music-inst-count' }, translate('music.compose.instrumentSelected', { count: draft.length }))),
  h('div', { className: 'dsh-ws-music-inst-scroll' },
    groups.map(group => h('section', { className: 'dsh-ws-music-inst-group', key: group.category },
      h('div', { className: 'dsh-ws-music-inst-cat' }, translate(`music.instcat.${group.category}`)),
      h('div', { className: 'dsh-ws-music-inst-grid' }, group.items.map(info => {
        const on = draft.includes(info.id)
        return h('button', {
          'aria-pressed': on,
          className: 'dsh-ws-music-inst-option',
          'data-selected': on || undefined,
          key: info.id,
          onClick: () => toggle(info.id),
          style: { '--inst-c': info.color },
          type: 'button',
        },
        h('span', { 'aria-hidden': true, className: 'dsh-ws-music-inst-option-glyph' }, instrumentGlyph(info.icon, 15)),
        h('span', { className: 'dsh-ws-music-inst-option-name' }, translate(info.nameKey)),
        h('span', { className: 'dsh-ws-music-inst-option-desc' }, translate(info.descKey)),
        on ? h('span', { 'aria-hidden': true, className: 'dsh-ws-music-inst-option-check' }, '✓') : null)
      }))))),
  h('div', { className: 'dsh-ws-music-inst-foot' },
    h('div', { className: 'dsh-ws-music-inst-foot-left' },
      h('button', { className: 'dsh-ws-music-inst-link', onClick: () => setDraft(orderSelection(MUSIC_DEFAULT_INSTRUMENTS)), type: 'button' }, translate('music.compose.instrumentReset')),
      h('button', { className: 'dsh-ws-music-inst-link', onClick: () => setDraft([...MUSIC_INSTRUMENT_IDS]), type: 'button' }, translate('music.compose.instrumentAll')),
      h('button', { className: 'dsh-ws-music-inst-link', onClick: () => setDraft([]), type: 'button' }, translate('music.compose.instrumentClear'))),
    h('div', { className: 'dsh-ws-music-inst-foot-right' },
      h('button', { className: 'dsh-ws-music-mini-button', onClick: onCancel, type: 'button' }, translate('music.compose.instrumentCancel')),
      h('button', {
        className: 'dsh-ws-music-primary dsh-ws-music-inst-apply',
        disabled: draft.length === 0,
        onClick: apply,
        title: draft.length === 0 ? translate('music.compose.instrumentEmpty') : undefined,
        type: 'button',
      }, translate('music.compose.instrumentApply')))))

  return panel
}

