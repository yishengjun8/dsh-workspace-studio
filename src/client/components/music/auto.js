/* Pure helpers for the chat auto-generation flow.
 *
 * Kept out of MusicDock so the naming/retry rules are testable without React: an automatic
 * save/export must never overwrite an existing file, and the exported audio must use the base
 * name the score was saved under.
 */
import { MUSIC_EXPORT_FORMATS } from '../../../shared/music-export.js'
import { MUSIC_FILE_SUFFIX } from '../../../shared/music-score.js'

const AUTO_NAME_MAX = 60

/** A title is free text, but a file name is not: same replacement as the panel's save dialog. */
function safeName(value) {
  return String(value ?? '').replace(/[\\/:*?"<>|]/gu, '-').trim()
}

/** Drop the score suffix (`.music.json`) from a base name; other suffixes are left alone. */
function stripScoreSuffix(name) {
  return name.toLowerCase().endsWith(MUSIC_FILE_SUFFIX)
    ? name.slice(0, -MUSIC_FILE_SUFFIX.length).trim()
    : name
}

/** The save base for a piece: the requested name, else the title, sanitised and suffix-free. */
export function autoScoreBase(value, fallback = '未命名作品') {
  const text = stripScoreSuffix(safeName(value))
  return (text || fallback).slice(0, AUTO_NAME_MAX)
}

/** The first `<base>` whose `.music.json` file is not in `files` (`file.name` values). */
export function uniqueScoreBase(files, base) {
  const taken = new Set((Array.isArray(files) ? files : []).map(file => String(file?.name ?? '').toLowerCase()))
  const root = autoScoreBase(base)
  const keyOf = name => `${name}${MUSIC_FILE_SUFFIX}`.toLowerCase()
  if (!taken.has(keyOf(root))) return root
  for (let index = 2; index <= 50; index += 1) {
    const candidate = `${root} (${index})`
    if (!taken.has(keyOf(candidate))) return candidate
  }
  return `${root} ${Date.now()}`
}

/** The export format for one job: an explicit choice, `none`, or the page's last dialog choice. */
export function autoExportFormat(jobFormat, prefs) {
  if (jobFormat === 'none') return 'none'
  if (MUSIC_EXPORT_FORMATS.includes(jobFormat)) return jobFormat
  return MUSIC_EXPORT_FORMATS.includes(prefs?.format) ? prefs.format : 'wav'
}

/** Attempt N of an export name: `base`, `base (2)`, `base (3)` … (no overwrite, ever). */
export function exportAttemptName(base, attempt) {
  const root = typeof base === 'string' && base !== '' ? base : '未命名作品'
  return attempt <= 1 ? root : `${root} (${attempt})`
}
