import { useSyncExternalStore } from 'react'
import { MOBILE_CLASS, MOBILE_DRAWER_CLASS, MOBILE_FILES_CLASS } from './constants.js'

/* ---- Mobile mode state ---- The document classes are the single source of truth (CSS gates and this store read the same classes), so a remount re-derives state. */
function mobileState() {
  return {
    on: document.documentElement.classList.contains(MOBILE_CLASS),
    drawerOpen: document.documentElement.classList.contains(MOBILE_DRAWER_CLASS),
    files: document.documentElement.classList.contains(MOBILE_FILES_CLASS),
  }
}
let mobileSnapshot = typeof document === 'undefined' ? { on: false, drawerOpen: false, files: false } : mobileState()
const mobileListeners = new Set()
/* Publish only when a field actually changed, so the snapshot object keeps its identity between no-op transitions. */
function notifyMobile() {
  const next = mobileState()
  const previous = mobileSnapshot
  if (next.on === previous.on && next.drawerOpen === previous.drawerOpen && next.files === previous.files) return
  mobileSnapshot = next
  for (const listener of [...mobileListeners]) listener()
}
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
/* Sub-state setters are no-ops while mobile mode is off, or a stray gate class would linger on <html>. */
export function setDrawerOpen(open) {
  if (!document.documentElement.classList.contains(MOBILE_CLASS)) return
  document.documentElement.classList.toggle(MOBILE_DRAWER_CLASS, open)
  notifyMobile()
}
export function setMobileFiles(open) {
  if (!document.documentElement.classList.contains(MOBILE_CLASS)) return
  document.documentElement.classList.toggle(MOBILE_FILES_CLASS, open)
  notifyMobile()
}
export function useMobile() { return useSyncExternalStore(mobileFace.subscribe, mobileFace.getSnapshot) }