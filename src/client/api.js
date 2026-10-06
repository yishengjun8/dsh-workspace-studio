/* The plugin's ONLY network layer.
 *
 * Every request goes through `request`, so the bounded timeout, same-origin credentials, the
 * accept/content-type headers, failure normalization and the invalid-response contract exist
 * exactly once; each endpoint is then a few lines naming its route, its query/body and the failure
 * locale keys, with no fetch boilerplate repeated.
 *
 * `ROUTES` mirrors the Host's route table (src/host/index.js); scripts/check-api-surface.mjs
 * asserts the two agree, so a route renamed on one side cannot survive as a runtime 404.
 */
import { API_PREFIX, ENCODING_FALLBACK, ENCODING_LABEL_FALLBACK, MINDMAP_LOAD_TIMEOUT_MS, MINDMAP_MODELS_CACHE_MS, MINDMAP_SYNC_TIMEOUT_MS, RUN_PROBE_REQUEST_TIMEOUT_MS, RUN_STATUS_TIMEOUT_MS, TOKEN_STATS_TIMEOUT_MS, UPDATE_CHECK_TIMEOUT_MS, UPDATE_DOWNLOAD_TIMEOUT_MS, VCS_STATUS_TIMEOUT_MS } from './constants.js'
import { localeIsZh, translate } from './locale/index.js'

/* Bounded request timeouts: a hung Host must not leave the UI in a permanent loading/saving state; withTimeout merges in the caller's signal, or falls back to the signal alone when the timeout APIs are unavailable. */
const REQUEST_TIMEOUT_MS = 30_000
const MINDMAP_LLM_TIMEOUT_MS = 60_000

/** The client's mirror of the Host route table: one entry per endpoint this bundle calls.
 *  `failure` is the code/locale-key pair a non-2xx answer is reported with; `invalid` is the
 *  locale key used when a 2xx body does not match the documented shape. */
const ROUTES = Object.freeze({
  encodings: { path: '/encodings' },
  file: { path: '/file', invalid: 'error.invalid-response.file' },
  tree: { path: '/tree', invalid: 'error.invalid-response.tree' },
  search: { path: '/search', failure: { code: 'search-failed', key: 'error.search-failed' }, invalid: 'error.invalid-response.search' },
  entry: { path: '/entry', failure: { code: 'entry-failed', key: 'error.entry-failed' }, invalid: 'error.invalid-response.entry' },
  fs: { path: '/fs', failure: { code: 'fs-failed', key: 'error.fs-failed' }, invalid: 'error.invalid-response.fs' },
  reveal: { path: '/reveal', failure: { code: 'reveal-failed', key: 'error.reveal-failed.http' }, invalid: 'error.invalid-response.reveal' },
  open: { path: '/open', failure: { code: 'open-failed', key: 'error.open-failed.http' }, invalid: 'error.invalid-response.open' },
  raw: { path: '/raw' },
  externalFile: { path: '/external-file', failure: { code: 'external-file-failed', key: 'error.external-file-failed' }, invalid: 'error.invalid-response.external' },
  siteToken: { path: '/site-token', invalid: 'error.invalid-response.file' },
  context: { path: '/context', failure: { code: 'context-failed', key: 'error.context-failed' }, invalid: 'error.invalid-response.context' },
  draft: { path: '/draft', failure: { code: 'draft-read-failed', key: 'error.draft-failed' }, invalid: 'error.invalid-response.draft' },
  draftTree: { path: '/draft-tree', failure: { code: 'draft-tree-failed', key: 'error.draft-failed' }, invalid: 'error.invalid-response.draft' },
  vcs: { path: '/vcs', failure: { code: 'vcs-failed', key: 'error.vcs-failed' }, invalid: 'error.invalid-response.vcs' },
  vcsBase: { path: '/vcs-base', failure: { code: 'vcs-failed', key: 'error.vcs-failed' }, invalid: 'error.invalid-response.vcs' },
  tokenStats: { path: '/token-stats', failure: { code: 'token-stats-failed', key: 'error.token-stats-failed' }, invalid: 'error.invalid-response.token-stats' },
  collections: { path: '/collections', invalid: 'error.run-failed' },
  run: { path: '/run', invalid: 'error.run-failed' },
  runPlan: { path: '/run/plan', invalid: 'error.run-failed' },
  runStatus: { path: '/run/status', invalid: 'error.run-failed' },
  runStop: { path: '/run/stop', invalid: 'error.run-failed' },
  runPolicy: { path: '/run/policy', invalid: 'error.run-failed' },
  runInterpreters: { path: '/run/interpreters', invalid: 'error.run-failed' },
  runProbe: { path: '/run/probe', invalid: 'error.run-failed' },
  updateCheck: { path: '/update/check', failure: { code: 'update-failed', key: 'error.update-failed' }, invalid: 'error.invalid-response.update' },
  updateInstalled: { path: '/update/installed', failure: { code: 'update-failed', key: 'error.update-failed' }, invalid: 'error.invalid-response.update' },
  updateDownload: { path: '/update/download', failure: { code: 'update-download-failed', key: 'error.update-download-failed' }, invalid: 'error.invalid-response.update' },
  mindmapDoc: { path: '/mindmap-doc', invalid: 'error.invalid-response.mindmap' },
  mindmapIndex: { path: '/mindmap-doc/index', invalid: 'error.invalid-response.mindmap' },
  mindmapSync: { path: '/mindmap-doc/sync', invalid: 'error.invalid-response.mindmap' },
  mindmapRename: { path: '/mindmap-doc/rename', invalid: 'error.invalid-response.mindmap' },
  mindmapModels: { path: '/mindmap-doc/models', invalid: 'error.invalid-response.mindmap' },
  mindmapRegenerate: { path: '/mindmap-doc/regenerate-summary', invalid: 'error.invalid-response.mindmap' },
  mindmapRegenerateAll: { path: '/mindmap-doc/regenerate-all', invalid: 'error.invalid-response.mindmap' },
  mindmapRegenerateSessions: { path: '/mindmap-doc/regenerate-session-summaries', invalid: 'error.invalid-response.mindmap' },
  mindmapSummarize: { path: '/mindmap-doc/summarize-session', invalid: 'error.invalid-response.mindmap' },
  mindmapForkCleanup: { path: '/mindmap-doc/fork-cleanup', invalid: 'error.invalid-response.mindmap' },
})

const DEFAULT_FAILURE = Object.freeze({ code: 'request-failed', key: 'error.request-failed' })
/* The mind-map endpoints that run a synchronous LLM call on the Host and therefore need the long timeout. */
const MINDMAP_LLM_ROUTES = new Set([ROUTES.mindmapRegenerate.path, ROUTES.mindmapRegenerateAll.path, ROUTES.mindmapSummarize.path])

function withTimeout(signal, timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(timeoutMs)
    if (signal === undefined || signal === null) return timeout
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  }
  return signal
}

/** Query string of a route: a URLSearchParams instance is used as-is, a plain object is encoded with
 *  undefined/null entries dropped (so a caller can pass optional coordinates directly). */
function queryString(query) {
  if (query === undefined || query === null) return ''
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]),
  )
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

/**
 * The one request path every endpoint uses.
 * @param route - one ROUTES entry.
 * @param options.method - HTTP verb (default GET).
 * @param options.query - URLSearchParams or plain object.
 * @param options.body - a JSON-serializable value, a string (sent verbatim with `contentType`), or raw bytes.
 * @param options.contentType - override for a string/byte body.
 * @param options.headers - extra request headers (e.g. the save route's If-Match).
 * @param options.keepalive - let the browser complete the request while the document goes away
 *   (the page-hide draft flush); the body budget is small, so only the draft envelope uses it.
 * @param options.timeoutMs - bounded request timeout (default REQUEST_TIMEOUT_MS).
 * @param options.signal - caller abort signal.
 * @param options.decode - maps the parsed payload to the value the caller wants; returning undefined
 *   rejects the response as malformed. Receives the HTTP status so the error can name it.
 */
async function request(route, options = {}) {
  const { method = 'GET', query, body, contentType, headers: extraHeaders, keepalive = false, timeoutMs = REQUEST_TIMEOUT_MS, signal, decode } = options
  const headers = { accept: 'application/json', ...extraHeaders }
  let payloadBody
  if (body !== undefined) {
    if (typeof body === 'string') {
      headers['content-type'] = contentType ?? 'text/plain; charset=utf-8'
      payloadBody = body
    } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      headers['content-type'] = contentType ?? 'application/octet-stream'
      payloadBody = body
    } else {
      headers['content-type'] = 'application/json'
      payloadBody = JSON.stringify(body)
    }
  }
  /* `absolute` routes are document-relative URLs of OTHER packages (the harness's own api/… reads). */
  const url = route.absolute === true ? route.path : `${API_PREFIX}${route.path}${queryString(query)}`
  const response = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    signal: withTimeout(signal, timeoutMs),
    body: payloadBody,
    ...(keepalive ? { keepalive: true } : {}),
  })
  if (!response.ok) {
    const failure = route.failure ?? DEFAULT_FAILURE
    throw await responseFailure(response, failure.code, failure.key)
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw invalidResponse(route, response.status)
  }
  if (decode === undefined) return payload
  const value = decode(payload, response.status)
  if (value === undefined) throw invalidResponse(route, response.status)
  return value
}

function invalidResponse(route, status) {
  return new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, route.invalid ?? 'error.invalid-response.file', { status }), status)
}

/* Fetch the server's authoritative encoding list once; keep the fallback if the request fails. */
let encodingCache = ENCODING_FALLBACK
export async function fetchEncodings() {
  try {
    const list = await request(ROUTES.encodings, {
      decode: (payload) => (Array.isArray(payload?.encodings)
        ? payload.encodings.filter(encoding => typeof encoding?.id === 'string' && typeof encoding?.label === 'string')
        : undefined),
    })
    if (list.length > 0) encodingCache = list
  } catch {
    // keep the built-in fallback
  }
  return encodingCache
}
export function encodingLabel(id) {
  const localized = translate(`encoding.${id}`)
  if (localized !== `encoding.${id}`) return localized
  const found = encodingCache.find(encoding => encoding.id === id)
  if (found !== undefined) return found.label
  return ENCODING_LABEL_FALLBACK[id] ?? String(id ?? '')
}

/* Localize a plugin-API error: zh keeps the server message verbatim; en maps known error codes through the dictionary, falling back to the server message or the wrapper key. */
export function apiErrorMessage(code, serverMessage, fallbackKey, params) {
  if (localeIsZh() && typeof serverMessage === 'string' && serverMessage !== '') return serverMessage
  if (code !== undefined) {
    const localized = translate(`error.${code}`)
    if (localized !== `error.${code}`) return localized
  }
  if (typeof serverMessage === 'string' && serverMessage !== '') return serverMessage
  return translate(fallbackKey, params)
}

export class WorkspaceApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'WorkspaceApiError'
    this.code = code
    this.status = status
  }
}
/* Build the error of a failed JSON response; unexpected 500s carry the Host's internal `detail` so a state-dependent failure is diagnosable. */
function apiFailure(failure, fallbackCode, fallbackKey, status) {
  const code = typeof failure?.code === 'string' ? failure.code : fallbackCode
  const message = apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, fallbackKey, { status })
  const detail = typeof failure?.detail === 'string' && failure.detail !== '' ? failure.detail : undefined
  const error = new WorkspaceApiError(code, detail === undefined ? message : `${message}: ${detail}`, status)
  if (detail !== undefined) error.detail = detail
  /* Structured payload (e.g. { currentGeneration } on a draft conflict) rides along so callers can recover without parsing prose. */
  if (failure?.data !== undefined && failure.data !== null) error.data = failure.data
  return error
}
/* Build the failure of a NON-2xx response whose body may not be JSON: the endpoint's fallback code carries the status so callers still get a sane code + message. */
async function responseFailure(response, fallbackCode, fallbackKey) {
  let failure
  try {
    failure = await response.json()
  } catch {
    failure = undefined
  }
  return apiFailure(failure?.error, fallbackCode, fallbackKey, response.status)
}

/* The two read endpoints behind the explorer, reachable through the generic `requestJson` below:
   naming them here keeps the dynamic lookup bounded to this explicit map instead of an arbitrary key. */
const READ_ROUTES = Object.freeze({ tree: ROUTES.tree, file: ROUTES.file })

/* One workspace file's tree listing or text preview.
   A 200 body that breaks the contract is a Host anomaly, not a render-time crash. */
export function requestJson(endpoint, workspaceId, path, signal, encoding) {
  return request(READ_ROUTES[endpoint], {
    query: { workspaceId, path, encoding: encoding === undefined || encoding === null ? undefined : encoding },
    signal,
    decode: (payload) => {
      if (endpoint === 'tree') return Array.isArray(payload?.entries) ? payload : undefined
      return typeof payload?.content === 'string' ? payload : undefined
    },
  })
}
/* Read one JSON route that is NOT part of this plugin's API — the harness's own `api/changes.*` reads
   behind the change-review tab. The URL is taken verbatim (document-relative, so it stays inside the
   connection's own authentication fence) while every transport rule of `request` still applies; a
   failure rejects with a normalized WorkspaceApiError whose `status` lets the caller tell a 404 from a
   real error instead of inventing a second fetch path. */
export function readHarnessJson(relativeUrl, signal) {
  return request({ path: relativeUrl, absolute: true, invalid: 'error.invalid-response.file' }, { signal })
}
/* The URL of a workspace file's raw bytes for the "open in new window" tab action: a same-origin navigation the Host serves with a sandbox CSP. */
export function rawFileUrl(workspaceId, path) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  return `${API_PREFIX}${ROUTES.raw.path}?${query}`
}
/* Mint the HTML preview's site token. The returned prefix becomes the preview frame's <base>, so
   every relative URL of the previewed document — images and fonts, CSS url() references, paths a
   page script builds at runtime — is fetched from the token-gated read-only site route inside the
   workspace instead of the GUI's own origin (what a srcdoc document otherwise resolves against).
   Root-relative, like every other API URL of this plugin. */
export function mintPreviewSite(workspaceId, path, signal) {
  return request(ROUTES.siteToken, {
    query: { path, workspaceId: workspaceId === undefined || workspaceId === null || workspaceId === '' ? undefined : workspaceId },
    signal,
    decode: (payload) => (typeof payload?.prefix === 'string' && payload.prefix !== '' ? payload.prefix : undefined),
  })
}
/* Absolute form of a same-document API URL, used only by the new-window action.   A served Web page is same-origin with its Host, so the document-relative URL stays
   untouched (and a mounted deployment keeps working). The Desktop shell serves the page
   from dsh-app://app while the Host listens on a loopback HTTP origin, and its
   window-open handler routes http(s) to the system browser while denying every other
   scheme: only there does the href have to be absolute. The transport global is read
   lazily because the shell sets it before any plugin bundle materializes. */
export function hostAbsoluteHref(relative) {
  const origin = globalThis.__DSH_TRANSPORT__?.streamBaseUrl
  if (typeof origin !== 'string' || origin === '') return relative
  try { return new URL(relative, origin).href } catch { return relative }
}
/* Cheap file-change check for open preview tabs: the Host stats the file and compares mtime/size/hash against the previous snapshot. Returns `changed` plus the new baseline snapshot; null means the file is gone. A null previousSnapshot is sent as an explicit { gone: true } marker so a re-created file reports `changed`. The baseline travels in the BODY (POST) rather than in the query string, so a long-running session with many tabs never builds a giant URL. NOTE: a MISSING file is NOT an error here — the Host answers 200 with { exists: false, snapshot: null }. */
export function checkFileChange(workspaceId, path, previousSnapshot, signal) {
  let previous
  if (previousSnapshot === null) previous = { gone: true }
  else if (previousSnapshot !== undefined) {
    /* The Host's mtime+size fast path is TTL-bounded: carrying the check timestamp lets it force a hash after the TTL so a same-size rewrite with preserved mtime is still detected. */
    previous = {
      mtimeMs: previousSnapshot.mtimeMs,
      size: previousSnapshot.size,
      hash: previousSnapshot.hash,
      checkedAt: previousSnapshot.checkedAt,
    }
  }
  return request(ROUTES.file, { method: 'POST', query: { workspaceId, path, check: '1' }, body: { previous }, signal })
}
/* Version-control status of one workspace (git / svn, read-only). Degradations arrive as a 200 with
   an `error` field inside the payload, so the caller keeps its last good result and only the request
   fence itself can throw; `refresh` bypasses the Host's short payload TTL. */
export function fetchVcsStatus(workspaceId, options, signal) {
  return request(ROUTES.vcs, {
    query: {
      workspaceId,
      refresh: options?.refresh === true ? '1' : undefined,
      ignored: options?.includeIgnored === true ? '1' : undefined,
    },
    timeoutMs: VCS_STATUS_TIMEOUT_MS,
    signal,
    decode: (payload) => (Array.isArray(payload?.entries) ? payload : undefined),
  })
}
/* Base-revision text of one file, for the editor's change gutter. Like /vcs, every degradation (a
   new file, a binary, an oversized file, a missing CLI) rides the payload's `reason` field on a 200;
   only the request fence itself can throw. */
export function fetchVcsBase(workspaceId, path, encoding, signal) {
  return request(ROUTES.vcsBase, {
    query: { workspaceId, path, encoding: encoding === undefined || encoding === null ? undefined : encoding },
    timeoutMs: VCS_STATUS_TIMEOUT_MS,
    signal,
  })
}
export function putFile(workspaceId, path, content, revision, signal, encoding) {
  return request(ROUTES.file, {
    method: 'PUT',
    query: { workspaceId, path, encoding: encoding === undefined || encoding === null ? undefined : encoding },
    body: content,
    contentType: 'text/plain; charset=utf-8',
    headers: revision === undefined || revision === null ? undefined : { 'if-match': String(revision) },
    signal,
  })
}

/* ---- mind-map document API ----
   The 导图 view is backed by a persisted per-root-session document the Host reverse-parses from the
   full session logs; the client only re-syncs and persists structural changes. */
function mindmapRequest(route, options) {
  const { method = 'GET', body, signal, timeoutMs, query } = options ?? {}
  /* The regenerate/summarize endpoints run a synchronous LLM call on the Host, so they get MINDMAP_LLM_TIMEOUT_MS instead of the generic REQUEST_TIMEOUT_MS. The doc read and the sync reconcile the WHOLE family (seconds on large maps) and pass their own explicit timeoutMs. */
  const effectiveTimeout = Number.isFinite(timeoutMs)
    ? timeoutMs
    : (MINDMAP_LLM_ROUTES.has(route.path) ? MINDMAP_LLM_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
  return request(route, { method, body, signal, timeoutMs: effectiveTimeout, query })
}
export const fetchMindmapDoc = (sessionId, signal) => mindmapRequest(ROUTES.mindmapDoc, { query: { sessionId }, timeoutMs: MINDMAP_LOAD_TIMEOUT_MS, signal })
export const writeMindmapDoc = (sessionId, doc, signal, prevSessionId) => mindmapRequest(ROUTES.mindmapDoc, {
  method: 'POST',
  query: { sessionId },
  body: prevSessionId === undefined || prevSessionId === null
    ? { sessionId: String(sessionId), doc }
    : { sessionId: String(sessionId), doc, prevSessionId: String(prevSessionId) },
  signal,
})
export const syncMindmapDoc = (sessionId, liveSessionIds, signal, summaryConfig) => {
  const ids = Array.isArray(liveSessionIds) ? liveSessionIds.map(String) : []
  const body = ids.length > 0
    ? { sessionId: String(sessionId), liveSessionIds: ids }
    : { sessionId: String(sessionId) }
  /* AI-summary config ({ mode:'session' } or { provider, model } + advisory length); absent = feature off. The Host enqueues generation as a side effect of this sync. */
  if (summaryConfig !== null && summaryConfig !== undefined) body.summaryModel = summaryConfig
  return mindmapRequest(ROUTES.mindmapSync, { method: 'POST', body, signal, timeoutMs: MINDMAP_SYNC_TIMEOUT_MS })
}
/* Configured models for the AI-summary picker, cached briefly. */
let mindmapModelsCache = null // { at, payload }
let mindmapModelsRequest = null // in-flight promise (dedup concurrent opens)
/* The shared request is deliberately not bound to any single caller's signal, so one caller's abort cannot kill the promise every concurrent opener waits on. */
export const fetchMindmapModels = () => {
  if (mindmapModelsCache !== null && mindmapModelsCache.at + MINDMAP_MODELS_CACHE_MS > Date.now()) {
    return Promise.resolve(mindmapModelsCache.payload)
  }
  if (mindmapModelsRequest !== null) return mindmapModelsRequest
  mindmapModelsRequest = mindmapRequest(ROUTES.mindmapModels, { method: 'GET' }).then((payload) => {
    /* Stamp the cache when the fetch completes so a slow request does not shorten the 60 s window. */
    mindmapModelsCache = { at: Date.now(), payload }
    return payload
  }).finally(() => {
    mindmapModelsRequest = null
  })
  return mindmapModelsRequest
}
/* Right-click → 重新生成摘要: the Host runs the LLM call synchronously and persists the new summary; the client applies it optimistically. */
export const regenerateMindmapSummary = (sessionId, seq, config, signal) => mindmapRequest(ROUTES.mindmapRegenerate, {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    seq: Number(seq),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* Toolbar → 重新生成全部摘要: the Host force-enqueues every turn of the doc; the per-card status arrives via the sync response's `summarizing`. */
export const regenerateAllMindmapSummaries = (sessionId, config, signal) => mindmapRequest(ROUTES.mindmapRegenerateAll, {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* Toolbar → 重新生成所有会话总结: the Host parks every session's summary in its pending set (topping up the MISSING card summaries a session summary depends on; existing card summaries are never recalculated) and answers immediately — the per-session status arrives via the sync response's `sessionSummarizing`. Enqueue only, so this is NOT one of the long-timeout LLM endpoints. */
export const regenerateAllSessionSummaries = (sessionId, config, signal) => mindmapRequest(ROUTES.mindmapRegenerateSessions, {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* 右键会话头 → 总结当前会话: the Host summarizes the session from its card summaries only; missing ones are generated first (status 'waiting'). */
export const summarizeMindmapSession = (sessionId, config, signal) => mindmapRequest(ROUTES.mindmapSummarize, {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
export const fetchMindmapDocIndex = signal => mindmapRequest(ROUTES.mindmapIndex, { method: 'GET', signal })
export const deleteMindmapDoc = (sessionId, signal) => mindmapRequest(ROUTES.mindmapDoc, { method: 'DELETE', query: { sessionId }, signal })
/* Rename only the map's own title (doc.rootTitle) on the Host — a targeted update instead of a GET-then-POST round trip that could clobber a concurrent sync. */
export const renameMindmapDoc = (sessionId, title, signal) => mindmapRequest(ROUTES.mindmapRename, {
  method: 'POST',
  body: { sessionId: String(sessionId), title },
  signal,
})
/* A forked branch inherits the source session's durable pending queue: the parent's next submitted
   message enters its inbox BEFORE the turn/start the fork cut extends to, while its claim lands AFTER
   the cut — so the child would claim it ahead of the user's own first input. The Host drops the fresh
   (idle) fork child's pending inbox right after the fork; the caller treats a failure as
   best-effort (the leaked message would then run as the branch's first turn). */
export const clearMindmapForkQueue = (sessionId, signal) => mindmapRequest(ROUTES.mindmapForkCleanup, {
  method: 'POST',
  body: { sessionId: String(sessionId) },
  signal,
})

/* ---- Draft (staging) file access ----
   Editing content lives in a draft file outside the workspace, never in the source file. The draft JSON
   carries { path, encoding, lineEnding, bom, baseText, baseRevision, draft, owner, generation } so a
   refresh restores the whole session without localStorage; the Host's generation fence rejects stale writes. */
export function readDraft(workspaceId, path, signal, owner) {
  return request(ROUTES.draft, { query: { workspaceId, path, owner: owner === undefined || owner === null ? undefined : owner }, signal })
}
export function writeDraft(workspaceId, path, payload, signal, options) {
  return request(ROUTES.draft, {
    method: 'PUT',
    query: {
      workspaceId,
      path,
      owner: payload.owner === undefined || payload.owner === null ? undefined : payload.owner,
      generation: payload.generation === undefined || payload.generation === null ? undefined : payload.generation,
    },
    body: { ...payload, path },
    signal,
    /* The page-hide flush asks for `keepalive`, whose tiny body budget the draft envelope fits. */
    keepalive: options?.keepalive === true,
  })
}
export function deleteDraft(workspaceId, path, signal, owner, generation) {
  return request(ROUTES.draft, {
    method: 'DELETE',
    query: {
      workspaceId,
      path,
      owner: owner === undefined || owner === null ? undefined : owner,
      generation: generation === undefined || generation === null ? undefined : generation,
    },
    signal,
  })
}
export function requestDraftTree(workspaceId, payload, signal) {
  return request(ROUTES.draftTree, { method: 'POST', query: { workspaceId }, body: payload, signal })
}

export function uploadExternalFile(bytes, name, signal, encoding) {
  return request(ROUTES.externalFile, {
    method: 'POST',
    query: {
      name: typeof name === 'string' && name !== '' ? name : undefined,
      encoding: encoding === undefined || encoding === null ? undefined : encoding,
    },
    body: bytes,
    contentType: 'application/octet-stream',
    signal,
  })
}
export function renderContext(sessionId, context, signal) {
  return request(ROUTES.context, {
    method: 'POST',
    body: { ...context, sessionId: String(sessionId) },
    signal,
    decode: (payload, status) => {
      if (typeof payload?.text !== 'string') {
        throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context-text'), status)
      }
      return payload.text
    },
  })
}
function mutateEntry(method, workspaceId, path, payload, signal) {
  return request(ROUTES.entry, { method, query: { workspaceId, path }, body: payload, signal })
}
export const createWorkspaceEntry = (workspaceId, path, kind, name, signal) => mutateEntry('POST', workspaceId, path, { kind, name }, signal)
export const renameWorkspaceEntry = (workspaceId, path, name, signal) => mutateEntry('PATCH', workspaceId, path, { name }, signal)
export function requestSearch(workspaceId, query, caseSensitive, nameOnly, signal) {
  return request(ROUTES.search, {
    query: { workspaceId, q: query, caseSensitive: caseSensitive ? 'true' : 'false', nameOnly: nameOnly ? 'true' : 'false' },
    signal,
  })
}
export function revealInExplorer(workspaceId, path, signal) {
  return request(ROUTES.reveal, { method: 'POST', query: { workspaceId, path }, signal })
}
/* Hand one workspace file to the operating system's default program (the default browser for .html, the file
   association otherwise). The PAGE cannot do this itself: an http(s) origin may not navigate to file://, and
   the Desktop shell forwards only http(s) to the system browser — so the path travels through the Host and the
   browser ends up with the file's own URL and natively-resolved relative resources. */
export function openFileExternal(workspaceId, path, signal) {
  return request(ROUTES.open, {
    method: 'POST',
    query: { workspaceId, path },
    signal,
    decode: (payload) => (payload?.opened === true ? payload : undefined),
  })
}
/* Plugin self-update: the Host compares the installed version against the GitHub main branch and, on download, swaps its own install directory — the running code stays the old copy until dsh is restarted. force=1 bypasses the Host's check cache. */
export function checkUpdate(signal, force) {
  return request(ROUTES.updateCheck, {
    query: force === true ? { force: '1' } : undefined,
    timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    signal,
    decode: (payload) => (typeof payload?.enabled === 'boolean' ? payload : undefined),
  })
}
/* Locally answered update facts (Host reads the installed package.json, no network): the settings panel calls this on mount so 「当前版本」 is visible before any check, and so the install-mode note can be shown up front. A Host build without this route answers 404 — the caller treats it as «version unknown» and keeps working. */
export function fetchInstalledUpdateInfo(signal) {
  return request(ROUTES.updateInstalled, {
    timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    signal,
    decode: (payload) => (typeof payload?.enabled === 'boolean' ? payload : undefined),
  })
}
export function downloadUpdate(version, signal) {
  return request(ROUTES.updateDownload, { method: 'POST', body: { version }, timeoutMs: UPDATE_DOWNLOAD_TIMEOUT_MS, signal })
}
/* Token usage statistics (设置 → 工作区设置 → Token 统计): from/to are concrete epoch-ms bounds resolved client-side (standard week/month presets or custom dates); archived=false excludes archived sessions on the Host. The first-ever scan walks every session log, so it gets a long timeout. */
export function fetchTokenStats(from, to, archived, signal) {
  return request(ROUTES.tokenStats, {
    query: { from: String(Math.trunc(from)), to: String(Math.trunc(to)), archived: archived === false ? '0' : '1' },
    timeoutMs: TOKEN_STATS_TIMEOUT_MS,
    signal,
  })
}
export function requestFsOperation(workspaceId, payload, signal) {
  return request(ROUTES.fs, { method: 'POST', query: { workspaceId }, body: payload, signal })
}

/* ---- Executable-file runner (see host/run.js for the safety model) ----
   The PLAN describes what would run — resolved interpreter, argv and cwd — computed without executing
   anything, so the console can show the real command before the first click (and say "no interpreter" up
   front instead of failing a run). START/STOP drive one process; STATUS returns the output slice past
   `offset`, which is also how a refreshed page re-attaches to a live run. */
function runRequest(route, options, signal) {
  const { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS, query } = options ?? {}
  return request(route, { method, body, signal, timeoutMs, query })
}
export function fetchRunPlan(workspaceId, path, refresh, signal) {
  return runRequest(ROUTES.runPlan, { query: { workspaceId, path, refresh: refresh === true ? '1' : undefined } }, signal)
}
export function startRunRequest(workspaceId, path, args, signal) {
  return runRequest(ROUTES.run, { method: 'POST', query: { workspaceId, path }, body: { args: String(args ?? '') } }, signal)
}
export function fetchRunStatus(workspaceId, path, offset, runId, signal) {
  return runRequest(ROUTES.runStatus, {
    query: {
      workspaceId,
      path: typeof path === 'string' && path !== '' ? path : undefined,
      runId: typeof runId === 'string' && runId !== '' ? runId : undefined,
      offset: String(Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0),
    },
    timeoutMs: RUN_STATUS_TIMEOUT_MS,
  }, signal)
}
export function stopRunRequest(runId, signal) {
  return runRequest(ROUTES.runStop, { method: 'POST', body: { runId: String(runId) } }, signal)
}
export function fetchRunPolicy(workspaceId, signal) {
  /* Optional: only `trusted` is workspace-scoped, so the settings page reads the global maps
     (per-extension + per-file interpreters) without a workspace context. */
  return runRequest(ROUTES.runPolicy, {
    query: workspaceId === null || workspaceId === undefined || String(workspaceId) === '' ? undefined : { workspaceId: String(workspaceId) },
  }, signal)
}
export function setRunPolicy(workspaceId, payload, signal) {
  return runRequest(ROUTES.runPolicy, {
    method: 'POST',
    query: workspaceId === null || workspaceId === undefined || String(workspaceId) === '' ? undefined : { workspaceId: String(workspaceId) },
    body: payload,
  }, signal)
}
/** The per-extension resolution table behind the settings page (what each suffix resolves to now). */
export function fetchRunInterpreters(refresh, signal) {
  return runRequest(ROUTES.runInterpreters, { query: refresh === true ? { refresh: '1' } : undefined }, signal)
}
/** One-shot `<path> --version` probe: the dialogs' 「测试」 button. Never runs a `.exe`/`.com`. */
export function probeRunInterpreter(path, family, signal) {
  return runRequest(ROUTES.runProbe, {
    method: 'POST',
    body: { path: String(path ?? ''), family: String(family ?? '') },
    timeoutMs: RUN_PROBE_REQUEST_TIMEOUT_MS,
  }, signal)
}
/* Workspace collections: one plugin-level store (no workspaceId — a collection spans workspaces).
   GET answers the whole store; PUT merges one patch into it and answers the merged store, so the
   client never has to rebase a whole-document write. */
export function fetchCollections(signal) {
  return runRequest(ROUTES.collections, { method: 'GET' }, signal)
}
export function patchCollections(patch, signal) {
  return runRequest(ROUTES.collections, { method: 'PUT', body: patch }, signal)
}
