import { API_PREFIX, ENCODING_FALLBACK, ENCODING_LABEL_FALLBACK, MINDMAP_MODELS_CACHE_MS, TOKEN_STATS_TIMEOUT_MS, UPDATE_CHECK_TIMEOUT_MS, UPDATE_DOWNLOAD_TIMEOUT_MS } from './constants.js'
import { localeIsZh, translate } from './locale/index.js'

/* Bounded request timeouts: a hung Host must not leave the UI in a permanent loading/saving state; merges the caller's signal with a timeout, falling back to the signal alone when the timeout APIs are unavailable. */
const REQUEST_TIMEOUT_MS = 30_000
const MINDMAP_LLM_TIMEOUT_MS = 60_000
function withTimeout(signal, timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(timeoutMs)
    if (signal === undefined || signal === null) return timeout
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  }
  return signal
}

let encodingCache = ENCODING_FALLBACK
/* Fetch the server's authoritative encoding list once; keep the fallback if the request fails. */
export async function fetchEncodings() {
  try {
    const response = await fetch(`${API_PREFIX}/encodings`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(undefined, REQUEST_TIMEOUT_MS) })
    if (!response.ok) return encodingCache
    const payload = await response.json()
    const list = Array.isArray(payload?.encodings)
      ? payload.encodings.filter(encoding => typeof encoding?.id === 'string' && typeof encoding?.label === 'string')
      : []
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
export async function requestJson(endpoint, workspaceId, path, signal, encoding) {
  const query = new URLSearchParams({ workspaceId, path })
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  /* Read requests are timeout-bounded too, so a hung Host cannot leave the explorer loading forever. */
  const response = await fetch(`${API_PREFIX}/${endpoint}?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'request-failed', 'error.request-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, endpoint === 'file' ? 'error.invalid-response.file' : 'error.invalid-response.tree', { status: response.status }), response.status)
  }
  /* Minimal shape assertions: a 200 body missing the payload contract is a Host anomaly, not a render-time crash. */
  if (endpoint === 'tree' && !Array.isArray(payload?.entries)) {
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.tree', { status: response.status }), response.status)
  }
  if (endpoint === 'file' && typeof payload?.content !== 'string') {
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.file', { status: response.status }), response.status)
  }
  return payload
}
/* The URL of a workspace file's raw bytes for the "open in new window" tab action: a same-origin navigation the Host serves with a sandbox CSP. */
export function rawFileUrl(workspaceId, path) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  return `${API_PREFIX}/raw?${query}`
}
/* Cheap file-change check for open preview tabs: the Host stats the file and compares mtime/size/hash against the previous snapshot. Returns `changed` plus the new baseline snapshot; null means the file is gone. A null previousSnapshot is sent as an explicit { gone: true } marker so a re-created file reports `changed`. */
export async function checkFileChange(workspaceId, path, previousSnapshot, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path, check: '1' })
  if (previousSnapshot !== undefined && previousSnapshot !== null) {
    query.set('prev', JSON.stringify({
      mtimeMs: previousSnapshot.mtimeMs,
      size: previousSnapshot.size,
      hash: previousSnapshot.hash,
      /* The Host's mtime+size fast path is TTL-bounded: carrying the check timestamp lets it force a hash after the TTL so a same-size rewrite with preserved mtime is still detected. */
      checkedAt: previousSnapshot.checkedAt,
    }))
  } else if (previousSnapshot === null) {
    query.set('prev', JSON.stringify({ gone: true }))
  }
  const response = await fetch(`${API_PREFIX}/file?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    /* NOTE: a MISSING file is NOT an error here — the Host answers 200 with { exists: false, snapshot: null }. Treating every non-2xx as a real failure keeps the poll honest. */
    throw await responseFailure(response, 'request-failed', 'error.request-failed')
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.file', { status: response.status }), response.status)
  }
  return payload
}
export async function putFile(workspaceId, path, content, revision, signal, encoding) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const headers = { 'content-type': 'text/plain; charset=utf-8', accept: 'application/json' }
  if (revision !== undefined && revision !== null) headers['if-match'] = String(revision)
  const response = await fetch(`${API_PREFIX}/file?${query}`, { method: 'PUT', headers, credentials: 'same-origin', body: content, signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'save-failed', 'error.save-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.save', { status: response.status }), response.status)
  }
  return payload
}
// Mind-map document API: the 导图 view is backed by a persisted per-root-session document the Host reverse-parses from the full session logs; the client only re-syncs and persists structural changes.
export async function mindmapRequest(endpoint, options) {
  const { method = 'GET', body, signal } = options ?? {}
  /* The regenerate/summarize endpoints run a synchronous LLM call on the Host, so give them a longer timeout than the plain doc/sync traffic. */
  const llmEndpoint = endpoint === '/regenerate-summary' || endpoint === '/regenerate-all' || endpoint === '/summarize-session'
  const response = await fetch(`${API_PREFIX}/mindmap-doc${endpoint}`, {
    method,
    headers: body === undefined
      ? { accept: 'application/json' }
      : { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    signal: withTimeout(signal, llmEndpoint ? MINDMAP_LLM_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await responseFailure(response, 'request-failed', 'error.request-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.mindmap', { status: response.status }), response.status)
  }
  return payload
}
export const fetchMindmapDoc = (sessionId, signal) => mindmapRequest(`?sessionId=${encodeURIComponent(String(sessionId))}`, { method: 'GET', signal })
export const writeMindmapDoc = (sessionId, doc, signal, prevSessionId) => mindmapRequest(`?sessionId=${encodeURIComponent(String(sessionId))}`, {
  method: 'POST',
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
  return mindmapRequest('/sync', {
    method: 'POST',
    body,
    signal,
  })
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
  mindmapModelsRequest = mindmapRequest('/models', { method: 'GET' }).then((payload) => {
    /* Stamp the cache when the fetch completes so a slow request does not shorten the 60 s window. */
    mindmapModelsCache = { at: Date.now(), payload }
    return payload
  }).finally(() => {
    mindmapModelsRequest = null
  })
  return mindmapModelsRequest
}
/* Right-click → 重新生成摘要: the Host runs the LLM call synchronously and persists the new summary; the client applies it optimistically. */
export const regenerateMindmapSummary = (sessionId, seq, config, signal) => mindmapRequest('/regenerate-summary', {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    seq: Number(seq),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* Toolbar → 重新生成全部摘要: the Host force-enqueues every turn of the doc; the per-card status arrives via the sync response's `summarizing`. */
export const regenerateAllMindmapSummaries = (sessionId, config, signal) => mindmapRequest('/regenerate-all', {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* 右键会话头 → 总结当前会话: the Host summarizes the session from its card summaries only; missing ones are generated first (status 'waiting'). */
export const summarizeMindmapSession = (sessionId, config, signal) => mindmapRequest('/summarize-session', {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
export const fetchMindmapDocIndex = signal => mindmapRequest('/index', { method: 'GET', signal })
export const deleteMindmapDoc = (sessionId, signal) => mindmapRequest(`?sessionId=${encodeURIComponent(String(sessionId))}`, { method: 'DELETE', signal })
/* Rename only the map's own title (doc.rootTitle) on the Host — a targeted update instead of a GET-then-POST round trip that could clobber a concurrent sync. */
export const renameMindmapDoc = (sessionId, title, signal) => mindmapRequest('/rename', {
  method: 'POST',
  body: { sessionId: String(sessionId), title },
  signal,
})
/* A forked branch inherits the source session's durable pending queue: the
   parent's next submitted message enters its inbox BEFORE the turn/start the
   fork cut extends to, while its claim lands AFTER the cut — so the child
   starts with that message still queued and would claim it ahead of the
   user's own first input. The Host drops the fresh (idle) fork child's
   pending inbox right after the fork; the caller treats a failure as
   best-effort (the leaked message would then run as the branch's first turn). */
export const clearMindmapForkQueue = (sessionId, signal) => mindmapRequest('/fork-cleanup', {
  method: 'POST',
  body: { sessionId: String(sessionId) },
  signal,
})

// Draft (staging) file access: editing content lives in a draft file outside the workspace, never in the source file. The draft JSON carries { path, encoding, lineEnding, bom, baseText, baseRevision, draft, owner, generation } so a refresh restores the whole session without localStorage; the Host's generation fence rejects stale writes.
export async function readDraft(workspaceId, path, signal, owner) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (owner !== undefined && owner !== null) query.set('owner', String(owner))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'draft-read-failed', 'error.draft-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  return payload
}
export async function writeDraft(workspaceId, path, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (payload.owner !== undefined && payload.owner !== null) query.set('owner', String(payload.owner))
  if (payload.generation !== undefined && payload.generation !== null) query.set('generation', String(payload.generation))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...payload, path }), signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'draft-write-failed', 'error.draft-failed')
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  return result
}
export async function deleteDraft(workspaceId, path, signal, owner, generation) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (owner !== undefined && owner !== null) query.set('owner', String(owner))
  if (generation !== undefined && generation !== null) query.set('generation', String(generation))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'DELETE', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'draft-delete-failed', 'error.draft-failed')
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  return result
}
export async function requestDraftTree(workspaceId, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId) })
  const response = await fetch(`${API_PREFIX}/draft-tree?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'draft-tree-failed', 'error.draft-failed')
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  return result
}

export async function uploadExternalFile(bytes, name, signal, encoding) {
  const query = new URLSearchParams()
  if (typeof name === 'string' && name !== '') query.set('name', name)
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const response = await fetch(`${API_PREFIX}/external-file?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/octet-stream' }, credentials: 'same-origin', body: bytes, signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'external-file-failed', 'error.external-file-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.external', { status: response.status }), response.status)
  }
  return payload
}
export async function renderContext(sessionId, context, signal) {
  const response = await fetch(`${API_PREFIX}/context`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...context, sessionId: String(sessionId) }), signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'context-failed', 'error.context-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context', { status: response.status }), response.status)
  }
  if (typeof payload?.text !== 'string') throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context-text'), response.status)
  return payload.text
}
export async function mutateEntry(method, workspaceId, path, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/entry?${query}`, { method, headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'entry-failed', 'error.entry-failed')
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.entry', { status: response.status }), response.status)
  }
  return result
}
export async function requestSearch(workspaceId, query, caseSensitive, nameOnly, signal) {
  const params = new URLSearchParams({ workspaceId: String(workspaceId), q: query, caseSensitive: caseSensitive ? 'true' : 'false', nameOnly: nameOnly ? 'true' : 'false' })
  const response = await fetch(`${API_PREFIX}/search?${params}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'search-failed', 'error.search-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.search', { status: response.status }), response.status)
  }
  return payload
}
export async function revealInExplorer(workspaceId, path, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/reveal?${query}`, { method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'reveal-failed', 'error.reveal-failed.http')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.reveal', { status: response.status }), response.status)
  }
  return payload
}
export const createWorkspaceEntry=(workspaceId,path,kind,name,signal)=>mutateEntry('POST',workspaceId,path,{kind,name},signal)
export const renameWorkspaceEntry=(workspaceId,path,name,signal)=>mutateEntry('PATCH',workspaceId,path,{name},signal)
/* Plugin self-update: the Host compares the installed version against the GitHub main branch and, on download, swaps its own install directory — the running code stays the old copy until dsh is restarted. force=1 bypasses the Host's check cache. */
export async function checkUpdate(signal, force) {
  const query = force === true ? '?force=1' : ''
  const response = await fetch(`${API_PREFIX}/update/check${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, UPDATE_CHECK_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'update-failed', 'error.update-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.update', { status: response.status }), response.status)
  }
  if (typeof payload?.enabled !== 'boolean') {
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.update', { status: response.status }), response.status)
  }
  return payload
}
export async function downloadUpdate(version, signal) {
  const response = await fetch(`${API_PREFIX}/update/download`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ version }), signal: withTimeout(signal, UPDATE_DOWNLOAD_TIMEOUT_MS) })
  /* The download/install failure fallback is its own key, since the generic 'error.update-failed' copy would mislead on a failed download. */
  if (!response.ok) throw await responseFailure(response, 'update-download-failed', 'error.update-download-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.update', { status: response.status }), response.status)
  }
  return payload
}
/* Token usage statistics (设置 → 工作区设置 → Token 统计): from/to are concrete epoch-ms bounds resolved client-side (standard week/month presets or custom dates); archived=false excludes archived sessions on the Host. The first-ever scan walks every session log, so the timeout matches the update download. */
export async function fetchTokenStats(from, to, archived, signal) {
  const params = new URLSearchParams({ from: String(Math.trunc(from)), to: String(Math.trunc(to)), archived: archived === false ? '0' : '1' })
  const response = await fetch(`${API_PREFIX}/token-stats?${params}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal: withTimeout(signal, TOKEN_STATS_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'token-stats-failed', 'error.token-stats-failed')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.token-stats', { status: response.status }), response.status)
  }
  return payload
}
export async function requestFsOperation(workspaceId, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId) })
  const response = await fetch(`${API_PREFIX}/fs?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal: withTimeout(signal, REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw await responseFailure(response, 'fs-failed', 'error.fs-failed')
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.fs', { status: response.status }), response.status)
  }
  return result
}