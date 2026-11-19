/** Persistence-row primitives shared by the session-log caches (mind-map, token stats).
 *
 * `persistence.list()` answers `{ header, revision, sizeBytes }` snapshots — never flat headers
 * (a flat read silently matched nothing and degraded every consumer to live-only), and a legacy
 * generation's `revision` is `${fileRevision}:${corpusRevision}`. Both facts used to live in each
 * consumer; here they live once so a cache key cannot drift from its sibling.
 */
import { isPlainObject } from './errors.js'

/** The `header` of one `persistence.list()` row, or undefined when the row is malformed. */
export function sessionRowHeader(row) {
  const header = isPlainObject(row) ? row.header : undefined
  return isPlainObject(header) ? header : undefined
}

/** The session id of one `persistence.list()` row, or undefined when the row is malformed. */
export function sessionRowId(row) {
  const id = sessionRowHeader(row)?.id
  return id === undefined || id === null ? undefined : String(id)
}

/* A legacy-generation row's revision is `${fileRevision}:${corpusRevision}`; the corpus part is a
   sha256 over EVERY log in the store, so it changes whenever any unrelated session appends and a
   revision-keyed cache misses on virtually every refresh in an active store (measured: the 21
   legacy members of a 23-session mind-map family re-read per request, 40-55 s each, Host CPU
   pinned at 1.0-1.7 cores; token-stats re-scanned 1100+ legacy sessions per pass). Only the
   per-session PHYSICAL part is kept: an equal fileRevision really means "this log did not move",
   which is all a cache needs. `sizeBytes` rides along as a second, backend-independent change
   signal. A revision that is not the legacy shape — or lacks sizeBytes (an unmaterialized pending
   row) — keeps its verbatim revision, so an unrecognized backend degrades to READING, never to
   skipping. */
const LEGACY_REVISION_RE = /^([^:]+(?::[^:]+){4}):[0-9a-f]{64}$/u

/** Stable per-session cache key for one `persistence.list()` row (undefined = no key: always re-read). */
export function sessionRowFingerprint(row) {
  const revision = isPlainObject(row) ? row.revision : undefined
  if (typeof revision !== 'string' || revision === '') return undefined
  const size = row.sizeBytes
  if (!Number.isSafeInteger(size) || size < 0) return revision
  const legacy = LEGACY_REVISION_RE.exec(revision)
  const physical = legacy === null ? revision : legacy[1]
  return `${physical}\u0001${size}`
}
