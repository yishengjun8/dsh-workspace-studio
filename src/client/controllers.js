import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ENSURE_RETRY_MAX, SEND_SESSION_BRIDGE_MARKER, SEND_SESSION_BRIDGE_ORIGINAL } from './constants.js'
import { translate } from './locale/index.js'
import { formatBytes } from './format.js'
import { renderContext } from './api.js'
import { wrapPromptClaim, wrapPromptClaimOutcome } from './command-context.js'
import { clearEditorContextDisplays, describeEditorContext, rememberEditorContextDisplay } from './context-bridge.js'
import { cleanedSessionTitle, installTitleGuard } from './title-guard.js'

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
    // own value only, never a foreign one.
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
    // value must never leak in.
    const own = this.latest.get(sessionId)
    if (own !== undefined) this.update(sessionId, own)
    this.publish(sessionId)
  }
  /* Field-level gating for the snapshot store: a projection equal to the
     published one must not re-notify subscribers. */
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
      // selection against it.
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


/* Pure workspace resolution shared by AppFrame and workspaceOfSession:
   membership first, then the session cwd path. The two call sites must never
   disagree, or the explorer and editor context would mount on different
   workspaces. */
export function selectWorkspaceForSession(items, sessionId, cwd) {
  /* A malformed workspace item must degrade like every other bad input here —
     this runs in AppFrame's render path, where a TypeError would blank the
     whole GUI. */
  const byMembership = items.find(item => Array.isArray(item?.sessionIds) && item.sessionIds.includes(sessionId))
  if (byMembership !== undefined) return byMembership
  if (cwd !== undefined) {
    const byPath = items.find(item => item.path === cwd)
    if (byPath !== undefined) return byPath
  }
  return undefined
}

/* Resolve the workspace a session belongs to — membership first, then the
   session cwd path — the same selection AppFrame uses. */
export function workspaceOfSession(ctx, id) {
  const row = ctx.sessions.list.getSnapshot().byId[id]
  if (row === undefined) return undefined
  const items = ctx.get('workspaces')?.list.getSnapshot().items ?? []
  return selectWorkspaceForSession(items, id, row.cwd)
}

/* The current session, derived the way DSH 0.1.7 itself derives it.
   `SessionListState.current` was removed with the navigation move: the main
   view's session is now the one retained by the `mainView` source
   (ui-workspace selects it through ctx.sessions.retain), which is exactly what
   ui-workspace's own browser reads off the list. Mirroring that read keeps the
   plugin and the harness from disagreeing about "the current session" — the
   field's absence silently emptied the whole explorer/preview chain. */
export function currentSessionOf(sessionsById) {
  if (sessionsById === null || sessionsById === undefined) return undefined
  for (const id of Object.keys(sessionsById)) {
    const row = sessionsById[id]
    if (row !== null && row !== undefined && (row.retainedBy?.mainView ?? 0) > 0) {
      return String(row.id ?? id)
    }
  }
  return undefined
}

/* Recent-workspace fallback used while no session is selected: the harness's
   own policy (newest session `updatedAt` per workspace, the workspace
   `createdAt` when it holds none, Host order on ties — ui-workspace
   navigation.recentWorkspace). The harness keeps that policy to itself and its
   view store never carried a `recentWorkspaceId` field, so the plugin derives
   the same answer from the two snapshots it already subscribes to. */
export function recentWorkspaceIdOf(items, sessionsById) {
  let selected
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of items ?? []) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace?.sessionIds ?? []) {
      const updatedAt = sessionsById?.[sessionId]?.updatedAt
      if (typeof updatedAt === 'number' && updatedAt > latest) latest = updatedAt
    }
    if (latest === Number.NEGATIVE_INFINITY) {
      /* A missing/malformed createdAt keeps the first workspace, like NaN would. */
      const created = Date.parse(workspace?.createdAt ?? '')
      latest = Number.isNaN(created) ? Number.NEGATIVE_INFINITY : created
    }
    if (selected === undefined || latest > selectedTime) {
      selected = workspace?.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/* Show a session in the main view. DSH 0.1.7 removed `ctx.sessions.open` and
   gave navigation to the view owner (ui-workspace's `uiWorkspace` service), so
   the new path is tried first and the pre-0.1.7 service second; a build with
   neither throws instead of leaving a silently dead click. `reflect.get` reads
   a service without an inject declaration — `uiWorkspace` must stay optional,
   since older harness builds do not provide it at all. */
export function openHarnessSession(ctx, sessionId) {
  const id = String(sessionId)
  const uiWorkspace = ctx.reflect?.get?.('uiWorkspace', false)
  if (uiWorkspace !== null && uiWorkspace !== undefined
    && typeof uiWorkspace.openSession === 'function') {
    uiWorkspace.openSession(id)
    return
  }
  const sessions = ctx.get('sessions')
  if (sessions !== null && sessions !== undefined && typeof sessions.open === 'function') {
    sessions.open(id)
    return
  }
  throw new Error(translate('error.noSessionOpenApi'))
}

/* Attachment ids live under a harness-owned field name (0.1.7 renamed
   InputState.imageIds to attachmentIds). An unrecognized shape answers null so
   the empty-draft gate hands the gesture back to the harness seam instead of
   guessing — never let a drifted snapshot shape throw inside a submit. */
function attachmentIdsOf(state) {
  const ids = state?.attachmentIds ?? state?.imageIds
  return Array.isArray(ids) ? ids : null
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
    /* Session-title guard state: per-session cleaned replacement title for the
       sends that carried an editor-context envelope, plus the guard's own
       sessions-list unsubscriber. */
    this.cleanedTitles = new Map()
    this.titleGuardOff = undefined
    /* Bounded retry timers for ensure() on a not-yet-ready session binding. */
    this.ensureRetries = new Map()
  }
  install() {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) return () => {}
    /* Local captures, not instance fields: an overlapping re-install must
       restore this install's original sendSession, and the older cleanup must
       not clobber the newer install's state. */
    let originalSendSession = conversation.sendSession
    if (typeof originalSendSession === 'function' && originalSendSession[SEND_SESSION_BRIDGE_MARKER] === true) {
      /* An overlapping re-install may have captured the old wrapper as
         "original", causing unbounded recursion; unwrap to the true original
         the old wrapper recorded. */
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
    /* Record the true original on the wrapper itself so an overlapping
       re-install can unwrap instead of recursing. */
    Object.defineProperty(wrappedSendSession, SEND_SESSION_BRIDGE_ORIGINAL, { value: originalSendSession })
    this.wrappedSendSession = wrappedSendSession
    conversation.sendSession = wrappedSendSession
    /* An overlapping re-install may still own the previous guard: dispose it
       before mounting the new one, since the old cleanup's install-token check
       will make it leave this newer guard alone. */
    if (this.titleGuardOff !== undefined) this.titleGuardOff()
    this.cleanedTitles.clear()
    this.titleGuardOff = installTitleGuard(this.ctx, this.cleanedTitles)
    const reconcile = () => bridge.reconcile()
    const off = this.ctx.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      off()
      /* A newer install superseded this one: leave its state alone, since
         restoring here would put the wrong original back. */
      if (this.installToken !== token) return
      for (const retry of bridge.ensureRetries.values()) clearTimeout(retry.timer)
      bridge.ensureRetries.clear()
      for (const [id, patch] of bridge.inputPatches) bridge.restoreInput(id, patch)
      bridge.inputPatches.clear()
      bridge.contextOnlyInFlight.clear()
      for (const controller of bridge.pendingControllers) controller.abort()
      bridge.pendingControllers.clear()
      bridge.sendTails.clear()
      if (bridge.titleGuardOff !== undefined) {
        bridge.titleGuardOff()
        bridge.titleGuardOff = undefined
      }
      bridge.cleanedTitles.clear()
      clearEditorContextDisplays()
      // Cordis returns a fresh trace proxy per service-method read, so
      // identity cannot detect our wrapper.
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
      const rendered = await this.renderEnvelope(sessionId, context, signal)
      const combined = text === '' ? rendered : `${rendered}\n\n${text}`
      const display = describeEditorContext(context, rendered)
      /* The handle lets a failed send discard exactly this entry, since
         popping by text key could remove a different concurrent send's entry. */
      const displayHandle = rememberEditorContextDisplay(combined, display)
      /* Record the cleaned replacement title before dispatch: the harness
         derives a fresh session's fallback title from the first human message
         verbatim, so the envelope prefix would leak into it; the guard renames
         with this string when such a polluted title lands. A failed send
         leaves a stale harmless entry (no polluted title can exist without a
         landed envelope message), overwritten by the next send. */
      this.cleanedTitles.set(sessionId, cleanedSessionTitle({
        remainder: text,
        fileName: display.fileName,
        range: display.range,
      }))
      try {
        return await this.originalSendSession.call(this.conversation, session, combined, imageIds, mode)
      } catch (error) {
        discardEditorContextDisplay(displayHandle)
        throw error
      }
    })
  }
  /* Render one editor-context envelope. A TIMEOUT is a real failure, not a
     cancellation: surface it in the input dock instead of silently dropping the
     context attachment. */
  async renderEnvelope(sessionId, context, signal) {
    try {
      return await renderContext(sessionId, context, signal)
    } catch (error) {
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
  }
  /* The /init command (Claude Code style): resolve the session's workspace and
     instruct the model to analyze it and write AGENTS.md at its root. */
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
       binding can never become ready. */
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
    // dispatch; the session keeps its original input behavior.
    try {
      const binding = this.ctx.sessions.binding(id)
      if (binding === undefined || this.conversation === undefined) {
        /* A brand-new session's binding may not be ready on the first frame,
           so retry briefly instead of silently leaving the input unpatched.
           Bounded: a binding that never becomes ready must not spin a 50 ms
           timer forever. The retry entry persists across timer firings and
           counts every scheduled attempt; once ENSURE_RETRY_MAX attempts are
           scheduled the entry is dropped (a later reconcile() re-arms it). */
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
          /* Advance the attempt counter on the persisted entry so the cap
             check in ensure() stops an unavailable binding from re-arming
             forever. */
          current.count += 1
          this.ensure(id)
        }, 50)
        this.ensureRetries.set(id, { count, timer })
        return
      }
      const input = this.conversation.input.for(binding.ctx)
      const original = input.submit
      const originalSteerQueue = input.steerQueue
      const originalBeginCommand = input.beginCommand
      if (typeof original !== 'function' || typeof originalSteerQueue !== 'function') {
        console.error(`workspace-studio: session ${id} input submit/steer seams unavailable; editor context will not attach`)
        return
      }
      const bridge = this
      /* Every claim wrapper funnels here; whether the envelope goes in is
         decided inside, at submission time, from the live editor context. */
      const submitClaim = (claim, args, actx, attachments) => bridge.submitClaimWithEditorContext(id, claim, args, actx, attachments)
      /* One record per patched seam: input wrappers, the session scope the slash
         controller resolves from, and the claim/adjudicator patches this install
         added (restoreInput only rolls back what is still ours). */
      const patch = {
        input,
        original,
        originalSteerQueue,
        originalBeginCommand: undefined,
        beginCommandWrapper: undefined,
        submitClaim,
        actx: binding.ctx,
        controller: undefined,
        originalAdjudicate: undefined,
        wrappedAdjudicate: undefined,
        adjudicatorUnavailable: false,
        wrapper: undefined,
        steerWrapper: undefined,
      }
      /* Empty-draft sends carry context only: the harness submit machine
         rejects an empty draft, so this bridge owns that gesture (⌘/Ctrl+Enter
         steering included). A drifted snapshot shape must hand the gesture back
         to the harness instead of throwing inside the submit. */
      const sendContextOnlyIfIdle = (mode) => {
        try {
          const state = input.state.getSnapshot()
          if (typeof state?.draft !== 'string' || state.draft.trim() !== '') return false
          const attachments = attachmentIdsOf(state)
          if (attachments === null || attachments.length > 0) return false
          if (!bridge.directSession(id) || !bridge.editorContexts.active(id)) return false
          void bridge.sendContextOnly(id, mode)
          return true
        } catch (error) {
          console.warn(`workspace-studio: editor-context empty-draft gate failed for session ${id}: ${error instanceof Error ? error.message : String(error)}`)
          return false
        }
      }
      const wrapper = function submitWithEditorContext(mode = 'queue') {
        if (sendContextOnlyIfIdle(mode)) return
        /* A slash command's claim transaction bypasses sendSession, so the
           adjudicator is patched here — the one moment the composer is
           certainly mounted, so resolving the resident controller cannot force
           a session prewarm for a session the user never opened. */
        if (bridge.editorContexts.active(id)) bridge.patchCommandAdjudication(id, patch)
        return original.call(input, mode)
      }
      const steerWrapper = function steerQueueWithEditorContext() {
        return sendContextOnlyIfIdle('steer') ? undefined : originalSteerQueue.call(input)
      }
      /* A claim reaches the submit machine by two routes, and this one must be
         wrapped eagerly rather than lazily at submit time: a slash-menu pick or
         the Space gesture applies the claim immediately
         (slash/input-begin-command -> shell.beginCommand) and the machine then
         STORES it — Enter submits that stored claim without ever adjudicating, so
         a patch installed at Enter would come too late. The wrapper is inert for
         claims that carry no prompt (wrapPromptClaim answers the original). */
      if (typeof originalBeginCommand === 'function') {
        const beginCommandWrapper = function beginCommandWithEditorContext(claim, span) {
          return originalBeginCommand.call(input, wrapPromptClaim(claim, submitClaim), span)
        }
        patch.originalBeginCommand = originalBeginCommand
        patch.beginCommandWrapper = beginCommandWrapper
        input.beginCommand = beginCommandWrapper
      }
      patch.wrapper = wrapper
      patch.steerWrapper = steerWrapper
      input.submit = wrapper
      input.steerQueue = steerWrapper
      this.inputPatches.set(id, patch)
      /* Reported after registration, so the notice reaches this session's dock. */
      if (typeof originalBeginCommand !== 'function') this.reportCommandSeam(id, 'beginCommand')
    } catch (error) {
      console.error(`workspace-studio: failed to patch input seams for session ${id}:`, error)
    }
  }
  /* A harness build that stops exposing one of the claim seams silently drops
     the editor context on command messages; make that capability loss visible
     once (composer notice) instead of only logging it to a console nobody reads. */
  reportCommandSeam(id, seam) {
    this.notify(id, new Error(translate('context.commandSeamUnavailable', { seam })))
  }
  restoreInput(id, patch) {
    if (patch.input.submit === patch.wrapper) patch.input.submit = patch.original
    if (patch.input.steerQueue === patch.steerWrapper) patch.input.steerQueue = patch.originalSteerQueue
    if (patch.beginCommandWrapper !== undefined && patch.input.beginCommand === patch.beginCommandWrapper) {
      patch.input.beginCommand = patch.originalBeginCommand
    }
    if (patch.controller !== undefined && patch.controller.adjudicate === patch.wrappedAdjudicate) {
      patch.controller.adjudicate = patch.originalAdjudicate
    }
    this.inputPatches.delete(id)
  }
  /* Patch the session's slash adjudicator (ui-input-trigger's resident
     InputTriggerController) so a prompt-bearing command claim can carry the
     editor context. Idempotent; a missing slash pipeline — or a harness that
     stops exposing adjudicate — degrades to "no command context" without
     touching the submit seam patched above. */
  patchCommandAdjudication(id, patch) {
    if (patch.wrappedAdjudicate !== undefined || patch.adjudicatorUnavailable === true) return
    let controller
    try {
      const inputTriggers = this.ctx.get('inputTriggers')
      /* Not composed (yet): stay silent and try again on the next submit. */
      if (inputTriggers === undefined) return
      controller = inputTriggers.sessionOf(patch.actx)
    } catch (error) {
      /* A vanished scope or an unexpected throw is diagnosed once; the flag
         stops the warning from repeating on every later submit. */
      patch.adjudicatorUnavailable = true
      console.warn(`workspace-studio: command-context adjudicator patch failed for session ${id}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const originalAdjudicate = controller?.adjudicate
    if (typeof originalAdjudicate !== 'function') {
      /* The slash pipeline exists but no longer exposes adjudicate: the typed
         line loses its context, so report the loss once. */
      patch.adjudicatorUnavailable = true
      this.reportCommandSeam(id, 'adjudicate')
      return
    }
    const bridge = this
    const wrappedAdjudicate = function adjudicateWithEditorContext(line, signal, envelope) {
      const outcome = originalAdjudicate.call(controller, line, signal, envelope)
      if (!bridge.editorContexts.active(id)) return outcome
      return Promise.resolve(outcome).then(result => wrapPromptClaimOutcome(result, patch.submitClaim))
    }
    controller.adjudicate = wrappedAdjudicate
    patch.controller = controller
    patch.originalAdjudicate = originalAdjudicate
    patch.wrappedAdjudicate = wrappedAdjudicate
  }
  /* Submit one prompt-bearing command claim with the editor-context envelope
     prepended to its argument text. The harness logs the submitted line as the
     command's `command/run.args` and `/plan` steers exactly that text as the
     user message, so the envelope reaches the model through the command's own
     prompt — the existing bubble folding and session-title guard apply
     unchanged. Failures follow the plain-prompt path: notify, then reject so
     the harness keeps the draft and the command does not run. */
  async submitClaimWithEditorContext(id, claim, args, actx, attachments) {
    let context
    try {
      context = this.editorContexts.snapshot(id)
    } catch (error) {
      this.notify(id, error)
      throw error
    }
    /* No context attached (or one that cannot be snapshotted): the command runs
       exactly as the harness would have submitted it. */
    if (context === undefined) return claim.submit(args, actx, attachments)
    const prompt = args.trim()
    return this.enqueue(id, async (signal) => {
      if (signal.aborted) throw new Error(translate('context.canceled'))
      const rendered = await this.renderEnvelope(id, context, signal)
      const combined = `${rendered}\n\n${prompt}`
      const display = describeEditorContext(context, rendered)
      const displayHandle = rememberEditorContextDisplay(combined, display)
      this.cleanedTitles.set(id, cleanedSessionTitle({
        remainder: prompt,
        fileName: display.fileName,
        range: display.range,
      }))
      try {
        return await claim.submit(combined, actx, attachments)
      } catch (error) {
        discardEditorContextDisplay(displayHandle)
        throw error
      }
    })
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
      /* No input patch to surface the error on: never swallow silently — the
         console keeps the failure diagnosable. */
      console.warn(`workspace-studio: editor-context error for session ${id}: ${message}`)
      return
    }
    try {
      patch.input.notify('error', message)
    } catch (notifyError) {
      /* The input dock may be mid-teardown: a notify throw must not replace
         the original error or escape as an unhandled rejection — degrade to a
         console record. */
      console.warn(`workspace-studio: input notify failed for session ${id}: ${String(notifyError)}`)
    }
  }
}