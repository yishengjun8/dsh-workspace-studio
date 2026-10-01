/** Quarantine for persisted Host content this code can no longer use.
 *
 * The plugin reads every persisted file of its own in exactly ONE format: whatever does not
 * satisfy the current schema is unusable in every version of this code, so it is moved aside
 * instead of being migrated. "Moved aside" rather than deleted because two of these stores hold
 * user content that has no other copy — a staged draft is the user's unsaved edit and a mind-map
 * document is the user's map structure — while a rename has exactly the same effect on behaviour
 * (the reader falls back to its defaults / rebuilds) and leaves a recovery path. Swap the rename
 * for an unlink in quarantineFile() if irrecoverable deletion is ever wanted.
 *
 * Discipline (see the per-store call sites):
 *   - only a file that was READ SUCCESSFULLY and then failed its schema is quarantined; a missing
 *     file and an IO/permission failure are never treated as corruption;
 *   - callers that share a store with a concurrent writer re-read under the store's lock before
 *     quarantining, so a document written between the failed read and the rename is not lost;
 *   - the quarantine directory lives INSIDE the store's own directory (drafts/<ws>/<owner>/.corrupt,
 *     mindmap/.corrupt, …), so a directory scan that looks for `*.json` files never picks it up;
 *   - entries older than the retention window are swept on every quarantine write, which bounds
 *     the disk cost without a background task.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const QUARANTINE_DIR_NAME = '.corrupt'
/* Same window as the draft tombstones: long enough to notice and recover, short enough that a
   repeatedly-corrupted store cannot grow without bound. */
const QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function warn(logger, message) {
  if (typeof logger?.warn === 'function') logger.warn(message)
  else console.warn(message)
}

/* Filesystem-safe, chronological suffix (no colons: Windows rejects them in a name). */
function stampSuffix() {
  return `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomBytes(4).toString('hex')}`
}

async function sweepQuarantine(directory) {
  const cutoff = Date.now() - QUARANTINE_RETENTION_MS
  let entries
  try {
    entries = await readdir(directory)
  } catch {
    return
  }
  for (const entry of entries) {
    const target = join(directory, entry)
    try {
      const info = await stat(target)
      if (info.mtimeMs >= cutoff) continue
      await unlink(target)
    } catch { /* a raced removal (or an unreadable entry) only skips the sweep */ }
  }
}

/**
 * Move one unusable persisted file into its store's quarantine directory.
 * Never throws: a failure to quarantine only means the file stays where it is (the caller still
 * degrades to its defaults), which is strictly better than failing the request.
 * @returns whether the file was moved.
 */
export async function quarantineFile(target, reason, logger) {
  const directory = join(dirname(target), QUARANTINE_DIR_NAME)
  const destination = join(directory, `${basename(target)}.${stampSuffix()}`)
  try {
    await mkdir(directory, { recursive: true })
    await rename(target, destination)
  } catch (error) {
    warn(logger, `[workspace-studio] could not quarantine ${target}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  warn(logger, `[workspace-studio] quarantined unusable ${target} (${reason}) as ${destination}`)
  void sweepQuarantine(directory).catch(() => {})
  return true
}
