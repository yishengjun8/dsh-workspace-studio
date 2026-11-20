import { createElement as h, useCallback, useRef, useState } from 'react'
import { PREVIEW_PANE_MIN_HEIGHT, PREVIEW_SPLIT_RATIO_MAX, PREVIEW_SPLIT_RATIO_MIN } from '../../constants.js'
import { translate } from '../../locale/index.js'

/* Height of the handle itself; the two panes split the rest of the column. */
const SPLITTER_HEIGHT = 8

/* The ratio bounds account for the pixel floor: on a short preview column a plain 18% could be
   under PREVIEW_PANE_MIN_HEIGHT, so the usable minimum rises until both panes fit. */
function ratioBounds(container) {
  const available = Math.max(1, container.getBoundingClientRect().height - SPLITTER_HEIGHT)
  const min = Math.min(0.45, Math.max(PREVIEW_SPLIT_RATIO_MIN, PREVIEW_PANE_MIN_HEIGHT / available))
  return { max: Math.max(min, 1 - min), min }
}

const clampRatio = (value, bounds) => Math.min(bounds.max, Math.max(bounds.min, value))

/* Horizontal splitter between the two preview panes. Dragging updates the pane flex sizes
   directly and commits once on release, so a 60 fps drag does not re-render the whole explorer;
   keyboard and double-click commit immediately. */
export function PaneSplitter({ onChange, ratio }) {
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)
  const splitterRef = useRef(null)

  const applyDrag = useCallback((event) => {
    const drag = dragRef.current
    const splitter = splitterRef.current
    if (drag === null || splitter === null) return
    const container = splitter.parentElement
    if (container === null) return
    const rect = container.getBoundingClientRect()
    drag.lastRatio = clampRatio((event.clientY - rect.top - SPLITTER_HEIGHT / 2) / Math.max(1, rect.height - SPLITTER_HEIGHT), drag.bounds)
    const panes = container.querySelectorAll(':scope > .dsh-ws-pane')
    if (panes.length === 2) {
      panes[0].style.flexGrow = String(drag.lastRatio)
      panes[1].style.flexGrow = String(1 - drag.lastRatio)
    }
    splitter.setAttribute('aria-valuenow', String(Math.round(drag.lastRatio * 100)))
  }, [])

  const endDrag = useCallback((event) => {
    const drag = dragRef.current
    if (drag === null) return
    dragRef.current = null
    setDragging(false)
    const splitter = splitterRef.current
    if (splitter !== null && event !== undefined && splitter.hasPointerCapture?.(event.pointerId)) {
      try { splitter.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    }
    if (drag.lastRatio !== drag.startRatio) onChange(drag.lastRatio)
  }, [onChange])

  const startDrag = useCallback((event) => {
    const splitter = splitterRef.current
    const container = splitter?.parentElement
    if (splitter === null || splitter === undefined || container === null) return
    event.preventDefault()
    try { splitter.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
    dragRef.current = {
      bounds: ratioBounds(container),
      lastRatio: ratio,
      startRatio: ratio,
    }
    setDragging(true)
  }, [ratio])

  const onKeyDown = useCallback((event) => {
    const splitter = splitterRef.current
    const container = splitter?.parentElement
    if (container === null || container === undefined) return
    const bounds = ratioBounds(container)
    const step = event.shiftKey ? 0.05 : 0.02
    let next = null
    if (event.key === 'ArrowUp') next = ratio - step
    else if (event.key === 'ArrowDown') next = ratio + step
    else if (event.key === 'PageUp') next = ratio - 0.1
    else if (event.key === 'PageDown') next = ratio + 0.1
    else if (event.key === 'Home') next = bounds.min
    else if (event.key === 'End') next = bounds.max
    else if (event.key === 'Enter' || event.key === ' ') next = 0.5
    if (next === null) return
    event.preventDefault()
    onChange(clampRatio(next, bounds))
  }, [onChange, ratio])

  return h('div', {
    'aria-label': translate('preview.split.resize'),
    'aria-orientation': 'horizontal',
    'aria-valuemax': PREVIEW_SPLIT_RATIO_MAX * 100,
    'aria-valuemin': PREVIEW_SPLIT_RATIO_MIN * 100,
    'aria-valuenow': Math.round(ratio * 100),
    className: 'dsh-ws-panes-splitter',
    'data-dragging': dragging || undefined,
    onDoubleClick: event => { event.preventDefault(); onChange(0.5) },
    onKeyDown,
    onLostPointerCapture: event => endDrag(event),
    onPointerCancel: endDrag,
    onPointerDown: startDrag,
    onPointerMove: event => { if (dragRef.current !== null) applyDrag(event) },
    onPointerUp: endDrag,
    ref: splitterRef,
    role: 'separator',
    tabIndex: 0,
  })
}
