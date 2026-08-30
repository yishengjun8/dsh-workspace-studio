/** Harness sidebar shell seats: the shell owns its slots and they cannot be
 *  redeclared by this plugin, so two DOM containers are created inside the
 *  shell (the top actions row and the files region seat) and this plugin
 *  renders its own React content into them via portals. The observer here
 *  re-asserts the containers on structural rebuilds; in-place React updates
 *  leave foreign nodes alone, so nothing flickers. */
import { useLayoutEffect, useRef, useState } from 'react'

export function useSidebarChrome() {
  const asideRef = useRef(null)
  // The harness sidebar shell owns the New Session button and the browsing
  // region, and its slots cannot be redeclared by this plugin. Instead two
  // DOM containers are created inside the shell — the top actions row
  // (replacing the hidden New Session button) and the files region seat —
  // and this plugin renders its own React content into them via portals. The
  // observer re-asserts the containers on structural rebuilds; in-place React
  // updates leave foreign nodes alone, so nothing flickers.
  const [sidebarChrome, setSidebarChrome] = useState(null)
  useLayoutEffect(() => {
    const aside = asideRef.current
    if (aside === null) return undefined
    const ensure = () => {
      const rootDiv = aside.querySelector('[data-slot="sidebar"] > div')
      if (rootDiv === null) return null
      let top = rootDiv.querySelector(':scope > .dsh-ws-sidebar-top-actions')
      if (top === null) {
        top = document.createElement('div')
        top.className = 'dsh-ws-sidebar-top-actions'
        rootDiv.insertBefore(top, rootDiv.querySelector(':scope > button'))
      }
      const workspacesOutlet = rootDiv.querySelector(':scope [data-slot="sidebar.workspaces"]')
      let files = null
      let fallback = null
      const groups = []
      if (workspacesOutlet !== null) {
        const regionArea = workspacesOutlet.parentElement
        if (regionArea !== null) {
          files = regionArea.querySelector(':scope > .dsh-ws-sidebar-files')
          if (files === null) {
            files = document.createElement('div')
            files.className = 'dsh-ws-sidebar-files'
            regionArea.append(files)
          }
          /* Mind-map seats: one container per workspace group section (after
             its session rows), so entries live inside their workspace's
             session list. Sections are recognized by the header row
             (`role="treeitem"` with `aria-expanded`); the header title names
             the workspace. Flat/search modes have no sections — a single
             region-area seat at the bottom covers them. */
          for (const header of workspacesOutlet.querySelectorAll('[role="treeitem"][aria-expanded]')) {
            const section = header.parentElement
            if (section === null) continue
            let container = section.querySelector(':scope > .dsh-ws-sidebar-mindmaps')
            if (container === null) {
              container = document.createElement('div')
              container.className = 'dsh-ws-sidebar-mindmaps'
              section.append(container)
            }
            /* Keep the seat above the group's "show more sessions" button:
               React appends that button after the seat when it appears, so
               re-anchor it on every pass (insertBefore is a no-op when the
               seat already sits right before the button). */
            const overflow = section.querySelector(':scope > button[aria-expanded]')
            if (overflow !== null) section.insertBefore(container, overflow)
            const titleEl = header.querySelector('span[class*="title"]')
            groups.push({ container, title: titleEl?.textContent?.trim() ?? '' })
          }
          if (groups.length === 0) {
            fallback = regionArea.querySelector(':scope > .dsh-ws-sidebar-mindmaps-fallback')
            if (fallback === null) {
              fallback = document.createElement('div')
              fallback.className = 'dsh-ws-sidebar-mindmaps dsh-ws-sidebar-mindmaps-fallback'
              regionArea.append(fallback)
            }
          } else {
            /* Grouped mode: drop any stale region-area seat from a previous
               flat / search pass. */
            regionArea.querySelector(':scope > .dsh-ws-sidebar-mindmaps-fallback')?.remove()
          }
        }
      }
      return { top, files, fallback, groups }
    }
    const groupsEqual = (a, b) => a.length === b.length
      && a.every((group, index) => group.container === b[index]?.container && group.title === b[index]?.title)
    let current = ensure()
    if (current !== null) setSidebarChrome(current)
    const observer = new MutationObserver(() => {
      const next = ensure()
      if (next === null) return
      setSidebarChrome(prev => (prev !== null && prev.top === next.top && prev.files === next.files
        && prev.fallback === next.fallback && groupsEqual(prev.groups, next.groups) ? prev : next))
    })
    observer.observe(aside, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      setSidebarChrome(null)
      aside.querySelectorAll('.dsh-ws-sidebar-top-actions, .dsh-ws-sidebar-files, .dsh-ws-sidebar-mindmaps').forEach(node => node.remove())
    }
  }, [])
  return { asideRef, sidebarChrome }
}
