/** Shared export surface for the music workshop.
 *
 *  The panel encodes the bytes (WAV / MIDI / score JSON) and uploads them to
 *  `POST /music/export`; this module is the one table both ends agree on — the format
 *  ids, their file extensions, the upload budget and the WAV parameter ranges. Keeping
 *  it shared means the Host can reject an unsupported format or a wrong extension
 *  without a second copy of the list drifting away from the dialog.
 */
import { MUSIC_FILE_SUFFIX } from './music-score.js'

/** Formats the export dialog offers. MP3 is intentionally absent: it needs a bundled
 *  encoder (a dependency decision), so the zero-dependency set is WAV + MIDI + score. */
export const MUSIC_EXPORT_FORMATS = Object.freeze(['wav', 'midi', 'json'])
export const MUSIC_EXPORT_EXTENSIONS = Object.freeze({
  json: MUSIC_FILE_SUFFIX,
  midi: '.mid',
  wav: '.wav',
})
/* The upload budget: 60 s of 48 kHz / 24-bit stereo is ~17 MB, so 96 MiB leaves room for
   long pieces without letting a stray request stream into the workspace unbounded. */
export const MUSIC_EXPORT_MAX_BYTES = 96 * 1024 * 1024
export const MUSIC_EXPORT_WAV_RATES = Object.freeze([44100, 48000])
export const MUSIC_EXPORT_WAV_DEPTHS = Object.freeze([16, 24])
/** 1 = mono, 2 = stereo. */
export const MUSIC_EXPORT_WAV_CHANNELS = Object.freeze([1, 2])

/** Extension of a supported format, or '' for an unknown id. */
export function musicExportExtension(format) {
  return MUSIC_EXPORT_EXTENSIONS[format] ?? ''
}

/** Suffixes stripped from the panel's name field, per format (the dialog shows the final
 *  extension as a fixed suffix, so a pasted `foo.music.json` must not become `foo.music.json.music.json`). */
const STRIPPED_SUFFIXES = Object.freeze({
  json: ['.music.json', '.json'],
  midi: ['.mid', '.midi'],
  wav: ['.wav'],
})

/** The user's base name with this format's own extension (if any) removed. */
export function stripMusicExportExtension(name, format) {
  if (typeof name !== 'string') return ''
  let base = name.trim()
  for (const suffix of STRIPPED_SUFFIXES[format] ?? []) {
    if (base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, -suffix.length).trim()
      break
    }
  }
  return base
}

/** The final file name: a non-empty base plus exactly one extension. Empty base -> ''. */
export function musicExportFileName(format, name) {
  const extension = musicExportExtension(format)
  const base = stripMusicExportExtension(name, format)
  if (extension === '' || base === '') return ''
  return `${base}${extension}`
}
