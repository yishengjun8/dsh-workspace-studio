/* One pending-request slot, shared by every chat → explorer bridge.
 *
 * Each bridge (a file open, a plan open, a change review, a mind-map dock)
 * publishes at most one request, and the explorer that owns the addressed
 * session consumes it. Four copies of this store had to keep the same four
 * invariants in step — an immutable snapshot React can compare, a monotonic seq
 * that makes every publish a new value, an identity match before adoption, and a
 * consume that publishes only while a request is pending — so they live here
 * once.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'

/* The request field carrying a bridge's identity (the value a consumer must
 * match before it may adopt the request). Module-private, so the factory's
 * product is exactly the four-member store contract its callers spread. */
const IDENTITY_FIELDS = new WeakMap()

/**
 * Create one pending-request store.
 * @param identityField - the name of the published request's identity field.
 * @returns the store: subscribe / getSnapshot / request / consume.
 */
export function createRequestStore(identityField) {
  /* The snapshot is REPLACED on every publish, never mutated: useSyncExternalStore
     compares snapshots by identity, and the seq makes each publish distinct even
     when the request value itself is unchanged. */
  let snapshot = { seq: 0, request: null }
  const listeners = new Set()
  /* Every method closes over the state instead of reading `this`: React invokes
     subscribe/getSnapshot as bare references, where a `this`-based accessor would
     read `this` as undefined (the trap mindmap/registry.js documents). */
  const store = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() { return snapshot },
    /* Publish one request to every subscriber, replacing a pending one: the
       newest request is the one the user last asked for. */
    request(value) {
      snapshot = { seq: snapshot.seq + 1, request: value }
      for (const listener of [...listeners]) listener()
    },
    /* Clear the pending request. A consume with nothing pending publishes
       nothing, so a redundant call never wakes a subscriber. */
    consume() {
      if (snapshot.request === null) return
      snapshot = { seq: snapshot.seq + 1, request: null }
      for (const listener of [...listeners]) listener()
    },
  }
  IDENTITY_FIELDS.set(store, identityField)
  return store
}

/* Strict equality, with the caller normalizing undefined to null exactly as the
   bridges did (an identity is a session-id string or null). A consumer sharing
   one preview strip may accept several identities: an explorer inside a mind map
   adopts a request addressed to the map root or to the member session. */
function matchesIdentity(store, request, identity) {
  const field = request[IDENTITY_FIELDS.get(store)]
  if (!Array.isArray(identity)) return field === identity
  for (const accepted of identity) if (field === accepted) return true
  return false
}

/**
 * Adopt the pending request of `store` once it is addressed to this consumer.
 *
 * The order is the whole contract: compare the identity, apply, then consume —
 * and never consume a request addressed to another consumer, which must stay
 * pending for the mount it belongs to (a later mount still adopts it).
 *
 * @param store - a store from {@link createRequestStore}.
 * @param identity - the accepted identity, or an array of accepted identities.
 * @param apply - called with the adopted request; runs before the consume.
 */
export function usePendingRequest(store, identity, apply) {
  /* Both are held in refs so the caller may pass a fresh closure or a fresh
     identity array on every render: the effect below still reads the values of
     the latest render, without those identities driving it. */
  const applyRef = useRef(apply)
  applyRef.current = apply
  const identityRef = useRef(identity)
  identityRef.current = identity
  /* Subscribing is what makes a publish re-render this consumer; the effect then
     reads the store live, so a publish that landed mid-commit is never skipped. */
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  /* Deliberately after EVERY commit, not only after a publish: an identity that
     changes while a request is pending — moving between the sessions of one mind
     map keeps this explorer mounted — must still adopt it, exactly as the
     hand-written effects' previewSessionId/sessionId dependencies did. */
  useEffect(() => {
    const { request } = store.getSnapshot()
    if (request === null) return
    if (!matchesIdentity(store, request, identityRef.current)) return
    applyRef.current(request)
    store.consume()
  })
}
