/* One Remote bytes read behind a renderer view, with a bounded blob-URL cache.
 *
 * The image and PDF/Office views had the same skeleton twice (abort controller, `result.ok`, blob URL,
 * revoke on cleanup) and — because they revoked unconditionally — they re-transferred the WHOLE file
 * every time the tab remounted (switching away and back, or any explorer remount). This hook owns that
 * skeleton once and keeps the object URL alive across remounts.
 *
 * Freshness contract: the cache key carries `readEpoch`, the explorer's "this file was re-read" counter.
 * A tab switch does NOT bump it (the file is unchanged), so the cached URL is exactly as fresh as a
 * re-read would be; an explicit reload does bump it, which sidesteps the cache. `retry` is part of the
 * key too, so the manual retry button always performs a real read.
 *
 * The cache is bounded by BOTH entry count and total bytes: a single PDF or image can be far larger
 * than a text preview, so an entry-count-only bound could hold hundreds of megabytes.
 */
import { useEffect, useState } from 'react'

const CACHE_MAX_ENTRIES = 8
const CACHE_MAX_BYTES = 32 * 1024 * 1024

/* key -> { url, bytes, extra }; insertion order is the eviction order (a hit re-inserts). */
const cache = new Map()

function cacheKey(scope, sessionId, path, readEpoch, retry) {
  return `${scope}\u0000${sessionId}\u0000${path}\u0000${readEpoch}\u0000${retry}`
}

function revoke(url) {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

function remember(key, entry) {
  /* A hit that was already cached keeps one URL: drop the previous entry for this key first. */
  const previous = cache.get(key)
  if (previous !== undefined) revoke(previous.url)
  cache.set(key, entry)
  let bytes = 0
  for (const value of cache.values()) bytes += value.bytes
  while (cache.size > 1 && (cache.size > CACHE_MAX_ENTRIES || bytes > CACHE_MAX_BYTES)) {
    const oldestKey = cache.keys().next().value
    const oldest = cache.get(oldestKey)
    cache.delete(oldestKey)
    bytes -= oldest.bytes
    revoke(oldest.url)
  }
}

/**
 * Read one file's bytes through a Remote face.
 *
 * @param options.scope - cache namespace ('image' | 'pdf' | 'office').
 * @param options.read - the Remote call, or undefined while the face is not installed.
 * @param options.sessionId - owning session.
 * @param options.path - workspace-relative path or a Remote-addressable absolute path.
 * @param options.mime - blob type (the Remote always answers native bytes).
 * @param options.readEpoch - the explorer's re-read counter.
 * @param options.retry - nonce; a change forces a real read.
 * @param options.decorate - maps a successful result to extra view state (e.g. missing fonts); it is
 *   cached with the URL so a cache hit restores it too.
 * @returns `{ url, failure, extra }` — `failure.unavailable` means "no Remote face installed".
 */
export function useRemoteBytes({ scope, read, sessionId, path, mime, readEpoch, retry = 0, decorate }) {
  const [state, setState] = useState({ url: undefined, failure: undefined, extra: undefined })
  useEffect(() => {
    if (typeof read !== 'function' || sessionId === undefined || sessionId === null) {
      setState({ url: undefined, failure: { unavailable: true }, extra: undefined })
      return undefined
    }
    const key = cacheKey(scope, String(sessionId), path, readEpoch, retry)
    const hit = cache.get(key)
    if (hit !== undefined) {
      /* Re-insert to mark it most-recently-used: an actively viewed tab is never the eviction victim. */
      remember(key, hit)
      setState({ url: hit.url, failure: undefined, extra: hit.extra })
      return undefined
    }
    const controller = new AbortController()
    setState({ url: undefined, failure: undefined, extra: undefined })
    Promise.resolve()
      .then(() => read(String(sessionId), path, controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setState({ url: undefined, failure: result.error, extra: undefined })
          return
        }
        const bytes = result.value?.data
        const extra = decorate === undefined ? undefined : decorate(result.value)
        let url
        try {
          url = URL.createObjectURL(new Blob([bytes], { type: mime }))
        } catch (error) {
          setState({
            url: undefined,
            failure: { code: 'renderer-remote-failed', message: error instanceof Error ? error.message : String(error) },
            extra: undefined,
          })
          return
        }
        remember(key, { url, bytes: Number(bytes?.byteLength) || 0, extra })
        setState({ url, failure: undefined, extra })
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setState({
          url: undefined,
          failure: { code: 'renderer-remote-failed', message: error instanceof Error ? error.message : String(error) },
          extra: undefined,
        })
      })
    /* The URL is deliberately NOT revoked here: it lives in the cache until eviction, which is what
       makes a remount a cache hit instead of a full re-transfer. */
    return () => controller.abort()
  }, [decorate, mime, path, read, readEpoch, retry, scope, sessionId])
  return state
}
