import { useSyncExternalStore } from 'react'
import { zh } from './zh.js'
import { en } from './en.js'

export const EXPLORER_LOCALE_NS = 'workspace.studio'

/* LocaleRuntime face (subscribe/getSnapshot pair) once the harness locale plugin is present; undefined keeps the zh dictionary. */
let localeFace = undefined
/* Active-locale translator; bound to the harness locale registry when available, else falls back to the zh dictionary. */
let boundTranslate = zhFallbackTranslate
/* Locale subscription bridge: useLocaleText registers on this set, and the locale-activation effect bumps the epoch and forwards the service's notifications through it. */
const localeListeners = new Set()
let localeEpoch = 0

export function zhFallbackTranslate(key, params) {
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
}

function notifyLocaleListeners() {
  for (const listener of [...localeListeners]) listener()
}

/* Re-renders the calling component whenever the active locale (or dictionary registry) changes. */
export function useLocaleText() {
  return useSyncExternalStore(
    callback => {
      localeListeners.add(callback)
      return () => { localeListeners.delete(callback) }
    },
    () => `${localeEpoch}:${localeFace === undefined ? 0 : localeFace.getSnapshot().revision}`,
  )
}

/* Whether the active surface is Chinese (no locale service counts as Chinese). */
export function localeIsZh() {
  return localeFace === undefined || localeFace.getSnapshot().active !== 'en'
}

/* Current translator: the harness-bound one when the locale service is active, else the zh fallback. */
export function translate(key, params) {
  return boundTranslate(key, params)
}

/* Wire the harness locale service: register this plugin's dictionaries, bind the active-locale translator, and forward the service's notifications into the module-level listener set. Returns the dispose function. */
export function installLocaleService(service) {
  const disposeDicts = service.register(EXPLORER_LOCALE_NS, { zh, en })
  boundTranslate = service.bind(EXPLORER_LOCALE_NS)
  localeFace = service
  const unsubscribeService = typeof service.subscribe === 'function'
    ? service.subscribe(notifyLocaleListeners)
    : undefined
  localeEpoch += 1
  notifyLocaleListeners()
  return () => {
    if (typeof unsubscribeService === 'function') unsubscribeService()
    disposeDicts()
    localeFace = undefined
    boundTranslate = zhFallbackTranslate
    localeEpoch += 1
    notifyLocaleListeners()
  }
}
