/* The chat's per-session model selection, read-only.
 *
 * `ui-model-selection` owns one ModelDirectory per session (`ctx.modelDirectories`), and
 * the composer's model seat writes into that same directory. Reading its snapshot is
 * therefore the exact "what model is the right-hand chat using" answer, and switching the
 * model in the composer updates every subscriber live.
 *
 * The service is resolved lazily and optionally: a harness build without ui-model-selection
 * (or a subagent session without a binding) degrades to "unknown route" — the music panel
 * still sends follow-session to the Host, which resolves the route itself.
 */
import { useMemo, useSyncExternalStore } from 'react'

let resolver = null
let epoch = 0
const epochListeners = new Set()

function bumpEpoch() {
  epoch += 1
  for (const listener of [...epochListeners]) listener()
}

/**
 * Install the model-directory resolver (or clear it on teardown).
 * @param service - `ctx.modelDirectories`; anything without `directoryFor` counts as absent.
 * @returns a disposer that only clears the resolver if it is still this one.
 */
export function installChatModelService(service) {
  const installed = service !== null && service !== undefined && typeof service.directoryFor === 'function' ? service : null
  resolver = installed
  bumpEpoch()
  return () => {
    if (resolver !== installed) return
    resolver = null
    bumpEpoch()
  }
}

function subscribeEpoch(listener) {
  epochListeners.add(listener)
  return () => epochListeners.delete(listener)
}

function storeFor(sessionId) {
  if (resolver === null || typeof sessionId !== 'string' || sessionId === '') return null
  try {
    const directory = resolver.directoryFor(sessionId)
    return directory === null || directory === undefined || directory.store === undefined ? null : directory.store
  } catch {
    /* an addressed subagent session, or a session without a binding: no chat model route */
    return null
  }
}

/**
 * Live chat model of one session, or null when it cannot be resolved.
 * @param sessionId - the chat session shown in the right column.
 * @returns `{ provider, model }` or null.
 */
export function useChatModel(sessionId) {
  const currentEpoch = useSyncExternalStore(subscribeEpoch, () => epoch, () => 0)
  const store = useMemo(() => storeFor(sessionId), [sessionId, currentEpoch])
  const snapshot = useSyncExternalStore(
    (listener) => (store === null ? () => {} : store.subscribe(listener)),
    () => (store === null ? null : store.getSnapshot()),
    () => null,
  )
  const selected = snapshot === null || snapshot === undefined ? null : (snapshot.pending ?? snapshot.current)
  if (selected === null || selected === undefined) return null
  if (typeof selected.provider !== 'string' || selected.provider === '') return null
  if (typeof selected.model !== 'string' || selected.model === '') return null
  return { provider: selected.provider, model: selected.model }
}

