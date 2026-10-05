/** Plugin entry: Config schema, route dispatch and apply(). */
import z from '@deepseek-ai/schemastery'
import { Buffer } from 'node:buffer'
import { HttpError } from './errors.js'
import { applyCollectionsPatch, readCollectionsStore } from './collections.js'
import { isTrustedRequest, normalizeFailure, readJsonObject, requiredQuery, sendError, sendJson, sendRaw } from './http.js'
import { normalizeRelativePath } from './paths.js'
import { ENCODINGS } from './encodings.js'
import { listTree, openInDefaultApp, readExternalPreview, readPreview, readPreviewHead, readRawFile, revealInExplorer, searchWorkspace } from './fs.js'
import { createEntry, fsOperation, renameEntry, saveFile } from './write.js'
import { deleteDraftFile, draftTreeOperation, parseDraftGenerationQuery, readDraftFile, saveDraftFile, validateDraftOwner, validateDraftPayload } from './drafts.js'
import { adoptMindmapOrphans, buildMindmapDoc, clearForkInheritedQueue, deleteMindmapDoc, findMindmapDocWithAncestors, indexMindmapDocs, isValidMindmapDoc, listMindmapModels, MINDMAP_DOC_MAX_BYTES, mindmapAnchorOf, mindmapDrainPendingSessionSummaries, mindmapInvalidatePersistenceList, mindmapLock, mindmapLockedReanchorOp, mindmapSessionSummarizingOf, mindmapSummarizingOf, parseMindmapSummaryConfig, purgeArchivedMindmapDocs, readMindmapDocFile, refreshMindmapDocCore, regenerateAllMindmapSummaries, regenerateAllSessionSummaries, regenerateMindmapSummary, renameMindmapDoc, seedMindmapSyncCacheAfterLoad, summarizeMindmapSession, syncMindmapDoc, validateMindmapSession, warmMindmapParsedCache, writeMindmapDoc, writeMindmapDocFile } from './mindmap.js'
import { renderPromptContext } from './prompt-context.js'
import { renderMarkdownDocument } from './markdown.js'
import { checkForUpdate, downloadUpdate, installedInfo } from './update.js'
import { computeTokenStats, warmTokenStatsIndex } from './token-stats.js'
import { readVcsBase, readVcsStatus } from './vcs.js'
import { buildRunPlan, clearExecutableCache, describeRunExtensions, probeInterpreter, readRunPolicy, readRunPolicyStore, readRunStatus, startRun, stopAllRuns, stopRun, writeRunPolicy } from './run.js'
import { handleSiteRequest, isSiteRequest, mintPreviewSite } from './site.js'
import { workspaceFor } from './workspace.js'
/** Stable Cordis plugin name. */
export const name = 'workspace-studio'

/** Host services required by the workspace browser route. */
export const inject = ['webServer', 'workspaceRegistry', 'webRuntime', 'sessions']

/** Host-side limits. All bounds are deployment-configurable in cordis.patch.yml. */
export const Config = z.object({
  maxPreviewBytes: z.natural().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  // Upload cap for a dragged-in (non-workspace) file; the preview still truncates to maxPreviewBytes.
  maxExternalUploadBytes: z.natural().min(1024).max(256 * 1024 * 1024).default(8 * 1024 * 1024),
  maxContextBytes: z.natural().min(1024).max(1024 * 1024).default(64 * 1024),
  maxPromptContextBytes: z.natural().min(4096).max(2 * 1024 * 1024).default(68 * 1024),
  maxContextSourceBytes: z.natural().min(1024).max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  enableEditing: z.boolean().default(false),
  maxEditableBytes: z.natural().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  maxEntryNameBytes: z.natural().min(1).max(1024).default(255),
  maxMutationBodyBytes: z.natural().min(128).max(64 * 1024).default(4096),
  searchExcludeDirs: z.array(z.string()).default(['.git', 'node_modules']),
  maxSearchFileBytes: z.natural().min(1024).max(64 * 1024 * 1024).default(1024 * 1024),
  maxSearchFiles: z.natural().min(1).max(10_000).default(10_000),
  maxSearchMatches: z.natural().min(1).max(100_000).default(2000),
  maxMatchesPerFile: z.natural().min(1).max(10_000).default(100),
  searchConcurrency: z.natural().min(1).max(64).default(16),
  maxSearchQueryLength: z.natural().min(1).max(4096).default(1024),
  // Self-update gate: when false the update endpoints refuse and the settings UI hides the group.
  enableUpdateCheck: z.boolean().default(true),
  /* Version-control status display for the file browser: read-only `git status` / `svn status`
     probes. A missing executable or a timeout degrades inside the payload (the UI says so);
     nothing here ever writes to the repository or reaches the network. */
  enableVcsStatus: z.boolean().default(true),
  gitExecutable: z.string().default('git'),
  svnExecutable: z.string().default('svn'),
  vcsTimeoutMs: z.natural().min(1000).max(120_000).default(10_000),
  vcsCacheTtlMs: z.natural().min(0).max(600_000).default(8000),
  vcsMaxEntries: z.natural().min(100).max(50_000).default(5000),
  /* User-created workspace collections (the built-in "all workspaces" view is not counted): a bound
     keeps the dropdown usable, and the Host enforces it as well as the client. */
  maxCollections: z.natural().min(1).max(200).default(50),
  /* Upper bound for ONE preview-site read (site.js): a subresource of a previewed page is often a
     screenshot or a clip, i.e. far larger than a text preview, so it gets its own bound. */
  maxSiteBytes: z.natural().min(1024).max(256 * 1024 * 1024).default(32 * 1024 * 1024),
})

const API_PREFIX = '/workspace-studio/api'
/* THE route table: every endpoint this plugin serves, with the methods it accepts and the handler
   group that owns it. The method list and the 404 decision are read from here and nowhere else, so a
   route can never be reachable-yet-undocumented or documented-yet-unreachable.
   `group` names the two endpoints whose handlers take their own arguments ('run', 'collections');
   every other route is served by the chain below.

   Dispatch convention — ONE rule, applied everywhere:
     - the HTTP method selects the operation on a RESOURCE (read / replace / create / remove), and the
       resource is the path;
     - a TREE-scoped verb that is not resource CRUD (`copy` / `move` / `delete` of a whole subtree)
       travels as `action` in the body of its one endpoint, because the same path may be a file or a
       directory and the operation is a transaction over both;
     - `/collections` PUT is a merge PATCH (`upsert` / `remove` / `order` / `selectedId` fields applied
       in ONE queued step), not a verb dispatch: splitting it into per-field routes would cost the
       atomicity the patch exists to provide.
   A verb never gets a subpath purely to look like the others: two dispatch styles would then exist
   where one does today. */
const ROUTES = Object.freeze({
  [`${API_PREFIX}/context`]: { methods: 'POST' },
  [`${API_PREFIX}/encodings`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/entry`]: { methods: 'POST, PATCH' },
  [`${API_PREFIX}/external-file`]: { methods: 'POST' },
  [`${API_PREFIX}/file`]: { methods: 'GET, HEAD, PUT, POST' },
  [`${API_PREFIX}/raw`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/site-token`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/fs`]: { methods: 'POST' },
  [`${API_PREFIX}/tree`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/search`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/reveal`]: { methods: 'POST' },
  [`${API_PREFIX}/open`]: { methods: 'POST' },
  [`${API_PREFIX}/draft`]: { methods: 'GET, HEAD, PUT, DELETE' },
  [`${API_PREFIX}/draft-tree`]: { methods: 'POST' },
  [`${API_PREFIX}/vcs`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/vcs-base`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/token-stats`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/collections`]: { methods: 'GET, HEAD, PUT', group: 'collections' },
  [`${API_PREFIX}/run`]: { methods: 'POST', group: 'run' },
  [`${API_PREFIX}/run/plan`]: { methods: 'GET, HEAD', group: 'run' },
  [`${API_PREFIX}/run/status`]: { methods: 'GET, HEAD', group: 'run' },
  [`${API_PREFIX}/run/stop`]: { methods: 'POST', group: 'run' },
  [`${API_PREFIX}/run/policy`]: { methods: 'GET, HEAD, POST', group: 'run' },
  /* Interpreter configuration, both ends of it: the settings page's per-extension table and the
     one-shot version probe behind the dialogs' 「测试」 button. */
  [`${API_PREFIX}/run/interpreters`]: { methods: 'GET, HEAD', group: 'run' },
  [`${API_PREFIX}/run/probe`]: { methods: 'POST', group: 'run' },
  [`${API_PREFIX}/update/check`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/update/installed`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/update/download`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc`]: { methods: 'GET, HEAD, POST, DELETE' },
  [`${API_PREFIX}/mindmap-doc/index`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/mindmap-doc/sync`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc/rename`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc/models`]: { methods: 'GET, HEAD' },
  [`${API_PREFIX}/mindmap-doc/regenerate-summary`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc/regenerate-all`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc/regenerate-session-summaries`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc/summarize-session`]: { methods: 'POST' },
  [`${API_PREFIX}/mindmap-doc/fork-cleanup`]: { methods: 'POST' },
})
/* The runner's request body bound: the argument text is capped at 4 KiB by run.js, so the JSON
   envelope only needs a little headroom over the shared mutation cap. */
const RUN_BODY_MAX_BYTES = 16 * 1024
/* 50 collections x 40-char names x up to 2000 workspace ids: the honest bound is a few hundred KiB,
   and the envelope never carries file content. */
const COLLECTIONS_BODY_MAX_BYTES = 512 * 1024

/** Handle one collections request: GET/HEAD answer the store, PUT merges one patch into it. */
async function handleCollectionsRoute(config, url, req, res, writeQueues) {
  if (url.pathname === `${API_PREFIX}/collections`) {
    if (req.method === 'PUT') {
      const payload = await readJsonObject(req, config, COLLECTIONS_BODY_MAX_BYTES)
      sendJson(req, res, 200, await applyCollectionsPatch(payload, writeQueues, config.maxCollections))
      return
    }
    sendJson(req, res, 200, await readCollectionsStore())
    return
  }
}

/** Handle one runner request. Workspace-scoped except the stop verb, which only needs its run id
 *  (a run must stay stoppable even when its workspace entry went away mid-flight). */
async function handleRunRoute(ctx, config, url, req, res, writeQueues) {
  const endpoint = url.pathname
  if (endpoint === `${API_PREFIX}/run/stop`) {
    const payload = await readJsonObject(req, config, RUN_BODY_MAX_BYTES)
    const runId = typeof payload?.runId === 'string' ? payload.runId : ''
    if (runId === '') throw new HttpError(400, 'invalid-run', '停止运行必须提供 runId')
    sendJson(req, res, 200, stopRun(runId))
    return
  }
  /* Version probe and the per-extension resolution table are HOST-wide (an interpreter path is an
     absolute path, not a workspace path), so neither needs a workspace id. */
  if (endpoint === `${API_PREFIX}/run/probe`) {
    const payload = await readJsonObject(req, config, RUN_BODY_MAX_BYTES)
    const target = typeof payload?.path === 'string' ? payload.path : ''
    const family = typeof payload?.family === 'string' ? payload.family : ''
    if (target === '' || family === '') throw new HttpError(400, 'invalid-run', '版本探测必须提供解释器路径与命令类别')
    sendJson(req, res, 200, await probeInterpreter(target, family))
    return
  }
  if (endpoint === `${API_PREFIX}/run/interpreters`) {
    /* refresh=1 mirrors /run/plan: after installing an interpreter, the settings page's 「重新检测」
       button must not be answered from the stale PATH-search cache. */
    if (url.searchParams.get('refresh') === '1') clearExecutableCache()
    const policy = await readRunPolicyStore()
    sendJson(req, res, 200, await describeRunExtensions({ extensions: policy.extensions }))
    return
  }
  /* The policy's GLOBAL maps (per-extension and per-file interpreters) are workspace-independent —
     only `trusted` is per workspace — so a missing workspaceId is legal here (the settings page has
     no workspace context) and only a `trusted` write insists on one. */
  if (endpoint === `${API_PREFIX}/run/policy`) {
    const policyWorkspaceId = url.searchParams.get('workspaceId') ?? ''
    if (req.method === 'POST') {
      const payload = await readJsonObject(req, config, RUN_BODY_MAX_BYTES)
      sendJson(req, res, 200, await writeRunPolicy(policyWorkspaceId, payload, writeQueues))
      return
    }
    sendJson(req, res, 200, await readRunPolicy(policyWorkspaceId))
    return
  }
  /* TWO shapes of one question, handled before the workspace requirement:
     - by `runId` (a page re-attaching to a run it already knows) — the run registry is
       workspace-independent, so this must stay readable after the workspace entry vanished, exactly
       like /run/stop. Requiring a workspaceId here made `/run/status?runId=…` answer 404 for a run
       that was still live and stoppable;
     - by `workspaceId` + `path` (the console asking about its own file). */
  if (endpoint === `${API_PREFIX}/run/status`) {
    const runId = url.searchParams.get('runId') ?? ''
    const pathRaw = url.searchParams.get('path') ?? ''
    if (runId === '' && pathRaw === '') {
      throw new HttpError(400, 'invalid-path', '运行状态查询必须提供 path 或 runId')
    }
    const offsetRaw = Number(url.searchParams.get('offset'))
    const offset = Number.isSafeInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0
    if (runId !== '') {
      sendJson(req, res, 200, readRunStatus({ runId, offset }))
      return
    }
    const statusWorkspaceId = requiredQuery(url, 'workspaceId')
    sendJson(req, res, 200, readRunStatus({
      workspace: workspaceFor(ctx, statusWorkspaceId),
      relativePath: normalizeRelativePath(pathRaw),
      offset,
    }))
    return
  }
  const workspaceId = requiredQuery(url, 'workspaceId')
  const workspace = workspaceFor(ctx, workspaceId)
  const relativePath = normalizeRelativePath(url.searchParams.get('path') ?? '')
  if (relativePath === '') throw new HttpError(400, 'invalid-path', '运行相关请求必须指定文件路径')
  const policy = await readRunPolicyStore()
  if (endpoint === `${API_PREFIX}/run/plan`) {
    /* refresh=1 comes from the console's 重新检测 button: a user who just installed an interpreter
       (or pointed at one) must not be answered from the PATH-search cache. */
    if (url.searchParams.get('refresh') === '1') clearExecutableCache()
    sendJson(req, res, 200, await buildRunPlan(workspace, relativePath, {
      extensions: policy.extensions,
      files: policy.files,
    }))
    return
  }
  const payload = await readJsonObject(req, config, RUN_BODY_MAX_BYTES)
  sendJson(req, res, 200, await startRun(workspace, relativePath, typeof payload?.args === 'string' ? payload.args : ''))
}
/* Shared GET-load refresh: reconcile + adopt under the caller's lock, write back when changed, invalidate the sync cache, and serve the last good disk doc when the refresh degraded (a partial in-memory mutation must never be served or written). */
async function refreshMindmapDocLoad(ctx, persistence, doc) {
  /* An OPEN must start from a FRESH session index: the row revisions behind the
     cold-read fingerprint are cached for 45 s, and a turn that completed while
     this map was closed has to be folded by this very load (otherwise the newest
     card would be missing until the row TTL lapsed). One extra list scan per
     open is far cheaper than the full-family re-read it protects. */
  mindmapInvalidatePersistenceList()
  const refresh = await refreshMindmapDocCore(ctx, persistence, doc)
  let wrote = false
  if (refresh.changed) {
    doc.updatedAt = Date.now()
    /* Same size guard as the sync path: folding turns during an OPEN must not push the doc past MINDMAP_DOC_MAX_BYTES — beyond it every later full-doc client write would 413 and lock the map with no shrink path. Refuse the write and surface the warning; the turns stay in the logs and are re-folded after a prune. */
    const serialized = new TextEncoder().encode(JSON.stringify(doc)).byteLength
    if (serialized > MINDMAP_DOC_MAX_BYTES) {
      refresh.warnings.push(`doc-size-limit: serialized ${serialized} bytes exceeds ${MINDMAP_DOC_MAX_BYTES}`)
      try { ctx.logger.warn(`[workspace-studio] mindmap doc exceeds ${MINDMAP_DOC_MAX_BYTES} bytes; refusing to fold new turns on open (${serialized})`) } catch { /* no logger */ }
    } else {
      try {
        await writeMindmapDocFile(doc)
        wrote = true
      } catch (error) {
        ctx.logger.warn(`[workspace-studio] mindmap doc load write failed: ${String(error)}`)
      }
    }
  }
  /* A degraded reconcile/adopt may have PARTIALLY mutated `doc` in memory; `changed` is false so nothing was written — serve the last good DISK doc instead of the half-reconciled copy. */
  let result = doc
  if (refresh.warnings.length > 0) {
    const disk = await readMindmapDocFile(String(doc.rootSessionId))
    if (disk !== null && isValidMindmapDoc(disk)) result = disk
  }
  /* `refresh` flags ride along so the GET route can seed the sync cache with the same policy the sync settle uses (clean + persisted doc only). `warnings` MUST ride along too: the seed guard requires the array (and rejects non-clean refreshes) — without it the seed silently no-ops on every reopen. */
  return { doc: result, warnings: refresh.warnings, refresh: { changed: refresh.changed, wrote, adoptIncomplete: refresh.adoptIncomplete, warnings: refresh.warnings } }
}
async function handleRequest(ctx, config, trustedHosts, writeQueues, req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  /* The HTML-preview "site" byte route is TOKEN-gated instead of fence-gated (see site.js): the
     preview frame is an opaque origin, so its subresource requests are legitimately `cross-site`
     and the shared fence refuses them by design. Nothing else changes: every other route keeps the
     fence, and this one only ever reads inside the confinement root its token was minted for. */
  if (isSiteRequest(url.pathname, API_PREFIX)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(req, res, 405, 'method-not-allowed', '该接口只允许 GET, HEAD 请求', { allow: 'GET, HEAD' })
      return
    }
    try {
      await handleSiteRequest(req, res, url, API_PREFIX, config)
    } catch (error) {
      const failure = normalizeFailure(error)
      if (failure.status === 500) ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      sendError(req, res, failure.status, failure.code, failure.message, undefined, failure.data)
    }
    return
  }
  if (!isTrustedRequest(req, trustedHosts)) {
    sendError(req, res, 403, 'request-not-trusted', '请求来源未获授权')
    return
  }
  try {
    /* Method whitelist and 404 decision come from THE route table (see ROUTES above). */
    const route = ROUTES[url.pathname]
    if (route === undefined) {
      sendError(req, res, 404, 'endpoint-not-found', '接口不存在')
      return
    }
    if (!route.methods.split(', ').includes(req.method ?? '')) {
      sendError(req, res, 405, 'method-not-allowed', `该接口只允许 ${route.methods} 请求`, { allow: route.methods })
      return
    }
    if (route.group === 'run') {
      await handleRunRoute(ctx, config, url, req, res, writeQueues)
      return
    }
    if (route.group === 'collections') {
      await handleCollectionsRoute(config, url, req, res, writeQueues)
      return
    }
    const contextEndpoint = url.pathname === `${API_PREFIX}/context`
    const encodingsEndpoint = url.pathname === `${API_PREFIX}/encodings`
    const entryEndpoint = url.pathname === `${API_PREFIX}/entry`
    const externalFileEndpoint = url.pathname === `${API_PREFIX}/external-file`
    const fileEndpoint = url.pathname === `${API_PREFIX}/file`
    const rawEndpoint = url.pathname === `${API_PREFIX}/raw`
    const siteTokenEndpoint = url.pathname === `${API_PREFIX}/site-token`
    const fsEndpoint = url.pathname === `${API_PREFIX}/fs`
    const treeEndpoint = url.pathname === `${API_PREFIX}/tree`
    const searchEndpoint = url.pathname === `${API_PREFIX}/search`
    const revealEndpoint = url.pathname === `${API_PREFIX}/reveal`
    const openEndpoint = url.pathname === `${API_PREFIX}/open`
    const draftEndpoint = url.pathname === `${API_PREFIX}/draft`
    const draftTreeEndpoint = url.pathname === `${API_PREFIX}/draft-tree`
    const mindmapDocEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc`
    const mindmapDocIndexEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/index`
    const mindmapDocSyncEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/sync`
    const mindmapDocRenameEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/rename`
    const mindmapDocModelsEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/models`
    const mindmapDocRegenerateEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/regenerate-summary`
    const mindmapDocRegenerateAllEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/regenerate-all`
    const mindmapDocRegenerateSessionSummariesEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/regenerate-session-summaries`
    const mindmapDocSummarizeSessionEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/summarize-session`
    const mindmapForkCleanupEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/fork-cleanup`
    const updateCheckEndpoint = url.pathname === `${API_PREFIX}/update/check`
    const updateInstalledEndpoint = url.pathname === `${API_PREFIX}/update/installed`
    const updateDownloadEndpoint = url.pathname === `${API_PREFIX}/update/download`
    const tokenStatsEndpoint = url.pathname === `${API_PREFIX}/token-stats`
    const vcsEndpoint = url.pathname === `${API_PREFIX}/vcs`
    const vcsBaseEndpoint = url.pathname === `${API_PREFIX}/vcs-base`
    /* Handlers below, in order. Each compares the path it serves; the method whitelist and the 404
       answer were already settled by the ROUTES lookup above. */
    if (contextEndpoint) {
      sendJson(req, res, 200, await renderPromptContext(ctx, config, req))
      return
    }
    if (encodingsEndpoint) {
      sendJson(req, res, 200, { encodings: ENCODINGS.map(({ id, label }) => ({ id, label })) })
      return
    }
    if (externalFileEndpoint) {
      sendJson(req, res, 200, await readExternalPreview(url, config, req))
      return
    }
    if (siteTokenEndpoint) {
      /* Mint the HTML preview's site token. Handled BEFORE the workspaceId requirement because an
         out-of-workspace document is addressed by its absolute path alone. The client injects the
         returned prefix as the preview frame's <base>, so every relative URL of the previewed
         document — including ones a page script builds at runtime, and CSS url() references —
         resolves through the token-gated read route instead of the GUI's own origin. */
      sendJson(req, res, 200, await mintPreviewSite(
        ctx,
        API_PREFIX,
        url.searchParams.get('workspaceId') ?? undefined,
        requiredQuery(url, 'path'),
      ))
      return
    }
    /* Mind-map docs are keyed by session, not workspace, so they are handled before the workspaceId requirement. */
    const persistence = ctx.get('sessionPersistence')
    if (mindmapForkCleanupEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      sendJson(req, res, 200, await clearForkInheritedQueue(ctx, payload?.sessionId))
      return
    }
    if (mindmapDocIndexEndpoint) {
      sendJson(req, res, 200, await indexMindmapDocs(ctx))
      return
    }
    if (mindmapDocSyncEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      /* The live-session selector is the plural `liveSessionIds` (query param or body field); the response's `live` is always an array. */
      const liveRaw = url.searchParams.get('liveSessionIds') ?? payload?.liveSessionIds
      let liveSessionIds
      if (Array.isArray(liveRaw)) {
        liveSessionIds = liveRaw.map(v => validateMindmapSession(v))
      } else if (typeof liveRaw === 'string' && liveRaw !== '') {
        liveSessionIds = liveRaw.split(',').map(v => v.trim()).filter(Boolean).map(v => validateMindmapSession(v))
      } else {
        liveSessionIds = []
      }
      const result = await syncMindmapDoc(ctx, persistence, validateMindmapSession(payload?.sessionId), liveSessionIds, parseMindmapSummaryConfig(payload?.summaryModel))
      if (result === null) {
        sendJson(req, res, 200, { exists: false })
      } else {
        sendJson(req, res, 200, { exists: true, doc: result.doc, live: result.live, warnings: result.warnings, summarizing: result.summarizing, sessionSummarizing: result.sessionSummarizing })
      }
      return
    }
    if (mindmapDocModelsEndpoint) {
      sendJson(req, res, 200, await listMindmapModels(ctx))
      return
    }
    if (mindmapDocRegenerateEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
      const seq = Number(payload?.seq)
      if (!Number.isSafeInteger(seq) || seq <= 0) throw new HttpError(400, 'invalid-seq', '轮次序号无效')
      const summaryConfig = parseMindmapSummaryConfig(payload?.config)
      if (summaryConfig === null) throw new HttpError(400, 'invalid-summary-config', '摘要模型配置无效')
      sendJson(req, res, 200, await regenerateMindmapSummary(ctx, persistence, sessionId, seq, summaryConfig, summaryConfig.length))
      return
    }
    if (mindmapDocRegenerateAllEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
      const summaryConfig = parseMindmapSummaryConfig(payload?.config)
      if (summaryConfig === null) throw new HttpError(400, 'invalid-summary-config', '摘要模型配置无效')
      sendJson(req, res, 200, await regenerateAllMindmapSummaries(ctx, persistence, sessionId, summaryConfig))
      return
    }
    if (mindmapDocRegenerateSessionSummariesEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
      const summaryConfig = parseMindmapSummaryConfig(payload?.config)
      if (summaryConfig === null) throw new HttpError(400, 'invalid-summary-config', '摘要模型配置无效')
      sendJson(req, res, 200, await regenerateAllSessionSummaries(ctx, persistence, sessionId, summaryConfig))
      return
    }
    if (mindmapDocSummarizeSessionEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
      const summaryConfig = parseMindmapSummaryConfig(payload?.config)
      if (summaryConfig === null) throw new HttpError(400, 'invalid-summary-config', '摘要模型配置无效')
      sendJson(req, res, 200, await summarizeMindmapSession(ctx, persistence, sessionId, summaryConfig))
      return
    }
    if (mindmapDocRenameEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
      const rawTitle = payload?.title
      if (typeof rawTitle !== 'string' || rawTitle.trim() === '' || rawTitle.trim().length > 200) {
        throw new HttpError(400, 'invalid-title', '导图标题无效')
      }
      sendJson(req, res, 200, await renameMindmapDoc(ctx, persistence, sessionId, rawTitle.trim()))
      return
    }
    /* Plugin self-update (设置 → 工作区设置 → 插件更新): check compares the installed version against the GitHub main branch; download consumes the cached checked payload and swaps the installed package dir atomically. Plugin-global, so both are handled before the workspaceId requirement. */
    if (updateCheckEndpoint) {
      /* HEAD must not run the check: it would download the main-branch tarball for a request whose body the client never reads. Answer the gate only (sendJson omits the body for HEAD). */
      if (req.method === 'HEAD') {
        sendJson(req, res, 200, { enabled: config.enableUpdateCheck !== false })
        return
      }
      /* force=1 from the explicit 检查更新/重试 buttons: bypass the check cache TTL and re-download the main-branch tarball. */
      sendJson(req, res, 200, await checkForUpdate(ctx, config, url.searchParams.get('force') === '1'))
      return
    }
    if (updateInstalledEndpoint) {
      /* Local read only, so the settings panel can show 「当前版本」 the moment it opens — offline included. Never touches the network or the check cache. */
      sendJson(req, res, 200, await installedInfo(config))
      return
    }
    if (updateDownloadEndpoint) {
      const payload = await readJsonObject(req, config)
      sendJson(req, res, 200, await downloadUpdate(ctx, config, payload))
      return
    }
    /* Token usage statistics (设置 → 工作区设置 → Token 统计): the client resolves every range (standard week/month presets and custom dates) to concrete [from, to) ms in its own timezone and sends them here; the Host filters the aggregated usage index by that window. Plugin-global like the update endpoints, so it is handled before the workspaceId requirement. */
    if (tokenStatsEndpoint) {
      /* HEAD must not scan the session logs (the client never reads the body): answer the availability gate only. */
      if (req.method === 'HEAD') {
        sendJson(req, res, 200, { available: true })
        return
      }
      const fromRaw = url.searchParams.get('from')
      const toRaw = url.searchParams.get('to')
      const from = Number(fromRaw)
      const to = Number(toRaw)
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) {
        throw new HttpError(400, 'invalid-range', '统计时间范围无效')
      }
      const archivedRaw = url.searchParams.get('archived')
      const archived = archivedRaw !== '0' && archivedRaw !== 'false'
      sendJson(req, res, 200, await computeTokenStats(ctx, persistence, { from, to, archived }))
      return
    }
    if (mindmapDocEndpoint) {
      if (req.method === 'DELETE') {
        const sessionId = validateMindmapSession(url.searchParams.get('sessionId'))
        sendJson(req, res, 200, await deleteMindmapDoc(sessionId))
        return
      }
      if (req.method === 'POST') {
        const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
        /* sessionId from the query, falling back to the body (the client sends both). */
        const sessionId = validateMindmapSession(url.searchParams.get('sessionId') ?? payload?.sessionId)
        /* Optional prevSessionId (query or body): a root replacement retires the old root's doc file in the same request. */
        const prevRaw = url.searchParams.get('prevSessionId') ?? payload?.prevSessionId
        const prevSessionId = prevRaw === undefined || prevRaw === null || prevRaw === ''
          ? undefined
          : validateMindmapSession(prevRaw)
        const doc = await writeMindmapDoc(ctx, persistence, sessionId, payload?.doc, prevSessionId)
        sendJson(req, res, 200, { exists: true, doc })
        return
      }
      const sessionId = validateMindmapSession(url.searchParams.get('sessionId'))
      /* Sweep archived maps first: a doc whose root was archived is dead — reopening must not resurrect it. */
      try {
        await purgeArchivedMindmapDocs(ctx)
      } catch (error) {
        /* A sweep failure must never block an open: the map resolves below and the next index poll retries. */
        ctx.logger.warn(`[workspace-studio] mindmap archive sweep failed: ${String(error)}`)
      }
      /* Ancestor-aware: a fork descendant resolves to its ancestor's document (a raced branch write cannot split off as a new root); only a session with NO documented ancestor is converted. */
      const existing = await findMindmapDocWithAncestors(ctx, persistence, sessionId)
      if (existing !== null) {
        /* Fold the latest turns and adopt fork children so a freshly opened map is complete; write back only when something changed (the sidebar order keys on updatedAt). Runs under the per-root lock with a fresh read, so a concurrent sync or client write is never clobbered. The refresh core is fault-isolated: a reconcile/adopt failure degrades to the RECORDED doc instead of a 500, and the next sync retries it. A root replacement between probe and lock re-anchors the retry to the new root. */
        const loaded = await mindmapLockedReanchorOp(
          () => findMindmapDocWithAncestors(ctx, persistence, sessionId),
          () => findMindmapDocWithAncestors(ctx, persistence, sessionId),
          doc => refreshMindmapDocLoad(ctx, persistence, doc),
        )
        if (loaded !== null) {
          /* Reopening the map is also a drain opportunity: a pending session summary that stalled gets another chance here. */
          mindmapDrainPendingSessionSummaries(ctx, persistence)
          /* Seed the sync cache so the first periodic sync after this open is a hit instead of repeating the whole refresh (same settle policy as the sync path). */
          await seedMindmapSyncCacheAfterLoad(ctx, persistence, loaded.doc, loaded.refresh)
          sendJson(req, res, 200, { exists: true, created: false, doc: loaded.doc, warnings: loaded.warnings, summarizing: mindmapSummarizingOf(loaded.doc), sessionSummarizing: mindmapSessionSummarizingOf(loaded.doc) })
          return
        }
      }
      /* First access: serialize the conversion under the ANCHOR root's lock (the root buildMindmapDoc will write, resolved up-front so the lock key and the on-disk root can never disagree). The second lookup closes the two-first-open race; sync/fork writers use the same root key, so this stale build cannot overwrite them. */
      const anchorId = await mindmapAnchorOf(ctx, persistence, sessionId)
      const firstAccess = await mindmapLock(String(anchorId), async () => {
        const concurrent = await findMindmapDocWithAncestors(ctx, persistence, sessionId)
        if (concurrent !== null) return { doc: concurrent, created: false }
        const built = await buildMindmapDoc(ctx, persistence, sessionId)
        if (built === null) return { doc: null, created: false }
        try {
          /* Adoption is fault-isolated here too: a first conversion must not fail as a whole because one orphan's log misbehaved — the doc is still built and written (the next sync retries the adoption). */
          try {
            await adoptMindmapOrphans(ctx, persistence, built)
          } catch (error) {
            ctx.logger.warn(`[workspace-studio] mindmap doc conversion adopt failed: ${String(error)}`)
          }
          built.updatedAt = Date.now()
          await writeMindmapDocFile(built)
        } catch (error) {
          ctx.logger.warn(`[workspace-studio] mindmap doc conversion write failed: ${String(error)}`)
          return { doc: null, created: false }
        }
        return { doc: built, created: true }
      })
      /* First conversion also seeds the sync cache (its doc reached the disk): the 2.5 s sync after a first open must not re-run build+adopt. The conservative adoptIncomplete:true keeps adoptClean false for one cycle so the next sync re-checks orphans the conversion pass may have missed; the `created:false` branch is left unseeded. */
      if (firstAccess.doc !== null && firstAccess.created === true) {
        await seedMindmapSyncCacheAfterLoad(ctx, persistence, firstAccess.doc, { changed: true, wrote: true, adoptIncomplete: true, warnings: [] })
      }
      sendJson(req, res, 200, firstAccess.doc === null
        ? { exists: false }
        : { exists: true, created: firstAccess.created, doc: firstAccess.doc, summarizing: mindmapSummarizingOf(firstAccess.doc), sessionSummarizing: mindmapSessionSummarizingOf(firstAccess.doc) })
      return
    }
    const workspaceId = requiredQuery(url, 'workspaceId')
    const workspace = workspaceFor(ctx, workspaceId)
    if (vcsEndpoint) {
      /* Read-only working-copy status. Degradations (no CLI, timeout, unexpected failure) ride the
         payload's `error` field with a 200, so the client always gets the full shape and can keep
         its last good result on screen; only the request fence above fails with a real HTTP error. */
      sendJson(req, res, 200, await readVcsStatus(workspace, config, {
        includeIgnored: url.searchParams.get('ignored') === '1',
        refresh: url.searchParams.get('refresh') === '1',
      }))
      return
    }
    if (vcsBaseEndpoint) {
      /* Base-revision text of one file, for the editor's change gutter (the client diffs it against
         the live buffer). Degradations (new file, binary, oversized, missing CLI) are `reason` values
         on a 200 payload, never a failed request. */
      const basePath = normalizeRelativePath(url.searchParams.get('path') ?? '')
      if (basePath === '') throw new HttpError(400, 'invalid-path', '基线读取必须指定文件路径')
      sendJson(req, res, 200, await readVcsBase(workspace, basePath, url.searchParams.get('encoding') ?? 'utf-8', config))
      return
    }
    if (draftTreeEndpoint) {
      const payload = await readJsonObject(req, config)
      sendJson(req, res, 200, await draftTreeOperation(workspaceId, payload, config, writeQueues))
      return
    }
    if (searchEndpoint) {
      const query = requiredQuery(url, 'q')
      if (query.includes('\n') || query.includes('\r')
        || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(query)) {
        throw new HttpError(400, 'invalid-query', '搜索内容不能包含换行或控制字符')
      }
      if (query.length > config.maxSearchQueryLength) {
        throw new HttpError(413, 'query-too-long', `搜索内容不能超过 ${config.maxSearchQueryLength} 个字符`)
      }
      const rawCase = url.searchParams.get('caseSensitive')
      const rawNameOnly = url.searchParams.get('nameOnly')
      sendJson(req, res, 200, await searchWorkspace(workspace, query, rawCase === 'true' || rawCase === '1', rawNameOnly === 'true' || rawNameOnly === '1', config))
      return
    }
    const relativePath = normalizeRelativePath(url.searchParams.get('path') ?? '')
    const encodingId = url.searchParams.get('encoding') ?? 'utf-8'
    if (rawEndpoint) {
      /* "Open in new window": serve the file's original bytes with a sandbox CSP so the opened document is a unique origin (scripts run, but it cannot read the GUI's storage or call the API with credentials). Markdown files get a server-rendered HTML document instead, whose CSP drops allow-scripts entirely; errors go out as plain text — the response is a browser tab, not a fetch. */
      try {
        const raw = await readRawFile(workspace, relativePath, config)
        if (raw.isMarkdown) {
          const fileName = relativePath.slice(relativePath.lastIndexOf('/') + 1)
          const document = renderMarkdownDocument(raw.bytes, raw.encodingId, fileName)
          if (document !== null) {
            sendRaw(req, res, 200, document, 'text/html; charset=utf-8', {
              'content-security-policy': 'sandbox allow-popups allow-popups-to-escape-sandbox',
            })
            return
          }
          /* Undecodable as the detected encoding: fall through to the raw bytes. */
        }
        sendRaw(req, res, 200, raw.bytes, `${raw.isHtml ? 'text/html' : 'text/plain'}; charset=${raw.charset}`, {
          'content-security-policy': 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads',
        })
      } catch (error) {
        const failure = normalizeFailure(error)
        const message = failure instanceof HttpError ? failure.message : '无法打开文件'
        sendRaw(req, res, failure.status, Buffer.from(`${message}\n`, 'utf8'), 'text/plain; charset=utf-8')
      }
      return
    }
    if (draftEndpoint) {
      const owner = validateDraftOwner(url.searchParams.get('owner') ?? url.searchParams.get('sessionId') ?? undefined)
      if (owner === undefined) throw new HttpError(400, 'invalid-draft', '暂存请求必须提供 owner')
      const generation = parseDraftGenerationQuery(url.searchParams.get('generation'))
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存读取必须指定文件路径')
        const value = await readDraftFile(workspaceId, relativePath, owner)
        sendJson(req, res, 200, value)
        return
      }
      if (req.method === 'DELETE') {
        if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存删除必须指定文件路径')
        if (generation === undefined) throw new HttpError(400, 'invalid-draft', 'owner 暂存删除必须提供 generation')
        sendJson(req, res, 200, await deleteDraftFile(workspaceId, relativePath, config, writeQueues, owner, generation))
        return
      }
      if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存写入必须指定文件路径')
      const maximum = Math.min(64 * 1024 * 1024, config.maxEditableBytes * 12 + 64 * 1024)
      const body = await readJsonObject(req, config, maximum)
      const payload = validateDraftPayload(body, config, relativePath, owner, generation)
      sendJson(req, res, 200, await saveDraftFile(workspaceId, payload, config, writeQueues))
      return
    }
    if (fsEndpoint) {
      sendJson(req, res, 200, await fsOperation(workspace, config, writeQueues, req))
      return
    }
    if (revealEndpoint) {
      sendJson(req, res, 200, await revealInExplorer(workspace, relativePath))
      return
    }
    if (openEndpoint) {
      /* "Open the file in the browser" (fs.js openInDefaultApp): the Host hands the workspace file to the OS
         default program instead of serving its bytes, so the browser gets the file's OWN path and the page's
         relative resources resolve natively. Markdown keeps the /raw server-rendered document. */
      sendJson(req, res, 200, await openInDefaultApp(workspace, relativePath))
      return
    }
    /* Cheap change check for open preview tabs: the client polls this on a fixed cadence (no SSE push). The previous snapshot is parsed once and passed into fileChangeSnapshot so an unchanged mtime/size short-circuits before the hash, then the returned snapshot is compared for the client's `changed` answer. Scoped to the FILE endpoint's read methods: a stray `check=1` on /tree, /entry or a PUT must never hijack the real operation. */
    /* Cheap change check for open preview tabs: the client polls this on a fixed cadence (no SSE push).
       POST (not GET) so the previous snapshot travels in the body: a JSON blob in a query string was
       both opaque and length-bound, and the polling tab count decides how many of them are in flight.
       The previous snapshot is parsed once and passed into fileChangeSnapshot so an unchanged
       mtime/size short-circuits before the hash, then the returned snapshot is compared for the
       client's `changed` answer. */
    if (fileEndpoint && req.method === 'POST' && url.searchParams.get('check') === '1') {
      if (relativePath === '') throw new HttpError(400, 'invalid-path', '变更检查必须指定文件路径')
      const body = await readJsonObject(req, config)
      const previousInput = body?.previous
      /* Only a plain object may seed fileChangeSnapshot (its fast path reads .mtimeMs/.size/.hash/.gone);
         anything else means "no baseline" = full re-check. */
      const previous = previousInput !== null && typeof previousInput === 'object' && !Array.isArray(previousInput)
        ? previousInput
        : undefined
      const snapshot = await readPreviewHead(workspace, relativePath, config.maxPreviewBytes, previous)
      let changed = false
      if (snapshot !== null && previous !== undefined) {
        /* A { gone: true } baseline means the file was deleted and has now been re-created: report a change so the client reloads instead of keeping the stale content. When the baseline carries a STRING hash, content is the only change signal (a touch -r / rsync -t with identical content must NOT reload the tab). A non-string baseline falls back to mtime/size comparison. */
        changed = previous.gone === true
          || (typeof previous.hash === 'string'
            ? previous.hash !== snapshot.hash
            : previous.mtimeMs !== snapshot.mtimeMs || previous.size !== snapshot.size)
      }
      sendJson(req, res, 200, {
        workspaceId: String(workspace.id),
        path: relativePath,
        changed,
        exists: snapshot !== null,
        snapshot,
      })
      return
    }
    if (entryEndpoint && req.method === 'POST') {
      sendJson(req, res, 200, await createEntry(workspace, relativePath, config, writeQueues, req))
    } else if (entryEndpoint) {
      sendJson(req, res, 200, await renameEntry(workspace, relativePath, config, writeQueues, req))
    } else if (treeEndpoint) {
      sendJson(req, res, 200, await listTree(workspace, relativePath))
    } else if (req.method === 'PUT') {
      sendJson(req, res, 200, await saveFile(workspace, relativePath, config, writeQueues, req, encodingId))
    } else {
      sendJson(req, res, 200, await readPreview(workspace, relativePath, config, encodingId))
    }
  } catch (error) {
    const failure = normalizeFailure(error)
    if (failure.status === 500) ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    if (failure.status === 500) {
      /* Surface the INTERNAL cause only on unexpected failures: a state-dependent 500 (like a mind-map open) becomes diagnosable from the browser console/toast instead of a black-box 工作区操作失败. Expected 4xx error responses keep their shape. */
      sendJson(req, res, 500, {
        error: { code: failure.code, message: failure.message, detail: String(error instanceof Error ? error.message : error) },
      })
      return
    }
    sendError(req, res, failure.status, failure.code, failure.message, undefined, failure.data)
  }
}
/** Register the workspace-confined browser API. */
export function apply(ctx, config) {
  const trustedHosts = [...ctx.webRuntime.trustedHosts]
  const writeQueues = new Map()
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => handleRequest(ctx, config, trustedHosts, writeQueues, req, res),
    }),
    'workspace-studio: workspace API',
  )
  /* Executable-file runner: nothing it spawned may outlive the Host (a plugin teardown, a restart,
     or a dsh shutdown would otherwise leave orphaned build/deploy processes behind). */
  ctx.effect(
    () => () => stopAllRuns(),
    'workspace-studio: run registry teardown',
  )
  /* Token-statistics warm-up: every dsh start rebuilds the usage index in the background (per-session results are cached on disk behind the persistence revision, so only sessions whose logs changed since the last run are re-read); the first panel open then answers from the cache instead of scanning. */
  ctx.effect(
    () => warmTokenStatsIndex(ctx),
    'workspace-studio: token stats warm-up',
  )
  /* Mind-map parse-cache warm-up: the first open of a family would otherwise decode
     its whole log volume (tens of MB, tens of seconds) on the request path; this
     parses the documented families in the background while the user is idle and
     persists the result (mindmap-cache/), so both the first click after a restart
     and later syncs are served from the cache. It backs off the moment a real
     open/sync arrives and is bounded; see warmMindmapParsedCache. */
  ctx.effect(
    () => warmMindmapParsedCache(ctx),
    'workspace-studio: mindmap parse cache warm-up',
  )
}