/* The music workshop's contribution to an outgoing chat prompt.
 *
 * An open workshop tab publishes a compact <music_piece> envelope for its session; the send
 * seam in controllers.js prepends it (after any editor envelope) and context-bridge folds it
 * into the same one-line summary chip the file envelopes use. The input dock reads the same
 * entry for its pill, so what rides the next prompt is visible before sending and can be
 * switched off with one click.
 *
 * Module memory on purpose: an envelope describes a live page, so it must not outlive a reload.
 *
 * The pill's on/off choice is the user's, so it lives in context-switches.js (per session,
 * persisted): switching sessions remounts the whole preview area and a reload restores the
 * workshop tab, so a choice kept only in the entry would silently switch back on.
 */
import { isContextSwitchOff, pruneContextSwitches, setContextSwitchOff } from './context-switches.js'

const entries = new Map()
const listeners = new Set()

export const MUSIC_PIECE_PREFIX = '<music_piece'
const ABSENT = Object.freeze({ present: false, active: false, envelope: '' })

/* Each publish replaces the snapshot object: useSyncExternalStore compares identities, so a
   stable per-entry snapshot keeps the dock row from re-rendering on every read. */
const snapshotOf = (envelope, active) => ({ present: true, active, envelope })
const emit = () => {
  for (const listener of listeners) listener()
}

/** Publish (or replace) this tab's envelope. `owner` keeps a stale tab from clearing a newer one. */
export function setMusicChatContext(sessionId, owner, envelope) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  if (typeof envelope !== 'string' || envelope === '') {
    if (entries.delete(sessionId)) emit()
    return
  }
  const previous = entries.get(sessionId)
  /* The user's on/off choice is theirs: a re-publish (every score edit does one, and a remount
     does a fresh one) keeps it, and a reload re-reads it from storage. */
  const active = !isContextSwitchOff('music', sessionId)
  if (previous !== undefined && previous.envelope === envelope && previous.owner === owner && previous.active === active) return
  entries.set(sessionId, { owner, envelope, active, snapshot: snapshotOf(envelope, active) })
  emit()
}

/** Drop the envelope on unmount / when collaboration turns off. */
export function clearMusicChatContext(sessionId, owner) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  if (owner !== undefined && entry.owner !== owner) return
  entries.delete(sessionId)
  emit()
}

/** The dock pill's click: carry the score on the next prompt, or leave it out. */
export function toggleMusicChatContext(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  const active = entry.active !== true
  setContextSwitchOff('music', sessionId, !active)
  entries.set(sessionId, { ...entry, active, snapshot: snapshotOf(entry.envelope, active) })
  emit()
}

/** Forget the choice of sessions that no longer exist (the shared liveness prune; memory only). */
export function retainMusicChatContext(sessionIds) {
  pruneContextSwitches('music', sessionIds)
}

/** The envelope the next prompt should carry, or null when the row is switched off / absent. */
export function musicChatEnvelope(sessionId) {
  const entry = entries.get(sessionId)
  return entry === undefined || entry.active !== true ? null : entry.envelope
}

/** What the dock row renders: presence, the on/off state, and the envelope text to label. */
export function musicContextSnapshot(sessionId) {
  const entry = entries.get(sessionId)
  return entry === undefined ? ABSENT : entry.snapshot
}

/** Module-level subscribe: useSyncExternalStore compares the function by identity. */
export function subscribeMusicContext(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
