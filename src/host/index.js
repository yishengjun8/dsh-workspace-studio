/** Plugin entry: Config schema, route dispatch and apply(). */
import z from '@deepseek-ai/schemastery'
import { HttpError } from './errors.js'
import { isTrustedRequest, normalizeFailure, readJsonObject, requiredQuery, sendError, sendJson } from './http.js'
import { normalizeRelativePath } from './paths.js'
import { ENCODINGS } from './encodings.js'
import { listTree, readExternalPreview, readPreview, readPreviewHead, revealInExplorer, searchWorkspace } from './fs.js'
import { createEntry, fsOperation, renameEntry, saveFile } from './write.js'
import { deleteDraftFile, draftTreeOperation, parseDraftGenerationQuery, readDraftFile, saveDraftFile, validateDraftOwner, validateDraftPayload, writeJsonAtomic } from './drafts.js'
import { buildMindmapDoc, deleteMindmapDoc, findMindmapDocWithAncestors, indexMindmapDocs, isValidMindmapDoc, listMindmapModels, MINDMAP_DOC_MAX_BYTES, mindmapDocPath, mindmapDrainPendingSessionSummaries, mindmapLock, mindmapSessionSummarizingOf, mindmapSummarizingOf, mindmapSyncCache, parseMindmapSummaryConfig, purgeArchivedMindmapDocs, readMindmapDocFile, refreshMindmapDocCore, regenerateAllMindmapSummaries, regenerateMindmapSummary, renameMindmapDoc, summarizeMindmapSession, syncMindmapDoc, validateMindmapSession, writeMindmapDoc } from './mindmap.js'
import { renderPromptContext } from './prompt-context.js'
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
})

const API_PREFIX = '/workspace-studio/api'
async function handleRequest(ctx, config, trustedHosts, writeQueues, req, res) {
  if (!isTrustedRequest(req, trustedHosts)) {
    sendError(req, res, 403, 'request-not-trusted', '请求来源未获授权')
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const contextEndpoint = url.pathname === `${API_PREFIX}/context`
    const encodingsEndpoint = url.pathname === `${API_PREFIX}/encodings`
    const entryEndpoint = url.pathname === `${API_PREFIX}/entry`
    const externalFileEndpoint = url.pathname === `${API_PREFIX}/external-file`
    const fileEndpoint = url.pathname === `${API_PREFIX}/file`
    const fsEndpoint = url.pathname === `${API_PREFIX}/fs`
    const treeEndpoint = url.pathname === `${API_PREFIX}/tree`
    const searchEndpoint = url.pathname === `${API_PREFIX}/search`
    const revealEndpoint = url.pathname === `${API_PREFIX}/reveal`
    const draftEndpoint = url.pathname === `${API_PREFIX}/draft`
    const draftTreeEndpoint = url.pathname === `${API_PREFIX}/draft-tree`
    const mindmapDocEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc`
    const mindmapDocIndexEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/index`
    const mindmapDocSyncEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/sync`
    const mindmapDocRenameEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/rename`
    const mindmapDocModelsEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/models`
    const mindmapDocRegenerateEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/regenerate-summary`
    const mindmapDocRegenerateAllEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/regenerate-all`
    const mindmapDocSummarizeSessionEndpoint = url.pathname === `${API_PREFIX}/mindmap-doc/summarize-session`
    const allowed = contextEndpoint
      ? 'POST'
      : encodingsEndpoint
        ? 'GET, HEAD'
        : entryEndpoint
          ? 'POST, PATCH'
          : externalFileEndpoint
            ? 'POST'
            : fileEndpoint
              ? 'GET, HEAD, PUT'
              : fsEndpoint
                ? 'POST'
                : treeEndpoint
                  ? 'GET, HEAD'
                  : searchEndpoint
                    ? 'GET, HEAD'
                    : revealEndpoint
                      ? 'POST'
                      : draftTreeEndpoint
                        ? 'POST'
                        : mindmapDocIndexEndpoint
                            ? 'GET, HEAD'
                            : mindmapDocSyncEndpoint
                              ? 'POST'
                              : mindmapDocRenameEndpoint
                                ? 'POST'
                                : mindmapDocModelsEndpoint
                                  ? 'GET, HEAD'
                                  : mindmapDocRegenerateEndpoint
                                    ? 'POST'
                                    : mindmapDocRegenerateAllEndpoint
                                      ? 'POST'
                                      : mindmapDocSummarizeSessionEndpoint
                                        ? 'POST'
                                        : mindmapDocEndpoint
                                          ? 'GET, HEAD, POST, DELETE'
                                          : draftEndpoint
                                            ? 'GET, HEAD, PUT, DELETE'
                                            : undefined
    if (allowed !== undefined && !allowed.split(', ').includes(req.method ?? '')) {
      sendError(req, res, 405, 'method-not-allowed', `该接口只允许 ${allowed} 请求`, { allow: allowed })
      return
    }
    if (!contextEndpoint && !encodingsEndpoint && !entryEndpoint && !externalFileEndpoint && !fileEndpoint && !fsEndpoint && !treeEndpoint && !searchEndpoint && !revealEndpoint && !draftEndpoint && !draftTreeEndpoint && !mindmapDocEndpoint && !mindmapDocIndexEndpoint && !mindmapDocSyncEndpoint && !mindmapDocRenameEndpoint && !mindmapDocModelsEndpoint && !mindmapDocRegenerateEndpoint && !mindmapDocRegenerateAllEndpoint && !mindmapDocSummarizeSessionEndpoint) {
      sendError(req, res, 404, 'endpoint-not-found', '接口不存在')
      return
    }
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
    /* Mind-map docs are keyed by session, not workspace, so they are handled before the workspaceId requirement. */
    const persistence = ctx.get('sessionPersistence')
    if (mindmapDocIndexEndpoint) {
      sendJson(req, res, 200, await indexMindmapDocs(ctx))
      return
    }
    if (mindmapDocSyncEndpoint) {
      const payload = await readJsonObject(req, config, MINDMAP_DOC_MAX_BYTES)
      /* Prefer the plural selector, keeping the singular field for rolling
         upgrades (legacy callers get one live object, new callers an array). */
      const pluralQuery = url.searchParams.get('liveSessionIds')
      const legacyQuery = url.searchParams.get('liveSessionId')
      const pluralRaw = pluralQuery ?? payload?.liveSessionIds
      const legacyRaw = legacyQuery ?? payload?.liveSessionId
      const hasPlural = pluralQuery !== null || pluralRaw !== undefined && pluralRaw !== null
      const legacyResponse = !hasPlural && (legacyQuery !== null || legacyRaw !== undefined && legacyRaw !== null)
      let liveSessionIds
      const liveRaw = hasPlural ? pluralRaw : legacyRaw
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
        const live = legacyResponse ? (result.live[0] ?? null) : result.live
        sendJson(req, res, 200, { exists: true, doc: result.doc, live, summarizing: result.summarizing, sessionSummarizing: result.sessionSummarizing })
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
      /* Sweep archived maps first: a doc whose root was archived (by any UI path) is dead — reopening must not resurrect it. */
      try {
        await purgeArchivedMindmapDocs(ctx)
      } catch (error) {
        /* A sweep failure (locked file, transient fs) must never block an
           open: the map resolves below and the next index poll retries. */
        ctx.logger.warn(`[workspace-studio] mindmap archive sweep failed: ${String(error)}`)
      }
      /* Ancestor-aware: a fork descendant resolves to its ancestor's document
         (a raced branch write cannot split off as a new root); only a session
         with NO documented ancestor is converted. */
      const existing = await findMindmapDocWithAncestors(ctx, persistence, sessionId)
      if (existing !== null) {
        /* Fold the latest turns and adopt fork children so a freshly opened map
           is complete; write back only when something changed (the sidebar
           order keys on updatedAt). Runs under the per-root lock with a fresh
           read, so a concurrent sync or client write is never clobbered. The
           refresh core is fault-isolated: a reconcile/adopt failure degrades
           to the RECORDED doc (warnings surfaced to the client) instead of a
           500, and the next sync retries it. */
        const loaded = await mindmapLock(String(existing.rootSessionId), async () => {
          const fresh = await findMindmapDocWithAncestors(ctx, persistence, sessionId)
          if (fresh === null) return null
          const refresh = await refreshMindmapDocCore(ctx, persistence, fresh)
          if (refresh.changed) {
            fresh.updatedAt = Date.now()
            try {
              await writeJsonAtomic(mindmapDocPath(fresh.rootSessionId), fresh)
            } catch (error) {
              ctx.logger.warn(`[workspace-studio] mindmap doc load write failed: ${String(error)}`)
            }
            /* This load path WRITES the doc (adoption or folded turn) without
               touching any log — invalidate the sync cache like every other
               doc write, or the next sync serves the stale pre-adopt doc for
               up to the TTL (an adopted branch briefly vanishing). */
            mindmapSyncCache.delete(String(fresh.rootSessionId))
          }
          /* A degraded reconcile/adopt (warnings) may have PARTIALLY mutated
             `fresh` in memory; `changed` is false so nothing was written —
             serve the last good DISK doc instead of the half-reconciled copy
             (the next sync retries the refresh). */
          let doc = fresh
          if (refresh.warnings.length > 0) {
            const disk = await readMindmapDocFile(String(fresh.rootSessionId))
            if (disk !== null && isValidMindmapDoc(disk)) doc = disk
          }
          return { doc, warnings: refresh.warnings }
        })
        if (loaded !== null) {
          /* Reopening the map is also a drain opportunity: a pending session
             summary that stalled (e.g. its card jobs finished while the map was
             closed) gets another chance here. */
          mindmapDrainPendingSessionSummaries(ctx, persistence)
          sendJson(req, res, 200, { exists: true, created: false, doc: loaded.doc, warnings: loaded.warnings, summarizing: mindmapSummarizingOf(loaded.doc), sessionSummarizing: mindmapSessionSummarizingOf(loaded.doc) })
          return
        }
      }
      /* First access: serialize the conversion under the session's root lock.
         The second lookup closes the two-first-open race; sync/fork writers
         use the same key, so this stale build cannot overwrite them. */
      const firstAccess = await mindmapLock(String(sessionId), async () => {
        const concurrent = await findMindmapDocWithAncestors(ctx, persistence, sessionId)
        if (concurrent !== null) return { doc: concurrent, created: false }
        const built = await buildMindmapDoc(ctx, persistence, sessionId)
        if (built === null) return { doc: null, created: false }
        try {
          /* Adoption is fault-isolated here too: a first conversion must not
             fail as a whole because one orphan's log misbehaved — the doc is
             still built and written (the next sync retries the adoption). */
          try {
            await adoptMindmapOrphans(ctx, persistence, built)
          } catch (error) {
            ctx.logger.warn(`[workspace-studio] mindmap doc conversion adopt failed: ${String(error)}`)
          }
          built.updatedAt = Date.now()
          await writeJsonAtomic(mindmapDocPath(built.rootSessionId), built)
        } catch (error) {
          ctx.logger.warn(`[workspace-studio] mindmap doc conversion write failed: ${String(error)}`)
          return { doc: null, created: false }
        }
        mindmapSyncCache.delete(String(built.rootSessionId))
        return { doc: built, created: true }
      })
      sendJson(req, res, 200, firstAccess.doc === null
        ? { exists: false }
        : { exists: true, created: firstAccess.created, doc: firstAccess.doc, summarizing: mindmapSummarizingOf(firstAccess.doc), sessionSummarizing: mindmapSessionSummarizingOf(firstAccess.doc) })
      return
    }
    const workspaceId = requiredQuery(url, 'workspaceId')
    const workspace = workspaceFor(ctx, workspaceId)
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
    if (draftEndpoint) {
      const owner = validateDraftOwner(url.searchParams.get('owner') ?? url.searchParams.get('sessionId') ?? undefined)
      if (owner === undefined) throw new HttpError(400, 'invalid-draft', '暂存请求必须提供 owner')
      const generation = parseDraftGenerationQuery(url.searchParams.get('generation'))
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存读取必须指定文件路径')
        const value = await readDraftFile(workspaceId, relativePath, owner)
        sendJson(req, res, 200, value ?? { exists: false })
        return
      }
      if (req.method === 'DELETE') {
        if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存删除必须指定文件路径')
        if (generation === undefined) throw new HttpError(400, 'invalid-draft', 'owner 暂存删除必须提供 generation')
        sendJson(req, res, 200, await deleteDraftFile(workspaceId, relativePath, config, writeQueues, owner, generation))
        return
      }
      if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存写入必须指定文件路径')
      const maximum = Math.min(64 * 1024 * 1024, config.maxEditableBytes * 2 + 64 * 1024)
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
    /* Cheap change check for open preview tabs: the client polls this on a
       fixed cadence (no SSE push). The previous snapshot is parsed once and
       passed into fileChangeSnapshot so an unchanged mtime/size short-circuits
       before the hash, then the returned snapshot is compared for the client's
       `changed` answer. Scoped to the FILE endpoint's read methods: a stray
       `check=1` on /tree, /entry or a PUT must never hijack the real operation. */
    if (fileEndpoint && (req.method === 'GET' || req.method === 'HEAD') && url.searchParams.get('check') === '1') {
      if (relativePath === '') throw new HttpError(400, 'invalid-path', '变更检查必须指定文件路径')
      const previousRaw = url.searchParams.get('prev')
      let previous
      if (previousRaw !== null && previousRaw !== '') {
        try {
          const parsed = JSON.parse(previousRaw)
          // Only a plain object may seed fileChangeSnapshot (its fast path reads
          // .mtimeMs/.size/.hash); a malformed prev stays undefined = full re-check.
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed
        } catch { /* malformed prev: treat as unknown (full re-check) */ }
      }
      const snapshot = await readPreviewHead(workspace, relativePath, config.maxPreviewBytes, previous)
      let changed = false
      if (snapshot !== null && previous !== undefined && previous !== null) {
        /* A { gone: true } baseline means the file was deleted and has now been
           re-created: report a change so the client reloads instead of keeping
           the stale content (a plain missing baseline answers changed:false). */
        changed = previous?.gone === true
          || previous?.mtimeMs !== snapshot.mtimeMs
          || previous?.size !== snapshot.size
          || previous?.hash !== snapshot.hash
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
      /* Surface the INTERNAL cause only on unexpected failures: a state-
         dependent 500 (like a mind-map open) becomes diagnosable from the
         browser console/toast instead of a black-box 工作区操作失败. Expected
         4xx error responses keep their shape. */
      sendJson(req, res, 500, {
        error: { code: failure.code, message: failure.message, detail: String(error instanceof Error ? error.message : error) },
      })
      return
    }
    sendError(req, res, failure.status, failure.code, failure.message)
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
}
