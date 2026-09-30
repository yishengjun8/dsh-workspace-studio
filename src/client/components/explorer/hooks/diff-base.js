import { useEffect, useRef, useState } from 'react'
import { fetchVcsBase } from '../../../api.js'

/**
 * Base revision (HEAD / SVN BASE) of the file shown in the editor, fetched once per path + encoding.
 *
 * The editor diffs this text against its LIVE buffer, so the request is per file rather than per
 * keystroke; `epoch` lets the caller invalidate it (the header refresh, a commit or a branch switch
 * seen in the status payload). A failed read is reported as `error` and the gutter degrades to
 * "not computed" — never to a wrong set of marks.
 *
 * @param options - `{ workspaceId, path, encoding, enabled, epoch }`.
 * @returns `{ status: 'idle' | 'loading' | 'ready' | 'error', payload, message }`, where a `ready`
 *          payload keeps its `exists: false, reason` degradation for the caller to render.
 */
export function useDiffBase({ workspaceId, path, encoding, enabled, epoch }) {
  const [state, setState] = useState({ status: 'idle' })
  const seqRef = useRef(0)
  useEffect(() => {
    if (enabled !== true || typeof path !== 'string' || path === '') {
      seqRef.current += 1
      setState({ status: 'idle' })
      return undefined
    }
    const controller = new AbortController()
    const seq = seqRef.current += 1
    /* Keep the previous payload on screen while refetching (a tab switch back and forth must not
       blink the marks away); only a first load shows the loading state. */
    setState(current => (current.status === 'ready' ? { ...current, loading: true } : { status: 'loading' }))
    fetchVcsBase(workspaceId, path, encoding, controller.signal).then(payload => {
      if (seq !== seqRef.current) return
      setState({ status: 'ready', payload })
    }).catch(error => {
      if (error?.name === 'AbortError') return
      if (seq !== seqRef.current) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { controller.abort() }
  }, [enabled, encoding, epoch, path, workspaceId])
  return state
}
