/** Mind-map action face shared by the floating overlay: document IO, fork,
 *  rename and archive. forkAt does NOT open the child — the view opens it only
 *  after the doc write completes, so the branch is part of the document when it
 *  becomes visible. No increaseTitle: the host derives the title from the fork
 *  boundary; the child is renamed to the family-root title plus " ›" so its
 *  header never collides with the root (a root-replacement fork — card-deletion
 *  truncation of the root session — keeps the plain family title instead, asRoot). */
import { deleteMindmapDoc, fetchMindmapDoc, renameMindmapDoc, syncMindmapDoc, writeMindmapDoc } from './api.js'
import { mindmapRootTitleOf } from './mindmap/helpers.js'

  /* The mind-map action face shared by the floating overlay (formerly the
     conversation.view inject): document IO, fork, rename and archive. forkAt
     does NOT open the child — the view opens it only after the doc write
     completes, so the branch is part of the document when it becomes visible.
     No increaseTitle: the host derives the title from the fork boundary; the
     child is renamed to the family-root title plus " ›" so its header never
     collides with the root (a root-replacement fork — card-deletion
     truncation of the root session — keeps the plain family title instead, asRoot). */
export function buildMindmapActions(ctx) {
    /* Resolve the workspace whose canonical path matches a cwd string (case /
       trailing-separator normalized), so a root-node-created session can be
       created WITH its workspaceId. The harness host attaches a session to a
       workspace only when session.create carries a workspaceId; a cwd-only
       create leaves the session ungrouped, and a blank ungrouped session is
       then hidden from the sidebar as soon as it is not the current session. */
    const mindmapWorkspaceIdForCwd = (cwd) => {
      if (typeof cwd !== 'string' || cwd === '') return undefined
      let items = []
      try {
        items = ctx.workspaces.list.getSnapshot().items
      } catch {
        items = []
      }
      if (!Array.isArray(items)) return undefined
      const normalize = (p) => String(p ?? '').replace(/[\\/]+$/, '').toLowerCase()
      const target = normalize(cwd)
      for (const workspace of items) {
        if (workspace !== null && workspace !== undefined
          && workspace.workspaceId !== undefined
          && workspace.workspaceId !== ''
          && normalize(workspace.path) === target) return String(workspace.workspaceId)
      }
      return undefined
    }
    return {
      archiveSession: async id => { await ctx.workspaces.archiveSession(String(id)) },
    createSession: async (recordedCwd, anchorId) => {
      /* A top-level session (created by clicking the mind-map root node) is a
         brand-new BLANK harness session — no inherited turns. It is created in
         the workspace the map was CREATED in (recordedCwd, from the doc); when
         the doc has none recorded (pre-upgrade / no workspace), fall back to
         the anchor session's current cwd so it still lands in a sidebar group
         instead of the ungrouped bucket. Created via workspaceId (not cwd) so
         the host attaches the session to that workspace; a cwd-only create
         stays ungrouped and the blank session disappears from the sidebar. */
      const snapshot = ctx.sessions.list.getSnapshot()
      const cwd = (typeof recordedCwd === 'string' && recordedCwd !== '')
        ? recordedCwd
        : snapshot.byId[String(anchorId)]?.cwd
      const workspaceId = mindmapWorkspaceIdForCwd(cwd)
      const childId = workspaceId !== undefined
        ? await ctx.sessions.create({ workspaceId })
        : await ctx.sessions.create(cwd === undefined ? {} : { cwd })
      return childId
    },
    deleteDoc: (id, signal) => deleteMindmapDoc(String(id), signal),
    /* All workspaces, for the root node's "选择工作区" menu. */
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
      const rootTitle = mindmapRootTitleOf(ctx.sessions.list.getSnapshot(), String(id))
      if (rootTitle !== undefined && rootTitle !== '') {
        /* Branch children get the family-root title plus " ›" so they never
           collide with the root. A root-replacement fork becomes the NEW root
           itself, so it keeps the plain family title instead. */
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
    /* Rename only the map's OWN title (doc.rootTitle), independent of the root
       session's title (the sidebar panel and the in-map root-head rename both
       use this so the map title stays in sync with what the user sees). */
    renameDoc: (id, title, signal) => renameMindmapDoc(String(id), title, signal),
    saveDoc: (id, doc, signal, prevSessionId) => writeMindmapDoc(String(id), doc, signal, prevSessionId),
    syncDoc: (id, liveSessionIds, signal, summaryConfig) => syncMindmapDoc(String(id), liveSessionIds, signal, summaryConfig),
    }
  }
