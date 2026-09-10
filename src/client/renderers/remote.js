/* Standard workspace-files Remote faces (ctx.remote.workspaceFiles) installed
   by mountStudio when the harness Remote service is available; the renderer
   views degrade to a failure line on harness builds without it. Module-level
   holder + subscription, the same pattern as the locale service bridge. */
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
