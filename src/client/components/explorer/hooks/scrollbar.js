/** Preview tab strip: custom floating scrollbar + scroll-into-view targeting.
 * Pure refs/DOM; the only state is the pin token that requests a scroll pass. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export function usePreviewScrollbar({ previewTabsRef, previewScrollbarRef, previewScrollThumbRef, activePath, tabsLength }) {
  const [pinScrollToken, setPinScrollToken] = useState(0)
  const tabScrollPathRef = useRef(null)
  const tabsHoveredRef = useRef(false)
  const scrollbarHoveredRef = useRef(false)
  const scrollbarDragRef = useRef(null)
    const scrollTabIntoView = useCallback((path) => {
    tabScrollPathRef.current = path
    setPinScrollToken(value => value + 1)
  }, [])
    const syncPreviewScrollbar = useCallback(() => {
    const strip = previewTabsRef.current
    const track = previewScrollbarRef.current
    const thumb = previewScrollThumbRef.current
    if (strip === null || track === null || thumb === null) return
    const canScroll = strip.scrollWidth > strip.clientWidth + 1
    const visible = canScroll && (tabsHoveredRef.current || scrollbarHoveredRef.current || scrollbarDragRef.current !== null)
    track.dataset.visible = visible ? 'true' : 'false'
    if (!canScroll) return
    const trackWidth = track.clientWidth
    const thumbWidth = Math.max(24, Math.round((trackWidth * strip.clientWidth) / strip.scrollWidth))
    thumb.style.width = `${thumbWidth}px`
    const maxScroll = strip.scrollWidth - strip.clientWidth
    const maxThumb = trackWidth - thumbWidth
    thumb.style.transform = maxScroll > 0 ? `translateX(${(strip.scrollLeft / maxScroll) * maxThumb}px)` : 'translateX(0px)'
  }, [])
  const handleTabsMouseEnter = useCallback(() => {
    tabsHoveredRef.current = true
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleTabsMouseLeave = useCallback(() => {
    tabsHoveredRef.current = false
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleTabsScroll = useCallback(() => { syncPreviewScrollbar() }, [syncPreviewScrollbar])
  const handleScrollbarMouseEnter = useCallback(() => {
    scrollbarHoveredRef.current = true
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarMouseLeave = useCallback(() => {
    scrollbarHoveredRef.current = false
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarPointerDown = useCallback((event) => {
    const strip = previewTabsRef.current
    const track = previewScrollbarRef.current
    if (strip === null || track === null || strip.scrollWidth <= strip.clientWidth + 1) return
    event.preventDefault()
    scrollbarDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: strip.scrollLeft }
    try { track.setPointerCapture(event.pointerId) } catch { /* already released */ }
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarPointerMove = useCallback((event) => {
    const drag = scrollbarDragRef.current
    const strip = previewTabsRef.current
    const track = previewScrollbarRef.current
    if (drag === null || strip === null || track === null) return
    const trackWidth = track.clientWidth
    const thumbWidth = Math.max(24, Math.round((trackWidth * strip.clientWidth) / strip.scrollWidth))
    const maxScroll = strip.scrollWidth - strip.clientWidth
    const maxThumb = trackWidth - thumbWidth
    if (maxScroll <= 0 || maxThumb <= 0) return
    strip.scrollLeft = drag.startScrollLeft + ((event.clientX - drag.startX) * maxScroll) / maxThumb
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  const handleScrollbarPointerEnd = useCallback((event) => {
    if (scrollbarDragRef.current === null) return
    const track = previewScrollbarRef.current
    if (track !== null && event.pointerId !== undefined) {
      try { if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    }
    scrollbarDragRef.current = null
    syncPreviewScrollbar()
  }, [syncPreviewScrollbar])
  // Refresh the scrollbar on strip resize (panel width) and after every render (tab add/close, pin reorder).
  useEffect(() => {
    const strip = previewTabsRef.current
    if (strip === null) return undefined
    if (typeof ResizeObserver !== 'function') {
      const frame = requestAnimationFrame(syncPreviewScrollbar)
      return () => cancelAnimationFrame(frame)
    }
    const observer = new ResizeObserver(() => { syncPreviewScrollbar() })
    observer.observe(strip)
    syncPreviewScrollbar()
    return () => { observer.disconnect() }
  }, [syncPreviewScrollbar, tabsLength])
  useEffect(() => {
    const frame = requestAnimationFrame(syncPreviewScrollbar)
    return () => cancelAnimationFrame(frame)
  })
  // Scroll a target tab fully visible — the tab requested by pin/unpin or a preview-body
  // click, else the newly activated tab. One-shot: consume the path so later changes fall back.
  useLayoutEffect(() => {
    const strip = previewTabsRef.current
    const target = tabScrollPathRef.current ?? activePath
    if (strip === null || target === null) return
    let tabNode = null
    for (const child of strip.children) {
      if (child instanceof HTMLElement && child.classList.contains('dsh-ws-preview-tab') && child.dataset.path === target) {
        tabNode = child
        break
      }
    }
    if (tabNode === null) {
      // Tab not (yet) rendered — e.g. a pinned tab scrolled right after closing. Consume the
      // one-shot request so a later unrelated activePath change doesn't re-target the stale path.
      if (tabScrollPathRef.current === target) tabScrollPathRef.current = null
      return
    }
    const stripRect = strip.getBoundingClientRect()
    const nodeRect = tabNode.getBoundingClientRect()
    if (nodeRect.left >= stripRect.left - 1 && nodeRect.right <= stripRect.right + 1) {
      tabScrollPathRef.current = null
      return
    }
    const delta = nodeRect.left < stripRect.left
      ? nodeRect.left - stripRect.left
      : nodeRect.right - stripRect.right
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior: 'smooth' })
    tabScrollPathRef.current = null
  }, [activePath, pinScrollToken])
  // Wheel over the overflowing strip scrolls it horizontally; a native non-passive listener
  // is required so the default (page) scroll can be prevented.
  useEffect(() => {
    const strip = previewTabsRef.current
    if (strip === null) return undefined
    const onWheel = (event) => {
      const max = strip.scrollWidth - strip.clientWidth
      if (max <= 0) return
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      strip.scrollLeft = Math.min(Math.max(0, strip.scrollLeft + delta), max)
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => { strip.removeEventListener('wheel', onWheel) }
  }, [tabsLength])
  return {
    scrollTabIntoView,
    handleTabsMouseEnter, handleTabsMouseLeave, handleTabsScroll,
    handleScrollbarMouseEnter, handleScrollbarMouseLeave,
    handleScrollbarPointerDown, handleScrollbarPointerMove, handleScrollbarPointerEnd,
  }
}
