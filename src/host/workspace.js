/** Workspace/session ownership lookups shared by routing and context. */
import { realpath } from 'node:fs/promises'
import { HttpError } from './errors.js'
export async function workspaceOwnsSession(ctx, workspace, sessionId) {
  /* The registry can hand out entries mid-load/partial (the client guards the same field): a missing/malformed sessionIds must degrade to the cwd comparison, not a TypeError → 500 on /context. */
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

/**
 * The workspace a chat session belongs to, for model-facing tools (no model-supplied id).
 * The registry's session list is authoritative; the session cwd is the fallback for a
 * workspace whose own sessionIds were not loaded yet. Null when none matches.
 */
export async function workspaceForSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  const session = ctx.sessions.get(sessionId)
  const cwd = session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') {
    try {
      const resolved = await ctx.workspaceRegistry.resolveByPath(cwd)
      if (resolved !== undefined && resolved !== null && await workspaceOwnsSession(ctx, resolved, sessionId)) return resolved
    } catch {
      /* resolveByPath is best-effort: the list below is the authoritative fallback. */
    }
  }
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (await workspaceOwnsSession(ctx, workspace, sessionId)) return workspace
  }
  return null
}
