import { clearMindmapForkQueue, deleteMindmapDoc, fetchMindmapDoc, renameMindmapDoc, syncMindmapDoc, writeMindmapDoc } from './api.js'
import { mindmapRootTitleOf, normalizeMindmapWorkspacePath } from './mindmap/helpers.js'
import { mindmapBlankSessions } from './mindmap/hider.js'

  /* The mind-map action face shared by the docked mind-map view: document IO,
     fork, rename and archive. forkAt does not open the child — the view opens
     it only after the doc write completes. The child is renamed to the
     family-root title plus " ›" so its header never collides with the root. */
export function buildMindmapActions(ctx) {
    /* Resolve the workspace whose canonical path matches a cwd string, so a root-node-created session can be created with its workspaceId. */
    const mindmapWorkspaceIdForCwd = (cwd) => {
      if (typeof cwd !== 'string' || cwd === '') return undefined
      let items = []
      try {
        items = ctx.workspaces.list.getSnapshot().items
      } catch {
        items = []
      }
      if (!Array.isArray(items)) return undefined
      const target = normalizeMindmapWorkspacePath(cwd)
      for (const workspace of items) {
        if (workspace !== null && workspace !== undefined
          && workspace.workspaceId !== undefined
          && workspace.workspaceId !== ''
          && normalizeMindmapWorkspacePath(workspace.path) === target) return String(workspace.workspaceId)
      }
      return undefined
    }
    return {
      archiveSession: async id => { await ctx.workspaces.archiveSession(String(id)) },
    createSession: async (recordedCwd, anchorId) => {
      /* A top-level session (created by clicking the mind-map root node) is a
         brand-new blank harness session, created in the map's recorded
         workspace (or the anchor session's cwd) via workspaceId so the host
         attaches it to that workspace. */
      const snapshot = ctx.sessions.list.getSnapshot()
      const cwd = (typeof recordedCwd === 'string' && recordedCwd !== '')
        ? recordedCwd
        : snapshot.byId[String(anchorId)]?.cwd
      const workspaceId = mindmapWorkspaceIdForCwd(cwd)
      const childId = workspaceId !== undefined
        ? await ctx.sessions.create({ workspaceId })
        : await ctx.sessions.create(cwd === undefined ? {} : { cwd })
      /* Mark the fresh blank session as mind-map family for the sidebar hider, since the doc write lags the creation RPC. */
      mindmapBlankSessions.add(String(childId))
      return childId
    },
    deleteDoc: (id, signal) => deleteMindmapDoc(String(id), signal),
    /* All workspaces, for the root node's workspace menu. */
    listWorkspaces: () => {
      try {
        const items = ctx.workspaces.list.getSnapshot().items
        return Array.isArray(items) ? items : []
      } catch {
        return []
      }
    },
    forkAt: async (id, seq, asRoot) => {
      const childId = await ctx.sessions.fork({ sessionId: String(id), atSeq: seq })
      /* A fork child inherits the source session's durable pending queue: the
         parent's next submitted message enters its inbox BEFORE the turn/start
         the fork cut extends to, while its claim lands AFTER the cut — so the
         child would claim it ahead of the user's own first message. The Host
         drops it while the fresh child is still idle (this runs BEFORE the
         view opens the child, so no prompt can reach it first). Best effort:
         a failed cleanup degrades to the leaked-queue behavior. */
      try {
        await clearMindmapForkQueue(String(childId))
      } catch {
        /* cleanup is advisory — never fail the fork for it */
      }
      const rootTitle = mindmapRootTitleOf(ctx.sessions.list.getSnapshot(), String(id))
      if (rootTitle !== undefined && rootTitle !== '') {
        /* Branch children get the family-root title plus " ›" so they never collide with the root. */
        const title = asRoot === true ? rootTitle : (rootTitle.endsWith(' ›') ? rootTitle : `${rootTitle} ›`)
        ctx.sessions.binding(String(childId))?.session.rename(title).catch(() => {})
      }
      return childId
    },
    loadDoc: (id, signal) => fetchMindmapDoc(String(id), signal),
    openSession: id => { ctx.sessions.open(String(id)) },
    renameSession: async (id, title) => {
      const session = ctx.sessions.binding(String(id))?.session
      if (session === undefined) throw new Error(`unknown session "${id}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    /* Rename only the map's own title (doc.rootTitle), independent of the root session's title. */
    renameDoc: (id, title, signal) => renameMindmapDoc(String(id), title, signal),
    saveDoc: (id, doc, signal, prevSessionId) => writeMindmapDoc(String(id), doc, signal, prevSessionId),
    syncDoc: (id, liveSessionIds, signal, summaryConfig) => syncMindmapDoc(String(id), liveSessionIds, signal, summaryConfig),
    }
  }
