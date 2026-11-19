/* Single-choice bubble for the AI composer's style and mood.
 *
 * It mirrors the instrument popover: anchored to its trigger, absolute inside `.dsh-ws-music`
 * (container-type makes fixed positioning unreliable), closes on outside pointerdown /
 * Escape. A choice applies immediately; there is no draft/apply step for a single value.
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { translate } from '../../locale/index.js'

const MARGIN = 8

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function ComposeChoicePopover({ anchorRef, hint, kind, onCancel, onSelect, options, selected, title, width }) {
  const panelRef = useRef(null)
  const [position, setPosition] = useState(null)
  const [side, setSide] = useState('below')
  const [arrowLeft, setArrowLeft] = useState(20)

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
      const rootRect = root === null
        ? { left: 0, top: 0, width: window.innerWidth, bottom: window.innerHeight }
        : root.getBoundingClientRect()
      const panelWidth = Math.min(width, rootRect.width - MARGIN * 2, window.innerWidth - MARGIN * 2)
      const below = rootRect.bottom - rect.bottom - MARGIN
      const above = rect.top - rootRect.top - MARGIN
      const nextSide = below < 240 && above > below ? 'above' : 'below'
      /* 460 fits the 12-style grid at the enlarged card type (name 12.5px / desc 11px); the
         lower bound keeps a short panel usable when the anchor really is near an edge. */
      const maxHeight = Math.max(180, Math.min(460, (nextSide === 'below' ? below : above) - 8))
      const left = clamp(rect.left - rootRect.left, MARGIN, rootRect.width - panelWidth - MARGIN)
      const top = nextSide === 'below'
        ? rect.bottom - rootRect.top + 7
        : Math.max(MARGIN, rect.top - rootRect.top - maxHeight - 7)
      setSide(nextSide)
      setArrowLeft(clamp(rect.left - rootRect.left + rect.width / 2 - left, 15, panelWidth - 15))
      setPosition({ left: Math.round(left), maxHeight: Math.round(maxHeight), top: Math.round(top), width: Math.round(panelWidth) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef, width])

  useEffect(() => {
    const panel = panelRef.current
    if (panel !== null) panel.focus({ preventScroll: true })
  }, [])

  return h('div', {
    'aria-label': title,
    className: 'dsh-ws-music-choice-popover',
    'data-kind': kind,
    'data-side': side,
    ref: panelRef,
    role: 'dialog',
    style: {
      left: `${position?.left ?? 0}px`,
      maxHeight: `${position?.maxHeight ?? 300}px`,
      top: `${position?.top ?? 0}px`,
      visibility: position === null ? 'hidden' : undefined,
      width: `${position?.width ?? width}px`,
      '--dsh-ws-choice-arrow-left': `${arrowLeft}px`,
    },
    tabIndex: -1,
  },
  h('span', { 'aria-hidden': true, className: 'dsh-ws-music-choice-arrow' }),
  h('div', { className: 'dsh-ws-music-choice-head' },
    h('div', { className: 'dsh-ws-music-choice-title' }, title,
      h('span', null, translate('music.compose.singleChoice'))),
    h('div', { className: 'dsh-ws-music-choice-sub' }, hint)),
  h('div', { className: 'dsh-ws-music-choice-grid' }, options.map(option => h('button', {
    'aria-pressed': option.id === selected,
    className: 'dsh-ws-music-choice-option',
    key: option.id,
    onClick: () => onSelect(option.id),
    style: { '--choice-c': option.color },
    type: 'button',
  },
  h('span', { className: 'dsh-ws-music-choice-name' },
    h('i', { 'aria-hidden': true }),
    option.label,
    h('b', { 'aria-hidden': true }, '✓')),
  h('span', { className: 'dsh-ws-music-choice-desc' }, option.desc)))),
  h('div', { className: 'dsh-ws-music-choice-foot' },
    h('span', null, translate('music.compose.choiceApply')),
    h('span', null, h('kbd', null, 'Esc'), ` ${translate('music.compose.choiceClose')}`)))
}

