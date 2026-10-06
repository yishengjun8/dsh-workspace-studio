/* Strict schemas for this plugin's persisted CLIENT state (localStorage).
 *
 * One rule, applied everywhere: a persisted value is either read as the CURRENT format or
 * dropped — never migrated, never partially tolerated.
 *   - the top level is unparseable or not a plain object   → remove the key, use defaults;
 *   - an entry/field does not satisfy the schema           → drop that entry/field, fill the
 *                                                            field's default, write the cleaned
 *                                                            value back;
 *   - a number is out of its range                         → clamp (and snap to the grid when the
 *                                                            field declares a step);
 *   - an unknown field or group                            → dropped.
 * The format version travels in the storage KEY (…settings.v2): a shape change bumps the key and
 * LEGACY_STORE_KEYS deletes the previous key outright, so no reader ever sees an older shape and
 * no per-version branch exists anywhere.
 *
 * readPersistedState() is the single place that knows a shape; the mount-time gate
 * (sanitizePersistedClientState) additionally makes the cleanup durable by rewriting the cleaned
 * value (and removing a key it cannot parse at all) BEFORE the stores rehydrate — the harness's
 * attachPersistence replaces the whole store state from the raw JSON, so a canonical value must
 * be on disk by then.
 */
import {
  AUTO_SYNC_MODE_AUTO, AUTO_SYNC_MODE_WATCH_ONLY, CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN,
  DIFF_RULER_DEFAULT, DIFF_RULER_SPAN_DEFAULT, DIFF_RULER_THUMB_DEFAULT, DIFF_RULER_WIDTH_DEFAULT, DIFF_RULER_WIDTH_MAX, DIFF_RULER_WIDTH_MIN,
  DIFF_TINT_DEFAULT, EDIT_LINES_DEFAULT, EDIT_LINES_MAX, EDIT_LINES_MIN, EXPLORER_LAYOUT_STORE_KEY, EXPLORER_SETTINGS_STORE_KEY,
  FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP,
  MINDMAP_LAST_SESSION_STORE_KEY, MINDMAP_MOUNT_BULGE_DEFAULT_X, MINDMAP_MOUNT_BULGE_MAX_X, MINDMAP_MOUNT_BULGE_MIN_X, MINDMAP_ORDER_STORE_KEY,
  MINDMAP_SPIN_SPEED_DEFAULT_X, MINDMAP_SPIN_SPEED_MAX_X, MINDMAP_SPIN_SPEED_MIN_X, MINDMAP_SUMMARY_DEFAULT_LENGTH, MINDMAP_SUMMARY_LENGTH_STEP,
  MINDMAP_SUMMARY_MAX_LENGTH, MINDMAP_SUMMARY_MIN_LENGTH, MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH, MINDMAP_SUMMARY_SESSION_LENGTH_STEP,
  MINDMAP_SUMMARY_SESSION_MAX_LENGTH, MINDMAP_SUMMARY_SESSION_MIN_LENGTH, PREVIEW_DEFAULT, PREVIEW_MAX, PREVIEW_MIN, PREVIEW_RIGHT_DEFAULT,
  PREVIEW_SESSION_MAX, PREVIEW_SESSION_STORE_KEY, ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, SEARCH_MATCH_EXPAND_DEFAULT, SIDEBAR_DEFAULT,
  SIDEBAR_MIN, THINK_LINES_DEFAULT, THINK_LINES_MAX, THINK_LINES_MIN, TOKEN_CURRENCY_MAX_LENGTH, TOKEN_LAYOUT_STORE_KEY,
  TOKEN_PRICE_DEFAULT_CURRENCY, TOKEN_PRICE_FIELDS,
  TOKEN_PRICE_MAX_LENGTH, TOKEN_PRICES_STORE_KEY, TOKEN_SPLIT_DEFAULT, TOKEN_SPLIT_MAX, TOKEN_SPLIT_MIN,
  TREE_DEFAULT, TREE_MAX, TREE_MIN, VCS_HIDE_METADATA_DEFAULT, WATCH_FILES_DEFAULT, cssColorToHex,
} from './constants.js'
import { normalizePreviewSession, serializePreviewSession } from './preview-tabs.js'
/* The store keys of every format BEFORE the current one. They are deleted on load: their content
   is never interpreted, so nothing here has to know what those shapes were. */
const LEGACY_STORE_KEYS = Object.freeze([
  'dsh.workspace.studio.preview-sessions.v1',
  'dsh.workspace.studio.settings.v1',
  'dsh.workspace.studio.layout.v1',
  'dsh.workspace.studio.token-prices.v1',
  'dsh.workspace.studio.mindmap-order.v1',
  'dsh.workspace.studio.mindmap-last-session.v1',
])

/* A viewport-derived sidebar ceiling is legitimate (wide monitors persist > SIDEBAR_MAX_FALLBACK),
   so only an absurd value is rejected; the live viewport clamp stays in the layout math. */
const SIDEBAR_PERSIST_SANITY_MAX = 4096
const KEY_MAX_LENGTH = 256
const STRING_VALUE_MAX_LENGTH = 512
/* Sanity cap on a display string that is not otherwise bounded by its own constant. */
const PRESET_ID_MAX_LENGTH = 64

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isUsableKey = value => typeof value === 'string' && value !== '' && value.length <= KEY_MAX_LENGTH
const isUsableString = value => typeof value === 'string' && value !== '' && value.length <= STRING_VALUE_MAX_LENGTH

/* ---- field kinds: each returns a canonical value, or OMIT to leave the field out ---- */
const OMIT = Symbol('omit')

function canonicalNumber(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return field.default
  let next = Math.min(field.max, Math.max(field.min, value))
  if (field.step !== undefined) next = field.min + Math.round((next - field.min) / field.step) * field.step
  if (field.decimals === 0) return Math.round(next)
  if (field.decimals !== undefined) {
    const factor = 10 ** field.decimals
    return Math.round(next * factor) / factor
  }
  return next
}

function canonicalField(field, value) {
  switch (field.kind) {
    case 'bool':
      return typeof value === 'boolean' ? value : field.default
    case 'number': {
      /* A persisted 0 is meaningful for a collapsible width; every other field's range starts above it. */
      if (field.zeroAllowed === true && value === 0) return 0
      return canonicalNumber(field, value)
    }
    case 'enum':
      return field.values.includes(value) ? value : field.default
    case 'color': {
      const hex = cssColorToHex(value)
      if (hex !== null) return hex
      return field.default === undefined ? OMIT : field.default
    }
    case 'string':
      return typeof value === 'string' ? value.slice(0, field.max ?? STRING_VALUE_MAX_LENGTH) : field.default
    case 'model': {
      const provider = value?.provider
      const model = value?.model
      if (isUsableString(provider) && isUsableString(model)) return { provider, model }
      return field.default === undefined ? OMIT : field.default
    }
    case 'colorMap':
      return canonicalMap(value, entry => { const hex = cssColorToHex(entry); return hex === null ? OMIT : hex })
    case 'stringMap':
      return canonicalMap(value, entry => isUsableString(entry) ? entry.slice(0, PRESET_ID_MAX_LENGTH) : OMIT)
    case 'priceRecord':
      return canonicalPriceRecord(value)
    default:
      return OMIT
  }
}

function canonicalMap(value, canonicalize) {
  const map = {}
  if (!isPlainObject(value)) return map
  for (const [key, entry] of Object.entries(value)) {
    if (!isUsableKey(key)) continue
    const canonical = canonicalize(entry)
    if (canonical !== OMIT) map[key] = canonical
  }
  return map
}

/* One price field: digits with at most one dot, capped so a paste cannot bloat the value. */
function sanitizePriceText(value) {
  let text = ''
  let dot = false
  for (const character of String(value)) {
    if (character >= '0' && character <= '9') text += character
    else if (character === '.' && !dot) { dot = true; text += character }
    if (text.length >= TOKEN_PRICE_MAX_LENGTH) break
  }
  return text === '.' ? '' : text
}

function canonicalPriceRecord(value) {
  if (!isPlainObject(value)) return OMIT
  const record = {}
  for (const field of TOKEN_PRICE_FIELDS) {
    if (typeof value[field] !== 'string') continue
    const clean = sanitizePriceText(value[field])
    if (clean !== '') record[field] = clean
  }
  return Object.keys(record).length === 0 ? OMIT : record
}

/* ---- per-key normalizers: canonical object, or null when the top level is unusable ---- */
function normalizeBySchema(schema, value) {
  if (!isPlainObject(value)) return null
  const canonical = {}
  for (const [field, descriptor] of Object.entries(schema)) {
    const repaired = canonicalField(descriptor, value[field])
    if (repaired !== OMIT) canonical[field] = repaired
  }
  return canonical
}

const SETTINGS_SCHEMA = Object.freeze({
  rowHeight: { kind: 'number', min: ROW_HEIGHT_MIN, max: ROW_HEIGHT_MAX, default: ROW_HEIGHT_DEFAULT },
  conflictFontSize: { kind: 'number', min: CONFLICT_FONT_SIZE_MIN, max: CONFLICT_FONT_SIZE_MAX, default: CONFLICT_FONT_SIZE_DEFAULT },
  /* Preview content text size (percent): the BASE size a tab without its own value follows. The
     slider's 10% grid is snapped here too, so a hand-edited value cannot sit off-grid. */
  previewFontScale: { kind: 'number', min: FONT_SCALE_MIN, max: FONT_SCALE_MAX, step: FONT_SCALE_STEP, decimals: 0, default: FONT_SCALE_DEFAULT },
  wrap: { kind: 'bool', default: false },
  expandSearchMatches: { kind: 'bool', default: SEARCH_MATCH_EXPAND_DEFAULT },
  thinkLines: { kind: 'number', min: THINK_LINES_MIN, max: THINK_LINES_MAX, default: THINK_LINES_DEFAULT },
  editLines: { kind: 'number', min: EDIT_LINES_MIN, max: EDIT_LINES_MAX, default: EDIT_LINES_DEFAULT },
  /* Speed multiplier: 0.1-granular and preserved as such (the shared integer clamp would round it away). */
  mindmapSpinSpeed: { kind: 'number', min: MINDMAP_SPIN_SPEED_MIN_X, max: MINDMAP_SPIN_SPEED_MAX_X, decimals: 1, default: MINDMAP_SPIN_SPEED_DEFAULT_X },
  mindmapHoverColor: { kind: 'color', default: undefined },
  mindmapSelectedColor: { kind: 'color', default: undefined },
  mindmapHeadColor: { kind: 'color', default: undefined },
  mindmapEndColor: { kind: 'color', default: undefined },
  mindmapMountBulge: { kind: 'number', min: MINDMAP_MOUNT_BULGE_MIN_X, max: MINDMAP_MOUNT_BULGE_MAX_X, decimals: 1, default: MINDMAP_MOUNT_BULGE_DEFAULT_X },
  mindmapSummaryEnabled: { kind: 'bool', default: false },
  mindmapSummaryModel: { kind: 'model', default: undefined },
  mindmapSummaryLength: { kind: 'number', min: MINDMAP_SUMMARY_MIN_LENGTH, max: MINDMAP_SUMMARY_MAX_LENGTH, step: MINDMAP_SUMMARY_LENGTH_STEP, decimals: 0, default: MINDMAP_SUMMARY_DEFAULT_LENGTH },
  mindmapSummarySessionLength: { kind: 'number', min: MINDMAP_SUMMARY_SESSION_MIN_LENGTH, max: MINDMAP_SUMMARY_SESSION_MAX_LENGTH, step: MINDMAP_SUMMARY_SESSION_LENGTH_STEP, decimals: 0, default: MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH },
  fileColors: { kind: 'colorMap', default: {} },
  highlightPresets: { kind: 'stringMap', default: {} },
  previewRight: { kind: 'bool', default: PREVIEW_RIGHT_DEFAULT },
  watchFiles: { kind: 'bool', default: WATCH_FILES_DEFAULT },
  autoSyncMode: { kind: 'enum', values: [AUTO_SYNC_MODE_AUTO, AUTO_SYNC_MODE_WATCH_ONLY], default: AUTO_SYNC_MODE_AUTO },
  vcsEnabled: { kind: 'bool', default: true },
  vcsShowIgnored: { kind: 'bool', default: false },
  vcsHideDirs: { kind: 'bool', default: VCS_HIDE_METADATA_DEFAULT },
  vcsAutoRefresh: { kind: 'bool', default: true },
  vcsColors: { kind: 'colorMap', default: {} },
  diffColors: { kind: 'colorMap', default: {} },
  diffLineTint: { kind: 'bool', default: DIFF_TINT_DEFAULT },
  diffRuler: { kind: 'bool', default: DIFF_RULER_DEFAULT },
  /* The slider's 2px grid, snapped from the same min the widget renders. */
  diffRulerWidth: { kind: 'number', min: DIFF_RULER_WIDTH_MIN, max: DIFF_RULER_WIDTH_MAX, step: 2, decimals: 0, default: DIFF_RULER_WIDTH_DEFAULT },
  diffRulerSpan: { kind: 'enum', values: ['inset', 'full'], default: DIFF_RULER_SPAN_DEFAULT },
  diffRulerThumb: { kind: 'enum', values: ['slim', 'full'], default: DIFF_RULER_THUMB_DEFAULT },
})

const LAYOUT_SCHEMA = Object.freeze({
  tree: { kind: 'number', min: TREE_MIN, max: TREE_MAX, default: TREE_DEFAULT },
  preview: { kind: 'number', min: PREVIEW_MIN, max: PREVIEW_MAX, default: PREVIEW_DEFAULT },
  sidebar: { kind: 'number', min: SIDEBAR_MIN, max: SIDEBAR_PERSIST_SANITY_MAX, zeroAllowed: true, default: SIDEBAR_DEFAULT },
})

/* Token-stats panel geometry: one draggable divider. 0 is a real state ("never dragged", the panel
   then uses its built-in column ratio), so zero is allowed and is also the default. */
const TOKEN_LAYOUT_SCHEMA = Object.freeze({
  split: { kind: 'number', min: TOKEN_SPLIT_MIN, max: TOKEN_SPLIT_MAX, zeroAllowed: true, default: TOKEN_SPLIT_DEFAULT },
})

/* Token-price records drop every field the current schema does not name. */
function normalizePrices(value) {
  if (!isPlainObject(value)) return null
  const overrides = {}
  if (isPlainObject(value.overrides)) {
    for (const [key, record] of Object.entries(value.overrides)) {
      if (!isUsableKey(key)) continue
      const canonical = canonicalPriceRecord(record)
      if (canonical !== OMIT) overrides[key] = canonical
    }
  }
  return {
    currency: typeof value.currency === 'string'
      ? value.currency.slice(0, TOKEN_CURRENCY_MAX_LENGTH)
      : TOKEN_PRICE_DEFAULT_CURRENCY,
    prices: (() => { const record = canonicalPriceRecord(value.prices); return record === OMIT ? {} : record })(),
    overrides,
  }
}

/* Preview snapshots: the tab shape itself is defined by normalizePreviewSession /
   serializePreviewSession (the same pair the live explorer uses), so the gate only adds the
   per-key storage rules — a snapshot with nothing left to restore is not stored at all, and the
   stored session count is capped by most-recent update. */
function normalizePreviewSessions(value) {
  if (!isPlainObject(value) || !isPlainObject(value.previewSessions)) return null
  const sessions = {}
  for (const [key, snapshot] of Object.entries(value.previewSessions)) {
    if (!isUsableKey(key) || !isPlainObject(snapshot)) continue
    const restored = normalizePreviewSession(snapshot)
    if (restored.tabs.length === 0 && restored.expanded.length === 0) continue
    const serialized = serializePreviewSession(restored.activePath, restored.tabs, restored.expanded)
    sessions[key] = {
      ...serialized,
      ...(typeof snapshot.updatedAt === 'number' && Number.isFinite(snapshot.updatedAt)
        ? { updatedAt: Math.max(0, Math.round(snapshot.updatedAt)) }
        : {}),
    }
  }
  const entries = Object.entries(sessions)
  if (entries.length > PREVIEW_SESSION_MAX) {
    /* A stamp-less snapshot sorts as newest (the write path stamps every session, so an unstamped
       one can only be hand-written data). */
    const stampOf = entry => (Number.isFinite(Number(entry[1].updatedAt)) ? Number(entry[1].updatedAt) : Infinity)
    entries.sort((a, b) => stampOf(b) - stampOf(a))
    return { previewSessions: Object.fromEntries(entries.slice(0, PREVIEW_SESSION_MAX)) }
  }
  return { previewSessions: sessions }
}

/* Mind-map sidebar order: group key -> session-id list. A group whose value is not a list, or
   whose ids are not usable strings, is dropped. */
function normalizeMindmapOrder(value) {
  if (!isPlainObject(value)) return null
  const order = {}
  for (const [group, ids] of Object.entries(value)) {
    if (!isUsableKey(group) || !Array.isArray(ids)) continue
    const cleaned = ids.filter(id => isUsableString(id))
    if (cleaned.length > 0) order[group] = cleaned
  }
  return order
}

/* Mind-map last selected session: root session id -> session id. */
function normalizeMindmapLastSession(value) {
  if (!isPlainObject(value)) return null
  const selection = {}
  for (const [root, sessionId] of Object.entries(value)) {
    if (!isUsableKey(root) || !isUsableString(sessionId)) continue
    selection[root] = sessionId
  }
  return selection
}

const PERSISTED_SCHEMAS = Object.freeze({
  [EXPLORER_SETTINGS_STORE_KEY]: { normalize: value => normalizeBySchema(SETTINGS_SCHEMA, value) },
  [EXPLORER_LAYOUT_STORE_KEY]: { normalize: value => normalizeBySchema(LAYOUT_SCHEMA, value) },
  [TOKEN_LAYOUT_STORE_KEY]: { normalize: value => normalizeBySchema(TOKEN_LAYOUT_SCHEMA, value) },
  [TOKEN_PRICES_STORE_KEY]: { normalize: normalizePrices },
  [PREVIEW_SESSION_STORE_KEY]: { normalize: normalizePreviewSessions },
  [MINDMAP_ORDER_STORE_KEY]: { normalize: normalizeMindmapOrder },
  [MINDMAP_LAST_SESSION_STORE_KEY]: { normalize: normalizeMindmapLastSession },
})

function storageOf(storage) {
  if (storage !== undefined) return storage
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

/** The canonical value of one persisted key, or null when nothing usable is stored there. */
export function readPersistedState(key, storage) {
  const target = storageOf(storage)
  if (target === undefined) return null
  let raw
  try {
    raw = target.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  const schema = PERSISTED_SCHEMAS[key]
  if (schema === undefined) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return schema.normalize(parsed)
}

/** Remove the keys of every previous format. Their content is never interpreted. */
function dropLegacyPersistedState(storage) {
  const target = storageOf(storage)
  if (target === undefined) return
  for (const key of LEGACY_STORE_KEYS) {
    try {
      target.removeItem(key)
    } catch { /* storage disabled: nothing to drop */ }
  }
}

/**
 * Mount-time gate: delete every previous-format key, then make the current keys canonical on disk
 * (a key whose top level cannot be parsed at all is removed; a repaired value is written back).
 * Must run BEFORE any store is created, because the harness's persistence rehydrates a store by
 * replacing its whole state with the raw JSON. Never throws: a storage failure (private mode,
 * quota) leaves the raw value alone and the plugin keeps working from the schema-read defaults.
 */
export function sanitizePersistedClientState(storage) {
  const target = storageOf(storage)
  if (target === undefined) return
  dropLegacyPersistedState(target)
  for (const [key, schema] of Object.entries(PERSISTED_SCHEMAS)) {
    let raw
    try {
      raw = target.getItem(key)
    } catch {
      continue
    }
    if (raw === null) continue
    let canonical = null
    try {
      canonical = schema.normalize(JSON.parse(raw))
    } catch {
      canonical = null
    }
    try {
      if (canonical === null) target.removeItem(key)
      else {
        const serialized = JSON.stringify(canonical)
        if (serialized !== raw) target.setItem(key, serialized)
      }
    } catch { /* quota / private mode: the raw value stays, the defaults still apply */ }
  }
}
