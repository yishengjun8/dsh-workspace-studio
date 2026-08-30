/** Mind-map transient toast notices with an auto-dismiss timer. */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useMindmapNotices({ mountedRef }) {
  const [notice, setNotice] = useState(null)
  const noticeTimerRef = useRef(0)
  const showNotice = useCallback((text) => {
    // The notice render expects { error, text }; a bare string has neither, so
    // it rendered an empty div and every mind-map success toast was invisible.
    setNotice({ error: false, text })
    if (noticeTimerRef.current !== 0) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = 0
      if (mountedRef.current) setNotice(null)
    }, 3000)
  }, [])
  const showNoticeError = useCallback((text) => {
    setNotice({ error: true, text })
    if (noticeTimerRef.current !== 0) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = 0
      if (mountedRef.current) setNotice(null)
    }, 3000)
  }, [])
  useEffect(() => () => {
    if (noticeTimerRef.current !== 0) { clearTimeout(noticeTimerRef.current); noticeTimerRef.current = 0 }
  }, [])
  return { notice, showNotice, showNoticeError }
}
