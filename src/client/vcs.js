/** Pure view-model helpers for the file browser's version-control status.
 *
 * One `/vcs` payload is turned into everything the tree and the changes list
 * render: per-path badges, directory roll-ups, deleted-file ghost rows, the flat
 * change list and the status-bar model. No React, no DOM and no network here —
 * the explorer hook owns the request, so these functions stay cheap to reason
 * about and easy to exercise from a throwaway script. */
import { translate } from './locale/index.js'

/** Badge tone per status letter; a conflict flag and the ignored flag win over this table. */
const TONE_BY_LETTER = Object.freeze({
  A: 'added',
  C: 'renamed',
  D: 'deleted',
  E: 'ignored',
  G: 'modified',
  I: 'ignored',
  M: 'modified',
  P: 'modified',
  R: 'renamed',
  T: 'modified',
  U: 'conflict',
  X: 'modified',
  '!': 'deleted',
  '?': 'untracked',
  '~': 'modified',
})

/** Dictionary key per status letter (the badge tooltip's first clause). */
const LABEL_KEY_BY_LETTER = Object.freeze({
  A: 'vcs.status.added',
  C: 'vcs.status.conflict',
  D: 'vcs.status.deleted',
  E: 'vcs.status.external',
  G: 'vcs.status.merged',
  I: 'vcs.status.ignored',
  M: 'vcs.status.modified',
  P: 'vcs.status.props',
  R: 'vcs.status.renamed',
  T: 'vcs.status.typeChanged',
  U: 'vcs.status.conflict',
  X: 'vcs.status.modified',
  '!': 'vcs.status.missing',
  '?': 'vcs.status.untracked',
  '~': 'vcs.status.obstructed',
})

/** Localized one-line explanation of one entry's state (badge tooltip). */
function vcsStatusLabel(entry) {
  const letter = typeof entry?.status === 'string' ? entry.status : ''
  const key = LABEL_KEY_BY_LETTER[letter]
  return key === undefined ? '' : translate(key)
}

/** The full badge tooltip: state, staged marker, property marker, rename source. */
function vcsBadgeTitle(entry) {
  const parts = []
  const label = vcsStatusLabel(entry)
  if (label !== '') parts.push(label)
  if (entry?.staged === true) parts.push(translate('vcs.changes.staged'))
  if (entry?.props === true) parts.push(translate('vcs.status.props'))
  if (typeof entry?.from === 'string' && entry.from !== '') parts.push(translate('vcs.status.renamedFrom', { from: entry.from }))
  return parts.join(' · ')
}

/** Badge descriptor of one entry: letter, tone, shape, staged/props flags and its tooltip. */
function vcsBadgeOf(entry) {
  const raw = typeof entry?.status === 'string' ? entry.status.trim() : ''
  const letter = raw === '' ? (entry?.untracked === true ? '?' : 'M') : raw.slice(0, 1)
  let tone = TONE_BY_LETTER[letter] ?? 'modified'
  if (entry?.ignored === true) tone = 'ignored'
  else if (entry?.conflict === true) tone = 'conflict'
  return {
    letter,
    tone,
    /* Untracked entries read as "not in the repository yet": an outline instead of a filled chip. */
    shape: letter === '?' ? 'hollow' : 'text',
    staged: entry?.staged === true,
    props: entry?.props === true,
    title: vcsBadgeTitle(entry),
  }
}

/** The status letters whose presence turns a directory's roll-up red. */
function isSevere(entry) {
  return entry.conflict === true || entry.status === 'D' || entry.status === '!'
}

/**
 * Derive the whole tree view model from one payload.
 * @param payload - the `/vcs` response body (any shape; a malformed one degrades to empty).
 * @returns per-path badges, directory roll-ups, deleted ghost rows and the ignored prefixes.
 */
export function buildVcsOverlay(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : []
  const byPath = new Map()
  const dirCounts = new Map()
  const severeDirs = new Set()
  const ghostsByDir = new Map()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const path = typeof entry.path === 'string' ? entry.path.replace(/\/+$/, '') : ''
    if (path === '') continue
    const badge = vcsBadgeOf(entry)
    const ignored = entry.ignored === true
    byPath.set(path, { ...entry, path, badge })
    /* Roll the path up into every ancestor directory: the tree shows a count badge on collapsed
       directories, and the changes-only view uses the same map to know which directories to expand. */
    const parts = path.split('/')
    for (let depth = 1; depth < parts.length; depth += 1) {
      const dir = parts.slice(0, depth).join('/')
      if (!ignored) dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1)
      if (isSevere(entry)) severeDirs.add(dir)
    }
    /* Deleted files are gone from the listing, so the tree can only show them as ghost rows under
       their (still existing) parent directory. */
    if (entry.deleted === true) {
      const dir = parts.length === 1 ? '' : parts.slice(0, -1).join('/')
      const rows = ghostsByDir.get(dir)
      const ghost = { path, name: parts[parts.length - 1], badge }
      if (rows === undefined) ghostsByDir.set(dir, [ghost])
      else rows.push(ghost)
    }
  }
  for (const rows of ghostsByDir.values()) rows.sort((left, right) => left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' }))
  /* Directory roll-up badges are built ONCE here (not per render): TreeRow is memoized and a fresh
     object every render would defeat the memo for every directory row. The badge carries no
     localized title, so the renderer can localize it at paint time. */
  const dirBadges = new Map()
  for (const [dir, count] of dirCounts) dirBadges.set(dir, { count, tone: severeDirs.has(dir) ? 'conflict-dir' : 'dirty-dir' })
  return { byPath, dirCounts, dirBadges, severeDirs, ghostsByDir, ignoredPrefixes: ignoredPrefixesOf(payload) }
}

/** The folded ignored-path prefixes of one payload (always an array). */
function ignoredPrefixesOf(payload) {
  return Array.isArray(payload?.ignoredPrefixes) ? payload.ignoredPrefixes.filter(prefix => typeof prefix === 'string' && prefix !== '') : []
}

/** Whether one tree path is inside an ignored prefix (file or directory form). */
export function isIgnoredPath(prefixes, path) {
  if (!Array.isArray(prefixes) || prefixes.length === 0 || typeof path !== 'string' || path === '') return false
  for (const prefix of prefixes) {
    const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
    if (base === '' ) continue
    if (path === base || path.startsWith(`${base}/`)) return true
  }
  return false
}

/** Version-control metadata directories the tree hides by default (display only). */
function isVcsMetadataName(name) {
  return name === '.git' || name === '.svn'
}

/** Whether a directory path (or the workspace root, '') holds at least one change in its subtree. */
function vcsDirectoryChanged(overlay, path) {
  return overlay !== undefined && overlay.dirCounts.has(path)
}

/** Roll-up badge of one directory (a stable object from the overlay, or undefined when clean). */
export function vcsDirectoryBadge(overlay, path) {
  return overlay?.dirBadges?.get(path)
}

/** Localized tooltip of a directory roll-up badge. */
export function vcsDirectoryBadgeTitle(badge) {
  return badge?.count === undefined ? '' : translate('vcs.dir.title', { count: badge.count })
}

/**
 * The tree's row filter: VCS metadata directories are hidden (display only), and in the
 * changes-only view only changed files plus the directories that contain changes survive.
 * Pure, so the view semantics can be exercised without a DOM.
 * @param overlay - the view model of `buildVcsOverlay` (`undefined` = not derived yet).
 * @param options - `{ changesOnly, hideMetadataDirs }`.
 * @returns a predicate over one tree entry.
 */
export function vcsRowFilter(overlay, { changesOnly, hideMetadataDirs }) {
  return (entry) => {
    if (entry === null || typeof entry !== 'object') return false
    if (hideMetadataDirs === true && entry.kind === 'directory' && isVcsMetadataName(entry.name)) return false
    if (changesOnly !== true || overlay === undefined) return true
    /* A file is kept only when it changed; a directory is kept when anything below it changed. */
    return entry.kind === 'directory'
      ? vcsDirectoryChanged(overlay, entry.path) || overlay.byPath.has(entry.path)
      : overlay.byPath.has(entry.path)
  }
}

/**
 * Directories the changes-only view must expand AND list: every directory that holds a change
 * (every ancestor of every changed path), minus the ones already expanded, already listed, or
 * already requested. Pure, so "auto-expand every changed directory" is testable without a DOM.
 * @param overlay - the view model of `buildVcsOverlay`.
 * @param sets - `{ expanded, ready, requested }` Sets of directory paths.
 * @returns the directory paths to expand and load now (may be empty).
 */
export function vcsPendingAutoExpand(overlay, { expanded, ready, requested } = {}) {
  const pending = []
  if (overlay === undefined || overlay.dirCounts === undefined) return pending
  for (const dir of overlay.dirCounts.keys()) {
    /* The workspace root is always expanded and listed. */
    if (dir === '') continue
    if (expanded?.has(dir) === true) continue
    if (ready?.has(dir) === true) continue
    if (requested?.has(dir) === true) continue
    pending.push(dir)
  }
  return pending
}

/**
 * The status bar's view model.
 * @param options - `{ payload, error, loading }`: the last payload (possibly stale), the last request error and the in-flight flag.
 * @returns `{ visible: false }` when the workspace has no repository, else the chip's content.
 */
export function vcsBarModel({ payload, error, loading }) {
  const kind = payload?.kind ?? null
  if (kind === null || payload?.enabled === false) return { visible: false }
  const failure = payload?.error ?? error
  const counts = payload?.counts ?? {}
  const total = Number.isFinite(counts.total) ? counts.total : 0
  let state = 'ready'
  let text = payload?.label ?? ''
  if (loading === true && payload === undefined) {
    state = 'loading'
    text = translate('vcs.bar.loading')
  } else if (payload?.available === false || failure?.code === 'vcs-unavailable') {
    state = 'warn'
    text = translate('vcs.bar.notAvailable', { tool: kind })
  } else if (failure !== undefined) {
    state = 'error'
    text = translate('vcs.bar.failed')
  }
  const retryable = state === 'error' || state === 'warn'
  return {
    visible: true,
    kind,
    state,
    label: text,
    count: total,
    truncated: payload?.truncated === true,
    /* A stale payload (a failure after a successful read) keeps its badges but says so. */
    stale: failure !== undefined && payload !== undefined,
    title: retryable
      ? `${translate('vcs.bar.aria')} · ${text} · ${translate('vcs.bar.retry')}`
      : `${translate('vcs.bar.aria')}${text === '' ? '' : ` · ${text}`} · ${translate('vcs.bar.changes', { count: total })} · ${translate('vcs.bar.retry')}`,
  }
}

/* The HOST's feature switch (`enableVcsStatus`), mirrored from the last payload so the settings
   page can explain why its version-control switches do nothing. `undefined` = not known yet (no
   explorer has read a payload in this page load), which the settings page treats as "enabled". */
let vcsHostEnabled
const vcsHostListeners = new Set()
/** Last reported Host switch value (`undefined` while unknown). */
export function readVcsHostEnabled() {
  return vcsHostEnabled
}
/** Subscribe to Host-switch changes; returns the unsubscribe. */
export function subscribeVcsHostEnabled(listener) {
  vcsHostListeners.add(listener)
  return () => { vcsHostListeners.delete(listener) }
}
/** Mirror the Host switch of one payload (called by the explorer hook after every successful read). */
export function reportVcsHostEnabled(value) {
  const next = value !== false
  if (next === vcsHostEnabled) return
  vcsHostEnabled = next
  for (const listener of vcsHostListeners) listener()
}
