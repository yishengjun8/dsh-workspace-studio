import { createElement as h } from 'react'
import { MERGE_MAX_LINES, MYERS_TRACE_CELL_LIMIT } from './constants.js'

/* ---- Save-time three-way merge (Git-like conflict resolution) ----
 *
 * When an explicit save finds the file changed on disk since the editing
 * snapshot, user and external edits are merged: non-overlapping changes both
 * kept (clean merge), overlapping ones become conflicts for the user to pick.
 * Inputs split on '\n' — editor and disk text share line endings because
 * editable files are never mixed — preserving line endings without extra
 * normalization.
 */

/* Budgeted Myers diff: the { from, to, added } edit script turning `base`
   into `mine`, or null when the trace would exceed the memory budget.
   Adjacent ops coalesce so a replacement is one change, not del + ins. */
export function myersDiff(base, mine, alt = false) {
  const N = base.length
  const M = mine.length
  /* Empty-empty is an identity edit: return no changes immediately instead of
     running the frontier (which would read v[1] out of bounds on a 1-cell
     array). */
  if (N === 0 && M === 0) return []
  const max = N + M
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace = []
  let found = false
  let d = 0
  for (; d <= max && !found; d += 1) {
    if ((trace.length + 1) * v.length > MYERS_TRACE_CELL_LIMIT) return null
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x
      /* The tie-break (< vs <=) selects one canonical shortest path among
         several when repeated values make the greedy snake ambiguous; `alt`
         flips it so a merge that clusters poorly on one can try the other. */
      if (k === -d || (k !== d && (alt ? v[offset + k - 1] <= v[offset + k + 1] : v[offset + k - 1] < v[offset + k + 1]))) x = v[offset + k + 1]
      else x = v[offset + k - 1] + 1
      let y = x - k
      while (x < N && y < M && base[x] === mine[y]) { x += 1; y += 1 }
      v[offset + k] = x
      if (x >= N && y >= M) { found = true; break }
    }
  }
  const changes = []
  let x = N
  let y = M
  // `d` is one past the found end; the trace snapshot for backtracking step
  // dd was recorded at the start of iteration dd.
  for (let dd = d - 1; dd >= 1; dd -= 1) {
    const vPrev = trace[dd]
    const k = x - y
    let prevK
    if (k === -dd || (k !== dd && (alt ? vPrev[offset + k - 1] <= vPrev[offset + k + 1] : vPrev[offset + k - 1] < vPrev[offset + k + 1]))) prevK = k + 1
    else prevK = k - 1
    const prevX = vPrev[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { x -= 1; y -= 1 }
    if (x === prevX) changes.push({ from: x, to: x, added: mine.slice(prevY, y) })
    else changes.push({ from: prevX, to: x, added: mine.slice(prevY, y) })
    x = prevX
    y = prevY
  }
  changes.reverse()
  // Coalesce adjacent operations (deletion + insertion at the same position
  // = one replacement; two insertions = one) so the merge walk sees one
  // change per base span.
  const coalesced = []
  for (const change of changes) {
    const previous = coalesced[coalesced.length - 1]
    if (previous !== undefined && change.from === previous.to) {
      coalesced[coalesced.length - 1] = { from: previous.from, to: change.to, added: [...previous.added, ...change.added] }
    } else {
      coalesced.push({ from: change.from, to: change.to, added: [...change.added] })
    }
  }
  return coalesced
}

export function linesEqual(left, right) {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

export function changesTouch(left, right) {
  const leftInsertion = left.from === left.to
  const rightInsertion = right.from === right.to
  if (leftInsertion && rightInsertion) return left.from === right.from
  // An insertion touches a span only when it lands INSIDE [from, to): at the
  // exclusive end (right.to / left.to) it is disjoint from the deletion and
  // must merge cleanly (one side deletes the last line, the other appends).
  if (leftInsertion) return left.from >= right.from && left.from < right.to
  if (rightInsertion) return right.from >= left.from && right.from < left.to
  return left.from < right.to && right.from < left.to
}

export function changeTouchesSpan(change, start, end) {
  if (change.from === change.to) {
    // A degenerate span (start === end) is touched by insertions exactly at
    // that point; otherwise the half-open rule holds — an insertion at the
    // exclusive end stays disjoint and merges cleanly.
    return end === start
      ? change.from === start
      : change.from >= start && change.from < end
  }
  return change.from < end && change.to > start
}

export function appendMergeText(parts, lines) {
  if (lines.length === 0) return
  const previous = parts[parts.length - 1]
  if (previous?.kind === 'text') previous.lines.push(...lines)
  else parts.push({ kind: 'text', lines: [...lines] })
}

export function applyChangesToSpan(base, start, end, changes) {
  const output = []
  let cursor = start
  for (const change of changes) {
    if (change.from < cursor || change.to < change.from || change.to > end) return null
    output.push(...base.slice(cursor, change.from), ...change.added)
    cursor = change.to
  }
  output.push(...base.slice(cursor, end))
  return output
}

/* Map a base-coordinate span to the corresponding slice of the side array
   through the side's edit script. Used to verify a conflict region's
   mine/theirs segments against the REAL side text: the parts skeleton mixes
   both sides' non-conflicting edits, so rebuilding one side from it fails
   whenever the other side also edited elsewhere (a false unsound-cluster
   that degraded mixed merges to a whole-file conflict). */
export function sideSliceForSpan(base, side, changes, start, end) {
  const result = []
  let basePos = 0
  let sidePos = 0
  for (const change of changes) {
    if (change.from >= end) break
    // Unchanged run base[basePos..change.from): copy the side's corresponding lines.
    const keepStart = Math.max(basePos, start)
    const keepEnd = Math.min(change.from, end)
    if (keepEnd > keepStart) {
      result.push(...side.slice(sidePos + (keepStart - basePos), sidePos + (keepEnd - basePos)))
    }
    // Edited run base[change.from..change.to) -> change.added: copy the overlap.
    const delStart = Math.max(change.from, start)
    const delEnd = Math.min(change.to, end)
    if (delEnd > delStart) {
      const addedStart = delStart - change.from
      const addedEnd = Math.min(change.added.length, delEnd - change.from)
      if (addedEnd > addedStart) result.push(...change.added.slice(addedStart, addedEnd))
    }
    basePos = change.to
    sidePos += change.added.length
  }
  if (basePos < end) {
    const keepStart = Math.max(basePos, start)
    if (end > keepStart) result.push(...side.slice(sidePos + (keepStart - basePos), sidePos + (end - basePos)))
  }
  return result
}

export function wholeFileConflict(base, mine, theirs, reason) {
  return {
    status: 'conflict',
    fallbackReason: reason,
    conflicts: [{ id: 0, start: 0, end: base.length, base, mine, theirs, display: 'plain' }],
    parts: [{ kind: 'conflict', id: 0 }],
  }
}

export function resolveMergeParts(parts, conflicts, choices) {
  if (!Array.isArray(choices) || choices.length !== conflicts.length
    || choices.some(choice => choice !== 'mine' && choice !== 'theirs')) {
    throw new Error('workspace-studio: incomplete conflict choices')
  }
  const output = []
  for (const part of parts) {
    if (part.kind === 'text') output.push(...part.lines)
    else {
      const conflict = conflicts[part.id]
      if (conflict === undefined) throw new Error('workspace-studio: invalid conflict part')
      output.push(...conflict[choices[part.id]])
    }
  }
  return output.join('\n')
}

/* Merge both edit scripts by clustering every transitively overlapping
   change — the closure that makes one-large-vs-many-small overlaps terminate.
   Conflicts stay structural (`parts`), so user text can never collide with a
   marker string. Returns { parts, conflicts } on a consistent walk, or
   { fallback: reason } when the scripts are unusable (caller falls back to
   the whole-file conflict). */
export function runMergeWalk(base, mine, theirs, mineChanges, theirsChanges) {
  const parts = []
  const conflicts = []
  let mi = 0
  let ti = 0
  let cursor = 0
  let steps = 0
  const maxSteps = 4 * (mineChanges.length + theirsChanges.length + 1)

  while (mi < mineChanges.length || ti < theirsChanges.length) {
    if (steps >= maxSteps) return { fallback: 'merge-progress' }
    steps += 1
    const m = mineChanges[mi]
    const t = theirsChanges[ti]

    if (m !== undefined && t !== undefined && changesTouch(m, t)) {
      let start = Math.min(m.from, t.from)
      let end = Math.max(m.to, t.to)
      const mineCluster = []
      const theirsCluster = []
      let expanded
      do {
        expanded = false
        while (mi < mineChanges.length && changeTouchesSpan(mineChanges[mi], start, end)) {
          const change = mineChanges[mi]
          mi += 1
          mineCluster.push(change)
          start = Math.min(start, change.from)
          end = Math.max(end, change.to)
          expanded = true
        }
        while (ti < theirsChanges.length && changeTouchesSpan(theirsChanges[ti], start, end)) {
          const change = theirsChanges[ti]
          ti += 1
          theirsCluster.push(change)
          start = Math.min(start, change.from)
          end = Math.max(end, change.to)
          expanded = true
        }
      } while (expanded)

      if (start < cursor || end < start) return { fallback: 'invalid-cluster' }
      appendMergeText(parts, base.slice(cursor, start))
      const baseSegment = base.slice(start, end)
      const mineSegment = applyChangesToSpan(base, start, end, mineCluster)
      const theirsSegment = applyChangesToSpan(base, start, end, theirsCluster)
      if (mineSegment === null || theirsSegment === null) return { fallback: 'invalid-change' }
      if (linesEqual(mineSegment, theirsSegment)) appendMergeText(parts, mineSegment)
      else if (linesEqual(mineSegment, baseSegment)) appendMergeText(parts, theirsSegment)
      else if (linesEqual(theirsSegment, baseSegment)) appendMergeText(parts, mineSegment)
      else {
        const id = conflicts.length
        conflicts.push({ id, start, end, base: baseSegment, mine: mineSegment, theirs: theirsSegment, display: 'diff' })
        parts.push({ kind: 'conflict', id })
      }
      cursor = end
      continue
    }

    const mineFirst = m !== undefined && (t === undefined || m.from < t.from || (m.from === t.from && m.to <= t.to))
    const change = mineFirst ? m : t
    if (change === undefined || change.from < cursor || change.to < change.from) {
      return { fallback: 'invalid-progress' }
    }
    appendMergeText(parts, base.slice(cursor, change.from))
    appendMergeText(parts, change.added)
    cursor = change.to
    if (mineFirst) mi += 1
    else ti += 1
  }

  appendMergeText(parts, base.slice(cursor))
  return { parts, conflicts }
}

/* Finalize a merge walk: clean when no conflicts, a structural conflict list
   after the round-trip soundness check, or { fallback: reason } when the walk
   cannot reconstruct one side (whole-file conflict is safer than a wrong save).
   Shared by the primary and the alternate-tie-break retry. `mineText` /
   `theirsText` are the ORIGINAL side texts (the arrays are split copies), used
   by the round-trip check below. */
export function tryMergeWithScripts(base, mine, theirs, mineChanges, theirsChanges, mineText, theirsText) {
  const walked = runMergeWalk(base, mine, theirs, mineChanges, theirsChanges)
  if (walked.fallback !== undefined) return walked
  const { parts, conflicts } = walked
  if (conflicts.length > 0) {
    /* The conflict structure is trustworthy only when each conflict region's
       side segment matches the REAL side text mapped through that side's edit
       script: a non-canonical Myers diff on repeated identical lines can
       split one replacement into an insertion plus a remote deletion whose
       coordinates collide, so the clustered segment cannot reconstruct one
       side. Verified per region against the side arrays (NOT the parts
       skeleton — it mixes both sides' non-conflicting edits, so rebuilding
       one side from it fails whenever the other side also edited elsewhere,
       degrading mixed merges to a whole-file conflict). If any region fails,
       fall back to the whole-file conflict (exact choice) — a wrong save is
       worse than a manual one. */
    for (const conflict of conflicts) {
      /* A degenerate region (start === end) is an insertion-only clash: both
         sides inserted different text at the same point. There is no base
         span to map (sideSliceForSpan would return []), and no deletion span
         means no non-canonical coordinate collision is possible — the
         structure is exact, skip the check. */
      if (conflict.start === conflict.end) continue
      const mineSlice = sideSliceForSpan(base, mine, mineChanges, conflict.start, conflict.end)
      const theirsSlice = sideSliceForSpan(base, theirs, theirsChanges, conflict.start, conflict.end)
      if (!linesEqual(mineSlice, conflict.mine) || !linesEqual(theirsSlice, conflict.theirs)) {
        return { fallback: 'unsound-cluster' }
      }
    }
    return { status: 'conflict', conflicts, parts }
  }
  return { status: 'clean', merged: resolveMergeParts(parts, [], []) }
}

/* Merge both edit scripts by clustering every transitively overlapping
   change — the closure that makes one-large-vs-many-small overlaps terminate.
   Conflicts stay structural (`parts`), so user text can never collide with a
   marker string. */
export function threeWayMerge(baseText, mineText, theirsText) {
  const base = baseText.split('\n')
  const mine = mineText.split('\n')
  const theirs = theirsText.split('\n')
  // Budget guard first: an oversized file that happens to equal one side must
  // still fall back to the whole-file dialog, not commit unchecked.
  if (base.length > MERGE_MAX_LINES || mine.length > MERGE_MAX_LINES || theirs.length > MERGE_MAX_LINES) {
    return wholeFileConflict(base, mine, theirs, 'line-limit')
  }
  if (mineText === theirsText) return { status: 'clean', merged: mineText }
  if (baseText === mineText) return { status: 'clean', merged: theirsText }
  if (baseText === theirsText) return { status: 'clean', merged: mineText }
  const mineChanges = myersDiff(base, mine)
  const theirsChanges = myersDiff(base, theirs)
  if (mineChanges === null || theirsChanges === null) return wholeFileConflict(base, mine, theirs, 'diff-budget')

  const primary = tryMergeWithScripts(base, mine, theirs, mineChanges, theirsChanges, mineText, theirsText)
  if (primary.fallback === undefined) return primary
  /* A non-canonical Myers tie-break on repeated identical lines can cluster
     disjoint edits into a false conflict that fails the round-trip check
     (unsound-cluster). Retry with the alternate canonical shortest path —
     bounded to ONE retry, and accepted only when it passes the same round-trip
     verification; otherwise the whole-file conflict stands. */
  if (primary.fallback === 'unsound-cluster') {
    const altMine = myersDiff(base, mine, true)
    const altTheirs = myersDiff(base, theirs, true)
    if (altMine !== null && altTheirs !== null) {
      const alt = tryMergeWithScripts(base, mine, theirs, altMine, altTheirs, mineText, theirsText)
      if (alt.fallback === undefined) return alt
    }
  }
  return wholeFileConflict(base, mine, theirs, primary.fallback)
}

/* Character-level diff of one conflict side against the common base:
   coalesced { text, kind } segments ('same' | 'add' | 'del'). Unchanged keep
   color, added green, removed red strikethrough, all inline. Codepoint
   splitting keeps surrogate pairs intact. Returns null when too large (caller
   falls back to line-level). */
export const INLINE_DIFF_MAX_CHARS = 20000
export function inlineDiffSegments(baseText, sideText) {
  const baseChars = Array.from(baseText)
  const sideChars = Array.from(sideText)
  if (baseChars.length > INLINE_DIFF_MAX_CHARS || sideChars.length > INLINE_DIFF_MAX_CHARS) return null
  const changes = myersDiff(baseChars, sideChars)
  if (changes === null) return null
  const segments = []
  let i = 0
  const push = (text, kind) => {
    if (text.length === 0) return
    const previous = segments[segments.length - 1]
    if (previous !== undefined && previous.kind === kind) previous.text += text
    else segments.push({ text, kind })
  }
  for (const change of changes) {
    for (; i < change.from; i += 1) push(baseChars[i], 'same')
    for (let k = change.from; k < change.to; k += 1) push(baseChars[k], 'del')
    for (const char of change.added) push(char, 'add')
    i = change.to
  }
  for (; i < baseChars.length; i += 1) push(baseChars[i], 'same')
  return segments
}

/* React nodes for one conflict side against the common base: character-level
   inline diff (unchanged plain, added green, removed red strikethrough);
   newlines in any segment keep the <pre>'s exact line layout. Oversized
   regions fall back to line-level marks. */
export function diffRows(baseLines, sideLines) {
  const segments = inlineDiffSegments(baseLines.join('\n'), sideLines.join('\n'))
  if (segments !== null) {
    const nodes = []
    for (const segment of segments) {
      nodes.push(segment.kind === 'same'
        ? segment.text
        : h('span', { className: `dsh-ws-inline-${segment.kind}` }, segment.text))
    }
    return nodes
  }
  // Fallback: line-level diff rows (deleted lines struck, added highlighted)
  // for content too large for the character diff.
  const rows = diffSideLines(baseLines, sideLines)
  const nodes = []
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0) nodes.push('\n')
    nodes.push(h('span', { className: 'dsh-ws-conflict-code-row', 'data-kind': rows[i].kind }, rows[i].text))
  }
  return nodes
}

/* Line-level diff rows for one conflict side: { text, kind }[] with kind
   'same' | 'add' | 'del'; the oversized fallback for the inline diff. */
export function diffSideLines(baseLines, sideLines) {
  if (baseLines.length > MERGE_MAX_LINES || sideLines.length > MERGE_MAX_LINES) {
    return sideLines.map(text => ({ text, kind: 'same' }))
  }
  const changes = myersDiff(baseLines, sideLines)
  if (changes === null) return sideLines.map(text => ({ text, kind: 'same' }))
  const rows = []
  let i = 0
  for (const change of changes) {
    for (; i < change.from; i += 1) rows.push({ text: baseLines[i], kind: 'same' })
    for (let k = change.from; k < change.to; k += 1) rows.push({ text: baseLines[k], kind: 'del' })
    for (const line of change.added) rows.push({ text: line, kind: 'add' })
    i = change.to
  }
  for (; i < baseLines.length; i += 1) rows.push({ text: baseLines[i], kind: 'same' })
  return rows
}