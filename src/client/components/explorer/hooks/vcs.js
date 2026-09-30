import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchVcsStatus } from '../../../api.js'
import { buildVcsOverlay, reportVcsHostEnabled } from '../../../vcs.js'
import { VCS_REFRESH_DEBOUNCE_MS, VCS_STATUS_POLL_MS } from '../../../constants.js'

/**
 * Working-copy status (git / svn) of the mounted workspace, shared by the status bar,
 * the tree badges and the changes list.
 *
 * One request per trigger, deduplicated through an AbortController; a failure keeps the
 * last good payload on screen (the bar reports the failure) so badges never flicker away.
 * Polling is skipped while the browser tab is hidden or the file-browsing pane is not laid
 * out — the tree lives in the sidebar's files region, which is `display:none` outside the
 * files view, and a status command must not be spawned for a pane nobody is looking at.
 *
 * @param options - `{ workspaceId, enabled, autoRefresh, includeIgnored, isPaneVisible }`.
 * @returns `{ payload, overlay, error, loading, refresh, refreshSoon }`.
 */
export function useVcsStatus({ workspaceId, enabled, autoRefresh, includeIgnored, isPaneVisible }) {
  const [payload, setPayload] = useState(undefined)
  const [error, setError] = useState(undefined)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(undefined)
  const timerRef = useRef(undefined)
  const mountedRef = useRef(true)
  const requestSeqRef = useRef(0)
  /* Live mirror of the options so the request callback can stay identity-stable. */
  const optionsRef = useRef({})
  optionsRef.current = { enabled, includeIgnored }

  const run = useCallback(async (force) => {
    if (optionsRef.current.enabled !== true) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = requestSeqRef.current += 1
    setLoading(true)
    try {
      const next = await fetchVcsStatus(
        workspaceId,
        { includeIgnored: optionsRef.current.includeIgnored === true, refresh: force === true },
        controller.signal,
      )
      if (!mountedRef.current || seq !== requestSeqRef.current) return
      setPayload(next)
      setError(undefined)
      /* Mirror the Host's own switch so the settings page can explain a disabled feature. */
      reportVcsHostEnabled(next?.enabled !== false)
    } catch (failure) {
      /* An abort is a superseded request, not a failure: a newer one owns the state. */
      if (failure?.name === 'AbortError') return
      if (!mountedRef.current || seq !== requestSeqRef.current) return
      setError(failure)
    } finally {
      if (mountedRef.current && seq === requestSeqRef.current) setLoading(false)
    }
  }, [workspaceId])

  /** Immediate forced re-read: the header refresh action, the status chip and the toggles. */
  const refresh = useCallback(() => { void run(true) }, [run])
  /** Coalesced forced re-read for a save / mutation burst. */
  const refreshSoon = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      void run(true)
    }, VCS_REFRESH_DEBOUNCE_MS)
  }, [run])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (enabled !== true) {
      /* Turning the feature off must also drop what is on screen, not just stop asking. */
      requestSeqRef.current += 1
      abortRef.current?.abort()
      setPayload(undefined)
      setError(undefined)
      setLoading(false)
      return
    }
    void run(false)
  }, [enabled, includeIgnored, run, workspaceId])

  useEffect(() => {
    if (enabled !== true || autoRefresh !== true) return undefined
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (isPaneVisible?.() === false) return
      void run(false)
    }, VCS_STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [autoRefresh, enabled, isPaneVisible, run])

  const overlay = useMemo(() => buildVcsOverlay(payload), [payload])
  return { payload, overlay, error, loading, refresh, refreshSoon }
}
