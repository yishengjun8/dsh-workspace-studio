/* Route the chat's file-open path into the plugin's own preview tabs.
 *
 * The shipped chat opens files through ctx.sidebarRight.openResource, which
 * requires the harness right-Sidebar seat this root layout never mounts. This
 * module patches openResource to resolve the address against the session's
 * workspace and publish an open request to the mounted explorer
 * (fileOpenRequestStore), opening the file as a preview tab.
 *
 * The patch follows the sendSession bridge convention: a marker + recorded
 * original let an overlapping re-install unwrap a stale wrapper instead of
 * recursing, and cleanup restores only when the current value is still our
 * wrapper.
 */
import { OPEN_RESOURCE_BRIDGE_MARKER, OPEN_RESOURCE_BRIDGE_ORIGINAL } from './constants.js'
import { translate } from './locale/index.js'
import { workspaceOfSession } from './controllers.js'
import { fileOpenRequestStore } from './open-request.js'

/* The dsh-resource://file/… address grammar, mirrored locally from
   @deepseek-ai/dsh-util-workspace-path's file-address.ts so the bundle needs
   no new harness dependency. */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/* Parse a file address into its parts; undefined when not a file address.
   - session scope: `dsh-resource://file/session/<sessionId>/<path>` — the
     path is relative to that Session's workspace root (no leading `/`).
   - absolute scope: `dsh-resource://file/absolute/<path>` — the absolute
     path with the leading `/` dropped (`C:/x/y.txt` for a Windows drive; a
     UNC path keeps an empty first segment, `//server/share/x.txt`). */
export function parseFileAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
  const rest = address.slice(FILE_ADDRESS_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return undefined
  const scope = rest.slice(0, slash)
  const segments = rest.slice(slash + 1).split('/')
  try {
    if (scope === 'session') {
      const [id, ...pathSegments] = segments
      if (id === undefined || id === '' || pathSegments.length === 0) return undefined
      return { scope, sessionId: decodeURIComponent(id), path: pathSegments.map(decodeURIComponent).join('/') }
    }
    if (scope === 'absolute') {
      const unc = segments[0] === '' && segments.length > 1
      const parts = (unc ? segments.slice(1) : segments).map(decodeURIComponent)
      if (parts.length === 0 || parts[0] === '') return undefined
      if (unc) return { scope, path: `//${parts.join('/')}` }
      return { scope, path: /^[A-Za-z]:$/.test(parts[0]) ? parts.join('/') : `/${parts.join('/')}` }
    }
  } catch {
    // decodeURIComponent throws URIError on a malformed escape: not a file address.
    return undefined
  }
  return undefined
}

/* Normalize a native workspace root to `/` separators with no trailing slash. */
function normalizeRoot(path) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/* Whether an absolute `/`-separated path is inside a native workspace root;
   Windows-style roots (drive or UNC) compare case-insensitively. */
function isPathInside(root, path) {
  const base = normalizeRoot(root)
  if (base === '') return false
  const normalized = path.replace(/\\/g, '/')
  const windows = /^[A-Za-z]:/.test(base) || base.startsWith('//')
  const a = windows ? normalized.toLowerCase() : normalized
  const b = windows ? base.toLowerCase() : base
  return a === b || a.startsWith(`${b}/`)
}

/* The workspace-relative path of an absolute path known to be inside the root
   ('' for the root itself); the caller must have checked isPathInside. */
function relativizeToRoot(root, path) {
  const base = normalizeRoot(root)
  const normalized = path.replace(/\\/g, '/')
  if (normalized === base) return ''
  return normalized.slice(base.length + 1)
}

/* Resolve a file address to a workspace-relative path and publish the open
   request; throws a user-facing error when the file cannot be opened. */
function routeFileOpen(ctx, address, options) {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) {
    throw new Error(`sidebarRight: no registered tab type claims "${address}"`)
  }
  const sessions = ctx.sessions.list.getSnapshot()
  const sessionId = parsed.scope === 'session'
    ? parsed.sessionId
    : (sessions.current !== undefined ? String(sessions.current) : undefined)
  if (sessionId === undefined) {
    throw new Error(translate('openResource.noWorkspace'))
  }
  const workspace = workspaceOfSession(ctx, sessionId)
  if (workspace === undefined) {
    throw new Error(translate('openResource.noWorkspace'))
  }
  let relative = parsed.path
  if (parsed.scope === 'absolute') {
    if (!isPathInside(workspace.path, parsed.path)) {
      throw new Error(translate('openResource.outsideWorkspace', { path: parsed.path }))
    }
    relative = relativizeToRoot(workspace.path, parsed.path)
  }
  const line = options?.params?.line
  fileOpenRequestStore.request(
    String(workspace.workspaceId),
    relative,
    relative.slice(relative.lastIndexOf('/') + 1),
    typeof line === 'number' && Number.isFinite(line) ? line : undefined,
  )
}

/* Install the openResource patch for the lifetime of the plugin via a
   deferred inject on the sidebarRight service. */
export function installOpenResourceRouter(ctx) {
  ctx.inject(['sidebarRight'], scope => {
    scope.effect(() => {
      const controller = scope.get('sidebarRight')
      if (controller === undefined) return undefined
      /* Unwrap a previous install's wrapper (overlap window) instead of recursing. */
      let original = controller.openResource
      if (typeof original === 'function' && original[OPEN_RESOURCE_BRIDGE_MARKER] === true) {
        original = original[OPEN_RESOURCE_BRIDGE_ORIGINAL] ?? original
      }
      const patched = function openResourceRouted(address, options) {
        routeFileOpen(ctx, address, options)
      }
      Object.defineProperty(patched, OPEN_RESOURCE_BRIDGE_MARKER, { value: true })
      Object.defineProperty(patched, OPEN_RESOURCE_BRIDGE_ORIGINAL, { value: original })
      controller.openResource = patched
      return () => {
        /* The traceable proxy returns a fresh shadow wrapper per read, so the
           marker on the underlying function is the reliable check. */
        const current = controller.openResource
        if (current?.[OPEN_RESOURCE_BRIDGE_MARKER] === true) controller.openResource = original
      }
    }, 'workspace-studio: chat file-open router')
  })
}
