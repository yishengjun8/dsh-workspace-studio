/* Module-wide open-file request bridge: the chat's file-open path asks the
   mounted explorer to open a file as a preview tab. The explorer consumes a
   request only when its workspace matches the request's workspaceId, so a
   later mount never re-applies a stale request; a request with no mounted
   explorer stays pending until the matching mount consumes it. */
export const fileOpenRequestStore = {
  _snapshot: { seq: 0, request: null },
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getSnapshot() { return this._snapshot },
  /* `outside` marks a path the workspace-confined plugin API cannot serve: the
     explorer opens it as the session-only read-only preview instead of a tree
     file, so it never becomes a tree selection, a draft, or a persisted tab. */
  request(workspaceId, path, name, line, outside) {
    this._snapshot = {
      seq: this._snapshot.seq + 1,
      request: {
        workspaceId: String(workspaceId),
        path,
        name: typeof name === 'string' && name !== '' ? name : path.slice(path.lastIndexOf('/') + 1),
        line: Number.isFinite(line) ? line : undefined,
        outside: outside === true ? true : undefined,
      },
    }
    for (const listener of [...this._listeners]) listener()
  },
  consume() {
    if (this._snapshot.request === null) return
    this._snapshot = { seq: this._snapshot.seq + 1, request: null }
    for (const listener of [...this._listeners]) listener()
  },
}
