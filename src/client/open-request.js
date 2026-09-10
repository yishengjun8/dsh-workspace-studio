/* Module-wide open-file request bridge: the chat's file-open path (the
   patched ctx.sidebarRight.openResource, see open-resource.js) asks the
   mounted explorer to open a file as a preview tab (dsh-ws-preview). The
   explorer consumes a request ONLY when its workspace matches the request's
   workspaceId — add/activate the file tab, optionally reveal a line — and
   clears it, so a later explorer mount (session switch) never re-applies a
   stale request and an unrelated workspace's explorer never adopts one. A
   request whose workspace has no mounted explorer stays pending until the
   matching mount consumes it, which is the closest the request can get to its
   intent (same semantics as mindmapDockStore). */
export const fileOpenRequestStore = {
  _snapshot: { seq: 0, request: null },
  _listeners: new Set(),
  subscribe(listener) {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  },
  getSnapshot() { return this._snapshot },
  request(workspaceId, path, name, line) {
    this._snapshot = {
      seq: this._snapshot.seq + 1,
      request: {
        workspaceId: String(workspaceId),
        path,
        name: typeof name === 'string' && name !== '' ? name : path.slice(path.lastIndexOf('/') + 1),
        line: Number.isFinite(line) ? line : undefined,
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
