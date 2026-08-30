/** Mind-map viewport interaction: grab-pan, cursor-anchored wheel zoom and
 *  fit-to-view. The transform is applied straight to the canvas element (NOT
 *  React state): pan/zoom never re-render the map; viewRef is the single source
 *  of truth. layout is read lazily through layoutRef (the component keeps the
 *  memoized layout calculation and re-syncs the ref every render). */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MINDMAP_WHEEL_STEP, MINDMAP_ZOOM_MAX, MINDMAP_ZOOM_MIN } from '../../constants.js'
import { mindmapClampView, mindmapFitView } from '../helpers.js'

export function useMindmapViewport({ layoutRef }) {
  const [dragging, setDragging] = useState(false)
  /* The viewport element only mounts once the map is ready (the component
     renders a status placeholder while loading/empty), so the wheel listener
     must attach when the element APPEARS, not just on hook mount. A layout
     effect mirrors the element's presence into state; the wheel effect depends
     on it and re-runs when the element shows up. A plain mount-only effect
     would see null on its first run and never re-run, so the listener would
     never attach. */
  const [viewportMounted, setViewportMounted] = useState(false)
  const viewportRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef({ tx: 0, ty: 0, zoom: 1 })
  const dragRef = useRef(null)
  const pendingViewRef = useRef(null)
  const rafRef = useRef(0)
  const fittedRef = useRef(false)
  /* Viewport interaction: grab-pan on blank area + cursor-anchored wheel zoom.
     The transform is applied straight to the canvas element (NOT React state):
     a direct style write keeps interaction at frame rate while React only
     re-renders when the DOC changes; viewRef is the single source of truth. */
  const applyViewTransform = useCallback(() => {
    const el = canvasRef.current
    if (el === null) return
    const cur = viewRef.current
    el.style.transform = `translate(${cur.tx}px, ${cur.ty}px) scale(${cur.zoom})`
  }, [])
  const updateView = useCallback((next) => {
    viewRef.current = next
    applyViewTransform()
  }, [applyViewTransform])
  const scheduleView = useCallback((next) => {
    pendingViewRef.current = next
    if (rafRef.current !== 0) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      const pending = pendingViewRef.current
      pendingViewRef.current = null
      if (pending !== null) updateView(pending)
    })
  }, [updateView])
  const viewportSize = useCallback(() => {
    const el = viewportRef.current
    return el === null ? { vw: 0, vh: 0 } : { vw: el.clientWidth, vh: el.clientHeight }
  }, [])
  const restoreView = useCallback(() => {
    const { vw, vh } = viewportSize()
    const fit = mindmapFitView(layoutRef.current.width, layoutRef.current.height, vw, vh)
    if (fit !== null) updateView(fit)
  }, [updateView, viewportSize])  /* Replay the transform after every render: owned by the DOM, not React state,
     so a doc-driven re-render re-applies the current view instead of leaving
     the canvas stale. */
  useLayoutEffect(() => {
    applyViewTransform()
  })
  /* Mirror the viewport element's presence into state after every render
     (setState bails out when unchanged): the wheel effect below re-runs the
     moment the element appears, attaching the native listener. */
  useLayoutEffect(() => {
    setViewportMounted(viewportRef.current !== null)
  })
  /* Wheel zoom anchored at the cursor. React attaches wheel as passive at the
     root, so preventDefault requires a native non-passive listener. */
  useEffect(() => {
    const el = viewportRef.current
    if (el === null) return
    const onWheel = (event) => {
      event.preventDefault()
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      const rect = el.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      const cur = viewRef.current
      const factor = Math.exp(-dy * MINDMAP_WHEEL_STEP)
      const zoom = Math.max(MINDMAP_ZOOM_MIN, Math.min(cur.zoom * factor, MINDMAP_ZOOM_MAX))
      const next = mindmapClampView({
        zoom,
        tx: cx - (cx - cur.tx) * (zoom / cur.zoom),
        ty: cy - (cy - cur.ty) * (zoom / cur.zoom),
      }, layoutRef.current.width, layoutRef.current.height, el.clientWidth, el.clientHeight)
      updateView(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [updateView, viewportMounted])
  /* Drop any pending rAF frame on unmount. */
  useEffect(() => () => {
    if (rafRef.current !== 0) { window.cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
  }, [])
  /* Grab-pan: only a press on the viewport/canvas background (not a node)
     starts a drag; pointer capture keeps tracking outside the element. */
  const startPan = useCallback((event) => {
    if (event.button !== 0) return
    const target = event.target
    if (target !== viewportRef.current && target !== canvasRef.current) return
    event.preventDefault()
    const cur = viewRef.current
    dragRef.current = { startX: event.clientX, startY: event.clientY, tx: cur.tx, ty: cur.ty }
    setDragging(true)
    const el = viewportRef.current
    if (el !== null && typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(event.pointerId) } catch { /* already released */ }
    }
  }, [])
  const movePan = useCallback((event) => {
    const drag = dragRef.current
    if (drag === null) return
    const { vw, vh } = viewportSize()
    scheduleView(mindmapClampView({
      ...viewRef.current,
      tx: drag.tx + (event.clientX - drag.startX),
      ty: drag.ty + (event.clientY - drag.startY),
    }, layoutRef.current.width, layoutRef.current.height, vw, vh))
  }, [scheduleView, viewportSize])
  const endPan = useCallback((event) => {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragging(false)
    const el = viewportRef.current
    if (el !== null && typeof el.releasePointerCapture === 'function') {
      try { el.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
    }
  }, [])

  /* Reset on family switch: drop the fitted flag and zero the transform so the
     new map fits on load instead of inheriting the old pan/zoom. Also cancel
     any queued rAF frame: a pan/zoom scheduled just before the switch would
     otherwise apply the OLD map's transform to the new canvas on the next
     frame (visible when both maps happen to share the same size). */
  const resetView = useCallback(() => {
    fittedRef.current = false
    viewRef.current = { tx: 0, ty: 0, zoom: 1 }
    pendingViewRef.current = null
    if (rafRef.current !== 0) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])
  /* Fit once when the map first becomes visible; later layout growth keeps the
     user's view (还原视图 restores the fit at any time). The component re-arms
     this on layout size changes (useLayoutEffect over [layout.height, width]). */
  const refitIfUnfitted = useCallback(() => {
    if (fittedRef.current) return
    const { vw, vh } = viewportSize()
    const fit = mindmapFitView(layoutRef.current.width, layoutRef.current.height, vw, vh)
    if (fit !== null) { fittedRef.current = true; updateView(fit) }
  }, [layoutRef, updateView, viewportSize])
  return { viewportRef, canvasRef, dragging, restoreView, startPan, movePan, endPan, resetView, refitIfUnfitted }
}
