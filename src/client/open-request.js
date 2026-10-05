import { createRequestStore } from './request-store.js'

/* Module-wide open-file request bridge: the chat's file-open path asks the
   mounted explorer to open a file as a preview tab. The explorer consumes a
   request only when its workspace matches the request's workspaceId, so a
   later mount never re-applies a stale request; a request with no mounted
   explorer stays pending until the matching mount consumes it. */
const pendingOpen = createRequestStore('workspaceId')

export const fileOpenRequestStore = {
  ...pendingOpen,
  /* `outside` marks a path the workspace-confined plugin API cannot serve: the
     explorer opens it as the session-only read-only preview instead of a tree
     file, so it never becomes a tree selection, a draft, or a persisted tab. */
  request(workspaceId, path, name, line, outside) {
    pendingOpen.request({
      workspaceId: String(workspaceId),
      path,
      name: typeof name === 'string' && name !== '' ? name : path.slice(path.lastIndexOf('/') + 1),
      line: Number.isFinite(line) ? line : undefined,
      outside: outside === true ? true : undefined,
    })
  },
}
