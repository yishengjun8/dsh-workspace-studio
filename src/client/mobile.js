import { useSyncExternalStore } from 'react'
import { MOBILE_CLASS, MOBILE_DRAWER_CLASS, MOBILE_FILES_CLASS } from './constants.js'

/* ---- Mobile mode state ---- The document classes are the single source of truth (CSS gates and this store read the same classes), so a remount re-derives state. Components subscribe via useMobile(); setMobile turns the gate on (opens the drawer) or off (clears the drawer/files sub-states). */
function mobileState() {
  return {
    on: document.documentElement.classList.contains(MOBILE_CLASS),
    drawerOpen: document.documentElement.classList.contains(MOBILE_DRAWER_CLASS),
    files: document.documentElement.classList.contains(MOBILE_FILES_CLASS),
  }
}
let mobileSnapshot = typeof document === 'undefined' ? { on: false, drawerOpen: false, files: false } : mobileState()
const mobileListeners = new Set()
function notifyMobile() { mobileSnapshot = mobileState(); for (const listener of mobileListeners) listener() }
const mobileFace = {
  subscribe(callback) { mobileListeners.add(callback); return () => { mobileListeners.delete(callback) } },
  getSnapshot() { return mobileSnapshot },
}
export function setMobile(on) {
  document.documentElement.classList.toggle(MOBILE_CLASS, on)
  if (on) document.documentElement.classList.add(MOBILE_DRAWER_CLASS)
  else {
    document.documentElement.classList.remove(MOBILE_DRAWER_CLASS)
    document.documentElement.classList.remove(MOBILE_FILES_CLASS)
  }
  notifyMobile()
}
export function setDrawerOpen(open) { document.documentElement.classList.toggle(MOBILE_DRAWER_CLASS, open); notifyMobile() }
export function setMobileFiles(open) { document.documentElement.classList.toggle(MOBILE_FILES_CLASS, open); notifyMobile() }
export function useMobile() { return useSyncExternalStore(mobileFace.subscribe, mobileFace.getSnapshot) }