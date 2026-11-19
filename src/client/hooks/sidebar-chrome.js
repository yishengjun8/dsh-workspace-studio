import { useLayoutEffect, useRef, useState } from 'react'
import { PANEL_DOCK_HEIGHT_VAR, PANEL_NAV_HEIGHT_VAR } from '../constants.js'

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
      /* The two-region switch belongs above the scroller, right under New Session:
         anchor it on the shell's scroll region rather than on a direct-child button.
         The shell used to carry its brand as a bare `button` here, so "before the
         first direct button" doubled as "before the scroller"; since the brand moved
         into its logoRow the query returns null and the row was APPENDED after the
         scroller, where it (a) rendered below the session list and (b) stole the
         panel dock's slot (dev-notes §55). Re-anchor every pass: a collapsed rail
         unmounts and remounts wide content, so the row can come back misplaced. */
      const scrollRegion = rootDiv.querySelector(':scope > div[class*="scrollRegion"]')
      let top = rootDiv.querySelector(':scope > .dsh-ws-sidebar-top-actions')
      if (top === null) {
        top = document.createElement('div')
        top.className = 'dsh-ws-sidebar-top-actions'
      }
      if (scrollRegion !== null && scrollRegion.parentElement === rootDiv) {
        if (top.parentElement !== rootDiv || top.nextElementSibling !== scrollRegion) {
          rootDiv.insertBefore(top, scrollRegion)
        }
      } else if (top.parentElement !== rootDiv || rootDiv.firstElementChild !== top) {
        rootDiv.insertBefore(top, rootDiv.firstElementChild)
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
            /* The shell's wheel hand-off listens on the sidebar viewport (bubble) and moves only
               the harness section scroller it knows about. Our tree is that scroller's sibling, so
               the hand-off would cancel the wheel and scroll the hidden session list instead — the
               files panel would not scroll at all. Keep the event from reaching that listener; not
               calling preventDefault here leaves native wheel/trackpad scrolling untouched. */
            files.addEventListener('wheel', event => { event.stopPropagation() }, { passive: true })
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
    /* The global panel list docks into the foot (styles.js): the shell keeps it
       inside its shared scroller, so CSS pins it below that scroller and needs two
       measured numbers — the list's own height (the slot reserved above Settings)
       and the distance from the scroller's bottom edge to that slot (how far the
       list hangs below the scroller). Both change with the pinned panels, the
       collapsed rail, the locale and whatever seats the shell adds or removes
       between the two, so measure the geometry rather than deriving it from the
       footer row's height (1.0.127 exposed that assumption: a row inserted below
       the scroller shifted the slot by 46px and the list covered Mobile mode). */
    let dockNav = null
    let dockFoot = null
    let dockRegion = null
    let dockSettings = null
    const dockOffset = () => {
      if (dockRegion === null || dockSettings === null) return 0
      const region = dockRegion.getBoundingClientRect()
      const settings = dockSettings.getBoundingClientRect()
      /* A hidden Settings seat (Windows collapsed rail) owns no slot: dock at the
         scroller's bottom edge, as the CSS rule for that state does. */
      if (settings.width === 0 && settings.height === 0) return 0
      const bottom = region.top + dockRegion.clientTop + dockRegion.clientHeight
      return Math.max(0, Math.round(settings.top - bottom))
    }
    const measureDock = () => {
      aside.style.setProperty(PANEL_NAV_HEIGHT_VAR, `${dockNav === null ? 0 : dockNav.offsetHeight}px`)
      aside.style.setProperty(PANEL_DOCK_HEIGHT_VAR, `${dockOffset()}px`)
    }
    const dockObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureDock)
    const syncDock = () => {
      const nav = aside.querySelector('[data-slot="sidebar"] > div > div[class*="scrollRegion"] > div[class*="scrollArea"] > nav')
      const foot = aside.querySelector('[data-slot="sidebar"] > div > div[class*="footArea"] > div[class*="footerActions"]')
      const region = aside.querySelector('[data-slot="sidebar"] > div > div[class*="scrollRegion"]')
      const settings = aside.querySelector('[data-slot="sidebar"] > div > div[class*="footArea"] > div[class*="settingsArea"]')
      const bind = (node, previous) => {
        if (node === previous) return previous
        if (previous !== null) dockObserver?.unobserve(previous)
        if (node !== null) dockObserver?.observe(node)
        return node
      }
      dockNav = bind(nav, dockNav)
      dockFoot = bind(foot, dockFoot)
      dockRegion = bind(region, dockRegion)
      dockSettings = bind(settings, dockSettings)
      measureDock()
    }
    let current = ensure()
    syncDock()
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
        syncDock()
        if (next === null) return
        setSidebarChrome(prev => (prev !== null && prev.top === next.top && prev.files === next.files
          && prev.fallback === next.fallback && prev.header === next.header && groupsEqual(prev.groups, next.groups) ? prev : next))
      })
    })
    observer.observe(aside, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      dockObserver?.disconnect()
      aside.style.removeProperty(PANEL_NAV_HEIGHT_VAR)
      aside.style.removeProperty(PANEL_DOCK_HEIGHT_VAR)
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
