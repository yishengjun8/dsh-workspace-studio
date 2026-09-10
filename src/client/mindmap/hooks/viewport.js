/** Mind-map viewport interaction: grab-pan, cursor-anchored wheel zoom and
 *  fit-to-view. The transform is applied straight to the canvas (not React
 *  state); viewRef is the single source of truth. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MINDMAP_WHEEL_STEP, MINDMAP_ZOOM_MAX, MINDMAP_ZOOM_MIN } from '../../constants.js'
import { mindmapClampView, mindmapFitView } from '../helpers.js'

export function useMindmapViewport({ layoutRef }) {
  const [dragging, setDragging] = useState(false)
  /* The viewport element mounts only once the map is ready, so the wheel
     listener must attach when it appears; a layout effect mirrors its presence
     into state. */
  const [viewportMounted, setViewportMounted] = useState(false)
  const viewportRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef({ tx: 0, ty: 0, zoom: 1 })
  const dragRef = useRef(null)
  const pendingViewRef = useRef(null)
  const rafRef = useRef(0)
  const fittedRef = useRef(false)
  /* Grab-pan on blank area + cursor-anchored wheel zoom; the transform is
     applied straight to the canvas (not React state) so interaction stays at
     frame rate. */
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
  }, [updateView, viewportSize])  /* Replay the transform after every render so a doc-driven re-render
     re-applies the current view. */
  useLayoutEffect(() => {
    applyViewTransform()
  })
  /* Mirror the viewport element's presence into state so the wheel effect
     re-runs the moment it appears. */
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

  /* Reset on family switch: drop the fitted flag, zero the transform, and
     cancel any queued rAF frame so the new map fits on load. */
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
     user's view (restore-view refits at any time). */
  const refitIfUnfitted = useCallback(() => {
    if (fittedRef.current) return
    const { vw, vh } = viewportSize()
    const fit = mindmapFitView(layoutRef.current.width, layoutRef.current.height, vw, vh)
    if (fit !== null) { fittedRef.current = true; updateView(fit) }
  }, [layoutRef, updateView, viewportSize])
  /* Visibility-aware fit: a ResizeObserver refits once the element gains a
     real size, since a hidden container measures 0 and the initial fit can
     never land. */
  useEffect(() => {
    const el = viewportRef.current
    if (el === null || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => { refitIfUnfitted() })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [refitIfUnfitted, viewportMounted])
  return { viewportRef, canvasRef, dragging, restoreView, startPan, movePan, endPan, resetView, refitIfUnfitted }
}
