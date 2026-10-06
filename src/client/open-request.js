import { createRequestStore } from './request-store.js'

/* Module-wide open-file request bridge: the chat's file-open path asks the mounted
   explorer to open a file as a preview tab. The explorer consumes a request only when
   its workspace matches the request's workspaceId, so a later mount never re-applies a
   stale request, and an unmounted explorer leaves it pending until the matching mount. */
const pendingOpen = createRequestStore()

export const fileOpenRequestStore = {
  ...pendingOpen,
  /* `outside` marks a path the workspace-confined plugin API cannot serve: the
     explorer opens it as the session-only read-only preview instead of a tree
     file, so it never becomes a tree selection, a draft, or a persisted tab. */
  request(workspaceId, path, name, line, outside) {
    /* The target workspace is the request's key, so the mounted explorer of that
       workspace is the whole match rule. */
    pendingOpen.request(workspaceId, {
      path,
      name: typeof name === 'string' && name !== '' ? name : path.slice(path.lastIndexOf('/') + 1),
      line: Number.isFinite(line) ? line : undefined,
      outside: outside === true ? true : undefined,
    })
  },
}
