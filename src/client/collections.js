/** Workspace collections: the module-level store plus the pure view model.
 *
 * A collection is a named, ordered set of Harness workspaces; the Harness registry stays the
 * authority on which workspaces exist, so every projection here intersects a collection's stored
 * ids with the workspaces actually present (a dangling id is simply not shown).
 *
 * The store is module-level (like resourceNoticeStore) because two unrelated surfaces read it: the
 * dropdown portal inside the Harness sidebar header and the document-level workspace-row context
 * menu. The Host owns the durable copy (collections/collections.json); this store is a render tail
 * over it and never persists anything itself.
 */
import { COLLECTION_ALL_ID, COLLECTION_LIMIT, COLLECTION_NAME_MAX, COLLECTION_UNOWNED_ID, WORKSPACE_GROUP_BY_DEFAULT, WORKSPACE_VIEW_STORE_KEY } from './constants.js'

/** The Harness sidebar region this feature paints into (see dev-notes §47). */
const REGION = '[data-slot="sidebar.workspaces"]'

/** Whether an id names a built-in view rather than a stored collection. */
export function isBuiltinCollection(collectionId) {
  return collectionId === COLLECTION_ALL_ID || collectionId === COLLECTION_UNOWNED_ID
}
import { fetchCollections, patchCollections } from './api.js'

/** Defaults for a profile that has never stored anything. */
export const EMPTY_COLLECTIONS_DOC = Object.freeze({ version: 1, selectedId: COLLECTION_ALL_ID, collections: [] })

let snapshot = { phase: 'idle', doc: EMPTY_COLLECTIONS_DOC, busy: false, error: undefined }
const listeners = new Set()

function publish(next) {
  snapshot = next
  for (const listener of [...listeners]) listener()
}

export const collectionsStore = {
  subscribe(listener) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot() { return snapshot },
}

/* ---- normalization (the same forgiveness the Host reader applies) ---- */

function normalizeName(value) {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  /* Code points, exactly like the Host's validator: a UTF-16 measure would disagree for astral text. */
  if (name === '' || [...name].length > COLLECTION_NAME_MAX) return ''
  return name
}

function normalizeMembership(value) {
  if (!Array.isArray(value)) return []
  const ids = []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Project a Host answer onto the shape this UI renders: unusable collections are dropped, the
 * selection falls back to the built-in collection, and the result is capped like the Host store.
 * @param value - GET/PUT response body.
 * @returns `{ version, selectedId, collections }`.
 */
export function normalizeCollectionsDoc(value) {
  const source = value !== null && typeof value === 'object' && Array.isArray(value.collections) ? value.collections : []
  const collections = []
  const seen = new Set()
  for (const entry of source) {
    if (collections.length >= COLLECTION_LIMIT) break
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const name = normalizeName(entry.name)
    if (id === '' || isBuiltinCollection(id) || seen.has(id) || name === '') continue
    seen.add(id)
    collections.push({ id, name, workspaceIds: normalizeMembership(entry.workspaceIds) })
  }
  const requested = value !== null && typeof value === 'object' && typeof value.selectedId === 'string' ? value.selectedId : ''
  const selectedId = isBuiltinCollection(requested) || seen.has(requested) ? requested : COLLECTION_ALL_ID
  return { version: 1, selectedId, collections }
}

/* ---- store actions ---- */

/**
 * Read the store once (mount, or after a failed patch that left the UI unsure).
 * @param signal - optional abort signal.
 */
export async function loadCollections(signal) {
  publish({ ...snapshot, phase: 'loading', error: undefined })
  try {
    const doc = normalizeCollectionsDoc(await fetchCollections(signal))
    publish({ phase: 'ready', doc, busy: false, error: undefined })
    return doc
  } catch (error) {
    if (error?.name === 'AbortError') return snapshot.doc
    publish({ ...snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    return snapshot.doc
  }
}

/**
 * Merge one patch into the Host store and adopt the merged answer.
 * @param patch - `{ selectedId?, order?, upsert?, remove? }`.
 * @param signal - optional abort signal.
 * @returns `{ ok: true, doc }` or `{ ok: false, error }` (the caller shows the message inline).
 */
export async function applyCollectionsPatch(patch, signal) {
  publish({ ...snapshot, busy: true, error: undefined })
  try {
    const doc = normalizeCollectionsDoc(await patchCollections(patch, signal))
    publish({ phase: 'ready', doc, busy: false, error: undefined })
    return { ok: true, doc }
  } catch (error) {
    if (error?.name === 'AbortError') {
      publish({ ...snapshot, busy: false })
      return { ok: false, error }
    }
    publish({ ...snapshot, phase: 'ready', busy: false })
    return { ok: false, error }
  }
}

/* ---- pure view model ---- */

/**
 * One collection by id.
 * @returns the collection, or undefined for the built-in one / an unknown id.
 */
export function collectionById(doc, id) {
  return (doc?.collections ?? []).find(collection => collection.id === id)
}

/**
 * The stored membership of one collection.
 * @returns the id list, or null for a built-in view (its visibility rule is not a stored id list:
 *   "all workspaces" shows every workspace, "unowned workspaces" shows the ones in no collection —
 *   see visibleWorkspace).
 */
export function memberWorkspaceIds(doc, collectionId) {
  if (isBuiltinCollection(collectionId)) return null
  return collectionById(doc, collectionId)?.workspaceIds ?? []
}

/**
 * Whether one workspace appears under the given view.
 *
 * The single visibility rule the whole feature hangs on: the built-in "all workspaces" view shows
 * everything, the built-in "unowned workspaces" view shows exactly the workspaces that belong to no
 * collection, and a user collection shows its stored members (ids without a registry entry simply
 * never match a real workspace).
 *
 * @param doc - normalized collection document.
 * @param collectionId - the view/collection being shown.
 * @param workspaceId - the workspace in question.
 */
export function visibleWorkspace(doc, collectionId, workspaceId) {
  if (collectionId === COLLECTION_UNOWNED_ID) return collectionsOfWorkspace(doc, workspaceId).length === 0
  const members = memberWorkspaceIds(doc, collectionId)
  return members === null || members.includes(String(workspaceId))
}

/** Every collection (excluding the built-in one) a workspace belongs to. */
export function collectionsOfWorkspace(doc, workspaceId) {
  const id = String(workspaceId)
  return (doc?.collections ?? []).filter(collection => collection.workspaceIds.includes(id))
}

/**
 * The names of the OTHER collections a workspace also belongs to: the `+N` badge's tooltip.
 * @param currentId - the collection being shown (excluded from the answer).
 */
export function otherCollectionNames(doc, workspaceId, currentId) {
  return collectionsOfWorkspace(doc, workspaceId)
    .filter(collection => collection.id !== currentId)
    .map(collection => collection.name)
}

/** How many EXISTING workspaces a collection holds (stored ids without a registry entry do not count).
 *  The built-in "unowned workspaces" view answers with its own count (see unownedWorkspaceCount). */
export function collectionWorkspaceCount(doc, collectionId, workspaces) {
  if (collectionId === COLLECTION_UNOWNED_ID) return unownedWorkspaceCount(doc, workspaces)
  const members = memberWorkspaceIds(doc, collectionId)
  if (members === null) return (workspaces ?? []).length
  const present = new Set((workspaces ?? []).map(workspace => String(workspace?.workspaceId ?? '')))
  return members.filter(id => present.has(id)).length
}

/** Workspaces in no collection at all: exactly what the built-in "unowned workspaces" view shows. */
export function unownedWorkspaceCount(doc, workspaces) {
  return (workspaces ?? []).filter(workspace =>
    collectionsOfWorkspace(doc, workspace?.workspaceId).length === 0).length
}

/**
 * The session a collection switch opens: the most recently updated non-blank, non-archived session
 * of its member workspaces (Harness workspace order breaks ties, which the iteration preserves).
 * @returns the session id, or undefined when the collection holds no such session.
 */
export function newestSessionOfCollection(doc, collectionId, workspaces, sessionsById, archivedSessionIds) {
  const members = memberWorkspaceIds(doc, collectionId)
  const archived = archivedSessionIds instanceof Set ? archivedSessionIds : new Set(archivedSessionIds ?? [])
  let best
  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace?.workspaceId ?? '')
    if (workspaceId === '' || (members !== null && !members.includes(workspaceId))) continue
    for (const sessionId of workspace.sessionIds ?? []) {
      const id = String(sessionId)
      const summary = sessionsById?.[id]
      if (summary === undefined || summary.blank === true || summary.origin === 'subagent') continue
      if (archived.has(id)) continue
      const updatedAt = Number.isFinite(summary.updatedAt) ? summary.updatedAt : 0
      if (best === undefined || updatedAt > best.updatedAt) best = { id, updatedAt }
    }
  }
  return best?.id
}

/**
 * What one click in the collection dropdown does, as data the frame applies.
 *
 * A click on the view already on screen must not switch: the same selection would be written back to
 * the Host unchanged, and — the reason this rule exists — the switch's auto-jump would move the user
 * off the session they are writing in. Such a click only says which view is showing.
 *
 * Built-in views are named by their own copy; a user collection by its name.
 * @returns `{ same: true, notice: { key, params? } }`, or `{ same: false }` when the click switches.
 */
export function collectionClickAction(doc, id) {
  const selected = String(doc?.selectedId ?? COLLECTION_ALL_ID)
  if (String(id) !== selected) return { same: false }
  if (id === COLLECTION_ALL_ID) return { same: true, notice: { key: 'collections.showAll' } }
  if (id === COLLECTION_UNOWNED_ID) return { same: true, notice: { key: 'collections.showUnowned' } }
  /* A stored selection always names an existing collection (the Host refuses a dangling one), so the
     id is the honest fallback here instead of a claim about a collection that is not there. */
  const name = collectionById(doc, id)?.name ?? String(id)
  return { same: true, notice: { key: 'collections.alreadyIn', params: { name } } }
}

/**
 * The Harness workspace-browser grouping mode, read from its persisted view store.
 *
 * This is a deliberate harness coupling point: `groupBy` lives in ui-workspace's own persisted store
 * and no service exposes it. The key is only written once the user changes a view option, so an
 * absent/unreadable value means "the harness default" ('workspace') — which is also the mode this
 * feature needs, so a future harness rename degrades to "the dropdown still works" instead of
 * "the sidebar is empty".
 * @returns 'workspace' | 'workspace-tree' | 'flat'.
 */
export function readHarnessGroupBy() {
  try {
    if (typeof localStorage === 'undefined') return WORKSPACE_GROUP_BY_DEFAULT
    const raw = localStorage.getItem(WORKSPACE_VIEW_STORE_KEY)
    if (raw === null) return WORKSPACE_GROUP_BY_DEFAULT
    const mode = JSON.parse(raw)?.groupBy
    if (mode === 'workspace' || mode === 'workspace-tree' || mode === 'flat') return mode
    return WORKSPACE_GROUP_BY_DEFAULT
  } catch {
    return WORKSPACE_GROUP_BY_DEFAULT
  }
}

/* ---- the sidebar filter, as a pure plan the hook only applies ---- */

/** Above this many hidden-session rules the plain-list/search rules are skipped: the sheet is
 *  rebuilt on every change, and a pathological profile must not stall the sidebar. */
const HIDDEN_SESSION_RULE_MAX = 4000

/* Selectors are built from ids the Harness minted (never from user text); they are still escaped
   because a quote inside an id would break out of the attribute selector. */
function escapeAttribute(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function inRegion(suffix) {
  return `${REGION} ${suffix}`
}

/**
 * Decide what the sidebar must hide and what each visible workspace row must say.
 *
 * Pure so the selector generation is testable without a browser: the hook turns the answer into one
 * stylesheet (group sections and session rows) plus `title` attributes for the chips.
 *
 * @param input.doc - normalized collection document.
 * @param input.workspaces - Harness workspace items (membership lives on their sessionIds).
 * @param input.labels - localized copy `{ outside, outsideView }`: `outside` is the chip of a workspace
 *   outside the shown COLLECTION, `outsideView` the same situation under a built-in view (which is not
 *   a collection), so the marker never claims the wrong thing.
 * @param input.currentWorkspaceId - the viewed session's workspace; outside the shown view its group
 *   stays visible, dashed, instead of disappearing under the user.
 * @param input.paused - true while the grouping mode is not "按工作区" (no rules at all).
 * @returns `{ css, chips, empty }`, `chips` being `{ workspaceId, kind: 'outside' | 'count', names? }`
 *   and `empty` naming the empty-state copy to show (`'unowned' | 'collection'`) or undefined.
 */
export function collectionFilterPlan({ doc, workspaces, labels, currentId, currentWorkspaceId, paused }) {
  if (paused) return { css: '', chips: [], empty: undefined }
  const selected = currentId ?? doc?.selectedId ?? COLLECTION_ALL_ID
  const current = String(currentWorkspaceId ?? '')
  /* "All workspaces" is the only view that filters nothing; both the unowned view and every user
     collection do filter, and one predicate covers all three cases (see visibleWorkspace). */
  const filters = selected !== COLLECTION_ALL_ID
  const rules = []
  const chips = []
  let visibleCount = 0
  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace?.workspaceId ?? '')
    if (workspaceId === '') continue
    const visible = visibleWorkspace(doc, selected, workspaceId)
    if (visible) visibleCount += 1
    if (!visible) {
      if (workspaceId !== current) {
        rules.push(`${inRegion(`*:has(> [data-row-key="workspace:${escapeAttribute(workspaceId)}"])`)}{display:none}`)
      } else {
        chips.push({ workspaceId, kind: 'outside' })
      }
      continue
    }
    if (isBuiltinCollection(selected)) {
      /* No chip under a built-in view: the permanent row icon both shows "in no collection" and is
         where it is edited. */
      continue
    }
    const others = collectionsOfWorkspace(doc, workspaceId).filter(collection => collection.id !== selected)
    if (others.length > 0) chips.push({ workspaceId, kind: 'count', names: others.map(collection => collection.name) })
  }
  /* The ungrouped bucket is not a workspace, so it belongs to the built-in "all workspaces" view only. */
  if (filters) rules.push(`${inRegion('*:has(> [data-row-key="workspace:"])')}{display:none}`)
  /* Session rows outside the group sections (search results, a plain list) are hidden by id. */
  if (filters) {
    const hidden = []
    for (const workspace of workspaces ?? []) {
      const workspaceId = String(workspace?.workspaceId ?? '')
      if (visibleWorkspace(doc, selected, workspaceId)) continue
      /* The viewed session's own workspace is kept visible (see the "outside" chip above), so its
         rows must stay visible too — hiding the row of the session on screen is never right. */
      if (workspaceId === current) continue
      for (const sessionId of workspace.sessionIds ?? []) hidden.push(String(sessionId))
    }
    if (hidden.length <= HIDDEN_SESSION_RULE_MAX) {
      for (const sessionId of hidden) {
        rules.push(`${inRegion(`[data-row-key="session:${escapeAttribute(sessionId)}"]`)}{display:none}`)
      }
    }
  }
  /* An empty view must say so: a blank sidebar reads as a broken feature. The message rides on the
     region's own `::after` (styled in styles.js) so no injected node can be wiped by a re-render. */
  const empty = filters && visibleCount === 0
    ? (selected === COLLECTION_UNOWNED_ID ? 'unowned' : 'collection')
    : undefined
  if (empty !== undefined) {
    const text = empty === 'unowned' ? labels?.emptyUnowned : labels?.emptyCollection
    if (typeof text === 'string' && text !== '') rules.push(`${REGION}::after{content:${JSON.stringify(text)}}`)
  }
  for (const chip of chips) {
    const selector = inRegion(`[data-row-key="workspace:${escapeAttribute(chip.workspaceId)}"]`)
    const content = chip.kind === 'outside'
      ? JSON.stringify((selected === COLLECTION_UNOWNED_ID ? labels?.outsideView : labels?.outside) ?? '')
      : JSON.stringify(`+${chip.names.length}`)
    const outline = chip.kind === 'outside'
      ? `${selector}{outline:1px dashed var(--dsw-alias-state-business-primary);outline-offset:-2px}`
      : ''
    rules.push(`${outline}${selector}::after{content:${content}}`)
  }
  return { css: rules.join('\n'), chips, empty }
}
