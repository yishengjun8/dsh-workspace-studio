/** Workspace collections: a named, ordered set of Harness workspaces.
 *
 * The Harness workspace registry stays the authority on which workspaces EXIST; this store only
 * remembers how the user grouped them. One JSON file under
 * ~/.dsh-plugin/dsh-workspace-studio/collections/ holds
 * `{ version, selectedId, collections: [{ id, name, workspaceIds }] }`.
 *
 * Two deliberate shapes:
 *   - a collection stores workspace IDS, so a workspace the Harness later deletes leaves a dangling
 *     id behind: readers ignore it and the next write drops it (the collection survives a workspace
 *     being re-added under a new id with an empty membership rather than a wrong one);
 *   - the built-in "all workspaces" collection is a CLIENT constant and is never stored, so this
 *     file holds user collections only, in the user's own order (the built-in one is always first).
 *
 * Reads are forgiving and writes are strict — the same split run.js uses: a hand-edited file keeps
 * whatever is still usable (bad entries are dropped, nothing else is invented), while a patch the UI
 * could not have produced is refused outright instead of being half-applied.
 */
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HttpError, isPlainObject } from './errors.js'
import { quarantineFile } from './quarantine.js'
import { readJsonStrict, writeJsonAtomic } from './drafts.js'
import { serializeWrite } from './write.js'

const COLLECTIONS_SUB_DIR = 'collections'
const COLLECTIONS_FILE = 'collections.json'

/** The only store format this code reads or writes (see quarantine.js). */
export const COLLECTIONS_VERSION = 1
/** Built-in collection ids: client constants, never persisted here, valid as `selectedId`. */
export const COLLECTION_ALL_ID = '__all__'
/** Built-in "workspaces in no collection" view. */
export const COLLECTION_UNOWNED_ID = '__unowned__'
/** Whether an id names a built-in view (it is never a stored collection). */
export function isBuiltinCollectionId(id) {
  return id === COLLECTION_ALL_ID || id === COLLECTION_UNOWNED_ID
}
/** User collections per store. The built-in collection is not counted (it is not user content). */
export const COLLECTIONS_MAX = 50
/** Display-name length bound, in UTF-16 code units, after trimming. */
export const COLLECTION_NAME_MAX = 40
/** Workspace ids one collection may hold. */
export const COLLECTION_WORKSPACE_MAX = 2000
/** Workspace id length bound (Harness ids are short slugs; this only rejects junk). */
const WORKSPACE_ID_MAX = 128
/** Generated ids are opaque to the client, which may also propose its own to keep one round trip. */
const COLLECTION_ID_RE = /^col_[a-z0-9]{8,32}$/u
/* Control characters (including the C1 range and the two Unicode line separators) would corrupt the
   sidebar's single-line label or the JSON round trip, so both names and ids reject them. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u

/** Location of the collections store (its own directory, so the quarantine dir sits beside it). */
export function collectionsPath() {
  return join(homedir(), '.dsh-plugin', 'dsh-workspace-studio', COLLECTIONS_SUB_DIR, COLLECTIONS_FILE)
}

function newCollectionId() {
  return `col_${randomBytes(8).toString('hex')}`
}

/* ---- read side (forgiving) ---- */

function normalizeWorkspaceIds(value) {
  const ids = []
  if (!Array.isArray(value)) return ids
  const seen = new Set()
  for (const entry of value) {
    if (ids.length >= COLLECTION_WORKSPACE_MAX) break
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id === '' || id.length > WORKSPACE_ID_MAX || CONTROL_CHARS_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Project a stored value onto the current format: unusable collections are dropped, usable ones are
 * canonicalized (trimmed name, deduplicated membership), and an unknown selection falls back to the
 * built-in collection. Never throws — the caller decides whether the file itself was readable.
 * @param value - parsed file contents, or undefined for the defaults.
 * @returns `{ version, selectedId, collections }`.
 */
export function normalizeCollectionsStore(value) {
  const source = isPlainObject(value) && Array.isArray(value.collections) ? value.collections : []
  const collections = []
  const seen = new Set()
  for (const entry of source) {
    if (collections.length >= COLLECTIONS_MAX) break
    if (!isPlainObject(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!COLLECTION_ID_RE.test(id) || seen.has(id)) continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    /* Count code points here, exactly like validateCollectionName does: measuring one side in UTF-16
       units would let the writer accept a name the reader then drops, silently losing a collection. */
    if (name === '' || [...name].length > COLLECTION_NAME_MAX || CONTROL_CHARS_RE.test(name)) continue
    seen.add(id)
    collections.push({ id, name, workspaceIds: normalizeWorkspaceIds(entry.workspaceIds) })
  }
  const requested = isPlainObject(value) && typeof value.selectedId === 'string' ? value.selectedId : ''
  const selectedId = isBuiltinCollectionId(requested) || seen.has(requested) ? requested : COLLECTION_ALL_ID
  return { version: COLLECTIONS_VERSION, selectedId, collections }
}

/** Whether a readable file is in the current format at all (a foreign version is NOT migrated). */
function isCurrentFormat(value) {
  return isPlainObject(value) && value.version === COLLECTIONS_VERSION && Array.isArray(value.collections)
}

/**
 * Read the collections store. A file that parses but is not in the current format is quarantined and
 * the defaults are served; a missing file and an IO/permission failure are never treated as
 * corruption (the latter is rethrown by readJsonStrict).
 * @returns the normalized store.
 */
export async function readCollectionsStore() {
  const path = collectionsPath()
  const read = await readJsonStrict(path)
  if (read.status === 'missing') return normalizeCollectionsStore(undefined)
  if (read.status !== 'ok' || !isCurrentFormat(read.value)) {
    await quarantineFile(path, 'not a current-format collections store')
    return normalizeCollectionsStore(undefined)
  }
  return normalizeCollectionsStore(read.value)
}

/* ---- write side (strict) ---- */

function validateCollectionName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-collection', '合集名称必须是字符串')
  const name = value.trim()
  if (name === '') throw new HttpError(400, 'invalid-collection', '合集名称不能为空')
  if ([...name].length > COLLECTION_NAME_MAX) {
    throw new HttpError(400, 'invalid-collection', `合集名称不能超过 ${COLLECTION_NAME_MAX} 个字符`)
  }
  if (CONTROL_CHARS_RE.test(name)) throw new HttpError(400, 'invalid-collection', '合集名称包含非法字符')
  return name
}

function validateWorkspaceId(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-collection', '工作区 id 必须是字符串')
  const id = value.trim()
  if (id === '' || id.length > WORKSPACE_ID_MAX || CONTROL_CHARS_RE.test(id)) {
    throw new HttpError(400, 'invalid-collection', '工作区 id 无效')
  }
  return id
}

function validateMembership(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid-collection', 'workspaceIds 必须是数组')
  if (value.length > COLLECTION_WORKSPACE_MAX) {
    throw new HttpError(400, 'invalid-collection', `一个合集最多 ${COLLECTION_WORKSPACE_MAX} 个工作区`)
  }
  const ids = []
  const seen = new Set()
  for (const entry of value) {
    const id = validateWorkspaceId(entry)
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function validateIdList(value, field) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid-collection', `${field} 必须是数组`)
  const ids = []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') throw new HttpError(400, 'invalid-collection', `${field} 只能是字符串数组`)
    const id = entry.trim()
    if (!COLLECTION_ID_RE.test(id)) throw new HttpError(400, 'invalid-collection', `${field} 含无效的合集 id`)
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function validateUpserts(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid-collection', 'upsert 必须是数组')
  return value.map((entry) => {
    if (!isPlainObject(entry)) throw new HttpError(400, 'invalid-collection', 'upsert 的每一项必须是对象')
    let id
    if (entry.id !== undefined) {
      id = typeof entry.id === 'string' ? entry.id.trim() : ''
      if (!COLLECTION_ID_RE.test(id)) throw new HttpError(400, 'invalid-collection', '合集 id 无效')
    }
    return { ...(id === undefined ? {} : { id }), name: validateCollectionName(entry.name), workspaceIds: validateMembership(entry.workspaceIds) }
  })
}

/**
 * Apply one patch to the store and persist it: `{ selectedId?, order?, upsert?, remove? }`.
 *
 * The patch shape (rather than a whole-document replace) keeps two open surfaces — the Web tab and
 * the desktop app — from clobbering each other: every operation is merged server-side inside the
 * store's serialized queue, so a reorder cannot erase a membership edit that landed in between. The
 * response is always the full normalized store, which is what the client renders next.
 * @param payload - request body.
 * @param queues - shared per-key write queue (writeQueues in index.js).
 * @param maxCollections - deployment bound on USER collections (config.maxCollections).
 * @returns the store after the patch.
 * @throws {HttpError} 400 with `invalid-collection` / `collections-limit` / `collections-stale`.
 */
export async function applyCollectionsPatch(payload, queues, maxCollections = COLLECTIONS_MAX) {
  const limit = Number.isSafeInteger(maxCollections) && maxCollections > 0 ? maxCollections : COLLECTIONS_MAX
  if (!isPlainObject(payload)) throw new HttpError(400, 'invalid-collection', '合集请求必须是 JSON 对象')
  const selected = payload.selectedId
  if (selected !== undefined) {
    if (typeof selected !== 'string') throw new HttpError(400, 'invalid-collection', 'selectedId 必须是字符串')
    const id = selected.trim()
    if (!isBuiltinCollectionId(id) && !COLLECTION_ID_RE.test(id)) {
      throw new HttpError(400, 'invalid-collection', 'selectedId 无效')
    }
  }
  const order = validateIdList(payload.order, 'order')
  const upserts = validateUpserts(payload.upsert)
  const remove = validateIdList(payload.remove, 'remove')
  if (selected === undefined && order === undefined && upserts === undefined && remove === undefined) {
    throw new HttpError(400, 'invalid-collection', '没有要更新的合集设置')
  }
  return serializeWrite(queues, 'collections', async () => {
    const current = await readCollectionsStore()
    const byId = new Map(current.collections.map(collection => [collection.id, collection]))
    if (remove !== undefined) {
      for (const id of remove) byId.delete(id)
    }
    if (upserts !== undefined) {
      for (const entry of upserts) {
        const existing = entry.id === undefined ? undefined : byId.get(entry.id)
        const id = existing === undefined ? (entry.id ?? newCollectionId()) : existing.id
        if (existing === undefined && byId.size >= limit) {
          throw new HttpError(400, 'collections-limit', `最多 ${limit} 个合集`, { limit })
        }
        /* Duplicate names are refused here because the dropdown labels ARE the identity a user
           picks by; two identical rows would make the list unusable. */
        for (const collection of byId.values()) {
          if (collection.id !== id && collection.name === entry.name) {
            throw new HttpError(400, 'collections-name-taken', `已存在名为「${entry.name}」的合集`, { name: entry.name })
          }
        }
        byId.set(id, {
          id,
          name: entry.name,
          workspaceIds: entry.workspaceIds ?? existing?.workspaceIds ?? [],
        })
      }
    }
    const remaining = [...byId.values()]
    /* `order` reorders what it names and leaves the rest where they are: a stale id (a collection the
       other surface deleted meanwhile) must not fail the whole patch. */
    const ordered = []
    if (order !== undefined) {
      for (const id of order) {
        const found = byId.get(id)
        if (found !== undefined && !ordered.includes(found)) ordered.push(found)
      }
    }
    for (const collection of remaining) if (!ordered.includes(collection)) ordered.push(collection)
    const next = normalizeCollectionsStore({
      version: COLLECTIONS_VERSION,
      selectedId: selected ?? current.selectedId,
      collections: ordered,
    })
    if (selected !== undefined && !isBuiltinCollectionId(selected)
      && !next.collections.some(collection => collection.id === selected)) {
      /* Selecting a collection this patch just removed (or never had) would leave the sidebar showing
         nothing; the client is expected to send the two together when it means it. */
      throw new HttpError(400, 'collections-stale', '要选中的合集不存在', { selectedId: selected })
    }
    await writeJsonAtomic(collectionsPath(), next)
    return next
  })
}
