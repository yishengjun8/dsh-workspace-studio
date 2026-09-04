import { MINDMAP_HIDER_THROTTLE_MS } from '../constants.js'
import { isMindmapFamilySession } from './panel.js'
import { mindmapRegistry } from './registry.js'

/* Hides mind-map family sessions (root + every fork descendant) from the
   sidebar list; each mind map is shown by its self-drawn entry instead.
   Rows are matched by title and rescanned on DOM mutations / index changes.
   A title hides a row only when every session with that title is hidden (a
   visible non-mindmap sharing it keeps it visible); archived sessions add no
   titles and the clearing pass self-heals bad rows.
   The current BLANK session renders as a provisional New Session row with a
   localized placeholder title (never the stored, empty title), so it is
   matched structurally instead (selected row without a time cell) and only
   when it belongs to a mind-map family — via the registry, the parent chain,
   or mindmapBlankSessions (created by mindmapActions.createSession, in flight
   until the doc adoption). Plus-button blank sessions never match and stay
   visible.

   Scan cost is bounded by three layers (2026 fix):
   1. Mutation records are FILTERED before a scan is scheduled: only a session
      row ('[role="treeitem"]') or an overflow button ('button[aria-expanded]')
      being added / removed / rewritten can change hiding or counts. The
      mind-map panel's own React renders (its entries are plain buttons — not
      overflow buttons), seat re-anchors, decorative nodes AND this hider's own
      count-patch writes (their targets are patchedButtons members) all drop
      out — the observer no longer turns every container churn into a scan, and
      our own writes never schedule the next one (de-self-trigger). Batches
      that ADD such nodes (group expand / collapse) skip the throttle and scan
      synchronously in the observer callback — before paint, so newly rendered
      family rows never flash; only rewrites of existing rows stay throttled.
   2. apply() computes a scan RESULT signature (session inputs + row titles /
      desired & actual hidden classes + current overflow-button texts) and
      skips every DOM write plus the per-group count pass when it matches the
      last scan — reorders and identical row rebuilds cost the walk only.
   3. The body guard re-anchors only when the observed target was actually
      REPLACED (disconnected): plain body churn (portals, toasts, dialogs)
      does zero work.
   Additionally the observer watches CLASS attributes on the slot: the
   harness renders session rows through React, and React owns each row's
   className — when a hidden family row becomes (or stops being) the CURRENT
   session, the selected-class toggle rewrites the whole class list and
   WIPES our dsh-ws-mindmap-hidden-row without any childList record. Such
   rewrites are re-hidden within the same animation frame (before paint), so
   the row never flashes visible. */

export function installMindmapBranchHider(getSessionList, getArchivedSessionIds, getWorkspaces) {
  if (typeof document === 'undefined') return () => {}
  let timer = 0
  let lastRun = 0
  /* Pending frame-coalesced re-hide (row-class rewrite path below). */
  let frame = 0
  /* Signature of the last applied scan (all driving inputs + the resulting
     row states + overflow-button texts): an identical scan writes nothing. */
  let lastSignature = null
  /* Original textContent of every overflow button whose count this hider
     patched, so the number can be restored when the patch no longer applies
     (all docs gone, group fully hidden, or dispose) — the harness re-renders
     the button on session changes, but a static group would keep the patched
     small number forever. Also marks a button as "patched by us" for the
     mutation filter below. */
  const patchedButtons = new WeakMap()
  const restoreButtonText = (button) => {
    const original = patchedButtons.get(button)
    if (original !== undefined) {
      button.textContent = original
      /* Unmark: a later foreign rewrite of the SAME node must rescan again
         (the marker deletion costs at most one extra no-op scan). */
      patchedButtons.delete(button)
    }
  }
  /* Whether a mutation batch can change what this hider renders: a session
     row or an overflow button added / removed / rewritten — everything else
     (the mind-map panel's own button/label renders, seat re-anchors,
     decorative nodes, and this hider's own count patches) cannot alter any
     hidden class or count. */
  const mutatesHiderState = (records) => {
    for (const record of records) {
      /* Attribute records are handled exclusively by wipesHiddenRowClass
         below (row-class rewrites → frame path): every other attribute
         change (child-span classes, panel buttons) cannot alter hiding or
         counts and must not schedule the throttled scan. */
      if (record.type === 'attributes') continue
      const target = record.target
      if (target instanceof Element) {
        if (target.tagName === 'BUTTON') {
          /* Our own count-patch / restore writes target a button we patched:
             skip (de-self-trigger). A foreign overflow-button rewrite (text
             set on the same node) must rescan — its count may be stale again.
             Plain panel buttons cannot affect hiding or counts either. */
          if (patchedButtons.has(target)) continue
          if (target.getAttribute('aria-expanded') !== null) return true
          continue
        }
        /* Any rewrite INSIDE a session row (title span replaced, row rebuilt
           from within) changes what the row pass reads. */
        if (target.closest('[role="treeitem"]') !== null) return true
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 && node.nodeType !== 11) continue
        if (node.matches?.('[role="treeitem"],button[aria-expanded]') === true
          || node.querySelector?.('[role="treeitem"],button[aria-expanded]') !== null) return true
      }
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1 && node.nodeType !== 11) continue
        if (node.matches?.('[role="treeitem"],button[aria-expanded]') === true
          || node.querySelector?.('[role="treeitem"],button[aria-expanded]') !== null) return true
      }
    }
    return false
  }
  const apply = () => {
    timer = 0
    lastRun = Date.now()
    /* Re-anchor the observer to the sidebar slot whenever this runs: the slot
       may have appeared (initial fallback was body) or been re-created. */
    ensureObserved()
    /* No mind-map docs: skip the session walk (the observer may still fire on
       container/body mutations) but clear any applied hidden class so rows
       self-heal the moment the last doc disappears. */
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
      lastSignature = null
      return
    }
    const list = getSessionList()
    const archived = new Set((getArchivedSessionIds?.() ?? []).map(String))
    /* In-flight mind-map blank sessions: prune what the registry now knows as
       a doc branch (or what vanished / got archived after a failed doc write
       — the view archives the fresh session so it cannot outlive its entry).
       Never prune on "not in list": the store projection may lag the creation
       RPC, and dropping the mark there would leave the row visible. */
    for (const id of [...mindmapBlankSessions]) {
      if (archived.has(id) || mindmapRegistry.isBranch(id)) mindmapBlankSessions.delete(id)
    }
    /* The harness renders ONLY the current blank session (a provisional New
       Session row), with the localized placeholder title — the stored title
       is empty, so title matching cannot see it. It counts as family when it
       is a registry root/branch, resolves to one through the parent chain, or
       was created by this plugin's mind-map createSession (in-flight set). A
       plus-button blank session is none of those and stays visible. */
    const currentId = list.current === undefined || list.current === null ? null : String(list.current)
    const currentSummary = currentId !== null ? list.byId[currentId] : undefined
    const blankFamilyCurrent = currentSummary !== undefined && currentSummary.blank === true
      && (mindmapRegistry.isBranch(currentId)
        || isMindmapFamilySession(list, currentId)
        || mindmapBlankSessions.has(currentId))
    const byTitle = new Map()
    /* All driving inputs folded into the scan signature (see header): the row
       pass and the per-group count pass only run when one of them changed. */
    const sessionSig = []
    for (const id of list.ids) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      const title = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
      const isFamily = isMindmapFamilySession(list, id)
      sessionSig.push(`${id}\u0001${title}\u0001${summary.blank ? 1 : 0}\u0001${summary.origin ?? ''}\u0001${archived.has(String(id)) ? 1 : 0}\u0001${isFamily ? 1 : 0}\u0001${String(id) === String(list.current) ? 1 : 0}`)
      if (summary.origin === 'subagent' || summary.blank) continue
      if (archived.has(String(id))) continue
      if (title === '') continue
      if (!byTitle.has(title)) byTitle.set(title, { hidden: 0, visible: 0 })
      const entry = byTitle.get(title)
      if (isFamily) entry.hidden += 1
      else entry.visible += 1
    }
    const hideTitles = new Set()
    for (const [title, entry] of byTitle) {
      if (entry.hidden > 0 && entry.visible === 0) hideTitles.add(title)
    }
    const browser = document.querySelector('[data-slot="sidebar.workspaces"]')
    if (browser === null) return
    /* Collect the rows ONCE: the per-group count pass reuses this list (via
       section.contains) instead of re-querying the DOM once per group. */
    const rows = [...browser.querySelectorAll('[role="treeitem"]')]
    const rowDecisions = []
    const rowSig = []
    for (const row of rows) {
      // Workspace group headers expose aria-expanded — not session rows, so
      // never hidden even when a group title equals a family title.
      if (row.hasAttribute('aria-expanded')) continue
      // Match the title via its title span, not any leaf span: badges / empty
      // spacer spans would be caught by a numeric or empty family title.
      const titleSpan = row.querySelector('span[class*="title"]')
      const title = titleSpan !== null ? (titleSpan.textContent ?? '').trim() : ''
      /* Blank current row of a mind-map family: matched structurally, not by
         title. The harness renders blank rows with the localized New Session
         label (never the stored title) and omits the time cell on blank rows,
         while non-blank rows always have one — so "selected + title cell + no
         time cell" can only be the current blank session's row (blank rows
         never enter search, and group headers carry aria-expanded instead). */
      const matched = hideTitles.has(title)
        || (blankFamilyCurrent
          && titleSpan !== null
          && row.getAttribute('aria-selected') === 'true'
          && row.querySelector('span[class*="time"]') === null)
      rowDecisions.push({ row, matched })
      rowSig.push(`${title}\u0001${matched ? 1 : 0}\u0001${row.classList.contains('dsh-ws-mindmap-hidden-row') ? 1 : 0}`)
    }
    /* Current overflow-button texts: a foreign (harness) button rewrite shows
       up here and forces the count pass even when rows/sessions look unchanged. */
    const buttonTextSig = [...browser.querySelectorAll('button[aria-expanded]')]
      .map(button => (button.textContent ?? ''))
      .join('\u0004')
    const workspaces = getWorkspaces?.() ?? []
    const wsSig = workspaces
      .map(w => `${String(w.title ?? '')}\u0001${(w.sessionIds ?? []).map(String).sort().join('\u0003')}`)
      .join('\u0002')
    const signature = `${sessionSig.join('\u0002')}\u0003${wsSig}\u0003${rowSig.join('\u0002')}\u0003${buttonTextSig}\u0003${blankFamilyCurrent ? 1 : 0}`
    /* Identical inputs → the DOM already reflects the desired state: skip
       every write (class toggles, count patches) and the per-group pass. */
    if (signature === lastSignature) return
    lastSignature = signature
    for (const decision of rowDecisions) {
      decision.row.classList.toggle('dsh-ws-mindmap-hidden-row', decision.matched)
    }
    /* The harness sizes the overflow button from group.sessions.length (which
       includes hidden rows) — recompute the visible remainder, patch the count
       or hide the button when nothing is left behind. */
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
      /* Session rows are also HoverCard-wrapped (not direct children) — reuse
         the rows collected once above, dropping the group headers. */
      const sectionRows = rows.filter(row => !row.hasAttribute('aria-expanded') && section.contains(row))
      const hiddenInRows = sectionRows.filter(row => row.classList.contains('dsh-ws-mindmap-hidden-row')).length
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
         excluded them from visibleCount while `sectionRows` still contained
         them, which made `remaining` negative in mixed groups and wrongly hid
         the overflow button (its hidden mindmap rows became unreachable).
         Archived sessions and blank non-current sessions are not rendered by
         the harness, so they stay excluded (sectionRows does not contain
         them). */
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
      /* A visible blank CURRENT session renders as a provisional New Session
         row, so the harness counts it among the group's rendered rows and the
         recomputed remainder must count it too (its stored title is empty and
         the loop above skips it). When this hider hides the blank family row,
         it behaves like the hidden rows: excluded here, counted by
         hiddenInRows below. */
      if (!blankFamilyCurrent && currentId !== null && ids.includes(currentId)
        && list.byId[currentId]?.blank === true) visibleCount += 1
      const remaining = visibleCount - (sectionRows.length - hiddenInRows)
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
  /* Whether a mutation batch ADDS session rows or overflow buttons — the
     expand/collapse case. These nodes appear only when the user expands a
     group (rows) or collapses it (overflow button); hiding / count patches
     must run BEFORE the browser paints them, or the 400 ms throttle leaves
     family rows visible for a flash. */
  const addsHiderNodes = (records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 && node.nodeType !== 11) continue
        if (node.matches?.('[role="treeitem"],button[aria-expanded]') === true
          || node.querySelector?.('[role="treeitem"],button[aria-expanded]') !== null) return true
      }
    }
    return false
  }
  /* Whether a mutation batch REWROTE a session row's class attribute. The
     harness re-renders rows through React, and React owns each row's
     className: when a hidden family row becomes (or stops being) the CURRENT
     session, the selected-class toggle rewrites the whole class list and
     wipes dsh-ws-mindmap-hidden-row. Only class writes ON the row element
     itself can do that (child-span class churn cannot), so the filter
     matches the row exactly — panel buttons and the overflow button (whose
     className is a constant string in the harness, never rewritten) never
     match, and this hider's own toggles re-enter here once and settle on an
     identical signature. */
  const wipesHiddenRowClass = (records) => {
    for (const record of records) {
      if (record.type !== 'attributes' || record.attributeName !== 'class') continue
      const target = record.target
      if (target instanceof Element && target.matches('[role="treeitem"]')) return true
    }
    return false
  }
  /* Time throttle: the observer fires per DOM mutation; one scan per throttle
     window keeps the hiding fresh without global jank. The slot may be
     re-created by the harness WITHOUT a body-direct childList change (deep
     subtree replacement, which the body-level guard observer cannot see):
     re-anchor here, inside the throttled callback, so a stale slot never
     leaves the hider dead until the next registry change. */
  const schedule = (records) => {
    if (records !== undefined && records.length > 0 && addsHiderNodes(records)) {
      /* Expansion/collapse: scan synchronously — the observer callback runs
         at the microtask checkpoint, before paint, so rows are hidden before
         the first frame (no flash). A pending throttled scan is superseded. */
      if (timer !== 0) { clearTimeout(timer); timer = 0 }
      apply()
      return
    }
    if (records !== undefined && records.length > 0 && wipesHiddenRowClass(records)) {
      /* Row-class rewrite (React wiped our hidden class): re-hide within the
         same animation frame, BEFORE the next paint — the wiped row is never
         painted visible, unlike a 400 ms throttled scan. Coalesced to one
         scan per frame; apply() reads the current DOM, so a coalesced scan
         that follows further rewrites still lands on the final state. */
      if (timer !== 0) { clearTimeout(timer); timer = 0 }
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0
          ensureObserved()
          apply()
        })
      }
      return
    }
    if (timer !== 0) return
    /* Mutation filter: a scan is only needed when the batch can change hiding
       state (a session row or an overflow button touched) — see the header
       comment. Registry pushes (no records) always scan. */
    if (records !== undefined && records.length > 0 && !mutatesHiderState(records)) return
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
    /* Class attributes are watched for the row-rewrite path above: React
       wiping dsh-ws-mindmap-hidden-row produces NO childList record, so the
       observer must see attribute writes on the slot's rows too. */
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  }
  const observer = new MutationObserver(schedule)
  /* Guard: re-anchor ONLY when the observed target was actually replaced
     (disconnected) — plain body churn (portals, toasts, dialogs) does zero
     work. The slot's creation/replacement is itself one of these mutations,
     so the refresh happens within the same batch. */
  const guardObserver = new MutationObserver(() => {
    if (observedTarget === null || !observedTarget.isConnected) ensureObserved()
  })
  guardObserver.observe(document.body, { childList: true })
  ensureObserved()
  const unsubscribe = mindmapRegistry.subscribe(schedule)
  apply()
  return () => {
    observer.disconnect()
    guardObserver.disconnect()
    unsubscribe()
    if (timer !== 0) { clearTimeout(timer); timer = 0 }
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
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
   index refreshes only every 30 s, so right after a conversion `isMember` is
   still false: without this set the button would re-offer the convert dialog.
   Entries are pruned when the registry catches up (see MindmapHeaderButton),
   so the set only ever holds in-flight conversions. */
export const mindmapConvertedSessions = new Set()

/* BLANK sessions this plugin created for a mind map (root-node 新建会话 / the
   blank-card menu — every caller funnels through mindmapActions.createSession).
   The registry learns them as doc branches only after the doc write + index
   refresh, but the harness renders the CURRENT blank session immediately as a
   provisional New Session row; without this set that row would stay visible
   during the adoption window. The hider prunes entries once the registry
   knows the branch (or the session vanished / got archived after a failed
   doc write), so the set only ever holds in-flight creations. Sessions the
   user creates with the sidebar's own plus button never enter this set and
   stay visible — the two are deliberately distinct. */
export const mindmapBlankSessions = new Set()
