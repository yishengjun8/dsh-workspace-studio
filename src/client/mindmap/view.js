import { createElement as h, Fragment, useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, memo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { clampMountBulge, CONTEXT_MENU_WIDTH, MINDMAP_SUMMARY_DEFAULT_LENGTH, MINDMAP_SUMMARY_MAX_LENGTH, MINDMAP_SUMMARY_MIN_LENGTH, MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH, MINDMAP_SUMMARY_SESSION_MAX_LENGTH, MINDMAP_SUMMARY_SESSION_MIN_LENGTH, MINDMAP_SYNC_MS } from '../constants.js'
import { translate } from '../locale/index.js'
import { styles } from '../styles.js'
import { regenerateAllMindmapSummaries, regenerateMindmapSummary, summarizeMindmapSession } from '../api.js'
import { mindmapOverlayStore, mindmapRegistry, readMindmapLastSession, removeMindmapLastSession, useMindmapOverlay, writeMindmapLastSession } from './registry.js'
import { useMindmapSummaryModels } from '../components/settings.js'
import { mindmapCardClickAction, mindmapClip, mindmapDeletePlan, mindmapDocFingerprint, mindmapDocKey, mindmapDocLayout, mindmapDocStructureFingerprint, mindmapEmptyKey, mindmapFoldedRunOf, mindmapGradientId, mindmapStreamPalette, normalizeMindmapWorkspacePath, useMindmapSessionView } from './helpers.js'
import { MindMapCard, MindMapFoldedCard, MindMapRootNode, MindMapSessionHead } from './cards.js'
import { mindmapConvertedSessions } from './hider.js'
import { MindMapToolbar } from './toolbar.js'
import { MindMapDialogs } from './dialogs.js'
import { useMindmapNotices } from './hooks/notices.js'
import { useMindmapViewport } from './hooks/viewport.js'

/* Monotonic suffix for client-created session ids: `Date.now()` alone is
   millisecond-precision, and two forks/creates in the same millisecond would
   mint the same id (a React key collision inside one doc). */
let mindmapClientSessionSeq = 0
/* Stable empty family for the memo below (a fresh [] per render would defeat
   the identity-keyed family-string cache in useMindmapSessionView). */
const EMPTY_FAMILY_IDS = []

/* The floating mind map: a persisted turn tree (flat session list)
   rendered from the doc, with pan/zoom and per-card forking. Rendered inside
   the left-side overlay window; card clicks switch the right-side chat. */

export function MindMapView({ sessionId, useSessions, loadDoc, saveDoc, syncDoc, deleteDoc, forkAt, createSession, listWorkspaces, openSession, renameSession, renameDoc, archiveSession, previewRight, settingsStore }) {
  const overlay = useMindmapOverlay()
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const [phase, setPhase] = useState({ status: 'loading' })
  /* Manual retry for a failed load: the load effect's deps are sessionId-only,
     so a phase change alone cannot re-trigger it — an epoch bump forces a
     re-run (rootId is null while phase is 'error', so the in-family early
     return stays out of the way). */
  const [loadEpoch, setLoadEpoch] = useState(0)
  const retryLoad = useCallback(() => { setLoadEpoch(epoch => epoch + 1) }, [])
  const [doc, setDoc] = useState(null)
  const [rootId, setRootId] = useState(null)
  // Latest root id as a ref: applySync guards against THIS (never the closure
  // rootId) so a pre-switch sync can't apply the previous family's doc.
  const rootIdRef = useRef(null)
  rootIdRef.current = rootId
  /* Current doc as a ref: async continuations (regenerateSummary) must build
     optimistic updates from the LATEST doc, not the render-time closure. */
  const docRef = useRef(null)
  docRef.current = doc
  /* Doc family ids, kept current BEFORE the narrowed sessions subscription
     below runs: the selector can't close over doc/rootId, and its getSnapshot
     must see the fresh family during this render. The array is MEMOIZED per
     (doc, rootId) so useMindmapSessionView can key its family-string by array
     identity — an unconditional rebuild would allocate a new array (and a new
     join string) on every render. */
  const familyIds = useMemo(() => doc === null || rootId === null
    ? EMPTY_FAMILY_IDS
    : [...new Set([String(rootId), ...(doc.sessions ?? []).map(s => String(s?.sessionId))])],
  [doc, rootId])
  const familyIdsRef = useRef(familyIds)
  familyIdsRef.current = familyIds
  const list = useMindmapSessionView(useSessions, familyIdsRef)
  const loadDocRef = useRef(loadDoc)
  loadDocRef.current = loadDoc
  const saveDocRef = useRef(saveDoc)
  saveDocRef.current = saveDoc
  const syncDocRef = useRef(syncDoc)
  syncDocRef.current = syncDoc
  const deleteDocRef = useRef(deleteDoc)
  deleteDocRef.current = deleteDoc
  const forkAtRef = useRef(forkAt)
  forkAtRef.current = forkAt
  const createSessionRef = useRef(createSession)
  createSessionRef.current = createSession
  const listWorkspacesRef = useRef(listWorkspaces)
  listWorkspacesRef.current = listWorkspaces
  const openSessionRef = useRef(openSession)
  openSessionRef.current = openSession
  /* Every map-internal selection change funnels through here: openSession
     switches the right-side chat AND moves the "当前" highlight (its wrapper
     calls setSession). Recording the landing session here keeps the last
     clicked card remembered per root (rootIdRef read at call time so a family
     switch writes under the CURRENT root). */
  /* Synchronous mirror of the last-selected session: writeMindmapLastSession
     persists through Web Locks (async), so a same-tick restoreLastSession
     could read the PREVIOUS selection from localStorage and bounce the chat
     back to the old branch. The ref is the same-tick source of truth;
     localStorage remains the cross-reload source. Reset on a family switch
     (the full-reload branch of the load effect). */
  const lastSelectedRef = useRef(null)
  const switchToSession = useCallback((id) => {
    const target = String(id)
    lastSelectedRef.current = target
    openSessionRef.current(target)
    if (rootIdRef.current !== null) writeMindmapLastSession(String(rootIdRef.current), target)
  }, [])
  /* Land the chat + highlight on the target session in ONE switch: the
     remembered session when it still exists in the loaded doc, the root
     otherwise. Called only after a load/open where the doc is authoritative —
     the sidebar entry no longer pre-switches the chat to the root (see
     openMindmapSession), so this single call replaces the old root →
     remembered double hop. */
  const restoreLastSession = useCallback((loadedDoc, loadedRoot) => {
    const remembered = lastSelectedRef.current ?? readMindmapLastSession(String(loadedRoot))
    const target = remembered !== null
      && (loadedDoc?.sessions ?? []).some(s => String(s?.sessionId) === remembered)
      ? remembered
      : String(loadedRoot)
    lastSelectedRef.current = target
    openSessionRef.current(target)
  }, [])
  const renameSessionRef = useRef(renameSession)
  renameSessionRef.current = renameSession
  const renameDocRef = useRef(renameDoc)
  renameDocRef.current = renameDoc
  const archiveSessionRef = useRef(archiveSession)
  archiveSessionRef.current = archiveSession
  const menuRef = useRef(null)
  const mountedRef = useRef(true)
  const lastFingerprintRef = useRef('')
  const savingRef = useRef(0)
  /* Counter (not a boolean): every doc-writing operation increments it on
     entry and decrements in its finally, so the sync guard stays armed until
     the LAST writer settles — a boolean cleared by the first finisher let a
     periodic sync slip through while a second write was still in flight and
     momentarily roll back its optimistic update. */
  /* Monotonic counter bumped at the start of every local doc write (fork /
     delete / archive / rename). A periodic sync issued BEFORE such a write can
     resolve AFTER the write completes (savingRef is back to false) and apply a
     stale doc that momentarily wipes the optimistic card; the sync effects
     capture this counter at issue time and drop any response that is no longer
     current, so a stale response can never overwrite a newer local write (the
     next periodic sync re-fetches and stays consistent). */
  const localWriteSeqRef = useRef(0)
  /* Synchronous gate for in-flight fork writes: the `forking` STATE guard only
     appears after a re-render, so a same-tick second trigger would pass it and
     fork twice (the loser's child gets adopted back as a duplicate branch). */
  const forkingRef = useRef(false)
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState(null)
  const [menu, setMenu] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState(null)
  /* Type-"yes" gate for archiving the whole map: the confirm button stays
     disabled until the user manually types "yes" (double insurance). */
  const [archiveConfirmText, setArchiveConfirmText] = useState('')
  /* Archiving ONE session branch (right-click a session head): archives the
     session + its whole subtree and removes it from the doc. */
  const [archiveBranchTarget, setArchiveBranchTarget] = useState(null)
  const [archiveBranchBusy, setArchiveBranchBusy] = useState(false)
  const [archiveBranchError, setArchiveBranchError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  /* Toolbar "重新生成全部摘要" confirm dialog: { count } of turns to regenerate. */
  const [regenerateAllTarget, setRegenerateAllTarget] = useState(null)
  const [regenerateAllBusy, setRegenerateAllBusy] = useState(false)
  const [regenerateAllError, setRegenerateAllError] = useState(null)
  /* 总结当前会话: the session id being waited on (missing card summaries are
     generated first — the result lands via a later sync), the session id whose
     synchronous request is in flight, and the Host-reported set of sessions
     whose session summary is pending/running (regenerate-all auto-generation).
     No result dialog: the card itself shows the outcome. */
  const [sessionSummaryWaiting, setSessionSummaryWaiting] = useState(null)
  const [sessionSummaryBusyId, setSessionSummaryBusyId] = useState(null)
  const [sessionSummarizing, setSessionSummarizing] = useState([])
  /* Live-turn info from the latest sync payload: one { sessionId, turn,
     question } per doc-family session with a turn in flight — drives the
     streaming cards. */
  const [live, setLive] = useState([])
  /* Turns currently generating an AI summary (方案 B status row): the Host
     reports its background queue per sync (summarizing), and manual
     regenerations are tracked locally (the Host's synchronous regenerate never
     enters its in-flight set). */
  const [summarizing, setSummarizing] = useState([])
  const [manualSummarizing, setManualSummarizing] = useState([])
  /* Key of the card under the pointer (undefined when none): drives the hover
     ancestor trace — the same highlight as the selected card's chain, rendered
     additively on top of the selection trace. */
  const [hoverKey, setHoverKey] = useState(undefined)
  /* The folded runs currently temporarily expanded (peek): a pure view state —
     the folded attribute is NOT changed. Clicking a folded card peeks that
     run; 立刻折叠 folds one back; the blank-area menu folds ALL peeked runs
     back or peeks every folded run; a doc change that dissolves a run clears
     it too (same stale-cleanup pattern as hoverKey). Keyed
     `${sessionId}:${firstSeq}` (same separator as summarizingKeys). */
  const [peekedRuns, setPeekedRuns] = useState(() => new Set())
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const notices = useMindmapNotices({ mountedRef })
  const layoutRef = useRef(null)
  const viewport = useMindmapViewport({ layoutRef })
  const { notice, showNotice, showNoticeError } = notices
  const { viewportRef, canvasRef, dragging, restoreView, startPan, movePan, endPan, resetView, refitIfUnfitted } = viewport


  /* Load the doc for the current session: the Host resolves a branch session
     to its root's doc, building & persisting a fresh doc (full-log split) on
     first access. */
  useEffect(() => {
    /* A session switch INSIDE the loaded family (one map per family): only the
       "当前" highlight and the right-side chat follow sessionId — the doc is
       identical, so reloading would rebuild the whole canvas for nothing. Only
       a session OUTSIDE the family (another map opened over this one) triggers
       a full reload. rootId/doc are read at call time on purpose. */
    if (rootId !== null && (String(sessionId) === String(rootId)
      || (doc?.sessions ?? []).some(s => String(s?.sessionId) === String(sessionId)))) {
      setForkError(null)
      /* Re-opening THIS map while the overlay was already showing it (a
         sidebar entry click after card clicks moved the highlight away) sets
         the overlay sessionId back to the root: restore the map's
         last-selected session here too, so the chat and highlight do not
         strand on the first branch. In-family card clicks never hit this —
         they funnel through switchToSession, which has already written the
         new selection as the remembered session (a no-op restore). */
      if (String(sessionId) === String(rootId)) restoreLastSession(doc, String(rootId))
      return undefined
    }
    let cancelled = false
    setDoc(null)
    setRootId(null)
    setLive([])
    setPhase({ status: 'loading' })
    setForkError(null)
    /* A different family loads: the same-tick selection mirror belongs to the
       previous family — restoreLastSession must fall back to localStorage
       (keyed by the NEW root) instead of reusing the old family's selection. */
    lastSelectedRef.current = null
    /* A different family loads: drop any hover from the previous map (a stale
       key matches no node anyway, but resetting keeps state honest).
       In-family switches skip this branch on purpose. */
    setHoverKey(undefined)
    /* A temporary expand (peek) belongs to the previous family's runs. */
    setPeekedRuns(new Set())
    /* A manual regeneration belongs to the previous family's cards; the new
       family's in-flight list arrives with the load payload. */
    setManualSummarizing([])
    /* A pending session summary belongs to the previous family: its doc check
       would never match the new map, and the 5-minute timeout would misfire. */
    setSessionSummaryWaiting(null)
    setSessionSummaryBusyId(null)
    /* Dialogs / context menus belong to the previous family: a root
       replacement in ANOTHER tab can re-anchor this view's doc while one is
       open, and a stale 归档整个导图 dialog would then act on the NEW family
       (confirmArchiveAll re-reads docRef/rootIdRef at confirm time). Close
       them all on this full-reload branch (in-family switches skip it). */
    setMenu(null)
    setRenameTarget(null)
    setDeleteTarget(null)
    setArchiveTarget(null)
    setArchiveBranchTarget(null)
    setRegenerateAllTarget(null)
    /* Switching to a DIFFERENT family (or a fresh doc): reset the view so the
       new map fits on load instead of inheriting the old transform (fittedRef
       was only ever set, never reset, so switches kept the old pan/zoom). */
    viewport.resetView()
    const id = String(sessionId)
    /* Defensive: a transient null/undefined overlay session (hero page,
       session switch) must never reach loadDoc as the literal 'undefined' —
       that would run a full GET for a nonexistent session and flash the empty
       state. Render the empty phase instead. */
    if (id === '' || id === 'undefined' || id === 'null') {
      setPhase({ status: 'empty' })
      return undefined
    }
    Promise.resolve(loadDocRef.current(id))
      .then((payload) => {
        const loaded = payload?.doc
        if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
          /* The Host degraded a reconcile/adopt step (see refreshMindmapDocCore):
             the recorded doc is served; the next sync retries. Visible only in
             the console — the map itself opens normally. */
          console.warn('[workspace-studio] mindmap load warnings:', payload.warnings)
        }
        /* Root archived OUTSIDE the map (harness/sidebar): the Host answers
           { exists: false } and never builds a doc for an archived session —
           close the floating window immediately instead of flashing the empty
           state for a full probe interval (the empty-state poll does the same). */
        if (payload?.exists === false) {
          mindmapConvertedSessions.delete(id)
          if (cancelled) return
          mindmapOverlayStore.close()
          return
        }
        if (loaded === null || loaded === undefined || (loaded.sessions ?? []).length === 0) {
          /* A failed/empty conversion must not leave the converted-set entry
             behind (the button would never re-offer the dialog). Delete even
             when the overlay was closed before the load settled (cancelled). */
          mindmapConvertedSessions.delete(id)
          if (cancelled) return
          setPhase({ status: 'empty' })
          return
        }
        if (cancelled) return
        setRootId(loaded.rootSessionId)
        setDoc(loaded)
        lastFingerprintRef.current = mindmapDocFingerprint(loaded)
        setSummarizing(Array.isArray(payload?.summarizing) ? payload.summarizing : [])
        setSessionSummarizing(Array.isArray(payload?.sessionSummarizing) ? payload.sessionSummarizing : [])
        setPhase({ status: 'ready' })
        mindmapRegistry.markDirty()
        if (payload.created === true) showNotice(translate('mindmap.created'))
        /* Restore the last selected session of this map family: the chat lands
           ONCE on the remembered session when it still exists in this doc
           (root fallback otherwise, keeping the "open on the first branch"
           default). The sidebar entry no longer pre-switches the chat to the
           root, so this single switch replaces the old double hop. An open
           from a branch header button (id already inside the family) skips
           this — the user's explicit choice wins. */
        const loadedRoot = String(loaded.rootSessionId)
        if (id === loadedRoot) restoreLastSession(loaded, loadedRoot)
      })
      .catch((error) => {
        /* Same rule as the empty path: a failed conversion must not leave the
           converted-set entry behind, even when the overlay closed early. */
        mindmapConvertedSessions.delete(id)
        if (cancelled) return
        setPhase({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { cancelled = true }
  }, [loadEpoch, sessionId])

  /* Empty-state refresh: with phase 'empty' neither sync effect can run (rootId
     is null), so poll loadDoc until the first completed turn converts the doc
     and cards appear without a reopen. The probe is cheap — a session without
     turns answers { exists: false } immediately. */
  useEffect(() => {
    if (phase.status !== 'empty') return undefined
    let cancelled = false
    const probe = () => {
      const id = String(sessionId)
      Promise.resolve(loadDocRef.current(id))
        .then((payload) => {
          if (cancelled) return
          if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
            console.warn('[workspace-studio] mindmap load warnings:', payload.warnings)
          }
          /* Root archived OUTSIDE the map (harness/sidebar): the Host answers
             { exists: false } and never builds a doc for an archived session —
             close the floating window like the sync path does instead of
             polling forever. */
          if (payload?.exists === false) {
            mindmapConvertedSessions.delete(String(sessionId))
            mindmapOverlayStore.close()
            return
          }
          const loaded = payload?.doc
          if (loaded !== null && loaded !== undefined && (loaded.sessions ?? []).length > 0) {
            setRootId(loaded.rootSessionId)
            setDoc(loaded)
            lastFingerprintRef.current = mindmapDocFingerprint(loaded)
            setSummarizing(Array.isArray(payload?.summarizing) ? payload.summarizing : [])
            setSessionSummarizing(Array.isArray(payload?.sessionSummarizing) ? payload.sessionSummarizing : [])
            setPhase({ status: 'ready' })
            mindmapRegistry.markDirty()
            if (payload.created === true) showNotice(translate('mindmap.created'))
            /* Same single-switch rule as the load path: once the probe's
               conversion makes the doc authoritative, land the chat on the
               remembered session (root fallback) — without this, opening an
               EMPTY map from the sidebar never switches the chat (the old
               openMindmapSession pre-switch covered it). */
            if (String(sessionId) === String(loaded.rootSessionId)) {
              restoreLastSession(loaded, String(loaded.rootSessionId))
            }
          }
        })
        .catch(() => { /* transient: keep polling */ })
    }
    const timer = window.setInterval(probe, MINDMAP_SYNC_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [phase.status, restoreLastSession, sessionId, showNotice])

  /* Apply one sync payload: fold the refreshed doc (only when the structure
     changed) and keep the live-turn info for the streaming card (identity-
     compared so a static question does not re-render the map). */
  const applySync = useCallback((payload, root) => {
    /* Apply only when the request still matches the CURRENT family (rootIdRef,
       not the closure rootId) AND no mutation is in flight: after a family
       switch the closure rootId is stale (would overwrite the fresh doc with
       the previous family's); during fork/delete/truncation savingRef is set,
       so a pre-write sync must not overwrite the optimistic doc (the next sync
       re-fetches and stays consistent). */
    if (!mountedRef.current || root !== rootIdRef.current || savingRef.current) return
    /* A degraded reconcile/adopt on the Host (see refreshMindmapDocCore) is
       served to the client as warnings; the next sync retries. Console-only. */
    if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
      console.warn('[workspace-studio] mindmap sync warnings:', payload.warnings)
    }
    /* Root archived outside the map (harness/sidebar): the Host answers
       { exists: false } — close the floating window instead of leaving a
       stale map. */
    if (payload?.exists === false) {
      mindmapOverlayStore.close()
      return
    }
    const next = payload?.doc
    /* Incremental sync responses (Host cache hit) carry doc: null — the
       document is unchanged, so keep the current copy and only apply the
       live/summarizing payloads below. A full doc still arrives on every
       signature change and at least once per Host TTL. */
    if (next !== null && next !== undefined) {
      const nextRoot = String(next.rootSessionId ?? '')
      if (nextRoot !== '' && nextRoot !== String(rootIdRef.current)) {
        /* The doc's anchor changed (another tab deleted the root card → root
           replacement R1→R2 served through the alias stub). Re-anchor THIS
           page: fork/delete/archives build their writes with the root id and
           the Host validates doc.rootSessionId === sessionId — a stale R1
           would 400 every subsequent write. The doc itself is applied below
           (the fingerprint includes rootSessionId, so it cannot be skipped). */
        rootIdRef.current = nextRoot
        setRootId(nextRoot)
      }
      const fp = mindmapDocFingerprint(next)
      if (fp !== lastFingerprintRef.current) {
        lastFingerprintRef.current = fp
        setDoc(next)
      }
    }
    /* The live list is identity-compared so a static set of in-flight
       questions does not re-render the map on every sync. */
    const liveNext = Array.isArray(payload?.live) ? payload.live : []
    setLive(prev => {
      if (prev.length !== liveNext.length) return liveNext
      for (let i = 0; i < liveNext.length; i += 1) {
        const a = prev[i]
        const b = liveNext[i]
        if (a === null || a === undefined || b === null || b === undefined
          || String(a.sessionId) !== String(b.sessionId)
          || String(a.turn ?? '') !== String(b.turn ?? '')
          || String(a.question ?? '') !== String(b.question ?? '')) return liveNext
      }
      return prev
    })
    /* The in-flight summary list (Host's background queue): identity-compared
       like `live` so a static list does not re-render the map every sync. The
       Host sorts it, so order is stable. */
    const summarizingNext = Array.isArray(payload?.summarizing) ? payload.summarizing : []
    setSummarizing(prev => {
      if (prev.length !== summarizingNext.length) return summarizingNext
      for (let i = 0; i < summarizingNext.length; i += 1) {
        const a = prev[i]
        const b = summarizingNext[i]
        if (a === null || a === undefined || b === null || b === undefined
          || String(a.sessionId) !== String(b.sessionId)
          || Number(a.seq) !== Number(b.seq)) return summarizingNext
      }
      return prev
    })
    /* Sessions whose SESSION summary is pending/running (Host-reported, sorted):
       drives the head card's "正在总结中…" status. Identity-compared the same way. */
    const sessionSummarizingNext = Array.isArray(payload?.sessionSummarizing) ? payload.sessionSummarizing : []
    setSessionSummarizing(prev => {
      if (prev.length !== sessionSummarizingNext.length) return sessionSummarizingNext
      for (let i = 0; i < sessionSummarizingNext.length; i += 1) {
        if (String(prev[i] ?? '') !== String(sessionSummarizingNext[i] ?? '')) return sessionSummarizingNext
      }
      return prev
    })
  }, [])

  /* The doc-family sessions currently running: a live streaming card attaches
     to EACH of their chains (regardless of which session the map is "on"), and
     every sync asks for their in-flight questions. Declared BEFORE the debounced
     effect below — its dependency array reads this binding at call time. */
  const runningFamilyIds = useMemo(() => {
    if (doc === null || rootId === null) return []
    const family = [...new Set([String(rootId), ...(doc.sessions ?? []).map(s => String(s?.sessionId))])]
    return family.filter(id => list.runningIds.has(id))
  }, [doc, list, rootId])
  const runningFamilyIdsRef = useRef([])
  runningFamilyIdsRef.current = runningFamilyIds
  /* Monotonic sync-issue id: the periodic (2.5 s) and the debounced (600 ms)
     sync can overlap, and without a sync-vs-sync guard an OLDER response
     arriving last would overwrite the newer one (momentary rollback until the
     next sync). Each issued sync captures the id; only the latest may apply. */
  const syncSeqRef = useRef(0)

  /* Periodic sync while mounted: fold new branch turns from the full logs so
     a branch completing a turn in the chat appears live. */
  useEffect(() => {
    if (rootId === null) return undefined
    const timer = window.setInterval(() => {
      if (savingRef.current) return
      const root = rootIdRef.current ?? rootId
      /* A local doc write that starts after this sync is issued supersedes its
         response: applying it would momentarily wipe the optimistic card (the
         savingRef guard only covers the in-flight window). Drop any response
         that is no longer the latest local state. */
      const issuedSeq = localWriteSeqRef.current
      const issuedSync = syncSeqRef.current + 1
      syncSeqRef.current = issuedSync
      Promise.resolve(syncDocRef.current(root, runningFamilyIdsRef.current, undefined, summaryConfigRef.current))
        .then((payload) => {
          if (issuedSeq !== localWriteSeqRef.current || issuedSync !== syncSeqRef.current) return
          applySync(payload, root)
        })
        .catch(() => { /* transient sync failure: keep the current doc */ })
    }, MINDMAP_SYNC_MS)
    return () => { clearInterval(timer) }
  }, [applySync, rootId])

  /* Sync shortly after the doc-family running state changes: a run start brings
     in-flight questions back quickly; a run end folds the just-completed turn
     (the map may show a different session than the one that ran). Debounced
     against streaming updates. When a local doc write (fork/delete/archive) is
     in flight the sync is DEFERRED and retried, never dropped: a run ending at
     that exact moment would otherwise wait up to a full periodic interval
     (2.5 s) before its completed turn folds into the doc. */
  useEffect(() => {
    if (rootId === null) return undefined
    let timer = 0
    const run = () => {
      if (!mountedRef.current) return
      if (savingRef.current) {
        timer = window.setTimeout(run, 250)
        return
      }
      const root = rootIdRef.current ?? rootId
      const issuedSeq = localWriteSeqRef.current
      const issuedSync = syncSeqRef.current + 1
      syncSeqRef.current = issuedSync
      Promise.resolve(syncDocRef.current(root, runningFamilyIdsRef.current, undefined, summaryConfigRef.current))
        .then((payload) => {
          if (issuedSeq !== localWriteSeqRef.current || issuedSync !== syncSeqRef.current) return
          applySync(payload, root)
        })
        .catch(() => { /* transient */ })
    }
    timer = window.setTimeout(run, 600)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningFamilyIds, rootId])

  /* The live streaming cards: every running doc-family session gets a live card
     appended to its own chain tail. The in-flight question arrives with the next
     sync payload; until then the card shows the streaming label. Declared BEFORE
     the layout memo that consumes them (use-before-declaration would throw TDZ). */
  const streamingCards = useMemo(() => {
    if (runningFamilyIds.length === 0) return []
    /* Identity only (session ids): the layout must NOT depend on the live
       question text — a question arriving with a sync would otherwise rebuild
       the whole layout and defeat React.memo on every card. The question is
       read at render time via streamingQuestionByKey below. */
    return runningFamilyIds.map((sid) => ({ sessionId: String(sid) }))
  }, [runningFamilyIds])

  /* Live question text per streaming session, read at render time (not part
     of the layout memo): only the streaming card re-renders when its question
     arrives, never the whole canvas. */
  const streamingQuestionByKey = useMemo(() => {
    const map = new Map()
    for (const item of live) {
      if (item !== null && item !== undefined) {
        map.set(String(item.sessionId), typeof item.question === 'string' ? item.question : '')
      }
    }
    return map
  }, [live])

  const mountBulge = clampMountBulge(settings.mindmapMountBulge)
  /* Configured models for the AI-summary picker (shared hook; the 60 s module
     cache makes this free after the settings panel fetched it). */
  const summaryModels = useMindmapSummaryModels()
  const summaryModelList = summaryModels !== null && summaryModels?.available === true && Array.isArray(summaryModels?.models)
    ? summaryModels.models.filter(m => m !== null && m !== undefined && typeof m?.model === 'string' && m.model !== '')
    : []
  /* Effective AI-summary config sent with every sync (and regeneration): off
     unless enabled; undefined model = "follow the session's model"; otherwise a
     fixed route. The length is an advisory suggestion, clamped into UI bounds.
     A stored route missing from the catalog falls back to session mode —
     mirroring the picker's visual fallback (the stored value stays so a
     re-appearing model is picked up again). */
  const summaryLengthRaw = Number(settings.mindmapSummaryLength)
  const summaryLength = Number.isFinite(summaryLengthRaw)
    ? Math.min(MINDMAP_SUMMARY_MAX_LENGTH, Math.max(MINDMAP_SUMMARY_MIN_LENGTH, summaryLengthRaw))
    : MINDMAP_SUMMARY_DEFAULT_LENGTH
  const summarySessionLengthRaw = Number(settings.mindmapSummarySessionLength)
  const summarySessionLength = Number.isFinite(summarySessionLengthRaw)
    ? Math.min(MINDMAP_SUMMARY_SESSION_MAX_LENGTH, Math.max(MINDMAP_SUMMARY_SESSION_MIN_LENGTH, summarySessionLengthRaw))
    : MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH
  const summaryConfig = settings.mindmapSummaryEnabled === true
    ? (settings.mindmapSummaryModel !== undefined && settings.mindmapSummaryModel !== null
      && typeof settings.mindmapSummaryModel.provider === 'string' && settings.mindmapSummaryModel.provider !== ''
      && typeof settings.mindmapSummaryModel.model === 'string' && settings.mindmapSummaryModel.model !== ''
      && summaryModelList.some(m => m.provider === settings.mindmapSummaryModel.provider && m.model === settings.mindmapSummaryModel.model)
      ? { provider: settings.mindmapSummaryModel.provider, model: settings.mindmapSummaryModel.model, length: summaryLength, sessionLength: summarySessionLength }
      : { mode: 'session', length: summaryLength, sessionLength: summarySessionLength })
    : null
  /* Read at sync-issue time (like runningFamilyIdsRef) so a settings change
     applies without recreating the timers. */
  const summaryConfigRef = useRef(summaryConfig)
  summaryConfigRef.current = summaryConfig
  /* Structure-only fingerprint: the layout memo depends on THIS (not the whole
     doc) so an AI-summary write re-renders only the affected card instead of
     rebuilding every node entry (which would defeat React.memo on the cards). */
  const structureFp = useMemo(() => mindmapDocStructureFingerprint(doc), [doc])
  const layout = useMemo(() => mindmapDocLayout(doc, streamingCards, mountBulge, peekedRuns), [structureFp, streamingCards, mountBulge, peekedRuns])
  layoutRef.current = layout

  /* Edge path strings plus per-streaming metadata, derived from the layout and
     stable between doc changes — memoized so a re-render does not rebuild them
     (edge `d` paths are precomputed by the layout). */
  const edgeView = useMemo(() => {
    const byKey = new Map()
    for (const node of layout.nodes) byKey.set(node.key, node)
    /* Per-streaming metadata for the SVG <defs> + ring palette lookups. */
    const streamingEntries = []
    for (const node of layout.nodes) {
      if (node.streaming !== true) continue
      const palette = mindmapStreamPalette(node.sessionId)
      const gradId = mindmapGradientId(node.sessionId)
      const entry = { entry: node, parentKey: node.parentKey, palette, gradId }
      const parent = node.parentKey === undefined ? undefined : byKey.get(node.parentKey)
      if (parent !== undefined) {
        entry.bbox = {
          x1: parent.x + parent.width,
          y1: parent.y + parent.height / 2,
          x2: node.x,
          y2: node.y + node.height / 2,
        }
      }
      streamingEntries.push(entry)
    }
    /* An edge TARGETING a live streaming card (`to` is a `streaming:<sid>` key
       by construction) is a flowing pair edge: it carries its own gradient id
       + palette derived from the sid in the key, so flow styling never depends
       on a key-matching map. */
    const edges = []
    for (const edge of layout.edges) {
      const from = byKey.get(edge.from)
      const to = byKey.get(edge.to)
      if (from === undefined || to === undefined) continue
      /* Keep the edge's from/to identities so the render pass can mark the
         current card's ancestor-trace edges. */
      let flow
      if (typeof edge.to === 'string' && edge.to.startsWith('streaming:')) {
        const sid = edge.to.slice('streaming:'.length)
        flow = {
          gradId: mindmapGradientId(sid),
          palette: mindmapStreamPalette(sid),
        }
      }
      edges.push({ from: edge.from, to: edge.to, d: edge.d, mount: edge.mount === true, flow })
    }
    return { edges, streamingEntries }
  }, [layout])

  /* Fit once when the map first becomes visible; later layout growth keeps the
     user's view (还原视图 restores the fit at any time). */
  useLayoutEffect(() => { viewport.refitIfUnfitted() }, [layout.height, layout.width, viewport])


  /* Key of the CURRENT session's chain TAIL for the "当前" highlight (badge +
     solid selection highlight + ancestor trace all derive from it). The HEAD
     card must NEVER carry the badge or solid highlight — the badge lands on
     the tail: the last question card, the empty placeholder (no turns yet), or
     the streaming card while generating (which wears its own ring instead). */
  const currentKey = useMemo(() => {
    if (doc === null || rootId === null) return undefined
    const current = String(sessionId)
    const entry = (doc.sessions ?? []).find(s => String(s?.sessionId) === current)
    if (entry === undefined) return undefined
    if (runningFamilyIds.includes(current)) return `streaming:${current}`
    const turns = entry.turns ?? []
    const last = turns[turns.length - 1]
    if (last === undefined) return mindmapEmptyKey(current)
    /* A folded chain tail: the badge lands on the folded card (the run's
       first card) unless the run is temporarily expanded — then the tail
       card itself is visible and carries the badge. */
    if (last.folded === true) {
      const run = mindmapFoldedRunOf(doc, current, last.seq)
      const peeked = run !== null && peekedRuns.has(`${current}:${run.firstSeq}`)
      if (run !== null && !peeked) {
        const startTurn = turns.find(t => t !== null && t !== undefined && Number(t?.seq) === run.firstSeq)
        if (startTurn !== undefined) return mindmapDocKey(current, startTurn.seq)
      }
    }
    return mindmapDocKey(current, last.seq)
  }, [doc, rootId, runningFamilyIds, sessionId, peekedRuns])

  /* Ancestor trace of the current card: walk the layout's edges BACKWARD from
     currentKey (`to → from`) to the root (no incoming edge). Yields the parent
     node keys (the card itself keeps the solid highlight, hence excluded) and
     the path's edge identities; the render marks those edges dashed primary-blue
     and those parent nodes with dashed borders. Memoized on [currentKey, layout]
     so an in-family switch re-traces cheaply without touching the pan/zoom path. */
  const trace = useMemo(() => {
    const ancestorSet = new Set()
    const activeEdgeKeys = new Set()
    if (currentKey === undefined) return { ancestorSet, activeEdgeKeys }
    const parentOf = new Map()
    for (const edge of layout.edges) parentOf.set(edge.to, edge.from)
    let key = currentKey
    while (key !== undefined && parentOf.has(key)) {
      const parentKey = parentOf.get(key)
      if (parentKey === undefined) break
      ancestorSet.add(parentKey)
      activeEdgeKeys.add(`${parentKey}\u0000${key}`)
      key = parentKey
    }
    return { ancestorSet, activeEdgeKeys }
  }, [currentKey, layout])

  /* Hover ancestor trace: the SAME backward walk as `trace`, but rooted at the
     card under the pointer. The two traces render as a union, so hovering adds
     its chain over the selection's. A stale hoverKey (card replaced by a sync
     while hovered) matches no node and yields an empty trace. */
  const hoverTrace = useMemo(() => {
    const ancestorSet = new Set()
    const activeEdgeKeys = new Set()
    if (hoverKey === undefined) return { ancestorSet, activeEdgeKeys }
    const parentOf = new Map()
    for (const edge of layout.edges) parentOf.set(edge.to, edge.from)
    let key = hoverKey
    while (key !== undefined && parentOf.has(key)) {
      const parentKey = parentOf.get(key)
      if (parentKey === undefined) break
      ancestorSet.add(parentKey)
      activeEdgeKeys.add(`${parentKey}\u0000${key}`)
      key = parentKey
    }
    return { ancestorSet, activeEdgeKeys }
  }, [hoverKey, layout])

  /* A hovered card can be removed by a sync (a turn folds, a card is deleted
     in another tab): its DOM node is replaced without a mouseleave, so the key
     would linger and light up a FUTURE same-key card (seq reuse after a
     deletion) while no pointer is on it. Clear it whenever the layout no
     longer contains the hovered node. */
  useEffect(() => {
    if (hoverKey === undefined) return
    let found = false
    for (const node of layout.nodes) {
      if (node.key === hoverKey) { found = true; break }
    }
    if (!found) setHoverKey(undefined)
  }, [hoverKey, layout])

  /* A peeked run can dissolve under a sync (another tab permanently unfolded
     it, a card was deleted, the run shrank): clear the peek when the run no
     longer starts at the remembered first seq. */
  useEffect(() => {
    if (peekedRuns.size === 0) return
    let next = null
    for (const key of peekedRuns) {
      const sep = key.indexOf(':')
      const sid = key.slice(0, sep)
      const firstSeq = Number(key.slice(sep + 1))
      const run = mindmapFoldedRunOf(doc, sid, firstSeq)
      if (run === null || run.firstSeq !== firstSeq) {
        if (next === null) next = new Set(peekedRuns)
        next.delete(key)
      }
    }
    if (next !== null) setPeekedRuns(next)
  }, [peekedRuns, doc])

  /* Open a session inside the map: openSession switches the right-side chat to
     it and moves the "当前" highlight here; the overlay itself stays open. */
  const openBranch = useCallback((id) => {
    switchToSession(String(id))
  }, [switchToSession])

  /* Fork a new branch session at a card's turn/end seq, record it in the doc
     and persist. The child opens ONLY after the doc write completes, so the
     branch is already in the document when shown (its map view can never miss
     the doc and split off a new one). forkAt no longer opens the child; this
     function opens it into the chat so the conversation continues from there. */
  const forkBranchAt = useCallback((ownerId, turn) => {
    /* The ref is the authoritative same-tick gate (see forkingRef above); the
       state guard additionally stops a second fork after re-render. */
    if (forkingRef.current || forking || turn === undefined) return
    forkingRef.current = true
    setForkError(null)
    setForking(true)
    const root = rootIdRef.current ?? rootId
    const currentDoc = doc
    localWriteSeqRef.current += 1
    savingRef.current += 1
    Promise.resolve(forkAtRef.current(String(ownerId), turn.seq))
      .then(async (childId) => {
        /* A nested fork: the new session hangs off the clicked card. */
        const session = {
          id: `s${Date.now()}${mindmapClientSessionSeq++}`,
          sessionId: String(childId),
          parentSessionId: String(ownerId),
          forkTurn: Number(turn.t),
          parentTurn: Number(turn.n),
          forkSeq: Number(turn.seq),
          turns: [],
        }
        /* Build from the LATEST doc (docRef), not the render-time closure, so a
           sync or summary write that landed while forkAt was in flight is kept
           (the closure doc would otherwise clobber it in the optimistic update
           and in the persisted write). */
        const base = docRef.current ?? currentDoc
        const next = { ...base, sessions: [...(base?.sessions ?? []), session], updatedAt: Date.now() }
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        try {
          await saveDocRef.current(root, next)
        } catch (error) {
          /* The branch must not outlive its document entry: archive the fresh
             (still empty) session so a failed write can't leave an orphan. */
          try { await archiveSessionRef.current(String(childId)) } catch { /* best effort */ }
          /* Roll the optimistic branch back (unless a concurrent sync has since
             moved the doc on) so a failed fork never leaves a card whose session
             was just archived — the periodic sync would otherwise keep showing
             a dead branch for up to 2.5 s. */
          setDoc(prev => (prev === next ? base : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(base)
          throw error
        }
        if (!mountedRef.current) return
        /* Open into chat so the next message extends from exactly the clicked
           card. */
        switchToSession(String(childId))
      })
      .then(() => {
        if (!mountedRef.current) return
        showNotice(translate('mindmap.forked'))
        mindmapRegistry.markDirty()
      })
      .catch((error) => {
        if (mountedRef.current) setForkError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        forkingRef.current = false
        savingRef.current -= 1
        if (mountedRef.current) setForking(false)
      })
  }, [doc, forking, rootId, showNotice, switchToSession])

  /* Click the VIRTUAL root node: create a brand-new EMPTY top-level session (no
     inherited turns) hanging directly off the root node, record it in the doc
     and persist, then open it so the user can ask the first question. It is
     created in the workspace the map was CREATED in (doc.workspaceCwd, recorded
     at conversion) so it lands in the same sidebar group wherever the anchor
     session now lives. */
  const addRootSession = useCallback(() => {
    /* The ref is the authoritative same-tick gate (see forkingRef above); the
       state guard additionally stops a second create after re-render. */
    if (forkingRef.current || forking) return
    forkingRef.current = true
    setForkError(null)
    setForking(true)
    const root = rootIdRef.current ?? rootId
    const currentDoc = doc
    localWriteSeqRef.current += 1
    savingRef.current += 1
    const recordedCwd = (typeof currentDoc?.workspaceCwd === 'string' && currentDoc.workspaceCwd !== '')
      ? currentDoc.workspaceCwd
      : undefined
    Promise.resolve(createSessionRef.current(recordedCwd, String(root)))
      .then(async (childId) => {
        const session = {
          id: `s${Date.now()}${mindmapClientSessionSeq++}`,
          sessionId: String(childId),
          parentSessionId: null,
          parentTurn: null,
          forkTurn: 0,
          forkSeq: null,
          turns: [],
        }
        /* Build from the LATEST doc (docRef), not the render-time closure, so a
           sync or summary write that landed while the session was being created
           is kept (the closure doc would otherwise clobber it). */
        const base = docRef.current ?? currentDoc
        const next = { ...base, sessions: [...(base?.sessions ?? []), session], updatedAt: Date.now() }
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        try {
          await saveDocRef.current(root, next)
        } catch (error) {
          /* The fresh session must not outlive its document entry: archive it
             so a failed write can't leave an orphan. */
          try { await archiveSessionRef.current(String(childId)) } catch { /* best effort */ }
          setDoc(prev => (prev === next ? base : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(base)
          throw error
        }
        if (!mountedRef.current) return
        /* Open the new session into chat so the next message starts it. */
        switchToSession(String(childId))
      })
      .then(() => {
        if (!mountedRef.current) return
        showNotice(translate('mindmap.sessionCreated'))
        mindmapRegistry.markDirty()
      })
      .catch((error) => {
        if (mountedRef.current) setForkError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        forkingRef.current = false
        savingRef.current -= 1
        if (mountedRef.current) setForking(false)
      })
  }, [doc, forking, rootId, showNotice, switchToSession])

  /* Stable ref bridges for the card click/menu callbacks: openCard/openCardMenu
     are passed to EVERY memoized card, so their identities must NOT change when
     the doc does (a summary-only write would otherwise defeat React.memo and
     rebuild the whole canvas — the structureFp optimization). The refs always
     hold the latest callbacks/state; the callbacks themselves are stable. */
  const openBranchRef = useRef(openBranch)
  openBranchRef.current = openBranch
  const forkBranchAtRef = useRef(forkBranchAt)
  forkBranchAtRef.current = forkBranchAt
  const addRootSessionRef = useRef(addRootSession)
  addRootSessionRef.current = addRootSession
  const listRef = useRef(list)
  listRef.current = list
  /* Click a node: the root creates a NEW top-level session; a head switches to
     its session; a card switches (parked tail / streaming / empty placeholder)
     or forks a nested session (intermediate card, or the last completed card of
     a session CURRENTLY generating — its real tail is the streaming card). The
     new session joins the SAME document — never a new mind map — and stays
     hidden from the sidebar list. */
  const openCard = useCallback((node) => {
    if (node === undefined || forkingRef.current) return
    /* Single source of truth for the click outcome: the same decision tree the
       hover hint uses (mindmapCardClickAction), so the hint can never drift.
       'new' creates a top-level session at the root; 'switch' opens the node's
       own session; 'fork' branches a new session at this card's turn. */
    const action = mindmapCardClickAction(node, docRef.current, runningFamilyIdsRef.current, lastTurnSeqBySessionRef.current)
    if (action === 'new') addRootSessionRef.current()
    else if (action === 'switch') openBranchRef.current(node.sessionId)
    else if (action === 'fork') forkBranchAtRef.current(node.sessionId, node.turn)
    /* A folded card: temporarily expand its run (peek) — the folded attribute
       is untouched; 立刻折叠 (or clicking another folded card) folds it back.
       Clicking replaces the peek set with just this run (single-run peek). */
    else if (action === 'peek') setPeekedRuns(new Set([`${String(node.sessionId)}:${Number(node.turn?.seq)}`]))
  }, [])

  /* Right-click a node: remember WHICH node so the menu can rename a session
     (head / card) or delete a card; the root node offers no menu (the toolbar
     has 归档整个导图). */
  const openCardMenu = useCallback((entry, x, y) => {
    if (entry.kind === 'root') {
      /* Root menu: choose the workspace new sessions land in (from the doc's
         workspaceCwd) + archive the whole map. The workspace list is fetched
         synchronously from the host action face. */
      const raw = listWorkspacesRef.current?.()
      const items = Array.isArray(raw) ? raw : []
      const current = (typeof docRef.current?.workspaceCwd === 'string' && docRef.current.workspaceCwd !== '') ? docRef.current.workspaceCwd : ''
      setMenu({ kind: 'root', workspaces: items, current, x, y })
      return
    }
    if (entry.kind === 'head') {
      setMenu({
        kind: 'head',
        sessionId: String(entry.sessionId),
        sessionTitle: (listRef.current.titles[String(entry.sessionId)] ?? ''),
        x, y,
      })
      return
    }
    /* A card is "marked folded" when it IS the folded card (entry.folded) or
       when it is a folded-marked turn temporarily expanded (peeked — the
       layout node's turn still carries folded: true from the doc). */
    const markedFolded = entry.folded === true || entry.turn?.folded === true
    setMenu({
      kind: 'card',
      sessionId: String(entry.sessionId),
      sessionTitle: (listRef.current.titles[String(entry.sessionId)] ?? ''),
      question: entry.empty ? undefined : String(entry.turn?.user ?? ''),
      turnSeq: entry.empty ? undefined : Number(entry.turn?.seq),
      turnN: entry.empty ? undefined : Number(entry.turn?.n),
      empty: entry.empty === true,
      folded: markedFolded,
      /* Only the folded card itself carries the run's count (a peeked card is
         one turn of the run): the menu uses it to tell "uncheck = unfold the
         whole run" (folded card) from "uncheck = unfold this card" (peeked). */
      foldCount: entry.folded === true ? Number(entry.foldCount ?? 1) : undefined,
      x, y,
    })
  }, [])
  /* Right-click a BLANK area (viewport/canvas background, edges): open the
     blank-area menu (create session / fold all / unfold all). Cards stop
     propagation in their own onContextMenu, so only blank hits reach here. */
  const openBlankMenu = useCallback((event) => {
    event.preventDefault()
    setMenu({ kind: 'blank', x: event.clientX, y: event.clientY })
  }, [])
  const closeMenu = useCallback(() => { setMenu(null) }, [])
  useEffect(() => {
    if (menu === null) return undefined
    const onPointerDown = event => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      closeMenu()
    }
    const onKeyDown = event => { if (event.key === 'Escape') closeMenu() }
    /* Same inside-menu guard as pointerdown: the root "choose workspace" menu
       is itself scrollable (max-height + overflow-y), so scrolling its list
       must not close it. */
    const onScroll = event => {
      if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return
      closeMenu()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu, closeMenu])

  const startRename = useCallback(() => {
    if (menu === null) return
    setMenu(null)
    setRenameError(null)
    setRenameTarget({ sessionId: menu.sessionId, title: list.titles[menu.sessionId] ?? '' })
  }, [menu, list])
  const closeRename = useCallback(() => {
    if (renameBusy) return
    setRenameTarget(null)
    setRenameError(null)
  }, [renameBusy])
  const confirmRename = useCallback(() => {
    if (renameBusy || renameTarget === null) return
    const trimmed = renameTarget.title.trim()
    if (trimmed === '') return
    setRenameBusy(true)
    setRenameError(null)
    Promise.resolve(renameSessionRef.current(renameTarget.sessionId, trimmed))
      .then(() => {
        /* Renaming the ROOT session should also update the map's OWN title
           (doc.rootTitle): the map header and the sidebar entry display
           rootTitle, which is independent of the session title — without this
           the user's rename of the root head appears to do nothing. The
           targeted /rename endpoint avoids the GET-then-POST round trip (the
           sidebar panel uses the same one). Best-effort: a doc-title failure
           after a successful session rename only warns — the next sync's
           fingerprint carries rootTitle either way. */
        if (rootIdRef.current !== null && String(renameTarget.sessionId) === String(rootIdRef.current)
          && typeof renameDocRef.current === 'function') {
          return Promise.resolve(renameDocRef.current(String(rootIdRef.current), trimmed)).then((result) => {
            /* Optimistically update the LOCAL doc: a structural write landing
               before the next sync would otherwise carry the OLD rootTitle and
               write it back over the Host's freshly renamed one (the local
               fingerprint would then pin the stale title until the next
               rename). Prefer the Host's returned doc; fall back to a local
               patch when the response shape is unexpected. */
            if (!mountedRef.current) return undefined
            const current = docRef.current ?? null
            const updated = result?.doc !== null && result?.doc !== undefined
              ? result.doc
              : current !== null && String(current.rootSessionId) === String(rootIdRef.current)
                ? { ...current, rootTitle: trimmed, updatedAt: Date.now() }
                : null
            if (updated !== null) {
              localWriteSeqRef.current += 1
              setDoc(updated)
              lastFingerprintRef.current = mindmapDocFingerprint(updated)
            }
            return undefined
          }).catch((error) => {
            if (mountedRef.current) console.warn('workspace-studio: mindmap rootTitle rename failed:', error)
            return undefined
          })
        }
        return undefined
      })
      .then(() => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameTarget(null)
        showNotice(translate('mindmap.renamed'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setRenameBusy(false)
        setRenameError(error instanceof Error ? error.message : String(error))
      })
  }, [renameBusy, renameTarget, showNotice])

  /* Pick the workspace new top-level sessions (created via the root node's
     click) will land in. Persisted to the doc's workspaceCwd; '' clears the
     choice (ungrouped). */
  const selectWorkspace = useCallback((cwd, title) => {
    /* Shared write gate: refuse while any doc write (fork/delete/archive) is in
       flight so two writers can never interleave their read-modify-write. */
    if (forkingRef.current || menu === null || menu.kind !== 'root' || doc === null || rootId === null) return
    forkingRef.current = true
    setMenu(null)
    /* Build from the LATEST doc (docRef), not the render-time closure, so a
       sync/regenerate that landed since this callback was created is kept. */
    const base = docRef.current ?? doc
    const next = { ...base, workspaceCwd: cwd, updatedAt: Date.now() }
    localWriteSeqRef.current += 1
    savingRef.current += 1
    setDoc(next)
    lastFingerprintRef.current = mindmapDocFingerprint(next)
    /* The root may have been re-anchored by a sync since this callback was
       created (same rule as every other doc write in this component). */
    Promise.resolve(saveDocRef.current(String(rootIdRef.current ?? rootId), next))
      .then(() => {
        if (!mountedRef.current) return
        mindmapRegistry.markDirty()
        showNotice(cwd === ''
          ? translate('mindmap.workspace.cleared')
          : translate('mindmap.workspace.set', { name: title ?? cwd }))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setDoc(prev => (prev === next ? base : prev))
        lastFingerprintRef.current = mindmapDocFingerprint(base)
        showNoticeError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { savingRef.current -= 1; forkingRef.current = false })
  }, [doc, menu, rootId, showNotice, showNoticeError])

  /* Toggle the persisted folded attribute of ONE card (the menu checkbox):
     checking folds the card (merging with consecutive folded neighbors),
     unchecking permanently unfolds it (the run splits). A small doc write
     with the standard guards (same shape as selectWorkspace). */
  const toggleFold = useCallback((sessionId, seq, folded) => {
    if (forkingRef.current || forking) return
    forkingRef.current = true
    const root = rootIdRef.current ?? rootId
    const base = docRef.current ?? doc
    if (root === null || base === null) { forkingRef.current = false; return }
    localWriteSeqRef.current += 1
    savingRef.current += 1
    const next = {
      ...base,
      sessions: (base.sessions ?? []).map(s =>
        String(s?.sessionId) !== String(sessionId)
          ? s
          : { ...s, turns: (s?.turns ?? []).map(t =>
            t !== null && t !== undefined && Number(t?.seq) === Number(seq)
              ? { ...t, folded: folded === true }
              : t) }),
      updatedAt: Date.now(),
    }
    setDoc(next)
    lastFingerprintRef.current = mindmapDocFingerprint(next)
    Promise.resolve(saveDocRef.current(String(root), next))
      .then(() => {
        if (!mountedRef.current) return
        mindmapRegistry.markDirty()
        showNotice(translate(folded === true ? 'mindmap.fold.done' : 'mindmap.unfold.done'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setDoc(prev => (prev === next ? base : prev))
        lastFingerprintRef.current = mindmapDocFingerprint(base)
        showNoticeError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { savingRef.current -= 1; forkingRef.current = false })
  }, [doc, forking, rootId, showNotice, showNoticeError])

  /* Permanently unfold a WHOLE folded run (the folded card's checkbox
     uncheck): clear the folded attribute on every turn of the run. */
  const unfoldRun = useCallback((sessionId, firstSeq) => {
    if (forkingRef.current || forking) return
    forkingRef.current = true
    const root = rootIdRef.current ?? rootId
    const base = docRef.current ?? doc
    if (root === null || base === null) { forkingRef.current = false; return }
    const run = mindmapFoldedRunOf(base, sessionId, firstSeq)
    if (run === null) { forkingRef.current = false; return }
    localWriteSeqRef.current += 1
    savingRef.current += 1
    const next = {
      ...base,
      sessions: (base.sessions ?? []).map(s => {
        if (String(s?.sessionId) !== String(sessionId)) return s
        return { ...s, turns: (s?.turns ?? []).map(t =>
          t !== null && t !== undefined && t.folded === true
            && Number(t?.seq) >= run.firstSeq && Number(t?.seq) <= run.lastSeq
            ? { ...t, folded: false }
            : t) }
      }),
      updatedAt: Date.now(),
    }
    setDoc(next)
    lastFingerprintRef.current = mindmapDocFingerprint(next)
    Promise.resolve(saveDocRef.current(String(root), next))
      .then(() => {
        if (!mountedRef.current) return
        mindmapRegistry.markDirty()
        showNotice(translate('mindmap.unfold.done'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setDoc(prev => (prev === next ? base : prev))
        lastFingerprintRef.current = mindmapDocFingerprint(base)
        showNoticeError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { savingRef.current -= 1; forkingRef.current = false })
  }, [doc, forking, rootId, showNotice, showNoticeError])

  /* 立刻折叠: end the temporary expand of the peeked run under the menu card —
     pure view state, the folded attribute is untouched (no doc write). */
  const foldNow = useCallback(() => {
    if (menu === null || menu.kind !== 'card') return
    setMenu(null)
    const run = mindmapFoldedRunOf(docRef.current, String(menu.sessionId), Number(menu.turnSeq))
    if (run === null) { setPeekedRuns(new Set()); return }
    const key = `${String(menu.sessionId)}:${run.firstSeq}`
    setPeekedRuns(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [menu])

  /* Blank-area menu items — pure VIEW state, the folded markers are never
     touched (no doc write, no sync): 折叠全部可折叠的卡片 folds back every
     temporarily-expanded (peeked) run; 展开全部已经折叠的卡片 peeks every
     folded run. The menu closes first (same as every other menu item). */
  const foldAllCollapsible = useCallback(() => {
    setMenu(null)
    setPeekedRuns(new Set())
  }, [])
  const unfoldAllFolded = useCallback(() => {
    setMenu(null)
    /* Peek every folded run: collect each run's first turn (a run starts at a
       folded turn whose predecessor is not folded). */
    const runs = new Set()
    for (const s of docRef.current?.sessions ?? []) {
      if (s === null || s === undefined) continue
      const turns = s.turns ?? []
      for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i]
        if (t === null || t === undefined || t.folded !== true) continue
        if (i > 0 && turns[i - 1]?.folded === true) continue
        runs.add(`${String(s.sessionId)}:${Number(t.seq)}`)
      }
    }
    setPeekedRuns(runs)
  }, [])
  /* 创建新对话: the same action as the toolbar button / root node click —
     create a new top-level empty session and open it. */
  const createSessionFromBlankMenu = useCallback(() => {
    setMenu(null)
    addRootSessionRef.current()
  }, [])

  /* The menu checkbox click: unchecking a FOLDED card permanently unfolds the
     whole run; unchecking a peeked (marked) card unfolds just that card;
     checking an unmarked card folds it. The menu closes first (same as every
     other menu item) — the fold/unfold lands immediately on the canvas. */
  const toggleFoldFromMenu = useCallback(() => {
    if (menu === null || menu.kind !== 'card' || !Number.isSafeInteger(menu.turnSeq)) return
    const sessionId = String(menu.sessionId)
    const turnSeq = Number(menu.turnSeq)
    const isFoldedCard = menu.folded === true && menu.foldCount !== undefined
    setMenu(null)
    if (isFoldedCard) {
      unfoldRun(sessionId, turnSeq)
    } else {
      toggleFold(sessionId, turnSeq, menu.folded !== true)
    }
  }, [menu, toggleFold, unfoldRun])

  /* Archive ONE session branch (right-click a session head): archive the
     session + its whole subtree and remove it from the doc. Re-anchors when
     the archived session was the anchor; blocked when it would empty the map
     (use 归档整个导图 instead). */
  const startArchiveBranch = useCallback(() => {
    if (menu === null || menu.kind !== 'head') return
    const plan = mindmapDeletePlan(doc, String(menu.sessionId), undefined, true)
    setMenu(null)
    setArchiveBranchError(null)
    if (plan === null) {
      /* The session is not in the doc (a concurrent sync removed it): say so
         instead of the misleading "last session" message. */
      showNoticeError(translate('mindmap.delete.missing'))
      return
    }
    if (plan.lastSession === true) {
      showNoticeError(translate('mindmap.delete.lastSession'))
      return
    }
    setArchiveBranchTarget({
      sessionId: String(menu.sessionId),
      label: menu.sessionTitle || translate('mindmap.session.untitled'),
      willArchiveCurrent: plan !== null && (plan.archiveIds ?? []).includes(String(sessionId)),
    })
  }, [doc, menu, sessionId, showNoticeError])
  const closeArchiveBranch = useCallback(() => {
    if (archiveBranchBusy) return
    setArchiveBranchTarget(null)
    setArchiveBranchError(null)
  }, [archiveBranchBusy])
  const confirmArchiveBranch = useCallback(() => {
    if (forkingRef.current || archiveBranchBusy || archiveBranchTarget === null) return
    const root = rootIdRef.current ?? rootId
    const base = docRef.current ?? doc
    if (root === null || base === null) return
    /* Recompute the plan from the LATEST doc (docRef), not the render-time
       closure: a sync that folded new turns while the dialog was open must not
       be rolled back by a write built from the stale session list (the Host's
       stale-write guard only protects whole sessions, not per-session turn
       regressions). */
    const plan = mindmapDeletePlan(base, archiveBranchTarget.sessionId, undefined, true)
    if (plan === null) {
      setArchiveBranchError(translate('mindmap.delete.missing'))
      return
    }
    if (plan.lastSession === true) {
      setArchiveBranchError(translate('mindmap.delete.lastSession'))
      return
    }
    forkingRef.current = true
    setArchiveBranchBusy(true)
    setArchiveBranchError(null)
    localWriteSeqRef.current += 1
    savingRef.current += 1
    const next = { ...base, sessions: plan.sessions, next: plan.next, updatedAt: Date.now() }
    /* Re-anchor when the archived session was the anchor (the doc file moves
       via prevSessionId). */
    let saveRoot = String(root)
    let prevRoot = undefined
    if (!next.sessions.some(s => String(s?.sessionId) === String(saveRoot))) {
      const anchor = next.sessions[0]?.sessionId
      if (anchor !== undefined && anchor !== null && anchor !== '') {
        next.rootSessionId = String(anchor)
        saveRoot = String(anchor)
        prevRoot = String(root)
      }
    }
    setDoc(next)
    lastFingerprintRef.current = mindmapDocFingerprint(next)
    /* Archive-first for NON-root removals: the Host's stale-write guard
       restores any session the incoming doc drops that is NOT archived yet
       (see src/host/mindmap.js writeMindmapDoc), so the pruned sessions must
       be archived BEFORE the doc write or the guard would resurrect them for
       up to a sync cycle. Root replacements (prevRoot) retire the old root by
       writing a fresh doc file + alias stub in the SAME request and keep the
       archive-after-write contract (a failed write must not orphan the map). */
    const isRootReplacement = prevRoot !== undefined
    const archivePruned = () => Promise.all(plan.archiveIds.map(id => archiveSessionRef.current(String(id)).catch(() => {})))
    /* Archive-first has made a non-root removal IRREVERSIBLE before the
       write: retry a transient 409 (concurrent root replacement / lock
       contention) once — it materially narrows the "failed write = branch
       still removed" window without masking real errors. */
    const saveWithRetry = () => saveDocRef.current(saveRoot, next, undefined, prevRoot)
      .catch((error) => {
        if (error?.status === 409) return saveDocRef.current(saveRoot, next, undefined, prevRoot)
        throw error
      })
    const beforeWrite = isRootReplacement ? undefined : archivePruned()
    Promise.resolve(beforeWrite)
      .then(() => saveWithRetry())
      .then((written) => {
        /* Adopt the Host's canonical doc (it may have clamped next or restored
           a session): client memory converges to server truth so a later
           structural write can never clobber from a stale copy. */
        if (written?.doc !== null && written?.doc !== undefined && mountedRef.current) {
          setDoc(written.doc)
          lastFingerprintRef.current = mindmapDocFingerprint(written.doc)
        }
        return isRootReplacement ? archivePruned() : undefined
      })
      .then(() => {
        if (!mountedRef.current) return
        if (String(saveRoot) !== String(root)) {
          setRootId(String(saveRoot))
          /* Keep the ref in lockstep so switchToSession below remembers the
             last-selected session under the NEW root. */
          rootIdRef.current = String(saveRoot)
        }
        setArchiveBranchTarget(null)
        mindmapRegistry.markDirty()
        /* If the current chat session was archived, switch to the (re-anchored)
           root so the view is never left on a dead session. switchToSession
           (not openSessionRef) also records the last-selected session. */
        if ((plan.archiveIds ?? []).includes(String(sessionId))) switchToSession(String(saveRoot))
        showNotice(translate('mindmap.branchArchived'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        /* Non-root archive-first removals are NOT rollback-able: the branches
           are already archived server-side, so restoring the in-memory doc is
           a ghost the next sync overwrites anyway, and the user would see
           "failed" while the branches actually vanish. Adopt the Host's
           CURRENT truth (its reconcile prunes the archived sessions) and close
           the dialog with an honest notice. Root replacements archive AFTER
           the write, so their rollback stays valid. */
        if (isRootReplacement) {
          setDoc(prev => (prev === next ? base : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(base)
          setArchiveBranchError(error instanceof Error ? error.message : String(error))
          return
        }
        setArchiveBranchTarget(null)
        const adoptRoot = String(saveRoot)
        /* Family-generation guard: the reload is async and the overlay stays
           mounted across family switches (mountedRef is always true while the
           overlay is open), so a stale reload could overwrite the NEW family's
           view and pollute rootIdRef — stranding the periodic sync on the old
           family. Apply the loaded doc only when the family is unchanged. */
        const reloadFamily = String(rootIdRef.current ?? rootId)
        void Promise.resolve(loadDocRef.current(adoptRoot)).then((payload) => {
          if (!mountedRef.current) return
          if (String(rootIdRef.current ?? '') !== reloadFamily) return
          const loaded = payload?.doc
          if (loaded !== null && loaded !== undefined && (loaded.sessions ?? []).length > 0) {
            lastFingerprintRef.current = mindmapDocFingerprint(loaded)
            setDoc(loaded)
            if (String(loaded.rootSessionId) !== adoptRoot) {
              setRootId(String(loaded.rootSessionId))
              rootIdRef.current = String(loaded.rootSessionId)
            }
          }
          showNoticeError(translate('mindmap.archive.writeFailed', { message: error instanceof Error ? error.message : String(error) }))
        }).catch(() => {
          if (mountedRef.current) showNoticeError(translate('mindmap.archive.writeFailed', { message: error instanceof Error ? error.message : String(error) }))
        })
      })
      .finally(() => {
        savingRef.current -= 1
        forkingRef.current = false
        if (mountedRef.current) setArchiveBranchBusy(false)
      })
  }, [archiveBranchBusy, archiveBranchTarget, doc, rootId, sessionId, showNotice])

  const startArchiveAll = useCallback(() => {
    setArchiveError(null)
    setArchiveConfirmText('')
    setArchiveTarget({
      title: doc?.rootTitle
        || (rootId !== null ? (list.titles[rootId] ?? '') : '')
        || '',
    })
  }, [doc, list, rootId])
  const closeArchive = useCallback(() => {
    if (archiveBusy) return
    setArchiveTarget(null)
    setArchiveError(null)
    setArchiveConfirmText('')
  }, [archiveBusy])
  const confirmArchive = useCallback(() => {
    if (forkingRef.current || archiveBusy || archiveTarget === null) return
    /* Double insurance: archiving the whole map requires the user to have
       manually typed "yes" (trimmed, case-insensitive) into the confirm
       field — the dialog's confirm button is disabled until then. */
    if (archiveConfirmText.trim().toLowerCase() !== 'yes') return
    forkingRef.current = true
    setArchiveBusy(true)
    setArchiveError(null)
    localWriteSeqRef.current += 1
    savingRef.current += 1
    const run = async () => {
      const root = rootIdRef.current ?? rootId
      /* Build the id set from the LATEST doc (docRef), not the render-time
         closure: a branch folded by a sync while the confirm dialog was open
         must be archived with the whole map, or it would resurface as an
         ordinary session right after the doc delete and the hider drops it. */
      const latestDoc = docRef.current ?? doc
      const ids = [root]
      for (const s of latestDoc?.sessions ?? []) ids.push(s?.sessionId)
      const unique = [...new Set(ids)].filter(id => id !== undefined && id !== null && id !== '')
      /* Do NOT switch the chat to the root first: the root is archived moments
         later, which would leave the conversation on a doomed session — the
         harness settles the current session on its own once the archive lands. */
      for (const id of unique) await archiveSessionRef.current(String(id)).catch(() => {})
      if (root !== null && root !== undefined) {
        await deleteDocRef.current(String(root))
        /* The map is gone: drop its remembered last-selected session so a
           stale entry never lingers (the archived root can never reopen). */
        removeMindmapLastSession(String(root))
      }
      mindmapRegistry.markDirty()
      /* The document is gone: close the floating window instead of leaving a
         stale map (a later sync could resurrect the doc from the root's log). */
      mindmapOverlayStore.close()
    }
    run()
      .then(() => {
        if (!mountedRef.current) return
        setArchiveBusy(false)
        setArchiveTarget(null)
        showNotice(translate('mindmap.archivedAll'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        setArchiveBusy(false)
        setArchiveError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { savingRef.current -= 1; forkingRef.current = false })
  }, [archiveBusy, archiveTarget, archiveConfirmText, doc, rootId, sessionId, showNotice])

  const startDelete = useCallback(() => {
    if (menu === null || menu.kind !== 'card') return
    /* Pre-compute the plan so the dialog can warn when the CURRENT session is
       among the pruned subtree sessions (it will be archived and the view
       switched away). */
    const plan = mindmapDeletePlan(doc, String(menu.sessionId), menu.turnSeq, menu.empty === true)
    setMenu(null)
    setDeleteError(null)
    if (plan === null) {
      /* The target card is not in the doc anymore (a concurrent sync removed
         it): say so instead of opening a dialog with nothing to delete. */
      showNoticeError(translate('mindmap.delete.missing'))
      return
    }
    setDeleteTarget({
      sessionId: String(menu.sessionId),
      turnSeq: menu.turnSeq,
      empty: menu.empty === true,
      label: menu.empty
        ? translate('mindmap.pending')
        /* A folded card's delete truncates from the run's first card — the
           dialog names the whole run so the scope is explicit. */
        : menu.foldCount !== undefined
          ? translate('mindmap.folded', { n: menu.foldCount })
          : mindmapClip(String(menu.question ?? menu.sessionTitle ?? ''), 20),
      /* The current session is warned when it will be archived: a pruned
         subtree session, or the replaced session of a truncation. */
      willArchiveCurrent: plan !== null && plan.lastSession !== true && (
        (plan.archiveIds ?? []).includes(String(sessionId))
        || (plan.replaced !== null && String(plan.replaced.sessionId) === String(sessionId))),
    })
  }, [doc, menu, sessionId])
  const closeDelete = useCallback(() => {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteError(null)
  }, [deleteBusy])
  /* Right-click a card → 重新生成摘要: the Host runs the LLM call synchronously
     and persists the new summary; the card updates optimistically here (the
     periodic sync would converge anyway). In-flight sync responses issued before
     the optimistic write are dropped so the fresh summary cannot flicker away. */
  const regenerateSummary = useCallback(() => {
    if (menu === null || menu.kind !== 'card' || !Number.isSafeInteger(menu.turnSeq)) return
    const sessionId = String(menu.sessionId)
    const seq = Number(menu.turnSeq)
    setMenu(null)
    /* Local in-flight marker: the Host's synchronous regenerate never enters
       its background in-flight set, so the status row tracks it here (removed
       on settle below). */
    setManualSummarizing(prev => prev.some(p => String(p.sessionId) === sessionId && Number(p.seq) === seq)
      ? prev
      : [...prev, { sessionId, seq }])
    showNotice(translate('mindmap.summary.regenerating'))
    /* Arm the sync guard for the whole LLM round-trip (up to 25 s): a periodic
       sync resolving mid-call must not roll back the optimistic summary. No
       forkingRef gate here — blocking forks for the whole call would be worse. */
    savingRef.current += 1
    Promise.resolve(regenerateMindmapSummary(sessionId, seq, summaryConfigRef.current))
      .then((payload) => {
        if (payload?.ok === true && typeof payload.summary === 'string') {
          /* The Host persisted the summary. Apply the optimistic update only
             while the card's family is still the one on screen: a family
             switch mid-call must not overwrite the new map's doc with the old
             one (the next sync would correct it, but the wrong map would
             flash). Built from the CURRENT doc (docRef) so a sync that landed
             during the call is never rolled back. */
          const currentDoc = docRef.current
          if (currentDoc !== null && familyIdsRef.current.includes(sessionId)) {
            const next = {
              ...currentDoc,
              sessions: currentDoc.sessions.map(s =>
                String(s?.sessionId) !== sessionId
                  ? s
                  : { ...s, turns: (s?.turns ?? []).map(t =>
                    t !== null && t !== undefined && Number(t?.seq) === seq
                      ? { ...t, summary: payload.summary }
                      : t) }),
            }
            localWriteSeqRef.current += 1
            setDoc(next)
            lastFingerprintRef.current = mindmapDocFingerprint(next)
          }
          showNotice(translate('mindmap.summary.regenerated'))
        } else {
          const key = payload?.code === 'no-model'
            ? 'mindmap.summary.fail.noModel'
            : payload?.code === 'turn-gone'
              ? 'mindmap.summary.fail.turnGone'
              : 'mindmap.summary.fail.generationFailed'
          showNoticeError(translate('mindmap.summary.regenerateFailed', { message: translate(key) }))
        }
      })
      .catch((error) => {
        showNoticeError(translate('mindmap.summary.regenerateFailed', { message: error?.message ?? String(error) }))
      })
      .finally(() => {
        savingRef.current -= 1
        if (mountedRef.current) {
          setManualSummarizing(prev => prev.filter(p => !(String(p.sessionId) === sessionId && Number(p.seq) === seq)))
        }
      })
  }, [menu, showNotice, showNoticeError])
  /* Toolbar → 重新生成全部摘要: count the doc's turns, confirm (token cost is
     transparent), then ask the Host to force-enqueue every turn. Old summaries
     stay until the new ones land; the per-card "正在生成摘要中…" status arrives
     via the sync response, so no optimistic doc change is needed here. */
  const startRegenerateAll = useCallback(() => {
    if (doc === null) return
    let count = 0
    for (const s of doc.sessions ?? []) {
      for (const t of s?.turns ?? []) {
        if (t !== null && t !== undefined && Number.isSafeInteger(t?.seq)) count += 1
      }
    }
    if (count === 0) {
      showNotice(translate('mindmap.summary.regenerateAll.empty'))
      return
    }
    setRegenerateAllError(null)
    setRegenerateAllTarget({ count })
  }, [doc, showNotice])
  const closeRegenerateAll = useCallback(() => {
    if (regenerateAllBusy) return
    setRegenerateAllTarget(null)
    setRegenerateAllError(null)
  }, [regenerateAllBusy])
  const confirmRegenerateAll = useCallback(() => {
    if (regenerateAllBusy || regenerateAllTarget === null) return
    const root = rootIdRef.current ?? rootId
    if (root === null) return
    setRegenerateAllBusy(true)
    setRegenerateAllError(null)
    /* Arm the sync guard for the whole Host round-trip (the optimistic
       session-summary clear below must not be rolled back by a stale sync). */
    savingRef.current += 1
    Promise.resolve(regenerateAllMindmapSummaries(root, summaryConfigRef.current))
      .then((payload) => {
        if (payload?.ok === true) {
          /* The Host cleared every session summary (they auto-regenerate after
             the card batch); mirror that locally so the head cards drop their
             stale paragraphs immediately. */
          const currentDoc = docRef.current
          if (currentDoc !== null) {
            const next = {
              ...currentDoc,
              sessions: currentDoc.sessions.map(s => {
                if (s === null || s === undefined) return s
                if (typeof s.summary === 'string' && s.summary !== '') {
                  const copy = { ...s }
                  delete copy.summary
                  return copy
                }
                return s
              }),
            }
            localWriteSeqRef.current += 1
            setDoc(next)
            lastFingerprintRef.current = mindmapDocFingerprint(next)
          }
          const count = Number.isSafeInteger(payload.count) ? payload.count : regenerateAllTarget.count
          showNotice(translate('mindmap.summary.regenerateAll.started', { n: count }))
        } else {
          /* Defensive: the Host's regenerate-all normally throws (HTTP error)
             instead of answering ok:false, but never show an empty message
             when a code is absent. */
          const code = payload?.code === 'no-model'
            ? 'mindmap.summary.fail.noModel'
            : payload?.code === 'turn-gone'
              ? 'mindmap.summary.fail.turnGone'
              : 'mindmap.summary.fail.generationFailed'
          showNoticeError(translate('mindmap.summary.regenerateAll.failed', { message: translate(code) }))
        }
      })
      .catch((error) => {
        showNoticeError(translate('mindmap.summary.regenerateAll.failed', { message: error?.message ?? String(error) }))
      })
      .finally(() => {
        savingRef.current -= 1
        if (mountedRef.current) {
          setRegenerateAllBusy(false)
          setRegenerateAllTarget(null)
        }
      })
  }, [regenerateAllBusy, regenerateAllTarget, rootId, showNotice, showNoticeError])
  /* 右键会话头 → 总结当前会话: ready sessions return synchronously ('done' —
     show the result dialog + optimistic doc update); sessions with missing or
     in-flight card summaries return 'waiting' — the Host generates the missing
     ones and the drain finishes the session summary in the background, which
     the waiting effect below picks up from a later sync. */
  const startSummarizeSession = useCallback(() => {
    if (menu === null || menu.kind !== 'head') return
    const sessionId = String(menu.sessionId)
    setMenu(null)
    if (sessionSummaryBusyId !== null) return
    setSessionSummaryBusyId(sessionId)
    showNotice(translate('mindmap.sessionSummary.generating'))
    /* Arm the sync guard for the whole LLM round-trip (up to 25 s): a sync
       resolving mid-call must not roll back the optimistic session summary. */
    savingRef.current += 1
    Promise.resolve(summarizeMindmapSession(sessionId, summaryConfigRef.current))
      .then((payload) => {
        if (payload?.ok === true && payload.status === 'done' && typeof payload.summary === 'string') {
          /* No result dialog (user decision): the head card shows the summary
             immediately via the optimistic doc update. */
          const currentDoc = docRef.current
          if (currentDoc !== null) {
            const next = {
              ...currentDoc,
              sessions: currentDoc.sessions.map(s =>
                String(s?.sessionId) !== sessionId
                  ? s
                  : { ...s, summary: payload.summary }),
            }
            localWriteSeqRef.current += 1
            setDoc(next)
            lastFingerprintRef.current = mindmapDocFingerprint(next)
          }
        } else if (payload?.ok === true && payload.status === 'waiting') {
          setSessionSummaryWaiting(sessionId)
          showNotice(translate('mindmap.sessionSummary.waiting'))
        } else if (payload?.ok === true && payload.status === 'empty') {
          showNotice(translate('mindmap.sessionSummary.empty'))
        } else {
          const key = payload?.code === 'no-model'
            ? 'mindmap.summary.fail.noModel'
            : payload?.code === 'session-gone'
              ? 'mindmap.sessionSummary.fail.sessionGone'
              : 'mindmap.summary.fail.generationFailed'
          showNoticeError(translate('mindmap.sessionSummary.failed', { message: translate(key) }))
        }
      })
      .catch((error) => {
        showNoticeError(translate('mindmap.sessionSummary.failed', { message: error?.message ?? String(error) }))
      })
      .finally(() => {
        savingRef.current -= 1
        if (mountedRef.current) setSessionSummaryBusyId(null)
      })
  }, [menu, sessionSummaryBusyId, showNotice, showNoticeError])
  /* Waiting completion: a later sync brings the session's summary — the head
     card updates by itself (no dialog). A 5-minute stall (generation failed and
     cooled down, or the map was closed) surfaces as a timeout notice. */
  useEffect(() => {
    if (sessionSummaryWaiting === null) return undefined
    const session = (doc?.sessions ?? []).find(s => s !== null && s !== undefined && String(s.sessionId) === String(sessionSummaryWaiting))
    if (session !== undefined && typeof session.summary === 'string' && session.summary !== '') {
      setSessionSummaryWaiting(null)
      return undefined
    }
    const timer = window.setTimeout(() => {
      if (mountedRef.current) {
        setSessionSummaryWaiting(null)
        showNoticeError(translate('mindmap.sessionSummary.timeout'))
      }
    }, 5 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [doc, sessionSummaryWaiting, showNoticeError])
  /* Escape closes the archive / delete dialogs (rename and the context menu
     handle their own). The overlay's own Escape handler defers while a
     .dsh-ws-dialog-backdrop is in the DOM, so without this the key does
     nothing while one of these dialogs is open. */
  useEffect(() => {
    if (archiveTarget === null && deleteTarget === null && archiveBranchTarget === null && regenerateAllTarget === null) return undefined
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      closeArchive()
      closeDelete()
      closeArchiveBranch()
      closeRegenerateAll()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [archiveTarget, closeArchive, closeDelete, deleteTarget, archiveBranchTarget, closeArchiveBranch, regenerateAllTarget, closeRegenerateAll])
  const confirmDelete = useCallback(() => {
    if (forkingRef.current || deleteBusy || deleteTarget === null) return
    const root = rootIdRef.current ?? rootId
    const base = docRef.current ?? doc
    if (root === null || base === null) return
    /* Recompute the plan from the LATEST doc (docRef), not the render-time
       closure: a sync that folded new turns while the dialog was open must not
       be rolled back by a write built from the stale session list (the Host's
       stale-write guard only protects whole sessions, not per-session turn
       regressions). */
    const plan = mindmapDeletePlan(base, deleteTarget.sessionId, deleteTarget.turnSeq, deleteTarget.empty)
    if (plan === null) { setDeleteError(translate('mindmap.delete.missing')); return }
    if (plan.lastSession === true) { setDeleteError(translate('mindmap.delete.lastSession')); return }
    forkingRef.current = true
    setDeleteBusy(true)
    setDeleteError(null)
    localWriteSeqRef.current += 1
    savingRef.current += 1
    let forkedChildId = null
    const next = { ...base }
    /* Hoisted to the FUNCTION scope: the .catch below reads these after the
       .then callback settled. Declaring them inside the .then would throw
       ReferenceError on every failure path (a sibling .catch cannot see the
       .then's block scope), silently disabling the write-failure contract —
       same shape as confirmArchiveBranch's function-level declarations. */
    let saveRoot = String(root)
    let prevRoot = undefined
    /* A truncation of the ANCHOR session makes the fork child the doc's new
       root (and the map file moves to it): it must not get the branch " ›"
       suffix (forkAt renames branch children to it), so the child is told it
       is replacing the root. A whole-session removal of the anchor re-anchors
       to the first remaining session. Both retire the old root's doc file via
       prevSessionId. */
    const isRootReplacement = plan.replaced !== null && String(plan.replaced.sessionId) === String(root)
    Promise.resolve(
      plan.replaced === null
        ? null
        : forkAtRef.current(String(plan.replaced.sessionId), plan.replaced.forkAt, isRootReplacement))
      .then(async (childId) => {
        if (plan.replaced !== null) {
          /* A truncation fork succeeded: swap the replaced session's entry to
             the fork child. The kept cards keep their display numbers (the fork
             child's seed carries the same turn/end seqs), and every surviving
             session that hung off the replaced session re-anchors to it. */
          if (childId === null || childId === undefined) throw new Error(translate('mindmap.delete.missing'))
          forkedChildId = String(childId)
          const replacedId = String(plan.replaced.sessionId)
          next.sessions = plan.sessions.map(s =>
            String(s?.sessionId) === replacedId ? { ...s, sessionId: forkedChildId } : s)
          next.sessions = next.sessions.map(s =>
            String(s?.parentSessionId) === replacedId ? { ...s, parentSessionId: forkedChildId } : s)
          if (isRootReplacement) next.rootSessionId = forkedChildId
          /* Nothing records which turns were cut: the truncated session's log
             just lacks the removed turns and the old session (plus every
             pruned subtree session) is archived. A failed archive may
             legitimately resurrect the old session or leak a pruned session
             into the sidebar (ACCEPTED — see docs/mindmap-notes.md). */
        } else {
          /* Whole-session removal: prune the session entry; the session (and
             its subtree) is archived. A failed archive may resurrect the
             placeholder later (ACCEPTED). */
          next.sessions = plan.sessions
        }
        /* Re-anchor when the anchor session itself was removed. A root
           REPLACEMENT already established the fork child as the new root
           above (next.rootSessionId = forkedChildId): retire the old root's
           doc file via prevSessionId directly, instead of re-deriving the
           anchor from sessions[0] (which is only guaranteed to be the root by
           an implicit ordering convention — a future reorder would store the
           doc under the wrong root and orphan the fork child). */
        if (isRootReplacement) {
          saveRoot = forkedChildId
          prevRoot = String(root)
        } else if (!next.sessions.some(s => String(s?.sessionId) === String(saveRoot))) {
          const anchor = next.sessions[0]?.sessionId
          if (anchor !== undefined && anchor !== null && anchor !== '') {
            next.rootSessionId = String(anchor)
            saveRoot = String(anchor)
            prevRoot = String(root)
          }
        }
        next.next = plan.next
        next.updatedAt = Date.now()
        setDoc(next)
        lastFingerprintRef.current = mindmapDocFingerprint(next)
        /* Archive-first for NON-root removals: the Host's stale-write guard
           restores any session the incoming doc drops that is NOT archived yet
           (see src/host/mindmap.js writeMindmapDoc), so the pruned subtree AND
           the replaced session must be archived BEFORE the doc write or the
           guard would resurrect them for up to a sync cycle. Root replacements
           (prevRoot) retire the old root via a fresh doc file + alias stub in
           the SAME request and keep archive-after-write: a failed write must
           never leave the map without a root doc, and the archive that follows
           it is the truncation's only durability step. */
        const archiveIds = [...plan.archiveIds]
        if (plan.replaced !== null) archiveIds.push(String(plan.replaced.sessionId))
        const archiveRetired = () => Promise.all(archiveIds.map(id => archiveSessionRef.current(String(id)).catch(() => {})))
        if (prevRoot === undefined) await archiveRetired()
        /* Archive-first has made a NON-ROOT removal irreversible before the
           write: retry a transient 409 (concurrent root replacement / lock
           contention) once — it materially narrows the "failed write = whole
           branch gone" window without masking real errors. */
        let written
        for (let attempt = 0; ; attempt += 1) {
          try {
            written = await saveDocRef.current(saveRoot, next, undefined, prevRoot)
            break
          } catch (error) {
            if (attempt === 0 && error?.status === 409) continue
            throw error
          }
        }
        if (prevRoot !== undefined) await archiveRetired()
        /* Adopt the Host's canonical doc (it may have clamped next or restored
           a session): client memory converges to server truth so a later
           structural write can never clobber from a stale copy. */
        if (written?.doc !== null && written?.doc !== undefined && mountedRef.current) {
          setDoc(written.doc)
          lastFingerprintRef.current = mindmapDocFingerprint(written.doc)
        }
        if (!mountedRef.current) return
        if (String(saveRoot) !== String(root)) {
          setRootId(String(saveRoot))
          /* Keep the ref in lockstep so switchToSession below remembers the
             last-selected session under the NEW root (the ref only re-syncs on
             the next render, which is after this handler). */
          rootIdRef.current = String(saveRoot)
        }
        /* Close the dialog before the notice and any session switch. */
        setDeleteTarget(null)
        mindmapRegistry.markDirty()
        /* Switch the chat (and the map highlight) to the truncated session,
           or back to the root when the current one was archived. switchToSession
           (not openSessionRef) also records the last-selected session. */
        if (forkedChildId !== null) {
          switchToSession(forkedChildId)
        } else if ((plan.archiveIds ?? []).includes(String(sessionId))) {
          switchToSession(String(saveRoot))
        }
        showNotice(forkedChildId !== null ? translate('mindmap.truncated') : translate('mindmap.deleted'))
      })
      .catch((error) => {
        if (!mountedRef.current) return
        /* Non-root removals archive BEFORE the write, so a persistent write
           failure is NOT rollback-able: faking an in-memory rollback would be
           overwritten by the next sync (which drops the archived sessions),
           and archiving the freshly forked child — the ONLY carrier of the
           preserved turns — would turn "delete one card" into "delete the
           whole branch". Adopt the Host's CURRENT truth (its reconcile prunes
           the archived sessions and re-parents their children) and close the
           dialog with an honest notice; the forked child (if the fork landed)
           stays as the preserved copy. Root replacements (prevRoot) archive
           AFTER the write, so their rollback stays valid and the child is
           simply re-adopted later. */
        if (prevRoot !== undefined) {
          setDoc(prev => (prev === next ? base : prev))
          lastFingerprintRef.current = mindmapDocFingerprint(base)
          setDeleteError(error instanceof Error ? error.message : String(error))
          return
        }
        setDeleteTarget(null)
        const adoptRoot = String(saveRoot)
        /* Family-generation guard: the reload is async and the overlay stays
           mounted across family switches (mountedRef is always true while the
           overlay is open), so a stale reload could overwrite the NEW family's
           view and pollute rootIdRef — stranding the periodic sync on the old
           family. Apply the loaded doc only when the family is unchanged. */
        const reloadFamily = String(rootIdRef.current ?? rootId)
        void Promise.resolve(loadDocRef.current(adoptRoot)).then((payload) => {
          if (!mountedRef.current) return
          if (String(rootIdRef.current ?? '') !== reloadFamily) return
          const loaded = payload?.doc
          if (loaded !== null && loaded !== undefined && (loaded.sessions ?? []).length > 0) {
            lastFingerprintRef.current = mindmapDocFingerprint(loaded)
            setDoc(loaded)
            if (String(loaded.rootSessionId) !== adoptRoot) {
              setRootId(String(loaded.rootSessionId))
              rootIdRef.current = String(loaded.rootSessionId)
            }
          }
          showNoticeError(translate('mindmap.delete.writeFailed', { message: error instanceof Error ? error.message : String(error) }))
        }).catch(() => {
          if (mountedRef.current) showNoticeError(translate('mindmap.delete.writeFailed', { message: error instanceof Error ? error.message : String(error) }))
        })
      })
      .finally(() => {
        savingRef.current -= 1
        forkingRef.current = false
        if (mountedRef.current) setDeleteBusy(false)
      })
  }, [deleteBusy, deleteTarget, doc, rootId, sessionId, showNotice])

  /* Cards whose AI summary is being generated: union of the Host's background
     queue (per sync) and local manual regenerations. Keyed like the layout
     cards (`sessionId:seq`) for O(1) lookup. Must be declared BEFORE the
     phase early returns below: React requires a stable hook order across
     renders, and the error/loading/empty branches would otherwise skip this
     hook and re-add it on the next normal render (React error #310). */
  const summarizingKeys = useMemo(() => {
    const set = new Set()
    for (const item of summarizing) {
      if (item !== null && item !== undefined) set.add(`${String(item.sessionId)}:${Number(item.seq)}`)
    }
    for (const item of manualSummarizing) {
      if (item !== null && item !== undefined) set.add(`${String(item.sessionId)}:${Number(item.seq)}`)
    }
    return set
  }, [summarizing, manualSummarizing])

  /* AI summaries keyed `sessionId:seq`, read from the CURRENT doc: the layout
     nodes keep the turn objects of the doc snapshot they were built from, so a
     summary written after that snapshot would be invisible through entry.turn.
     The card receives its summary as a plain string prop instead — memo
     compares it by value, so only the affected card re-renders. */
  const summaryByKey = useMemo(() => {
    const map = new Map()
    for (const s of doc?.sessions ?? []) {
      if (s === null || s === undefined || typeof s.sessionId !== 'string') continue
      for (const turn of s.turns ?? []) {
        if (turn === null || turn === undefined || !Number.isSafeInteger(turn.seq)) continue
        if (typeof turn.summary === 'string' && turn.summary !== '') {
          map.set(mindmapDocKey(String(s.sessionId), Number(turn.seq)), turn.summary)
        }
      }
    }
    return map
  }, [doc])

  /* sessionId → last turn seq, precomputed so mindmapCardClickAction (called
     per card on every render) is O(1) instead of scanning all sessions. The
     openCard callback reads it through a ref (it is stable, empty deps). */
  const lastTurnSeqBySession = useMemo(() => {
    const map = new Map()
    for (const s of doc?.sessions ?? []) {
      if (s === null || s === undefined || typeof s.sessionId !== 'string') continue
      const turns = s.turns ?? []
      map.set(String(s.sessionId), turns.length > 0 ? turns[turns.length - 1]?.seq : undefined)
    }
    return map
  }, [doc])
  const lastTurnSeqBySessionRef = useRef(lastTurnSeqBySession)
  lastTurnSeqBySessionRef.current = lastTurnSeqBySession

  /* Session-level AI summaries keyed by session id, read from the CURRENT doc
     (same staleness argument as summaryByKey: the layout's session objects are
     structure-memoized). Drives the head card's summary area + tooltip. */
  const sessionSummaryByKey = useMemo(() => {
    const map = new Map()
    for (const s of doc?.sessions ?? []) {
      if (s === null || s === undefined || typeof s.sessionId !== 'string') continue
      if (typeof s.summary === 'string' && s.summary !== '') map.set(String(s.sessionId), s.summary)
    }
    return map
  }, [doc])

  /* Sessions whose SESSION summary is being generated: the Host-reported set
     (regenerate-all auto-generation) plus the local synchronous request and the
     waiting flag. Drives the head card's "正在总结中…" status row. */
  const sessionSummarizingSet = useMemo(() => {
    const set = new Set()
    for (const id of sessionSummarizing) {
      if (id !== null && id !== undefined) set.add(String(id))
    }
    if (sessionSummaryBusyId !== null) set.add(String(sessionSummaryBusyId))
    if (sessionSummaryWaiting !== null) set.add(String(sessionSummaryWaiting))
    return set
  }, [sessionSummarizing, sessionSummaryBusyId, sessionSummaryWaiting])

  /* Blank-area menu availability (drives the disabled state of the fold-all /
     unfold-all items): 折叠全部 needs at least one temporarily-expanded
     (peeked) run to fold back; 展开全部 needs at least one folded run. */
  const hasCollapsible = peekedRuns.size > 0
  const hasFolded = useMemo(() => {
    for (const s of doc?.sessions ?? []) {
      for (const t of s?.turns ?? []) {
        if (t !== null && t !== undefined && t.folded === true) return true
      }
    }
    return false
  }, [doc])

  if (phase.status === 'error') {
    /* A transient load failure (Host lock contention, network blip, 500)
       must not be a dead end: the retry re-runs the same load sequence. */
    return h('div', { className: 'dsh-ws-mindmap dsh-ws-mindmap-status' },
      h('div', { className: 'dsh-ws-mindmap-error' }, translate('mindmap.error', { message: phase.message ?? '' })),
      h('button', { className: 'dsh-ws-text-button dsh-ws-mindmap-retry', onClick: retryLoad, type: 'button' }, translate('mindmap.retry')))
  }
  if (phase.status === 'loading') {
    return h('div', { className: 'dsh-ws-mindmap dsh-ws-mindmap-status' },
      h('div', { className: 'dsh-ws-mindmap-loading' }, translate('mindmap.loading')))
  }
  if (phase.status === 'empty' || layout.nodes.length === 0) {
    return h('div', { className: 'dsh-ws-mindmap dsh-ws-mindmap-status' },
      h('div', { className: 'dsh-ws-mindmap-empty' }, translate('mindmap.empty')))
  }

  /* The header shows the mind map's OWN title (doc.rootTitle), independent of
     the root session's title after a sidebar rename; the session title is only
     the fallback when the doc has none. */
  const rootTitle = doc?.rootTitle
    || (rootId !== null && rootId !== undefined ? (list.titles[rootId] ?? '') : '')
    || ''
  const { edges: edgeEdges, streamingEntries } = edgeView

  const nodeViews = layout.nodes.map((entry) => {
    const isStreaming = entry.streaming === true
    const title = list.titles[String(entry.sessionId)] || translate('mindmap.session.untitled')
    const isRunning = runningFamilyIds.includes(String(entry.sessionId))
    /* 方案 B: a completed card whose AI summary is in flight shows
       "正在生成摘要中…" in its status row instead of "已完成". Streaming and
       empty cards never summarize (no completed turn to summarize). */
    const isSummarizing = !isStreaming && entry.empty !== true && entry.turn !== undefined && entry.turn !== null
      && summarizingKeys.has(mindmapDocKey(String(entry.sessionId), Number(entry.turn.seq)))
    /* The card's AI summary, read from the CURRENT doc (layout nodes keep the
       turn objects of the doc snapshot they were built from). A plain string
       prop: React.memo compares it by value, so a summary write re-renders only
       this card — never the whole canvas. */
    const summary = entry.kind === 'card' && entry.empty !== true && entry.turn !== undefined && entry.turn !== null
      ? summaryByKey.get(mindmapDocKey(String(entry.sessionId), Number(entry.turn.seq)))
      : undefined
    /* Ring: the streaming card and its parent node (card or head) both wear the
       pair's flowing gradient border. A node that is the parent of several
       streaming cards takes the first pair's palette. */
    let ringPalette = undefined
    if (isStreaming) {
      const info = streamingEntries.find(s => s.entry.key === entry.key)
      ringPalette = info?.palette
    } else {
      const info = streamingEntries.find(s => s.parentKey === entry.key)
      ringPalette = info?.palette
    }
    /* Single source of truth for what this node IS / does: the same decision
       tree as openCard and the hover hint. The click action is computed once
       and drives BOTH the hover hint ('fork' → 点击分支 / 'switch' → 点击跳转)
       and the capsule (fork glyph "分支" vs. end chip "末端"), so the hint and
       chip can never drift apart. */
    const clickAction = mindmapCardClickAction(entry, doc, runningFamilyIds, lastTurnSeqBySession)
    const common = {
      key: entry.key,
      entry,
      isCurrent: entry.key === currentKey,
      isAncestor: trace.ancestorSet.has(entry.key),
      isHoverAncestor: hoverTrace.ancestorSet.has(entry.key),
      isHover: entry.key === hoverKey,
      hintAction: entry.key === hoverKey ? clickAction : undefined,
      /* End-of-branch: click jumps (switch) instead of forking — the capsule
         chip flips from the fork glyph "分支" to the terminal "末端". */
      isEnd: clickAction === 'switch',
      ringPalette,
      onOpen: openCard,
      onHover: setHoverKey,
    }
    if (entry.kind === 'root') {
      return h(MindMapRootNode, { ...common, onMenu: openCardMenu })
    }
    if (entry.kind === 'head') {
      return h(MindMapSessionHead, {
        ...common,
        title,
        isRunning,
        onMenu: openCardMenu,
        summary: sessionSummaryByKey.get(String(entry.sessionId)),
        isSummarizing: sessionSummarizingSet.has(String(entry.sessionId)),
      })
    }
    if (entry.folded === true) {
      /* A folded card: the run's first turn's AI summary (if any) or its
         question; the count badge comes from the layout node. */
      return h(MindMapFoldedCard, {
        ...common,
        title,
        summary: entry.turn !== undefined && entry.turn !== null
          ? summaryByKey.get(mindmapDocKey(String(entry.sessionId), Number(entry.turn.seq)))
          : undefined,
        onMenu: openCardMenu,
      })
    }
    return h(MindMapCard, {
      ...common,
      title,
      isStreaming,
      isSummarizing,
      summary,
      /* A peeked card (a folded-marked turn temporarily expanded) shows the
         "已折叠" status row instead of "已完成". */
      peeked: entry.peeked === true,
      /* The streaming question is a plain string prop read from the CURRENT
         live state (the layout node's question is empty by design): memo
         compares it by value, so a question arriving mid-stream re-renders
         only this card. */
      streamingQuestion: isStreaming ? streamingQuestionByKey.get(String(entry.sessionId)) : undefined,
      onMenu: openCardMenu,
    })
  })

  const noticeView = notice === null ? null : h('div', {
    className: notice.error ? 'dsh-ws-mindmap-notice dsh-ws-mindmap-notice-error' : 'dsh-ws-mindmap-notice',
    role: notice.error ? 'alert' : 'status',
  }, notice.text)
  const menuView = menu !== null ? createPortal(
    h('div', {
      className: 'dsh-ws-context-menu' + (menu.kind === 'root' ? ' dsh-ws-context-menu-wide' : ''),
      ref: menuRef,
      role: 'menu',
      style: {
        left: Math.max(4, Math.min(menu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 4)),
        top: Math.max(4, Math.min(menu.y, window.innerHeight - 92)),
      },
    },
      menu.kind === 'card' ? h(Fragment, null,
        h('button', { className: 'dsh-ws-context-item', onClick: startRename, role: 'menuitem', title: translate('mindmap.menu.rename'), type: 'button' }, translate('mindmap.menu.rename')),
        /* 重新生成摘要: only meaningful with the AI-summary feature on AND a
           real turn (empty placeholder cards have no question to summarize).
           A FOLDED card spans a whole run — unfold it first (peeked cards are
           individual turns and stay eligible). */
        settings.mindmapSummaryEnabled === true && menu.empty !== true && Number.isSafeInteger(menu.turnSeq) && menu.foldCount === undefined
          ? h('button', { className: 'dsh-ws-context-item', onClick: regenerateSummary, role: 'menuitem', title: translate('mindmap.menu.regenerateSummary'), type: 'button' }, translate('mindmap.menu.regenerateSummary'))
          : null,
        h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
        /* 折叠 checkbox: check = mark folded (persisted); uncheck = permanent
           unfold (whole run for a folded card, this card for a peeked one). */
        menu.empty !== true && Number.isSafeInteger(menu.turnSeq)
          ? h('button', {
            className: 'dsh-ws-context-item dsh-ws-context-item-check',
            onClick: toggleFoldFromMenu,
            role: 'menuitem',
            title: translate('mindmap.menu.fold'),
            type: 'button',
          },
            h('span', { className: 'dsh-ws-context-item-check-mark' }, menu.folded === true ? '✓' : null),
            h('span', { className: 'dsh-ws-context-item-text' }, translate('mindmap.menu.fold')))
          : null,
        /* 立刻折叠: only on a marked-folded card that is temporarily expanded
           (a folded card is already folded — nothing to fold back). */
        menu.folded === true && menu.foldCount === undefined
          ? h('button', { className: 'dsh-ws-context-item', onClick: foldNow, role: 'menuitem', title: translate('mindmap.menu.foldNow'), type: 'button' }, translate('mindmap.menu.foldNow'))
          : null,
        h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
        h('button', { className: 'dsh-ws-context-item dsh-ws-context-item-danger', onClick: startDelete, role: 'menuitem', title: translate('mindmap.menu.deleteCard'), type: 'button' }, translate('mindmap.menu.deleteCard')))
        : menu.kind === 'head' ? h(Fragment, null,
          h('button', { className: 'dsh-ws-context-item', onClick: startRename, role: 'menuitem', title: translate('mindmap.menu.rename'), type: 'button' }, translate('mindmap.menu.rename')),
          /* 总结当前会话: only with the AI-summary feature on AND a session
             that has at least one turn to summarize. */
          settings.mindmapSummaryEnabled === true
            && (doc?.sessions ?? []).some(s => s !== null && s !== undefined
              && String(s.sessionId) === String(menu.sessionId)
              && Array.isArray(s.turns) && s.turns.length > 0)
            ? h('button', { className: 'dsh-ws-context-item', onClick: startSummarizeSession, role: 'menuitem', title: translate('mindmap.menu.summarizeSession'), type: 'button' }, translate('mindmap.menu.summarizeSession'))
            : null,
          h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
          h('button', { className: 'dsh-ws-context-item dsh-ws-context-item-danger', onClick: startArchiveBranch, role: 'menuitem', title: translate('mindmap.menu.archiveBranch'), type: 'button' }, translate('mindmap.menu.archiveBranch')))
          : menu.kind === 'blank' ? h(Fragment, null,
            h('button', { className: 'dsh-ws-context-item', onClick: createSessionFromBlankMenu, role: 'menuitem', title: translate('mindmap.menu.createSession'), type: 'button' }, translate('mindmap.menu.createSession')),
            h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
            h('button', { className: 'dsh-ws-context-item', disabled: !hasCollapsible, onClick: foldAllCollapsible, role: 'menuitem', title: translate('mindmap.menu.foldAll'), type: 'button' }, translate('mindmap.menu.foldAll')),
            h('button', { className: 'dsh-ws-context-item', disabled: !hasFolded, onClick: unfoldAllFolded, role: 'menuitem', title: translate('mindmap.menu.unfoldAll'), type: 'button' }, translate('mindmap.menu.unfoldAll')))
          : h(Fragment, null,
            h('div', { className: 'dsh-ws-context-label' }, translate('mindmap.workspace.title')),
            (menu.workspaces ?? []).map((w) => {
              /* Same normalized comparison as selectWorkspace/mindmapWorkspaceIdForCwd:
                 trailing slashes, Windows case (drive letters) or mixed separators
                 would otherwise leave the current workspace unchecked. */
              const isCurrent = typeof w?.path === 'string' && w.path !== '' && menu.current !== ''
                && normalizeMindmapWorkspacePath(w.path) === normalizeMindmapWorkspacePath(menu.current)
              return h('button', {
                className: 'dsh-ws-context-item dsh-ws-context-item-check',
                key: w?.id ?? w?.path ?? 'ws',
                onClick: () => selectWorkspace(typeof w?.path === 'string' ? w.path : '', w?.title ?? w?.path ?? ''),
                role: 'menuitem',
                title: translate('mindmap.workspace.set', { name: w?.title ?? w?.path ?? '' }),
                type: 'button',
              },
                h('span', { className: 'dsh-ws-context-item-text' }, w?.title ?? w?.path ?? ''),
                isCurrent ? h('span', { className: 'dsh-ws-context-item-check-mark' }, '✓') : null)
            }),
            h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
            h('button', {
              className: 'dsh-ws-context-item' + (menu.current === '' ? ' dsh-ws-context-item-check' : ''),
              onClick: () => selectWorkspace('', ''),
              role: 'menuitem',
              title: translate('mindmap.workspace.none'),
              type: 'button',
            },
              h('span', { className: 'dsh-ws-context-item-text' }, translate('mindmap.workspace.none')),
              menu.current === '' ? h('span', { className: 'dsh-ws-context-item-check-mark' }, '✓') : null),
            h('div', { className: 'dsh-ws-context-separator', role: 'separator' }),
            h('button', { className: 'dsh-ws-context-item dsh-ws-context-item-danger', onClick: startArchiveAll, role: 'menuitem', title: translate('mindmap.menu.archiveAll'), type: 'button' }, translate('mindmap.menu.archiveAll')))),
    document.body,
  ) : null

  return h(Fragment, null,
    h('div', { className: 'dsh-ws-mindmap', 'data-conversation-composer-overlay': '' },
      h(MindMapToolbar, { overlay, settings, previewRight, restoreView, addRootSession, startArchiveAll, startRegenerateAll }),
      h('div', { className: 'dsh-ws-mindmap-bar' },
        translate('mindmap.rootLabel'),
        h('span', { className: 'dsh-ws-mindmap-bar-title' }, rootTitle)),
      noticeView,
      forkError !== null ? h('div', { className: 'dsh-ws-mindmap-fork-error' }, translate('mindmap.forkFailed', { message: forkError })) : null,
      h('div', { className: 'dsh-ws-mindmap-viewport', 'data-dragging': dragging ? '' : undefined, onContextMenu: openBlankMenu, onPointerCancel: endPan, onPointerDown: startPan, onPointerMove: movePan, onPointerUp: endPan, ref: viewportRef },
        h('div', { className: 'dsh-ws-mindmap-canvas', ref: canvasRef, style: { height: layout.height, width: layout.width } },
          h('svg', { className: 'dsh-ws-mindmap-edges', width: layout.width, height: layout.height },
            h('defs', null,
              streamingEntries.map((item) => item.bbox === undefined
                ? null
                : h('linearGradient', {
                  gradientUnits: 'userSpaceOnUse',
                  id: item.gradId,
                  key: item.gradId,
                  x1: item.bbox.x1,
                  x2: item.bbox.x2,
                  y1: item.bbox.y1,
                  y2: item.bbox.y2,
                },
                  item.palette.map((color, i) => h('stop', {
                    key: i,
                    offset: `${i * 50}%`,
                    stopColor: color,
                  }))))),
            edgeEdges.map((edge, index) => {
              const flow = edge.flow
              if (flow === undefined) {
                return h('path', {
                  className: 'dsh-ws-mindmap-edge'
                    + (edge.mount === true ? ' dsh-ws-mindmap-edge-mount' : '')
                    + (trace.activeEdgeKeys.has(`${edge.from}\u0000${edge.to}`) ? ' dsh-ws-mindmap-edge-active' : '')
                    + (hoverTrace.activeEdgeKeys.has(`${edge.from}\u0000${edge.to}`) ? ' dsh-ws-mindmap-edge-hover-active' : ''),
                  d: edge.d,
                  key: index,
                })
              }
              /* A flowing pair edge renders as a solid underlay (palette c1 —
                 the connection stays colored even if the gradient reference
                 can't resolve) plus the animated gradient dashes on top. Both
                 strokes are inline styles, beating every CSS stroke rule (never
                 falling back to gray). Selection/hover trace classes are never
                 added here, so the edge is immune to both — the flowing look is
                 the stronger signal on the pair. */
              return h(Fragment, { key: index },
                h('path', {
                  className: 'dsh-ws-mindmap-edge dsh-ws-mindmap-edge-flow-under',
                  d: edge.d,
                  style: { stroke: flow.palette[0] },
                }),
                h('path', {
                  className: 'dsh-ws-mindmap-edge dsh-ws-mindmap-edge-flow',
                  d: edge.d,
                  style: { stroke: `url(#${flow.gradId})` },
                }))
            })),
          nodeViews,
          /* Amber dashed outline per temporarily-expanded (peeked) run —
             pointer-events: none, so they never block card clicks. */
          (layout.peekBoxes ?? []).map((box, index) => h('div', {
            className: 'dsh-ws-mindmap-peek-box',
            key: index,
            style: { left: box.x, top: box.y, width: box.w, height: box.h },
          }))))),
    menuView,
    h(MindMapDialogs, {
      renameTarget, renameBusy, renameError,
      onRenameCancel: closeRename, onRenameConfirm: confirmRename,
      onRenameDraft: value => { setRenameError(null); setRenameTarget(t => t === null ? t : { ...t, title: value }) },
      archiveTarget, archiveBusy, archiveError, archiveConfirmText,
      onArchiveCancel: closeArchive, onArchiveConfirm: confirmArchive,
      onArchiveConfirmDraft: setArchiveConfirmText,
      deleteTarget, deleteBusy, deleteError, onDeleteCancel: closeDelete, onDeleteConfirm: confirmDelete,
      archiveBranchTarget, archiveBranchBusy, archiveBranchError,
      onArchiveBranchCancel: closeArchiveBranch, onArchiveBranchConfirm: confirmArchiveBranch,
      regenerateAllTarget, regenerateAllBusy, regenerateAllError,
      onRegenerateAllCancel: closeRegenerateAll, onRegenerateAllConfirm: confirmRegenerateAll,
    }),
  )

}
