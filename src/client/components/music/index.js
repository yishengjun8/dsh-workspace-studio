/* Music workshop dock: a GarageBand-style instrument rack with a shared timeline, a
 * context editor (piano roll for melodic tracks, drum grid for drum tracks), Web Audio
 * playback and score files under the workspace's music directory.
 *
 * The score owns any number of instrument tracks; the panel edits one selected track at a
 * time. The piano roll supports a paint stroke (pointer-down + drag lights consecutive
 * cells), which is the fast path for writing a run of sixteenths.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { translate, useLocaleText } from '../../locale/index.js'
import {
  composeMusicRequest,
  deleteMusicCacheRequest,
  listMusicCacheRequest,
  listMusicRequest,
  loadMusicRequest,
  musicSampleFileRequest,
  musicSampleManifestRequest,
  musicSchemaRequest,
  readMusicCacheRequest,
  saveMusicCacheRequest,
  saveMusicRequest,
} from '../../api.js'
import {
  MUSIC_BARS_MAX,
  MUSIC_DEFAULT_DIR,
  MUSIC_DOC_VERSION,
  MUSIC_DURATION_MAX_SECONDS,
  MUSIC_DURATION_MIN_SECONDS,
  MUSIC_FILE_SUFFIX,
  MUSIC_MOOD_IDS,
  MUSIC_MOODS,
  MUSIC_STEPS_PER_BAR,
  MUSIC_STYLE_IDS,
  MUSIC_STYLES,
  barsForSeconds,
  buildMusicPlan,
  composeMusicScore,
  midiName,
  normalizeMusicDoc,
  normalizeMusicInstruments,
  scoreSeconds,
} from '../../../shared/music-score.js'
import { MUSIC_ARRANGE_BAR_WIDTH_DEFAULT, MUSIC_ROLL_GRID_WIDTH_DEFAULT, MUSIC_ROLL_ROW_HEIGHT_DEFAULT } from '../../constants.js'
import { useMindmapSummaryModels } from '../../hooks/mindmap-summary-models.js'
import { useChatModel } from '../../chat-model.js'
import { isFollowChatModel, musicModelKey } from '../../music-prefs.js'
import { MusicDiscardDialog, MusicDurationDialog, MusicOpenDialog, MusicSaveDialog } from './dialogs.js'
import { MusicCachePopover } from './cache-popover.js'
import { notifyMusicCacheChanged, subscribeMusicCacheChanged } from './cache-events.js'
import { ComposeChoicePopover } from './compose-choice.js'
import { ComposeInstrumentsPopover } from './compose-instruments.js'
import { composeRanges, mergeComposedSegments } from './compose-run.js'
import { Arrangement } from './arrangement.js'
import { DrumMachine } from './drums.js'
import { InstrumentPicker } from './picker.js'
import { PianoRoll } from './roll.js'
import { createMusicEngine } from './sampler.js'
import { instrumentInfo, trackDisplayName } from './instruments.js'
import {
  addNoteTo,
  cloneDoc,
  countEventsBeyond,
  countNotes,
  deleteNoteAt,
  emptyDrumPattern,
  findNote,
  formatClock,
  formatSeconds,
  keyLabel,
  noteValueLabel,
  parseSavedPath,
  patchNote,
  safeFileName,
  startLabel,
  stripMusicSuffix,
  toggleDrumStep,
  varyDrums,
} from './helpers.js'

const DURATION_PRESETS = [20, 30, 45, 60]
/* The accent colour of one style/mood choice. The palettes live in the shared score model so a
   cached piece's dot (cache-popover.js) and the choice bubble cannot drift apart. */
const styleColor = id => MUSIC_STYLES[id]?.color ?? '#6aa8ff'
const moodColor = id => MUSIC_MOODS[id]?.color ?? '#6aa8ff'

const TRACK_HISTORY_LIMIT = 50
const TRACK_HISTORY_COALESCE_MS = 800

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

/* A history step only carries the editable part of one track: note edits must not revert a
   title, mixer move or instrument change that happened between two note gestures. */
function trackEditSnapshot(track) {
  if (track === undefined || track === null) return null
  return track.kind === 'drums'
    ? { kind: 'drums', value: cloneValue(track.drums) }
    : { kind: 'notes', value: cloneValue(track.notes) }
}

function withTrackEdit(doc, trackId, snapshot) {
  let found = false
  const tracks = doc.tracks.map(track => {
    if (track.id !== trackId) return track
    found = true
    return snapshot.kind === 'drums'
      ? { ...track, drums: cloneValue(snapshot.value) }
      : { ...track, notes: cloneValue(snapshot.value) }
  })
  return found ? { ...doc, tracks } : null
}

function findTrack(doc, trackId) {
  return doc.tracks.find(track => track.id === trackId) ?? null
}

/* Composed docs reuse deterministic track ids (`piano`, `drums`) across pieces, so a history
   stack keyed by track id alone would bleed into the next piece. Every live piece gets a
   client key; the cache stores it so switching back to a piece restores its stacks. */
function makePieceKey() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function useModels() {
  const payload = useMindmapSummaryModels()
  return useMemo(() => {
    if (payload === null || payload === undefined || payload.available !== true || !Array.isArray(payload.models)) return []
    return payload.models.filter(model => typeof model.provider === 'string' && typeof model.model === 'string')
  }, [payload])
}

function noteIndexIn(doc, trackId, note) {
  const track = doc.tracks.find(item => item.id === trackId)
  if (track === undefined || track.kind === 'drums') return -1
  return track.notes.findIndex(item => item.bar === note.bar && item.step === note.step && item.midi === note.midi && item.len === note.len)
}

function firstNoteSelection(track) {
  return track !== undefined && track !== null && track.kind !== 'drums' && track.notes.length > 0
    ? { trackId: track.id, index: 0 }
    : null
}

export function MusicDock({
  active = true,
  arrangeBarWidth = MUSIC_ARRANGE_BAR_WIDTH_DEFAULT,
  cacheScopeId,
  chatSessionId,
  musicPrefs,
  onMusicPrefs,
  onSaved,
  onUpdate,
  rollBaseHeight = MUSIC_ROLL_ROW_HEIGHT_DEFAULT,
  rollBaseWidth = MUSIC_ROLL_GRID_WIDTH_DEFAULT,
  saveDir = MUSIC_DEFAULT_DIR,
  tab,
  workspace,
}) {
  useLocaleText()
  const cacheScope = typeof cacheScopeId === 'string' && cacheScopeId !== '' ? cacheScopeId : null
  /* The configured default save folder (settings → 工作区设置 → 音乐工坊). It only decides where a
     piece that has no remembered path goes; a saved piece always writes back to its own path. */
  const defaultSaveDir = typeof saveDir === 'string' && saveDir.trim() !== '' ? saveDir : MUSIC_DEFAULT_DIR
  const models = useModels()
  /* The page's model choice: "follow the chat" (default) reads the same per-session model
     directory the composer seat writes, so a switch in the right column shows up here live. */
  const modelChoice = musicPrefs?.model ?? null
  const followChat = isFollowChatModel(modelChoice)
  const chatModel = useChatModel(chatSessionId)
  const chatModelLabel = chatModel === null
    ? ''
    : (models.find(model => model.provider === chatModel.provider && model.model === chatModel.model)?.name
      ?? `${chatModel.provider}/${chatModel.model}`)
  const fixedModel = followChat ? null : modelChoice
  const fixedModelAvailable = fixedModel === null
    || models.some(model => model.provider === fixedModel.provider && model.model === fixedModel.model)
  const selectedModelValue = followChat ? 'session' : musicModelKey(fixedModel)

  const restoredDoc = useMemo(() => normalizeMusicDoc(tab.musicDoc), [tab.musicDoc])
  const legacyDropped = tab.musicDoc !== null && tab.musicDoc !== undefined && restoredDoc === null
  const [doc, setDoc] = useState(() => restoredDoc ?? composeMusicScore({ bars: 8 }))
  const docRef = useRef(doc)
  docRef.current = doc
  const pieceKeyRef = useRef(null)
  if (pieceKeyRef.current === null) pieceKeyRef.current = makePieceKey()
  const titleMeasureRef = useRef(null)
  /* The dock's own subtree: the window-level save shortcut only acts when the focus is either
     inside it or somewhere that does not own the key (dev-notes §5 host.contains). */
  const rootRef = useRef(null)
  const [titleWidth, setTitleWidth] = useState(0)

  /* Measure the title text with a hidden mirror so the edit box is exactly as wide as the
     name and the unsaved dot can sit immediately after it instead of floating at the far
     right of the whole header. */
  useLayoutEffect(() => {
    const node = titleMeasureRef.current
    if (node === null) return
    setTitleWidth(Math.max(64, Math.ceil(node.getBoundingClientRect().width) + 1))
  }, [doc.title])

  const [durationText, setDurationText] = useState(() => String(Math.round(scoreSeconds(doc))))
  const [durationConfirm, setDurationConfirm] = useState(null)
  const [composeStage, setComposeStage] = useState(null)

  const [savedPath, setSavedPath] = useState(legacyDropped ? '' : (typeof tab.savedPath === 'string' ? tab.savedPath : ''))
  const savedPathRef = useRef(savedPath)
  savedPathRef.current = savedPath
  const [dirty, setDirty] = useState(tab.dirty === true)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const [selectedTrackId, setSelectedTrackId] = useState(() => doc.tracks[0]?.id ?? null)
  const [selectedNote, setSelectedNote] = useState(() => firstNoteSelection(doc.tracks[0]))
  const [activeBar, setActiveBar] = useState(1)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [moodOpen, setMoodOpen] = useState(false)
  const [cacheOpen, setCacheOpen] = useState(false)
  const styleButtonRef = useRef(null)
  const moodButtonRef = useRef(null)
  const cacheButtonRef = useRef(null)
  const [cacheEntries, setCacheEntries] = useState([])
  const [cacheLoading, setCacheLoading] = useState(false)
  const [cacheError, setCacheError] = useState('')
  const cacheAbortRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)
  playingRef.current = playing
  const [position, setPosition] = useState(0)
  const [loop, setLoop] = useState(true)
  const [volume, setVolume] = useState(0.8)
  const [composing, setComposing] = useState(false)
  const [status, setStatus] = useState(() => legacyDropped ? { text: translate('music.legacyDropped') } : null)
  const [saving, setSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [openOpen, setOpenOpen] = useState(false)
  const [openDir, setOpenDir] = useState('')
  const [openFiles, setOpenFiles] = useState([])
  const [openLoading, setOpenLoading] = useState(false)
  const [openError, setOpenError] = useState(null)
  const [discardPath, setDiscardPath] = useState(null)
  const [history, setHistory] = useState([])
  const trackHistoryRef = useRef(new Map())
  const [historyVersion, setHistoryVersion] = useState(0)

  const [style, setStyle] = useState(doc.prompt.style)
  const [mood, setMood] = useState(doc.prompt.mood)
  const [promptText, setPromptText] = useState(doc.prompt.text)
  const [density, setDensity] = useState(doc.prompt.density)
  const [complexity, setComplexity] = useState(doc.prompt.complexity)
  const styleOptions = MUSIC_STYLE_IDS.map(id => ({
    color: styleColor(id),
    desc: translate(`music.style.${id}.desc`),
    id,
    label: translate(`music.style.${id}`),
  }))
  const moodOptions = MUSIC_MOOD_IDS.map(id => ({
    color: moodColor(id),
    desc: translate(`music.mood.${id}.desc`),
    id,
    label: translate(`music.mood.${id}`),
  }))
  const styleLabel = translate(`music.style.${style}`)
  const moodLabel = translate(`music.mood.${mood}`)
  const [composeOpen, setComposeOpen] = useState(true)
  const [composeInstruments, setComposeInstruments] = useState(() => normalizeMusicInstruments(doc.prompt.instruments))
  const [instrumentsOpen, setInstrumentsOpen] = useState(false)
  const [hostReady, setHostReady] = useState(null)
  const [samplesReady, setSamplesReady] = useState(false)
  const [samplesLoading, setSamplesLoading] = useState(true)
  const [samplesError, setSamplesError] = useState('')

  const instrumentsButtonRef = useRef(null)
  const engineRef = useRef(null)
  const rafRef = useRef(0)
  const pausedRef = useRef(0)
  const syncTimer = useRef(0)
  const revRef = useRef(Number.isFinite(tab.musicRev) ? tab.musicRev : 0)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const mountedRef = useRef(true)
  const composeAbortRef = useRef(null)
  const openAbortRef = useRef(null)

  const duration = scoreSeconds(doc)
  const playhead = duration <= 0 ? 0 : Math.min(1, position / duration)
  const notesTotal = useMemo(() => countNotes(doc), [doc])
  const instrumentKey = useMemo(() => [...new Set(doc.tracks.map(track => track.instrument))].sort().join('|'), [doc.tracks])
  const activeTrack = doc.tracks.find(track => track.id === selectedTrackId) ?? doc.tracks[0] ?? null
  const activeInfo = activeTrack === null ? null : instrumentInfo(activeTrack.instrument)
  const activeTrackHistory = useMemo(() => (activeTrack === null
    ? null
    : trackHistoryRef.current.get(`${pieceKeyRef.current}|${activeTrack.id}`) ?? null), [activeTrack, historyVersion])
  const canUndo = (activeTrackHistory?.undo.length ?? 0) > 0
  const canRedo = (activeTrackHistory?.redo.length ?? 0) > 0
  const selectedNoteFound = findNote(doc, selectedNote)

  useEffect(() => {
    setDurationText(String(Math.round(scoreSeconds(docRef.current))))
  }, [doc.bars, doc.bpm])

  /* The running Host may still be the pre-sample build. Refuse to save, open or compose until
     it reports the v3 score schema, so an old Host cannot reinterpret the VCSL palette. */
  useEffect(() => {
    let alive = true
    musicSchemaRequest()
      .then((payload) => {
        if (alive) {
          setHostReady(payload.version === MUSIC_DOC_VERSION
            && payload.barsMax >= MUSIC_BARS_MAX
            && payload.noteLenMax >= MUSIC_BARS_MAX * MUSIC_STEPS_PER_BAR)
        }
      })
      .catch(() => { if (alive) setHostReady(false) })
    return () => { alive = false }
  }, [])

  /* One engine per mounted dock; its ended callback resets the transport. */
  useEffect(() => {
    mountedRef.current = true
    const engine = createMusicEngine({
      loadManifest: musicSampleManifestRequest,
      loadSample: musicSampleFileRequest,
    })
    engine.setVolume(volume)
    engine.onEnded(() => {
      if (!mountedRef.current) return
      pausedRef.current = 0
      setPosition(0)
      setPlaying(false)
    })
    engineRef.current = engine
    return () => {
      mountedRef.current = false
      cancelAnimationFrame(rafRef.current)
      clearTimeout(syncTimer.current)
      engine.dispose()
      engineRef.current = null
      /* A tab switch can unmount this dock while edits are still inside the debounce window:
         flush the final score so the persisted snapshot matches the last visible state. */
      if (docRef.current !== null) {
        revRef.current += 1
        onUpdateRef.current({ musicDoc: docRef.current, name: docRef.current.title, musicRev: revRef.current, dirty: dirtyRef.current })
      }
    }
  }, [])

  /* Load only the instruments this score uses; every score edit that changes the palette
     starts another bounded pass, and a failed pack leaves playback disabled with a reason. */
  useEffect(() => {
    let alive = true
    const engine = engineRef.current
    if (engine === null || hostReady !== true) return undefined
    setSamplesLoading(true)
    setSamplesReady(false)
    setSamplesError('')
    engine.prepare(docRef.current)
      .then(() => { if (alive) { setSamplesReady(true); setSamplesLoading(false) } })
      .catch((error) => {
        if (!alive) return
        setSamplesReady(false)
        setSamplesLoading(false)
        setSamplesError(error instanceof Error ? error.message : String(error))
      })
    return () => { alive = false }
  }, [hostReady, instrumentKey])

  const stopRaf = () => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }

  /* The transport readout repaints at ~20 fps: the panel is a large tree (rack + editor),
     and a 60 fps React render would cost more than the playhead is worth. */
  const lastPaintRef = useRef(0)
  const tick = useCallback((now) => {
    const engine = engineRef.current
    if (engine === null) return
    if (typeof now !== 'number' || now - lastPaintRef.current >= 50) {
      lastPaintRef.current = typeof now === 'number' ? now : 0
      setPosition(engine.position())
    }
    if (engine.isPlaying()) rafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopPlayback = useCallback((reset = true) => {
    const engine = engineRef.current
    if (engine !== null) engine.stop()
    stopRaf()
    setPlaying(false)
    playingRef.current = false
    if (reset) {
      pausedRef.current = 0
      setPosition(0)
    }
  }, [])

  const startPlayback = useCallback((from, targetDoc) => {
    const engine = engineRef.current
    if (engine === null) return
    engine.setVolume(volume)
    const playbackDoc = targetDoc ?? docRef.current
    if (!engine.isReady(playbackDoc)) {
      setStatus({ error: samplesError !== '', text: samplesError !== '' ? translate('music.samples.failed') : translate('music.samples.loading') })
      return
    }
    const started = engine.play(playbackDoc, { from, loop, seamless: playbackDoc.prompt.seamless !== false })
    if (!started) {
      setStatus({ error: true, text: translate('music.play.unavailable') })
      return
    }
    setPlaying(true)
    playingRef.current = true
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [loop, samplesError, tick, volume])

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      const engine = engineRef.current
      pausedRef.current = engine === null ? 0 : engine.position()
      stopPlayback(false)
      return
    }
    startPlayback(pausedRef.current)
  }, [startPlayback, stopPlayback])

  /* Switching away from the tab stops its transport: a hidden score must not keep playing under
     another tab (the position is kept, so switching back resumes where it stopped). */
  useEffect(() => {
    if (active === false && playingRef.current) {
      const engine = engineRef.current
      pausedRef.current = engine === null ? 0 : engine.position()
      stopPlayback(false)
    }
  }, [active, stopPlayback])

  /* Tempo/loop changes take effect immediately: restart from the current position with the
     edited document so a BPM nudge does not wait for the next press of play. */
  const restartPlayback = useCallback((nextDoc) => {
    if (!playingRef.current) return
    startPlayback(0, nextDoc)
  }, [startPlayback])

  const flushToTab = useCallback((nextDoc, extra) => {
    revRef.current += 1
    onUpdateRef.current({
      dirty: true,
      musicDoc: nextDoc,
      musicRev: revRef.current,
      name: nextDoc.title,
      ...(extra === undefined ? {} : extra),
    })
  }, [])

  const scheduleSync = useCallback((nextDoc, extra) => {
    clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      if (mountedRef.current) flushToTab(nextDoc, extra)
    }, 450)
  }, [flushToTab])

  /** The one mutation entry point: swap the document, mark it dirty and publish a debounced snapshot. */
  const commit = useCallback((next, options = {}) => {
    if (next === null) return
    const changed = next !== docRef.current
    if (changed) {
      docRef.current = next
      setDoc(next)
      setDirty(true)
      scheduleSync(next)
      /* Mixer edits (mute / solo / volume, and their undo) reach the running transport at
         once: the engine ramps per-track gains instead of waiting for a playback restart. */
      engineRef.current?.setMix(next.tracks)
    }
    if (options.restart === true && changed) restartPlayback(next)
  }, [restartPlayback, scheduleSync])

  const recordTrackHistory = useCallback((trackId, before, after, key) => {
    if (before === null || after === null) return
    if (JSON.stringify(before.value) === JSON.stringify(after.value)) return
    const record = trackHistoryRef.current.get(trackId) ?? { redo: [], undo: [] }
    const last = record.undo[record.undo.length - 1]
    const now = Date.now()
    /* A draw stroke arrives as add + many length patches; a velocity slider as many patches.
       Merge consecutive patches of the same key so one undo reverses the whole gesture. */
    if (key !== null && last !== undefined && last.key === key && now - last.at < TRACK_HISTORY_COALESCE_MS) {
      last.after = after
      last.at = now
      record.redo = []
    } else {
      record.undo.push({ after, at: now, before, key })
      if (record.undo.length > TRACK_HISTORY_LIMIT) record.undo.shift()
      record.redo = []
    }
    trackHistoryRef.current.set(trackId, record)
    setHistoryVersion(version => version + 1)
  }, [])

  const commitTrackEdit = useCallback((next, trackId, key = null) => {
    if (next === null) return false
    const before = trackEditSnapshot(findTrack(docRef.current, trackId))
    const after = trackEditSnapshot(findTrack(next, trackId))
    if (before === null || after === null) return false
    recordTrackHistory(`${pieceKeyRef.current}|${trackId}`, before, after, key)
    commit(next)
    return true
  }, [commit, recordTrackHistory])

  const applyTrackHistory = (direction) => {
    if (activeTrack === null) return
    const record = trackHistoryRef.current.get(`${pieceKeyRef.current}|${activeTrack.id}`)
    if (record === undefined) return
    const from = direction === 'undo' ? record.undo : record.redo
    const to = direction === 'undo' ? record.redo : record.undo
    const step = from[from.length - 1]
    if (step === undefined) return
    const snapshot = direction === 'undo' ? step.before : step.after
    const next = withTrackEdit(docRef.current, activeTrack.id, snapshot)
    if (next === null) return
    from.pop()
    to.push(step)
    if (to.length > TRACK_HISTORY_LIMIT) to.shift()
    setHistoryVersion(version => version + 1)
    setSelectedNote(firstNoteSelection(findTrack(next, activeTrack.id)))
    commit(next)
  }

  const undoTrackEdit = () => applyTrackHistory('undo')
  const redoTrackEdit = () => applyTrackHistory('redo')

  const auditionNote = useCallback(async (midi) => {
    if (activeTrack === null || activeTrack.kind === 'drums') return
    const engine = engineRef.current
    if (engine === null) return
    try {
      const ok = await engine.audition(activeTrack.instrument, midi, 104)
      if (ok === false) {
        setStatus({
          error: true,
          text: samplesReady
            ? translate('music.samples.auditionFailed')
            : translate(samplesError === '' ? 'music.samples.loading' : 'music.samples.failed'),
        })
      }
    } catch {
      setStatus({ error: true, text: translate('music.samples.auditionFailed') })
    }
  }, [activeTrack, samplesError, samplesReady])

  const selectTrack = useCallback((trackId) => {
    const track = docRef.current.tracks.find(item => item.id === trackId)
    if (track === undefined) return
    setSelectedTrackId(trackId)
    setSelectedNote(firstNoteSelection(track))
    setActiveBar(1)
  }, [])

  const refreshCache = useCallback(async () => {
    if (cacheScope === null) {
      setCacheEntries([])
      setCacheLoading(false)
      return
    }
    if (cacheAbortRef.current !== null) cacheAbortRef.current.abort()
    const controller = new AbortController()
    cacheAbortRef.current = controller
    setCacheLoading(true)
    setCacheError('')
    try {
      const result = await listMusicCacheRequest(cacheScope, controller.signal)
      if (!mountedRef.current) return
      setCacheEntries(Array.isArray(result.entries) ? result.entries : [])
    } catch (error) {
      if (error?.name === 'AbortError') return
      if (mountedRef.current) setCacheError(error instanceof Error ? error.message : String(error))
    } finally {
      if (mountedRef.current) setCacheLoading(false)
      if (cacheAbortRef.current === controller) cacheAbortRef.current = null
    }
  }, [cacheScope])

  /* Snapshot the live doc before it is replaced. A blank score is not history, and a failed
     snapshot is reported in the dropdown without blocking the user's compose/switch. */
  const cacheCurrent = useCallback(async () => {
    if (cacheScope === null) return null
    const snapshot = docRef.current
    if (countNotes(snapshot) === 0) return null
    try {
      const result = await saveMusicCacheRequest(cacheScope, {
        doc: snapshot,
        pieceKey: pieceKeyRef.current,
        savedPath: savedPathRef.current === '' ? undefined : savedPathRef.current,
      })
      notifyMusicCacheChanged(cacheScope)
      return result.entry
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [cacheScope])

  const applyComposeInstruments = useCallback((next) => {
    const ordered = normalizeMusicInstruments(next)
    setInstrumentsOpen(false)
    setComposeInstruments(ordered)
    const current = docRef.current
    if (ordered.join('|') === current.prompt.instruments.join('|')) return
    /* The instrumentation is score metadata: keep it in prompt so saving without an
       immediate recompose still remembers the chosen combination. */
    const nextDoc = normalizeMusicDoc({ ...current, prompt: { ...current.prompt, instruments: ordered } })
    if (nextDoc !== null) commit(nextDoc)
  }, [commit])

  const toggleStyleChoice = () => {
    setStyleOpen(open => !open)
    setMoodOpen(false)
    setInstrumentsOpen(false)
    setCacheOpen(false)
  }
  const toggleMoodChoice = () => {
    setMoodOpen(open => !open)
    setStyleOpen(false)
    setInstrumentsOpen(false)
    setCacheOpen(false)
  }
  const chooseStyle = (id) => {
    setStyle(id)
    setStyleOpen(false)
  }
  const chooseMood = (id) => {
    setMood(id)
    setMoodOpen(false)
  }

  const applyLoadedDoc = useCallback((next, path, pieceKey = null) => {
    stopPlayback(true)
    setHistory([])
    pieceKeyRef.current = typeof pieceKey === 'string' && pieceKey !== '' ? pieceKey : makePieceKey()
    docRef.current = next
    setDoc(next)
    const first = next.tracks[0] ?? null
    setSelectedTrackId(first?.id ?? null)
    setSelectedNote(firstNoteSelection(first))
    setActiveBar(1)
    setPromptText(next.prompt.text)
    setStyle(next.prompt.style)
    setMood(next.prompt.mood)
    setDensity(next.prompt.density)
    setComplexity(next.prompt.complexity)
    setComposeInstruments(next.prompt.instruments)
    setDurationText(String(Math.round(scoreSeconds(next))))
    setSavedPath(path ?? '')
    setDirty(false)
    revRef.current += 1
    onUpdateRef.current({
      dirty: false,
      musicDoc: next,
      musicRev: revRef.current,
      name: next.title,
      savedPath: path ?? null,
    })
  }, [stopPlayback])

  const deleteCacheEntry = useCallback(async (entry) => {
    if (cacheScope === null) return
    const result = await deleteMusicCacheRequest(cacheScope, entry.id)
    if (result.deleted !== true) throw new Error(translate('music.cache.notFound'))
    setCacheEntries(current => current.filter(item => item.id !== entry.id))
    notifyMusicCacheChanged(cacheScope)
  }, [cacheScope])

  const loadCachedEntry = useCallback(async (entry) => {
    if (cacheScope === null || entry === null || composing) return
    setCacheError('')
    const hadNotes = countNotes(docRef.current) > 0
    const snapshot = await cacheCurrent()
    /* Never replace an unsaved piece when its snapshot could not be written; the dropdown
       stays open with the failure instead of turning the switch into data loss. */
    if (hadNotes && snapshot === null) return
    try {
      const result = await readMusicCacheRequest(cacheScope, entry.id)
      const next = normalizeMusicDoc(result.entry.doc)
      if (next === null) throw new Error(translate('error.invalid-response.music-cache'))
      applyLoadedDoc(
        next,
        typeof result.entry.savedPath === 'string' ? result.entry.savedPath : '',
        typeof result.entry.pieceKey === 'string' ? result.entry.pieceKey : null,
      )
      setCacheOpen(false)
      setStatus({ text: translate('music.cache.restored', { title: next.title }) })
      /* The selected row is now the live document; dropping it keeps "current + history"
         unambiguous. A failure here leaves a harmless duplicate that the fingerprint updates. */
      try {
        await deleteMusicCacheRequest(cacheScope, entry.id)
        setCacheEntries(current => current.filter(item => item.id !== entry.id))
        notifyMusicCacheChanged(cacheScope)
      } catch {
        /* best effort */
      }
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : String(error))
    }
  }, [applyLoadedDoc, cacheCurrent, cacheScope, composing])

  useEffect(() => {
    void refreshCache()
    return () => {
      if (cacheAbortRef.current !== null) {
        cacheAbortRef.current.abort()
        cacheAbortRef.current = null
      }
    }
  }, [refreshCache])

  useEffect(() => subscribeMusicCacheChanged(cacheScope, () => { void refreshCache() }), [cacheScope, refreshCache])

  useEffect(() => {
    if (cacheOpen) void refreshCache()
  }, [cacheOpen, refreshCache])

  /* ── compose ─────────────────────────────────────────────────────────────── */
  const runCompose = async () => {
    if (composing) return
    if (hostReady !== true) { setStatus({ error: true, text: translate('music.hostRestart') }); return }
    if (!samplesReady) {
      setStatus({ error: samplesError !== '', text: samplesError !== '' ? translate('music.samples.failed') : translate('music.samples.loading') })
      return
    }
    const controller = new AbortController()
    composeAbortRef.current = controller
    setComposing(true)
    setStatus(null)
    const current = docRef.current
    const plan = {
      ...buildMusicPlan({
        bars: current.bars,
        bpm: current.bpm,
        keyMode: current.keyMode,
        keyRoot: current.keyRoot,
        seamless: current.prompt.seamless !== false,
        style,
      }),
      instruments: composeInstruments,
    }
    const ranges = composeRanges(plan.bars)
    try {
      const segments = []
      let fallbackWarning = null
      for (let index = 0; index < ranges.length; index += 1) {
        if (controller.signal.aborted) {
          const aborted = new Error('aborted')
          aborted.name = 'AbortError'
          throw aborted
        }
        setComposeStage({ index: index + 1, total: ranges.length })
        const range = ranges[index]
        const result = await composeMusicRequest(workspace.workspaceId, {
          bars: range.bars,
          bpm: plan.bpm,
          complexity,
          density,
          humanize: current.humanize,
          instruments: composeInstruments,
          keyMode: plan.keyMode,
          keyRoot: plan.keyRoot,
          model: followChat ? { mode: 'session' } : fixedModel,
          mood,
          prompt: promptText,
          segmentCount: ranges.length,
          segmentIndex: index + 1,
          seamless: plan.seamless && index === ranges.length - 1,
          sessionId: chatSessionId,
          startBar: range.start,
          style,
          swing: current.swing,
          totalBars: plan.bars,
        }, controller.signal)
        const parsed = normalizeMusicDoc(result.doc)
        if (parsed === null) throw new Error(translate('error.invalid-response.music', { status: 200 }))
        if (result.engine !== 'llm') {
          fallbackWarning = result.warning ?? null
          break
        }
        segments.push({ doc: parsed, range })
      }

      let next = null
      let engine = 'llm'
      if (segments.length === ranges.length) {
        next = mergeComposedSegments(segments, plan, {
          complexity,
          createdAt: current.createdAt,
          density,
          humanize: current.humanize,
          mood,
          prompt: promptText,
          style,
          swing: current.swing,
          title: current.title,
        })
        if (next === null) fallbackWarning = 'llm-invalid'
      }
      if (next === null) {
        engine = 'template'
        const now = Date.now()
        next = composeMusicScore({
          bars: plan.bars,
          bpm: plan.bpm,
          complexity,
          density,
          humanize: current.humanize,
          instruments: composeInstruments,
          keyMode: plan.keyMode,
          keyRoot: plan.keyRoot,
          mood,
          prompt: promptText,
          seamless: plan.seamless,
          seed: now,
          style,
          swing: current.swing,
          now,
        })
        next = { ...next, createdAt: current.createdAt, title: current.title }
      }

      if (playingRef.current) stopPlayback(true)
      await cacheCurrent()
      setHistory(history => [{ at: Date.now(), doc: cloneDoc(current), label: translate('music.history.generated') }, ...history].slice(0, 6))
      pieceKeyRef.current = makePieceKey()
      docRef.current = next
      setDoc(next)
      setDirty(true)
      /* A new composition is a new piece: it must not inherit the previous piece's remembered
         file, or the first save would overwrite that other score. */
      setSavedPath('')
      setSelectedTrackId(next.tracks[0]?.id ?? null)
      setSelectedNote(firstNoteSelection(next.tracks[0]))
      setActiveBar(1)
      setComposeInstruments(next.prompt.instruments)
      flushToTab(next, { savedPath: null })
      setStatus({
        text: engine === 'llm'
          ? translate('music.compose.done')
          : fallbackWarning === 'session-model-unavailable'
            ? translate('music.compose.noSessionModel')
            : fallbackWarning === 'llm-instrument-mismatch'
              ? translate('music.compose.instrumentMismatch')
            : fallbackWarning === undefined || fallbackWarning === null
              ? translate('music.compose.template')
              : translate('music.compose.fallback'),
      })
    } catch (error) {
      if (composeAbortRef.current !== controller) return
      if (error?.name === 'AbortError') setStatus({ text: translate('music.compose.aborted') })
      else setStatus({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (composeAbortRef.current === controller) {
        composeAbortRef.current = null
        if (mountedRef.current) {
          setComposing(false)
          setComposeStage(null)
        }
      }
    }
  }

  const cancelCompose = () => {
    if (composeAbortRef.current !== null) composeAbortRef.current.abort()
    setComposing(false)
  }

  /* ── save / open ─────────────────────────────────────────────────────────── */
  const doSave = async (dir, name) => {
    if (hostReady !== true) { setStatus({ error: true, text: translate('music.hostRestart') }); return }
    setSaving(true)
    setSaveError(null)
    try {
      const result = await saveMusicRequest(workspace.workspaceId, { dir, doc: docRef.current, name })
      const next = normalizeMusicDoc(result.doc) ?? docRef.current
      docRef.current = next
      setDoc(next)
      setSavedPath(result.path)
      setDirty(false)
      revRef.current += 1
      onUpdateRef.current({
        dirty: false,
        musicDoc: next,
        musicRev: revRef.current,
        name: next.title,
        savedPath: result.path,
      })
      setSaveOpen(false)
      onSaved?.(result.path)
      setStatus({ text: translate('music.saved', { path: result.path }) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(message)
      setStatus({ error: true, text: message })
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  /* 「保存」 always opens the dialog: the remembered path is only a prefill, so the user keeps
     full control over where this piece lands. */
  const saveNow = () => {
    if (hostReady !== true) { setStatus({ error: true, text: translate('music.hostRestart') }); return }
    setSaveError(null)
    setSaveOpen(true)
  }

  /* Ctrl/Cmd+S (see the shortcut effect below): write straight to where this piece belongs —
     its remembered file, else <default folder>/<title>. No dialog, no dirty gate. A brand-new
     piece never silently clobbers another score that already owns its name in the default
     folder: that case falls back to the dialog (the user picks the location). */
  const quickSave = async () => {
    if (hostReady !== true) { setStatus({ error: true, text: translate('music.hostRestart') }); return }
    if (saving) return
    const current = savedPathRef.current
    if (current !== '') {
      const parsed = parseSavedPath(current)
      await doSave(parsed.dir, stripMusicSuffix(parsed.name))
      return
    }
    const dir = defaultSaveDir
    const name = safeFileName(docRef.current.title)
    const target = name.toLowerCase().endsWith(MUSIC_FILE_SUFFIX) ? name : `${name}${MUSIC_FILE_SUFFIX}`
    try {
      const listed = await listMusicRequest(workspace.workspaceId, dir)
      const taken = Array.isArray(listed.files)
        && listed.files.some(file => String(file.name).toLowerCase() === target.toLowerCase())
      if (taken) {
        setSaveError(null)
        setSaveOpen(true)
        setStatus({ text: translate('music.save.nameTaken', { name: target }) })
        return
      }
    } catch {
      /* A failed listing must not block the save itself: the Host reports a real write error. */
    }
    await doSave(dir, name)
  }
  const quickSaveRef = useRef(quickSave)
  quickSaveRef.current = quickSave
  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event) => {
      /* IME composition, an open modal (it owns its own Enter/save) and every modified key but
         plain Ctrl/Cmd+S pass through. */
      if (event.isComposing) return
      if (document.querySelector('.dsh-ws-dialog-backdrop') !== null) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (String(event.key).toLowerCase() !== 's') return
      const target = event.target
      const root = rootRef.current
      const inside = root !== null && target instanceof Node && root.contains(target)
      /* A text control outside the workshop (the chat box, a dialog) keeps the key. */
      if (!inside && target instanceof Element
        && (target.isContentEditable || target.closest('input, textarea, select') !== null)) return
      event.preventDefault()
      event.stopPropagation()
      void quickSaveRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active])

  const refreshOpen = async (dir) => {
    if (openAbortRef.current !== null) openAbortRef.current.abort()
    const controller = new AbortController()
    openAbortRef.current = controller
    setOpenLoading(true)
    setOpenError(null)
    try {
      const result = await listMusicRequest(workspace.workspaceId, dir, controller.signal)
      if (!mountedRef.current) return
      setOpenDir(result.dir)
      setOpenFiles(Array.isArray(result.files) ? result.files : [])
    } catch (error) {
      if (error?.name === 'AbortError') return
      if (mountedRef.current) setOpenError(error instanceof Error ? error.message : String(error))
    } finally {
      if (mountedRef.current) setOpenLoading(false)
      if (openAbortRef.current === controller) openAbortRef.current = null
    }
  }

  const showOpen = () => {
    /* Start where this piece lives, or in the configured default folder for a new piece. */
    const parsed = parseSavedPath(savedPathRef.current)
    const dir = savedPathRef.current === '' ? defaultSaveDir : parsed.dir
    setOpenOpen(true)
    setOpenFiles([])
    setOpenError(null)
    void refreshOpen(dir)
  }

  const loadPath = async (path) => {
    try {
      setOpenError(null)
      const result = await loadMusicRequest(workspace.workspaceId, path)
      await cacheCurrent()
      applyLoadedDoc(normalizeMusicDoc(result.doc) ?? docRef.current, result.path)
      setOpenOpen(false)
      setDiscardPath(null)
      setStatus({ text: translate('music.opened', { path: result.path }) })
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    }
  }

  const pickOpen = (path) => {
    if (dirtyRef.current) {
      setDiscardPath(path)
      return
    }
    void loadPath(path)
  }

  /* ── score edits ─────────────────────────────────────────────────────────── */
  const replaceTrack = (nextTrack) => {
    commit({ ...docRef.current, tracks: docRef.current.tracks.map(track => (track.id === nextTrack.id ? nextTrack : track)) })
  }

  const addTrack = (instrumentId) => {
    const info = instrumentInfo(instrumentId)
    const same = docRef.current.tracks.filter(track => track.instrument === instrumentId).length
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const track = {
      id,
      name: same === 0 ? '' : `${translate(info.nameKey)} ${same + 1}`,
      instrument: info.id,
      kind: info.kind,
      volume: info.kind === 'drums' ? 0.9 : 0.8,
      muted: false,
      solo: false,
      ...(info.kind === 'drums' ? { drums: emptyDrumPattern(docRef.current.bars) } : { notes: [] }),
    }
    commit({ ...docRef.current, tracks: [...docRef.current.tracks, track] })
    setSelectedTrackId(id)
    setSelectedNote(null)
    setActiveBar(1)
    setPickerOpen(false)
    setStatus({ text: translate('music.status.trackAdded', { name: translate(info.nameKey) }) })
  }

  const deleteTrack = () => {
    if (activeTrack === null) return
    const index = docRef.current.tracks.findIndex(track => track.id === activeTrack.id)
    const tracks = docRef.current.tracks.filter(track => track.id !== activeTrack.id)
    const next = docRef.current.tracks[index + 1] ?? docRef.current.tracks[index - 1] ?? null
    commit({ ...docRef.current, tracks })
    setSelectedTrackId(next?.id ?? null)
    setSelectedNote(firstNoteSelection(next))
    setActiveBar(1)
    setStatus({ text: translate('music.status.trackDeleted') })
  }

  const duplicateTrack = () => {
    if (activeTrack === null) return
    const copy = JSON.parse(JSON.stringify(activeTrack))
    copy.id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    copy.name = `${trackDisplayName(activeTrack)} ${translate('music.status.copySuffix')}`
    const index = docRef.current.tracks.findIndex(track => track.id === activeTrack.id)
    const tracks = [...docRef.current.tracks]
    tracks.splice(index + 1, 0, copy)
    commit({ ...docRef.current, tracks })
    setSelectedTrackId(copy.id)
    setSelectedNote(firstNoteSelection(copy))
    setStatus({ text: translate('music.status.trackDuplicated') })
  }

  const moveTrack = (delta) => {
    if (activeTrack === null) return
    const tracks = [...docRef.current.tracks]
    const index = tracks.findIndex(track => track.id === activeTrack.id)
    const target = index + delta
    if (target < 0 || target >= tracks.length) return
    const [moved] = tracks.splice(index, 1)
    tracks.splice(target, 0, moved)
    commit({ ...docRef.current, tracks })
  }

  const reorderTrack = (fromId, toId) => {
    const tracks = [...docRef.current.tracks]
    const from = tracks.findIndex(track => track.id === fromId)
    const to = tracks.findIndex(track => track.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = tracks.splice(from, 1)
    tracks.splice(to, 0, moved)
    commit({ ...docRef.current, tracks })
  }

  const toggleMute = (trackId) => {
    commit({
      ...docRef.current,
      tracks: docRef.current.tracks.map(track => (track.id === trackId ? { ...track, muted: !track.muted } : track)),
    })
  }

  const toggleSolo = (trackId) => {
    commit({
      ...docRef.current,
      tracks: docRef.current.tracks.map(track => (track.id === trackId ? { ...track, solo: !track.solo } : track)),
    })
  }

  /* Bulk mute keeps solo untouched: muting every track silences the arrangement without
     destroying which tracks were soloed, so unmute-all restores the previous state. */
  const setAllMuted = (muted) => {
    const tracks = docRef.current.tracks
    if (tracks.every(track => (track.muted === true) === muted)) return
    commit({
      ...docRef.current,
      tracks: tracks.map(track => ((track.muted === true) === muted ? track : { ...track, muted })),
    })
  }

  const setTrackVolume = (value) => {
    if (activeTrack === null) return
    replaceTrack({ ...activeTrack, volume: value })
  }

  const renameTrack = (name) => {
    if (activeTrack === null) return
    replaceTrack({ ...activeTrack, name: name.slice(0, 40) })
  }

  const addNote = (note) => {
    if (activeTrack === null || activeTrack.kind === 'drums') return -1
    const next = addNoteTo(docRef.current, activeTrack.id, note)
    if (next === null) return -1
    const index = noteIndexIn(next, activeTrack.id, note)
    commitTrackEdit(next, activeTrack.id, `note:${activeTrack.id}:${index}`)
    return index
  }

  const changeNote = (index, patch) => {
    if (activeTrack === null) return
    const next = patchNote(docRef.current, activeTrack.id, index, patch)
    if (next === null) return
    commitTrackEdit(next, activeTrack.id, `note:${activeTrack.id}:${index}`)
  }

  const removeNote = (index) => {
    if (activeTrack === null) return
    const next = deleteNoteAt(docRef.current, activeTrack.id, index)
    if (next === null) return
    commitTrackEdit(next, activeTrack.id)
    setSelectedNote(null)
  }

  const duplicateNote = () => {
    if (selectedNoteFound === null) return
    const copy = {
      ...selectedNoteFound.note,
      step: Math.min(15, selectedNoteFound.note.step + Math.max(1, selectedNoteFound.note.len)),
    }
    const next = addNoteTo(docRef.current, selectedNoteFound.track.id, copy)
    if (next === null) return
    const index = noteIndexIn(next, selectedNoteFound.track.id, copy)
    commitTrackEdit(next, selectedNoteFound.track.id, `note:${selectedNoteFound.track.id}:${index}`)
    setSelectedNote({ trackId: selectedNoteFound.track.id, index })
  }

  const setVelocity = (value) => {
    if (selectedNote === null) return
    const next = patchNote(docRef.current, selectedNote.trackId, selectedNote.index, { vel: value })
    if (next === null) return
    commitTrackEdit(next, selectedNote.trackId, `note:${selectedNote.trackId}:${selectedNote.index}`)
  }

  const toggleDrum = (lane, barIndex, step) => {
    if (activeTrack === null || activeTrack.kind !== 'drums') return
    const next = {
      ...docRef.current,
      tracks: docRef.current.tracks.map(track => (track.id === activeTrack.id
        ? { ...track, drums: toggleDrumStep(track.drums, lane, barIndex, step, 104) }
        : track)),
    }
    commitTrackEdit(next, activeTrack.id)
  }

  const varyDrumBar = () => {
    if (activeTrack === null || activeTrack.kind !== 'drums') return
    const next = {
      ...docRef.current,
      tracks: docRef.current.tracks.map(track => (track.id === activeTrack.id
        ? { ...track, drums: varyDrums(track.drums, docRef.current.bars, activeBar - 1, docRef.current.prompt.density) }
        : track)),
    }
    commitTrackEdit(next, activeTrack.id)
  }

  const changeBpm = (delta) => {
    const next = normalizeMusicDoc({ ...docRef.current, bpm: docRef.current.bpm + delta })
    if (next === null) return
    commit(next, { restart: true })
  }

  const applyDurationBars = (bars) => {
    const current = docRef.current
    if (bars === current.bars) {
      setDurationText(String(Math.round(scoreSeconds(current))))
      return
    }
    if (playingRef.current) stopPlayback(true)
    const next = normalizeMusicDoc({ ...current, bars })
    if (next === null) return
    setActiveBar(1)
    setSelectedNote(firstNoteSelection(next.tracks.find(track => track.id === selectedTrackId) ?? next.tracks[0]))
    commit(next)
  }

  const requestDuration = (value) => {
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) {
      setDurationText(String(Math.round(scoreSeconds(docRef.current))))
      return
    }
    const target = Math.min(MUSIC_DURATION_MAX_SECONDS, Math.max(MUSIC_DURATION_MIN_SECONDS, seconds))
    const bars = barsForSeconds(target, docRef.current.bpm)
    const actual = scoreSeconds({ bars, bpm: docRef.current.bpm })
    const removed = bars < docRef.current.bars ? countEventsBeyond(docRef.current, bars) : 0
    if (removed > 0) {
      setDurationConfirm({ bars, removed, seconds: actual })
      return
    }
    applyDurationBars(bars)
  }

  const commitDurationInput = () => {
    const parsed = Number(durationText)
    if (!Number.isFinite(parsed)) {
      setDurationText(String(Math.round(scoreSeconds(docRef.current))))
      return
    }
    requestDuration(parsed)
  }

  const changeGroove = (patch) => {
    const next = normalizeMusicDoc({ ...docRef.current, ...patch })
    if (next !== null) commit(next)
  }

  const toggleSeamless = () => {
    const current = docRef.current
    const next = normalizeMusicDoc({
      ...current,
      prompt: { ...current.prompt, seamless: current.prompt.seamless === false },
    })
    if (next !== null) commit(next, { restart: true })
  }

  return h('div', {
    className: 'dsh-ws-music',
    ref: rootRef,
    onKeyDown: (event) => {
      if (!active) return
      const tag = event.target?.tagName
      if (event.target?.isContentEditable === true) return
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      /* Undo/redo only when the active workshop has focus and the target is not a text
         control: the title and prompt must keep their native text undo. */
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = String(event.key).toLowerCase()
        if (key === 'z' || key === 'y') {
          if (key === 'y' || event.shiftKey) {
            if (canRedo) {
              event.preventDefault()
              redoTrackEdit()
            }
          } else if (canUndo) {
            event.preventDefault()
            undoTrackEdit()
          }
          return
        }
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      }
    },
  },
  h('header', { className: 'dsh-ws-music-head' },
    h('span', { 'aria-hidden': true, className: 'dsh-ws-music-mark' }, '♪'),
    h('div', { className: 'dsh-ws-music-head-text' },
      h('div', { className: 'dsh-ws-music-title-row' },
        h('span', { 'aria-hidden': true, className: 'dsh-ws-music-title-measure', ref: titleMeasureRef }, doc.title),
        h('input', {
          'aria-label': translate('music.title.aria'),
          className: 'dsh-ws-music-title',
          onChange: (event) => {
            const title = event.target.value.slice(0, 120)
            const next = { ...docRef.current, title }
            docRef.current = next
            setDoc(next)
            setDirty(true)
            scheduleSync(next)
          },
          spellCheck: false,
          style: titleWidth > 0 ? { width: `${titleWidth}px` } : undefined,
          type: 'text',
          value: doc.title,
        }),
        dirty || savedPath === '' ? h('span', {
          className: 'dsh-ws-music-dirty-dot',
          title: translate('music.unsaved'),
        }) : null),
      savedPath === ''
        ? null
        : h('span', { className: 'dsh-ws-music-subtitle' },
          h('span', { className: 'dsh-ws-music-savedpath', title: savedPath }, savedPath))),
    h('span', { className: 'dsh-ws-music-spacer' }),
    h('button', {
      'aria-expanded': cacheOpen,
      'aria-haspopup': 'dialog',
      className: 'dsh-ws-music-cache-trigger',
      disabled: cacheScope === null,
      onClick: () => {
        setCacheOpen(open => !open)
        setStyleOpen(false)
        setMoodOpen(false)
        setInstrumentsOpen(false)
      },
      ref: cacheButtonRef,
      title: translate('music.cache.triggerTitle'),
      type: 'button',
    },
    h('span', { 'aria-hidden': true, className: 'dsh-ws-music-cache-stack' }, h('i', { key: 'back' }), h('i', { key: 'front' })),
    h('span', { className: 'dsh-ws-music-cache-label' }, translate('music.cache.trigger')),
    h('b', null, String(cacheEntries.length + 1)),
    h('span', { 'aria-hidden': true, className: 'dsh-ws-music-cache-caret' }, '▾')),
    h('button', { className: 'dsh-ws-text-button', disabled: hostReady !== true, onClick: saveNow, title: translate('music.save.shortcutTitle'), type: 'button' }, translate('music.save')),
    h('button', { className: 'dsh-ws-text-button', disabled: hostReady !== true, onClick: showOpen, type: 'button' }, translate('music.open'))),

  h('div', { className: 'dsh-ws-music-transport' },
    h('button', {
      'aria-label': playing ? translate('music.play.pause') : translate('music.play.play'),
      className: 'dsh-ws-music-play',
      onClick: togglePlay,
      type: 'button',
    }, playing ? '❚❚' : '▶'),
    h('button', { className: 'dsh-ws-music-icon-button', onClick: () => stopPlayback(true), title: translate('music.play.stop'), type: 'button' }, '■'),
    h('button', {
      'aria-pressed': loop,
      className: 'dsh-ws-music-toggle',
      'data-on': loop || undefined,
      onClick: () => {
        setLoop(!loop)
      },
      title: translate('music.loop'),
      type: 'button',
    }, `⟲ ${translate('music.loop')}`),
    h('span', { className: 'dsh-ws-music-sep' }),
    h('div', { className: 'dsh-ws-music-bpm' },
      h('span', { className: 'dsh-ws-music-field-label' }, 'BPM'),
      h('b', null, String(doc.bpm)),
      h('span', { className: 'dsh-ws-music-stepper' },
        h('button', { 'aria-label': 'BPM +', onClick: () => changeBpm(1), type: 'button' }, '▴'),
        h('button', { 'aria-label': 'BPM −', onClick: () => changeBpm(-1), type: 'button' }, '▾'))),
    h('span', { className: 'dsh-ws-music-field' }, h('i', null, '4/4'), h('span', null, keyLabel(doc))),
    h('span', { className: 'dsh-ws-music-field' }, h('i', null, translate('music.bars')), h('span', null, String(doc.bars))),
    h('div', { className: 'dsh-ws-music-volume' },
      h('span', null, '♫'),
      h('input', {
        'aria-label': translate('music.volume'),
        max: 100,
        min: 0,
        onChange: (event) => {
          const next = Number(event.target.value) / 100
          setVolume(next)
          engineRef.current?.setVolume(next)
        },
        type: 'range',
        value: Math.round(volume * 100),
      })),
    h('span', { className: 'dsh-ws-music-time' }, `${formatClock(position)} / ${formatClock(duration)}`)),

  hostReady === false ? h('div', { className: 'dsh-ws-music-banner' }, translate('music.hostRestart')) : null,
  hostReady !== false && samplesLoading ? h('div', { className: 'dsh-ws-music-banner', role: 'status' }, translate('music.samples.loading')) : null,
  hostReady !== false && !samplesLoading && samplesError !== '' ? h('div', { className: 'dsh-ws-music-banner', role: 'alert' }, `${translate('music.samples.failed')} ${samplesError}`) : null,

  h('div', { className: 'dsh-ws-music-scroll' },
    h('div', { className: 'dsh-ws-music-work' },
      /* left: AI compose + history */
      h('div', { className: 'dsh-ws-music-compose' },
        h('section', { className: 'dsh-ws-music-card' },
          h('button', {
            'aria-expanded': composeOpen,
            className: 'dsh-ws-music-card-head dsh-ws-music-card-toggle',
            onClick: () => setComposeOpen(!composeOpen),
            type: 'button',
          },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-music-card-mark' }, '✦'),
          h('span', { className: 'dsh-ws-music-card-title' }, translate('music.compose.title')),
          h('span', { className: 'dsh-ws-music-chevron', 'data-open': composeOpen || undefined }, '▾')),
          composeOpen ? h('div', { className: 'dsh-ws-music-compose-body' },
            h('div', { className: 'dsh-ws-music-prompt-wrap' },
              h('textarea', {
                'aria-label': translate('music.compose.prompt'),
                className: 'dsh-ws-music-prompt',
                onChange: event => setPromptText(event.target.value.slice(0, 2000)),
                placeholder: translate('music.compose.promptPlaceholder'),
                rows: 3,
                value: promptText,
              }),
              h('span', { className: 'dsh-ws-music-prompt-count' }, `${promptText.length} / 2000`)),
            h('div', { className: 'dsh-ws-music-choice-row' },
              h('button', {
                'aria-expanded': styleOpen,
                'aria-haspopup': 'dialog',
                className: 'dsh-ws-music-choice',
                onClick: toggleStyleChoice,
                ref: styleButtonRef,
                style: { '--choice-c': styleColor(style) },
                type: 'button',
              },
              h('span', { className: 'dsh-ws-music-choice-cap' }, translate('music.compose.style')),
              h('span', { className: 'dsh-ws-music-choice-value' },
                h('i', { 'aria-hidden': true }),
                h('span', null, styleLabel),
                h('b', { 'aria-hidden': true }, '▾'))),
              h('button', {
                'aria-expanded': moodOpen,
                'aria-haspopup': 'dialog',
                className: 'dsh-ws-music-choice',
                onClick: toggleMoodChoice,
                ref: moodButtonRef,
                style: { '--choice-c': moodColor(mood) },
                type: 'button',
              },
              h('span', { className: 'dsh-ws-music-choice-cap' }, translate('music.compose.mood')),
              h('span', { className: 'dsh-ws-music-choice-value' },
                h('i', { 'aria-hidden': true }),
                h('span', null, moodLabel),
                h('b', { 'aria-hidden': true }, '▾')))),
            h('div', { className: 'dsh-ws-music-param-box' },
              h('label', { className: 'dsh-ws-music-slider' },
                h('span', null, translate('music.compose.density')),
                h('input', { max: 100, min: 0, onChange: event => setDensity(Number(event.target.value) / 100), type: 'range', value: Math.round(density * 100) }),
                h('b', null, `${Math.round(density * 100)}%`)),
              h('label', { className: 'dsh-ws-music-slider' },
                h('span', null, translate('music.compose.complexity')),
                h('input', { max: 100, min: 0, onChange: event => setComplexity(Number(event.target.value) / 100), type: 'range', value: Math.round(complexity * 100) }),
                h('b', null, `${Math.round(complexity * 100)}%`))),
            h('div', { className: 'dsh-ws-music-duration' },
              h('span', { className: 'dsh-ws-music-chip-label' }, translate('music.compose.duration')),
              h('div', { className: 'dsh-ws-music-duration-row' },
                h('label', { className: 'dsh-ws-music-duration-input' },
                  h('input', {
                    'aria-label': translate('music.compose.duration'),
                    max: MUSIC_DURATION_MAX_SECONDS,
                    min: MUSIC_DURATION_MIN_SECONDS,
                    onBlur: (event) => {
                      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.dsh-ws-music-duration-preset') !== null) return
                      commitDurationInput()
                    },
                    onChange: event => setDurationText(event.target.value.slice(0, 4)),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        setDurationText(String(Math.round(scoreSeconds(docRef.current))))
                        event.currentTarget.blur()
                      }
                    },
                    step: 1,
                    type: 'number',
                    value: durationText,
                  }),
                  h('span', null, translate('music.duration.unit'))),
                h('div', { className: 'dsh-ws-music-duration-presets' }, DURATION_PRESETS.map(seconds => h('button', {
                  'aria-pressed': Math.abs(duration - seconds) < 0.05,
                  className: 'dsh-ws-music-duration-preset',
                  key: seconds,
                  onClick: () => requestDuration(seconds),
                  type: 'button',
                }, `${seconds}s`)))),
              h('div', { className: 'dsh-ws-music-duration-readout' }, translate('music.duration.actual', {
                bars: String(doc.bars),
                bpm: String(doc.bpm),
                seconds: formatSeconds(duration),
              })),
              h('div', { className: 'dsh-ws-music-switch-row' },
                h('span', { className: 'dsh-ws-music-switch-copy' },
                  h('b', null, translate('music.compose.seamless'))),
                h('button', {
                  'aria-checked': doc.prompt.seamless !== false,
                  'aria-label': translate('music.compose.seamless'),
                  className: 'dsh-ws-music-switch',
                  onClick: toggleSeamless,
                  role: 'switch',
                  type: 'button',
                }, h('span', { 'aria-hidden': true })))),
            /* Both fields share one inline grid: a max-content label column and a full-width
               control column, so 乐器 / 生成模型 line up on the same two axes. */
            h('div', { className: 'dsh-ws-music-field-grid' },
              h('span', { className: 'dsh-ws-music-chip-label' }, translate('music.compose.instruments')),
              h('button', {
                'aria-expanded': instrumentsOpen,
                'aria-haspopup': 'dialog',
                className: 'dsh-ws-music-instrument-button',
                onClick: () => {
                  setInstrumentsOpen(open => !open)
                  setStyleOpen(false)
                  setMoodOpen(false)
                  setCacheOpen(false)
                },
                ref: instrumentsButtonRef,
                title: translate('music.compose.instrumentTitle'),
                type: 'button',
              }, translate('music.compose.instrumentChoose', { count: composeInstruments.length }),
              h('span', { 'aria-hidden': true, className: 'dsh-ws-music-instrument-caret' }, '▾')),
              h('span', { className: 'dsh-ws-music-chip-label' }, translate('music.compose.model')),
              h('div', { className: 'dsh-ws-music-select-wrap' },
                h('select', {
                  'aria-label': translate('music.compose.model'),
                  className: 'dsh-ws-music-select',
                  onChange: (event) => {
                    const value = event.target.value
                    if (value === 'session') {
                      onMusicPrefs?.({ model: null })
                      return
                    }
                    const found = models.find(model => musicModelKey(model) === value)
                    if (found !== undefined) onMusicPrefs?.({ model: { provider: found.provider, model: found.model } })
                  },
                  title: translate('music.compose.model'),
                  value: selectedModelValue,
                },
                h('option', { key: 'session', value: 'session' }, chatModel === null
                  ? translate('music.compose.followChatUnavailable')
                  : translate('music.compose.followChat', { model: chatModelLabel })),
                fixedModel !== null && !fixedModelAvailable
                  ? h('option', { key: selectedModelValue, value: selectedModelValue }, `${fixedModel.model} · ${translate('music.compose.modelUnavailable')}`)
                  : null,
                models.map(model => h('option', { key: musicModelKey(model), value: musicModelKey(model) }, model.name ?? model.model))),
                h('span', { 'aria-hidden': true, className: 'dsh-ws-music-select-caret' }, '▾'))),
            h('div', { className: 'dsh-ws-music-compose-actions' },
              h('button', {
                className: 'dsh-ws-music-primary',
                disabled: composing || hostReady !== true || !samplesReady,
                onClick: () => void runCompose(),
                type: 'button',
              }, composing ? translate('music.compose.running') : translate('music.compose.action')),
              composing
                ? h('button', {
                  className: 'dsh-ws-music-cancel',
                  onClick: cancelCompose,
                  title: translate('music.compose.cancel'),
                  type: 'button',
                }, h('span', { 'aria-hidden': true, className: 'dsh-ws-music-stop' }, '■'), translate('music.compose.cancel'))
                : null),
            composing
              ? h('div', { className: 'dsh-ws-music-progress', role: 'status' }, h('i', null), h('span', null, composeStage !== null && composeStage.total > 1
                ? translate('music.compose.progressSegment', { index: String(composeStage.index), total: String(composeStage.total) })
                : translate('music.compose.progress')))
              : null)
          : null),
      /* Selected-track / selected-note inspector, directly under the AI card. */
        h('aside', { className: 'dsh-ws-music-inspector' },
          h('section', { className: 'dsh-ws-music-card' },
            h('div', { className: 'dsh-ws-music-card-head' },
              h('span', { 'aria-hidden': true, className: 'dsh-ws-music-card-mark' }, '▤'),
              h('span', { className: 'dsh-ws-music-card-title' }, translate('music.inspector.track'))),
            activeTrack === null
              ? h('p', { className: 'dsh-ws-music-empty-note' }, translate('music.inspector.noTrack'))
              : h('div', { className: 'dsh-ws-music-track-fields' },
                h('div', { className: 'dsh-ws-music-track-id' },
                  h('span', { 'aria-hidden': true, className: 'dsh-ws-music-track-swatch', style: { background: activeInfo.color } }),
                  h('span', null, h('b', null, trackDisplayName(activeTrack)), h('em', null, translate(activeInfo.nameKey)))),
                h('label', { className: 'dsh-ws-music-field-row' },
                  h('span', null, translate('music.inspector.name')),
                  h('input', {
                    className: 'dsh-ws-dialog-input',
                    maxLength: 40,
                    onChange: event => renameTrack(event.target.value),
                    placeholder: translate(activeInfo.nameKey),
                    type: 'text',
                    value: activeTrack.name,
                  })),
                h('label', { className: 'dsh-ws-music-slider' },
                  h('span', null, translate('music.inspector.volume')),
                  h('input', {
                    max: 100,
                    min: 0,
                    onChange: event => setTrackVolume(Number(event.target.value) / 100),
                    type: 'range',
                    value: Math.round(activeTrack.volume * 100),
                  }),
                  h('b', null, String(Math.round(activeTrack.volume * 100)))),
                h('div', { className: 'dsh-ws-music-track-actions' },
                  h('button', { className: 'dsh-ws-music-mini-button', 'data-on': activeTrack.muted || undefined, onClick: () => toggleMute(activeTrack.id), type: 'button' }, translate('music.inspector.mute')),
                  h('button', { className: 'dsh-ws-music-mini-button', 'data-on': activeTrack.solo || undefined, onClick: () => toggleSolo(activeTrack.id), type: 'button' }, translate('music.inspector.solo')),
                  h('button', { className: 'dsh-ws-music-mini-button', onClick: () => moveTrack(-1), type: 'button' }, '↑'),
                  h('button', { className: 'dsh-ws-music-mini-button', onClick: () => moveTrack(1), type: 'button' }, '↓')),
                h('div', { className: 'dsh-ws-music-track-actions' },
                  h('button', { className: 'dsh-ws-music-mini-button', onClick: duplicateTrack, type: 'button' }, translate('music.inspector.duplicateTrack')),
                  h('button', { className: 'dsh-ws-music-mini-button dsh-ws-music-danger', onClick: deleteTrack, type: 'button' }, translate('music.inspector.removeTrack'))))),
          h('section', { className: 'dsh-ws-music-card' },
            h('div', { className: 'dsh-ws-music-card-head' },
              h('span', { 'aria-hidden': true, className: 'dsh-ws-music-card-mark' }, '▮'),
              h('span', { className: 'dsh-ws-music-card-title' }, translate('music.inspector.note'))),
            activeTrack === null || activeTrack.kind === 'drums'
              ? h('p', { className: 'dsh-ws-music-empty-note' }, translate(activeTrack === null ? 'music.inspector.none' : 'music.inspector.drumNote'))
              : selectedNoteFound === null
                ? h('p', { className: 'dsh-ws-music-empty-note' }, translate('music.inspector.none'))
                : h('div', { className: 'dsh-ws-music-note-fields' },
                  h('div', { className: 'dsh-ws-music-note-grid' },
                    h('span', null, translate('music.inspector.pitch')), h('b', null, midiName(selectedNoteFound.note.midi)),
                    h('span', null, translate('music.inspector.start')), h('b', null, startLabel(selectedNoteFound.note.bar, selectedNoteFound.note.step)),
                    h('span', null, translate('music.inspector.length')), h('b', null, noteValueLabel(selectedNoteFound.note.len)),
                    h('span', null, translate('music.inspector.velocity')), h('b', null, String(selectedNoteFound.note.vel))),
                  h('label', { className: 'dsh-ws-music-slider' },
                    h('span', null, translate('music.inspector.velocity')),
                    h('input', {
                      max: 127,
                      min: 1,
                      onChange: event => setVelocity(Number(event.target.value)),
                      type: 'range',
                      value: selectedNoteFound.note.vel,
                    }),
                    h('b', null, String(selectedNoteFound.note.vel))),
                  h('div', { className: 'dsh-ws-music-note-actions' },
                    h('button', { className: 'dsh-ws-music-mini-button', onClick: duplicateNote, type: 'button' }, translate('music.inspector.duplicate')),
                    h('button', { className: 'dsh-ws-music-mini-button dsh-ws-music-danger', onClick: () => removeNote(selectedNote.index), type: 'button' }, translate('music.inspector.remove'))))),
        history.length === 0 ? null : h('section', { className: 'dsh-ws-music-card' },
          h('div', { className: 'dsh-ws-music-card-head' },
            h('span', { 'aria-hidden': true, className: 'dsh-ws-music-card-mark' }, '↺'),
            h('span', { className: 'dsh-ws-music-card-title' }, translate('music.inspector.history'))),
          h('div', { className: 'dsh-ws-music-history' }, history.map(entry => h('div', { className: 'dsh-ws-music-history-row', key: entry.at },
            h('time', null, new Date(entry.at).toLocaleTimeString()),
            h('span', null, entry.label),
            h('button', {
              className: 'dsh-ws-music-mini-button',
              onClick: () => {
                stopPlayback(true)
                commit(cloneDoc(entry.doc))
                const first = entry.doc.tracks[0] ?? null
                setSelectedTrackId(first?.id ?? null)
                setSelectedNote(firstNoteSelection(first))
                setComposeInstruments(entry.doc.prompt.instruments)
                setDurationText(String(Math.round(scoreSeconds(entry.doc))))
              },
              title: translate('music.inspector.restore'),
              type: 'button',
            }, '↺'))))))),

      /* center: arrangement + context editor */
      h('div', { className: 'dsh-ws-music-main' },
        h(Arrangement, {
          barWidth: arrangeBarWidth,
          doc,
          onAddTrack: () => setPickerOpen(true),
          onMuteAll: () => setAllMuted(true),
          onReorderTrack: reorderTrack,
          onSelectTrack: selectTrack,
          onToggleMute: toggleMute,
          onToggleSolo: toggleSolo,
          onUnmuteAll: () => setAllMuted(false),
          onZoom: value => onMusicPrefs?.({ arrangeZoom: value }),
          playhead,
          selectedTrackId: activeTrack?.id ?? null,
          zoom: musicPrefs?.arrangeZoom ?? 1,
        }),
        h('section', { className: 'dsh-ws-music-editor' },
          h('div', { className: 'dsh-ws-music-editor-head' },
            h('span', { 'aria-hidden': true, className: 'dsh-ws-music-editor-dot', style: activeInfo === null ? undefined : { background: activeInfo.color } }),
            h('span', { className: 'dsh-ws-music-editor-name' }, activeTrack === null
              ? translate('music.editor.title')
              : trackDisplayName(activeTrack)),
            activeTrack === null ? null : h('span', { className: 'dsh-ws-music-editor-inst' }, translate(activeInfo.nameKey)),
            h('span', { className: 'dsh-ws-music-spacer' }),
            activeTrack === null || activeTrack.kind === 'drums' ? null : h('span', { className: 'dsh-ws-music-editor-count' }, translate('music.editor.noteCount', { count: String(activeTrack.notes.length) })),
            h('button', {
              'aria-label': translate('music.editor.undo'),
              className: 'dsh-ws-music-editor-action',
              disabled: !canUndo,
              onClick: undoTrackEdit,
              title: translate('music.editor.undoTitle'),
              type: 'button',
            }, h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
              h('path', {
                d: 'M6.3 5.2 3.5 8l2.8 2.8M3.7 8h5.1c2.3 0 4.1 1.5 4.1 3.5',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'stroke-width': 1.2,
              }))),
            h('button', {
              'aria-label': translate('music.editor.redo'),
              className: 'dsh-ws-music-editor-action',
              disabled: !canRedo,
              onClick: redoTrackEdit,
              title: translate('music.editor.redoTitle'),
              type: 'button',
            }, h('svg', { 'aria-hidden': true, viewBox: '0 0 16 16' },
              h('path', {
                d: 'M9.7 5.2 12.5 8l-2.8 2.8M12.3 8H7.2c-2.3 0-4.1 1.5-4.1 3.5',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'stroke-width': 1.2,
              })))),
          h('div', { className: 'dsh-ws-music-editor-body' },
            activeTrack === null
              ? h('div', { className: 'dsh-ws-music-editor-empty' },
                h('b', null, translate('music.editor.empty')),
                h('span', null, translate('music.editor.emptyHint')),
                h('button', { className: 'dsh-ws-music-mini-button', onClick: () => setPickerOpen(true), type: 'button' }, `＋ ${translate('music.arrange.add')}`))
              : activeTrack.kind === 'drums'
                ? h(DrumMachine, {
                  activeBar,
                  bars: doc.bars,
                  humanize: doc.humanize,
                  onActiveBar: setActiveBar,
                  onChange: changeGroove,
                  onToggle: toggleDrum,
                  onVary: varyDrumBar,
                  swing: doc.swing,
                  track: activeTrack,
                })
                : h(PianoRoll, {
                  bars: doc.bars,
                  baseGridWidth: rollBaseWidth,
                  baseRowHeight: rollBaseHeight,
                  color: activeInfo.color,
                  height: musicPrefs?.rollHeight ?? null,
                  onAdd: addNote,
                  onAudition: auditionNote,
                  onChange: changeNote,
                  onDelete: removeNote,
                  onHeight: value => onMusicPrefs?.({ rollHeight: value }),
                  onSelect: index => setSelectedNote({ trackId: activeTrack.id, index }),
                  onZoomX: value => onMusicPrefs?.({ rollZoomX: value }),
                  onZoomY: value => onMusicPrefs?.({ rollZoomY: value }),
                  playhead,
                  selectedIndex: selectedNote !== null && selectedNote.trackId === activeTrack.id ? selectedNote.index : null,
                  track: activeTrack,
                  zoomX: musicPrefs?.rollZoomX ?? 1,
                  zoomY: musicPrefs?.rollZoomY ?? 1,
                }))),
        ))),


  h('div', { className: 'dsh-ws-music-status' },
    h('span', null, `${doc.bars} ${translate('music.barsUnit')} · ${formatClock(duration)}`),
    h('span', null, `${doc.bpm} BPM · ${keyLabel(doc)}`),
    h('span', null, translate('music.status.tracks', { count: String(doc.tracks.length) })),
    h('span', null, translate('music.status.notes', { count: notesTotal })),
    h('span', { className: 'dsh-ws-music-spacer' }),
    status === null ? null : h('span', { className: 'dsh-ws-music-status-text', 'data-error': status.error || undefined }, status.text)),

  cacheOpen ? h(MusicCachePopover, {
    anchorRef: cacheButtonRef,
    current: {
      bars: doc.bars,
      mood: doc.prompt.mood,
      seconds: scoreSeconds(doc),
      style: doc.prompt.style,
      title: doc.title,
      updatedAt: doc.updatedAt,
    },
    entries: cacheEntries,
    error: cacheError,
    loading: cacheLoading,
    onClose: () => setCacheOpen(false),
    onDelete: deleteCacheEntry,
    onSelect: loadCachedEntry,
  }) : null,

  styleOpen ? h(ComposeChoicePopover, {
    anchorRef: styleButtonRef,
    hint: translate('music.compose.styleHint'),
    kind: 'style',
    onCancel: () => setStyleOpen(false),
    onSelect: chooseStyle,
    options: styleOptions,
    selected: style,
    title: translate('music.compose.styleTitle'),
    width: 300,
  }) : null,

  moodOpen ? h(ComposeChoicePopover, {
    anchorRef: moodButtonRef,
    hint: translate('music.compose.moodHint'),
    kind: 'mood',
    onCancel: () => setMoodOpen(false),
    onSelect: chooseMood,
    options: moodOptions,
    selected: mood,
    title: translate('music.compose.moodTitle'),
    width: 300,
  }) : null,

  instrumentsOpen ? h(ComposeInstrumentsPopover, {
    anchorRef: instrumentsButtonRef,
    selected: composeInstruments,
    onApply: applyComposeInstruments,
    onCancel: () => setInstrumentsOpen(false),
  }) : null,

  pickerOpen ? h(InstrumentPicker, {
    onAdd: addTrack,
    onCancel: () => setPickerOpen(false),
  }) : null,

  saveOpen ? h(MusicSaveDialog, {
    busy: saving,
    /* Prefill this piece's remembered path (dir + file name), else the configured default folder
       and the score title. Confirming here is what re-points the piece at a new path. */
    defaultDir: savedPathRef.current === '' ? defaultSaveDir : parseSavedPath(savedPathRef.current).dir,
    defaultName: savedPathRef.current === ''
      ? safeFileName(doc.title)
      : stripMusicSuffix(parseSavedPath(savedPathRef.current).name),
    error: saveError,
    onCancel: () => { if (!saving) { setSaveOpen(false); setSaveError(null) } },
    onConfirm: (dir, name) => void doSave(dir, name),
  }) : null,

  openOpen ? h(MusicOpenDialog, {
    dir: openDir,
    error: openError,
    files: openFiles,
    loading: openLoading,
    onCancel: () => setOpenOpen(false),
    onDir: (dir, refresh) => {
      setOpenDir(dir)
      if (refresh === true) void refreshOpen(dir)
    },
    onPick: pickOpen,
  }) : null,

  discardPath === null ? null : h(MusicDiscardDialog, {
    onCancel: () => setDiscardPath(null),
    onConfirm: () => void loadPath(discardPath),
    path: discardPath,
  }),

  durationConfirm === null ? null : h(MusicDurationDialog, {
    bars: durationConfirm.bars,
    onCancel: () => {
      setDurationConfirm(null)
      setDurationText(String(Math.round(scoreSeconds(docRef.current))))
    },
    onConfirm: () => {
      const target = durationConfirm
      setDurationConfirm(null)
      applyDurationBars(target.bars)
    },
    removed: durationConfirm.removed,
    seconds: durationConfirm.seconds,
  }))
}




