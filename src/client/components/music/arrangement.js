/* GarageBand-style arrangement: one instrument rack plus a shared bar timeline.
 *
 * The rack owns track identity (name, instrument, mute/solo); the timeline draws one region
 * per track with a miniature of its notes or drum hits. Selecting a row or region selects
 * the track, which swaps the editor below. This component is presentational: every edit is
 * reported to the panel, which owns the score and the undo/dirty bookkeeping.
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { translate } from '../../locale/index.js'
import { MUSIC_STEPS_PER_BAR, scoreSeconds } from '../../../shared/music-score.js'
import { formatClock } from './helpers.js'
import { instrumentGlyph, instrumentInfo, trackDisplayName } from './instruments.js'


function noteRange(track) {
  let low = 60
  let high = 72
  for (const note of track.notes) {
    low = Math.min(low, note.midi)
    high = Math.max(high, note.midi)
  }
  low = Math.max(0, low - 2)
  high = Math.min(127, high + 2)
  return { low, high }
}

function miniNotes(track, bars) {
  const range = noteRange(track)
  const span = Math.max(1, range.high - range.low)
  return track.notes.map((note, index) => {
    if (note.bar > bars) return null
    const left = (((note.bar - 1) * MUSIC_STEPS_PER_BAR + note.step) / (bars * MUSIC_STEPS_PER_BAR)) * 100
    const width = Math.max(0.7, (note.len / (bars * MUSIC_STEPS_PER_BAR)) * 100)
    const top = 5 + ((range.high - note.midi) / span) * 21
    return h('span', {
      className: 'dsh-ws-music-mini-note',
      key: `n-${index}`,
      style: { left: `${left}%`, top: `${top}px`, width: `${width}%` },
    })
  })
}

const MINI_DRUM_LANES = [['kick', 5], ['snare', 12], ['hat', 19]]

function miniDrums(track, bars) {
  const hits = []
  for (const [lane, top] of MINI_DRUM_LANES) {
    const laneSteps = track.drums?.[lane]
    if (!Array.isArray(laneSteps)) continue
    laneSteps.forEach((steps, barIndex) => {
      if (barIndex >= bars) return
      for (const stepText of Object.keys(steps)) {
        const left = ((barIndex * MUSIC_STEPS_PER_BAR + Number(stepText)) / (bars * MUSIC_STEPS_PER_BAR)) * 100
        hits.push(h('span', { className: 'dsh-ws-music-mini-dot', key: `${lane}-${barIndex}-${stepText}`, style: { left: `${left}%`, top: `${top}px` } }))
      }
    })
  }
  return hits
}

export function Arrangement({ doc, onAddTrack, onReorderTrack, onSelectTrack, onToggleMute, onToggleSolo, playhead, selectedTrackId }) {
  const bars = doc.bars
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const manualUntilRef = useRef(0)
  const programmaticUntilRef = useRef(0)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  /* Shift+wheel is registered natively so preventDefault actually stops the page scroll;
     the ruler or an empty track lane is the discoverable "pull the timeline" gesture. */
  useEffect(() => {
    const node = scrollRef.current
    if (node === null) return undefined
    const onWheel = (event) => {
      if (!event.shiftKey) return
      if (node.scrollWidth <= node.clientWidth) return
      event.preventDefault()
      manualUntilRef.current = Date.now() + 2500
      node.scrollLeft += Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (node === null || Date.now() < manualUntilRef.current) return
    const span = Math.max(1, node.scrollWidth - node.clientWidth)
    const x = playhead * node.scrollWidth
    const margin = 48
    const next = x < node.scrollLeft + margin
      ? Math.max(0, x - margin)
      : (x > node.scrollLeft + node.clientWidth - margin ? Math.min(span, x - node.clientWidth + margin * 2) : node.scrollLeft)
    if (next !== node.scrollLeft) {
      programmaticUntilRef.current = Date.now() + 150
      node.scrollLeft = next
    }
  }, [playhead])

  const startPan = (event) => {
    const node = scrollRef.current
    if (node === null) return
    const onRuler = event.target instanceof Element && event.target.closest('.dsh-ws-music-ruler') !== null
    const lane = event.target instanceof Element ? event.target.closest('.dsh-ws-music-lane') : null
    const onLane = lane !== null
    if (event.button !== 1 && !(event.button === 0 && (onRuler || onLane))) return
    suppressClickRef.current = false
    dragRef.current = {
      id: event.pointerId,
      left: node.scrollLeft,
      moved: false,
      track: lane?.dataset.track ?? null,
      x: event.clientX,
    }
    manualUntilRef.current = Date.now() + 2500
    setDragging(true)
    try { node.setPointerCapture?.(event.pointerId) } catch {}
    /* Ruler/middle drags can cancel the compatibility click; a lane needs its click for
       selection when the pointer did not actually move. */
    if (onRuler || event.button === 1) event.preventDefault()
  }

  const movePan = (event) => {
    const node = scrollRef.current
    const drag = dragRef.current
    if (node === null || drag === null || drag.id !== event.pointerId) return
    if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true
    node.scrollLeft = drag.left - (event.clientX - drag.x)
    manualUntilRef.current = Date.now() + 2500
  }

  const endPan = (event) => {
    const node = scrollRef.current
    const drag = dragRef.current
    if (drag === null) return
    if (node !== null) {
      try { node.releasePointerCapture?.(event.pointerId) } catch {}
    }
    suppressClickRef.current = drag.moved || drag.track !== null
    if (!drag.moved && drag.track !== null) onSelectTrack(drag.track)
    dragRef.current = null
    setDragging(false)
  }

  const ruler = Array.from({ length: bars }, (_, index) => h('span', { key: index }, String(index + 1)))
  const beatLines = Array.from({ length: bars * 4 }, (_, cell) => h('i', { 'data-bar': cell % 4 === 0 || undefined, key: cell }))

  const heads = doc.tracks.map(track => {
    const info = instrumentInfo(track.instrument)
    return h('div', {
      className: 'dsh-ws-music-track-head',
      'data-selected': track.id === selectedTrackId || undefined,
      'data-track': track.id,
      draggable: true,
      key: track.id,
      onClick: () => onSelectTrack(track.id),
      onDragOver: event => event.preventDefault(),
      onDragStart: (event) => {
        event.dataTransfer.setData('text/plain', track.id)
        event.dataTransfer.effectAllowed = 'move'
      },
      onDrop: (event) => {
        event.preventDefault()
        const from = event.dataTransfer.getData('text/plain')
        if (from !== '') onReorderTrack(from, track.id)
      },
      style: { '--track-c': info.color },
    },
      h('span', { 'aria-hidden': true, className: 'dsh-ws-music-track-grip' }, '⠿'),
      h('span', { className: 'dsh-ws-music-track-glyph' }, instrumentGlyph(info.icon, 12)),
      h('span', { className: 'dsh-ws-music-track-meta' },
        h('b', null, trackDisplayName(track)),
        h('span', null, translate(info.nameKey))),
      h('span', { className: 'dsh-ws-music-track-btns' },
        h('button', {
          'aria-pressed': track.muted === true,
          title: translate('music.arrange.mute'),
          type: 'button',
          onClick: (event) => { event.stopPropagation(); onToggleMute(track.id) },
        }, 'M'),
        h('button', {
          'aria-pressed': track.solo === true,
          title: translate('music.arrange.solo'),
          type: 'button',
          onClick: (event) => { event.stopPropagation(); onToggleSolo(track.id) },
        }, 'S')))
  })

  const lanes = doc.tracks.map(track => {
    const info = instrumentInfo(track.instrument)
    return h('div', {
      className: 'dsh-ws-music-lane',
      'data-selected': track.id === selectedTrackId || undefined,
      'data-track': track.id,
      key: track.id,
      onClick: () => onSelectTrack(track.id),
      style: { '--track-c': info.color },
    },
      h('div', { className: 'dsh-ws-music-lane-grid', 'aria-hidden': true }, beatLines),
      h('div', {
        className: 'dsh-ws-music-region',
        'data-selected': track.id === selectedTrackId || undefined,
      },
        h('span', { className: 'dsh-ws-music-region-name' }, trackDisplayName(track)),
        track.kind === 'drums' ? miniDrums(track, bars) : miniNotes(track, bars)))
  })

  const body = h('div', { className: 'dsh-ws-music-arrange-body' },
    h('div', { className: 'dsh-ws-music-head-col' },
      h('div', { className: 'dsh-ws-music-ruler-spacer' }, translate('music.arrange.tracksLabel')),
      heads,
      h('button', { className: 'dsh-ws-music-add-track', onClick: onAddTrack, type: 'button' }, `＋ ${translate('music.arrange.add')}`)),
    h('div', {
      className: 'dsh-ws-music-timeline-scroll',
      'data-dragging': dragging || undefined,
      onClickCapture: (event) => {
        if (!suppressClickRef.current) return
        suppressClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
      },
      onPointerCancel: endPan,
      onPointerDown: startPan,
      onPointerMove: movePan,
      onPointerUp: endPan,
      onScroll: () => {
        if (Date.now() < programmaticUntilRef.current) return
        manualUntilRef.current = Date.now() + 2500
      },
      ref: scrollRef,
      title: translate('music.arrange.panHint'),
    },
      h('div', { className: 'dsh-ws-music-timeline', style: { '--music-bars': String(bars) } },
        h('div', { className: 'dsh-ws-music-ruler' }, ruler),
        h('div', { className: 'dsh-ws-music-lanes' }, lanes),
        h('div', { className: 'dsh-ws-music-playhead', style: { left: `${Math.max(0, Math.min(1, playhead)) * 100}%` } }))))

  const empty = h('div', { className: 'dsh-ws-music-arrange-empty' },
    h('b', null, translate('music.arrange.empty')),
    h('span', null, translate('music.arrange.emptyHint')),
    h('button', { className: 'dsh-ws-music-mini-button', onClick: onAddTrack, type: 'button' }, `＋ ${translate('music.arrange.add')}`))

  return h('section', { className: 'dsh-ws-music-arrange' },
    h('div', { className: 'dsh-ws-music-arrange-head' },
      h('span', { className: 'dsh-ws-music-section-title' }, translate('music.arrange.title')),
      h('span', { className: 'dsh-ws-music-arrange-count' }, translate('music.arrange.tracks', { count: String(doc.tracks.length) })),
      h('span', { className: 'dsh-ws-music-arrange-total' }, translate('music.arrange.total', {
        bars: String(bars),
        time: formatClock(scoreSeconds(doc)),
      })),
      h('span', { className: 'dsh-ws-music-spacer' }),
      h('button', { className: 'dsh-ws-music-mini-button', onClick: onAddTrack, type: 'button' }, `＋ ${translate('music.arrange.add')}`)),
    doc.tracks.length === 0 ? empty : body,
    doc.tracks.length === 0 ? null : h('div', { className: 'dsh-ws-music-arrange-foot' }, translate('music.arrange.hint')))
}



