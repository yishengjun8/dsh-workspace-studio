/** Draft (staging) persistence: per-owner generation fence + tombstones. */
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { HttpError, isPlainObject } from './errors.js'
import { normalizeRelativePath } from './paths.js'
import { encodingById } from './encodings.js'
import { serializeWrite } from './write.js'
/* ---- Draft (staging) file persistence ----
 *
 * Edits to a workspace file are staged in a draft OUTSIDE the workspace
 * (~/.dsh-plugin/dsh-workspace-studio/drafts/<workspaceId>/); the source file
 * stays untouched until an explicit save, and refreshing re-reads the draft.
 * The draft JSON carries the edit plus the base snapshot (text + revision)
 * from when editing began, so restore and the save-time three-way merge need
 * no other storage.
 */

export const DRAFT_DIR_NAME = 'dsh-workspace-studio'
const DRAFT_SUB_DIR = 'drafts'
/* Live-draft count cap per owner: each file is already bounded by
   maxEditableBytes, but the COUNT has no other bound — a runaway client could
   otherwise fill the user's disk with draft files (see saveDraftFile). */
const DRAFT_FILES_PER_OWNER_MAX = 200

function draftRoot() {
  return join(homedir(), '.dsh-plugin', DRAFT_DIR_NAME, DRAFT_SUB_DIR)
}

/** Stable file name for a workspace-relative path, path-hash based so no
 * traversal or illegal characters leak into the filesystem. */
function draftFileName(relativePath) {
  return `${createHash('sha256').update(relativePath).digest('hex')}.json`
}

export function draftWorkspacePart(workspaceId) {
  const value = String(workspaceId)
  // Existing ids are UUIDs; hash unusual ones so a future registry cannot turn
  // the draft root into a path join (`.`/`..` pass the allowlist but escape).
  // Windows reserved names and trailing dot/space must ALSO hash: `CON` would
  // make the drafts directory creation fail with EINVAL, and `foo.` aliases
  // `foo` on NTFS — silently merging two workspaces' draft trees.
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== '.' && value !== '..'
    && !/[. ]$/.test(value)
    && !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])$/i.test(value.split('.')[0])
    ? value
    : createHash('sha256').update(value).digest('hex')
}

export function validateDraftOwner(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 256 || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-draft', '暂存 owner 无效')
  }
  return value
}

function draftOwnerPart(owner) {
  return `owner-${createHash('sha256').update(owner).digest('hex')}`
}

function draftWorkspaceDir(workspaceId) {
  return join(draftRoot(), draftWorkspacePart(workspaceId))
}

function draftOwnerDir(workspaceId, owner) {
  return join(draftWorkspaceDir(workspaceId), draftOwnerPart(owner))
}

function draftFilePath(workspaceId, relativePath, owner) {
  return join(draftOwnerDir(workspaceId, owner), draftFileName(relativePath))
}

function draftGenerationPath(workspaceId, owner) {
  return join(draftOwnerDir(workspaceId, owner), '.generation.json')
}

export async function readJsonFileOrNull(target) {
  let raw
  try {
    raw = await readFile(target, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
  try {
    const value = JSON.parse(raw)
    return isPlainObject(value) ? value : null
  } catch {
    // Treat a corrupt draft as absent so the editor never surfaces a half-written file; the next auto-save recreates it.
    return null
  }
}

async function readOwnerGenerationState(workspaceId, owner) {
  const value = await readJsonFileOrNull(draftGenerationPath(workspaceId, owner))
  return {
    generation: Number.isSafeInteger(value?.generation) && value.generation >= 0 ? value.generation : -1,
    operation: typeof value?.operation === 'string' ? value.operation : undefined,
  }
}

async function readOwnerGeneration(workspaceId, owner) {
  return (await readOwnerGenerationState(workspaceId, owner)).generation
}

async function readDraftAtPath(workspaceId, relativePath, owner) {
  const value = await readJsonFileOrNull(draftFilePath(workspaceId, relativePath, owner))
  if (value === null || value.path !== relativePath) return null
  if (owner !== undefined && value.owner !== undefined && value.owner !== owner) return null
  return value
}

export async function readDraftFile(workspaceId, relativePath, owner) {
  const owned = await readDraftAtPath(workspaceId, relativePath, owner)
  const ownerGeneration = await readOwnerGeneration(workspaceId, owner)
  if (owned !== null) {
    if (owned.deleted === true) {
      return { exists: false, owner, generation: owned.generation ?? ownerGeneration, ownerGeneration }
    }
    return { ...owned, exists: true, owner, generation: owned.generation ?? ownerGeneration, ownerGeneration }
  }
  return { exists: false, owner, generation: ownerGeneration, ownerGeneration }
}

/* Generations are monotonic per owner; a sane client advances by 1 per
   operation. A huge jump (2^53-1) would permanently lock the owner fence with
   no recovery API, so cap the absolute value and reject absurd jumps at the
   write sites. */
const DRAFT_GENERATION_MAX = 2 ** 31
const DRAFT_GENERATION_JUMP_MAX = 10000

function parseDraftGeneration(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, 'invalid-draft', '暂存请求必须提供 generation')
    return undefined
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > DRAFT_GENERATION_MAX) {
    throw new HttpError(400, 'invalid-draft', 'generation 无效')
  }
  return value
}

export function parseDraftGenerationQuery(value) {
  if (value === null) return undefined
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new HttpError(400, 'invalid-draft', 'generation 无效')
  return parseDraftGeneration(Number(value))
}

export function validateDraftPayload(payload, config, queryPath, queryOwner, queryGeneration) {
  if (!isPlainObject(payload)) throw new HttpError(400, 'invalid-draft', '暂存请求必须是 JSON 对象')
  const relativePath = normalizeRelativePath(payload.path ?? '')
  if (relativePath === '') throw new HttpError(400, 'invalid-path', '暂存必须指定文件路径')
  if (queryPath !== undefined && queryPath !== '' && relativePath !== queryPath) {
    throw new HttpError(400, 'invalid-draft', '查询路径与暂存 payload 路径不一致')
  }
  const payloadOwner = validateDraftOwner(payload.owner ?? payload.sessionId)
  if (queryOwner !== undefined && payloadOwner !== undefined && queryOwner !== payloadOwner) {
    throw new HttpError(400, 'invalid-draft', '查询 owner 与暂存 payload owner 不一致')
  }
  const owner = queryOwner ?? payloadOwner
  const payloadGeneration = parseDraftGeneration(payload.generation)
  if (queryGeneration !== undefined && payloadGeneration !== undefined && queryGeneration !== payloadGeneration) {
    throw new HttpError(400, 'invalid-draft', '查询 generation 与暂存 payload generation 不一致')
  }
  const generation = payloadGeneration ?? queryGeneration
  if (owner !== undefined && generation === undefined) {
    throw new HttpError(400, 'invalid-draft', 'owner 暂存写入必须提供 generation')
  }
  const text = (value, name) => {
    if (typeof value !== 'string' || value.includes('\0')) throw new HttpError(400, 'invalid-draft', `${name} 无效`)
    if (Buffer.byteLength(value, 'utf8') > config.maxEditableBytes) {
      throw new HttpError(413, 'draft-too-large', `${name} 超过可编辑大小限制`)
    }
    return value
  }
  const draft = text(payload.draft, 'draft')
  const baseText = text(payload.baseText, 'baseText')
  const baseRevision = payload.baseRevision === undefined || payload.baseRevision === null
    ? null
    : typeof payload.baseRevision === 'string' && /^[a-f0-9]{64}$/.test(payload.baseRevision)
      ? payload.baseRevision
      : (() => { throw new HttpError(400, 'invalid-draft', 'baseRevision 无效') })()
  const encoding = payload.encoding === undefined || payload.encoding === null
    ? 'utf-8'
    : encodingById(String(payload.encoding)).id
  return {
    path: relativePath,
    encoding,
    lineEnding: typeof payload.lineEnding === 'string' ? payload.lineEnding : 'none',
    bom: Boolean(payload.bom),
    baseText,
    baseRevision,
    draft,
    ...(owner === undefined ? {} : { owner }),
    ...(generation === undefined ? {} : { generation }),
  }
}

function draftQueueKey(workspaceId, owner) {
  return `draft-owner:${String(workspaceId)}:${draftOwnerPart(owner)}`
}

export async function writeJsonAtomic(target, value) {
  await mkdir(dirname(target), { recursive: true })
  const temp = join(dirname(target), `.${randomBytes(16).toString('hex')}.tmp`)
  let handle
  try {
    handle = await open(temp, 'w')
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    /* fsync before the rename: an OS crash between rename and the next write
       must not leave a zero-length / truncated target (the source save path
       already syncs; the draft/generation/mindmap writers should too). */
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, target)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {})
    await unlink(temp).catch(() => {})
    throw error
  }
}
async function writeOwnerGeneration(workspaceId, owner, generation, operation) {
  if (owner === undefined) return
  await writeJsonAtomic(draftGenerationPath(workspaceId, owner), {
    version: 2,
    owner,
    generation,
    operation,
  })
}

function draftOperationToken(action, value) {
  /* Canonicalize with SORTED keys so the token is independent of the payload's
     key insertion order: a retry that re-serializes the same logical payload
     with a different key order must produce the SAME token (the idempotency
     fence compares tokens), or it would be rejected as a foreign operation. */
  const canonical = (input) => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input)
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`
    const keys = Object.keys(input).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`
  }
  const digest = createHash('sha256').update(canonical(value)).digest('hex')
  return `${action}:${digest}`
}

function draftPayloadEqual(left, right) {
  return left?.path === right?.path
    && left?.encoding === right?.encoding
    && left?.lineEnding === right?.lineEnding
    && Boolean(left?.bom) === Boolean(right?.bom)
    && left?.baseText === right?.baseText
    && left?.baseRevision === right?.baseRevision
    && left?.draft === right?.draft
}

async function ownerCurrentGeneration(workspaceId, owner, relativePath) {
  const ownerState = await readOwnerGenerationState(workspaceId, owner)
  const existing = await readDraftAtPath(workspaceId, relativePath, owner)
  const recordGeneration = Number.isSafeInteger(existing?.generation) ? existing.generation : -1
  return { current: Math.max(ownerState.generation, recordGeneration), existing, ownerState }
}

/** Persist one draft, serialized per owner and guarded by a durable owner generation. */
export async function saveDraftFile(workspaceId, payload, config, queues) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  const owner = payload.owner
  const generation = payload.generation
  return serializeWrite(queues, draftQueueKey(workspaceId, owner), async () => {
    const operation = draftOperationToken('put', payload)
    const snapshot = await ownerCurrentGeneration(workspaceId, owner, payload.path)
    const current = snapshot.current
    const existing = snapshot.existing
    const state = snapshot.ownerState
    /* A generation far above the owner's current value is a corrupt/malicious
       client, not a legitimate advance: reject it so the fence cannot be
       jumped to a value that locks the owner forever. */
    if (generation > current + DRAFT_GENERATION_JUMP_MAX) {
      throw new HttpError(400, 'invalid-draft', 'generation 跳变过大', { currentGeneration: current })
    }
    if (generation < current) throw new HttpError(409, 'draft-generation-conflict', '暂存写入已过期，请重新读取草稿', { currentGeneration: current })
    if (generation === current && current >= 0 && state.operation !== undefined && state.operation !== operation) {
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用', { currentGeneration: current })
    }
    if (generation === current && existing !== null) {
      if (!existing.deleted && draftPayloadEqual(existing, payload)) {
        return { workspaceId: String(workspaceId), path: payload.path, owner, generation, saved: true, idempotent: true }
      }
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用', { currentGeneration: current })
    }
    /* Live-record cap (checked only on GROWTH paths — an overwrite of an
       existing live draft or a same-generation idempotent replay never scans):
       a runaway/malicious client must not be able to fill the user's disk with
       draft files (each file is bounded by maxEditableBytes, the COUNT is the
       unbounded dimension). */
    if (existing === null || existing?.deleted === true) {
      const records = await listDraftRecords(workspaceId, owner)
      const live = records.filter(record => record.value?.deleted !== true).length
      if (live >= DRAFT_FILES_PER_OWNER_MAX) {
        throw new HttpError(413, 'draft-limit', `每个暂存会话的草稿数量不能超过 ${DRAFT_FILES_PER_OWNER_MAX} 个`)
      }
    }
    if (generation > current) await writeOwnerGeneration(workspaceId, owner, generation, operation)
    await writeJsonAtomic(draftFilePath(workspaceId, payload.path, owner), { version: 2, ...payload })
    return { workspaceId: String(workspaceId), path: payload.path, owner, generation, saved: true }
  })
}

/** Delete one draft via a tombstone rather than unlink, so a late PUT for a
 * path without a draft is still rejected by the owner generation fence. */
export async function deleteDraftFile(workspaceId, relativePath, config, queues, owner, generation) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  return serializeWrite(queues, draftQueueKey(workspaceId, owner), async () => {
    const state = await ownerCurrentGeneration(workspaceId, owner, relativePath)
    const operation = draftOperationToken('delete', { path: relativePath })
    if (generation > state.current + DRAFT_GENERATION_JUMP_MAX) {
      throw new HttpError(400, 'invalid-draft', 'generation 跳变过大', { currentGeneration: state.current })
    }
    if (generation < state.current) throw new HttpError(409, 'draft-generation-conflict', '暂存删除已过期，请重新读取草稿', { currentGeneration: state.current })
    if (generation === state.current && state.current >= 0
      && state.ownerState.operation !== undefined && state.ownerState.operation !== operation) {
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用', { currentGeneration: state.current })
    }
    if (generation === state.current && state.existing?.deleted === true) {
      return { workspaceId: String(workspaceId), path: relativePath, owner, generation, deleted: true, idempotent: true }
    }
    if (generation === state.current && state.existing !== null) {
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用', { currentGeneration: state.current })
    }
    if (generation > state.current) await writeOwnerGeneration(workspaceId, owner, generation, operation)
    await writeJsonAtomic(draftFilePath(workspaceId, relativePath, owner), { version: 2, owner, path: relativePath, generation, deleted: true })
    /* Single-file deletes only write tombstones; reclaim expired ones here so
       an owner that only ever deletes single drafts still stays bounded (the
       tree-op path already prunes). */
    const records = await listDraftRecords(workspaceId, owner)
    await pruneDraftTombstones(records, owner)
    return { workspaceId: String(workspaceId), path: relativePath, owner, generation, deleted: true }
  })
}

function draftPathMatches(path, prefix) {
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`)
}

function rewriteDraftPath(path, from, to) {
  if (path === from) return to
  if (from === '') return to === '' ? path : `${to}/${path}`
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
}

async function listDraftRecords(workspaceId, owner) {
  const directory = draftOwnerDir(workspaceId, owner)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
  const records = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === '.generation.json') continue
    const file = join(directory, entry.name)
    const value = await readJsonFileOrNull(file)
    if (value === null || typeof value.path !== 'string' || value.owner !== owner) continue
    try {
      normalizeRelativePath(value.path)
    } catch {
      continue
    }
    records.push({ file, value, owner })
  }
  return records
}

/* Deletes write a tombstone instead of unlinking. The durable generation fence
 * lives in .generation.json (every write/delete/tree op advances it), so a
 * tombstone's only jobs are suppressing restore of a discarded draft and
 * idempotent duplicate deletes. Reclaim tombstones older than the retention
 * window whenever a tree op already holds the full record list, keeping the
 * directory bounded without touching the fence. */
const DRAFT_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
async function pruneDraftTombstones(records, owner) {
  const now = Date.now()
  for (const record of records) {
    if (record.value?.deleted !== true || record.value.owner !== owner) continue
    try {
      const fileStat = await stat(record.file)
      if (now - fileStat.mtimeMs <= DRAFT_TOMBSTONE_RETENTION_MS) continue
      await unlink(record.file)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/* Undo a partial draft tree operation: restore (or remove) every file this
   call wrote, newest first. Each write entry tracks its target's PRIOR content
   (null = the path did not exist), so a rollback restores exactly what was
   there before — a pre-existing tombstone is written back, a freshly written
   file is unlinked. Best-effort: a failed rollback entry is collected, never
   silently thrown away by the caller. */
async function rollbackDraftWrites(writes) {
  const failures = []
  for (let index = writes.length - 1; index >= 0; index -= 1) {
    const { target, prior } = writes[index]
    try {
      if (prior === null || prior === undefined) {
        await unlink(target).catch(error => {
          if (error?.code !== 'ENOENT') throw error
        })
      } else {
        await writeJsonAtomic(target, prior)
      }
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

function draftTombstone(owner, path, generation) {
  return { version: 2, owner, path, generation, deleted: true }
}

/** Move or delete every staged draft below a path, serialized per owner with a
 * generation (tombstones make a late autosave fail even when the path had no
 * draft at the tree op). Both actions are two-phase: every write target is
 * created first (move: all destinations, then all source tombstones; delete:
 * all tombstones), and any mid-flight failure rolls back everything this call
 * wrote — a partial migration can never leave the user's edits split across
 * paths or half-tombstoned. */
export async function draftTreeOperation(workspaceId, payload, config, queues) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (!isPlainObject(payload)) throw new HttpError(400, 'invalid-draft', '暂存树请求必须是 JSON 对象')
  const action = payload.action
  if (action !== 'move' && action !== 'delete') throw new HttpError(400, 'invalid-draft', '暂存树操作无效')
  const owner = validateDraftOwner(payload.owner ?? payload.sessionId)
  if (owner === undefined) throw new HttpError(400, 'invalid-draft', '暂存树操作必须提供 owner')
  const generation = parseDraftGeneration(payload.generation, true)
  const fromPath = normalizeRelativePath(payload.fromPath ?? payload.path ?? '')
  const toPath = action === 'move' ? normalizeRelativePath(payload.toPath ?? '') : undefined
  if (action === 'move') {
    if (fromPath === '' || toPath === '') throw new HttpError(400, 'invalid-path', '暂存移动必须指定源和目标目录')
    if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
      throw new HttpError(400, 'invalid-target', '暂存不能移动到自身或其子目录')
    }
  }
  return serializeWrite(queues, draftQueueKey(workspaceId, owner), async () => {
    const state = await readOwnerGenerationState(workspaceId, owner)
    const operation = draftOperationToken(`tree-${action}`, { fromPath, toPath, owner })
    if (generation > state.generation + DRAFT_GENERATION_JUMP_MAX) {
      throw new HttpError(400, 'invalid-draft', 'generation 跳变过大', { currentGeneration: state.generation })
    }
    if (generation < state.generation) throw new HttpError(409, 'draft-generation-conflict', '暂存树操作已过期，请重新读取草稿', { currentGeneration: state.generation })
    if (generation === state.generation && state.generation >= 0
      && state.operation !== undefined && state.operation !== operation) {
      throw new HttpError(409, 'draft-generation-conflict', '暂存 generation 已被其他操作占用', { currentGeneration: state.generation })
    }
    if (generation > state.generation) await writeOwnerGeneration(workspaceId, owner, generation, operation)
    const records = await listDraftRecords(workspaceId, owner)
    const selected = records.filter(record => record.value.deleted !== true && draftPathMatches(record.value.path, fromPath))
    if (action === 'delete') {
      const writes = []
      try {
        for (const record of selected) {
          writes.push({ target: draftFilePath(workspaceId, record.value.path, owner), prior: record.value })
          await writeJsonAtomic(draftFilePath(workspaceId, record.value.path, owner), draftTombstone(owner, record.value.path, generation))
        }
      } catch (error) {
        const failures = await rollbackDraftWrites(writes)
        if (failures.length > 0) throw new AggregateError([error, ...failures], 'draft tree rollback incomplete')
        throw error
      }
      await pruneDraftTombstones(records, owner)
      return { workspaceId: String(workspaceId), owner, generation, action, path: fromPath, count: selected.length }
    }

    const sourcePaths = new Set(selected.map(record => record.value.path))
    const destinations = selected.map(record => {
      const path = rewriteDraftPath(record.value.path, fromPath, toPath)
      return {
        record,
        path,
        next: { ...record.value, path, version: 2, owner, generation },
        complete: false,
      }
    })
    for (const destination of destinations) {
      const collision = records.find(record => record.value.path === destination.path && !sourcePaths.has(record.value.path) && record.value.deleted !== true)
      if (collision === undefined) continue
      if (draftPayloadEqual(collision.value, destination.next)
        && collision.value.generation === generation) {
        destination.complete = true
        continue
      }
      throw new HttpError(409, 'entry-exists', `目标暂存已存在：${destination.path}`)
    }
    /* Phase 1: write EVERY destination before any source is touched. A failure
       here rolls the written destinations back (the sources are still live, so
       nothing is lost). */
    const destinationWrites = []
    try {
      for (const destination of destinations) {
        if (destination.complete) continue
        const target = draftFilePath(workspaceId, destination.path, owner)
        destinationWrites.push({ target, prior: await readJsonFileOrNull(target) })
        await writeJsonAtomic(target, destination.next)
      }
    } catch (error) {
      const failures = await rollbackDraftWrites(destinationWrites)
      if (failures.length > 0) throw new AggregateError([error, ...failures], 'draft tree rollback incomplete')
      throw error
    }
    /* Phase 2: tombstone every source. A failure here restores the already
       tombstoned sources AND removes the phase-1 destinations, returning the
       tree to its pre-operation state. */
    const sourceWrites = []
    try {
      for (const record of selected) {
        sourceWrites.push({ target: draftFilePath(workspaceId, record.value.path, owner), prior: record.value })
        await writeJsonAtomic(draftFilePath(workspaceId, record.value.path, owner), draftTombstone(owner, record.value.path, generation))
      }
    } catch (error) {
      const failures = [
        ...(await rollbackDraftWrites(sourceWrites)),
        ...(await rollbackDraftWrites(destinationWrites)),
      ]
      if (failures.length > 0) throw new AggregateError([error, ...failures], 'draft tree rollback incomplete')
      throw error
    }
    await pruneDraftTombstones(records, owner)
    return { workspaceId: String(workspaceId), owner, generation, action, fromPath, toPath, count: selected.length }
  })
}
