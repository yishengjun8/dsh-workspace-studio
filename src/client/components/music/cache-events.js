/* One session's music-cache mutation event.
 *
 * Several music-workshop tabs can be mounted at once for one preview session without sharing React
 * state, so a compose/switch/delete in one tab tells the others to reload the metadata list. Only a
 * scope string is broadcast; no score document crosses the event.
 */
const CACHE_EVENT = 'dsh-ws-music-cache-changed'

export function notifyMusicCacheChanged(scope) {
  if (typeof window === 'undefined' || typeof scope !== 'string' || scope === '') return
  window.dispatchEvent(new CustomEvent(CACHE_EVENT, { detail: scope }))
}

export function subscribeMusicCacheChanged(scope, listener) {
  if (typeof window === 'undefined' || typeof scope !== 'string' || scope === '') return () => {}
  const handler = (event) => {
    if (event.detail === scope) listener()
  }
  window.addEventListener(CACHE_EVENT, handler)
  return () => window.removeEventListener(CACHE_EVENT, handler)
}
