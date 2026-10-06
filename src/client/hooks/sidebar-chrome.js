import { useLayoutEffect, useRef, useState } from 'react'

/**
 * @param options.collections - whether the workspace-collection dropdown is active (it owns the
 *   section title only while the Harness groups by workspace): the seat is created and removed with
 *   that flag, so switching the view option leaves the Harness label untouched.
 */
export function useSidebarChrome(options = {}) {
  const collectionsActive = options.collections === true
  const asideRef = useRef(null)
  // The harness sidebar shell owns the New Session button and the browsing region,
  // so this plugin creates its own DOM containers inside it (top actions row, files
  // region seat, one mind-map seat per workspace group or a single fallback seat)
  // and renders its own React content into them via portals.
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
      let header = null
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
          /* Collection seat: the section-title row (label + search + view options + add). The seat
             sits before the Harness label, which CSS hides only while this seat exists; removing the
             seat (view option changed away from 按工作区) restores the label as it was. */
          if (collectionsActive) {
            const label = workspacesOutlet.querySelector('[class*="sectionLabel"]')
            const sectionHeader = label === null ? null : label.parentElement
            if (sectionHeader !== null) {
              header = sectionHeader.querySelector(':scope > .dsh-ws-sidebar-collections')
              if (header === null) {
                header = document.createElement('div')
                header.className = 'dsh-ws-sidebar-collections'
                sectionHeader.insertBefore(header, label)
              }
            }
          } else {
            workspacesOutlet.querySelector('[class*="sectionLabel"]')?.parentElement
              ?.querySelector(':scope > .dsh-ws-sidebar-collections')?.remove()
          }
          /* Mind-map seats: one container per workspace group section, so
             entries live inside their workspace's session list; flat/search
             modes use a single region-area seat at the bottom. */
          for (const groupHeader of workspacesOutlet.querySelectorAll('[role="treeitem"][aria-expanded]')) {
            const section = groupHeader.parentElement
            if (section === null) continue
            let container = section.querySelector(':scope > .dsh-ws-sidebar-mindmaps')
            if (container === null) {
              container = document.createElement('div')
              container.className = 'dsh-ws-sidebar-mindmaps'
              section.append(container)
            }
            /* Keep the seat above the group's "show more sessions" button, re-anchoring on every pass. */
            const overflow = section.querySelector(':scope > button[aria-expanded]')
            if (overflow !== null) section.insertBefore(container, overflow)
            const titleEl = groupHeader.querySelector('span[class*="title"]')
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
            /* Grouped mode: drop any stale region-area seat from a previous flat/search pass. */
            regionArea.querySelector(':scope > .dsh-ws-sidebar-mindmaps-fallback')?.remove()
          }
        }
      }
      return { top, files, fallback, header, groups }
    }
    const groupsEqual = (a, b) => a.length === b.length
      && a.every((group, index) => group.container === b[index]?.container && group.title === b[index]?.title)
    let current = ensure()
    if (current !== null) setSidebarChrome(current)
    /* Coalesce mutation bursts to one ensure() per frame. */
    let scheduled = false
    let rafId = 0
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      rafId = requestAnimationFrame(() => {
        scheduled = false
        rafId = 0
        const next = ensure()
        if (next === null) return
        setSidebarChrome(prev => (prev !== null && prev.top === next.top && prev.files === next.files
          && prev.fallback === next.fallback && prev.header === next.header && groupsEqual(prev.groups, next.groups) ? prev : next))
      })
    })
    observer.observe(aside, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (scheduled) {
        scheduled = false
        if (rafId !== 0) cancelAnimationFrame(rafId)
      }
      setSidebarChrome(null)
      aside.querySelectorAll('.dsh-ws-sidebar-top-actions, .dsh-ws-sidebar-files, .dsh-ws-sidebar-collections, .dsh-ws-sidebar-mindmaps').forEach(node => node.remove())
    }
  }, [collectionsActive])
  return { asideRef, sidebarChrome }
}
