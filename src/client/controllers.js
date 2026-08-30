import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ENSURE_RETRY_MAX, SEND_SESSION_BRIDGE_MARKER, SEND_SESSION_BRIDGE_ORIGINAL } from './constants.js'
import { translate } from './locale/index.js'
import { formatBytes } from './format.js'
import { renderContext } from './api.js'

const EMPTY_EDITOR_CONTEXT_VIEW = Object.freeze({ present: false, active: false })
/* Field-level equality for the projected editor-context view: the projection
   is rebuilt fresh on every publish, so identity comparison alone cannot gate
   redundant notifications. */
function editorContextViewEqual(left, right) {
  if (left === right) return true
  if (left?.present !== right?.present || left?.active !== right?.active) return false
  if (left?.path !== right?.path) return false
  const ls = left?.selection
  const rs = right?.selection
  if (ls === undefined || rs === undefined) return ls === rs
  return ls.startLine === rs.startLine && ls.startColumn === rs.startColumn
    && ls.endLine === rs.endLine && ls.endColumn === rs.endColumn
}
export class EditorContextController {
  constructor() {
    this.records = new Map()
    this.disabledSessions = new Set()
    this.stores = new Map()
    // Last published context per session id: activation restores a session's
    // own value only, never a foreign session's.
    this.latest = new Map()
  }
  active(sessionId) { return this.records.has(sessionId) && !this.disabledSessions.has(sessionId) }
  storeFor(sessionId) {
    let store = this.stores.get(sessionId)
    if (store !== undefined) return store
    store = createSnapshotStore(this.project(sessionId))
    this.stores.set(sessionId, store)
    return store
  }
  project(sessionId) {
    const record = this.records.get(sessionId)
    if (record === undefined) return EMPTY_EDITOR_CONTEXT_VIEW
    return Object.freeze({
      present: true,
      active: !this.disabledSessions.has(sessionId),
      path: record.path,
      selection: record.selection === undefined ? undefined : Object.freeze({
        startLine: record.selection.startLine,
        startColumn: record.selection.startColumn,
        endLine: record.selection.endLine,
        endColumn: record.selection.endColumn,
      }),
    })
  }
  update(sessionId, value) {
    if (value === undefined) {
      this.latest.delete(sessionId)
      this.records.delete(sessionId)
    } else {
      this.latest.set(sessionId, value)
      this.records.set(sessionId, Object.freeze({
        ...value,
        ...(value.selection === undefined ? {} : { selection: Object.freeze({ ...value.selection }) }),
      }))
    }
    this.publish(sessionId)
  }
  toggle(sessionId) {
    if (this.disabledSessions.has(sessionId)) this.disabledSessions.delete(sessionId)
    else this.disabledSessions.add(sessionId)
    this.publish(sessionId)
  }
  activate(sessionId) {
    // Restore only this session's own last published context; a foreign
    // session's value must never leak into the session being activated.
    const own = this.latest.get(sessionId)
    if (own !== undefined) this.update(sessionId, own)
    this.publish(sessionId)
  }
  /* Field-level gating for the snapshot store: a projection equal to the
     currently published one must not re-notify subscribers (a cursor move
     within the SAME selection would otherwise re-render EditorContextPrefix
     on every editor selection change). */
  publish(sessionId) {
    const store = this.stores.get(sessionId)
    if (store === undefined) return
    const projected = this.project(sessionId)
    if (editorContextViewEqual(store.getSnapshot(), projected)) return
    store.set(projected)
  }
  retain(sessionIds) {
    const live = new Set(sessionIds)
    for (const sessionId of this.records.keys()) if (!live.has(sessionId)) this.records.delete(sessionId)
    for (const sessionId of this.disabledSessions) if (!live.has(sessionId)) this.disabledSessions.delete(sessionId)
    for (const sessionId of this.latest.keys()) if (!live.has(sessionId)) this.latest.delete(sessionId)
    for (const [sessionId, store] of this.stores) {
      if (live.has(sessionId)) continue
      store.set(EMPTY_EDITOR_CONTEXT_VIEW)
      this.stores.delete(sessionId)
    }
  }
  snapshot(sessionId) {
    const record = this.records.get(sessionId)
    if (record === undefined || this.disabledSessions.has(sessionId)) return undefined
    if (record.symlink) throw new Error(translate('context.symlinkError'))
    const common = {
      kind: 'workspace-editor',
      version: 1,
      workspaceId: record.workspaceId,
      path: record.path,
    }
    if (record.selection === undefined) return { ...common, mode: 'path' }
    const bytes = new TextEncoder().encode(record.selection.text).byteLength
    if (Number.isFinite(record.maxContextBytes) && bytes > record.maxContextBytes) {
      throw new Error(translate('context.tooLarge', { size: formatBytes(bytes), limit: formatBytes(record.maxContextBytes) }))
    }
    return {
      ...common,
      mode: 'selection',
      // The decode encoding the editor displayed; the server verifies a clean
      // selection against this same decode.
      encoding: record.encoding,
      dirty: record.dirty,
      ...(record.revision === undefined ? {} : { revision: record.revision }),
      selection: { ...record.selection },
    }
  }
  dispose() {
    this.latest.clear()
    this.records.clear()
    this.disabledSessions.clear()
    for (const store of this.stores.values()) store.set(EMPTY_EDITOR_CONTEXT_VIEW)
    this.stores.clear()
  }
}


/* Pure workspace resolution shared by AppFrame (explorer mount) and
   workspaceOfSession (editor-context / /init): membership first, then the
   session cwd path. The two call sites must never disagree — a mismatch
   would mount the explorer and the editor context on different workspaces
   (U1 audit: AppFrame's single OR-find picked whichever item came first in
   the array, while workspaceOfSession strictly preferred membership). */
export function selectWorkspaceForSession(items, sessionId, cwd) {
  /* A malformed workspace item (missing sessionIds) must degrade like every
     other bad input here — this runs in AppFrame's render path, where a
     TypeError would blank the whole GUI (same guard as selectStoredPreviewSession). */
  const byMembership = items.find(item => Array.isArray(item?.sessionIds) && item.sessionIds.includes(sessionId))
  if (byMembership !== undefined) return byMembership
  if (cwd !== undefined) {
    const byPath = items.find(item => item.path === cwd)
    if (byPath !== undefined) return byPath
  }
  return undefined
}

/* Resolve the workspace a session belongs to — membership first, then the
   session cwd path — the same selection AppFrame uses for the explorer. */
export function workspaceOfSession(ctx, id) {
  const row = ctx.sessions.list.getSnapshot().byId[id]
  if (row === undefined) return undefined
  const items = ctx.get('workspaces')?.list.getSnapshot().items ?? []
  return selectWorkspaceForSession(items, id, row.cwd)
}
export class PromptContextBridge {
  constructor(ctx, editorContexts) {
    this.ctx = ctx
    this.editorContexts = editorContexts
    this.inputPatches = new Map()
    this.contextOnlyInFlight = new Set()
    this.sendTails = new Map()
    this.pendingControllers = new Set()
    this.notifiedErrors = new WeakSet()
    this.conversation = undefined
    this.originalSendSession = undefined
    this.wrappedSendSession = undefined
    this.installToken = 0
    /* Bounded retry timers for ensure() on a not-yet-ready session binding. */
    this.ensureRetries = new Map()
  }
  install() {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) return () => {}
    /* Local captures, not instance fields: a re-install (HMR / service rebuild)
       overlapping the previous cleanup must restore THIS install's original
       sendSession, and the older cleanup must not clobber the newer install's
       state (the shared instance fields would otherwise cross-wire them). */
    let originalSendSession = conversation.sendSession
    if (typeof originalSendSession === 'function' && originalSendSession[SEND_SESSION_BRIDGE_MARKER] === true) {
      /* An overlapping re-install running before the previous install's
         cleanup captured the OLD wrapper as "original": the new wrapper would
         call the old one, which calls back into the SAME bridge instance —
         unbounded recursion on every send. Unwrap to the true original the old
         wrapper recorded (cleanup-only installs never leave a wrapper behind,
         so this is a defense for the overlap window, not the normal path). */
      originalSendSession = originalSendSession[SEND_SESSION_BRIDGE_ORIGINAL] ?? originalSendSession
    }
    if (typeof originalSendSession !== 'function') {
      throw new Error('workspace-studio requires the Harness 0.1.x conversation.sendSession seam')
    }
    const token = this.installToken + 1
    this.installToken = token
    this.conversation = conversation
    this.originalSendSession = originalSendSession
    const bridge = this
    const wrappedSendSession = async function sendSessionWithEditorContext(session, text, imageIds, mode) {
      return bridge.sendSessionWithEditorContext(session, text, imageIds, mode)
    }
    Object.defineProperty(wrappedSendSession, SEND_SESSION_BRIDGE_MARKER, { value: true })
    /* Record the true original on the wrapper itself: an overlapping
       re-install before this install's cleanup can then unwrap instead of
       recursing through the stale wrapper (see the install head). */
    Object.defineProperty(wrappedSendSession, SEND_SESSION_BRIDGE_ORIGINAL, { value: originalSendSession })
    this.wrappedSendSession = wrappedSendSession
    conversation.sendSession = wrappedSendSession
    const reconcile = () => bridge.reconcile()
    const off = this.ctx.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      off()
      /* A newer install superseded this one: leave its state (and its own
         cleanup) alone — restoring here would put the WRONG original back. */
      if (this.installToken !== token) return
      for (const retry of bridge.ensureRetries.values()) clearTimeout(retry.timer)
      bridge.ensureRetries.clear()
      for (const [id, patch] of bridge.inputPatches) bridge.restoreInput(id, patch)
      bridge.inputPatches.clear()
      bridge.contextOnlyInFlight.clear()
      for (const controller of bridge.pendingControllers) controller.abort()
      bridge.pendingControllers.clear()
      bridge.sendTails.clear()
      clearEditorContextDisplays()
      // Cordis returns a fresh trace proxy per service-method read, so
      // identity comparison cannot detect our wrapper.
      const currentSendSession = conversation.sendSession
      if (currentSendSession?.[SEND_SESSION_BRIDGE_MARKER] === true) {
        conversation.sendSession = originalSendSession
      }
      bridge.conversation = undefined
      bridge.originalSendSession = undefined
      bridge.wrappedSendSession = undefined
    }
  }
  async sendSessionWithEditorContext(session, text, imageIds, mode) {
    const sessionId = String(session.sessionId)
    if (!this.directSession(sessionId)) {
      if (text === '' && imageIds.length === 0) return
      if (this.conversation === undefined || this.originalSendSession === undefined) return
      return this.originalSendSession.call(this.conversation, session, text, imageIds, mode)
    }
    let context
    try {
      context = this.editorContexts.snapshot(sessionId)
    } catch (error) {
      this.notify(sessionId, error)
      throw error
    }
    return this.enqueue(sessionId, async (signal) => {
      if (signal.aborted || this.conversation === undefined || this.originalSendSession === undefined) throw new Error(translate('context.canceled'))
      if (context === undefined) {
        if (text === '' && imageIds.length === 0) return
        return this.originalSendSession.call(this.conversation, session, text, imageIds, mode)
      }
      let rendered
      try {
        rendered = await renderContext(session.sessionId, context, signal)
      } catch (error) {
        /* A TIMEOUT is a real failure, not a cancellation: surface it in the
           input dock instead of silently dropping the context send (the
           AbortError name is shared by both, so distinguish by reason). */
        const timedOut = error?.name === 'AbortError' && error?.reason?.name === 'TimeoutError'
        if (timedOut) {
          const wrapped = new Error(translate('editor.requestTimeout'))
          wrapped.name = 'ContextTimeout'
          this.notify(sessionId, wrapped)
        } else if (error?.name !== 'AbortError') {
          this.notify(sessionId, error)
        }
        throw error
      }
      const combined = text === '' ? rendered : `${rendered}\n\n${text}`
      const display = describeEditorContext(context, rendered)
      /* The handle lets a failed send discard EXACTLY this entry: popping the
         queue tail by text key would remove a different concurrent send's
         entry when two identical messages are in flight. */
      const displayHandle = rememberEditorContextDisplay(combined, display)
      try {
        return await this.originalSendSession.call(this.conversation, session, combined, imageIds, mode)
      } catch (error) {
        discardEditorContextDisplay(displayHandle)
        throw error
      }
    })
  }
  /* The /init command (Claude Code style): resolve the session's workspace and
     instruct the model to analyze it and write AGENTS.md at its root. Errors
     surface in the popupSelect shell (its error strip keeps it open). */
  async runInitCommand(id) {
    if (this.conversation === undefined || this.originalSendSession === undefined) {
      throw new Error(translate('init.error.send-failed', { message: translate('init.error.seams-unavailable') }))
    }
    const workspace = workspaceOfSession(this.ctx, id)
    if (workspace === undefined) throw new Error(translate('init.error.no-workspace'))
    const binding = this.ctx.sessions.binding(id)
    const session = binding?.session
    if (session === undefined) {
      throw new Error(translate('init.error.send-failed', { message: translate('init.error.session-unavailable') }))
    }
    const text = translate('init.prompt', { root: workspace.path })
    return this.originalSendSession.call(this.conversation, session, text, [], 'queue')
  }
  enqueue(id, operation) {
    const controller = new AbortController()
    this.pendingControllers.add(controller)
    const previous = this.sendTails.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(() => operation(controller.signal))
    this.sendTails.set(id, pending)
    return pending.finally(() => {
      controller.abort()
      this.pendingControllers.delete(controller)
      if (this.sendTails.get(id) === pending) this.sendTails.delete(id)
    })
  }
  directSession(id) {
    const row = this.ctx.sessions.list.getSnapshot().byId[id]
    return row !== undefined && row.origin !== 'subagent'
  }
  reconcile() {
    const list = this.ctx.sessions.list.getSnapshot()
    for (const id of list.ids) if (this.directSession(String(id))) this.ensure(String(id))
    for (const [id, patch] of this.inputPatches) {
      if (!list.ids.some(candidate => String(candidate) === id) || !this.directSession(id)) this.restoreInput(id, patch)
    }
    /* Drop retry timers for sessions that left the list: a vanished session's
       binding can never become ready, and its timer would otherwise keep
       re-arming (bounded only by the retry cap in ensure()). */
    for (const [id, retry] of this.ensureRetries) {
      if (!list.ids.some(candidate => String(candidate) === id)) {
        clearTimeout(retry.timer)
        this.ensureRetries.delete(id)
      }
    }
  }
  ensure(id) {
    if (this.inputPatches.has(id)) return
    // Missing seams must never escape into the sessions-list subscription
    // dispatch (a throw there could break later subscribers); the session
    // keeps its original input behavior.
    try {
      const binding = this.ctx.sessions.binding(id)
      if (binding === undefined || this.conversation === undefined) {
        /* A brand-new session's binding may not be ready on the first frame
           (the input dock can render before the subscription callback runs):
           retry briefly instead of silently leaving the input unpatched — an
           early send with an empty draft + active context would otherwise
           no-op through the original submit. Bounded: a session whose binding
           never becomes ready (or a missing conversation service) must not
           spin a 50 ms timer forever. The retry ENTRY persists across timer
           firings and counts every scheduled attempt; once ENSURE_RETRY_MAX
           attempts have been scheduled the entry is dropped (a later
           reconcile() re-arms it if the session is still listed and the seams
           have appeared). Earlier code deleted the entry inside the timer and
           re-created it with count 1 on every fire, so the cap never engaged
           and an unavailable binding retried forever. */
        const existing = this.ensureRetries.get(id)
        if (existing !== undefined && existing.count >= ENSURE_RETRY_MAX) {
          clearTimeout(existing.timer)
          this.ensureRetries.delete(id)
          return
        }
        const count = existing === undefined ? 0 : existing.count
        clearTimeout(existing?.timer)
        const timer = setTimeout(() => {
          const current = this.ensureRetries.get(id)
          if (current === undefined) return
          /* Advance the attempt counter on the PERSISTED entry (not a
             deleted-then-recreated one): the cap check in ensure() compares
             against it, so an unavailable binding stops re-arming after
             ENSURE_RETRY_MAX attempts instead of forever. */
          current.count += 1
          this.ensure(id)
        }, 50)
        this.ensureRetries.set(id, { count, timer })
        return
      }
      const input = this.conversation.input.for(binding.ctx)
      const original = input.submit
      const originalSteerQueue = input.steerQueue
      if (typeof original !== 'function' || typeof originalSteerQueue !== 'function') {
        console.error(`workspace-studio: session ${id} input submit/steer seams unavailable; editor context will not attach`)
        return
      }
      const bridge = this
      const wrapper = function submitWithEditorContext(mode = 'queue') {
        const state = input.state.getSnapshot()
        if (bridge.directSession(id) && state.draft.trim() === '' && state.imageIds.length === 0 && bridge.editorContexts.active(id)) {
          void bridge.sendContextOnly(id, mode)
          return
        }
        return original.call(input, mode)
      }
      const steerWrapper = function steerQueueWithEditorContext() {
        const state = input.state.getSnapshot()
        if (bridge.directSession(id) && state.draft.trim() === '' && state.imageIds.length === 0 && bridge.editorContexts.active(id)) {
          void bridge.sendContextOnly(id, 'steer')
          return
        }
        return originalSteerQueue.call(input)
      }
      input.submit = wrapper
      input.steerQueue = steerWrapper
      this.inputPatches.set(id, { input, original, wrapper, originalSteerQueue, steerWrapper })
    } catch (error) {
      console.error(`workspace-studio: failed to patch input seams for session ${id}:`, error)
    }
  }
  restoreInput(id, patch) {
    if (patch.input.submit === patch.wrapper) patch.input.submit = patch.original
    if (patch.input.steerQueue === patch.steerWrapper) patch.input.steerQueue = patch.originalSteerQueue
    this.inputPatches.delete(id)
  }
  async sendContextOnly(id, mode) {
    if (!this.directSession(id) || this.contextOnlyInFlight.has(id)) return
    const binding = this.ctx.sessions.binding(id)
    if (binding === undefined) return
    this.contextOnlyInFlight.add(id)
    try {
      await this.sendSessionWithEditorContext(binding.session, '', [], mode)
    } catch (error) {
      if (error?.name !== 'AbortError') this.notify(id, error)
    } finally {
      this.contextOnlyInFlight.delete(id)
    }
  }
  notify(id, error) {
    if (error !== null && typeof error === 'object') {
      if (this.notifiedErrors.has(error)) return
      this.notifiedErrors.add(error)
    }
    const patch = this.inputPatches.get(id)
    const message = error instanceof Error ? error.message : String(error)
    if (patch === undefined) {
      /* No input patch to surface the error on (the session's binding never
         became ready, or the patch was restored): never swallow silently —
         the console keeps the failure diagnosable. */
      console.warn(`workspace-studio: editor-context error for session ${id}: ${message}`)
      return
    }
    try {
      patch.input.notify('error', message)
    } catch (notifyError) {
      /* The input dock may be mid-teardown (plugin reload, session switch): a
         notify throw must not replace the original error or escape the caller's
         catch as an unhandled rejection — degrade to a console record. */
      console.warn(`workspace-studio: input notify failed for session ${id}: ${String(notifyError)}`)
    }
  }
}