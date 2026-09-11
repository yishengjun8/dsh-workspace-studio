/** Workspace/session ownership lookups shared by routing and context. */
import { realpath } from 'node:fs/promises'
import { HttpError } from './errors.js'
export async function workspaceOwnsSession(ctx, workspace, sessionId) {
  /* The registry can hand out entries mid-load/partial: the client guards the same field everywhere, so a missing/malformed sessionIds must degrade to the cwd comparison instead of a TypeError → 500 on /context. */
  const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
  if (sessionIds.some(candidate => String(candidate) === sessionId)) return true
  const session = ctx.sessions.get(sessionId)
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return false
  try {
    return await realpath(cwd) === await realpath(workspace.path)
  } catch {
    return false
  }
}
export function workspaceFor(ctx, workspaceId) {
  const workspace = ctx.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new HttpError(404, 'workspace-not-found', '当前工作区不存在')
  return workspace
}
