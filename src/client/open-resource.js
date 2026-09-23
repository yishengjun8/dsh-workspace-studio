/* Route the chat's resource-open path into the plugin's own preview tabs.
 *
 * The shipped chat opens files through ctx.sidebarRight.openResource, which
 * requires the harness right-Sidebar seat this root layout never mounts. This
 * module patches openResource to resolve a FILE address against the session's
 * workspace and publish an open request to the mounted explorer
 * (fileOpenRequestStore): a path inside the workspace opens as a normal preview
 * tab, a path outside it as the session-only read-only preview. A PLAN address
 * (ui-plan's 「查看全文」 and the turn's plan card) is routed to planOpenStore
 * instead, and any other address is handed back to the harness implementation —
 * its own registered tab types, or its honest "no seat mounted" failure. The
 * patch only claims the addresses this layout can actually draw.
 *
 * The patch follows the sendSession bridge convention: a marker + recorded
 * original let an overlapping re-install unwrap a stale wrapper instead of
 * recursing, and cleanup restores only when the current value is still our
 * wrapper.
 */
import { OPEN_RESOURCE_BRIDGE_MARKER, OPEN_RESOURCE_BRIDGE_ORIGINAL } from './constants.js'
import { translate } from './locale/index.js'
import { currentSessionOf, workspaceOfSession } from './controllers.js'
import { fileOpenRequestStore } from './open-request.js'
import { isAbsoluteWorkspacePath } from './paths.js'
import { normalizePlanDocument, parsePlanResourceAddress, planDocuments, planOpenStore } from './plan-open.js'

/* The dsh-resource://file/… address grammar, mirrored locally from
   @deepseek-ai/dsh-util-workspace-path's file-address.ts so the bundle needs
   no new harness dependency. */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/* Parse a file address into its parts; undefined when not a file address.
   - session scope: `dsh-resource://file/session/<sessionId>/<path>` — the
     path is resolved against that Session's workspace root, and DSH spells it
     RELATIVE only when the root is known and contains it; a Session with no
     cwd, or a file outside the root, keeps the absolute spelling in this same
     scope. Both spellings must therefore be handled here.
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

/* Resolve a parsed file address and publish the open request. A path inside the
   workspace opens as a normal (editable) preview tab; a path OUTSIDE it opens as
   the session-only read-only preview — the plugin's own workspace-confined API
   cannot serve such a file, while the harness `workspaceFiles` Remote reads it
   through the Session's own filesystem authority. */
function routeFileOpen(ctx, parsed, options) {
  const sessions = ctx.sessions.list.getSnapshot()
  const sessionId = parsed.scope === 'session'
    ? parsed.sessionId
    : currentSessionOf(sessions.byId)
  if (sessionId === undefined) {
    throw new Error(translate('openResource.noWorkspace'))
  }
  const workspace = workspaceOfSession(ctx, sessionId)
  if (workspace === undefined) {
    throw new Error(translate('openResource.noWorkspace'))
  }
  const line = options?.params?.line
  const requestedLine = typeof line === 'number' && Number.isFinite(line) ? line : undefined
  const nameOf = path => path.slice(path.lastIndexOf('/') + 1)
  /* The scope alone does not decide this: a SESSION-scoped address may carry an
     absolute path (see parseFileAddress), and an absolute tree path is refused
     by the Host's workspace-confined API on sight. */
  if (parsed.scope === 'absolute' || isAbsoluteWorkspacePath(parsed.path)) {
    if (!isPathInside(workspace.path, parsed.path)) {
      fileOpenRequestStore.request(String(workspace.workspaceId), parsed.path, nameOf(parsed.path), requestedLine, true)
      return
    }
    const relative = relativizeToRoot(workspace.path, parsed.path)
    fileOpenRequestStore.request(String(workspace.workspaceId), relative, nameOf(relative), requestedLine)
    return
  }
  fileOpenRequestStore.request(
    String(workspace.workspaceId),
    parsed.path,
    nameOf(parsed.path),
    requestedLine,
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
        /* Only the addresses this layout can draw are claimed: a file address
           opens a preview tab, a plan address opens a plan tab, and everything
           else goes back to the harness implementation instead of this plugin
           inventing a failure for a tab type it does not host. */
        const file = parseFileAddress(address)
        if (file !== undefined) { routeFileOpen(ctx, file, options); return }
        const plan = parsePlanResourceAddress(address)
        if (plan !== undefined) {
          /* A temporary review carries its document in the navigation params;
             the logged-plan path is read through the harness plan resource. */
          const document = plan.kind === 'plan-review' ? normalizePlanDocument(options?.params?.planReview) : undefined
          if (document !== undefined) planDocuments.set(address, document)
          planOpenStore.open(address, document?.title ?? '', plan.sessionId)
          return
        }
        if (typeof original === 'function') original.call(controller, address, options)
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
