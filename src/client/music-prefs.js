import { MUSIC_ZOOM_MAX, MUSIC_ZOOM_MIN } from './constants.js'
import {
  MUSIC_EXPORT_FORMATS,
  MUSIC_EXPORT_WAV_CHANNELS,
  MUSIC_EXPORT_WAV_DEPTHS,
  MUSIC_EXPORT_WAV_RATES,
} from '../shared/music-export.js'

/* Per-session music-page preferences.
 *
 * They live in the same preview-session snapshot as the tabs, keyed by the session (or
 * mind-map family) the page belongs to, so sessions keep separate model/height choices
 * and closing the music tab does not forget them. UI state, so client-side exactly like
 * the snapshot itself.
 */
export const MUSIC_ROLL_HEIGHT_MIN = 180
export const MUSIC_ROLL_HEIGHT_MAX = 720
export const MUSIC_ROLL_HEIGHT_STEP = 16
export const MUSIC_MODEL_STRING_MAX = 200
export const MUSIC_ROLL_ZOOM_MIN = MUSIC_ZOOM_MIN
export const MUSIC_ROLL_ZOOM_MAX = MUSIC_ZOOM_MAX
export const MUSIC_ARRANGE_ZOOM_MIN = MUSIC_ZOOM_MIN
export const MUSIC_ARRANGE_ZOOM_MAX = MUSIC_ZOOM_MAX

export function defaultMusicPrefs() {
  return { arrangeZoom: 1, export: defaultMusicExportPrefs(), model: null, rollHeight: null, rollZoomX: 1, rollZoomY: 1 }
}

/** The export dialog's last choices: format + its parameters. Path always follows the piece,
 *  so it is deliberately not remembered. */
export function defaultMusicExportPrefs() {
  return {
    format: 'wav',
    json: { prompt: true },
    midi: { drums: 'gm', swing: 'bake' },
    wav: { channels: 2, depth: 16, rate: 44100 },
  }
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

export function normalizeMusicExportPrefs(value) {
  const defaults = defaultMusicExportPrefs()
  if (value === null || value === undefined || typeof value !== 'object') return defaults
  const wav = value.wav !== null && typeof value.wav === 'object' ? value.wav : {}
  const midi = value.midi !== null && typeof value.midi === 'object' ? value.midi : {}
  const json = value.json !== null && typeof value.json === 'object' ? value.json : {}
  return {
    format: pick(value.format, MUSIC_EXPORT_FORMATS, defaults.format),
    json: { prompt: json.prompt !== false },
    midi: {
      drums: pick(midi.drums, ['gm', 'track'], defaults.midi.drums),
      swing: pick(midi.swing, ['bake', 'grid'], defaults.midi.swing),
    },
    wav: {
      /* Numeric settings arrive as numbers from the dialog; tolerate strings from an old snapshot. */
      channels: pick(Number(wav.channels), MUSIC_EXPORT_WAV_CHANNELS, defaults.wav.channels),
      depth: pick(Number(wav.depth), MUSIC_EXPORT_WAV_DEPTHS, defaults.wav.depth),
      rate: pick(Number(wav.rate), MUSIC_EXPORT_WAV_RATES, defaults.wav.rate),
    },
  }
}

/**
 * Normalize one model choice.
 * - null/undefined -> follow the chat session (the default)
 * - { mode: 'session' } -> follow the chat session
 * - { provider, model } -> a fixed route
 * Anything malformed falls back to "follow the chat".
 */
export function normalizeMusicModel(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return null
  if (value.mode === 'session') return { mode: 'session' }
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return null
  if (provider.length > MUSIC_MODEL_STRING_MAX || model.length > MUSIC_MODEL_STRING_MAX) return null
  return { provider, model }
}

/** The roll viewport height in pixels, or null for the automatic (content-sized) height. */
export function normalizeRollHeight(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(MUSIC_ROLL_HEIGHT_MAX, Math.max(MUSIC_ROLL_HEIGHT_MIN, Math.round(number)))
}

export function normalizeRollZoom(value) {
  if (value === null || value === undefined) return 1
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(MUSIC_ROLL_ZOOM_MAX, Math.max(MUSIC_ROLL_ZOOM_MIN, Math.round(number * 20) / 20))
}

export function normalizeArrangeZoom(value) {
  if (value === null || value === undefined) return 1
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(MUSIC_ARRANGE_ZOOM_MAX, Math.max(MUSIC_ARRANGE_ZOOM_MIN, Math.round(number * 20) / 20))
}

export function normalizeMusicPrefs(value) {
  if (value === null || value === undefined || typeof value !== 'object') return defaultMusicPrefs()
  return {
    arrangeZoom: normalizeArrangeZoom(value.arrangeZoom),
    export: normalizeMusicExportPrefs(value.export),
    model: normalizeMusicModel(value.model),
    rollHeight: normalizeRollHeight(value.rollHeight),
    rollZoomX: normalizeRollZoom(value.rollZoomX),
    rollZoomY: normalizeRollZoom(value.rollZoomY),
  }
}

/** Whether a page carries any non-default preference (worth keeping even with no open tabs). */
export function hasMusicPrefs(prefs) {
  return prefs.arrangeZoom !== 1
    || prefs.model !== null
    || prefs.rollHeight !== null
    || prefs.rollZoomX !== 1
    || prefs.rollZoomY !== 1
    || JSON.stringify(normalizeMusicExportPrefs(prefs?.export)) !== JSON.stringify(defaultMusicExportPrefs())
}

export function isFollowChatModel(model) {
  return model === null || model === undefined || model.mode === 'session'
}

/** Stable key for a model choice (the select's option values). */
export function musicModelKey(model) {
  if (isFollowChatModel(model)) return 'session'
  return `${model.provider}::${model.model}`
}

