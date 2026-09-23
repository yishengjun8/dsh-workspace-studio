/** Editor session domain: read pass, draft/autosave machinery, save/cancel/
 * conflict resolution, external-change polling and editor-context publishing. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AUTO_RELOAD_COOLDOWN_MS, AUTO_SYNC_CHECK_MS, AUTO_SYNC_MODE_AUTO, AUTOSAVE_DELAY_MS, FILE_CACHE_REVALIDATE_SKIP_MS, WATCH_FILES_DEFAULT } from '../../../constants.js'
import { translate } from '../../../locale/index.js'
import { readOnlyReason } from '../../../format.js'
import { encodingLabel } from '../../../api.js'
import { resolveMergeParts, threeWayMerge } from '../../../merge.js'
import { entryFromPreviewTab, isSyntheticTab } from '../../../preview-tabs.js'
import { isImageName } from '../../../renderers/registry.js'
import { useRemoteFaces } from '../../../renderers/remote.js'
import { readRemoteText } from '../../../renderers/remote-text.js'
import { rewriteRelativePath } from '../../../paths.js'
import { deleteEmergencyDraft, readEmergencyDraft, writeEmergencyDraft } from '../../../drafts.js'
import { diskSnapshot, getCachedPreview, invalidateCachedPath, refreshCachedSnapshot, sameDiskSnapshot, storeCachedPreview } from '../../../file-cache.js'

export function useEditorSession({
  workspace, sessionId, draftScopeId, activePath, activeTab, tabsRef, activePathRef, updateTab, setTabs,
  setSelected, publishEditorContext, loadDraft, readFile, saveFile, persistDraftFile,
  removeDraftFile, draftTree, checkFileChange, settings, mounted, editorRef,
  refreshPendingRef, cancelRestoreRef, requestedEncodingRef, reloadingPathsRef,
  scrollTopRef, reloadToken, setReloadToken,
}) {
  /* Installing the workspace-files Remote faces later must re-run the read pass:
     the read-only preview of an outside-workspace file has no other trigger. */
  const faces = useRemoteFaces()
  const [preview, setPreview] = useState({ state: 'idle' })
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState()
  const [readEpoch, setReadEpoch] = useState(0)
  const [conflictDialog, setConflictDialog] = useState()
  /* Monotonic sequence for file reads: a stale in-flight read can resolve after a newer same-path pass, so each pass applies its result only while still latest. */
  const readSeqRef = useRef(0)
  const readController = useRef()
  const saveController = useRef()
  const baseText = useRef('')
  const diskBaseRef = useRef('')
  /* Latest disk state this editor wrote or read (content + revision), per-path since a pending auto-save can outlive the tab. */
  const lastWriteRef = useRef(new Map())
  const autosaveTimers = useRef(new Map())
  /* Per-path change snapshots (mtime/size/hash) for preview auto-sync; only non-external tabs are tracked. */
  const watchSnapshotsRef = useRef(new Map())
  /* Per-path disk snapshot the shown content was read/saved against; divergence from the watch snapshot means the served content is stale and triggers a fresh read. */
  const contentBaselinesRef = useRef(new Map())
  /* Retained CodeMirror EditorSessions of previously shown tabs, so rebuilding from the same EditorState preserves doc/undo/selection/folds across tab switches. */
  const retainedStatesRef = useRef(new Map())
  /* Per-path reload cooldown for AUTO mode, suppressing the remount storm for continuously-written files. */
  const autoReloadCooldownRef = useRef(new Map())
  /* Draft mutations serialize per path with a monotonic generation; the Host fences every op behind one owner-level generation, so all operations share a single counter. */
  const draftGenerationCounterRef = useRef(0)
  const draftGenerationsRef = useRef(new Map())
  const draftTailsRef = useRef(new Map())
  const pendingAutosavesRef = useRef(new Map())
  const conflictDialogRef = useRef(undefined)
  /* Full-document text is only needed for the dirty comparison, sliced once per immutable doc identity. */
  const sliceTextCacheRef = useRef({ doc: null, text: null })
  const publishContextState = useCallback((state, docChanged = true, precomputedText) => {
    if (activeTab === undefined || preview.state !== 'ready') return
    // External files are read-only and not workspace-confined; never leak their synthetic path into the editor context.
    if (activeTab.external) return
    const main = state.selection.main
    let text = precomputedText
    if (text === undefined) {
      const cached = sliceTextCacheRef.current
      if (cached.doc === state.doc) text = cached.text
      else {
        text = state.sliceDoc()
        sliceTextCacheRef.current = { doc: state.doc, text }
      }
    }
    const selection = main.empty
      ? undefined
      : (() => {
          const start = state.doc.lineAt(main.from)
          const end = state.doc.lineAt(main.to)
          /* CodeMirror counts each line break as one unit, so internal coordinates are already LF-normalized; LF-normalizing the slice deletes exactly the '\r' of each break. */
          const text = state.sliceDoc(main.from, main.to).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          return {
            from: main.from,
            to: main.to,
            startLine: start.number,
            startColumn: main.from - start.from + 1,
            endLine: end.number,
            endColumn: main.to - end.from + 1,
            text,
          }
        })()
    // Dirty = "differs from the committed snapshot"; a clean selection verifies against the source revision, a dirty one sends the selection verbatim.
    publishEditorContext({
      workspaceId: String(workspace.workspaceId),
      path: activeTab.path,
      // Carrying preview.encoding lets the server verify a clean selection against the same decode.
      encoding: preview.encoding,
      dirty: text !== baseText.current || preview.revision === undefined,
      revision: preview.revision ?? undefined,
      selection,
      symlink: Boolean(activeTab.symlink),
      maxContextBytes: preview.maxContextBytes,
    })
  }, [activeTab, preview, publishEditorContext, workspace.workspaceId])

  // A save changes the disk revision without rebuilding the view; republish so the next clean selection carries it.
  useEffect(() => {
    if (preview.state !== 'ready') return
    const view = editorRef.current
    if (view !== undefined) publishContextState(view.state)
  }, [preview, publishContextState])
  /* Preview auto-sync: poll the change-check endpoint on a fixed cadence; clean active tabs re-read (auto) or show "file changed" (watch-only), dirty tabs are never overwritten. */
  const syncControllerRef = useRef()
  const applyFileChanged = useCallback((path) => {
    /* A re-read for this path is already in flight; bumping the reload token again would remount the editor and discard the restored scroll. */
    if (reloadingPathsRef.current.has(path)) return
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    const activePathNow = activePathRef.current
    const activeNow = activePathNow === path
    const editableActive = activeNow && preview.state === 'ready'
      && (preview.kind === 'image' || (preview.editable !== false && !preview.readOnlyReason))
    if (activeNow && !tab.dirty && !tab.saving) {
      const auto = (settings.autoSyncMode ?? AUTO_SYNC_MODE_AUTO) === AUTO_SYNC_MODE_AUTO
      if (auto) {
        /* Backpressure for continuously-written files: changes within the cooldown only surface a status, since a second reload would wipe undo history. */
        const cooldownUntil = autoReloadCooldownRef.current.get(path)
        if (cooldownUntil !== undefined && cooldownUntil > Date.now()) {
          updateTab(path, { status: { text: translate('status.fileChanged') } })
          setStatus({ text: translate('status.fileChanged') })
          return
        }
        // Clean active tab, AUTO mode: reload from disk right away, marking the path as reloading so the polling tick skips it until the read settles.
        autoReloadCooldownRef.current.set(path, Date.now() + AUTO_RELOAD_COOLDOWN_MS)
        reloadingPathsRef.current.add(path)
        // Flag the read pass to surface the reloaded status, then bump the reload token unless a manual refresh already armed it.
        if (refreshPendingRef.current !== path) {
          refreshPendingRef.current = path
          setReloadToken(token => token + 1)
        }
        updateTab(path, { status: { text: translate('editor.refreshed') } })
        setStatus({ text: translate('editor.refreshed') })
      } else {
        // WATCH-ONLY mode: surface the change without reloading; the user pulls new content via the refresh button.
        updateTab(path, { status: { text: translate('status.fileChanged') } })
        setStatus({ text: translate('status.fileChanged') })
      }
    } else if (activeNow && !tab.saving) {
      // Dirty (non-saving) tab: never overwrite the draft or save status; surface the change and let the user decide.
      const dirtyNow = editableActive ? tab.dirty : false
      const text = dirtyNow
        ? translate('status.fileChangedDirty')
        : translate('status.fileChanged')
      setStatus({ error: dirtyNow, text })
      updateTab(path, { status: { error: dirtyNow, text } })
    }
  }, [preview.state, preview.kind, preview.editable, preview.readOnlyReason, setReloadToken, settings.autoSyncMode, translate, updateTab])
  /* Polling: every AUTO_SYNC_CHECK_MS, check each tracked open tab against the
     cheap head endpoint. */
  useEffect(() => {
    if ((settings.watchFiles ?? WATCH_FILES_DEFAULT) !== true) return undefined
    const controller = new AbortController()
    syncControllerRef.current = controller
    let timer = 0
    /* Per-path in-flight guard: a hung Host must not stack overlapping change checks. */
    const inflight = new Set()
    const tick = () => {
      if (controller.signal.aborted || !mounted.current) return
      const open = tabsRef.current.filter(tab => !tab.external && !isSyntheticTab(tab) && tab.path !== '')
      if (open.length === 0) return
      void Promise.all(open.map(async (tab) => {
        if (controller.signal.aborted) return
        // A previous tick's reload is still in flight; skip so we cannot double-bump reloadToken and remount.
        if (reloadingPathsRef.current.has(tab.path)) return
        if (inflight.has(tab.path)) return
        inflight.add(tab.path)
        const snapshot = watchSnapshotsRef.current.get(tab.path)
        try {
          /* Pass the null sentinel through (not `?? undefined`) so a re-created file reports changed. */
          const result = await checkFileChange(String(workspace.workspaceId), tab.path, snapshot, controller.signal)
          if (controller.signal.aborted || result === undefined) return
          /* The tab may have closed while the check was in flight; do not re-seed a baseline for a path with no tab. */
          if (!tabsRef.current.some(item => item.path === tab.path)) return
          /* Only write the result back when the baseline is still the snapshot this check was issued against, or the next tick would report our own save as an external change. */
          const nextSnapshot = result.snapshot ?? null
          if (watchSnapshotsRef.current.get(tab.path) !== snapshot) return
          if (nextSnapshot !== null) {
            watchSnapshotsRef.current.set(tab.path, nextSnapshot)
            if (result.changed === true) {
              /* The disk moved: drop the stale cache entry so no later cold activation serves it. */
              invalidateCachedPath(workspace.workspaceId, tab.path)
              applyFileChanged(tab.path)
            }
          } else {
            /* File disappeared: show the removal notice once, then keep a `null` sentinel so later ticks do not repeat it. */
            invalidateCachedPath(workspace.workspaceId, tab.path)
            if (tab.path === activePathRef.current
              && watchSnapshotsRef.current.get(tab.path) !== null) {
              setStatus({ error: true, text: translate('status.fileRemoved') })
            }
            watchSnapshotsRef.current.set(tab.path, null)
          }
        } catch {
          // Transient network/host error: keep polling on the next tick.
        } finally {
          inflight.delete(tab.path)
        }
      }))
    }
    tick()
    timer = window.setInterval(tick, AUTO_SYNC_CHECK_MS)
    return () => {
      controller.abort()
      if (timer !== 0) window.clearInterval(timer)
      syncControllerRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFileChanged, settings.watchFiles, workspace.workspaceId])
  /* Cleanup on unmount: stop polling and drop per-path change baselines. */
  useEffect(() => {
    return () => {
      syncControllerRef.current?.abort()
      watchSnapshotsRef.current.clear()
      contentBaselinesRef.current.clear()
      retainedStatesRef.current.clear()
      autoReloadCooldownRef.current.clear()
      reloadingPathsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.workspaceId])
  useLayoutEffect(() => {
    // A user-requested refresh flag is consumed at the start of every read pass so a stale flag never decorates a later open; a flag for another path is cleared too.
    const refreshPending = refreshPendingRef.current === activePath
    if (refreshPendingRef.current !== null && refreshPendingRef.current !== activePath) refreshPendingRef.current = null
    if (refreshPending) refreshPendingRef.current = null
    const cancelRestore = activePath !== null && cancelRestoreRef.current === activePath
    if (cancelRestore) cancelRestoreRef.current = null
    if (activePath === null) {
      publishEditorContext(undefined)
      setPreview({ state: 'idle' })
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setDraft('')
      setStatus(undefined)
      baseText.current = ''
      return undefined
    }
    // A mind-map tab carries no file (the map body is owned by the global host) and a plan tab renders a harness plan document: neither has a read, draft, or editor state.
    const syntheticTab = tabsRef.current.find(item => item.path === activePath && isSyntheticTab(item))
    if (syntheticTab !== undefined) {
      readController.current?.abort()
      publishEditorContext(undefined)
      setSelected(undefined)
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setStatus(undefined)
      setDraft('')
      baseText.current = ''
      diskBaseRef.current = ''
      setPreview({ state: 'idle' })
      return undefined
    }
    /* A file OUTSIDE the workspace: the tab is session-only and read-only, and its
       content comes from the harness workspace-files Remote — the plugin's own
       workspace-confined API would refuse the absolute path with a 400. No draft,
       no save, no change poll, no persistence (all keyed off `external`). */
    const outsideTab = tabsRef.current.find(item => item.path === activePath && item.outside === true)
    if (outsideTab !== undefined) {
      readController.current?.abort()
      publishEditorContext(undefined)
      setSelected(undefined)
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setStatus(undefined)
      setDraft('')
      baseText.current = ''
      diskBaseRef.current = ''
      const name = outsideTab.name
      const size = Number.isFinite(outsideTab.size) ? outsideTab.size : null
      if (isImageName(name)) {
        /* Images render from bytes, never through a text read. */
        setPreview({
          state: 'ready',
          kind: 'image',
          path: activePath,
          name,
          symlink: false,
          size,
          editable: false,
          readOnlyReason: 'outside-workspace',
        })
        setReadEpoch(epoch => epoch + 1)
        updateTab(activePath, {
          editing: false,
          dirty: false,
          saving: false,
          status: undefined,
          loaded: true,
          readOnlyReason: 'outside-workspace',
          truncated: false,
        })
        return undefined
      }
      const remoteSessionId = sessionId === undefined || sessionId === null ? null : String(sessionId)
      if (remoteSessionId === null || faces === undefined) {
        /* No Session or no Remote faces: there is nothing this layout can read the
           file with, and claiming so beats an empty editor. */
        setPreview({ state: 'error', message: translate('renderer.unavailable') })
        return undefined
      }
      const controller = new AbortController()
      readController.current = controller
      const readSeq = ++readSeqRef.current
      setPreview({ state: 'loading' })
      readRemoteText(remoteSessionId, activePath, controller.signal).then((result) => {
        if (readSeq !== readSeqRef.current || controller.signal.aborted) return
        if (result === null) {
          setPreview({ state: 'error', message: translate('renderer.unavailable') })
          return
        }
        const content = result.text
        baseText.current = content
        diskBaseRef.current = content
        setDraft(content)
        setPreview({
          state: 'ready',
          content,
          path: activePath,
          name,
          symlink: false,
          truncated: result.truncated,
          /* The Remote decodes as UTF-8 and refuses anything else, so the preview
             is always plain UTF-8 with no BOM and no line-ending rewrite. */
          encoding: 'utf-8',
          lineEnding: 'none',
          bom: false,
          size,
          editable: false,
          readOnlyReason: 'outside-workspace',
          revision: null,
          maxContextBytes: null,
          mtimeMs: 0,
        })
        updateTab(activePath, {
          baseText: content,
          baseRevision: null,
          bom: false,
          dirty: false,
          draft: content,
          draftKnown: true,
          editing: false,
          encoding: 'utf-8',
          lineEnding: 'none',
          loaded: true,
          maxContextBytes: null,
          mtimeMs: 0,
          name,
          readOnlyReason: 'outside-workspace',
          revision: null,
          saving: false,
          size,
          status: undefined,
          truncated: result.truncated,
        })
      }).catch((error) => {
        if (readSeq !== readSeqRef.current || controller.signal.aborted || error?.name === 'AbortError') return
        setPreview({
          state: 'error',
          message: translate('renderer.loadFailed', { message: error instanceof Error ? error.message : String(error) }),
        })
      })
      return undefined
    }
    // External (dropped) files already carry decoded content, so build the read-only preview synchronously without hitting the workspace API.
    const externalTab = tabsRef.current.find(item => item.path === activePath && item.external)
    if (externalTab !== undefined) {
      readController.current?.abort()
      publishEditorContext(undefined)
      const selection = { kind: 'file', name: externalTab.name, path: activePath, symlink: false, external: true }
      setSelected(selection)
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setStatus(undefined)
      const ready = {
        state: 'ready',
        content: externalTab.baseText,
        path: activePath,
        name: externalTab.name,
        symlink: false,
        truncated: false,
        encoding: externalTab.encoding ?? 'utf-8',
        lineEnding: externalTab.lineEnding ?? 'none',
        bom: Boolean(externalTab.bom),
        size: Number.isFinite(externalTab.size) ? externalTab.size : null,
        editable: false,
        readOnlyReason: 'external-file',
      }
      diskBaseRef.current = externalTab.baseText
      baseText.current = externalTab.baseText
      setDraft(externalTab.baseText)
      setPreview(ready)
      return undefined
    }
    /* Image files render through the standalone image view (the Host text preview rejects binary content); no draft, baselines, or editor state. */
    const imageTab = tabsRef.current.find(item => item.path === activePath && isImageName(item.name))
    if (imageTab !== undefined) {
      readController.current?.abort()
      publishEditorContext(undefined)
      const selection = entryFromPreviewTab(imageTab)
      setSelected(selection)
      setEditing(false)
      setDirty(false)
      setSaving(false)
      setStatus(undefined)
      setDraft('')
      baseText.current = ''
      diskBaseRef.current = ''
      setPreview({
        state: 'ready',
        kind: 'image',
        path: activePath,
        name: selection.name,
        symlink: Boolean(selection.symlink),
        size: Number.isFinite(imageTab.size) ? imageTab.size : null,
        editable: false,
      })
      setReadEpoch(epoch => epoch + 1)
      updateTab(activePath, {
        editing: false,
        dirty: false,
        saving: false,
        status: undefined,
        loaded: true,
        readOnlyReason: null,
        truncated: false,
      })
      return undefined
    }
    /* ---- Fast activation path (dev-notes §23) -------------------------
       A clean file whose content is already known paints instantly from memory, then validates in the background against its snapshot; dirty/saving tabs, refreshes, encoding re-opens and cancel-restores take the full pass below. */
    const candidateTab = tabsRef.current.find(item => item.path === activePath)
    const mountLoaded = candidateTab?.loaded === true && typeof candidateTab?.baseText === 'string'
    const contentBaseline = contentBaselinesRef.current.get(activePath)
    const watchBaseline = watchSnapshotsRef.current.get(activePath)
    const diskConfirmedClean = contentBaseline !== undefined
      && watchBaseline !== null && watchBaseline !== undefined
      && sameDiskSnapshot(watchBaseline, contentBaseline)
    const cacheEntry = mountLoaded
      ? undefined
      : getCachedPreview(workspace.workspaceId, activePath, requestedEncodingRef.current ?? candidateTab?.encoding ?? 'utf-8')
    const canFast = !refreshPending && !cancelRestore
      && requestedEncodingRef.current === undefined
      && !reloadingPathsRef.current.has(activePath)
      && candidateTab !== undefined && !isSyntheticTab(candidateTab)
      && !candidateTab.external && !candidateTab.dirty && !candidateTab.saving
      /* draftKnown === false marks the two paths that force a loaded tab clean while a live staging draft may survive (read-failure preserve / clean-revert before its cleanup settles): the fast serve would stamp draft===baseText over that state and hide the draft (no dirty dot, save disabled), so such tabs must take the full pass and re-run draft restoration. */
      && (mountLoaded ? (candidateTab.draftKnown !== false && diskConfirmedClean) : cacheEntry !== undefined)
    if (canFast) {
      readController.current?.abort()
      const readSeq = ++readSeqRef.current
      publishEditorContext(undefined)
      const selection = entryFromPreviewTab(candidateTab)
      setSelected(selection)
      /* Disk-derived payload: live tab fields for a loaded tab, the cache's full read payload for a cold shell. */
      const payload = mountLoaded
        ? {
            bom: Boolean(candidateTab.bom),
            content: candidateTab.baseText,
            editable: (candidateTab.readOnlyReason ?? null) === null,
            encoding: candidateTab.encoding ?? 'utf-8',
            lineEnding: candidateTab.lineEnding ?? 'none',
            maxContextBytes: candidateTab.maxContextBytes ?? null,
            mtimeMs: Number(candidateTab.mtimeMs) || 0,
            readOnlyReason: candidateTab.readOnlyReason ?? null,
            revision: candidateTab.revision ?? null,
            size: candidateTab.size,
            truncated: Boolean(candidateTab.truncated),
          }
        : cacheEntry.payload
      const serveEncoding = String(payload.encoding ?? 'utf-8')
      const serveSnapshot = mountLoaded ? contentBaseline : cacheEntry.snapshot
      const content = typeof payload.content === 'string' ? payload.content : ''
      const savedScrollTop = scrollTopRef.current.get(activePath) ?? candidateTab.scrollTop ?? 0
      reloadingPathsRef.current.add(activePath)
      setEditing(Boolean(candidateTab.editing))
      setDirty(false)
      setSaving(false)
      setStatus(candidateTab.status?.error === true ? undefined : candidateTab.status)
      const ready = {
        state: 'ready',
        content,
        path: activePath,
        name: selection.name,
        symlink: Boolean(selection.symlink),
        truncated: Boolean(payload.truncated),
        encoding: serveEncoding,
        lineEnding: payload.lineEnding ?? 'none',
        bom: Boolean(payload.bom),
        size: Number.isFinite(payload.size) ? payload.size : null,
        editable: payload.editable === true,
        readOnlyReason: payload.readOnlyReason ?? null,
        revision: payload.revision ?? null,
        maxContextBytes: payload.maxContextBytes ?? null,
        mtimeMs: Number(payload.mtimeMs) || 0,
      }
      baseText.current = content
      diskBaseRef.current = content
      lastWriteRef.current.set(activePath, { generation: draftGenerationCounterRef.current, content })
      /* Seeds (not real checks): no checkedAt, see the pass-end seeding. */
      const serveWatch = {
        mtimeMs: Number(serveSnapshot?.mtimeMs) || 0,
        size: Number(serveSnapshot?.size) || 0,
        hash: typeof serveSnapshot?.hash === 'string' ? serveSnapshot.hash : null,
      }
      watchSnapshotsRef.current.set(activePath, serveWatch)
      contentBaselinesRef.current.set(activePath, serveWatch)
      updateTab(activePath, {
        baseText: content,
        baseRevision: payload.revision ?? null,
        bom: Boolean(payload.bom),
        dirty: false,
        draft: content,
        draftKnown: true,
        editing: payload.editable === true,
        encoding: serveEncoding,
        lineEnding: payload.lineEnding ?? 'none',
        loaded: true,
        maxContextBytes: payload.maxContextBytes ?? null,
        mtimeMs: Number(payload.mtimeMs) || 0,
        name: selection.name,
        readOnlyReason: payload.readOnlyReason ?? null,
        revision: payload.revision ?? null,
        saving: false,
        scrollTop: savedScrollTop,
        size: Number.isFinite(payload.size) ? payload.size : null,
        status: candidateTab.status?.error === true ? undefined : candidateTab.status,
        symlink: Boolean(selection.symlink),
        truncated: Boolean(payload.truncated),
      })
      setDraft(content)
      setPreview(ready)
      reloadingPathsRef.current.delete(activePath)
      /* Background validation: one cheap change check against the snapshot
         the served content was read from (skipped only when the poll JUST
         confirmed the same disk state). A detected change upgrades exactly
         like a poll-driven reload. */
      const baseline = serveSnapshot
      const pollJustConfirmed = watchBaseline !== undefined && watchBaseline !== null
        && sameDiskSnapshot(watchBaseline, baseline)
        && Number.isFinite(watchBaseline?.checkedAt)
        && Date.now() - watchBaseline.checkedAt < FILE_CACHE_REVALIDATE_SKIP_MS
      if (pollJustConfirmed) return undefined
      const validateController = new AbortController()
      const runValidation = async () => {
        let result
        try {
          result = await checkFileChange(String(workspace.workspaceId), activePath, baseline, validateController.signal)
        } catch {
          /* Abort or transient failure: keep serving; the poll (when
             enabled) or the next activation re-validates. */
          return
        }
        if (validateController.signal.aborted || !mounted.current) return
        const stillCurrent = readSeq === readSeqRef.current && activePathRef.current === activePath
        const tabNow = tabsRef.current.find(item => item.path === activePath)
        if (!stillCurrent || tabNow === undefined) {
          if (result?.exists === false || result?.changed === true) invalidateCachedPath(workspace.workspaceId, activePath)
          return
        }
        const nextSnapshot = result?.snapshot ?? null
        if (result?.exists === false) {
          /* The file disappeared while we were away: serving cached content
             would show a ghost. Upgrade to the full pass (error preview) or,
             with unsaved edits, mirror the poll's removal banner. */
          watchSnapshotsRef.current.set(activePath, null)
          invalidateCachedPath(workspace.workspaceId, activePath)
          if (tabNow.dirty === true || tabNow.saving === true) {
            const text = translate('status.fileRemoved')
            setStatus({ error: true, text })
            updateTab(activePath, { status: { error: true, text } })
            return
          }
          if (!reloadingPathsRef.current.has(activePath)) {
            reloadingPathsRef.current.add(activePath)
            setReloadToken(token => token + 1)
          }
          return
        }
        if (result?.changed === true) {
          watchSnapshotsRef.current.set(activePath, nextSnapshot)
          invalidateCachedPath(workspace.workspaceId, activePath)
          if (tabNow.dirty === true || tabNow.saving === true) {
            /* Never overwrite unsaved edits with disk content: mirror the
               poll's dirty-change banner and leave the draft untouched. */
            const text = translate('status.fileChangedDirty')
            setStatus({ error: true, text })
            updateTab(activePath, { status: { error: true, text } })
            return
          }
          if (reloadingPathsRef.current.has(activePath)) return
          /* Silent fresh read: the full pass replaces the stale content, rebuilds the doc, and updates every baseline. */
          reloadingPathsRef.current.add(activePath)
          setReloadToken(token => token + 1)
          return
        }
        /* Unchanged: this is a real disk confirmation, so its checkedAt may refresh the baselines when the baseline is still the one this check ran against. */
        if (nextSnapshot !== null && typeof nextSnapshot === 'object') {
          const currentBaseline = contentBaselinesRef.current.get(activePath)
          if (currentBaseline === undefined || sameDiskSnapshot(currentBaseline, baseline)) {
            watchSnapshotsRef.current.set(activePath, nextSnapshot)
            contentBaselinesRef.current.set(activePath, nextSnapshot)
            refreshCachedSnapshot(workspace.workspaceId, activePath, serveEncoding, nextSnapshot)
          }
        }
      }
      void runValidation()
      return () => { validateController.abort() }
    }
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    /* Capture this pass's read sequence; a same-path re-run supersedes it, so stale results are dropped. */
    const readSeq = ++readSeqRef.current
    publishEditorContext(undefined)
    const tab = tabsRef.current.find(item => item.path === activePath)
    const effectiveEncoding = requestedEncodingRef.current ?? tab?.encoding ?? 'utf-8'
    // Consume the pending encoding-open request so an aborted re-read cannot leak a stale encoding into the next read.
    requestedEncodingRef.current = undefined
    const selection = tab === undefined ? { kind: 'file', name: activePath.slice(activePath.lastIndexOf('/') + 1), path: activePath } : entryFromPreviewTab(tab)
    setSelected(selection)
    setEditing(Boolean(tab?.editing))
    setDirty(Boolean(tab?.dirty))
    setSaving(Boolean(tab?.saving))
    /* Error statuses are session-transient; replaying a stale failure banner on tab switch would mislead the user. */
    setStatus(tab?.status?.error === true ? undefined : tab?.status)
    // Mark the path as reloading so the polling tick skips it until the pass settles; idempotent with the marks set by applyFileChanged / refreshFile / openWithEncoding.
    reloadingPathsRef.current.add(activePath)
    // Snapshot the live scroll position before the loading state unmounts the editor, falling back to the tab's persisted value on cold restore.
    const savedScrollTop = scrollTopRef.current.get(activePath) ?? tab?.scrollTop ?? 0
    setPreview({ state: 'loading', path: activePath })
    readFile(workspace.workspaceId, activePath, controller.signal, effectiveEncoding).then((result) => {
      // The tab may have switched since the read started; a same-path re-run supersedes this pass, so a stale result would flash the wrong file.
      if (!mounted.current || readSeq !== readSeqRef.current || activePathRef.current !== activePath) return
      requestedEncodingRef.current = undefined
      // Read the draft file so a refresh restores the editing session from disk; a failed read falls back to the source.
      return Promise.all([
        /* A failed draft read must not silently degrade to "no draft"; mark the failure so the read pass surfaces a warning banner. */
        loadDraft(workspace.workspaceId, activePath, controller.signal, draftScopeId)
          .catch(() => ({ exists: false, failed: true })),
        readEmergencyDraft(workspace.workspaceId, draftScopeId, activePath).catch(() => undefined),
      ]).then(([hostDraft, emergencyDraft]) => {
        if (!mounted.current || readSeq !== readSeqRef.current || activePathRef.current !== activePath) return
        const hostReadFailed = hostDraft?.failed === true
        const hostGeneration = Number.isSafeInteger(hostDraft?.generation) ? hostDraft.generation : 0
        const emergencyGeneration = Number.isSafeInteger(emergencyDraft?.generation) ? emergencyDraft.generation : 0
        const emergencyTombstone = emergencyDraft !== null && emergencyDraft !== undefined
          && emergencyDraft?.state === 'deleted'
        /* A mirror tombstone may suppress the host draft only when the host holds no live draft of its own; a live host draft wins over a possibly stale tombstone. */
        const hostDraftLive = hostDraft !== null && hostDraft !== undefined
          && hostDraft?.exists === true && typeof hostDraft?.draft === 'string'
          && hostDraft.draft !== hostDraft.baseText
        const draftData = emergencyTombstone && !hostDraftLive && emergencyGeneration >= hostGeneration
          ? { exists: false }
          : emergencyDraft?.state !== 'deleted' && typeof emergencyDraft?.draft === 'string'
            && emergencyGeneration >= hostGeneration
            ? emergencyDraft
            : hostDraft
        const tabDraft = tab?.dirty ? tab : undefined
        const editable = result.editable === true
        const diskDraftPresent = draftData !== null && typeof draftData === 'object'
          && draftData.exists !== false && typeof draftData.draft === 'string'
        // A clean fallback draft (draft===baseText) or a stale draft equal to
        // the source carries no unsaved work and must never override a later
        // disk revision.
        const hasDiskDraft = diskDraftPresent
          && draftData.draft !== draftData.baseText
          && draftData.draft !== result.content
        if (diskDraftPresent && !hasDiskDraft) {
          void removeDraftFile(workspace.workspaceId, activePath, undefined, draftScopeId, Math.max(hostGeneration, emergencyGeneration) + 1).catch(() => {})
          if (emergencyDraft?.state !== 'deleted') {
            void deleteEmergencyDraft(workspace.workspaceId, draftScopeId, activePath, Math.max(hostGeneration, emergencyGeneration)).catch(() => {})
          }
        }
        /* A live tab knows whether its in-memory draft is materialized, so a deliberate empty edit stays distinct from a content-free dirty marker restored from localStorage. */
        const hasTabDraft = tabDraft !== undefined && tabDraft.draftKnown === true
          && typeof tabDraft.draft === 'string' && tabDraft.draft !== result.content
        /* In-session the in-memory tab draft is always at least as new as any disk draft, so prefer it; on a cold restore the disk draft rehydrates the session. */
        const restored = hasTabDraft
          ? { content: tabDraft.draft, baseText: tabDraft.baseText, baseRevision: tabDraft.revision }
          : hasDiskDraft
            ? {
                content: draftData.draft,
                baseText: typeof draftData.baseText === 'string' ? draftData.baseText : result.content,
                baseRevision: typeof draftData.baseRevision === 'string' ? draftData.baseRevision : result.revision,
              }
            : { content: result.content, baseText: result.content, baseRevision: result.revision }
        const content = restored.content
        const hasRestoredContent = hasDiskDraft || hasTabDraft
        const canRestore = hasRestoredContent && editable
        const restoredDirty = hasRestoredContent && content !== restored.baseText
        // Compare the SOURCE content to the snapshot: if an external tool
        // changed it, restore still shows the draft and defers to the save-time
        // three-way merge.
        const diskText = typeof result.content === 'string' ? result.content : ''
        const externallyChanged = canRestore && diskText !== restored.baseText
        const ready = {
          state: 'ready',
          ...result,
          name: selection.name,
          path: activePath,
          symlink: Boolean(selection.symlink),
          content,
          revision: result.revision ?? null,
          encoding: result.encoding ?? effectiveEncoding,
          lineEnding: result.lineEnding ?? 'none',
          bom: Boolean(result.bom),
          size: result.size,
        }
        const restoredStatus = canRestore && externallyChanged
          ? { error: true, text: translate('status.draftRestoredConflict') }
          : { text: translate('status.draftRestored') }
        const notRestorableStatus = (hasDiskDraft || hasTabDraft) && !editable
          ? { error: true, text: translate('status.draftNotRestorable') }
          : undefined
        /* A failed Host draft read with no usable emergency mirror must not silently degrade to a clean tab; warn that unsaved work may be hidden. */
        const draftReadFailedStatus = hostReadFailed && !hasDiskDraft && !hasTabDraft
          ? { error: true, text: translate('status.draftReadFailed') }
          : undefined
        // The source content stays separate from the editing baseline so cancel restores the committed snapshot even after a draft restore with a stale base.
        diskBaseRef.current = result.content
        baseText.current = restored.baseText
        // Seed the auto-save dedup with the restored draft (or source when
        // clean) so the next auto-save only fires after an edit.
        const restoredGeneration = Math.max(hostGeneration, emergencyGeneration)
        // Seed the owner generation counter with the highest the Host knows so the next write strictly exceeds it and never collides with the owner fence.
        const ownerGeneration = Number.isSafeInteger(hostDraft?.ownerGeneration) ? hostDraft.ownerGeneration : 0
        draftGenerationCounterRef.current = Math.max(draftGenerationCounterRef.current, restoredGeneration, ownerGeneration)
        draftGenerationsRef.current.set(activePath, Math.max(draftGenerationsRef.current.get(activePath) ?? 0, draftGenerationCounterRef.current))
        lastWriteRef.current.set(activePath, { generation: draftGenerationCounterRef.current, content })
        /* Auto-sync baseline: after any re-read, reset the per-path change snapshot so the poll does not re-report the just-loaded content; seeds carry no checkedAt. */
        watchSnapshotsRef.current.set(activePath, {
          mtimeMs: Number(result.mtimeMs) || 0,
          size: Number(result.size) || 0,
          hash: typeof result.revision === 'string' ? result.revision : null,
        })
        /* Content baseline + global cache: the disk state the payload was read against; content and snapshot always move together, and the cache holds the disk payload only. */
        const payloadEncoding = result.encoding ?? effectiveEncoding
        const freshSnapshot = diskSnapshot(result.mtimeMs, result.size, result.revision)
        contentBaselinesRef.current.set(activePath, {
          mtimeMs: freshSnapshot.mtimeMs,
          size: freshSnapshot.size,
          hash: freshSnapshot.hash,
        })
        storeCachedPreview(workspace.workspaceId, activePath, payloadEncoding, result, freshSnapshot)
        if (payloadEncoding !== effectiveEncoding) {
          storeCachedPreview(workspace.workspaceId, activePath, effectiveEncoding, result, freshSnapshot)
        }
        setDraft(content)
        setPreview(ready)
        setEditing(editable)
        setDirty(restoredDirty)
        if (canRestore) {
          setStatus(restoredStatus)
        } else if (hasDiskDraft || hasTabDraft) {
          setStatus(notRestorableStatus)
        } else if (draftReadFailedStatus !== undefined) {
          setStatus(draftReadFailedStatus)
        }
        if (cancelRestore) setStatus({ text: translate('editor.cancelRestored') })
        else if (refreshPending) setStatus({ text: translate('editor.refreshed') })
        /* Editor-session retention: a same-content re-read rebuilds from the retained EditorState; any real content change, rename, or cancel/discard restore drops it. */
        const retainedNow = retainedStatesRef.current.get(activePath)
        if (retainedNow !== undefined && (cancelRestore
          || retainedNow.state.doc.toString() !== content
          || retainedNow.name !== selection.name)) {
          retainedStatesRef.current.delete(activePath)
        }
        setReadEpoch(epoch => epoch + 1)
        updateTab(activePath, {
          baseText: restored.baseText,
          baseRevision: restored.baseRevision ?? null,
          bom: Boolean(result.bom),
          dirty: restoredDirty,
          draft: content,
          draftKnown: true,
          editing: editable,
          encoding: result.encoding ?? effectiveEncoding,
          lineEnding: result.lineEnding ?? 'none',
          loaded: true,
          maxContextBytes: Number.isFinite(result.maxContextBytes) ? result.maxContextBytes : null,
          mtimeMs: Number(result.mtimeMs) || 0,
          name: selection.name,
          readOnlyReason: result.readOnlyReason ?? null,
          revision: result.revision ?? null,
          saving: false,
          scrollTop: savedScrollTop,
          size: Number.isFinite(result.size) ? result.size : null,
          status: cancelRestore ? { text: translate('editor.cancelRestored') } : (refreshPending ? { text: translate('editor.refreshed') } : (canRestore ? restoredStatus : ((hasDiskDraft || hasTabDraft) ? notRestorableStatus : (draftReadFailedStatus ?? (tab?.status?.error === true ? undefined : tab?.status))))),
          symlink: Boolean(selection.symlink),
          truncated: Boolean(result.truncated),
        })
        /* Release the reloading marker now that the read settled. */
        reloadingPathsRef.current.delete(activePath)
      })
    }, (error) => {
      // A user cancellation leaves the marker to the cleanup below; a TIMEOUT is a real failure that must release the marker and surface the error preview.
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      // Only the current pass may release the marker; a superseded pass's late failure must not delete the marker the newer pass re-armed.
      if (readSeq === readSeqRef.current && activePathRef.current === activePath) {
        reloadingPathsRef.current.delete(activePath)
        const message = error instanceof Error ? error.message : String(error)
        setPreview({ state: 'error', path: activePath, message })
        /* A dirty tab whose read fails would otherwise deadlock (save/cancel/close are all gated); mark it clean without touching the staging draft so the unsaved work survives. */
        if (tab?.dirty === true) {
          const notice = translate('editor.readFailedDraftPreserved', { message })
          updateTab(activePath, { saving: false, dirty: false, draft: '', draftKnown: false, status: { error: true, text: notice } })
          setDirty(false)
          setDraft('')
          setStatus({ error: true, text: notice })
        } else {
          updateTab(activePath, { saving: false, status: { error: true, text: message } })
        }
      }
    })
    return () => {
      controller.abort()
      // This path's read was abandoned (tab switched away or unmount): drop its reloading marker so a later visit can re-arm.
      if (activePathRef.current !== activePath) reloadingPathsRef.current.delete(activePath)
    }
  }, [activePath, checkFileChange, draftScopeId, faces, loadDraft, publishEditorContext, readFile, reloadToken, removeDraftFile, sessionId, updateTab, workspace.workspaceId])
  const nextDraftGeneration = useCallback((path) => {
    draftGenerationCounterRef.current += 1
    const next = draftGenerationCounterRef.current
    draftGenerationsRef.current.set(path, next)
    return next
  }, [])
  const clearAutosaveTimer = useCallback((path) => {
    const timer = autosaveTimers.current.get(path)
    if (timer !== undefined) clearTimeout(timer)
    autosaveTimers.current.delete(path)
    pendingAutosavesRef.current.delete(path)
  }, [])
  const enqueueDraftOperation = useCallback((path, generation, operation) => {
    const previous = draftTailsRef.current.get(path) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => {
      if (draftGenerationsRef.current.get(path) !== generation) return { stale: true }
      return operation()
    })
    draftTailsRef.current.set(path, current)
    const cleanup = () => {
      if (draftTailsRef.current.get(path) === current) draftTailsRef.current.delete(path)
    }
    current.then(cleanup, cleanup)
    return current
  }, [])
  const invalidateDraftPath = useCallback((path) => {
    clearAutosaveTimer(path)
    return nextDraftGeneration(path)
  }, [clearAutosaveTimer, nextDraftGeneration])
  const rollbackDraftTree = useCallback(async (fromPath, toPath) => {
    try {
      const generation = nextDraftGeneration('__tree__')
      await draftTree(workspace.workspaceId, {
        action: 'move',
        owner: draftScopeId,
        generation,
        fromPath: toPath,
        toPath: fromPath,
      }, undefined)
    } catch {
      // Best-effort rollback: the fs operation failed, so the target drafts are the only copy of the user's work.
    }
  }, [draftScopeId, draftTree, nextDraftGeneration, workspace.workspaceId])

  /* Drop the per-path runtime bookkeeping when a tab closes; the tab is guaranteed clean here, and the live scroll ref is deliberately kept so a same-session reopen restores the real scroll position. */
  const forgetPathRefs = useCallback((path) => {
    clearAutosaveTimer(path)
    lastWriteRef.current.delete(path)
    /* KEEP the scrollTopRef entry so a same-session reopen picks up the live scroll from the ref; one number per closed path is negligible. */
    watchSnapshotsRef.current.delete(path)
    contentBaselinesRef.current.delete(path)
    /* The retained editor session dies with the tab; the global content cache entry is deliberately kept so a reopen reads content from memory. */
    retainedStatesRef.current.delete(path)
    reloadingPathsRef.current.delete(path)
    /* Keep the per-path generation entry alive while a draft op is queued; deleting it synchronously would judge the queued DELETE stale and resurrect the stuck tab on reopen. */
    const tail = draftTailsRef.current.get(path)
    if (tail === undefined) draftGenerationsRef.current.delete(path)
    else tail.catch(() => {}).finally(() => { draftGenerationsRef.current.delete(path) })
  }, [clearAutosaveTimer, setTabs])

  /* After committing content to the source, remove the staging draft so a later refresh does not resurrect it; on failure, leave a clean draft so the next restore sees no unsaved state. */
  const clearDraftFile = useCallback((path, content, encoding, lineEnding, bom, revision) => {
    const generation = invalidateDraftPath(path)
    return enqueueDraftOperation(path, generation, async () => {
      /* Tombstone the emergency mirror first so a tab switch between the DELETE and this write cannot restore the stale mirror record. */
      await deleteEmergencyDraft(workspace.workspaceId, draftScopeId, path, generation).catch(() => {})
      let result
      try {
        result = await removeDraftFile(workspace.workspaceId, path, undefined, draftScopeId, generation)
      } catch {
        // Fall through to a clean generation: restore treats draft===disk as
        // clean, so even a failed DELETE cannot resurrect old edits.
      }
      if (result?.deleted !== true) {
        result = await persistDraftFile(workspace.workspaceId, path, {
          owner: draftScopeId,
          encoding,
          lineEnding,
          bom,
          baseText: content,
          baseRevision: revision,
          draft: content,
          generation,
        }, undefined)
      }
      return result
    })
  }, [draftScopeId, enqueueDraftOperation, invalidateDraftPath, persistDraftFile, removeDraftFile, workspace.workspaceId])

  /* Write content to the source file and mark the tab committed (clean); used by save, the clean three-way merge, and conflict resolution. */
  const commitTab = useCallback(async (path, content, revision, encoding, statusText) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return false
    const controller = new AbortController()
    saveController.current = controller
    try {
      const result = await saveFile(workspace.workspaceId, path, content, revision, controller.signal, encoding)
      if (!mounted.current) return false
      /* The PUT just rewrote the file on disk; refresh the change-poll baseline so the next tick does not report our own save as an external modification. */
      watchSnapshotsRef.current.set(path, {
        mtimeMs: Number(result.mtimeMs) || 0,
        size: Number.isFinite(result.size) ? result.size : 0,
        hash: typeof result.revision === 'string' ? result.revision : null,
      })
      /* Keep the content baseline + global cache in lockstep with the write so a re-activation serves the saved text from memory. */
      const savedEncoding = result.encoding ?? encoding
      invalidateCachedPath(workspace.workspaceId, path)
      const savedBytes = Number.isFinite(result.size) ? result.size : new TextEncoder().encode(content).byteLength
      const savedSnapshot = diskSnapshot(result.mtimeMs, savedBytes, result.revision ?? null)
      /* Seed (not a real check): no checkedAt in the live baseline. */
      contentBaselinesRef.current.set(path, {
        mtimeMs: savedSnapshot.mtimeMs,
        size: savedSnapshot.size,
        hash: savedSnapshot.hash,
      })
      storeCachedPreview(workspace.workspaceId, path, savedEncoding, {
        content,
        encoding: savedEncoding,
        lineEnding: tab.lineEnding ?? 'none',
        bom: Boolean(result.bom),
        size: savedBytes,
        revision: result.revision ?? null,
        truncated: false,
        editable: true,
        readOnlyReason: null,
        maxContextBytes: Number.isFinite(tab.maxContextBytes) ? tab.maxContextBytes : null,
        mtimeMs: Number(result.mtimeMs) || 0,
      }, savedSnapshot)
      const savedBom = Boolean(result.bom)
      const size = savedBytes
      const savedStatus = { text: statusText ?? translate('editor.saved') }
      let draftCleanupFailed = false
      try {
        await clearDraftFile(path, content, savedEncoding, tab.lineEnding ?? 'none', savedBom, result.revision ?? revision)
      } catch (error) {
        /* Best-effort: a failed draft cleanup must not fail the save; if both the DELETE and the clean-draft fallback fail, surface the leftover draft honestly. */
        draftCleanupFailed = true
        console.warn('workspace-studio: draft cleanup after save failed:', error)
      }
      if (!mounted.current) return false
      lastWriteRef.current.set(path, { revision: null, content })
      updateTab(path, {
        baseText: content,
        baseRevision: result.revision ?? revision ?? null,
        bom: savedBom,
        dirty: false,
        draft: content,
        draftKnown: true,
        editing: true,
        encoding: savedEncoding,
        lineEnding: tab.lineEnding ?? 'none',
        revision: result.revision ?? revision,
        saving: false,
        size,
        status: draftCleanupFailed ? { error: true, text: translate('editor.saveDraftCleanupFailed') } : savedStatus,
        externalConflict: false,
      })
      if (activePathRef.current === path) {
        baseText.current = content
        diskBaseRef.current = content
        setDraft(content)
        setDirty(false)
        setEditing(true)
        setPreview(current => current.state === 'ready' && current.path === path
          ? { ...current, content, encoding: savedEncoding, bom: savedBom, revision: result.revision ?? current.revision, size }
          : current)
        setStatus(draftCleanupFailed ? { error: true, text: translate('editor.saveDraftCleanupFailed') } : savedStatus)
      }
      return true
    } finally {
      if (saveController.current === controller) saveController.current = undefined
    }
  }, [activePathRef, clearDraftFile, saveFile, updateTab, workspace.workspaceId])

  /* Auto-save an immutable snapshot. No active-editor ref is read after the
     snapshot is created, so switching files cannot cross-wire merge bases. */
  const performAutosave = useCallback(async (path, snapshot, generation) => {
    try {
      const result = await enqueueDraftOperation(path, generation, () => persistDraftFile(workspace.workspaceId, path, {
        ...snapshot,
        generation,
      }, undefined))
      if (result?.stale === true || draftGenerationsRef.current.get(path) !== generation) {
        /* A stale write (a tree op advanced the generation fence) must not leave its pending entry behind. */
        const pending = pendingAutosavesRef.current.get(path)
        if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
        return
      }
      lastWriteRef.current.set(path, { generation, content: snapshot.draft })
      const pending = pendingAutosavesRef.current.get(path)
      if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
    } catch (error) {
      if (!mounted.current) return
      /* User cancellation is silent; a timeout on the draft write is a real autosave failure and must surface. */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      const pending = pendingAutosavesRef.current.get(path)
      if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
      /* A 409 draft-generation-conflict means the owner generation fence advanced past this write; sync the local counter to the Host's current generation so the next autosave converges. */
      if (error?.status === 409) {
        const current = Number(error?.data?.currentGeneration)
        if (Number.isSafeInteger(current)) {
          draftGenerationCounterRef.current = Math.max(draftGenerationCounterRef.current, current)
          draftGenerationsRef.current.set(path, Math.max(draftGenerationsRef.current.get(path) ?? 0, draftGenerationCounterRef.current))
        }
        return
      }
      /* A 400 invalid-draft 'generation 跳变过大' means the local counter drifted ABOVE the Host fence (sustained failed writes while the user kept typing, or a stale IndexedDB mirror re-seeding a high generation after reload). The error carries the Host's current generation: clamp DOWN and re-arm this snapshot with the reconciled generation — otherwise every later draft write for this owner fails forever, even across reloads. */
      if (error?.status === 400 && Number.isSafeInteger(Number(error?.data?.currentGeneration))) {
        const hostGeneration = Number(error.data.currentGeneration)
        if (draftGenerationCounterRef.current > hostGeneration) {
          draftGenerationCounterRef.current = hostGeneration + 1
          const retryGeneration = draftGenerationCounterRef.current
          draftGenerationsRef.current.set(path, retryGeneration)
          void performAutosave(path, snapshot, retryGeneration)
        }
        return
      }
      const timedOut = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
      const message = timedOut ? translate('editor.requestTimeout') : (error instanceof Error ? error.message : String(error))
      if (activePathRef.current === path) setStatus({ error: true, text: translate('editor.autosaveFailed', { message }) })
    }
  }, [enqueueDraftOperation, persistDraftFile, workspace.workspaceId])

  const scheduleAutosave = useCallback((path, text, force = false, skipSavingGate = false) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined || tab.external || (tab.saving && !skipSavingGate) || (!force && tab.editing !== true)) return
    // Drop the pending timer first so an edit reverting to the last-written text cannot let an earlier timer fire.
    clearAutosaveTimer(path)
    // Skip a redundant write when the draft equals the last content this owner persisted.
    if (lastWriteRef.current.get(path)?.content === text) {
      /* The dedup skips the generation bump, but the emergency mirror is written synchronously on every keystroke, so reconcile it with a live record at a fresh generation carrying the current text. */
      const reconcileGeneration = nextDraftGeneration(path)
      void writeEmergencyDraft(workspace.workspaceId, draftScopeId, path, {
        owner: draftScopeId,
        encoding: tab.encoding ?? 'utf-8',
        lineEnding: tab.lineEnding ?? 'none',
        bom: Boolean(tab.bom),
        baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
        baseRevision: tab.baseRevision ?? tab.revision ?? null,
        draft: text,
        generation: reconcileGeneration,
      }).catch(() => {})
      return
    }
    const generation = nextDraftGeneration(path)
    const snapshot = Object.freeze({
      owner: draftScopeId,
      encoding: tab.encoding ?? 'utf-8',
      lineEnding: tab.lineEnding ?? 'none',
      bom: Boolean(tab.bom),
      baseText: typeof tab.baseText === 'string' ? tab.baseText : '',
      baseRevision: tab.baseRevision ?? tab.revision ?? null,
      draft: text,
    })
    pendingAutosavesRef.current.set(path, { generation, snapshot })
    void writeEmergencyDraft(workspace.workspaceId, draftScopeId, path, { ...snapshot, generation }).catch(error => {
      if (!mounted.current || activePathRef.current !== path) return
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ error: true, text: translate('editor.autosaveFailed', { message }) })
    })
    const timer = setTimeout(() => {
      autosaveTimers.current.delete(path)
      void performAutosave(path, snapshot, generation)
    }, AUTOSAVE_DELAY_MS)
    autosaveTimers.current.set(path, timer)
  }, [clearAutosaveTimer, draftScopeId, nextDraftGeneration, performAutosave, workspace.workspaceId])

  const flushAutosaves = useCallback(() => {
    for (const timer of autosaveTimers.current.values()) clearTimeout(timer)
    autosaveTimers.current.clear()
    /* Swap the pending map out up front so a failed write cannot leave an entry pending forever. */
    const pending = pendingAutosavesRef.current
    pendingAutosavesRef.current = new Map()
    for (const [path, entry] of pending) {
      void performAutosave(path, entry.snapshot, entry.generation)
    }
  }, [performAutosave])

  /* When a directory holding a dirty tab is moved or renamed, cancel the old timers and flush each pending auto-save at the new path with a fresh generation. */
  const migratePendingAutosaves = useCallback((from, to) => {
    const pending = pendingAutosavesRef.current
    const timers = autosaveTimers.current
    const affected = []
    for (const [path, entry] of pending) {
      if (path === from || (from !== '' && path.startsWith(`${from}/`))) {
        affected.push({ path, snapshot: entry.snapshot })
      }
    }
    for (const { path } of affected) {
      const timer = timers.get(path)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(path)
      pending.delete(path)
    }
    for (const { path, snapshot } of affected) {
      const nextPath = rewriteRelativePath(path, from, to)
      const generation = nextDraftGeneration(nextPath)
      // Keep the re-keyed entry pending so an unload before the flush still persists it.
      pending.set(nextPath, { generation, snapshot })
      const timer = setTimeout(() => {
        timers.delete(nextPath)
        void performAutosave(nextPath, snapshot, generation)
      }, 0)
      timers.set(nextPath, timer)
    }
  }, [nextDraftGeneration, performAutosave])
  const flushAutosavesRef = useRef(flushAutosaves)
  flushAutosavesRef.current = flushAutosaves
  // migratePendingAutosaves depends on callbacks declared later, so it rides a ref bridge.
  const migratePendingAutosavesRef = useRef(migratePendingAutosaves)
  migratePendingAutosavesRef.current = migratePendingAutosaves
  /* A keystroke can land between the save's text snapshot and the editor freeze; recover it as an unsaved edit so it is never silently dropped. */
  const preservePostSaveKeystrokes = useCallback((path, committedText) => {
    if (activePathRef.current !== path) return
    const view = editorRef.current
    if (view === undefined) return
    const liveText = view.state.sliceDoc()
    if (liveText === committedText) return
    setDraft(liveText)
    setDirty(true)
    /* The save's `saving` flag is still set in tabsRef here, so skip the stale ref's gate explicitly to stage this keystroke. */
    updateTab(path, { draft: liveText, draftKnown: true, dirty: true, saving: false })
    scheduleAutosave(path, liveText, false, true)
  }, [scheduleAutosave, updateTab])

  const save = useCallback(async (encodingOverride) => {
    if (preview.state !== 'ready' || saving || activeTab === undefined) return false
    const forceSaveAs = encodingOverride !== undefined && encodingOverride !== null
    if (!forceSaveAs && !dirty) return false
    if (forceSaveAs && (preview.editable === false || preview.readOnlyReason)) {
      setStatus({ error: true, text: translate('editor.saveAsFailed', { reason: readOnlyReason(preview) }) })
      return false
    }
    const path = activeTab.path
    // Capture the complete save transaction before the first await; switching tabs never changes this file's merge base, revision, or source decode.
    const baseAtSave = typeof activeTab.baseText === 'string' ? activeTab.baseText : baseText.current
    const sourceRevision = activeTab.revision ?? preview.revision
    const sourceEncoding = activeTab.encoding ?? preview.encoding ?? 'utf-8'
    const encoding = forceSaveAs ? String(encodingOverride) : sourceEncoding
    const text = editorRef.current?.state.sliceDoc() ?? draft
    const savingStatus = { text: forceSaveAs ? translate('editor.savingWith', { encoding: encodingLabel(encoding) }) : translate('editor.saving') }
    setSaving(true)
    setStatus(savingStatus)
    updateTab(path, { draft: text, draftKnown: true, dirty: true, saving: true, status: savingStatus })
    const savedStatusText = forceSaveAs ? translate('editor.savedAs', { encoding: encodingLabel(encoding) }) : translate('editor.saved')
    try {
      // Authoritative current disk state: re-read before deciding how to write.
      const disk = await readFile(workspace.workspaceId, path, undefined, sourceEncoding)
      if (!mounted.current) return false
      if (typeof disk?.content !== 'string') throw new Error('invalid read response')
      const diskText = disk.content
      const diskRevision = typeof disk?.revision === 'string' ? disk.revision : undefined
      /* Keep the auto-sync baseline in lockstep with the authoritative read so the poll does not re-report this file as externally changed. */
      watchSnapshotsRef.current.set(path, {
        mtimeMs: Number(disk.mtimeMs) || 0,
        size: Number(disk.size) || 0,
        hash: typeof disk.revision === 'string' ? disk.revision : null,
      })
      if (diskText === text) {
        // The source already equals the draft; commit as-is (idempotent write
        // also clears the staging draft).
        const ok = await commitTab(path, text, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok) preservePostSaveKeystrokes(path, text)
        return ok
      }
      if (diskText === baseAtSave) {
        // The source is untouched since our snapshot: silent write-back.
        const ok = await commitTab(path, text, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok) preservePostSaveKeystrokes(path, text)
        return ok
      }
      // The source changed externally → three-way merge against the snapshot.
      const merged = threeWayMerge(baseAtSave, text, diskText)
      if (merged.status === 'clean') {
        const ok = await commitTab(path, merged.merged, diskRevision ?? sourceRevision, encoding, savedStatusText)
        if (ok && activePathRef.current === path) {
          // Show the merged result only when no keystroke landed while the merge ran; otherwise keep the live doc and mark the tab dirty.
          const view = editorRef.current
          if (view !== undefined) {
            const liveBefore = view.state.sliceDoc()
            if (liveBefore === text) {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: merged.merged } })
            } else {
              setDraft(liveBefore)
              setDirty(true)
              updateTab(path, { draft: liveBefore, draftKnown: true, dirty: true })
              /* The save has completed (commitTab awaited), so skip the stale `saving` gate to stage the typed-during-merge text. */
              scheduleAutosave(path, liveBefore, false, true)
              setStatus({ error: true, text: translate('editor.saveTypedDuringMerge') })
            }
          }
        }
        return ok
      }
      // Overlapping changes → ask the user to pick; keep the tab busy so no auto-save races the pending decision.
      const dialog = { path, mine: text, theirs: diskText, base: baseAtSave, diskRevision, encoding, savedStatusText, savingStatus, conflicts: merged.conflicts, parts: merged.parts }
      conflictDialogRef.current = dialog
      setConflictDialog(dialog)
      return false
    } catch (error) {
      if (!mounted.current) return false
      /* A 409/412 while the disk content already equals our text is an idempotent false conflict; re-read and commit with the fresh revision instead. */
      if (error?.status === 409 || error?.status === 412) {
        try {
          const disk = await readFile(workspace.workspaceId, path, undefined, sourceEncoding)
          if (mounted.current && typeof disk?.content === 'string' && disk.content === text) {
            const freshRevision = typeof disk?.revision === 'string' ? disk.revision : undefined
            const ok = await commitTab(path, text, freshRevision ?? sourceRevision, encoding, savedStatusText)
            if (ok) preservePostSaveKeystrokes(path, text)
            return ok
          }
        } catch {
          /* The re-read itself failed: fall through to the generic failure. */
        }
      }
      /* A genuine user cancellation is silent; a TIMEOUT is a real failure that must surface, or the tab stays dirty forever. */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return false
      const timedOut = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
      const failure = error?.status === 409 || error?.status === 412
        ? translate('editor.saveConflict')
        : translate('editor.saveFailed', { message: timedOut ? translate('editor.requestTimeout') : (error instanceof Error ? error.message : String(error)) })
      updateTab(path, { dirty: true, draft: text, draftKnown: true, editing: true, saving: false, status: { error: true, text: failure } })
      if (activePathRef.current === path) setStatus({ error: true, text: failure })
      return false
    } finally {
      // Keep the tab busy while a conflict prompt is pending so no auto-save races the unresolved decision.
      if (mounted.current && conflictDialogRef.current === undefined) {
        updateTab(path, { saving: false })
        if (activePathRef.current === path) setSaving(false)
      }
    }
  }, [activeTab, baseText, commitTab, dirty, draft, preview, preservePostSaveKeystrokes, readFile, scheduleAutosave, saving, updateTab, workspace.workspaceId])

  /* Resolve the pending save conflict: the dialog walks conflicts one at a time and calls back with { choices } or 'cancel'. */
  const resolveConflict = useCallback(async (result) => {
    const dialog = conflictDialogRef.current
    if (dialog === undefined) return
    conflictDialogRef.current = undefined
    setConflictDialog(undefined)
    const { path, base, mine, diskRevision, encoding, savedStatusText, savingStatus, conflicts, parts } = dialog
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    const finish = () => {
      /* Clear the tab's saving status too, but only when it is still the saving status so a successful commit's saved status survives. */
      const current = tabsRef.current.find(item => item.path === path)
      const patch = { saving: false }
      if (savingStatus !== undefined && current !== undefined && current.status === savingStatus) patch.status = undefined
      updateTab(path, patch)
      if (activePathRef.current === path) setSaving(false)
    }
    if (result === 'cancel') {
      setStatus({ text: translate('editor.saveCancelled') })
      finish()
      return
    }
    const choices = Array.isArray(result?.choices) ? result.choices : []
    let resolved
    try {
      resolved = resolveMergeParts(parts, conflicts, choices)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ error: true, text: translate('editor.saveFailed', { message }) })
      finish()
      return
    }
    let keepBusy = false
    try {
      const ok = await commitTab(path, resolved, diskRevision ?? tab.revision, encoding, savedStatusText)
      if (ok && activePathRef.current === path) {
        // The resolved file can differ from both sides (mixed picks), so show
        // it in the editor explicitly.
        const view = editorRef.current
        if (view !== undefined) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: resolved } })
      }
      if (!ok && mounted.current && activePathRef.current === path) setStatus({ error: true, text: translate('editor.saveConflict') })
    } catch (error) {
      if (!mounted.current) return
      /* User cancellation is silent; a TIMEOUT on the final write is a real
         failure (same rule as save()). */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      /* A 409/412 on the final write means the disk moved again; re-read and re-merge against the user's `mine` so their choices are not thrown away. */
      if (error?.status === 409 || error?.status === 412) {
        try {
          const disk = await readFile(workspace.workspaceId, path, undefined, encoding)
          if (!mounted.current) return
          if (typeof disk?.content !== 'string') throw new Error('invalid read response')
          const newDiskText = disk.content
          const newDiskRevision = typeof disk?.revision === 'string' ? disk.revision : undefined
          if (newDiskRevision !== undefined) {
            watchSnapshotsRef.current.set(path, {
              mtimeMs: Number(disk.mtimeMs) || 0,
              size: Number(disk.size) || 0,
              hash: newDiskRevision,
            })
          }
          const attemptWrite = async (textToWrite, targetRevision) => {
            const written = await commitTab(path, textToWrite, targetRevision, encoding, savedStatusText)
            if (written && activePathRef.current === path) {
              const view = editorRef.current
              if (view !== undefined) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: textToWrite } })
            } else if (!written && mounted.current && activePathRef.current === path) {
              setStatus({ error: true, text: translate('editor.saveConflict') })
            }
          }
          if (newDiskText === resolved) {
            // The disk converged to the resolved content: idempotent commit.
            await attemptWrite(resolved, newDiskRevision ?? diskRevision)
            return
          }
          const remerged = threeWayMerge(base, mine, newDiskText)
          if (remerged.status === 'clean') {
            await attemptWrite(remerged.merged, newDiskRevision ?? diskRevision)
            return
          }
          /* Updated conflict: reopen with the new disk side; the old choices no longer map. */
          const nextDialog = { path, mine, theirs: newDiskText, base, diskRevision: newDiskRevision, encoding, savedStatusText, savingStatus, conflicts: remerged.conflicts, parts: remerged.parts }
          conflictDialogRef.current = nextDialog
          setConflictDialog(nextDialog)
          keepBusy = true
          if (mounted.current && activePathRef.current === path) setStatus({ text: translate('editor.conflictDiskChanged') })
          return
        } catch (readError) {
          if (!mounted.current) return
          if (readError?.name === 'AbortError' && readError?.reason?.name !== 'TimeoutError') return
          // Fall through to the generic failure surface below.
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ error: true, text: translate('editor.saveFailed', { message }) })
    } finally {
      /* A re-opened dialog keeps the tab busy; every other path releases saving here. */
      if (!keepBusy) finish()
    }
  }, [activePathRef, commitTab, readFile, updateTab, workspace.workspaceId])

  const cancel = useCallback(async () => {
    if (preview.state !== 'ready' || saving || activeTab === undefined || !dirty) return
    const path = activeTab.path
    const discardedText = editorRef.current?.state.sliceDoc() ?? draft
    const diskContent = diskBaseRef.current
    const encoding = activeTab.encoding ?? preview.encoding ?? 'utf-8'
    const lineEnding = activeTab.lineEnding ?? preview.lineEnding ?? 'none'
    const bom = Boolean(activeTab.bom ?? preview.bom)
    const revision = activeTab.revision ?? preview.revision ?? null
    // Make the editor read-only while the path queue drains so discarded text cannot be recreated after cancellation.
    setSaving(true)
    updateTab(path, { saving: true })
    try {
      await clearDraftFile(path, diskContent, encoding, lineEnding, bom, revision)
      if (!mounted.current) return
      /* If the live doc diverged while the editor froze, keep the new text as an unsaved edit instead of silently dropping it. */
      const liveTextNow = editorRef.current?.state.sliceDoc()
      if (liveTextNow !== undefined && liveTextNow !== discardedText) {
        updateTab(path, { dirty: true, draft: liveTextNow, draftKnown: true, editing: true, saving: false, status: { text: translate('editor.cancelKeptTyping') } })
        if (activePathRef.current === path) {
          setDraft(liveTextNow)
          setDirty(true)
          setStatus({ text: translate('editor.cancelKeptTyping') })
        }
        /* The ref's `saving` flag is stale, so skip the gate to stage the kept keystrokes before any refresh. */
        scheduleAutosave(path, liveTextNow, false, true)
        return
      }
      lastWriteRef.current.set(path, { generation: draftGenerationsRef.current.get(path) ?? 0, content: diskContent })
      updateTab(path, { dirty: false, draft: '', draftKnown: false, editing: true, saving: false, status: { text: translate('editor.cancelRestored') } })
      if (activePathRef.current === path) {
        setDraft('')
        setDirty(false)
        cancelRestoreRef.current = path
        setReloadToken(token => token + 1)
      }
    } catch (error) {
      if (!mounted.current) return
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      const timedOut = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
      const message = timedOut ? translate('editor.requestTimeout') : (error instanceof Error ? error.message : String(error))
      const failure = { error: true, text: translate('editor.cancelFailed', { message }) }
      updateTab(path, { dirty: true, draft: discardedText, draftKnown: true, editing: true, saving: false, status: failure })
      if (activePathRef.current === path) {
        setDraft(discardedText)
        setDirty(true)
        setStatus(failure)
      }
    } finally {
      if (mounted.current && activePathRef.current === path) setSaving(false)
    }
  }, [activeTab, clearDraftFile, dirty, draft, preview, scheduleAutosave, saving, updateTab])
  /* A non-editable file with a leftover draft has no save/cancel path; discard the staging draft and re-read the source so the tab returns to a clean read-only preview. */
  const discardDraft = useCallback(async () => {
    if (preview.state !== 'ready' || saving || activeTab === undefined || !dirty) return
    const path = activeTab.path
    const encoding = activeTab.encoding ?? preview.encoding ?? 'utf-8'
    const lineEnding = activeTab.lineEnding ?? preview.lineEnding ?? 'none'
    const bom = Boolean(activeTab.bom ?? preview.bom)
    const revision = activeTab.revision ?? preview.revision ?? null
    setSaving(true)
    updateTab(path, { saving: true })
    try {
      await clearDraftFile(path, '', encoding, lineEnding, bom, revision)
      if (!mounted.current) return
      lastWriteRef.current.set(path, { generation: draftGenerationsRef.current.get(path) ?? 0, content: '' })
      // Mark clean before the re-read so the read pass cannot resurrect the discarded draft.
      updateTab(path, { dirty: false, draft: '', draftKnown: false, editing: false, saving: false, status: { text: translate('editor.cancelRestored') } })
      if (activePathRef.current === path) {
        setDraft('')
        setDirty(false)
        cancelRestoreRef.current = path
        setReloadToken(token => token + 1)
      }
    } catch (error) {
      if (!mounted.current) return
      const message = error instanceof Error ? error.message : String(error)
      const failure = { error: true, text: translate('editor.cancelFailed', { message }) }
      updateTab(path, { dirty: true, editing: false, saving: false, status: failure })
      if (activePathRef.current === path) setStatus(failure)
    } finally {
      if (mounted.current && activePathRef.current === path) setSaving(false)
    }
  }, [activeTab, clearDraftFile, dirty, preview, saving, updateTab])
  return {
    preview, editing, dirty, saving, draft, status, readEpoch, conflictDialog, baseText,
    setPreview, setEditing, setDirty, setSaving, setDraft, setStatus,
    publishContextState, save, cancel, discardDraft, resolveConflict,
    clearDraftFile, scheduleAutosave, invalidateDraftPath, nextDraftGeneration,
    clearAutosaveTimer,
    forgetPathRefs, rollbackDraftTree, lastWriteRef, draftTailsRef, draftGenerationsRef,
    watchSnapshotsRef, contentBaselinesRef, retainedStatesRef,
    readController, saveController, flushAutosavesRef, migratePendingAutosavesRef,
  }
}
