/* Paged text reading for the read-only browse view: one page of lines at a time via the read Remote, appended on scroll-to-bottom; generation-guarded so a stale settlement never writes. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { remoteFaces, useRemoteFaces } from './remote.js'

export function usePagedText(sessionId, path, readEpoch) {
  const [state, setState] = useState({ text: '', eof: false, loading: false, failure: undefined })
  const generationRef = useRef(0)
  const nextOffsetRef = useRef(1)
  const controllerRef = useRef()
  const eofRef = useRef(false)
  const loadingRef = useRef(false)
  /* Re-run the reset effect when the Remote faces install, so a view mounted before the harness Remote was ready starts reading. */
  const faces = useRemoteFaces()

  const loadMore = useCallback(() => {
    if (eofRef.current || loadingRef.current) return
    const current = remoteFaces()
    if (current === undefined) {
      setState(currentState => currentState.failure === undefined
        ? { ...currentState, failure: { unavailable: true } }
        : currentState)
      return
    }
    if (sessionId === undefined || sessionId === null || path === undefined || path === null) return
    const generation = generationRef.current
    const offset = nextOffsetRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    loadingRef.current = true
    setState(currentState => ({ ...currentState, loading: true, failure: undefined }))
    void current.readPage(String(sessionId), path, offset, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== generationRef.current) return
      loadingRef.current = false
      if (!result.ok) {
        setState(currentState => ({ ...currentState, loading: false, failure: result.error }))
        return
      }
      const page = result.value
      nextOffsetRef.current = page.offset + Math.max(1, page.lines)
      eofRef.current = page.eof
      setState(currentState => ({
        text: currentState.text === '' ? page.text : `${currentState.text}\n${page.text}`,
        eof: page.eof,
        loading: false,
        failure: undefined,
      }))
    })
  }, [path, sessionId])

  /* Reset on path/session change (or Remote install), then read the first page; a read-epoch bump re-reads. */
  useEffect(() => {
    generationRef.current += 1
    nextOffsetRef.current = 1
    eofRef.current = false
    loadingRef.current = false
    controllerRef.current?.abort()
    setState({ text: '', eof: false, loading: false, failure: undefined })
    if (path === undefined || path === null || faces === undefined) return undefined
    loadMore()
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
    }
  }, [faces, loadMore, path, readEpoch, sessionId])

  return { ...state, loadMore }
}
