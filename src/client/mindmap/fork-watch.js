import { clearMindmapForkQueue, syncMindmapDoc } from '../api.js'
import { mindmapDocHandoff, mindmapRegistry } from './registry.js'

/* Foreign-fork watch: the harness's own chat branch button
   (`ui-chat` apply.ts forkAt -> ctx.sessions.fork) and the workspace
   navigation fork both bypass this plugin's mind-map fork actions, and the
   harness fork carries two defects the map must absorb:
   1. The child inherits the source session's durable pending queue (the
      parent's next submitted message enters its inbox BEFORE the turn/start
      the fork cut extends to, while its claim lands AFTER the cut), so the
      child would claim that message ahead of the user's own first send. The
      Host drops it while the fresh child is still idle; the map's own forkAt
      does the same for its own path.
   2. Nothing writes the map document or refreshes the client index, so the
      new branch stays invisible until the 2.5 s sync / 30 s index poll catch
      up. The watch syncs the family on the Host (which adopts + persists the
      child) and hands the resulting document to the mounted body.
   Wrapping the client session service is the only seam that covers every
   client fork caller: `ClientSessions` is a plain class registered through
   `rootCtx.reflect.provide('sessions', this)` (not a cordis `Service`), so
   `ctx.sessions` is the raw instance and assigning `fork` shadows the
   prototype method for every call-time property read. Installation is
   idempotent, degradable (a missing/unwritable method is a no-op) and fully
   restored by the returned disposer. */

/* Depth of forks this plugin started itself (mindmapActions.forkAt): that path
   writes the document optimistically and refreshes the index already, and the
   extra family sync would pay a full persistence scan (the client doc write
   invalidates the Host list cache). */
let ownForkDepth = 0

/* Run one map-owned fork with the watch suppressed. `await` keeps the flag up
   for the whole RPC (not just until the promise object is returned). */
export async function withoutForeignForkWatch(task) {
  ownForkDepth += 1
  try {
    return await task()
  } finally {
    ownForkDepth -= 1
  }
}

const FORK_WATCH_FLAG = '__dshWsForkWatch'

/* Best-effort family hand-off for one foreign fork: resolve the parent's map
   root, sync the family on the Host (adopt + persist the fresh child) and hand
   the fresh document to the mounted body. Never awaited and never thrown — a
   failed or skipped hand-off degrades to the periodic sync paths. */
function handOffForeignFork(parentSessionId, childId) {
  let root = null
  try {
    if (parentSessionId !== undefined && parentSessionId !== null && parentSessionId !== '') {
      root = mindmapRegistry.rootOf(String(parentSessionId))
    }
  } catch {
    root = null
  }
  if (root === null) return
  void Promise.resolve(syncMindmapDoc(root))
    .then((payload) => {
      if (payload === null || payload === undefined || payload.exists === false) return
      if (payload.doc !== null && payload.doc !== undefined) {
        mindmapDocHandoff.publish(root, payload.doc, String(childId))
      }
      /* The document on disk now carries the child, so the sidebar index
         (entries, branch counts, the hider's branch set and rootOf) must be
         refreshed instead of waiting for the 30 s poll. */
      mindmapRegistry.markDirty()
    })
    .catch(() => { /* transient: the periodic sync/index paths still converge */ })
}

/* Install the fork watch on the client session service; returns the disposer. */
export function installForeignForkWatch(ctx) {
  const sessions = ctx.sessions
  if (sessions === null || sessions === undefined || typeof sessions.fork !== 'function') {
    return () => {}
  }
  if (sessions.fork[FORK_WATCH_FLAG] === true) return () => {}
  const original = sessions.fork
  const wrapped = async function workspaceStudioForeignForkWatch(opts) {
    /* Errors (SessionForkError and friends) must reach the caller untouched:
       no try/catch around the original call. */
    const childId = await original.call(sessions, opts)
    if (ownForkDepth === 0) {
      try {
        await clearMindmapForkQueue(String(childId))
      } catch {
        /* advisory: a failed cleanup degrades to the leaked-queue behavior */
      }
      handOffForeignFork(opts === null || opts === undefined ? undefined : opts.sessionId, childId)
    }
    return childId
  }
  wrapped[FORK_WATCH_FLAG] = true
  sessions.fork = wrapped
  return () => {
    /* Restore by assignment, not `delete`: the pristine method lives on the
       prototype, but deleting the shadow would remove a service whose `fork`
       happened to be an own property. */
    if (sessions.fork === wrapped) sessions.fork = original
  }
}
