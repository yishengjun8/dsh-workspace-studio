/* Piano roll for one melodic instrument track.
 *
 * Two gestures share the grid:
 *  - pointer-down on empty space starts a DRAW stroke. A single click writes one 1/16 note;
 *    holding and dragging grows that same note, so a long press produces one sustained note
 *    instead of a run of separate cells. The note is added through the panel once (which
 *    returns its index) and every move patches only its length; pointer capture on the canvas
 *    keeps the stroke alive across those renders.
 *  - pointer-down on a note starts move/resize, committed as one immutable patch on release.
 *
 * The roll itself zooms in both axes: a horizontal slider under the grid widens the timeline,
 * a vertical slider to its right scales the pitch rows.
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { translate } from '../../locale/index.js'
import { midiName } from '../../../shared/music-score.js'
import { MUSIC_ROLL_GRID_WIDTH_DEFAULT, MUSIC_ROLL_ROW_HEIGHT_DEFAULT, MUSIC_ZOOM_MAX, MUSIC_ZOOM_MIN } from '../../constants.js'
import { noteTitle, noteValueLabel } from './helpers.js'

const RULER_HEIGHT = 17
const MIN_ROLL_HEIGHT = 180
const MAX_ROLL_HEIGHT = 720
const BASE_VIEWPORT_HEIGHT = 360
const RESIZE_STEP = 16
const PAINT_VELOCITY = 96

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function rowRange(notes, minRows = 0) {
  let low = 60
  let high = 72
  for (const note of notes) {
    low = Math.min(low, note.midi)
    high = Math.max(high, note.midi)
  }
  low = clamp(low - 2, 0, 127)
  high = clamp(high + 2, low + 11, 127)
  let rows = high - low + 1
  const want = clamp(Math.round(minRows), 1, 96)
  if (want > rows) {
    const middle = (low + high) / 2
    low = clamp(Math.round(middle - (want - 1) / 2), 0, 128 - want)
    high = low + want - 1
    rows = want
  }
  return { low, high, rows }
}

export function PianoRoll({
  bars,
  baseGridWidth = MUSIC_ROLL_GRID_WIDTH_DEFAULT,
  baseRowHeight = MUSIC_ROLL_ROW_HEIGHT_DEFAULT,
  color,
  height = null,
  onAdd,
  onAudition,
  onChange,
  onDelete,
  onHeight,
  onSelect,
  onZoomX,
  onZoomY,
  playhead,
  scopeBar = null,
  selectedIndex,
  track,
  zoomX = 1,
  zoomY = 1,
}) {
  const gridRef = useRef(null)
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const paintRef = useRef(null)
  const resizeRef = useRef(null)
  const zoomTrackRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [liveHeight, setLiveHeight] = useState(null)
  const [zoomTrackHeight, setZoomTrackHeight] = useState(104)
  const scaleX = clamp(Number(zoomX) || 1, MUSIC_ZOOM_MIN, MUSIC_ZOOM_MAX)
  const scaleY = clamp(Number(zoomY) || 1, MUSIC_ZOOM_MIN, MUSIC_ZOOM_MAX)
  const rowHeight = Math.max(2, Math.round(baseRowHeight * scaleY))
  const keyLabelsVisible = rowHeight >= 6
  const viewHeight = liveHeight ?? height
  const minRows = viewHeight === null ? 0 : Math.max(1, Math.ceil((viewHeight - RULER_HEIGHT) / rowHeight))
  const { low, high, rows } = rowRange(track.notes, minRows)
  const totalSteps = bars * 16
  const canvasHeight = rows * rowHeight
  const gridMinWidth = Math.round(baseGridWidth * scaleX)
  const autoViewportHeight = Math.round(BASE_VIEWPORT_HEIGHT * scaleY)

  useEffect(() => () => {
    dragRef.current = null
    paintRef.current = null
    resizeRef.current = null
  }, [])

  /* The vertical slider is a rotated horizontal range: its CSS width is the rail height.
     Measure the rail so the track fills the whole roll instead of a fixed 104px stub. */
  useLayoutEffect(() => {
    const node = zoomTrackRef.current
    if (node === null || typeof ResizeObserver !== 'function') return undefined
    const update = () => {
      const next = Math.max(40, Math.round(node.getBoundingClientRect().height))
      setZoomTrackHeight(current => (current === next ? current : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const cellAt = (event) => {
    const grid = gridRef.current
    if (grid === null) return null
    const rect = grid.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const step = clamp(Math.floor(((event.clientX - rect.left) / rect.width) * totalSteps), 0, totalSteps - 1)
    const row = clamp(Math.floor((event.clientY - rect.top) / rowHeight), 0, rows - 1)
    return { bar: Math.floor(step / 16) + 1, midi: low + rows - 1 - row, step: step % 16 }
  }

  const hasNoteAt = (cell) => track.notes.some(note => note.bar === cell.bar && note.step === cell.step && note.midi === cell.midi)

  const startPaint = (event) => {
    if (event.button !== 0) return
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    const cell = cellAt(event)
    if (cell === null) return
    /* A press on an existing cell is a selection click, not a draw stroke. */
    if (hasNoteAt(cell)) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* synthetic events have no active pointer */
    }
    const roll = event.currentTarget.closest('.dsh-ws-music-roll')
    if (roll !== null && typeof roll.focus === 'function') roll.focus({ preventScroll: true })
    const index = onAdd({ ...cell, len: 1, vel: PAINT_VELOCITY })
    if (!Number.isInteger(index) || index < 0) return
    paintRef.current = { index, startAbs: (cell.bar - 1) * 16 + cell.step, len: 1 }
    onSelect(index)
  }

  const movePaint = (event) => {
    const state = paintRef.current
    if (state === null) return
    const cell = cellAt(event)
    if (cell === null) return
    const endAbs = (cell.bar - 1) * 16 + cell.step
    const len = clamp(endAbs - state.startAbs + 1, 1, totalSteps - state.startAbs)
    if (len === state.len) return
    state.len = len
    onChange(state.index, { len })
  }

  const endPaint = () => {
    paintRef.current = null
  }

  const startDrag = (event, index, note, mode) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(index)
    const grid = gridRef.current
    if (grid === null) return
    const roll = event.currentTarget.closest('.dsh-ws-music-roll')
    if (roll !== null && typeof roll.focus === 'function') roll.focus({ preventScroll: true })
    const rect = grid.getBoundingClientRect()
    dragRef.current = {
      gridWidth: rect.width,
      index,
      mode,
      note: { ...note },
      origin: { ...note },
      startX: event.clientX,
      startY: event.clientY,
    }
    setDrag({ index, note: { ...note } })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* synthetic event */
    }
  }

  const moveDrag = (event) => {
    const state = dragRef.current
    if (state === null) return
    const grid = gridRef.current
    if (grid === null) return
    const rect = grid.getBoundingClientRect()
    let bar = state.origin.bar
    let step = state.origin.step
    let len = state.origin.len
    if (state.mode === 'move') {
      const deltaSteps = Math.round(((event.clientX - state.startX) / rect.width) * totalSteps)
      const absolute = clamp((state.origin.bar - 1) * 16 + state.origin.step + deltaSteps, 0, totalSteps - 1)
      bar = Math.floor(absolute / 16) + 1
      step = absolute % 16
      len = Math.min(len, totalSteps - absolute)
      const deltaRows = Math.round((event.clientY - state.startY) / rowHeight)
      const midi = clamp(state.origin.midi - deltaRows, low, high)
      state.note = { ...state.note, bar, step, midi, len }
    } else {
      const deltaSteps = Math.round(((event.clientX - state.startX) / rect.width) * totalSteps)
      const startAbs = (state.origin.bar - 1) * 16 + state.origin.step
      len = clamp(state.origin.len + deltaSteps, 1, totalSteps - startAbs)
      state.note = { ...state.note, len }
    }
    setDrag({ index: state.index, note: state.note })
  }

  const endDrag = () => {
    const state = dragRef.current
    if (state === null) return
    dragRef.current = null
    setDrag(null)
    const next = state.note
    if (next.midi === state.origin.midi && next.bar === state.origin.bar && next.step === state.origin.step && next.len === state.origin.len) return
    onChange(state.index, { bar: next.bar, step: next.step, midi: next.midi, len: next.len })
  }

  const keyDown = (event) => {
    if (selectedIndex === null || selectedIndex === undefined) return
    const note = track.notes[selectedIndex]
    if (note === undefined) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onDelete(selectedIndex)
      return
    }
    if (!event.key.startsWith('Arrow')) return
    event.preventDefault()
    const current = (note.bar - 1) * 16 + note.step
    let absolute = current
    if (event.key === 'ArrowLeft') absolute = clamp(current - 1, 0, totalSteps - 1)
    if (event.key === 'ArrowRight') absolute = clamp(current + 1, 0, totalSteps - 1)
    const bar = Math.floor(absolute / 16) + 1
    const step = absolute % 16
    const len = Math.min(note.len, totalSteps - absolute)
    const midi = clamp(note.midi + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0), low, high)
    if (absolute === current && midi === note.midi) return
    onChange(selectedIndex, { bar, step, midi, len })
  }

  const measuredHeight = () => {
    const scroll = scrollRef.current
    const measured = scroll === null ? 0 : scroll.getBoundingClientRect().height
    return Math.round(measured > 0 ? measured : canvasHeight + RULER_HEIGHT)
  }
  const startResize = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    const startHeight = measuredHeight()
    dragRef.current = null
    resizeRef.current = { height: startHeight, moved: false, startHeight, startY: event.clientY }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* synthetic event */
    }
  }
  const moveResize = (event) => {
    const state = resizeRef.current
    if (state === null) return
    const delta = event.clientY - state.startY
    state.moved = state.moved || Math.abs(delta) > 2
    state.height = clamp(Math.round(state.startHeight + delta), MIN_ROLL_HEIGHT, MAX_ROLL_HEIGHT)
    setLiveHeight(state.height)
  }
  const endResize = () => {
    const state = resizeRef.current
    if (state === null) return
    resizeRef.current = null
    setLiveHeight(null)
    if (state.moved) onHeight(state.height)
  }
  const resizeKey = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const base = viewHeight ?? measuredHeight()
    onHeight(clamp(base + (event.key === 'ArrowUp' ? -RESIZE_STEP : RESIZE_STEP), MIN_ROLL_HEIGHT, MAX_ROLL_HEIGHT))
  }

  const setZoomX = (value) => {
    if (typeof onZoomX === 'function') onZoomX(clamp(value, MUSIC_ZOOM_MIN, MUSIC_ZOOM_MAX))
  }
  const setZoomY = (value) => {
    if (typeof onZoomY === 'function') onZoomY(clamp(value, MUSIC_ZOOM_MIN, MUSIC_ZOOM_MAX))
  }

  const zoomFraction = clamp((scaleY - MUSIC_ZOOM_MIN) / (MUSIC_ZOOM_MAX - MUSIC_ZOOM_MIN), 0, 1)
  const thumbTop = 7 + (1 - zoomFraction) * Math.max(0, zoomTrackHeight - 14)
  const zoomXFraction = clamp((scaleX - MUSIC_ZOOM_MIN) / (MUSIC_ZOOM_MAX - MUSIC_ZOOM_MIN), 0, 1)
  const thumbLeft = `calc(${(zoomXFraction * 100).toFixed(3)}% + ${(7 - 14 * zoomXFraction).toFixed(2)}px)`

  const barLabels = []
  for (let bar = 1; bar <= bars; bar += 1) barLabels.push(bar)

  return h('div', { className: 'dsh-ws-music-roll', onKeyDown: keyDown, style: { '--track-c': color }, tabIndex: 0 },
    h('div', { className: 'dsh-ws-music-roll-stage' },
      h('div', {
        className: 'dsh-ws-music-roll-scroll',
        ref: scrollRef,
        style: viewHeight === null ? { maxHeight: `${autoViewportHeight}px` } : { height: `${viewHeight}px`, maxHeight: 'none' },
      },
        h('div', {
          className: 'dsh-ws-music-roll-grid',
          style: { '--dsh-ws-music-rows': String(rows), minWidth: 0, width: `${gridMinWidth}px` },
        },
          h('div', { className: 'dsh-ws-music-roll-ruler' }, barLabels.map(bar => h('span', {
            'data-scope': scopeBar === bar || undefined,
            key: bar,
          }, String(bar)))),
          h('div', { className: 'dsh-ws-music-roll-body' },
            h('div', { className: 'dsh-ws-music-roll-keys' }, Array.from({ length: rows }, (_, index) => {
              const midi = high - index
              const name = midiName(midi)
              return h('button', {
                'aria-label': translate('music.roll.audition', { note: name }),
                className: 'dsh-ws-music-roll-key',
                'data-black': name.includes('#') || undefined,
                'data-c': name.startsWith('C') || undefined,
                'data-compact': keyLabelsVisible ? undefined : '',
                key: midi,
                onClick: () => onAudition?.(midi),
                style: { fontSize: `${Math.min(10, Math.max(6, rowHeight * 0.55))}px`, height: `${rowHeight}px`, lineHeight: `${rowHeight}px` },
                title: translate('music.roll.audition', { note: name }),
                type: 'button',
              }, keyLabelsVisible ? name : '')
            })),
            h('div', {
              className: 'dsh-ws-music-roll-canvas',
              onPointerCancel: endPaint,
              onPointerDown: startPaint,
              onPointerMove: movePaint,
              onPointerUp: endPaint,
              ref: gridRef,
              style: { height: `${viewHeight === null ? canvasHeight : Math.max(canvasHeight, viewHeight - RULER_HEIGHT)}px` },
            },
            h('div', { className: 'dsh-ws-music-roll-rows', 'aria-hidden': true }, Array.from({ length: rows }, (_, index) => {
              const midi = high - index
              return h('div', {
                'data-black': midiName(midi).includes('#') || undefined,
                key: midi,
                style: { height: `${rowHeight}px`, top: `${index * rowHeight}px` },
              })
            })),
            h('div', { className: 'dsh-ws-music-roll-bars', 'aria-hidden': true }, barLabels.map(bar => h('div', {
              className: 'dsh-ws-music-roll-bar',
              key: bar,
              style: { left: `${((bar - 1) / bars) * 100}%`, width: `${100 / bars}%` },
            }))),
            track.notes.map((note, index) => {
              const isDragging = drag !== null && drag.index === index
              const shown = isDragging ? drag.note : note
              const selectedNow = selectedIndex === index
              const left = (((shown.bar - 1) * 16 + shown.step) / totalSteps) * 100
              const width = (shown.len / totalSteps) * 100
              const top = (rows - 1 - (shown.midi - low)) * rowHeight
              return h('div', {
                className: 'dsh-ws-music-note',
                'data-selected': selectedNow || undefined,
                key: `${index}:${note.bar}:${note.step}:${note.midi}`,
                onClick: () => onSelect(index),
                onPointerCancel: endDrag,
                onPointerDown: event => startDrag(event, index, note, 'move'),
                onPointerMove: moveDrag,
                onPointerUp: endDrag,
                style: { height: `${Math.max(6, rowHeight - 2)}px`, left: `${left}%`, top: `${top}px`, width: `calc(${width}% - 1px)` },
                title: `${noteTitle(note)} · ${noteValueLabel(note.len)}`,
              },
              h('span', { 'aria-hidden': true, className: 'dsh-ws-music-note-resize', onPointerDown: event => startDrag(event, index, note, 'resize') }))
            }),
            h('div', { 'aria-hidden': true, className: 'dsh-ws-music-roll-playhead', style: { left: `${clamp(playhead, 0, 1) * 100}%` } }),
            track.notes.length === 0 ? h('span', { className: 'dsh-ws-music-roll-empty' }, translate('music.roll.empty')) : null),
          ),
        ),
      ),
      h('div', { className: 'dsh-ws-music-roll-zoom-y', title: translate('music.roll.zoomY') },
        h('div', { className: 'dsh-ws-music-roll-zoom-track', ref: zoomTrackRef },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-music-roll-zoom-line' }),
          h('span', { 'aria-hidden': true, className: 'dsh-ws-music-roll-zoom-thumb', style: { top: `${thumbTop}px` } }),
          h('input', {
            'aria-label': translate('music.roll.zoomY'),
            'aria-orientation': 'vertical',
            className: 'dsh-ws-music-roll-zoom-slider',
            max: Math.round(MUSIC_ZOOM_MAX * 100),
            min: Math.round(MUSIC_ZOOM_MIN * 100),
            onChange: event => setZoomY(Number(event.target.value) / 100),
            step: 5,
            style: { width: `${zoomTrackHeight}px` },
            type: 'range',
            value: Math.round(scaleY * 100),
          })),
        h('b', null, `${Math.round(scaleY * 100)}%`))),
    h('div', {
      'aria-label': translate('music.roll.resize'),
      'aria-orientation': 'horizontal',
      className: 'dsh-ws-music-roll-resize',
      onDoubleClick: () => onHeight(null),
      onKeyDown: resizeKey,
      onPointerCancel: endResize,
      onPointerDown: startResize,
      onPointerMove: moveResize,
      onPointerUp: endResize,
      role: 'separator',
      tabIndex: 0,
      title: translate('music.roll.resizeTitle'),
    }),
    h('div', { className: 'dsh-ws-music-roll-bottom' },
      h('label', { className: 'dsh-ws-music-roll-zoom-x', title: translate('music.roll.zoomX') },
        h('div', { className: 'dsh-ws-music-roll-zoom-x-track' },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-music-roll-zoom-x-line' }),
          h('span', { 'aria-hidden': true, className: 'dsh-ws-music-roll-zoom-x-thumb', style: { left: thumbLeft } }),
          h('input', {
            'aria-label': translate('music.roll.zoomX'),
            className: 'dsh-ws-music-roll-zoom-x-slider',
            max: Math.round(MUSIC_ZOOM_MAX * 100),
            min: Math.round(MUSIC_ZOOM_MIN * 100),
            onChange: event => setZoomX(Number(event.target.value) / 100),
            step: 5,
            type: 'range',
            value: Math.round(scaleX * 100),
          })),
        h('b', null, `${Math.round(scaleX * 100)}%`))),
  )
}

