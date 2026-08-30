import { createElement as h, useRef, memo } from 'react'
import { clampMountBulge, MINDMAP_DEPTH_GAP, MINDMAP_HEAD_H, MINDMAP_HEAD_W, MINDMAP_MOUNT_BULGE_DEFAULT_X, MINDMAP_NODE_H, MINDMAP_NODE_W, MINDMAP_PAN_MARGIN, MINDMAP_PAN_OUT_MAX, MINDMAP_ROOT_H, MINDMAP_ROOT_W, MINDMAP_ROW_GAP, MINDMAP_ZOOM_MIN } from '../constants.js'
import { mindmapRegistry } from './registry.js'

export function isMindmapBranchDescendant(list, id) {
  let cursor = list.byId[String(id)]?.parentId
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    if (mindmapRegistry.isRoot(cursor) || mindmapRegistry.isBranch(cursor)) return true
    const summary = list.byId[cursor]
    if (summary === undefined) break
    if (summary.origin === 'subagent') { cursor = summary.parentId; continue }
    cursor = summary.parentId
  }
  return false
}

/* Walk fork lineage to the ordinary root; subagent hops are transparent (family-root title = first non-subagent ancestor's title). */
export function mindmapRootTitleOf(list, id) {
  let cursor = String(id)
  const seen = new Set()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    const summary = list.byId[cursor]
    if (summary === undefined) return undefined
    if (summary.origin === 'subagent') { cursor = summary.parentId; continue }
    return summary.displayTitle
  }
  return undefined
}

/* Every fork descendant of a session id (the subtree to archive with it). */
export function mindmapDescendantsOf(parentOf, rootId) {
  const children = new Map()
  for (const [child, parent] of parentOf) {
    const arr = children.get(parent) ?? []
    arr.push(child)
    children.set(parent, arr)
  }
  const out = []
  const stack = children.get(rootId) ?? []
  while (stack.length > 0) {
    const id = stack.pop()
    out.push(id)
    for (const child of children.get(id) ?? []) stack.push(child)
  }
  return out
}

/* Hard-cut a node label. */
export function mindmapClip(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/* ---- document layout ---- */

export const mindmapDocKey = (sessionId, seq) => `${sessionId}:${seq}`

/* Key of the VIRTUAL root node (the map's top hub, not a session). */
export const MINDMAP_ROOT_KEY = '__mindmap_root__'

/* Key of a session's HEAD node (the identity card at the left of its question chain); shared
   by the layout and the current-card highlight so "当前" can light the session's head. */
export const mindmapHeadKey = (sessionId) => mindmapDocKey(String(sessionId), `head:${String(sessionId)}`)

/* Key of a session's placeholder card (a session with no turns yet); shared by the layout and
   the current-card highlight so "当前" can light the "等待新问题" card. */
export const mindmapEmptyKey = (sessionId) => mindmapDocKey(String(sessionId), `empty:${String(sessionId)}`)

/* The maximal folded run containing the turn at `seq` (walking back and
   forward while folded), or null when the turn is not folded / missing. Used
   by the view for the peek cleanup and the run-wide permanent unfold. */
export function mindmapFoldedRunOf(doc, sessionId, seq) {
  const session = (doc?.sessions ?? []).find(s => s !== null && s !== undefined && String(s?.sessionId) === String(sessionId))
  if (session === undefined) return null
  const turns = session.turns ?? []
  const idx = turns.findIndex(t => t !== null && t !== undefined && Number(t?.seq) === Number(seq))
  if (idx === -1 || turns[idx]?.folded !== true) return null
  let start = idx
  while (start > 0 && turns[start - 1]?.folded === true) start -= 1
  let end = idx
  while (end + 1 < turns.length && turns[end + 1]?.folded === true) end += 1
  return { firstSeq: Number(turns[start].seq), lastSeq: Number(turns[end].seq), count: end - start + 1 }
}

/* Plan of a card deletion (right-click → 删除卡片): the card is removed by TRUNCATING its
   session chain (card + every later card cut, session re-created from the previous card via
   a fork at its turn/end, OLD session archived so the chat shows the truncated conversation);
   every session hanging off a removed card is archived too. An empty placeholder card — or a
   session's FIRST card — removes the whole session instead. Removing the LAST remaining
   session is blocked (the map must keep at least one; the root node is virtual). The doc
   records NO tombstones: a removed turn only resurfaces through a failed archive of its old
   session (ACCEPTED — pure fork + archive + replace; see docs/mindmap-notes.md). Returns null
   when the target card is not in the doc, or a plan { archiveIds, sessions, replaced,
   wholeBranch, lastSession, next }. */
export function mindmapDeletePlan(doc, ownerId, turnSeq, emptyCard) {
  const sessions = (doc?.sessions ?? []).filter(s => s !== null && s !== undefined)
  const ownerIdx = sessions.findIndex(s => String(s?.sessionId) === String(ownerId))
  if (ownerIdx === -1) return null
  const session = sessions[ownerIdx]
  const chain = session.turns ?? []
  const removed = []
  const pruneIds = new Set()
  const pushTurn = (sessionId, turn) => {
    if (turn === null || turn === undefined) return
    removed.push({ sessionId: String(sessionId), seq: Number(turn.seq), n: Number(turn.n) })
  }
  let idx = -1
  let wholeBranch = false
  if (emptyCard) {
    /* Empty placeholder: no truncation possible — the whole session (session + subtree) is removed. */
    wholeBranch = true
  } else {
    idx = chain.findIndex(turn => Number(turn?.seq) === Number(turnSeq))
    if (idx === -1) return null
    if (idx === 0) wholeBranch = true
  }
  if (wholeBranch) {
    pruneIds.add(String(ownerId))
    if (chain.length === 0) {
      /* An EMPTY session has no turns to anchor the subtree worklist below: seed it with the
         session itself so descendants whose parent session is this session are still pruned. */
      removed.push({ sessionId: String(ownerId), seq: undefined, n: undefined })
    }
    for (const turn of chain) pushTurn(ownerId, turn)
  } else {
    for (let i = idx; i < chain.length; i += 1) pushTurn(ownerId, chain[i])
  }
  /* Session subtree: every session whose parent card is a removed card, recursively
     (grandchildren hang off the removed sessions' cards; empty-session anchors match by identity). */
  for (let cursor = 0; cursor < removed.length; cursor += 1) {
    const t = removed[cursor]
    for (const s of sessions) {
      if (pruneIds.has(String(s.sessionId))) continue
      /* A null/undefined parentTurn child (legacy data) cannot be re-anchored
         to any surviving card, so it is pruned whenever ANY turn of its parent
         session is removed (truncation replaces the parent; whole-branch
         removal archives it) — otherwise it would leak into the sidebar
         forever, invisible in the map. */
      if (String(s?.parentSessionId) === String(t.sessionId)
        && (t.n === undefined
          || s?.parentTurn === null || s?.parentTurn === undefined
          || Number(s?.parentTurn) === Number(t.n))) {
        pruneIds.add(String(s.sessionId))
        /* An EMPTY pruned session has no turns to anchor ITS OWN subtree: seed
           it with a null-key work item (the same rule the whole-branch seed
           above uses for the owner) so its null-parentTurn descendants are
           pruned too. Without this the children would stay in nextSessions
           while their parent is gone — invisible in the map, hidden from the
           sidebar, unreachable. */
        if ((s?.turns ?? []).length === 0) {
          removed.push({ sessionId: String(s.sessionId), seq: undefined, n: undefined })
        }
        for (const turn of s?.turns ?? []) pushTurn(s.sessionId, turn)
      }
    }
  }
  const removedBySession = new Map()
  for (const t of removed) {
    if (!removedBySession.has(t.sessionId)) removedBySession.set(t.sessionId, new Set())
    removedBySession.get(t.sessionId).add(t.seq)
  }
  const keep = (sessionId, turn) => !removedBySession.get(String(sessionId))?.has(Number(turn?.seq))
  const nextSessions = sessions
    .filter(s => !pruneIds.has(String(s.sessionId)))
    .map(s => String(s?.sessionId) === String(ownerId) && !wholeBranch
      ? { ...s, turns: (s?.turns ?? []).filter(turn => keep(String(ownerId), turn)) }
      : s)
  /* Removing the last remaining session (directly or via a subtree prune) would leave only the virtual root — blocked. */
  if (nextSessions.length === 0) return { lastSession: true }
  /* Fresh doc-wide counter: continue after the largest remaining card number (deleted numbers reused, no gaps). */
  let maxN = 0
  for (const s of nextSessions) for (const turn of s?.turns ?? []) maxN = Math.max(maxN, Number(turn?.n) || 0)
  return {
    archiveIds: [...pruneIds],
    sessions: nextSessions,
    replaced: wholeBranch
      ? null
      : { sessionId: String(ownerId), forkAt: Number(chain[idx - 1].seq) },
    wholeBranch,
    lastSession: false,
    next: maxN + 1,
  }
}

/* Stable fingerprint of a doc's structure (per-session turn seqs + AI summaries,
   fork anchors + the map's own title) to skip redundant re-renders after a sync
   that changed nothing. rootTitle is included so a sidebar rename reaches an open
   map on the next sync (a seq-only one skipped it); the turn summaries AND the
   session summaries are included so a background AI summary (or a manual
   regeneration / 总结当前会话) renders without waiting for a structural change.
   rootSessionId + workspaceCwd are included too: a root replacement (another
   tab truncating the anchor card) or a workspace-selection change must NOT be
   swallowed by fingerprint equality — applySync uses this to re-anchor. */
export function mindmapDocFingerprint(doc) {
  /* JSON-encoded end to end: separator-joined raw strings could COLLIDE for
     different docs (a user question or AI summary containing a ':'/','/';'
     aligns with a boundary and two distinct docs hash equal — silently
     skipping setDoc). JSON.stringify is injective for this fixed key shape. */
  return JSON.stringify({
    rootSessionId: String(doc?.rootSessionId ?? ''),
    rootTitle: String(doc?.rootTitle ?? ''),
    workspaceCwd: String(doc?.workspaceCwd ?? ''),
    /* next participates: a counter-only change from another tab (card deletion
       recomputes it) must not be swallowed by fingerprint equality. The
       sessions ARRAY ORDER is preserved by JSON.stringify, so a reorder is
       already covered. */
    next: doc?.next ?? '',
    sessions: (doc?.sessions ?? []).map(s => ({
      sessionId: s?.sessionId,
      parentSessionId: s?.parentSessionId ?? '',
      parentTurn: s?.parentTurn ?? '',
      summary: typeof s?.summary === 'string' ? s.summary : '',
      turns: (s?.turns ?? []).map(turn => ({
        seq: turn?.seq,
        n: turn?.n ?? '',
        user: turn?.user ?? '',
        summary: typeof turn?.summary === 'string' ? turn.summary : '',
        folded: turn?.folded === true,
      })),
    })),
  })
}

/* Structure-ONLY fingerprint for the layout memo: everything mindmapDocLayout
   reads EXCEPT the AI summaries. A summary write must re-render only the
   affected card (its summary prop), never rebuild the whole canvas — the layout
   (and every node entry it produces) stays referentially stable across summary
   changes, so React.memo on the cards keeps working. The question text IS
   included (the cards render it), so an in-place edit of a turn's user text
   (same seq/n) still rebuilds the card. JSON-encoded for the same
   collision-free reasons as mindmapDocFingerprint. */
export function mindmapDocStructureFingerprint(doc) {
  return JSON.stringify({
    rootSessionId: String(doc?.rootSessionId ?? ''),
    next: doc?.next ?? '',
    sessions: (doc?.sessions ?? []).map(s => ({
      sessionId: s?.sessionId,
      parentSessionId: s?.parentSessionId ?? '',
      parentTurn: s?.parentTurn ?? '',
      turns: (s?.turns ?? []).map(turn => ({
        seq: turn?.seq,
        n: turn?.n ?? '',
        user: turn?.user ?? '',
        folded: turn?.folded === true,
      })),
    })),
  })
}

/* Deterministic per-session palette for a streaming card + parent pair (the gradient ring and
   flowing edge): a hash of the session id seeds a PRNG picking ONE 3-color scheme from the
   curated pool, stable across renders. Returns a FLAT 3-color array (c1, c2, c3) — a buggy
   earlier version returned arrays of palettes, making every stroke/stop an invalid color list
   (edge rendered black). Cached by session id so the array identity survives layout recomputes
   and React.memo comparisons. */
export const MINDMAP_STREAM_PALETTE = [
  ['#22d3ee', '#818cf8', '#a78bfa'],
  ['#fb923c', '#f472b6', '#e11d48'],
  ['#a3e635', '#34d399', '#2dd4bf'],
  ['#fde047', '#f97316', '#ef4444'],
  ['#38bdf8', '#2dd4bf', '#a3e635'],
  ['#e879f9', '#818cf8', '#38bdf8'],
]
export const mindmapStreamPaletteCache = new Map()
export const mindmapStreamHash = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export const mindmapMulberry32 = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const mindmapGradientId = (sessionId) => {
  const codePoints = [...String(sessionId)].map(char => char.codePointAt(0).toString(16)).join('_')
  return `dsh-ws-mm-grad-${codePoints}`
}
export const mindmapStreamPalette = (sessionId) => {
  const sid = String(sessionId)
  const hit = mindmapStreamPaletteCache.get(sid)
  if (hit !== undefined) {
    // Refresh insertion order so the bounded cache evicts the LRU session without changing a live palette.
    mindmapStreamPaletteCache.delete(sid)
    mindmapStreamPaletteCache.set(sid, hit)
    return hit
  }
  const rng = mindmapMulberry32(mindmapStreamHash(sid))
  const out = MINDMAP_STREAM_PALETTE[Math.floor(rng() * MINDMAP_STREAM_PALETTE.length)].slice()
  if (mindmapStreamPaletteCache.size >= 128) {
    const oldest = mindmapStreamPaletteCache.keys().next().value
    if (oldest !== undefined) mindmapStreamPaletteCache.delete(oldest)
  }
  mindmapStreamPaletteCache.set(sid, out)
  return out
}

/* Doc layout (v3): the VIRTUAL root node sits alone at the top (row 0); every session is a
   horizontal chain of a HEAD node (its identity card) plus its question cards, one session per
   row in DFS order — top-level sessions first, then each session's nested forks on the rows
   right after, indented to the card they hang off. A session with no turns renders one
   placeholder card; an optional `streaming` descriptor ({ sessionId, question }) appends an
   ephemeral live card to the chain tail (replacing an empty session's placeholder). Consecutive
   folded turns merge into ONE folded card (unless the run is being peeked — `peekedRun`
   { sessionId, firstSeq } temporarily expands it back into individual cards without touching
   the folded attribute); children of folded turns re-mount from the folded card. Returns
   { nodes, edges, width, height, peekBox } — nodes carry key/kind/sessionId/turn/empty/
   streaming/folded/peeked/row/depth/x/y/width/height, edges are { from, to, mount?, d } with
   the SVG path precomputed, peekBox is the amber outline of a peeked run (null when none). */
export function mindmapDocLayout(doc, streamingList, mountBulgeParam = MINDMAP_MOUNT_BULGE_DEFAULT_X, peekedRun) {
  const nodes = []
  const edges = []
  const sessions = (doc?.sessions ?? []).filter(s => s !== null && s !== undefined)
  /* Children of a specific card, keyed `${parentSessionId}\u0000${cardN}`.
     A child whose parentTurn is null (legacy v2 migration / defensive) is
     keyed under the literal `null` so an empty parent session can still reach
     it — without this it would be silently dropped from the layout. */
  const childMap = new Map()
  for (const s of sessions) {
    if (!s.parentSessionId) continue
    const key = `${String(s.parentSessionId)}\u0000${s.parentTurn === undefined || s.parentTurn === null ? 'null' : String(s.parentTurn)}`
    if (!childMap.has(key)) childMap.set(key, [])
    childMap.get(key).push(s)
  }
  /* DFS pre-order (stable): top-level sessions in doc order, then children by card order; every session occupies ONE row. */
  const order = []
  const visited = new Set()
  const visit = (s) => {
    const sid = String(s.sessionId)
    if (visited.has(sid)) return
    visited.add(sid)
    order.push(s)
    const turns = s.turns ?? []
    /* A session can carry null-parentTurn children (legacy v2 migration /
       defensive): visit them for EVERY session — not only card-less ones —
       so they are never silently dropped from the layout once the parent
       gains turns. headCol falls back to 0 and no mount edge renders
       (defensive), matching the existing null-key handling. */
    for (const kid of (childMap.get(`${sid}\u0000null`) ?? [])) visit(kid)
    for (let k = 0; k < turns.length; k += 1) {
      const n = Number(turns[k]?.n)
      if (!Number.isSafeInteger(n)) continue
      for (const kid of (childMap.get(`${sid}\u0000${String(n)}`) ?? [])) visit(kid)
    }
  }
  for (const s of sessions) {
    if (!s.parentSessionId) visit(s)
  }
  /* Per-session RENDERED chain structure, computed once before the headCol
     pass: consecutive folded turns collapse into one slot (a folded card)
     unless the run is being peeked (each turn renders individually); every
     turn maps to its rendered node key / rendered index so the headCol pass
     and the mount edges resolve a child's parent card to the node it actually
     hangs off (a folded run's turns all resolve to the folded card). */
  const chainMaps = new Map()
  const peekedNodeKeys = []
  for (const s of order) {
    const sid = String(s.sessionId)
    const turns = s.turns ?? []
    const slots = []
    const nodeKeyByN = new Map()
    const renderedIndexByN = new Map()
    let i = 0
    while (i < turns.length) {
      const turn = turns[i]
      if (turn !== null && turn !== undefined && turn.folded === true) {
        /* A maximal run of consecutive folded turns. */
        let j = i
        while (j + 1 < turns.length && turns[j + 1]?.folded === true) j += 1
        const isPeeked = peekedRun !== undefined && peekedRun !== null
          && String(peekedRun.sessionId) === sid
          && Number(peekedRun.firstSeq) === Number(turns[i].seq)
        if (isPeeked) {
          /* Temporary expand: every turn of the run renders as its own card
             (peeked flag drives the "已折叠" status row); children re-mount to
             their ORIGINAL cards (no re-parenting for this run). */
          for (let k = i; k <= j; k += 1) {
            const t = turns[k]
            const key = mindmapDocKey(sid, t.seq)
            slots.push({ key, turn: t, folded: false, peeked: true, foldCount: 1 })
            nodeKeyByN.set(Number(t.n), key)
            renderedIndexByN.set(Number(t.n), slots.length - 1)
          }
        } else {
          /* One folded card standing in for the whole run. */
          const key = mindmapDocKey(sid, turns[i].seq)
          slots.push({ key, turn: turns[i], folded: true, peeked: false, foldCount: j - i + 1 })
          for (let k = i; k <= j; k += 1) {
            nodeKeyByN.set(Number(turns[k].n), key)
            renderedIndexByN.set(Number(turns[k].n), slots.length - 1)
          }
        }
        i = j + 1
      } else if (turn === null || turn === undefined) {
        i += 1
      } else {
        const key = mindmapDocKey(sid, turn.seq)
        slots.push({ key, turn, folded: false, peeked: false, foldCount: 1 })
        nodeKeyByN.set(Number(turn.n), key)
        renderedIndexByN.set(Number(turn.n), slots.length - 1)
        i += 1
      }
    }
    chainMaps.set(sid, { slots, nodeKeyByN, renderedIndexByN })
  }
  /* Row + column assignment (row 0 = the virtual root): a nested session's head sits one card
     column to the right of the card it hangs off (resolved through the RENDERED chain, so a
     child of a folded run's turn hangs off the folded card's column). */
  const entryBySession = new Map()
  let row = 1
  for (const s of order) {
    let headCol = 0
    if (s.parentSessionId) {
      const parentEntry = entryBySession.get(String(s.parentSessionId))
      const parentMaps = chainMaps.get(String(s.parentSessionId))
      const pIdx = parentMaps?.renderedIndexByN.get(Number(s.parentTurn))
      headCol = parentEntry !== undefined && pIdx !== undefined ? parentEntry.headCol + pIdx + 2 : 0
    }
    entryBySession.set(String(s.sessionId), { session: s, headCol, row: row++ })
  }
  /* Build session chains (heads + cards). */
  for (const s of order) {
    const entry = entryBySession.get(String(s.sessionId))
    const sid = String(s.sessionId)
    const turns = s.turns ?? []
    const head = {
      kind: 'head',
      key: mindmapHeadKey(sid),
      sessionId: sid,
      session: s,
      turn: undefined,
      empty: false,
      streaming: false,
      depth: entry.headCol,
      row: entry.row,
      width: MINDMAP_HEAD_W,
      height: MINDMAP_HEAD_H,
    }
    nodes.push(head)
    let prevKey = head.key
    if (turns.length === 0) {
      const key = mindmapEmptyKey(sid)
      nodes.push({
        kind: 'card',
        key,
        sessionId: sid,
        session: s,
        turn: undefined,
        empty: true,
        streaming: false,
        depth: entry.headCol + 1,
        row: entry.row,
        width: MINDMAP_NODE_W,
        height: MINDMAP_NODE_H,
      })
      edges.push({ from: head.key, to: key })
      prevKey = key
    } else {
      /* Iterate the RENDERED chain (folded runs collapsed into one folded
         card, peeked runs expanded into individual cards). */
      const slots = chainMaps.get(sid)?.slots ?? []
      slots.forEach((slot, index) => {
        const key = slot.key
        nodes.push({
          kind: 'card',
          key,
          sessionId: sid,
          session: s,
          turn: slot.turn,
          empty: false,
          streaming: false,
          folded: slot.folded,
          foldCount: slot.foldCount,
          peeked: slot.peeked,
          depth: entry.headCol + 1 + index,
          row: entry.row,
          width: MINDMAP_NODE_W,
          height: MINDMAP_NODE_H,
        })
        edges.push({ from: prevKey, to: key })
        prevKey = key
        if (slot.peeked === true) peekedNodeKeys.push(key)
      })
    }
  }
  /* Root → top-level head edges + nested mount edges (parent card → child head); both render as the dashed mount curve. */
  for (const s of sessions) {
    if (s.parentSessionId) continue
    edges.push({ from: MINDMAP_ROOT_KEY, to: mindmapHeadKey(String(s.sessionId)), mount: true })
  }
  for (const s of order) {
    if (!s.parentSessionId) continue
    const parentEntry = entryBySession.get(String(s.parentSessionId))
    const parentMaps = chainMaps.get(String(s.parentSessionId))
    /* The RENDERED parent node: a child of a folded run's turn hangs off the
       folded card; a child of a peeked run's turn hangs off its own card. */
    const parentKey = parentMaps?.nodeKeyByN.get(Number(s.parentTurn))
    if (parentEntry === undefined || parentKey === undefined) continue
    edges.push({
      from: parentKey,
      to: mindmapHeadKey(String(s.sessionId)),
      mount: true,
    })
  }
  /* Live streaming cards: each running doc-family session with a turn in flight gets a card
     appended to its chain tail (a session awaiting its first turn gets its placeholder replaced).
     Ephemeral UI, never part of the doc: the next sync folds completed turns into normal cards. */
  const streamingItems = Array.isArray(streamingList) ? streamingList : []
  for (const streaming of streamingItems) {
    if (streaming === null || streaming === undefined) continue
    const sid = String(streaming.sessionId)
    const entry = entryBySession.get(sid)
    if (entry === undefined) continue
    const chain = nodes.filter(n => String(n.sessionId) === sid)
    const last = chain[chain.length - 1]
    if (last === undefined) continue
    const replaceEmpty = last.empty === true
    const streamingNode = {
      kind: 'card',
      key: `streaming:${sid}`,
      sessionId: sid,
      session: entry.session,
      turn: undefined,
      empty: false,
      streaming: true,
      /* A replaced placeholder keeps its position; an appended card goes one depth deeper than the tail. */
      depth: replaceEmpty ? last.depth : last.depth + 1,
      row: last.row,
      width: MINDMAP_NODE_W,
      height: MINDMAP_NODE_H,
      question: typeof streaming.question === 'string' ? streaming.question : '',
      parentKey: undefined,
    }
    if (replaceEmpty) {
      /* Replace the placeholder of a session awaiting its first turn; the ring's parent is the
         card the placeholder hung off (the session's head). */
      const index = nodes.indexOf(last)
      const edge = edges.find(e => e.to === last.key)
      streamingNode.parentKey = edge === undefined ? undefined : edge.from
      nodes[index] = streamingNode
      if (edge !== undefined) edge.to = streamingNode.key
    } else {
      streamingNode.parentKey = last.key
      nodes.push(streamingNode)
      edges.push({ from: last.key, to: streamingNode.key })
    }
  }
  /* Positions: x by column (uniform grid; head occupies one column slot), y by row (row 0 = root height). */
  const width = (() => {
    let maxCol = 0
    for (const node of nodes) maxCol = Math.max(maxCol, node.depth)
    return Math.max((maxCol + 1) * (MINDMAP_NODE_W + MINDMAP_DEPTH_GAP) + MINDMAP_DEPTH_GAP,
      MINDMAP_ROOT_W + MINDMAP_DEPTH_GAP * 2)
  })()
  const rootX = (width - MINDMAP_ROOT_W) / 2
  const rootY = MINDMAP_ROW_GAP
  for (const node of nodes) {
    node.x = node.kind === 'root'
      ? rootX
      : mindmapXOf(node.depth)
    /* Row 0 = the virtual root; every session row is pushed one FULL CARD height below it (the
       root "sits one card position higher" above the chains, node gaps unchanged). */
    node.y = node.row === 0
      ? rootY
      : rootY + MINDMAP_ROOT_H + MINDMAP_ROW_GAP + MINDMAP_NODE_H + (node.row - 1) * (MINDMAP_NODE_H + MINDMAP_ROW_GAP)
  }
  /* The virtual root node itself. */
  nodes.push({
    kind: 'root',
    key: MINDMAP_ROOT_KEY,
    sessionId: undefined,
    session: undefined,
    turn: undefined,
    empty: false,
    streaming: false,
    depth: 0,
    row: 0,
    x: rootX,
    y: rootY,
    width: MINDMAP_ROOT_W,
    height: MINDMAP_ROOT_H,
  })
  /* Precompute each edge's SVG path from the node positions. Non-mount edges (head → card →
     streaming) are orthogonal; mount edges (root → top-level head, parent card → child head)
     are cubic S-curves entering the head's LEFT side at mid-height. The bulge factor
     (user-tunable, default ×5) scales both lobes: the root edge bows up then swings into the
     head's LEFT margin, entering LEVEL (no downward sag, horizontal tangent); the branch edge
     leaves the parent horizontally, bows OUTWARD (away from the chain) and hooks into the
     child head — at ×0 each collapses to the straight chord. */
  const byKey = new Map()
  for (const node of nodes) byKey.set(node.key, node)
  const mountBulge = clampMountBulge(mountBulgeParam)
  for (const edge of edges) {
    const from = byKey.get(edge.from)
    const to = byKey.get(edge.to)
    if (from === undefined || to === undefined) continue
    if (edge.mount === true) {
      if (from.kind === 'root') {
        const sx = from.x + from.width / 2
        const sy = from.y + from.height
        const tx = to.x
        const ty = to.y + to.height / 2
        const c1x = sx - 61.2 * mountBulge
        const c1y = sy + 5.4 * mountBulge
        const c2x = tx - 24 * mountBulge
        /* Head entry stays LEVEL (control y = the entry mid-height): swings into the head's LEFT
           margin but never sags below the entry, with a horizontal tangent at the left edge. */
        const c2y = ty
        edge.d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`
      } else {
        const sx = from.x + from.width
        const sy = from.y + from.height / 2
        const tx = to.x
        const ty = to.y + to.height / 2
        const c1x = sx + 13 * mountBulge
        /* The branch edge leaves the parent HORIZONTALLY (control y on the card's mid-height,
           no upward bow), then bows outward and hooks into the child head. Control offsets are
           balanced so the exit arc (~13/unit outward) and entry arc (~12/unit leftward) read as
           the SAME curve, each staying inside the column gap. */
        const c1y = sy
        const c2x = tx - 12 * mountBulge
        const c2y = ty + 1.2 * mountBulge
        edge.d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`
      }
    } else {
      const x1 = from.x + from.width
      const y1 = from.y + from.height / 2
      const x2 = to.x
      const y2 = to.y + to.height / 2
      const mx = (x1 + x2) / 2
      edge.d = `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`
    }
  }
  const lastEntry = order.length > 0 ? entryBySession.get(String(order[order.length - 1].sessionId)) : undefined
  const lastRow = lastEntry === undefined ? 1 : lastEntry.row
  /* One trailing row gap so the last card never sits flush against the
     viewport bottom on first fit / restore view (the top already reserves
     rootY). */
  const height = rootY + MINDMAP_ROOT_H + MINDMAP_ROW_GAP + MINDMAP_NODE_H + lastRow * (MINDMAP_NODE_H + MINDMAP_ROW_GAP)
  /* Bounding box of a temporarily-expanded (peeked) run: the amber dashed
     outline rendered by the view (pointer-events: none, so it never blocks
     card clicks). */
  let peekBox = null
  if (peekedNodeKeys.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const key of peekedNodeKeys) {
      const node = byKey.get(key)
      if (node === undefined) continue
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + node.width)
      maxY = Math.max(maxY, node.y + node.height)
    }
    if (Number.isFinite(minX)) {
      peekBox = { x: minX - 6, y: minY - 6, w: maxX - minX + 12, h: maxY - minY + 12 }
    }
  }
  return { nodes, edges, width, height, peekBox }
}

export const mindmapXOf = depth => MINDMAP_DEPTH_GAP + depth * (MINDMAP_NODE_W + MINDMAP_DEPTH_GAP)

/* Normalize a workspace path for IDENTITY comparison: case-fold + strip the
   trailing slash so `w.path === cwd`-style exact matches cannot miss on
   Windows drives, trailing separators or mixed \ / (the sidebar grouping and
   the root-node workspace resolver must agree on the same comparison). */
export function normalizeMindmapWorkspacePath(path) {
  return String(path ?? '').replace(/[\\/]+$/, '').toLowerCase()
}

/* The action a click on a layout node performs — 'new' (new top-level session at the root),
   'fork' (nested branch at this card) or 'switch' (jump the right-side chat to this node's own
   session). Exact mirror of the openCard decision tree, shared by hover hint and click handler
   so the hint can never drift from the real behavior. A generating session's last completed
   card is semantically a middle card (its real tail is the streaming card), hence it forks. */
export const mindmapCardClickAction = (node, doc, runningFamilyIds, lastSeqBySession) => {
  if (node === undefined) return undefined
  if (node.kind === 'root') return 'new'
  if (node.kind === 'head') return 'switch'
  /* A folded card stands in for a whole run of turns: forking at it would be
     ambiguous (no single anchor turn), so clicking temporarily expands the
     run instead (peek — the folded attribute is untouched). */
  if (node.folded === true) return 'peek'
  if (node.streaming === true) return 'switch'
  if (node.empty) return 'switch'
  const owner = node.sessionId
  /* Callers may pass a precomputed sessionId → last-turn-seq map (the render
     path builds one per doc): without it the per-card find() below makes the
     whole canvas O(cards × sessions) on every render. */
  let lastSeq
  if (lastSeqBySession !== undefined && lastSeqBySession !== null) {
    lastSeq = lastSeqBySession.get(String(owner))
  } else {
    const chain = (doc?.sessions ?? []).find(s => String(s?.sessionId) === String(owner))?.turns ?? []
    lastSeq = chain.length > 0 ? chain[chain.length - 1]?.seq : undefined
  }
  if (lastSeq !== undefined && lastSeq === node.turn?.seq) {
    return runningFamilyIds.includes(String(owner)) ? 'fork' : 'switch'
  }
  return 'fork'
}

/* Clamp the view so the scaled world always keeps a MINIMUM fraction on screen: each axis may
   be dragged out by up to MINDMAP_PAN_OUT_MAX of the world size (e.g. 80%), so the opposite
   20% stays visible. A map SMALLER than the viewport can also slide (not pinned to the center);
   还原视图 restores the fitted position when the map is pushed out of reach. */
export function mindmapClampView(view, worldW, worldH, vw, vh) {
  const sw = worldW * view.zoom
  const sh = worldH * view.zoom
  const out = MINDMAP_PAN_OUT_MAX
  /* x: from the world pushed left (right 20% at the viewport's left edge) to pushed right (left 20% at the right edge). */
  const tx = sw <= 0 || vw <= 0
    ? view.tx
    : Math.max(-out * sw, Math.min(view.tx, vw - (1 - out) * sw))
  const ty = sh <= 0 || vh <= 0
    ? view.ty
    : Math.max(-out * sh, Math.min(view.ty, vh - (1 - out) * sh))
  return { zoom: view.zoom, tx, ty }
}

/* Initial / "还原视图" view: fit the whole map (capped at 1x, never upscaled);
   a map too large to fit even at min zoom aligns to the top-left. */
export function mindmapFitView(worldW, worldH, vw, vh) {
  if (worldW <= 0 || worldH <= 0 || vw <= 0 || vh <= 0) return null
  const zoom = Math.max(Math.min(Math.min(vw / worldW, vh / worldH), 1), MINDMAP_ZOOM_MIN)
  const sw = worldW * zoom
  const sh = worldH * zoom
  const tx = sw <= vw ? (vw - sw) / 2 : MINDMAP_PAN_MARGIN
  const ty = sh <= vh ? (vh - sh) / 2 : MINDMAP_PAN_MARGIN
  return { zoom, tx, ty }
}

/* Narrowed sessions subscription: the map only reads the doc family's running
   flags and titles, but `useSessions(state => state)` re-renders every card on
   any store churn. The selector returns the SAME projection while those fields
   are unchanged (so idle churn never re-renders), rebuilds when a family field
   changes or the family grows, and keeps the latest byId so reads stay fresh.
   The unchanged check compares the family's running bits / titles by VALUE
   (arrays, no string building) — the selector runs on every store change
   (streaming churn), so it must stay allocation-free on the hot path. */
export function useMindmapSessionView(useSessions, familyIdsRef) {
  const cacheRef = useRef(null)
  /* Join-string cache keyed by the family ARRAY identity (the caller memoizes
     the array per doc/rootId change): the selector runs on every store change
     (streaming churn), and an unconditional `family.join('\u0002')` would
     allocate a fresh string on every run — the whole point of the value-level
     unchanged check below is to stay allocation-free on the hot path. */
  const keyRef = useRef(null) // { family, key }
  return useSessions((state) => {
    const byId = state?.byId ?? {}
    const family = familyIdsRef.current
    const keyed = keyRef.current
    const familyKey = keyed !== null && keyed.family === family
      ? keyed.key
      : (keyRef.current = { family, key: family.join('\u0002') }).key
    const cache = cacheRef.current
    if (cache !== null && cache.familyKey === familyKey) {
      let same = true
      for (let i = 0; i < family.length; i += 1) {
        const cur = byId[family[i]]
        const running = cur !== undefined && cur.running === true
        const title = cur !== undefined && typeof cur.displayTitle === 'string' ? cur.displayTitle : ''
        if (running !== cache.running[i] || title !== cache.titles[i]) { same = false; break }
      }
      if (same) return cache.view
    }
    /* The view carries ONLY the family-projected running bits and titles — no
       raw byId — so it is a stable object while those fields are unchanged
       (idle store churn never re-renders the map) AND the selector stays pure
       (no mutation of a previously-returned object). */
    const running = []
    const titles = []
    for (const id of family) {
      const cur = byId[id]
      running.push(cur !== undefined && cur.running === true)
      titles.push(cur !== undefined && typeof cur.displayTitle === 'string' ? cur.displayTitle : '')
    }
    const view = {
      runningIds: new Set(family.filter((id, index) => running[index])),
      titles: Object.fromEntries(family.map((id, index) => [id, titles[index]])),
    }
    cacheRef.current = { familyKey, running, titles, view }
    return view
  })
}
