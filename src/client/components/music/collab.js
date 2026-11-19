/* Chat collaboration for the music workshop.
 *
 * The page owns the score. This module keeps the Host's mirror fresh (one registration per
 * edit, throttled), polls the single pending patch, hands it to the panel to apply as ONE
 * undoable track edit, and acks what actually happened so the model reports the truth.
 *
 * Everything here degrades visibly: an older Host without /music/collab, a session with no
 * workshop open, or a page that never answers each has a state the UI can name.
 */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../../locale/index.js'
import { ackMusicCollabPatchRequest, dropMusicCollabRequest, musicCollabPatchRequest, registerMusicCollabRequest } from '../../api.js'
import { musicBarHistogram, musicTrackFingerprint } from '../../../shared/music-edit.js'
import { clearMusicChatContext, setMusicChatContext } from '../../music-context.js'

const REGISTER_DEBOUNCE_MS = 600
const HEARTBEAT_MS = 60_000
const POLL_IDLE_MS = 1500
const POLL_AFTER_PATCH_MS = 400
const POLL_SLOW_MS = 4000
/* Above this many notes the registration carries the selected track in full and the rest as
   summaries; editing a summarised track is refused rather than silently guessed. */
const NOTES_BUDGET = 4096
const ENVELOPE_MAX = 1400

const escapeAttr = value => String(value ?? '').replace(/["<>&]/g, character => ({
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
})[character])

/**
 * The compact block the chat sees. Bounded on purpose: the notes stay behind music_read_track,
 * and a 24-track piece must not turn every prompt into a score dump.
 */
export function buildMusicChatEnvelope(doc, selectedTrack, focusBar) {
  if (doc === null || doc === undefined || !Array.isArray(doc.tracks)) return ''
  const head = `<music_piece title="${escapeAttr(doc.title)}" bars="${doc.bars}" bpm="${doc.bpm}" key="${doc.keyRoot} ${doc.keyMode}" style="${doc.prompt?.style ?? ''}" mood="${doc.prompt?.mood ?? ''}">`
  const lines = doc.tracks.map(track => (track.kind === 'drums'
    ? `${track.id}(${track.instrument}) drums ${doc.bars} bars x 6 lanes`
    : `${track.id}(${track.instrument}) ${track.notes.length} notes`))
  let trackLine = `tracks: ${lines.join(', ')}`
  const tail = ['</music_piece>']
  if (selectedTrack !== null && selectedTrack !== undefined) {
    tail.unshift(`selected: ${selectedTrack.id}${Number.isFinite(focusBar) ? ` bar ${focusBar}` : ''}`)
  }
  /* Trim the track list, never the tags: a truncated block would not parse, and an unparsed
     envelope would leak into the bubble as raw XML. */
  const room = ENVELOPE_MAX - head.length - tail.join('\n').length - 32
  if (trackLine.length > room) trackLine = `${trackLine.slice(0, Math.max(0, room))} …`
  return [head, trackLine, ...tail].join('\n')
}

/** The exact registration payload: the Host's tools see nothing else about the page. */
export function buildRegistration({ doc, focusBar, selectedTrackId, session, tab }) {
  const totalNotes = doc.tracks.reduce((sum, track) => sum + (track.kind === 'drums' ? 0 : track.notes.length), 0)
  const fullAll = totalNotes <= NOTES_BUDGET
  const tracks = doc.tracks.map(track => {
    const full = fullAll || track.id === selectedTrackId
    const base = {
      id: track.id,
      instrument: track.instrument,
      name: track.name,
      kind: track.kind,
      volume: track.volume,
      muted: track.muted,
      solo: track.solo,
      noteCount: track.kind === 'drums'
        ? musicBarHistogram(track, doc.bars).reduce((sum, value) => sum + value, 0)
        : track.notes.length,
      histogram: musicBarHistogram(track, doc.bars),
      rev: musicTrackFingerprint(track),
    }
    if (!full) return base
    return track.kind === 'drums'
      ? { ...base, drums: track.drums }
      : { ...base, notes: track.notes }
  })
  return {
    session,
    tab,
    rev: Date.now(),
    doc: {
      title: doc.title,
      bars: doc.bars,
      bpm: doc.bpm,
      keyRoot: doc.keyRoot,
      keyMode: doc.keyMode,
      style: doc.prompt?.style ?? '',
      mood: doc.prompt?.mood ?? '',
      seamless: doc.prompt?.seamless !== false,
      chordProgression: doc.chordProgression,
    },
    selected: selectedTrackId === null ? null : { trackId: selectedTrackId, bars: [focusBar, focusBar] },
    tracks,
  }
}

/**
 * Keep one workshop tab registered for its session and apply whatever the chat asks for.
 * `onApply(patch)` must return `{ result, summary? }` — the panel decides how a patch lands
 * (one history step, conflict detection, validation) because only it owns the document.
 */
export function useMusicCollab({ active, doc, focusBar, hostCollab, onApply, selectedTrackId, sessionId, tabId }) {
  const [notice, setNotice] = useState(null)
  const [state, setState] = useState('idle')
  /* True while another workshop tab of this session holds the Host slot. It is state, not only
     a ref, because the collaboration row must say who is in charge instead of failing mute. */
  const [superseded, setSuperseded] = useState(false)
  const applyRef = useRef(onApply)
  applyRef.current = onApply
  const docRef = useRef(doc)
  docRef.current = doc
  /* Registration must be able to go out from a callback — the heartbeat, a re-register after a
     Host restart, the page becoming visible again — so the live values are refs, not closure
     captures that would freeze at the render that created the callback. */
  const focusBarRef = useRef(focusBar)
  focusBarRef.current = focusBar
  const selectedRef = useRef(selectedTrackId)
  selectedRef.current = selectedTrackId
  /* True while another workshop tab of this session holds the Host slot: a poll loop must not
     steal it, or two mounted tabs would re-register against each other forever. */
  const ownedRef = useRef(false)
  /* Patch ids this tab already applied. A failed ack makes the Host re-deliver the same patch;
     re-applying it would fail the fingerprint check and report a bogus "conflict", so remember
     the outcome and just ack it again. */
  const appliedRef = useRef(new Map())
  /* Registered while the tab exists, not only while it is the visible preview tab: switching
     to a file tab must not make the chat believe the workshop closed. Visibility only slows
     the poll down. */
  const activeRef = useRef(active)
  activeRef.current = active
  const enabled = hostCollab === true && typeof sessionId === 'string' && sessionId !== ''
  const registrationOf = useCallback(() => buildRegistration({
    doc: docRef.current,
    focusBar: focusBarRef.current,
    selectedTrackId: selectedRef.current,
    session: sessionId,
    tab: tabId,
  }), [sessionId, tabId])
  const publishRegistration = useCallback(() => {
    /* A superseded tab must not steal the slot back on its next edit: the debounced
       registration, the heartbeat and the visibility handler all come through here. */
    if (ownedRef.current === true) return Promise.resolve()
    return registerMusicCollabRequest(registrationOf())
      .then(() => {
        ownedRef.current = false
        setSuperseded(false)
        setState(current => (current === 'ready' ? current : 'ready'))
      })
      .catch(error => setState(error?.status === 404 ? 'unsupported' : 'error'))
  }, [registrationOf])

  /* Registration, debounced: a drag produces dozens of doc identities, one POST is enough. */
  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setTimeout(() => { void publishRegistration() }, REGISTER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, doc, selectedTrackId, focusBar, publishRegistration])

  /* Heartbeat so an idle tab does not age out of the Host's 30-minute window. The payload is
     built when the beat fires, so a selection made since the last one is already in it. A
     hidden tab asks instead of registering: a register would steal the slot from the visible
     tab and drop a patch that tab is about to poll for. */
  useEffect(() => {
    if (!enabled) return undefined
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        musicCollabPatchRequest(sessionId, tabId)
          .then(payload => {
            if (payload?.registered === false && payload?.owned !== true) void publishRegistration()
          })
          .catch(() => {})
        return
      }
      if (ownedRef.current !== true) void publishRegistration()
    }
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    return () => window.clearInterval(timer)
  }, [enabled, sessionId, tabId, publishRegistration])

  /* Coming back to the foreground re-registers at once: a Host restart while the tab was
     hidden must not leave the bridge closed until the next beat. */
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || ownedRef.current === true) return
      void publishRegistration()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, publishRegistration])

  /* Closing the tab must unregister it: the tools then answer "workshop-closed" instead of
     queueing patches nobody will apply. */
  useEffect(() => {
    if (!enabled) return undefined
    return () => { void dropMusicCollabRequest(sessionId, tabId).catch(() => {}) }
  }, [enabled, sessionId, tabId])

  /* Poll the one pending patch. Fast right after applying one, slow while hidden. */
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    let timer = null
    const idleDelay = () => (activeRef.current === true ? POLL_IDLE_MS : POLL_SLOW_MS)
    const tick = async () => {
      if (cancelled) return
      let delay = idleDelay()
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          timer = window.setTimeout(tick, POLL_SLOW_MS)
          return
        }
        const payload = await musicCollabPatchRequest(sessionId, tabId)
        if (cancelled) return
        if (payload?.registered === true) {
          /* This tab owns the session (again): stop reporting the takeover and keep the fast
             cadence so a fresh patch lands within one idle delay. */
          ownedRef.current = false
          setSuperseded(false)
        }
        if (payload?.registered === false) {
          /* The Host no longer knows this tab: it restarted (or reloaded the plugin) and the
             in-memory bridge is empty. Re-register at once instead of waiting for the beat —
             and stay quiet when another workshop tab of this session owns the slot. */
          if (payload?.owned === true) {
            ownedRef.current = true
            setSuperseded(true)
            delay = POLL_SLOW_MS
          } else {
            ownedRef.current = false
            setSuperseded(false)
            delay = POLL_AFTER_PATCH_MS
            void publishRegistration()
          }
        }
        const patch = payload?.patch ?? null
        if (patch !== null) {
          delay = POLL_AFTER_PATCH_MS
          const known = appliedRef.current.get(patch.id)
          const outcome = known ?? (applyRef.current(patch) ?? { result: 'gone' })
          if (known === undefined) {
            appliedRef.current.set(patch.id, outcome)
            if (appliedRef.current.size > 20) appliedRef.current.delete(appliedRef.current.keys().next().value)
            if (outcome.result === 'applied') setNotice({ ...outcome.summary, trackId: patch.trackId, historyId: patch.id })
          }
          try {
            await ackMusicCollabPatchRequest({ id: patch.id, result: outcome.result, summary: outcome.summary }, sessionId, tabId)
          } catch {
            /* A missing ack only costs the tool its certainty; it times out as pending. */
          }
        }
      } catch {
        delay = POLL_SLOW_MS
      }
      if (!cancelled) timer = window.setTimeout(tick, delay)
    }
    timer = window.setTimeout(tick, POLL_IDLE_MS)
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [enabled, sessionId, tabId, publishRegistration])

  /* Publish the Chat envelope. Clearing is reserved for teardown or collaboration turning off:
     the store keeps the user's on/off choice per entry, so clearing on every score edit would
     silently switch the pill back on. */
  useEffect(() => {
    if (!enabled) clearMusicChatContext(sessionId, tabId)
    return () => clearMusicChatContext(sessionId, tabId)
  }, [enabled, sessionId, tabId])

  useEffect(() => {
    if (!enabled || superseded) return undefined
    const selectedTrack = docRef.current.tracks.find(track => track.id === selectedTrackId) ?? null
    setMusicChatContext(sessionId, tabId, buildMusicChatEnvelope(docRef.current, selectedTrack, focusBar))
  }, [enabled, superseded, sessionId, tabId, doc, selectedTrackId, focusBar])

  return {
    notice,
    state,
    superseded,
    dismissNotice: () => setNotice(null),
  }
}

/** The collaboration row under the AI card: what the chat currently targets. */
export function MusicCollabRow({ hostCollab, onRequestInChat, state, superseded, track, trackName }) {
  return h('section', { className: 'dsh-ws-music-card dsh-ws-music-collab' },
    h('div', { className: 'dsh-ws-music-card-head' },
      h('span', { 'aria-hidden': true, className: 'dsh-ws-music-card-mark' }, '⇄'),
      h('span', { className: 'dsh-ws-music-card-title' }, translate('music.collab.title'))),
    h('div', { className: 'dsh-ws-music-collab-body' },
      hostCollab === false
        ? h('p', { className: 'dsh-ws-music-empty-note' }, translate('music.collab.hostOutdated'))
        : null,
      superseded === true
        ? h('p', { className: 'dsh-ws-music-empty-note' }, translate('music.collab.superseded'))
        : null,
      track === null || track === undefined
        ? h('p', { className: 'dsh-ws-music-empty-note' }, translate('music.collab.noTrack'))
        : h('p', { className: 'dsh-ws-music-collab-current' }, translate('music.collab.currentTrack', { track: trackName })),
      h('button', {
        className: 'dsh-ws-music-mini-button',
        disabled: track === null || track === undefined || hostCollab !== true,
        onClick: () => onRequestInChat(track),
        title: translate('music.collab.requestTitle'),
        type: 'button',
      }, translate('music.collab.request')),
      state === 'error' ? h('p', { className: 'dsh-ws-music-empty-note' }, translate('music.collab.error')) : null))
}

/** The cross-column bar above the work area: what the last applied edit did, and how to undo it. */
export function MusicCollabBar({ canUndo, notice, onDismiss, onSelectTrack, onUndo, trackName }) {
  if (notice === null) return null
  const parts = []
  if (Number.isFinite(notice.notesBefore) && Number.isFinite(notice.notesAfter)) {
    parts.push(translate('music.collab.summary', { before: String(notice.notesBefore), after: String(notice.notesAfter) }))
  }
  if (Number.isFinite(notice.velocityBefore) && Number.isFinite(notice.velocityAfter)) {
    parts.push(translate('music.collab.velocity', { before: String(notice.velocityBefore), after: String(notice.velocityAfter) }))
  }
  if (Number.isFinite(notice.chordFit)) {
    parts.push(translate('music.collab.chordFit', { value: String(Math.round(notice.chordFit * 100)) }))
  }
  return h('div', { className: 'dsh-ws-music-collab-bar', role: 'status' },
    h('button', {
      className: 'dsh-ws-music-collab-bar-title',
      onClick: () => onSelectTrack(notice.trackId),
      title: translate('music.collab.selectTrack'),
      type: 'button',
    }, translate('music.collab.applied', { track: trackName })),
    parts.length === 0 ? null : h('span', { className: 'dsh-ws-music-collab-bar-summary' }, parts.join(' · ')),
    h('span', { className: 'dsh-ws-music-spacer' }),
    h('span', { className: 'dsh-ws-music-collab-bar-hint' }, translate('music.collab.compareHint')),
    h('button', {
      className: 'dsh-ws-music-mini-button',
      disabled: canUndo !== true,
      onClick: onUndo,
      title: canUndo === true ? translate('music.collab.undoThis') : translate('music.collab.undoBlocked'),
      type: 'button',
    }, translate('music.collab.undoThis')),
    h('button', {
      'aria-label': translate('music.collab.dismiss'),
      className: 'dsh-ws-music-mini-button',
      onClick: onDismiss,
      type: 'button',
    }, '×'))
}
