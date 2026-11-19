/* Per-session music-page preferences.
 *
 * These live in the same preview-session snapshot as the tabs, so they are keyed by the
 * session (or mind-map family) the page belongs to: session A and session B keep separate
 * model/height choices, and closing the music tab does not forget them. The values are
 * UI state, so they stay client-side exactly like the preview snapshot itself.
 */
export const MUSIC_ROLL_HEIGHT_MIN = 180
export const MUSIC_ROLL_HEIGHT_MAX = 720
export const MUSIC_ROLL_HEIGHT_STEP = 16
export const MUSIC_MODEL_STRING_MAX = 200
export const MUSIC_ROLL_ZOOM_MIN = 0.75
export const MUSIC_ROLL_ZOOM_MAX = 3

export function defaultMusicPrefs() {
  return { model: null, rollHeight: null, rollZoomX: 1, rollZoomY: 1 }
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

export function normalizeMusicPrefs(value) {
  if (value === null || value === undefined || typeof value !== 'object') return defaultMusicPrefs()
  return {
    model: normalizeMusicModel(value.model),
    rollHeight: normalizeRollHeight(value.rollHeight),
    rollZoomX: normalizeRollZoom(value.rollZoomX),
    rollZoomY: normalizeRollZoom(value.rollZoomY),
  }
}

/** Whether a page carries any non-default preference (worth keeping even with no open tabs). */
export function hasMusicPrefs(prefs) {
  return prefs.model !== null || prefs.rollHeight !== null || prefs.rollZoomX !== 1 || prefs.rollZoomY !== 1
}

export function isFollowChatModel(model) {
  return model === null || model === undefined || model.mode === 'session'
}

/** Stable key for a model choice (the select's option values). */
export function musicModelKey(model) {
  if (isFollowChatModel(model)) return 'session'
  return `${model.provider}::${model.model}`
}

