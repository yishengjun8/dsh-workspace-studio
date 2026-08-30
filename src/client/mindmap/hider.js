import { MINDMAP_HIDER_THROTTLE_MS } from '../constants.js'
import { isMindmapFamilySession } from './panel.js'
import { mindmapRegistry } from './registry.js'

/* Hides mind-map family sessions (root + every fork descendant) from the
   sidebar list; each mind map is shown by its self-drawn entry instead.
   Rows are matched by title and rescanned on every DOM mutation / index
   change. A title hides a row only when every session with that title is
   hidden (a visible non-mindmap sharing it keeps it visible); archived
   sessions add no titles and the clearing pass self-heals bad rows. */

export function installMindmapBranchHider(getSessionList, getArchivedSessionIds, getWorkspaces) {
  if (typeof document === 'undefined') return () => {}
  let timer = 0
  let lastRun = 0
  /* Original textContent of every overflow button whose count this hider
     patched, so the number can be restored when the patch no longer applies
     (all docs gone, group fully hidden, or dispose) — the harness re-renders
     the button on session changes, but a static group would keep the patched
     small number forever. */
  const patchedButtons = new WeakMap()
  const restoreButtonText = (button) => {
    const original = patchedButtons.get(button)
    if (original !== undefined) {
      button.textContent = original
      patchedButtons.delete(button)
    }
  }
  const apply = () => {
    timer = 0
    lastRun = Date.now()
    /* Re-anchor the observer to the sidebar slot whenever this runs: the slot
       may have appeared (initial fallback was body) or been re-created. */
    ensureObserved()
    /* No mind-map docs: skip the session walk (the observer fires on every
       body mutation) but clear any applied hidden class so rows self-heal
       the moment the last doc disappears. */
    if (mindmapRegistry.getDocs().length === 0) {
      const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
      if (browser !== null) {
        for (const row of browser.querySelectorAll('[role="treeitem"].dsh-ws-mindmap-hidden-row')) {
          row.classList.remove('dsh-ws-mindmap-hidden-row')
        }
        for (const button of browser.querySelectorAll('button.dsh-ws-mindmap-no-overflow')) {
          button.classList.remove('dsh-ws-mindmap-no-overflow')
          restoreButtonText(button)
        }
      }
      return
    }
    const list = getSessionList()
    const archived = new Set((getArchivedSessionIds?.() ?? []).map(String))
    const byTitle = new Map()
    for (const id of list.ids) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      if (summary.origin === 'subagent' || summary.blank) continue
      if (archived.has(String(id))) continue
      const title = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
      if (title === '') continue
      if (!byTitle.has(title)) byTitle.set(title, { hidden: 0, visible: 0 })
      const entry = byTitle.get(title)
      if (isMindmapFamilySession(list, id)) entry.hidden += 1
      else entry.visible += 1
    }
    const hideTitles = new Set()
    for (const [title, entry] of byTitle) {
      if (entry.hidden > 0 && entry.visible === 0) hideTitles.add(title)
    }
    const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
    if (browser === null) return
    for (const row of browser.querySelectorAll('[role="treeitem"]')) {
      // Workspace group headers expose aria-expanded — not session rows, so
      // never hidden even when a group title equals a family title.
      if (row.hasAttribute('aria-expanded')) continue
      // Match the title via its title span, not any leaf span: badges / empty
      // spacer spans would be caught by a numeric or empty family title.
      const titleSpan = row.querySelector('span[class*="title"]')
      const matched = titleSpan !== null && hideTitles.has((titleSpan.textContent ?? '').trim())
      row.classList.toggle('dsh-ws-mindmap-hidden-row', matched)
    }
    /* The harness sizes the overflow button from group.sessions.length (which
       includes hidden rows) — recompute the visible remainder, patch the count
       or hide the button when nothing is left behind. */
    const workspaces = getWorkspaces?.() ?? []
    for (const header of browser.querySelectorAll('[role="treeitem"][aria-expanded]')) {
      /* Real-workspace headers sit inside a HoverCard span (ungrouped header
         does not); walk up to the section holding the overflow button. */
      let section = header.parentElement
      while (section !== null && section !== browser
          && section.querySelector(':scope > button[aria-expanded]') === null) {
        section = section.parentElement
      }
      if (section === null || section === browser) continue
      const button = section.querySelector(':scope > button[aria-expanded]')
      if (button === null) continue
      /* Expanded list shows the collapse label — nothing to fix. */
      if (button.getAttribute('aria-expanded') === 'true') continue
      /* Session rows are also HoverCard-wrapped (not direct children) —
         gather all descendant treeitems and drop the header. */
      const rows = [...section.querySelectorAll('[role="treeitem"]')]
        .filter(row => !row.hasAttribute('aria-expanded'))
      const hiddenInRows = rows.filter(row => row.classList.contains('dsh-ws-mindmap-hidden-row')).length
      /* Match group by header title: real workspace -> its sessionIds; else
         the ungrouped bucket (sessions no workspace has). */
      const titleEl = header.querySelector('span[class*="title"]')
      const groupTitle = (titleEl?.textContent ?? '').trim()
      const workspace = workspaces.find(w => w.title === groupTitle)
      let ids
      if (workspace !== undefined) {
        ids = (workspace.sessionIds ?? []).map(String)
      } else {
        const accounted = new Set(workspaces.flatMap(w => (w.sessionIds ?? []).map(String)))
        ids = list.ids.filter(id => !accounted.has(String(id)))
      }
      /* Count the group's sessions the way the harness renders them, minus
         titles this hider hides. Subagent sessions ARE rendered as rows (the
         session list shows them), so they must count here — the old code
         excluded them from visibleCount while `rows` still contained them,
         which made `remaining` negative in mixed groups and wrongly hid the
         overflow button (its hidden mindmap rows became unreachable).
         Archived sessions and blank non-current sessions are not rendered by
         the harness, so they stay excluded (rows does not contain them). */
      let visibleCount = 0
      for (const id of ids) {
        const summary = list.byId[id]
        if (summary === undefined) continue
        if (archived.has(String(id))) continue
        if (summary.blank && String(id) !== String(list.current)) continue
        const title = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
        if (title === '' || hideTitles.has(title)) continue
        visibleCount += 1
      }
      const remaining = visibleCount - (rows.length - hiddenInRows)
      if (remaining > 0) {
        button.classList.remove('dsh-ws-mindmap-no-overflow')
        /* The button's only number is the count — swap it in place, keeping the
           original text so it can be restored later. */
        const currentNumber = button.textContent.match(/\d+/)
        if (currentNumber !== null && Number(currentNumber[0]) !== remaining) {
          /* The harness may have re-rendered the button since the first patch
             (session count changed): refresh the stored "original" from the
             CURRENT text so a later restore writes back the real count, not a
             stale pre-patch value. */
          patchedButtons.set(button, button.textContent)
          button.textContent = button.textContent.replace(/\d+/, String(remaining))
        }
      } else {
        button.classList.add('dsh-ws-mindmap-no-overflow')
        restoreButtonText(button)
      }
    }
  }
  /* Time throttle: the observer fires per DOM mutation (streaming churn); one
     scan per throttle window keeps the hiding fresh without global jank. The
     slot may be re-created by the harness WITHOUT a body-direct childList
     change (deep subtree replacement, which the body-level guard observer
     cannot see): re-anchor here, inside the throttled callback, so a stale
     slot never leaves the hider dead until the next registry change. */
  const schedule = () => {
    if (timer !== 0) return
    const wait = Math.max(0, MINDMAP_HIDER_THROTTLE_MS - (Date.now() - lastRun))
    timer = window.setTimeout(() => { timer = 0; ensureObserved(); apply() }, wait)
  }
  /* Observe ONLY the sidebar workspaces slot (the hider only touches rows
     there): chat streaming churn (characterData + childList on the chat
     column) no longer schedules scans. The slot may be re-created by the
     harness, so a body-level childList guard re-anchors the observer when
     the slot node is replaced (or first appears — until then the observer
     falls back to body, whose subtree mutations cover the slot's creation). */
  let observedTarget = null
  const ensureObserved = () => {
    const target = document.querySelector('[data-slot="sidebar.workspaces"]') ?? document.body
    if (observedTarget === target) return
    observer.disconnect()
    observedTarget = target
    observer.observe(target, { childList: true, subtree: true })
  }
  const observer = new MutationObserver(schedule)
  const guardObserver = new MutationObserver(() => { ensureObserved() })
  guardObserver.observe(document.body, { childList: true })
  ensureObserved()
  const unsubscribe = mindmapRegistry.subscribe(schedule)
  apply()
  return () => {
    observer.disconnect()
    guardObserver.disconnect()
    unsubscribe()
    if (timer !== 0) { clearTimeout(timer); timer = 0 }
    /* Restore every touched row so hot reload / uninstall cannot leave the
       hidden class stuck on the DOM. */
    const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
    if (browser !== null) {
      for (const row of browser.querySelectorAll('[role="treeitem"].dsh-ws-mindmap-hidden-row')) {
        row.classList.remove('dsh-ws-mindmap-hidden-row')
      }
      for (const button of browser.querySelectorAll('button.dsh-ws-mindmap-no-overflow')) {
        button.classList.remove('dsh-ws-mindmap-no-overflow')
        restoreButtonText(button)
      }
    }
  }
}

/* Whether a session (or any fork ancestor, subagent hops aside) belongs to a
   mind-map family: a documented root/branch or a fork descendant of one. */

/* Sessions the user has converted to a mind map this app session. The doc
   index refreshes only every 10 s, so right after a conversion `isMember` is
   still false: without this set the button would re-offer the convert dialog.
   Entries are pruned when the registry catches up (see MindmapHeaderButton),
   so the set only ever holds in-flight conversions. */
export const mindmapConvertedSessions = new Set()