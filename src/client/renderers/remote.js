/* Standard workspace-files Remote faces installed by mountStudio when the harness Remote service is available; renderer views degrade to a failure line without it. */
import { useSyncExternalStore } from 'react'

let faces = undefined
const listeners = new Set()

/* Install the read faces; returns the disposer (uninstall on plugin teardown). */
export function installRemoteFaces(next) {
  faces = next
  for (const listener of [...listeners]) listener()
  return () => {
    if (faces !== next) return
    faces = undefined
    for (const listener of [...listeners]) listener()
  }
}

/* Imperative read for callbacks/effects; undefined while the Remote is absent. */
export function remoteFaces() {
  return faces
}

/* Reactive read for components: re-renders when the faces install/uninstall. */
export function useRemoteFaces() {
  return useSyncExternalStore(
    callback => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    () => faces,
  )
}

/* Office conversion face, kept in its own store: the harness mounts it under a
   different service (`remote.officeToPdf`) that activates independently of
   `remote.workspaceFiles`, so one store per service keeps either install from
   clobbering the other (and keeps `undefined` meaning exactly "not available",
   which is what the views check before every call). */
let officeFaces = undefined
const officeListeners = new Set()

/* Install the Office→PDF conversion face; returns the disposer. */
export function installOfficeFaces(next) {
  officeFaces = next
  for (const listener of [...officeListeners]) listener()
  return () => {
    if (officeFaces !== next) return
    officeFaces = undefined
    for (const listener of [...officeListeners]) listener()
  }
}

/* Reactive read for components: re-renders when the Office face installs. */
export function useOfficeFaces() {
  return useSyncExternalStore(
    callback => {
      officeListeners.add(callback)
      return () => { officeListeners.delete(callback) }
    },
    () => officeFaces,
  )
}
