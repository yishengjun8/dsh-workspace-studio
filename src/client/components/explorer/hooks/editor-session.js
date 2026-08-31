/** Editor session domain: read pass, draft/autosave machinery, save/cancel/
 * conflict resolution, external-change polling and editor-context publishing.
 * Extracted verbatim from WorkspaceExplorer; behavior is unchanged. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AUTO_RELOAD_COOLDOWN_MS, AUTO_SYNC_CHECK_MS, AUTO_SYNC_MODE_AUTO, AUTOSAVE_DELAY_MS, WATCH_FILES_DEFAULT } from '../../../constants.js'
import { translate } from '../../../locale/index.js'
import { readOnlyReason } from '../../../format.js'
import { encodingLabel } from '../../../api.js'
import { resolveMergeParts, threeWayMerge } from '../../../merge.js'
import { entryFromPreviewTab } from '../../../preview-tabs.js'
import { rewriteRelativePath } from '../../../paths.js'
import { deleteEmergencyDraft, readEmergencyDraft, writeEmergencyDraft } from '../../../drafts.js'

/* CRLF prefix-table size cap: the table costs 4 bytes per character and is
   rebuilt on every doc change, so a very large file would allocate tens of
   MB per keystroke. Above the cap, publishContextState falls back to a
   direct scan of [0, pos) — the same O(pos) the table build cost, without
   the allocation. */
const CRLF_TABLE_MAX_CHARS = 512 * 1024

export function useEditorSession({
  workspace, draftScopeId, activePath, activeTab, tabsRef, activePathRef, updateTab, setTabs,
  setSelected, publishEditorContext, loadDraft, readFile, saveFile, persistDraftFile,
  removeDraftFile, draftTree, checkFileChange, settings, mounted, editorRef,
  refreshPendingRef, cancelRestoreRef, requestedEncodingRef, reloadingPathsRef,
  scrollTopRef, reloadToken, setReloadToken,
}) {
  const [preview, setPreview] = useState({ state: 'idle' })
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState()
  const [readEpoch, setReadEpoch] = useState(0)
  const [conflictDialog, setConflictDialog] = useState()
  /* Monotonic sequence for file READS. The read effect re-runs on every
     reloadToken bump (refresh / encoding re-open / auto-sync), and a stale
     in-flight attempt can resolve AFTER the newer one when the path is the
     SAME (the activePathRef guard only catches path switches). Each pass
     captures a sequence and applies its result only while it is still the
     latest, so a stranded earlier read can never flash stale content, bump the
     read epoch twice, or clobber the watch snapshot baseline. */
  const readSeqRef = useRef(0)
  const readController = useRef()
  const saveController = useRef()
  const baseText = useRef('')
  const diskBaseRef = useRef('')
  /* Latest disk state this editor wrote (or read): content + revision. Auto-
     save uses the revision as If-Match; editor-context uses content to judge
     selection-vs-disk. Per-path, since a pending auto-save can outlive the tab. */
  const lastWriteRef = useRef(new Map())
  const autosaveTimers = useRef(new Map())
  /* Preview auto-sync state: per-path change snapshots (mtime/size/hash);
     only non-external tabs are tracked, all cleaned on unmount. */
  const watchSnapshotsRef = useRef(new Map())
  /* Per-path reload cooldown (until timestamp) for AUTO mode: suppresses the
     remount storm for continuously-written files (see applyFileChanged). */
  const autoReloadCooldownRef = useRef(new Map())
  /* Draft mutations serialize per path with a monotonic generation: the tail
     lets an already-arrived stale PUT finish before a newer PUT/DELETE
     (AbortController cannot retract a request the Host has started). The Host
     fences every op behind ONE owner-level generation (src/host/drafts.js
     ownerCurrentGeneration), so all operations share a single counter —
     separate per-path/'__tree__' counters collided with that fence (409
     draft-generation-conflict) when a second op reused a consumed generation. */
  const draftGenerationCounterRef = useRef(0)
  const draftGenerationsRef = useRef(new Map())
  const draftTailsRef = useRef(new Map())
  const pendingAutosavesRef = useRef(new Map())
  const conflictDialogRef = useRef(undefined)
  /* CRLF prefix-count table, rebuilt only when the doc changed: a per-query
     scan made every keystroke in a large file O(n) twice (from and to). The
     table is keyed to the text snapshot it was built from; selection-only
     publishes reuse it. */
  const crlfPrefixCacheRef = useRef({ text: null, prefix: null })
  /* Full-document text is only needed for the CRLF prefix table and the dirty
     comparison — it is sliced once per DOC identity (CodeMirror documents are
     immutable, so a selection-only update reuses the cached string instead of
     re-copying O(n) text on every selection change). */
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
          // The editor doc keeps raw line endings (CRLF on Windows), but the
          // server verifies selections in LF-normalized space (lib/index.js
          // validateDirtySelection / verifyCleanSelection): normalize the text
          // and map offsets there. Columns are line-local and unaffected; only
          // absolute offsets shift by one per preceding CRLF.
          let crlfPrefix = crlfPrefixCacheRef.current.prefix
          if (docChanged || crlfPrefixCacheRef.current.text !== text) {
            if (text.length <= CRLF_TABLE_MAX_CHARS) {
              crlfPrefix = new Int32Array(text.length + 1)
              /* Count every CRLF pair whose LF lands AT or before pos: a boundary
                 exactly on the LF character (raw position = the \n) must still
                 shift by this pair, or the normalized offset is off by one. */
              for (let i = 0; i < text.length; i += 1) {
                crlfPrefix[i + 1] = crlfPrefix[i] + (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? 1 : 0)
              }
            } else {
              /* Oversized file: no table (see CRLF_TABLE_MAX_CHARS) — the
                 crlfBefore fallback scans [0, pos) directly. */
              crlfPrefix = null
            }
            crlfPrefixCacheRef.current = { text, prefix: crlfPrefix }
          }
          const crlfBefore = (pos) => {
            if (crlfPrefix !== null) return crlfPrefix[pos]
            let count = 0
            for (let i = 0; i < pos; i += 1) {
              if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10) count += 1
            }
            return count
          }
          const from = main.from - crlfBefore(main.from)
          const to = main.to - crlfBefore(main.to)
          return {
            from,
            to,
            startLine: start.number,
            startColumn: main.from - start.from + 1,
            endLine: end.number,
            endColumn: main.to - end.from + 1,
            text: state.sliceDoc(main.from, main.to).replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
          }
        })()
    // Dirty = "differs from the committed snapshot". The source file is never
    // polluted by the draft, so a clean selection verifies against the source
    // revision; a dirty editor sends the selection verbatim instead.
    publishEditorContext({
      workspaceId: String(workspace.workspaceId),
      path: activeTab.path,
      // The editor decodes with preview.encoding; carrying it lets the server
      // verify a clean selection against the same decode (not a hard UTF-8 assumption).
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
  /* Preview auto-sync:
     - while a tab is open, poll the cheap change-check endpoint on a fixed
       cadence (AUTO_SYNC_CHECK_MS) and compare the returned snapshot against
       the stored baseline;
     - a clean active tab re-reads (auto) or shows "file changed" (watch-only);
       dirty active tabs are NEVER overwritten — banner, user decides.
     A Host fs.watch push path was removed: it never worked (no client ref was
     registered and no push listener existed) and only leaked fs.watch handles,
     so polling is the single change-detection mechanism. */
  const syncControllerRef = useRef()
  /* Change handler applied when a change is detected for `path`. */
  const applyFileChanged = useCallback((path) => {
    /* A re-read for this path is already in flight (the tick skips reloading
       paths, but a check issued BEFORE the read pass started can resolve
       after it): bumping the reload token again would remount the editor a
       second time and discard the just-restored scroll. */
    if (reloadingPathsRef.current.has(path)) return
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    const activePathNow = activePathRef.current
    const activeNow = activePathNow === path
    const editableActive = activeNow && preview.state === 'ready' && preview.editable !== false && !preview.readOnlyReason
    if (activeNow && !tab.dirty && !tab.saving) {
      const auto = (settings.autoSyncMode ?? AUTO_SYNC_MODE_AUTO) === AUTO_SYNC_MODE_AUTO
      if (auto) {
        /* Backpressure for continuously-written files: after one reload,
           further changes to the same path inside AUTO_RELOAD_COOLDOWN_MS
           only surface a status — a second reload would remount the editor
           and wipe its undo history, and a busy build/log file would do that
           every tick forever. */
        const cooldownUntil = autoReloadCooldownRef.current.get(path)
        if (cooldownUntil !== undefined && cooldownUntil > Date.now()) {
          updateTab(path, { status: { text: translate('status.fileChanged') } })
          setStatus({ text: translate('status.fileChanged') })
          return
        }
        // Clean active tab, AUTO mode: reload from disk right away. Scroll is
        // preserved — the read path restores the persisted scrollTop.
        // Mark this path as reloading so the polling tick skips it until the
        // read settles — a second bump would remount and discard the scroll.
        autoReloadCooldownRef.current.set(path, Date.now() + AUTO_RELOAD_COOLDOWN_MS)
        reloadingPathsRef.current.add(path)
        // Flag the read pass to surface the reloaded status (same path as the
        // manual refresh button), then bump the reload token — but only if no
        // manual refresh already armed the pass with its own bump.
        if (refreshPendingRef.current !== path) {
          refreshPendingRef.current = path
          setReloadToken(token => token + 1)
        }
        updateTab(path, { status: { text: translate('editor.refreshed') } })
        setStatus({ text: translate('editor.refreshed') })
      } else {
        // WATCH-ONLY mode ("仅提示，不自动刷新"): surface the change WITHOUT
        // reloading — the user decides when to pull the new content (the
        // preview header refresh button re-reads from disk). Nothing is added
        // to reloadingPathsRef, so the next tick keeps polling against the
        // updated baseline without re-reporting.
        updateTab(path, { status: { text: translate('status.fileChanged') } })
        setStatus({ text: translate('status.fileChanged') })
      }
    } else if (activeNow && !tab.saving) {
      // Dirty (non-saving) tab: NEVER overwrite the draft or the in-flight
      // save status; surface the change and let the user decide (save
      // three-way merges / asks, or their own refresh).
      const dirtyNow = editableActive ? tab.dirty : false
      const text = dirtyNow
        ? translate('status.fileChangedDirty')
        : translate('status.fileChanged')
      setStatus({ error: dirtyNow, text })
      updateTab(path, { status: { error: dirtyNow, text } })
    }
  }, [preview.state, preview.editable, preview.readOnlyReason, setReloadToken, settings.autoSyncMode, translate, updateTab])
  /* Polling: every AUTO_SYNC_CHECK_MS, check each tracked open tab against the
     cheap head endpoint. */
  useEffect(() => {
    if ((settings.watchFiles ?? WATCH_FILES_DEFAULT) !== true) return undefined
    const controller = new AbortController()
    syncControllerRef.current = controller
    let timer = 0
    /* Per-path in-flight guard: a hung Host (or a slow poll) must not stack an
       unbounded number of overlapping change checks — each path is polled
       again only after the previous check settled (the check request itself is
       also timeout-bounded in api.js). */
    const inflight = new Set()
    const tick = () => {
      if (controller.signal.aborted || !mounted.current) return
      const open = tabsRef.current.filter(tab => !tab.external && tab.path !== '')
      if (open.length === 0) return
      void Promise.all(open.map(async (tab) => {
        if (controller.signal.aborted) return
        // A previous tick's reload is still in flight: skip so we cannot
        // double-bump reloadToken and remount (wiping the restored scroll).
        if (reloadingPathsRef.current.has(tab.path)) return
        if (inflight.has(tab.path)) return
        inflight.add(tab.path)
        const snapshot = watchSnapshotsRef.current.get(tab.path)
        try {
          /* Pass the null sentinel through (not `?? undefined`): a re-created
             file must report changed (see checkFileChange's { gone: true }). */
          const result = await checkFileChange(String(workspace.workspaceId), tab.path, snapshot, controller.signal)
          if (controller.signal.aborted || result === undefined) return
          /* The tab may have been closed while the check was in flight: do not
             re-seed a baseline for a path that no longer has a tab (a stale
             entry would make the next open of that path report a spurious
             change until the read pass re-seeds it). */
          if (!tabsRef.current.some(item => item.path === tab.path)) return
          /* A save (commitTab) or a read pass may have refreshed this path's
             baseline while the check was in flight: only write the result back
             when the baseline is STILL the snapshot this check was issued
             against (reference equality). Overwriting a fresh post-save
             baseline with the stale pre-save snapshot would make the next tick
             report our own save as an external change — remounting the editor
             and wiping the undo history (or a false "file changed" banner in
             watch-only mode). */
          const nextSnapshot = result.snapshot ?? null
          if (watchSnapshotsRef.current.get(tab.path) !== snapshot) return
          if (nextSnapshot !== null) {
            watchSnapshotsRef.current.set(tab.path, nextSnapshot)
            if (result.changed === true) applyFileChanged(tab.path)
          } else {
            /* File disappeared. Show the removal notice for the active tab
               once, then keep a `null` sentinel so later ticks (while it
               stays gone) do not repeat it; a re-create resets the baseline
               and reports again. */
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
      autoReloadCooldownRef.current.clear()
      reloadingPathsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.workspaceId])
  useLayoutEffect(() => {
    // A user-requested file refresh (preview header action) is tracked through
    // this flag: consumed at the start of every read pass so a stale flag
    // never decorates a later ordinary open with the reloaded status. A flag
    // left for ANOTHER path (the user switched files before the read pass) is
    // cleared here too — otherwise reopening that path later would show a
    // fake "已从磁盘重新读取" toast without any refresh click.
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
    // External (dropped) files already carry decoded content in the tab: no
    // workspace path to re-read and no encoding re-open, so build the read-only
    // preview synchronously and never hit the workspace API.
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
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    /* Capture this pass's read sequence: a same-path re-run (reloadToken bump)
       supersedes it, and any result applying under a stale sequence must be
       dropped even though the path never changed (see readSeqRef). */
    const readSeq = ++readSeqRef.current
    publishEditorContext(undefined)
    const tab = tabsRef.current.find(item => item.path === activePath)
    const effectiveEncoding = requestedEncodingRef.current ?? tab?.encoding ?? 'utf-8'
    // Consume the pending encoding-open request: clearing here keeps an aborted
    // re-read from leaking the stale encoding into the next file read.
    requestedEncodingRef.current = undefined
    const selection = tab === undefined ? { kind: 'file', name: activePath.slice(activePath.lastIndexOf('/') + 1), path: activePath } : entryFromPreviewTab(tab)
    setSelected(selection)
    setEditing(Boolean(tab?.editing))
    setDirty(Boolean(tab?.dirty))
    setSaving(Boolean(tab?.saving))
    /* Error statuses are session-transient (same policy as serializePreviewTab):
       replaying a stale "保存失败" banner when switching back to a tab would
       mislead the user into thinking the failure just happened again. */
    setStatus(tab?.status?.error === true ? undefined : tab?.status)
    // Any re-read (auto-sync, manual refresh, encoding re-open, tab switch)
    // marks the path as reloading so the polling tick skips it until the pass
    // settles — a second bump remounts and discards the restored scroll.
    // Idempotent with the marks set by applyFileChanged / refreshFile /
    // openWithEncoding.
    reloadingPathsRef.current.add(activePath)
    // Snapshot the live scroll position BEFORE the loading state unmounts the
    // editor: the ref holds the last scroll-event value while the view is
    // attached, and this copy rides through the re-read in the tab patch so
    // the remount restores it even if the ref is touched later. Fall back to
    // the tab's persisted value (cold restore).
    const savedScrollTop = scrollTopRef.current.get(activePath) ?? tab?.scrollTop ?? 0
    setPreview({ state: 'loading', path: activePath })
    readFile(workspace.workspaceId, activePath, controller.signal, effectiveEncoding).then((result) => {
      // The tab may have switched since the read started (abort covers most
      // cases; a fetch already resolved is caught here). A same-path re-run
      // supersedes this pass even when the path is unchanged, so applying a
      // stale result would flash the wrong file and bump the read epoch.
      if (!mounted.current || readSeq !== readSeqRef.current || activePathRef.current !== activePath) return
      requestedEncodingRef.current = undefined
      // Read the draft file (staging content + snapshot) so a refresh restores
      // the editing session from disk. A failed read is non-critical: fall
      // back to the source.
      return Promise.all([
        /* A failed draft read must NOT silently degrade to "no draft": the
           restore below would show a clean tab and a later save could
           overwrite the hidden unsaved work. Mark the failure so the read
           pass can surface a warning banner instead. */
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
        /* A mirror TOMBSTONE may suppress the host draft ONLY when the host
           does not hold a live draft of its own: every real discard writes (or
           tries to write) the host side FIRST, so a live host draft means the
           discard never persisted there — trusting an (possibly stale or
           mirror-only) tombstone over it would hide unsaved work after exactly
           the kind of transient host write failure the mirror exists to
           survive. When the host draft is live, the tombstone is ignored and
           the host draft wins. */
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
        // A clean fallback draft (draft===baseText) or a stale draft already
        // equal to the source carries no unsaved work and must never override
        // a later disk revision.
        const hasDiskDraft = diskDraftPresent
          && draftData.draft !== draftData.baseText
          && draftData.draft !== result.content
        if (diskDraftPresent && !hasDiskDraft) {
          void removeDraftFile(workspace.workspaceId, activePath, undefined, draftScopeId, Math.max(hostGeneration, emergencyGeneration) + 1).catch(() => {})
          if (emergencyDraft?.state !== 'deleted') {
            void deleteEmergencyDraft(workspace.workspaceId, draftScopeId, activePath, Math.max(hostGeneration, emergencyGeneration)).catch(() => {})
          }
        }
        /* A live tab knows whether its in-memory draft is materialized, so a
           deliberate empty edit stays distinct from a content-free dirty marker
           restored from localStorage. Cold restores wait for the durable
           Host/IndexedDB draft rather than treating an empty field as a request
           to erase the source. */
        const hasTabDraft = tabDraft !== undefined && tabDraft.draftKnown === true
          && typeof tabDraft.draft === 'string' && tabDraft.draft !== result.content
        /* In-session the in-memory tab draft is ALWAYS at least as new as any
           disk draft (host draft + emergency mirror are only debounced copies
           of it), so prefer it whenever present; a stale disk draft would roll
           the editor back and write older text over the source on the next
           save. On a cold restore (refresh) the tab is clean, so the disk
           draft remains the fallback that rehydrates the editing session. */
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
        /* A failed Host draft read with no usable emergency mirror must not
           silently degrade to a clean tab: the disk content is shown (the only
           available source), but the user is warned that unsaved work may be
           hidden and a direct save could overwrite it. */
        const draftReadFailedStatus = hostReadFailed && !hasDiskDraft && !hasTabDraft
          ? { error: true, text: translate('status.draftReadFailed') }
          : undefined
        // The source content (as last read) stays separate from the editing
        // baseline: cancel restores the committed snapshot even after a draft
        // restore with a stale base.
        diskBaseRef.current = result.content
        baseText.current = restored.baseText
        // Seed the auto-save dedup with the restored draft (or source when
        // clean) so the next auto-save only fires after an edit.
        const restoredGeneration = Math.max(hostGeneration, emergencyGeneration)
        // Seed the owner generation counter with the highest the Host knows
        // (its durable owner generation covers every path and tree op) so the
        // next write strictly exceeds it and never collides with the owner
        // fence after a reload.
        const ownerGeneration = Number.isSafeInteger(hostDraft?.ownerGeneration) ? hostDraft.ownerGeneration : 0
        draftGenerationCounterRef.current = Math.max(draftGenerationCounterRef.current, restoredGeneration, ownerGeneration)
        draftGenerationsRef.current.set(activePath, Math.max(draftGenerationsRef.current.get(activePath) ?? 0, draftGenerationCounterRef.current))
        lastWriteRef.current.set(activePath, { generation: draftGenerationCounterRef.current, content })
        /* Auto-sync baseline: after any re-read, reset the per-path change
           snapshot so the watcher/poll does not re-report the just-loaded
           content as a fresh external change. */
        watchSnapshotsRef.current.set(activePath, {
          mtimeMs: Number(result.mtimeMs) || 0,
          size: Number(result.size) || 0,
          hash: typeof result.revision === 'string' ? result.revision : null,
        })
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
          name: selection.name,
          revision: result.revision ?? null,
          saving: false,
          scrollTop: savedScrollTop,
          size: Number.isFinite(result.size) ? result.size : null,
          status: cancelRestore ? { text: translate('editor.cancelRestored') } : (refreshPending ? { text: translate('editor.refreshed') } : (canRestore ? restoredStatus : ((hasDiskDraft || hasTabDraft) ? notRestorableStatus : (draftReadFailedStatus ?? (tab?.status?.error === true ? undefined : tab?.status))))),
          symlink: Boolean(selection.symlink),
        })
        /* For an auto-triggered re-read, the clean active tab's status was
           already set to "reloaded"; the read pass updates the baseline above.
           Release the reloading marker now that the read settled. */
        reloadingPathsRef.current.delete(activePath)
      })
    }, (error) => {
      // A user cancellation leaves the marker to the cleanup below; a TIMEOUT
      // (AbortSignal.timeout) is a REAL failure that must release the marker
      // and surface the error preview.
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      // Only the CURRENT pass may release the marker: a superseded pass's late
      // failure (e.g. a timeout firing after a same-path re-run started) must
      // not delete the marker the newer pass re-armed — the polling tick would
      // then double-bump reloadToken and remount, discarding the restored
      // scroll. A stale pass's state update is already gated below.
      if (readSeq === readSeqRef.current && activePathRef.current === activePath) {
        reloadingPathsRef.current.delete(activePath)
        const message = error instanceof Error ? error.message : String(error)
        setPreview({ state: 'error', path: activePath, message })
        updateTab(activePath, { saving: false, status: { error: true, text: message } })
      }
    })
    return () => {
      controller.abort()
      // This path's read was abandoned (tab switched away or unmount): drop
      // its reloading marker so a later visit can re-arm. A same-path re-run
      // (reloadToken bump) keeps the marker — the new read is still in flight.
      if (activePathRef.current !== activePath) reloadingPathsRef.current.delete(activePath)
    }
  }, [activePath, draftScopeId, loadDraft, publishEditorContext, readFile, reloadToken, removeDraftFile, updateTab, workspace.workspaceId])
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
      // Best-effort rollback: the fs operation failed, so the drafts at the
      // target are the only copy of the user's work.
    }
  }, [draftScopeId, draftTree, nextDraftGeneration, workspace.workspaceId])

  /* Drop the per-path runtime bookkeeping when a tab closes: no stale
     last-write dedup skipping the first auto-save of a repeat edit, no orphan
     draft generation. The tab is guaranteed clean here (dirty/saving tabs
     cannot be closed), so nothing unsaved is dropped. The live scroll ref is
     deliberately KEPT (see below) so a same-session reopen restores the real
     scroll position. */
  const forgetPathRefs = useCallback((path) => {
    clearAutosaveTimer(path)
    lastWriteRef.current.delete(path)
    /* KEEP the scrollTopRef entry: the read path restores
       `scrollTopRef.get(path) ?? tab?.scrollTop ?? 0`, so a same-session
       reopen after close picks up the LIVE scroll from the ref. (The old code
       tried to merge the live value into the tab here, but closeTab's setTabs
       had already removed the tab — React batches the two updates, so the
       merge was a no-op — and then deleted the ref, so a reopen fell back to
       the stale mount-time scroll.) One number per closed path is a
       negligible cost. */
    watchSnapshotsRef.current.delete(path)
    reloadingPathsRef.current.delete(path)
    /* Keep the per-path generation entry alive while a draft op is queued:
       closeTab's non-editable-dirty escape enqueues a clearDraftFile DELETE
       just before forgetPathRefs runs, and enqueueDraftOperation's staleness
       gate compares against this entry — deleting it synchronously would judge
       that DELETE stale and skip it, so the discarded staging draft would
       survive and resurrect the stuck tab on reopen. Defer until the tail
       settles. */
    const tail = draftTailsRef.current.get(path)
    if (tail === undefined) draftGenerationsRef.current.delete(path)
    else tail.catch(() => {}).finally(() => { draftGenerationsRef.current.delete(path) })
  }, [clearAutosaveTimer, setTabs])

  /* After committing `content` to the source, remove the staging draft so a
     later refresh does not resurrect it. If removal fails (rare), leave a CLEAN
     draft (baseText === draft === content, fresh revision) so the next restore
     sees no unsaved state either way. */
  const clearDraftFile = useCallback((path, content, encoding, lineEnding, bom, revision) => {
    const generation = invalidateDraftPath(path)
    return enqueueDraftOperation(path, generation, async () => {
      /* Tombstone the emergency mirror FIRST: a tab switch (re-read) between
         the Host DELETE and this write would otherwise restore the stale live
         mirror record (its generation is still >= the Host's) and re-materialize
         the discarded draft as a saveable edit. The tombstone's generation
         suppresses the mirror immediately — while the Host DELETE is in flight
         (fence not yet advanced) AND after it lands. */
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

  /* Write `content` to the SOURCE file for `path` and mark the tab committed
     (clean). Used by the explicit save, the clean three-way merge, and conflict
     resolution. Returns true on success; throws on failure. */
  const commitTab = useCallback(async (path, content, revision, encoding, statusText) => {
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return false
    const controller = new AbortController()
    saveController.current = controller
    try {
      const result = await saveFile(workspace.workspaceId, path, content, revision, controller.signal, encoding)
      if (!mounted.current) return false
      /* The PUT just rewrote the file on disk: refresh the change-poll
         baseline so the next tick does not report our own save as an
         external modification (which would remount the editor and wipe
         the undo history). The PUT now carries the written file's real
         mtime (Host side), so the baseline keeps the sameMtime fast path
         working; the hash is the just-written content, so a clean save
         reads back as unchanged while a real external edit still trips
         the poll. */
      watchSnapshotsRef.current.set(path, {
        mtimeMs: Number(result.mtimeMs) || 0,
        size: Number.isFinite(result.size) ? result.size : 0,
        hash: typeof result.revision === 'string' ? result.revision : null,
      })
      const savedEncoding = result.encoding ?? encoding
      const savedBom = Boolean(result.bom)
      const size = Number.isFinite(result.size) ? result.size : new TextEncoder().encode(content).byteLength
      const savedStatus = { text: statusText ?? translate('editor.saved') }
      let draftCleanupFailed = false
      try {
        await clearDraftFile(path, content, savedEncoding, tab.lineEnding ?? 'none', savedBom, result.revision ?? revision)
      } catch (error) {
        /* Best-effort: the source write already succeeded, so a failed draft
           cleanup must not fail the save. A stale draft is reconciled by the
           restore path (draft===disk is clean) or the next auto-save; the
           emergency mirror already holds the newest content for the unload
           case. When BOTH the DELETE and the clean-DRAFT fallback fail, the
           OLD draft survives on the Host and a merge/conflict save (whose
           draft differs from the written content) would come back as a dirty
           tab after refresh — surface that honestly instead of pretending
           the cleanup succeeded. */
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
        /* A stale write (a tree op advanced the generation fence) must not
           leave its pending entry behind: flushAutosaves would otherwise
           re-run the stale check on every unload. */
        const pending = pendingAutosavesRef.current.get(path)
        if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
        return
      }
      lastWriteRef.current.set(path, { generation, content: snapshot.draft })
      const pending = pendingAutosavesRef.current.get(path)
      if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
    } catch (error) {
      if (!mounted.current) return
      /* User cancellation is silent; a timeout on the draft write is a real
         autosave failure and must surface (the next keystroke retries). */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      const pending = pendingAutosavesRef.current.get(path)
      if (pending?.generation === generation) pendingAutosavesRef.current.delete(path)
      /* A 409 draft-generation-conflict means the owner generation fence
         advanced past this write: a tree mutation (rename/move/delete) — which
         already re-queued the draft at the new path — or a CONCURRENT tab's
         write. Sync the local counter to the Host's current generation so the
         next autosave strictly exceeds it and converges instead of pinging
         forever; the pending entry is dropped (the tree-op path re-queued, and
         the emergency mirror still holds this text). */
      if (error?.status === 409) {
        const current = Number(error?.data?.currentGeneration)
        if (Number.isSafeInteger(current)) {
          draftGenerationCounterRef.current = Math.max(draftGenerationCounterRef.current, current)
          draftGenerationsRef.current.set(path, Math.max(draftGenerationsRef.current.get(path) ?? 0, draftGenerationCounterRef.current))
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
    // Drop the pending timer first: an edit reverting to the last-written text
    // must not let an earlier (different-content) timer fire; the dedup return
    // below skips the generation bump, so the stale timer would bypass the
    // enqueueDraftOperation staleness check too.
    clearAutosaveTimer(path)
    // Skip a redundant write when the draft equals the last content this owner
    // persisted (dedup in development-notes §15, never wired): typing back to
    // the last-written text must not rewrite the staging file or the mirror.
    if (lastWriteRef.current.get(path)?.content === text) {
      /* The dedup skips the generation bump, but the emergency IndexedDB mirror
         is written SYNCHRONOUSLY on every keystroke with a fresh generation
         (below), while lastWriteRef only advances after the debounced Host
         write. An intermediate edit (mirror @gen2) reverted within the debounce
         window therefore leaves the mirror holding a NEWER content than the
         Host draft (@gen1) — restore's `emergencyGeneration >= hostGeneration`
         would resurrect the reverted-away text on refresh. Reconcile the mirror
         with a LIVE record at a fresh generation carrying the CURRENT text:
         restore then picks the mirror (newest generation) and shows exactly
         what the user sees. A tombstone would be wrong here — it suppresses
         the Host draft too (restore treats a newer tombstone as "no draft at
         all"), silently losing the unsaved edit on refresh. */
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
    /* Swap the pending map out up front: performAutosave only deletes the
       entry it matches, so a failed write would otherwise leave the entry
       pending forever (retried on every later flush). */
    const pending = pendingAutosavesRef.current
    pendingAutosavesRef.current = new Map()
    for (const [path, entry] of pending) {
      void performAutosave(path, entry.snapshot, entry.generation)
    }
  }, [performAutosave])

  /* When a directory holding a dirty tab is moved or renamed, the tab's
     pending (debounced) auto-save must follow the path. Re-keying the pending
     map alone is not enough: the old timer still captures the old path, and
     the tree op bumped the generation fence, so the old generation would be
     rejected. Cancel the old timers, drop the stale entries, and flush each
     snapshot at the new path with a fresh generation. Otherwise the newest
     edits survive only in the IndexedDB mirror, which restore discards because
     its generation is older than the moved Host draft's. */
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
      // Keep the re-keyed entry pending so an unload before the flush still
      // persists it (flushAutosaves covers the map); the timer fires next tick.
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
  // migratePendingAutosaves depends on callbacks declared later than the
  // create/rename handlers that call it, so it rides a ref bridge (body
  // references are lazy and TDZ-safe; ref identity is stable).
  const migratePendingAutosavesRef = useRef(migratePendingAutosaves)
  migratePendingAutosavesRef.current = migratePendingAutosaves
  /* A keystroke can land between the save's text snapshot and the editor
     freeze (the editable compartment reconfigures in a passive effect after
     the saving flag commits); it stays visible yet is marked clean — recover
     it as an unsaved edit so it is never silently dropped. Only relevant while
     this tab is active (a tab switch swaps editorRef). Declared BEFORE save:
     save's dependency array references it (TDZ rule). */
  const preservePostSaveKeystrokes = useCallback((path, committedText) => {
    if (activePathRef.current !== path) return
    const view = editorRef.current
    if (view === undefined) return
    const liveText = view.state.sliceDoc()
    if (liveText === committedText) return
    setDraft(liveText)
    setDirty(true)
    /* The save's `saving` flag is still set in tabsRef here (React has not
       re-rendered the commit; the ref only syncs in a layout effect AFTER the
       render): scheduleAutosave's saving gate would skip this keystroke's
       staging write, leaving the Host draft and IndexedDB mirror one keystroke
       behind until the next edit — and a refresh in that window silently drops
       the key. The patch below clears the flag in state; skip the STALE ref's
       gate explicitly (the save's own finally() would clear it right after). */
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
    // Capture the complete save transaction before the first await: switching
    // tabs may change the active refs, but never this file's merge base,
    // revision, or source decode.
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
      /* Keep the auto-sync baseline in lockstep with the authoritative read
         the save just performed, so the watcher/poll does not re-report this
         file as externally changed. */
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
          // Show the merged result (it differs from both sides) — but only when
          // no keystroke landed while the merge ran: dispatching it would wipe
          // text typed against the pre-merge doc, the window
          // preservePostSaveKeystrokes covers on the write-back branches. When
          // the live doc diverged, keep it (nothing dropped) and mark the tab
          // dirty; commitTab already wrote merged.merged, so the next save
          // re-merges against that newer source.
          const view = editorRef.current
          if (view !== undefined) {
            const liveBefore = view.state.sliceDoc()
            if (liveBefore === text) {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: merged.merged } })
            } else {
              setDraft(liveBefore)
              setDirty(true)
              updateTab(path, { draft: liveBefore, draftKnown: true, dirty: true })
              /* The tab's `saving` flag is still true in the ref (the save's
                 finally clears it in a later task): the save itself has
                 COMPLETED at this point (commitTab awaited), so skip the stale
                 gate — the typed-during-merge text must reach the staging file. */
              scheduleAutosave(path, liveBefore, false, true)
              setStatus({ error: true, text: translate('editor.saveTypedDuringMerge') })
            }
          }
        }
        return ok
      }
      // Overlapping changes → ask the user to pick; keep the tab busy so no
      // auto-save races the pending decision. Conflicts stay structural —
      // never literal markers in the content — so the file text cannot collide
      // with an implementation marker.
      const dialog = { path, mine: text, theirs: diskText, base: baseAtSave, diskRevision, encoding, savedStatusText, savingStatus, conflicts: merged.conflicts, parts: merged.parts }
      conflictDialogRef.current = dialog
      setConflictDialog(dialog)
      return false
    } catch (error) {
      if (!mounted.current) return false
      /* A 409/412 on the write while the DISK content already equals our text
         is an idempotent false conflict (a third party wrote the same bytes
         between our read and write): re-read and commit with the fresh
         revision instead of surfacing a misleading "保存冲突". Any real
         divergence falls through to the generic failure surface below. */
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
          /* The re-read itself failed: fall through to the generic failure.
             (The timeout branch below stays authoritative for hung hosts.) */
        }
      }
      /* A genuine user cancellation is silent; a TIMEOUT (AbortSignal.timeout's
         TimeoutError reason) is a real failure that must surface — otherwise
         the tab stays dirty with the "保存中…" banner forever. */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return false
      const timedOut = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
      const failure = error?.status === 409 || error?.status === 412
        ? translate('editor.saveConflict')
        : translate('editor.saveFailed', { message: timedOut ? translate('editor.requestTimeout') : (error instanceof Error ? error.message : String(error)) })
      updateTab(path, { dirty: true, draft: text, draftKnown: true, editing: true, saving: false, status: { error: true, text: failure } })
      if (activePathRef.current === path) setStatus({ error: true, text: failure })
      return false
    } finally {
      // Keep the tab busy while a conflict prompt is pending so no auto-save
      // races the unresolved decision; resolveConflict releases it.
      if (mounted.current && conflictDialogRef.current === undefined) {
        updateTab(path, { saving: false })
        if (activePathRef.current === path) setSaving(false)
      }
    }
  }, [activeTab, baseText, commitTab, dirty, draft, preview, preservePostSaveKeystrokes, readFile, scheduleAutosave, saving, updateTab, workspace.workspaceId])

  /* Resolve the pending save conflict. The dialog walks conflicts one at a time
     and calls back with { choices } ('mine'/'theirs' per conflict, in order) or
     'cancel'. The resolved file is the merge skeleton — every non-conflicting
     change already applied — with each conflict marker line replaced by the
     chosen side's lines. */
  const resolveConflict = useCallback(async (result) => {
    const dialog = conflictDialogRef.current
    if (dialog === undefined) return
    conflictDialogRef.current = undefined
    setConflictDialog(undefined)
    const { path, base, mine, diskRevision, encoding, savedStatusText, savingStatus, conflicts, parts } = dialog
    const tab = tabsRef.current.find(item => item.path === path)
    if (tab === undefined) return
    const finish = () => {
      /* Clear the tab's "正在保存…" status too: it was written by save() and
         would otherwise persist (serializePreviewTab keeps informational
         statuses) and show as a stale banner after a tab switch or refresh.
         Only clear when it is STILL the saving status — a successful commitTab
         replaces it with the saved status, which must survive. Read the CURRENT
         tab (the closure `tab` predates commitTab's updateTab). */
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
      /* A 409/412 on the final write means the disk moved AGAIN while the
         conflict dialog was open. Re-read and re-merge against the user's
         `mine` so their already-made choices are not thrown away: a clean
         re-merge commits directly, a new conflict reopens the dialog with the
         updated disk side (the tab stays busy until that dialog resolves). */
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
          /* Updated conflict: reopen with the new disk side; the user re-picks
             (the conflict regions changed, so the old choices no longer map). */
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
      /* A re-opened dialog keeps the tab busy (its own finish() releases it);
         every other path releases saving here. */
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
    // Make the editor read-only while the path queue drains: the queued DELETE
    // is ordered after any PUT already executing, so discarded text cannot be
    // recreated after cancellation.
    setSaving(true)
    updateTab(path, { saving: true })
    try {
      await clearDraftFile(path, diskContent, encoding, lineEnding, bom, revision)
      if (!mounted.current) return
      /* Keystrokes can land between capturing discardedText and the editor
         actually freezing (the same window the save path guards with
         preservePostSaveKeystrokes): if the live doc diverged, keep the NEW
         text as an unsaved edit instead of silently dropping it — the draft
         was just cleared, so re-stage it before marking anything clean. */
      const liveTextNow = editorRef.current?.state.sliceDoc()
      if (liveTextNow !== undefined && liveTextNow !== discardedText) {
        updateTab(path, { dirty: true, draft: liveTextNow, draftKnown: true, editing: true, saving: false, status: { text: translate('editor.cancelKeptTyping') } })
        if (activePathRef.current === path) {
          setDraft(liveTextNow)
          setDirty(true)
          setStatus({ text: translate('editor.cancelKeptTyping') })
        }
        /* The ref's `saving` flag is stale (cleared by the patch in the same
           task; the ref syncs only after the next commit): skip the gate so
           the kept keystrokes are staged before any refresh. */
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
  /* A non-editable file (read-only, oversized, editing disabled) with a
     leftover draft has no save/cancel path (both gated on editability), so the
     tab would be stuck dirty with no way to close, save, or refresh. This is
     the escape: discard the staging draft and re-read the source so the tab
     returns to a clean read-only preview; the file is never touched. */
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
      // Mark clean BEFORE the re-read so the read pass cannot resurrect the
      // discarded draft (same ordering rule as cancel).
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
    forgetPathRefs, rollbackDraftTree, lastWriteRef, draftTailsRef, draftGenerationsRef,
    watchSnapshotsRef,
    readController, saveController, flushAutosavesRef, migratePendingAutosavesRef,
  }
}
