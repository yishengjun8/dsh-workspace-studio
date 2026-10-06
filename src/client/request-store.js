/* One pending-request slot, shared by every chat → explorer bridge.
 *
 * Each bridge (a file open, a plan open, a change review, a mind-map dock) publishes at most one
 * ADDRESSED request, and the explorer that owns the addressed session consumes it. Four copies had
 * to keep the same four invariants in step — an immutable snapshot React can compare, a monotonic
 * seq that makes every publish a new value, an address match before adoption, and a consume that
 * publishes only while a request is pending — so they live here once.
 *
 * The address travels INSIDE the snapshot (`key`), never in the store object: every bridge exports
 * `{ ...store, open(...) }`, and a spread copy is a different object, so an address attached to the
 * object (a WeakMap keyed by the store) is lost by the copy. That is not hypothetical — it shipped:
 * the consumer read `key` off an unregistered object, got undefined, matched nothing, and every
 * click on a plan, a change review, a chat file link and a mind-map entry was silently swallowed.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * Create one pending-request store: a slot holding at most one addressed request.
 * @returns the store: subscribe / getSnapshot / request / consume.
 */
export function createRequestStore() {
  /* The snapshot is REPLACED on every publish, never mutated: useSyncExternalStore compares by
     identity, and the seq makes each publish distinct even when the value is unchanged. */
  let snapshot = { seq: 0, key: null, value: null }
  const listeners = new Set()
  /* Every method closes over the state instead of reading `this`: React invokes subscribe /
     getSnapshot as bare references, where a `this`-based accessor reads `this` as undefined (the
     trap mindmap/registry.js documents). */
  const store = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() { return snapshot },
    /* Publish one request to every subscriber, replacing a pending one: the newest is the one the
       user last asked for. `key` is the address its consumer matches (a session id or a workspace
       id) and is normalized HERE, so no bridge can make its own request unmatchable with a number. */
    request(key, value) {
      snapshot = { seq: snapshot.seq + 1, key: key === undefined || key === null ? null : String(key), value }
      for (const listener of [...listeners]) listener()
    },
    /* Clear the pending request; a consume with nothing pending publishes nothing, so a redundant call never wakes a subscriber. */
    consume() {
      if (snapshot.value === null) return
      snapshot = { seq: snapshot.seq + 1, key: null, value: null }
      for (const listener of [...listeners]) listener()
    },
  }
  return store
}

/* Strict equality; the caller normalizes undefined to null exactly as the bridges did (an address is
   a session-id string, a workspace id, or null). A consumer sharing one preview strip may accept
   several addresses: an explorer in a mind map adopts the map root's or a member session's request. */
function matchesKey(snapshot, identity) {
  if (!Array.isArray(identity)) return snapshot.key === identity
  for (const accepted of identity) if (snapshot.key === accepted) return true
  return false
}

/**
 * Adopt the pending request of `store` once it is addressed to this consumer.
 *
 * The order is the whole contract: compare the address, apply, then consume —
 * and never consume a request addressed to another consumer, which must stay
 * pending for the mount it belongs to (a later mount still adopts it).
 *
 * @param store - a store from {@link createRequestStore}.
 * @param identity - the accepted address, or an array of accepted addresses.
 * @param apply - called with the adopted request's value; runs before the consume.
 */
export function usePendingRequest(store, identity, apply) {
  /* Both are held in refs so the caller may pass a fresh closure or identity array each render: the
     effect below still reads the latest render's values, without those identities driving it. */
  const applyRef = useRef(apply)
  applyRef.current = apply
  const identityRef = useRef(identity)
  identityRef.current = identity
  /* Subscribing re-renders this consumer on a publish; the effect reads the store live, so a
     publish that landed mid-commit is never skipped. */
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  /* Deliberately after EVERY commit, not only after a publish: an identity that changes while a
     request is pending — moving between one mind map's sessions keeps this explorer mounted — must
     still adopt it, exactly as the hand-written effects' previewSessionId/sessionId dependencies did. */
  useEffect(() => {
    const snapshot = store.getSnapshot()
    if (snapshot.value === null) return
    if (!matchesKey(snapshot, identityRef.current)) return
    applyRef.current(snapshot.value)
    store.consume()
  })
}
