/* The draft-restore DECISION: given what the Host says about a file's draft file and what the tab holds
 * in memory, what content should the editor show, is it dirty, and which banner (if any) applies?
 *
 * Extracted from the read pass in hooks/editor-session.js, where it was ~50 lines of inline booleans
 * inside a 700-line callback. Everything here is a pure function of its arguments — no refs, no setters,
 * no requests — which is what makes the Host's draft-record contract checkable by reading one file.
 *
 * The CONTRACT (enforced by the Host when it writes and reads the record, so a record that violates it is
 * treated as "not restorable" rather than patched up from the current disk revision):
 *   - `draft` is a string;
 *   - `baseText` is a string (the baseline the draft was derived from);
 *   - `baseRevision` is a string or an explicit null (never missing).
 */

/** Whether a Host draft record carries every field the restore path needs. */
export function isRestorableDraftRecord(draft) {
  return draft !== null && typeof draft === 'object'
    && draft.exists !== false && typeof draft.draft === 'string'
    && typeof draft.baseText === 'string'
    && (typeof draft.baseRevision === 'string' || draft.baseRevision === null)
}

/** Whether a restorable record actually carries UNSAVED work: a draft equal to its own baseline, or to
 *  the source on disk, is a leftover and must never override a later disk revision. */
export function draftHasUnsavedWork(record, diskContent) {
  return record.draft !== record.baseText && record.draft !== diskContent
}

/** Whether the tab's in-memory draft is materialized and differs from disk. A live tab knows this
 *  explicitly (`draftKnown`), so a deliberate empty edit stays distinct from a content-free dirty
 *  marker restored from localStorage. */
export function tabHasDraft(tab, diskContent) {
  return tab !== undefined && tab !== null && tab.draftKnown === true
    && typeof tab.draft === 'string' && tab.draft !== diskContent
}

/**
 * The restore decision.
 *
 * @param tabDraft - the tab when it holds a materialized draft, else undefined.
 * @param diskDraft - the Host's draft record (any shape).
 * @param diskDraftHasWork - `draftHasUnsavedWork` applied to a restorable record.
 * @param result - the file read: `{ content, revision }`.
 * @param editable - whether the file may be edited at all (a read-only file's draft cannot be saved).
 * @param effectiveEncoding - the encoding the read used.
 * @param selection - the tab's display entry (`{ name, symlink }`).
 * @param hostReadFailed - the draft read failed outright (distinct from "no draft").
 * @returns `{ ready, status, restored, canRestore, hasRestoredContent, restoredDirty, externallyChanged,
 *   hasDiskDraft, hasTabDraft }` — `ready` is the preview payload, `status` the banner or undefined.
 */
export function draftRestoreDecision({
  tabDraft,
  diskDraft,
  diskDraftHasWork,
  result,
  editable,
  effectiveEncoding,
  selection,
  activePath,
  hostReadFailed,
  translate,
}) {
  const hasDiskDraft = diskDraftHasWork
  const hasTabDraft = tabHasDraft(tabDraft, result.content)
  /* In-session the in-memory tab draft is always at least as new as any disk draft, so prefer it; on a
     cold restore the disk draft rehydrates the session. */
  const restored = hasTabDraft
    ? { content: tabDraft.draft, baseText: tabDraft.baseText, baseRevision: tabDraft.revision }
    : hasDiskDraft
      ? { content: diskDraft.draft, baseText: diskDraft.baseText, baseRevision: diskDraft.baseRevision }
      : { content: result.content, baseText: result.content, baseRevision: result.revision }
  const content = restored.content
  const hasRestoredContent = hasDiskDraft || hasTabDraft
  const canRestore = hasRestoredContent && editable
  const restoredDirty = hasRestoredContent && content !== restored.baseText
  // Compare the SOURCE content to the snapshot: if an external tool changed it, restore still shows the
  // draft and defers to the save-time three-way merge.
  const diskText = typeof result.content === 'string' ? result.content : ''
  const externallyChanged = canRestore && diskText !== restored.baseText
  const ready = {
    state: 'ready',
    ...result,
    name: selection.name,
    path: activePath,
    symlink: Boolean(selection.symlink),
    content,
    revision: result.revision ?? null,
    encoding: result.encoding ?? effectiveEncoding,
    lineEnding: result.lineEnding ?? 'none',
    bom: Boolean(result.bom),
    size: result.size,
  }
  /* Banner precedence, exactly as the read pass applied it: a restored draft's own banner first, then
     "cannot restore", then "the draft read failed" — and NOTHING when none applies, so the caller leaves
     whatever status the pass had set. */
  const status = canRestore
    ? externallyChanged
      ? { error: true, text: translate('status.draftRestoredConflict') }
      : { text: translate('status.draftRestored') }
    : hasDiskDraft || hasTabDraft
      ? { error: true, text: translate('status.draftNotRestorable') }
      : hostReadFailed && !hasDiskDraft && !hasTabDraft
        /* A failed Host draft read must not silently degrade to a clean tab: warn that unsaved work may be
           hidden. */
        ? { error: true, text: translate('status.draftReadFailed') }
        : undefined
  return {
    canRestore,
    externallyChanged,
    hasDiskDraft,
    hasRestoredContent,
    hasTabDraft,
    ready,
    restored,
    restoredDirty,
    status,
  }
}
