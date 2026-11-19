/* Music workshop dock: a GarageBand-style instrument rack with a shared timeline, a
 * context editor (piano roll for melodic tracks, drum grid for drum tracks), Web Audio
 * playback and score files under the workspace's music directory.
 *
 * The score owns any number of instrument tracks; the panel edits one selected track at a
 * time. The piano roll supports a paint stroke (pointer-down + drag lights consecutive
 * cells), which is the fast path for writing a run of sixteenths.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translate, useLocaleText } from '../../locale/index.js'
import { composeMusicRequest, listMusicRequest, loadMusicRequest, musicSchemaRequest, saveMusicRequest } from '../../api.js'
import {
  MUSIC_BARS_MAX,
  MUSIC_DURATION_MAX_SECONDS,
  MUSIC_DURATION_MIN_SECONDS,
  MUSIC_MOOD_IDS,
  MUSIC_STEPS_PER_BAR,
  MUSIC_STYLE_IDS,
  barsForSeconds,
  buildMusicPlan,
  composeMusicScore,
  midiName,
  normalizeMusicDoc,
  normalizeMusicInstruments,
  scoreSeconds,
} from '../../../shared/music-score.js'
import { useMindmapSummaryModels } from '../../hooks/mindmap-summary-models.js'
import { useChatModel } from '../../chat-model.js'
import { isFollowChatModel, musicModelKey } from '../../music-prefs.js'
import { MusicDiscardDialog, MusicDurationDialog, MusicOpenDialog, MusicSaveDialog } from './dialogs.js'
import { ComposeInstrumentsPopover } from './compose-instruments.js'
import { composeRanges, mergeComposedSegments } from './compose-run.js'
import { Arrangement } from './arrangement.js'
import { DrumMachine } from './drums.js'
import { InstrumentPicker } from './picker.js'
import { PianoRoll } from './roll.js'
import { createMusicEngine } from './synth.js'
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

export function MusicDock({ active = true, chatSessionId, musicPrefs, onMusicPrefs, onSaved, onUpdate, tab, workspace }) {
  useLocaleText()
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

  const [doc, setDoc] = useState(() => normalizeMusicDoc(tab.musicDoc) ?? composeMusicScore({ bars: 8 }))
  const docRef = useRef(doc)
  docRef.current = doc

  const [durationText, setDurationText] = useState(() => String(Math.round(scoreSeconds(doc))))
  const [durationConfirm, setDurationConfirm] = useState(null)
  const [composeStage, setComposeStage] = useState(null)

  const [savedPath, setSavedPath] = useState(typeof tab.savedPath === 'string' ? tab.savedPath : '')
  const savedPathRef = useRef(savedPath)
  savedPathRef.current = savedPath
  const [dirty, setDirty] = useState(tab.dirty === true)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const [selectedTrackId, setSelectedTrackId] = useState(() => doc.tracks[0]?.id ?? null)
  const [selectedNote, setSelectedNote] = useState(() => firstNoteSelection(doc.tracks[0]))
  const [activeBar, setActiveBar] = useState(1)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(true)
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)
  playingRef.current = playing
  const [position, setPosition] = useState(0)
  const [loop, setLoop] = useState(true)
  const [volume, setVolume] = useState(0.8)
  const [composing, setComposing] = useState(false)
  const [status, setStatus] = useState(null)
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

  const [style, setStyle] = useState(doc.prompt.style)
  const [mood, setMood] = useState(doc.prompt.mood)
  const [promptText, setPromptText] = useState(doc.prompt.text)
  const [density, setDensity] = useState(doc.prompt.density)
  const [complexity, setComplexity] = useState(doc.prompt.complexity)
  const [composeOpen, setComposeOpen] = useState(true)
  const [composeInstruments, setComposeInstruments] = useState(() => normalizeMusicInstruments(doc.prompt.instruments))
  const [instrumentsOpen, setInstrumentsOpen] = useState(false)
  const [hostReady, setHostReady] = useState(null)

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
  const activeTrack = doc.tracks.find(track => track.id === selectedTrackId) ?? doc.tracks[0] ?? null
  const activeInfo = activeTrack === null ? null : instrumentInfo(activeTrack.instrument)
  const selectedNoteFound = findNote(doc, selectedNote)

  useEffect(() => {
    setDurationText(String(Math.round(scoreSeconds(docRef.current))))
  }, [doc.bars, doc.bpm])

  /* The running Host may still be the pre-multi-track build: old save/load flatten instrument
     tracks into the fixed melody/chords/bass shape. Refuse to save or compose until the Host
     reports the current score schema, so a client refresh alone can never destroy a score. */
  useEffect(() => {
    let alive = true
    musicSchemaRequest()
      .then((payload) => {
        if (alive) {
          setHostReady(payload.version === 2
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
    const engine = createMusicEngine()
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
    const started = engine.play(playbackDoc, { from, loop, seamless: playbackDoc.prompt.seamless !== false })
    if (!started) {
      setStatus({ error: true, text: translate('music.play.unavailable') })
      return
    }
    setPlaying(true)
    playingRef.current = true
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [loop, tick, volume])

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
    }
    if (options.restart === true && changed) restartPlayback(next)
  }, [restartPlayback, scheduleSync])

  const selectTrack = useCallback((trackId) => {
    const track = docRef.current.tracks.find(item => item.id === trackId)
    if (track === undefined) return
    setSelectedTrackId(trackId)
    setSelectedNote(firstNoteSelection(track))
    setActiveBar(1)
  }, [])

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

  const applyLoadedDoc = useCallback((next, path) => {
    stopPlayback(true)
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

  /* ── compose ─────────────────────────────────────────────────────────────── */
  const runCompose = async () => {
    if (composing) return
    if (hostReady !== true) { setStatus({ error: true, text: translate('music.hostRestart') }); return }
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
      setHistory(history => [{ at: Date.now(), doc: cloneDoc(current), label: translate('music.history.generated') }, ...history].slice(0, 6))
      docRef.current = next
      setDoc(next)
      setDirty(true)
      setSelectedTrackId(next.tracks[0]?.id ?? null)
      setSelectedNote(firstNoteSelection(next.tracks[0]))
      setActiveBar(1)
      setComposeInstruments(next.prompt.instruments)
      flushToTab(next)
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

  const saveNow = () => {
    if (hostReady !== true) { setStatus({ error: true, text: translate('music.hostRestart') }); return }
    if (savedPathRef.current !== '') {
      const parsed = parseSavedPath(savedPathRef.current)
      void doSave(parsed.dir, stripMusicSuffix(parsed.name))
      return
    }
    setSaveError(null)
    setSaveOpen(true)
  }

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
    const parsed = parseSavedPath(savedPathRef.current)
    const dir = parsed.dir === '' ? 'music' : parsed.dir
    setOpenOpen(true)
    setOpenFiles([])
    setOpenError(null)
    void refreshOpen(dir)
  }

  const loadPath = async (path) => {
    try {
      setOpenError(null)
      const result = await loadMusicRequest(workspace.workspaceId, path)
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
    commit(next)
    return noteIndexIn(next, activeTrack.id, note)
  }

  const changeNote = (index, patch) => {
    if (activeTrack === null) return
    commit(patchNote(docRef.current, activeTrack.id, index, patch))
  }

  const removeNote = (index) => {
    if (activeTrack === null) return
    commit(deleteNoteAt(docRef.current, activeTrack.id, index))
    setSelectedNote(null)
  }

  const duplicateNote = () => {
    if (selectedNoteFound === null) return
    const copy = {
      ...selectedNoteFound.note,
      step: Math.min(15, selectedNoteFound.note.step + Math.max(1, selectedNoteFound.note.len)),
    }
    const next = addNoteTo(docRef.current, selectedNoteFound.track.id, copy)
    commit(next)
    setSelectedNote({ trackId: selectedNoteFound.track.id, index: noteIndexIn(next, selectedNoteFound.track.id, copy) })
  }

  const setVelocity = (value) => {
    if (selectedNote === null) return
    commit(patchNote(docRef.current, selectedNote.trackId, selectedNote.index, { vel: value }))
  }

  const toggleDrum = (lane, barIndex, step) => {
    if (activeTrack === null || activeTrack.kind !== 'drums') return
    replaceTrack({ ...activeTrack, drums: toggleDrumStep(activeTrack.drums, lane, barIndex, step, 104) })
  }

  const varyDrumBar = () => {
    if (activeTrack === null || activeTrack.kind !== 'drums') return
    replaceTrack({ ...activeTrack, drums: varyDrums(activeTrack.drums, docRef.current.bars, activeBar - 1, docRef.current.prompt.density) })
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
    onKeyDown: (event) => {
      const tag = event.target?.tagName
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
        type: 'text',
        value: doc.title,
      }),
      h('span', { className: 'dsh-ws-music-subtitle' },
        dirty || savedPath === '' ? translate('music.unsaved') : translate('music.savedState'),
        savedPath === '' ? null : h('span', { className: 'dsh-ws-music-savedpath', title: savedPath }, savedPath))),
    h('span', { className: 'dsh-ws-music-spacer' }),
    h('button', { className: 'dsh-ws-text-button', disabled: hostReady !== true, onClick: saveNow, type: 'button' }, translate('music.save')),
    h('button', { className: 'dsh-ws-text-button dsh-ws-music-head-secondary', disabled: hostReady !== true, onClick: () => { setSaveError(null); setSaveOpen(true) }, type: 'button' }, translate('music.saveAs')),
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
            h('textarea', {
              'aria-label': translate('music.compose.prompt'),
              className: 'dsh-ws-music-prompt',
              onChange: event => setPromptText(event.target.value.slice(0, 2000)),
              placeholder: translate('music.compose.promptPlaceholder'),
              rows: 3,
              value: promptText,
            }),
            h('div', { className: 'dsh-ws-music-chip-label' }, translate('music.compose.style')),
            h('div', { className: 'dsh-ws-music-chips' }, MUSIC_STYLE_IDS.map(id => h('button', {
              'aria-pressed': style === id,
              className: 'dsh-ws-music-chip',
              key: id,
              onClick: () => setStyle(id),
              type: 'button',
            }, translate(`music.style.${id}`)))),
            h('div', { className: 'dsh-ws-music-chip-label' }, translate('music.compose.mood')),
            h('div', { className: 'dsh-ws-music-chips' }, MUSIC_MOOD_IDS.map(id => h('button', {
              'aria-pressed': mood === id,
              className: 'dsh-ws-music-chip',
              key: id,
              onClick: () => setMood(id),
              type: 'button',
            }, translate(`music.mood.${id}`)))),
            h('label', { className: 'dsh-ws-music-slider' },
              h('span', null, translate('music.compose.density')),
              h('input', { max: 100, min: 0, onChange: event => setDensity(Number(event.target.value) / 100), type: 'range', value: Math.round(density * 100) }),
              h('b', null, `${Math.round(density * 100)}%`)),
            h('label', { className: 'dsh-ws-music-slider' },
              h('span', null, translate('music.compose.complexity')),
              h('input', { max: 100, min: 0, onChange: event => setComplexity(Number(event.target.value) / 100), type: 'range', value: Math.round(complexity * 100) }),
              h('b', null, `${Math.round(complexity * 100)}%`)),
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
              }))),
            h('div', { className: 'dsh-ws-music-switch-row' },
              h('span', { className: 'dsh-ws-music-switch-copy' },
                h('b', null, translate('music.compose.seamless')),
                h('em', null, translate('music.compose.seamlessHint'))),
              h('button', {
                'aria-checked': doc.prompt.seamless !== false,
                'aria-label': translate('music.compose.seamless'),
                className: 'dsh-ws-music-switch',
                onClick: toggleSeamless,
                role: 'switch',
                type: 'button',
              }, h('span', { 'aria-hidden': true }))),
            h('div', { className: 'dsh-ws-music-instrument-row' },
              h('span', { className: 'dsh-ws-music-chip-label' }, translate('music.compose.instruments')),
              h('button', {
                'aria-expanded': instrumentsOpen,
                'aria-haspopup': 'dialog',
                className: 'dsh-ws-music-instrument-button',
                onClick: () => setInstrumentsOpen(open => !open),
                ref: instrumentsButtonRef,
                title: translate('music.compose.instrumentTitle'),
                type: 'button',
              }, translate('music.compose.instrumentChoose', { count: composeInstruments.length }),
              h('span', { 'aria-hidden': true, className: 'dsh-ws-music-instrument-caret' }, '▾'))),
            h('div', { className: 'dsh-ws-music-compose-row' },
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
              models.map(model => h('option', { key: musicModelKey(model), value: musicModelKey(model) }, model.name ?? model.model)))),
            h('div', { className: 'dsh-ws-music-compose-actions' },
              h('button', {
                className: 'dsh-ws-music-primary',
                disabled: composing || hostReady !== true,
                onClick: () => void runCompose(),
                type: 'button',
              }, composing ? translate('music.compose.running') : translate('music.compose.action')),
              composing
                ? h('button', { className: 'dsh-ws-music-mini-button', onClick: cancelCompose, type: 'button' }, translate('music.compose.cancel'))
                : h('button', { className: 'dsh-ws-music-mini-button', onClick: () => void runCompose(), title: translate('music.compose.again'), type: 'button' }, '↻')),
            composing
              ? h('div', { className: 'dsh-ws-music-progress', role: 'status' }, h('i', null), h('span', null, composeStage !== null && composeStage.total > 1
                ? translate('music.compose.progressSegment', { index: String(composeStage.index), total: String(composeStage.total) })
                : translate('music.compose.progress')))
              : h('p', { className: 'dsh-ws-music-hint' }, translate('music.compose.hint')))
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
          doc,
          onAddTrack: () => setPickerOpen(true),
          onReorderTrack: reorderTrack,
          onSelectTrack: selectTrack,
          onToggleMute: toggleMute,
          onToggleSolo: toggleSolo,
          playhead,
          selectedTrackId: activeTrack?.id ?? null,
        }),
        h('section', { className: 'dsh-ws-music-editor' },
          h('div', { className: 'dsh-ws-music-editor-head' },
            h('span', { 'aria-hidden': true, className: 'dsh-ws-music-editor-dot', style: activeInfo === null ? undefined : { background: activeInfo.color } }),
            h('span', { className: 'dsh-ws-music-editor-name' }, activeTrack === null
              ? translate('music.editor.title')
              : trackDisplayName(activeTrack)),
            activeTrack === null ? null : h('span', { className: 'dsh-ws-music-editor-inst' }, translate(activeInfo.nameKey)),
            h('span', { className: 'dsh-ws-music-editor-hint' }, activeTrack === null
              ? ''
              : activeTrack.kind === 'drums' ? translate('music.editor.drumsHint') : translate('music.editor.notesHint')),
            h('span', { className: 'dsh-ws-music-spacer' }),
            activeTrack === null || activeTrack.kind === 'drums' ? null : h('span', { className: 'dsh-ws-music-editor-count' }, translate('music.editor.noteCount', { count: String(activeTrack.notes.length) })),
            h('button', {
              className: 'dsh-ws-music-mini-button',
              onClick: () => setEditorOpen(!editorOpen),
              type: 'button',
            }, editorOpen ? translate('music.editor.collapse') : translate('music.editor.expand'))),
          editorOpen ? h('div', { className: 'dsh-ws-music-editor-body' },
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
                  color: activeInfo.color,
                  height: musicPrefs?.rollHeight ?? null,
                  onAdd: addNote,
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
                }))
            : null)))),


  h('div', { className: 'dsh-ws-music-status' },
    h('span', null, `${doc.bars} ${translate('music.barsUnit')} · ${formatClock(duration)}`),
    h('span', null, `${doc.bpm} BPM · ${keyLabel(doc)}`),
    h('span', null, translate('music.status.tracks', { count: String(doc.tracks.length) })),
    h('span', null, translate('music.status.notes', { count: notesTotal })),
    h('span', { className: 'dsh-ws-music-spacer' }),
    status === null ? null : h('span', { className: 'dsh-ws-music-status-text', 'data-error': status.error || undefined }, status.text)),

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
    defaultDir: (() => {
      const parsed = parseSavedPath(savedPathRef.current)
      return parsed.dir === '' ? 'music' : parsed.dir
    })(),
    defaultName: safeFileName(doc.title),
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
    onOpen: pickOpen,
    onRefresh: dir => void refreshOpen(dir),
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




