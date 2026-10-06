/** HTML-preview "site" route: a token-gated, read-only byte route that lets a sandboxed preview
 *  frame resolve EVERY relative URL of the previewed document natively.
 *
 *  Why it exists: the frame is a unique (opaque) origin and cannot use the plugin API — a subresource
 *  request from it carries `Sec-Fetch-Site: cross-site`, which the shared trust fence rejects by
 *  design. The preview therefore mints its own capability: an unguessable token bound to one
 *  document's directory, injected as `<base href="/workspace-studio/api/site/<token>/">`, through
 *  which the browser fetches images, CSS, scripts, fonts, media and runtime-constructed URLs. The
 *  token is the access control (it never leaves the preview frame's srcdoc), reads are GET/HEAD-only,
 *  and every path stays inside the confinement root recorded at mint time. */
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { HttpError } from './errors.js'
import { isInside, normalizeRelativePath, resolveWorkspacePath } from './paths.js'
import { openRegularFile, readFileHandleBounded } from './fs.js'
import { sendRaw } from './http.js'
import { workspaceFor } from './workspace.js'

/** Live tokens; bounded and expiry-pruned (an entry is a few strings, never bytes). */
const siteTokens = new Map()
const SITE_TOKEN_MAX = 64
const SITE_TOKEN_TTL_MS = 30 * 60 * 1000
/* Windows reserved device names: a URL segment is a file name here, and opening `CON` fails with a
   raw EINVAL (the trailing dot/space aliasing rule is checked in siteSegment). */
const RESERVED_SEGMENT = /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])$/u

function pruneSiteTokens(now) {
  for (const [token, entry] of siteTokens) {
    if (entry.expiresAt <= now) siteTokens.delete(token)
  }
}

export function isSiteRequest(pathname, apiPrefix) {
  return pathname.startsWith(`${apiPrefix}/site/`)
}

/** Check one already-decoded URL segment. `.`/`..` are REFUSED: the browser normalizes them in the
 *  request URL before it ever reaches here, so a surviving one is a crafted request. */
function siteSegment(decoded) {
  if (decoded === '' || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(decoded)
    /* Same Windows rules as normalizeRelativePath: a colon is illegal in a name and `C:` would
       alias a drive, so refuse it on Windows only (POSIX keeps colons, which are legal there). */
    || (process.platform === 'win32' && decoded.includes(':'))
    || /[. ]$/u.test(decoded)
    || RESERVED_SEGMENT.test(decoded.split('.')[0].toUpperCase())) {
    throw new HttpError(400, 'invalid-path', '预览站点请求包含非法路径段')
  }
  return decoded
}

/** Decode one percent-encoded URL segment without letting an escape smuggle in a separator. */
function decodeSegment(raw) {
  try {
    return siteSegment(decodeURIComponent(raw))
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid-path', '预览站点请求包含非法转义')
  }
}

/* Resolve a request path against the token's ROOT and confine it. The URL mirrors the path from
   that root — the base the client installs is `<prefix>/<document directory from the root>/` — so
   the browser's own `..` normalization walks inside the mirrored tree, and a reference that climbs
   above the root eats a token segment instead of reaching the Host as an escape attempt. */
async function resolveSiteTarget(entry, tail) {
  const segments = tail === '' ? [] : tail.split('/').map(decodeSegment)
  const candidate = segments.length === 0 ? entry.root : resolve(entry.root, ...segments)
  let target
  try {
    target = await realpath(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new HttpError(404, 'path-not-found', '文件或目录不存在')
    throw error
  }
  if (!isInside(entry.root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝访问工作区之外的路径')
  return target
}

/* MIME by extension. Scripts and stylesheets need their real type: the route answers with
   `X-Content-Type-Options: nosniff`, so a generic type would make the strict-MIME check refuse
   them. No charset is appended — the subresource then keeps using the document's encoding, which
   is what a legacy-encoded file needs. */
const CONTENT_TYPE_BY_EXTENSION = Object.freeze({
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  json: 'application/json', jsonc: 'application/json', map: 'application/json',
  xml: 'application/xml', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv',
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  cur: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  wasm: 'application/wasm', pdf: 'application/pdf', zip: 'application/zip',
})

function contentTypeForSitePath(path) {
  const leaf = path.slice(path.lastIndexOf(sep) + 1)
  const dot = leaf.lastIndexOf('.')
  const extension = dot === -1 ? '' : leaf.slice(dot + 1).toLowerCase()
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/* A subresource response is loaded by the OPAQUE preview frame, so it must not carry the shared
   `same-origin` resource policy; `*` CORS also keeps the previewed page's own fetch()/XHR working.
   The token is the access control, and the route only ever reads. */
const SITE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'cross-origin',
  'access-control-allow-origin': '*',
})

/**
 * Mint one preview-site token for a WORKSPACE-CONFINED document. An out-of-workspace preview gets no
 * site route on purpose: the plugin Host reads with plain fs, so serving an outside document's
 * directory tree would bypass the harness sandbox policy that let the client read it in the first
 * place. Such a preview keeps the pre-site behaviour (relative subresources unresolved).
 * @param ctx - Host context (workspace registry lookup).
 * @param apiPrefix - the plugin's API prefix (its only source of truth stays in the entry module).
 * @param workspaceId - owning workspace.
 * @param documentPath - workspace-relative path of the previewed document.
 * @returns the token and the frame's base URL prefix (root-relative, so the desktop origin works).
 */
export async function mintPreviewSite(ctx, apiPrefix, workspaceId, documentPath) {
  if (typeof documentPath !== 'string' || documentPath === '' || isAbsolute(documentPath)) {
    throw new HttpError(400, 'invalid-path', '预览站点只服务工作区内的文档')
  }
  const workspace = workspaceFor(ctx, workspaceId)
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, normalizeRelativePath(documentPath))
  /* The URL mirrors the document's directory FROM THE ROOT, which is what keeps `..` inside the
     mirrored tree (see resolveSiteTarget). */
  const directory = relative(root, dirname(target)).split(sep).filter(part => part !== '' && part !== '.')
  const suffix = directory.map(encodeURIComponent).join('/')
  const now = Date.now()
  pruneSiteTokens(now)
  while (siteTokens.size >= SITE_TOKEN_MAX) siteTokens.delete(siteTokens.keys().next().value)
  const token = randomBytes(18).toString('base64url')
  siteTokens.set(token, { root, expiresAt: now + SITE_TOKEN_TTL_MS })
  return { token, prefix: `${apiPrefix}/site/${token}/${suffix === '' ? '' : `${suffix}/`}` }
}

/**
 * Serve one preview-site read. Deliberately NOT behind the shared trust fence: the opaque preview
 * frame's subresource requests are inherently `cross-site`, and the token is the capability that
 * authorises them.
 * @returns true when the request was handled here.
 */
export async function handleSiteRequest(req, res, url, apiPrefix, config) {
  const rest = url.pathname.slice(`${apiPrefix}/site/`.length)
  const slash = rest.indexOf('/')
  const token = (slash === -1 ? rest : rest.slice(0, slash)).trim()
  const tail = slash === -1 ? '' : rest.slice(slash + 1)
  const now = Date.now()
  pruneSiteTokens(now)
  const entry = token === '' ? undefined : siteTokens.get(token)
  if (entry === undefined) throw new HttpError(404, 'site-token-invalid', '预览页面已失效，请重新打开该预览')
  const target = await resolveSiteTarget(entry, tail)
  const handle = await openRegularFile(target)
  try {
    const bytes = await readFileHandleBounded(handle, config.maxSiteBytes)
    sendRaw(req, res, 200, bytes, contentTypeForSitePath(target), SITE_HEADERS)
  } finally {
    await handle.close().catch(() => {})
  }
  return true
}
