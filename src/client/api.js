import { API_PREFIX, ENCODING_FALLBACK, ENCODING_LABEL_FALLBACK, MINDMAP_MODELS_CACHE_MS } from './constants.js'
import { localeIsZh, translate } from './locale/index.js'

let encodingCache = ENCODING_FALLBACK
/* Fetch the server's authoritative encoding list once; keep the fallback if the request fails. */
export async function fetchEncodings() {
  try {
    const response = await fetch(`${API_PREFIX}/encodings`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' })
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


/* Localize a plugin-API error: zh keeps the server message verbatim; en maps known error codes through the dictionary and falls back to the server message or the wrapper key. */
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
/* Build the error of a failed JSON response; unexpected 500s now carry the
   Host's internal `detail` (added 2026-08) so a state-dependent failure is
   diagnosable from the toast/console instead of a black-box generic message. */
function apiFailure(failure, fallbackCode, fallbackKey, status) {
  const code = typeof failure?.code === 'string' ? failure.code : fallbackCode
  const message = apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, fallbackKey, { status })
  const detail = typeof failure?.detail === 'string' && failure.detail !== '' ? failure.detail : undefined
  const error = new WorkspaceApiError(code, detail === undefined ? message : `${message}: ${detail}`, status)
  if (detail !== undefined) error.detail = detail
  return error
}
export async function requestJson(endpoint, workspaceId, path, signal, encoding) {
  const query = new URLSearchParams({ workspaceId, path })
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const response = await fetch(`${API_PREFIX}/${endpoint}?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, endpoint === 'file' ? 'error.invalid-response.file' : 'error.invalid-response.tree', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'request-failed', 'error.request-failed', response.status)
  }
  return payload
}
/* Cheap file-change check for open preview tabs: the Host stats the file and
   compares mtime/size/hash against the previous snapshot (workspace-confined,
   read-only). Returns `changed` plus the new baseline snapshot; null means the
   file is gone. A null previousSnapshot (the file was deleted and the client
   holds the `null` sentinel) is sent as an explicit { gone: true } marker so
   a RE-CREATED file reports `changed` — without it the Host sees no baseline
   and answers changed:false, and the tab would keep showing stale content. */
export async function checkFileChange(workspaceId, path, previousSnapshot, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path, check: '1' })
  if (previousSnapshot !== undefined && previousSnapshot !== null) {
    query.set('prev', JSON.stringify({
      mtimeMs: previousSnapshot.mtimeMs,
      size: previousSnapshot.size,
      hash: previousSnapshot.hash,
    }))
  } else if (previousSnapshot === null) {
    query.set('prev', JSON.stringify({ gone: true }))
  }
  const response = await fetch(`${API_PREFIX}/file?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.file', { status: response.status }), response.status)
  }
  if (!response.ok) {
    if (payload?.error?.code === 'path-not-found') return { changed: false, exists: false, snapshot: null }
    const failure = payload?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'request-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.request-failed', { status: response.status }), response.status)
  }
  return payload
}
export async function putFile(workspaceId, path, content, revision, signal, encoding) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const headers = { 'content-type': 'text/plain; charset=utf-8', accept: 'application/json' }
  if (revision !== undefined && revision !== null) headers['if-match'] = String(revision)
  const response = await fetch(`${API_PREFIX}/file?${query}`, { method: 'PUT', headers, credentials: 'same-origin', body: content, signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.save', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'save-failed', 'error.save-failed', response.status)
  }
  return payload
}
// Mind-map document API: the 导图 conversation view is backed by a persisted
// per-root-session document (a flat list of session turn-chains + fork branches)
// the Host reverse-parses from the FULL session logs — the single source of
// truth. The client only re-syncs (folding new turns) and persists structural
// changes (forks, branch removal).
export async function mindmapRequest(endpoint, options) {
  const { method = 'GET', body, signal } = options ?? {}
  const response = await fetch(`${API_PREFIX}/mindmap-doc${endpoint}`, {
    method,
    headers: body === undefined
      ? { accept: 'application/json' }
      : { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.mindmap', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'request-failed', 'error.request-failed', response.status)
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
    ? { sessionId: String(sessionId), liveSessionIds: ids, liveSessionId: ids[0] }
    : { sessionId: String(sessionId) }
  /* AI-summary config ({ mode:'session' } or { provider, model } + advisory
     length); absent = feature off. The Host only enqueues generation as a
     side effect of this sync, so no extra endpoint is needed for it. */
  if (summaryConfig !== null && summaryConfig !== undefined) body.summaryModel = summaryConfig
  return mindmapRequest('/sync', {
    method: 'POST',
    body,
    signal,
  })
}
/* Configured models for the AI-summary picker, cached briefly (the catalog
   rarely changes while the settings panel is open). */
let mindmapModelsCache = null // { at, payload }
export const fetchMindmapModels = (signal) => {
  if (mindmapModelsCache !== null && mindmapModelsCache.at + MINDMAP_MODELS_CACHE_MS > Date.now()) {
    return Promise.resolve(mindmapModelsCache.payload)
  }
  return mindmapRequest('/models', { method: 'GET', signal }).then((payload) => {
    /* Stamp the cache when the fetch COMPLETES so a slow request does not
       shorten the 60 s window. */
    mindmapModelsCache = { at: Date.now(), payload }
    return payload
  })
}
/* Right-click → 重新生成摘要: the Host runs the LLM call synchronously and
   persists the new summary into the doc; the client applies it optimistically. */
export const regenerateMindmapSummary = (sessionId, seq, config, signal) => mindmapRequest('/regenerate-summary', {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    seq: Number(seq),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* Toolbar → 重新生成全部摘要: the Host force-enqueues EVERY turn of the doc
   (old summaries are kept until the new ones land); the per-card
   "正在生成摘要中…" status arrives via the sync response's `summarizing`. */
export const regenerateAllMindmapSummaries = (sessionId, config, signal) => mindmapRequest('/regenerate-all', {
  method: 'POST',
  body: {
    sessionId: String(sessionId),
    config: config === null || config === undefined ? null : config,
  },
  signal,
})
/* 右键会话头 → 总结当前会话: the Host summarizes the session from its card
   summaries only; missing card summaries are generated first (status 'waiting'
   — the result arrives via a later sync). */
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
/* Rename only the map's OWN title (doc.rootTitle) on the Host — a targeted
   update instead of a GET-then-POST round trip, which could clobber a turn a
   concurrent sync had just folded in between. */
export const renameMindmapDoc = (sessionId, title, signal) => mindmapRequest('/rename', {
  method: 'POST',
  body: { sessionId: String(sessionId), title },
  signal,
})

// Draft (staging) file access: editing content lives in a draft file outside
// the workspace, never in the source file. The draft JSON carries { path,
// encoding, lineEnding, bom, baseText, baseRevision, draft, owner, generation }
// so a refresh restores the whole session without localStorage; the Host's
// generation fence rejects stale writes from a discarded or previous mount.
export async function readDraft(workspaceId, path, signal, owner) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (owner !== undefined && owner !== null) query.set('owner', String(owner))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'draft-read-failed', 'error.draft-failed', response.status)
  }
  return payload
}
export async function writeDraft(workspaceId, path, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (payload.owner !== undefined && payload.owner !== null) query.set('owner', String(payload.owner))
  if (payload.generation !== undefined && payload.generation !== null) query.set('generation', String(payload.generation))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...payload, path }), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(result?.error, 'draft-write-failed', 'error.draft-failed', response.status)
  }
  return result
}
export async function deleteDraft(workspaceId, path, signal, owner, generation) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  if (owner !== undefined && owner !== null) query.set('owner', String(owner))
  if (generation !== undefined && generation !== null) query.set('generation', String(generation))
  const response = await fetch(`${API_PREFIX}/draft?${query}`, { method: 'DELETE', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(result?.error, 'draft-delete-failed', 'error.draft-failed', response.status)
  }
  return result
}
export async function requestDraftTree(workspaceId, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId) })
  const response = await fetch(`${API_PREFIX}/draft-tree?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.draft', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(result?.error, 'draft-tree-failed', 'error.draft-failed', response.status)
  }
  return result
}

export async function uploadExternalFile(bytes, name, signal, encoding) {
  const query = new URLSearchParams()
  if (typeof name === 'string' && name !== '') query.set('name', name)
  if (encoding !== undefined && encoding !== null) query.set('encoding', String(encoding))
  const response = await fetch(`${API_PREFIX}/external-file?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/octet-stream' }, credentials: 'same-origin', body: bytes, signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.external', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'external-file-failed', 'error.external-file-failed', response.status)
  }
  return payload
}
export async function renderContext(sessionId, context, signal) {
  const response = await fetch(`${API_PREFIX}/context`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...context, sessionId: String(sessionId) }), signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'context-failed', 'error.context-failed', response.status)
  }
  if (typeof payload?.text !== 'string') throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.context-text'), response.status)
  return payload.text
}
export async function mutateEntry(method, workspaceId, path, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/entry?${query}`, { method, headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.entry', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(result?.error, 'entry-failed', 'error.entry-failed', response.status)
  }
  return result
}
export async function requestSearch(workspaceId, query, caseSensitive, nameOnly, signal) {
  const params = new URLSearchParams({ workspaceId: String(workspaceId), q: query, caseSensitive: caseSensitive ? 'true' : 'false', nameOnly: nameOnly ? 'true' : 'false' })
  const response = await fetch(`${API_PREFIX}/search?${params}`, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.search', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'search-failed', 'error.search-failed', response.status)
  }
  return payload
}
export async function revealInExplorer(workspaceId, path, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId), path })
  const response = await fetch(`${API_PREFIX}/reveal?${query}`, { method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin', signal })
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.reveal', { status: response.status }), response.status)
  }
  if (!response.ok) {
    throw apiFailure(payload?.error, 'reveal-failed', 'error.reveal-failed.http', response.status)
  }
  return payload
}
export const createWorkspaceEntry=(workspaceId,path,kind,name,signal)=>mutateEntry('POST',workspaceId,path,{kind,name},signal)
export const renameWorkspaceEntry=(workspaceId,path,name,signal)=>mutateEntry('PATCH',workspaceId,path,{name},signal)
export async function requestFsOperation(workspaceId, payload, signal) {
  const query = new URLSearchParams({ workspaceId: String(workspaceId) })
  const response = await fetch(`${API_PREFIX}/fs?${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal })
  let result
  try {
    result = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new WorkspaceApiError('invalid-response', apiErrorMessage(undefined, undefined, 'error.invalid-response.fs', { status: response.status }), response.status)
  }
  if (!response.ok) {
    const failure = result?.error
    const code = typeof failure?.code === 'string' ? failure.code : 'fs-failed'
    throw new WorkspaceApiError(code, apiErrorMessage(code, typeof failure?.message === 'string' ? failure.message : undefined, 'error.fs-failed', { status: response.status }), response.status)
  }
  return result
}