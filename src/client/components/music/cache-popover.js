/* The session's piece-history dropdown: current piece pinned on top, cached pieces beneath.
 *
 * Current is a live document, not a cache row, so its delete affordance is present but disabled;
 * every cached row deletes behind an inline two-step confirmation. Selecting a row is handled by
 * the parent (snapshot current -> load selected -> drop the row).
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MUSIC_STYLES } from '../../../shared/music-score.js'
import { translate } from '../../locale/index.js'

const MARGIN = 8
const POPOVER_WIDTH = 372

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function timeLabel(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function metaLabel(item) {
  const style = item.style === undefined || item.style === null ? '' : translate(`music.style.${item.style}`)
  const mood = item.mood === undefined || item.mood === null ? '' : translate(`music.mood.${item.mood}`)
  return [
    `${item.bars} ${translate('music.cache.bars')}`,
    `${Number(item.seconds).toFixed(1)}s`,
    style,
    mood,
    timeLabel(item.updatedAt),
  ].filter(part => part !== '').join(' · ')
}

export function MusicCachePopover({ anchorRef, current, entries, error, loading, onClose, onDelete, onSelect }) {
  const panelRef = useRef(null)
  const [position, setPosition] = useState(null)
  const [side, setSide] = useState('below')
  const [arrowLeft, setArrowLeft] = useState(24)
  const [confirmId, setConfirmId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const onPointer = (event) => {
      const panel = panelRef.current
      const anchor = anchorRef.current
      if (panel !== null && panel.contains(event.target)) return
      if (anchor !== null && anchor.contains(event.target)) return
      onClose()
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const rect = anchor.getBoundingClientRect()
      const root = anchor.closest('.dsh-ws-music')
      const rootRect = root === null
        ? { left: 0, top: 0, width: window.innerWidth, bottom: window.innerHeight }
        : root.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, rootRect.width - MARGIN * 2, window.innerWidth - MARGIN * 2)
      const below = rootRect.bottom - rect.bottom - MARGIN
      const above = rect.top - rootRect.top - MARGIN
      const nextSide = below < 260 && above > below ? 'above' : 'below'
      const maxHeight = Math.max(220, Math.min(420, (nextSide === 'below' ? below : above) - 8))
      const left = clamp(rect.right - rootRect.left - width, MARGIN, rootRect.width - width - MARGIN)
      const top = nextSide === 'below'
        ? rect.bottom - rootRect.top + 7
        : Math.max(MARGIN, rect.top - rootRect.top - maxHeight - 7)
      setSide(nextSide)
      setArrowLeft(clamp(rect.left - rootRect.left + rect.width / 2 - left, 18, width - 18))
      setPosition({ left: Math.round(left), maxHeight: Math.round(maxHeight), top: Math.round(top), width: Math.round(width) })
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

  const remove = async (entry) => {
    setDeletingId(entry.id)
    try {
      await onDelete(entry)
      setConfirmId(null)
      setToast({ error: false, text: translate('music.cache.deleted', { title: entry.title }) })
    } catch (deleteError) {
      setToast({ error: true, text: translate('music.cache.deleteFailed', { message: deleteError instanceof Error ? deleteError.message : String(deleteError) }) })
    } finally {
      setDeletingId(null)
    }
  }

  return h('div', {
    'aria-label': translate('music.cache.title'),
    className: 'dsh-ws-music-cache-popover',
    'data-side': side,
    ref: panelRef,
    role: 'dialog',
    style: {
      left: `${position?.left ?? 0}px`,
      maxHeight: `${position?.maxHeight ?? 420}px`,
      top: `${position?.top ?? 0}px`,
      visibility: position === null ? 'hidden' : undefined,
      width: `${position?.width ?? POPOVER_WIDTH}px`,
      '--dsh-ws-cache-arrow-left': `${arrowLeft}px`,
    },
    tabIndex: -1,
  },
  h('span', { 'aria-hidden': true, className: 'dsh-ws-music-cache-arrow' }),
  h('div', { className: 'dsh-ws-music-cache-head' },
    h('div', { className: 'dsh-ws-music-cache-titles' },
      h('div', { className: 'dsh-ws-music-cache-title' }, translate('music.cache.title'),
        h('span', null, translate('music.cache.shared'))),
      h('div', { className: 'dsh-ws-music-cache-sub' }, translate('music.cache.hint'))),
    h('span', { className: 'dsh-ws-music-cache-count' }, translate('music.cache.count', { count: String(entries.length + 1) }))),
  h('div', { className: 'dsh-ws-music-cache-list' },
    h('div', { className: 'dsh-ws-music-cache-row', 'data-current': true },
      h('span', { 'aria-hidden': true, className: 'dsh-ws-music-cache-dot' }),
      h('div', { className: 'dsh-ws-music-cache-main' },
        h('div', { className: 'dsh-ws-music-cache-name' },
          h('span', null, current.title),
          h('span', { className: 'dsh-ws-music-cache-badge' }, translate('music.cache.current'))),
        h('div', { className: 'dsh-ws-music-cache-meta' }, metaLabel(current))),
      h('button', {
        'aria-label': translate('music.cache.currentLocked'),
        className: 'dsh-ws-music-cache-delete',
        disabled: true,
        title: translate('music.cache.currentLocked'),
        type: 'button',
      }, h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
        h('path', {
          d: 'M3.5 4.5h9M6 2.8h4M5 4.5l.6 8.2h4.8l.6-8.2M6.6 6.4v4.4M9.4 6.4v4.4',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-linecap': 'round',
          'stroke-width': 1.1,
        })))),
    entries.length === 0
      ? h('div', { className: 'dsh-ws-music-cache-empty' },
        h('b', null, translate('music.cache.empty')),
        h('span', null, translate('music.cache.emptyHint')))
      : entries.map(entry => {
        const confirming = confirmId === entry.id
        const deleting = deletingId === entry.id
        return h('div', {
          className: 'dsh-ws-music-cache-row',
          'data-confirm': confirming || undefined,
          key: entry.id,
          onClick: () => { if (!confirming && deletingId === null) onSelect(entry) },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (!confirming && deletingId === null) onSelect(entry)
          },
          role: 'button',
          tabIndex: 0,
        },
        h('span', { 'aria-hidden': true, className: 'dsh-ws-music-cache-dot', style: { background: MUSIC_STYLES[entry.style]?.color } }),
        h('div', { className: 'dsh-ws-music-cache-main' },
          h('div', { className: 'dsh-ws-music-cache-name' }, h('span', null, entry.title)),
          h('div', { className: 'dsh-ws-music-cache-meta' }, metaLabel(entry))),
        h('button', {
          'aria-label': translate('music.cache.deleteAria', { title: entry.title }),
          className: 'dsh-ws-music-cache-delete',
          onClick: (event) => { event.stopPropagation(); setConfirmId(entry.id) },
          title: translate('music.cache.delete'),
          type: 'button',
        }, h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
          h('path', {
            d: 'M3.5 4.5h9M6 2.8h4M5 4.5l.6 8.2h4.8l.6-8.2M6.6 6.4v4.4M9.4 6.4v4.4',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-linecap': 'round',
            'stroke-width': 1.1,
          }))),
        confirming
          ? h('div', { className: 'dsh-ws-music-cache-confirm' },
            h('span', { className: 'dsh-ws-music-cache-confirm-text' },
              translate('music.cache.deleteConfirm', { title: entry.title })),
            h('button', {
              disabled: deleting,
              onClick: (event) => { event.stopPropagation(); setConfirmId(null) },
              type: 'button',
            }, translate('music.cache.cancel')),
            h('button', {
              className: 'dsh-ws-music-cache-danger',
              disabled: deleting,
              onClick: (event) => { event.stopPropagation(); void remove(entry) },
              type: 'button',
            }, deleting ? translate('music.cache.deleting') : translate('music.cache.deleteAction')))
          : null,
        )
      })),
  h('div', { className: 'dsh-ws-music-cache-foot' },
    h('span', null, loading ? translate('music.cache.loading') : error === '' ? translate('music.cache.footer') : error),
    h('span', null, translate('music.cache.irreversible'))),
  toast === null ? null : h('div', {
    className: 'dsh-ws-music-cache-toast',
    'data-error': toast.error || undefined,
    role: 'status',
  }, toast.text))
}

