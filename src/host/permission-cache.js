/** Durable cache for console-command file permissions.
 *
 *  Everything a user grants (and the per-scope history that explains it) lives in ONE versioned JSON
 *  file next to the runner policy:
 *
 *      ~/.dsh-plugin/dsh-workspace-studio/permissions/cache.json
 *
 *  The file is read in exactly one format. Anything else is quarantined (permissions/.corrupt/) and
 *  replaced with defaults — no "understand the old format" branches, per the persistence rule in
 *  AGENTS.md. Writes go through the shared serialized-write queue and replace the file atomically.
 *
 *  The cache is user data, not a workspace document: uninstalling the plugin does not delete it.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { isPlainObject } from './errors.js'
import { readJsonStrict, writeJsonAtomic } from './drafts.js'
import { quarantineFile } from './quarantine.js'
import { serializeWrite } from './write.js'

export const PERMISSION_CACHE_VERSION = 1
export const PERMISSION_CACHE_SUB_DIR = 'permissions'
export const PERMISSION_CACHE_FILE = 'cache.json'

export const MAX_PERMISSION_SCOPES = 100
export const MAX_PERMISSION_GRANTS = 500
export const MAX_PERMISSION_HISTORY = 50
export const MAX_AI_CACHE_ENTRIES = 500
export const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_PERMISSION_TARGETS = 50
export const DEFAULT_MAX_SCRIPT_DEPTH = 3
export const MAX_SCRIPT_DEPTH = 5
export const AI_PROMPT_VERSION = 1

const OPERATIONS = new Set(['delete', 'modify', 'create', 'move'])
const OUTCOMES = new Set(['allowed', 'allowed-once', 'denied', 'expired', 'blocked'])
const SCOPE_KEY_RE = /^(session|root):[^\u0000-\u001f]{1,200}$/u

export function permissionCachePath() {
  return join(homedir(), '.dsh-plugin', 'dsh-workspace-studio', PERMISSION_CACHE_SUB_DIR, PERMISSION_CACHE_FILE)
}

export function defaultPermissionSettings() {
  return {
    enabled: true,
    scriptAnalysis: true,
    aiAnalysis: true,
    model: null,
    maxDepth: DEFAULT_MAX_SCRIPT_DEPTH,
    aiCache: true,
  }
}

export function emptyPermissionCache() {
  return {
    version: PERMISSION_CACHE_VERSION,
    updatedAt: 0,
    settings: defaultPermissionSettings(),
    scopes: {},
    aiCache: {},
  }
}

function cleanString(value, max) {
  return typeof value === 'string' && value !== '' ? value.slice(0, max) : ''
}

function normalizeSettings(value) {
  const defaults = defaultPermissionSettings()
  if (!isPlainObject(value)) return defaults
  const model = isPlainObject(value.model)
    && typeof value.model.provider === 'string' && value.model.provider !== ''
    && typeof value.model.model === 'string' && value.model.model !== ''
    ? { provider: value.model.provider.slice(0, 200), model: value.model.model.slice(0, 200) }
    : null
  const depth = Number.isSafeInteger(value.maxDepth) ? Math.max(1, Math.min(MAX_SCRIPT_DEPTH, value.maxDepth)) : DEFAULT_MAX_SCRIPT_DEPTH
  return {
    enabled: value.enabled !== false,
    scriptAnalysis: value.scriptAnalysis !== false,
    aiAnalysis: value.aiAnalysis !== false,
    model,
    maxDepth: depth,
    aiCache: value.aiCache !== false,
  }
}

function normalizeGrant(value) {
  if (!isPlainObject(value)) return null
  const path = cleanString(value.path, 4096)
  if (path === '') return null
  const kind = value.kind === 'folder' ? 'folder' : 'file'
  const operations = Array.isArray(value.operations)
    ? [...new Set(value.operations.filter(op => typeof op === 'string' && OPERATIONS.has(op)))]
    : []
  if (operations.length === 0) return null
  const addedAt = Number.isFinite(value.addedAt) && value.addedAt > 0 ? Math.floor(value.addedAt) : 0
  return { path, kind, operations, addedAt }
}

function normalizeHistoryEntry(value) {
  if (!isPlainObject(value)) return null
  const command = cleanString(value.command, 200)
  if (command === '') return null
  const outcome = typeof value.outcome === 'string' && OUTCOMES.has(value.outcome) ? value.outcome : 'denied'
  return {
    id: cleanString(value.id, 80) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tool: cleanString(value.tool, 80) || 'console',
    command,
    cwd: cleanString(value.cwd, 4096),
    outcome,
    at: Number.isFinite(value.at) && value.at > 0 ? Math.floor(value.at) : Date.now(),
    paths: Array.isArray(value.paths) ? value.paths.filter(path => typeof path === 'string' && path !== '').slice(0, MAX_PERMISSION_TARGETS) : [],
  }
}

function normalizeScope(key, value) {
  if (!SCOPE_KEY_RE.test(key) || !isPlainObject(value)) return null
  const kind = key.startsWith('root:') ? 'mindmap' : 'session'
  const rootSessionId = kind === 'mindmap' ? key.slice('root:'.length) : cleanString(value.rootSessionId, 200)
  const sessionId = cleanString(value.sessionId, 200) || rootSessionId
  const grants = []
  const seen = new Set()
  for (const entry of Array.isArray(value.grants) ? value.grants : []) {
    const grant = normalizeGrant(entry)
    if (grant === null) continue
    const dedupe = `${process.platform === 'win32' ? grant.path.toLowerCase() : grant.path}|${grant.kind}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    grants.push(grant)
    if (grants.length >= MAX_PERMISSION_GRANTS) break
  }
  const history = []
  for (const entry of Array.isArray(value.history) ? value.history : []) {
    const row = normalizeHistoryEntry(entry)
    if (row !== null) history.push(row)
    if (history.length >= MAX_PERMISSION_HISTORY) break
  }
  if (grants.length === 0 && history.length === 0) return null
  return {
    kind,
    sessionId,
    rootSessionId: rootSessionId || null,
    title: cleanString(value.title, 300) || null,
    grants,
    history,
    updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt > 0 ? Math.floor(value.updatedAt) : 0,
  }
}

function normalizeTargets(value) {
  if (!Array.isArray(value)) return []
  const targets = []
  for (const entry of value) {
    if (targets.length >= MAX_PERMISSION_TARGETS) break
    if (!isPlainObject(entry)) continue
    const path = cleanString(entry.path, 4096)
    if (path === '') continue
    const operations = Array.isArray(entry.operations)
      ? [...new Set(entry.operations.filter(op => typeof op === 'string' && OPERATIONS.has(op)))]
      : []
    if (operations.length === 0) continue
    targets.push({
      path,
      kind: entry.kind === 'folder' ? 'folder' : 'file',
      operations,
      source: typeof entry.source === 'string' ? entry.source.slice(0, 40) : 'ai',
      confidence: entry.confidence === 'low' ? 'low' : 'high',
    })
  }
  return targets
}

function normalizeAiCache(value, now) {
  const out = {}
  const rows = []
  for (const [key, entry] of Object.entries(isPlainObject(value) ? value : {})) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) continue
    if (!isPlainObject(entry)) continue
    const createdAt = Number.isFinite(entry.createdAt) && entry.createdAt > 0 ? Math.floor(entry.createdAt) : 0
    if (createdAt === 0 || now - createdAt > AI_CACHE_TTL_MS) continue
    const targets = normalizeTargets(entry.targets)
    if (targets.length === 0 && entry.opaque !== true) continue
    rows.push({
      key,
      value: {
        model: cleanString(entry.model, 200),
        promptVersion: Number.isSafeInteger(entry.promptVersion) ? entry.promptVersion : AI_PROMPT_VERSION,
        targets,
        opaque: entry.opaque === true,
        createdAt,
      },
    })
  }
  rows.sort((a, b) => b.value.createdAt - a.value.createdAt)
  for (const row of rows.slice(0, MAX_AI_CACHE_ENTRIES)) out[row.key] = row.value
  return out
}

/**
 * Normalize a stored value into the ONLY cache shape this code reads.
 * @returns {{ok: true, value: object} | {ok: false}}
 */
export function normalizePermissionCache(value, now = Date.now()) {
  if (!isPlainObject(value) || value.version !== PERMISSION_CACHE_VERSION) return { ok: false }
  if (!isPlainObject(value.settings) || !isPlainObject(value.scopes) || !isPlainObject(value.aiCache)) return { ok: false }
  const scopes = {}
  const rows = []
  for (const [key, entry] of Object.entries(value.scopes)) {
    const scope = normalizeScope(key, entry)
    if (scope !== null) rows.push({ key, value: scope })
  }
  rows.sort((a, b) => b.value.updatedAt - a.value.updatedAt)
  for (const row of rows.slice(0, MAX_PERMISSION_SCOPES)) scopes[row.key] = row.value
  return {
    ok: true,
    value: {
      version: PERMISSION_CACHE_VERSION,
      updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt > 0 ? Math.floor(value.updatedAt) : 0,
      settings: normalizeSettings(value.settings),
      scopes,
      aiCache: normalizeAiCache(value.aiCache, now),
    },
  }
}

/**
 * Load the cache. A missing file is the empty default; a file that exists but is not the current
 * format is quarantined (the reader still falls back to defaults). IO errors are rethrown so a
 * transient permission problem is never mistaken for corruption.
 */
export async function readPermissionCache(logger) {
  const target = permissionCachePath()
  const read = await readJsonStrict(target)
  if (read.status === 'missing') return emptyPermissionCache()
  if (read.status !== 'ok') {
    await quarantineFile(target, 'unreadable permission cache', logger)
    return emptyPermissionCache()
  }
  const normalized = normalizePermissionCache(read.value)
  if (!normalized.ok) {
    await quarantineFile(target, 'unsupported permission cache format', logger)
    return emptyPermissionCache()
  }
  return normalized.value
}

/** Atomically persist the cache (serialized per file). The caller owns in-memory state. */
export async function writePermissionCache(value, queues) {
  const normalized = normalizePermissionCache(value)
  if (!normalized.ok) throw new Error('permission cache is not the current format')
  const next = { ...normalized.value, updatedAt: Date.now() }
  await serializeWrite(queues, 'permissions:cache', async () => {
    await writeJsonAtomic(permissionCachePath(), next)
  })
  return next
}
