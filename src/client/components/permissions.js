/* Console-command file permissions: the scope page and the global authorization prompt.
 *
 * The page is a synthetic preview tab (opened from the preview strip's context menu). The prompt is
 * rendered by AppFrame at the root so a command blocked in any Session is visible from any tab.
 *
 * Both surfaces are Host-driven: permission-store.js only mirrors the last answer. Grants, pending
 * requests, history and settings live in permissions/cache.json and survive a dsh restart.
 */
import { createElement as h, Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { translate } from '../locale/index.js'
import { copyText } from '../paths.js'
import { PanelState } from '../panel-state.js'
import { Modal } from './dialogs.js'
import {
  decidePermissionRequest,
  pausePermissions,
  refreshPermissionSnapshot,
  resumePermissions,
  revokeAllPermissions,
  revokePermission,
  usePermissionRequestBusy,
  usePermissionSnapshot,
  usePendingPermissions,
} from '../permission-store.js'

function IconShield({ size = 16 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', { d: 'M8 1.8 13 3.8v3.6c0 3-2 5.2-5 6.6-3-1.4-5-3.6-5-6.6V3.8Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
    h('path', { d: 'm5.8 8 1.5 1.5 3-3.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function IconFolder({ size = 12 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', { d: 'M1.6 4.3c0-.9.7-1.6 1.6-1.6h2.9l1.3 1.5h5.2c.9 0 1.6.7 1.6 1.6v5.8c0 .9-.7 1.6-1.6 1.6H3.2c-.9 0-1.6-.7-1.6-1.6V4.3Z', fill: 'currentColor' }))
}

function IconFile({ size = 12 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', { d: 'M3 1.8h6L12.8 5v9.2H3Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }),
    h('path', { d: 'M9 1.8V5h3.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }))
}

function IconRefresh() {
  return h('svg', { 'aria-hidden': true, height: 14, viewBox: '0 0 16 16', width: 14 },
    h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.6V5h-2.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function IconClock({ size = 10 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('circle', { cx: 8, cy: 8, fill: 'none', r: 6, stroke: 'currentColor', strokeWidth: 1.4 }),
    h('path', { d: 'M8 4.6V8l2.1 1.4', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.4 }))
}

function IconSpark({ size = 11 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', { d: 'm8 1.9 1.5 4.6L14 8l-4.5 1.5L8 14.1 6.5 9.5 2 8l4.5-1.5L8 1.9Z', fill: 'none', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.2 }))
}

function IconWarning({ size = 11 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', { d: 'M8 2.2 14.2 13H1.8L8 2.2Z', fill: 'none', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.3 }),
    h('path', { d: 'M8 6v3.1M8 11.2v.1', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.4 }))
}

function IconChart({ size = 11 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', { d: 'M2.5 13.5V8.8M8 13.5V2.8M13.5 13.5V6.2', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.3 }))
}

function IconCopy({ size = 10 }) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('rect', { fill: 'none', height: 7.2, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.3, width: 7.2, x: 5.2, y: 5.2 }),
    h('path', { d: 'M10.8 5.2V4.1c0-.7-.6-1.3-1.3-1.3H4.1c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }))
}

function splitPath(value) {
  const text = String(value ?? '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  if (index < 0) return { name: text, parent: '' }
  return { name: text.slice(index + 1) || text, parent: text.slice(0, index + 1) }
}

/* The path line under a grant's name shows the WHOLE recorded path: a folder row must name the
   granted folder itself (not its parent) and a file row must end with the file name. Trailing
   separators are dropped except on a bare root (`/` or `C:\`), which is a real path. */
function grantPathLabel(value) {
  const text = String(value ?? '')
  const trimmed = text.replace(/[\\/]+$/u, '')
  if (trimmed === '') return text
  return /^[A-Za-z]:$/u.test(trimmed) ? `${trimmed}\\` : trimmed
}

function parentPathOf(value) {
  const text = String(value ?? '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  if (index <= 0) return text
  const parent = text.slice(0, index)
  return /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent
}

function isRootPath(value) {
  const text = String(value ?? '')
  return text === '/' || /^[A-Za-z]:[\\/]?$/u.test(text)
}

function samePathClient(left, right) {
  const normalize = (value) => {
    const text = String(value ?? '').replace(/[\\/]+/gu, '/').replace(/\/+$/u, '')
    return /^[A-Za-z]:/u.test(text) || text.startsWith('//') ? text.toLowerCase() : text
  }
  return normalize(left) === normalize(right)
}

function clockOf(ts) {
  const time = Number(ts)
  if (!Number.isFinite(time) || time <= 0) return ''
  try {
    return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function operationKey(op) {
  if (op === 'delete') return 'permission.operation.delete'
  if (op === 'create') return 'permission.operation.create'
  if (op === 'move') return 'permission.operation.move'
  if (op === 'modify') return 'permission.operation.modify'
  return 'permission.operation.unknown'
}

function operationTone(op) {
  if (op === 'delete') return 'del'
  if (op === 'create') return 'create'
  if (op === 'move') return 'move'
  if (op === 'modify') return 'mod'
  return 'unknown'
}

/* Prompt-only risk ordering / tone: deletes first, then moves, modifications, creations, so the
   dangerous rows are visible without scrolling. The Host's grant order is unaffected. */
function promptRiskOp(target) {
  const ops = Array.isArray(target?.operations) ? target.operations : []
  if (ops.includes('delete')) return 'delete'
  if (ops.includes('move')) return 'modify'
  if (ops.includes('create') && ops.includes('modify')) return 'mixed'
  if (ops.includes('modify')) return 'modify'
  if (ops.includes('create')) return 'create'
  return 'mixed'
}

function promptRiskRank(target) {
  const ops = Array.isArray(target?.operations) ? target.operations : []
  if (ops.includes('delete')) return 0
  if (ops.includes('move')) return 1
  if (ops.includes('modify')) return 2
  if (ops.includes('create')) return 3
  return 4
}

function promptSourceKey(target) {
  if (target?.source === 'ai') return 'permission.prompt.analysis.source.ai'
  if (target?.source === 'fallback') return 'permission.prompt.analysis.source.fallback'
  if (typeof target?.script === 'string' && target.script !== '') return 'permission.prompt.analysis.source.script'
  return 'permission.prompt.analysis.source.static'
}

function outcomeKey(outcome) {
  if (outcome === 'allowed') return 'permissions.history.allowed'
  if (outcome === 'allowed-once') return 'permissions.history.allowedOnce'
  if (outcome === 'paused') return 'permissions.history.paused'
  if (outcome === 'expired') return 'permissions.history.expired'
  if (outcome === 'blocked') return 'permissions.history.blocked'
  return 'permissions.history.denied'
}

function outcomeTone(outcome) {
  if (outcome === 'allowed' || outcome === 'allowed-once') return 'ok'
  if (outcome === 'expired' || outcome === 'blocked' || outcome === 'paused') return 'warn'
  return 'err'
}

function scopeKindLabel(scope) {
  return translate(scope?.kind === 'mindmap' ? 'permissions.scope.mindmap' : 'permissions.scope.session')
}

function scopeTitleOf(scope, sessionTitle) {
  const title = typeof scope?.title === 'string' && scope.title !== '' ? scope.title : (typeof sessionTitle === 'string' ? sessionTitle : '')
  return title === '' ? translate('permissions.scope.untitled') : title
}

function analysisLabel(target) {
  if (target?.source === 'ai') return translate('permissions.analysis.ai')
  if (target?.source === 'fallback') return translate('permissions.analysis.fallback')
  if (typeof target?.script === 'string' && target.script !== '') return translate('permissions.analysis.static')
  return translate('permissions.analysis.static')
}

function focusPrompt() {
  if (typeof document === 'undefined') return
  /* The prompt is a non-dismissible modal; the page's "Review" button should put the keyboard
     focus on its first action, not on a non-focusable dialog container. */
  const node = document.querySelector('.dsh-ws-perm-prompt .dsh-ws-perm-prompt-btn')
  if (node instanceof HTMLElement) node.focus()
}

function GrantRow({ busy, grant, onRevoke }) {
  const { name } = splitPath(grant.path)
  const fullPath = grantPathLabel(grant.path)
  const folder = grant.kind === 'folder'
  return h('div', { className: 'dsh-ws-perm-grant' },
    h('div', { className: 'dsh-ws-perm-grant-main' },
      h('span', { className: 'dsh-ws-perm-grant-icon', 'data-kind': folder ? 'folder' : 'file' }, folder ? h(IconFolder) : h(IconFile)),
      h('span', { className: 'dsh-ws-perm-grant-name' },
        h('strong', { title: grant.path }, name),
        h('span', { title: grant.path }, fullPath)),
      h('button', {
        'aria-label': translate('permissions.revoke.title', { path: grant.path }),
        className: 'dsh-ws-perm-revoke',
        disabled: busy === true,
        onClick: () => onRevoke(grant),
        title: translate('permissions.revoke.title', { path: grant.path }),
        type: 'button',
      }, '×')),
    h('div', { className: 'dsh-ws-perm-grant-meta' },
      ...(grant.operations ?? []).map(op => h('span', { className: 'dsh-ws-perm-op', 'data-tone': operationTone(op), key: op }, translate(operationKey(op)))),
      h('span', { className: 'dsh-ws-perm-grant-time' }, translate('permissions.grantedAt', { time: clockOf(grant.addedAt) }))))
}

export function PermissionPage({ sessionId, sessionTitle }) {
  const state = usePermissionSnapshot(sessionId)
  const [busyPath, setBusyPath] = useState(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notice, setNotice] = useState(undefined)
  const [confirmPause, setConfirmPause] = useState(false)
  const [pausing, setPausing] = useState(false)
  const snapshot = state.value
  const scope = snapshot?.scope
  const scopeTitle = scopeTitleOf(scope, sessionTitle)
  const scopeLabel = `${scopeKindLabel(scope)} · ${scopeTitle}`
  const grants = Array.isArray(snapshot?.grants) ? snapshot.grants : []
  const pending = Array.isArray(snapshot?.pending) ? snapshot.pending : []
  const history = Array.isArray(snapshot?.history) ? snapshot.history : []
  const folderGrants = useMemo(() => grants.filter(grant => grant.kind === 'folder').sort((left, right) => left.path.localeCompare(right.path)), [grants])
  const fileGrants = useMemo(() => grants.filter(grant => grant.kind !== 'folder').sort((left, right) => left.path.localeCompare(right.path)), [grants])

  const refresh = useCallback(() => { void refreshPermissionSnapshot(sessionId) }, [sessionId])
  const revoke = useCallback(async (grant) => {
    setBusyPath(grant.path)
    setNotice(undefined)
    try {
      await revokePermission(sessionId, grant.path)
      setNotice({ text: translate('permissions.revoked', { path: grant.path }) })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyPath(null)
    }
  }, [sessionId])
  const revokeAll = useCallback(async () => {
    setConfirmRevokeAll(false)
    setRevokingAll(true)
    setNotice(undefined)
    try {
      await revokeAllPermissions(sessionId)
      setNotice({ text: translate('permissions.revokedAll') })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setRevokingAll(false)
    }
  }, [sessionId])
  /* Pause is the only action that changes how commands behave without touching records, so it is
     confirmed first; resume is immediate because it only restores interception. Both refresh the
     page snapshot, and pause also drains this scope's waiting requests. */
  const pause = useCallback(async () => {
    setConfirmPause(false)
    setPausing(true)
    setNotice(undefined)
    try {
      await pausePermissions(sessionId)
      setNotice({ text: translate('permissions.pausedNotified', { scope: scopeLabel }) })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setPausing(false)
    }
  }, [sessionId, scopeLabel])
  const resume = useCallback(async () => {
    setPausing(true)
    setNotice(undefined)
    try {
      await resumePermissions(sessionId)
      setNotice({ text: translate('permissions.resumedNotified', { scope: scopeLabel }) })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setPausing(false)
    }
  }, [sessionId, scopeLabel])

  if (sessionId === null || sessionId === undefined || String(sessionId) === '') {
    return h('div', { className: 'dsh-ws-perm dsh-ws-perm-empty-state' },
      h(PanelState, { className: 'dsh-ws-empty', message: translate('permissions.noSession') }))
  }
  if (snapshot === null && state.error !== null && state.error !== undefined) {
    return h('div', { className: 'dsh-ws-perm dsh-ws-perm-empty-state' },
      h(PanelState, {
        className: 'dsh-ws-perm-error',
        error: true,
        message: translate('permissions.error', { message: state.error }),
        retry: refresh,
        retryLabel: translate('permissions.retry'),
      }))
  }
  if (snapshot === null) {
    return h('div', { className: 'dsh-ws-perm dsh-ws-perm-empty-state' },
      h(PanelState, { className: 'dsh-ws-empty', message: translate('permissions.loading') }))
  }

  const saveFailed = typeof snapshot.saveError === 'string' && snapshot.saveError !== ''
  /* Per-scope pause: manual, Host-persisted, and independent of the global switch. The banner and
     the toggle button are the only places the state is visible, so both stay on screen while it
     is off — silent interception is exactly what this button must never look like. */
  const paused = snapshot.paused === true
  const historySection = h('div', { className: 'dsh-ws-perm-history' },
    h('button', {
      'aria-expanded': historyOpen,
      className: 'dsh-ws-perm-history-head',
      onClick: () => setHistoryOpen(current => !current),
      type: 'button',
    },
    h('span', { 'aria-hidden': true, className: 'dsh-ws-perm-history-chevron' }, '▶'),
    h('span', null, translate('permissions.history')),
    h('span', { className: 'dsh-ws-perm-history-count' }, String(history.length)),
    h('span', { className: 'dsh-ws-perm-history-more' }, translate(historyOpen ? 'permissions.history.less' : 'permissions.history.more'))),
    historyOpen
      ? h('div', { className: 'dsh-ws-perm-history-body' },
        history.length === 0
          ? h('div', { className: 'dsh-ws-perm-history-empty' }, translate('permissions.history.empty'))
          : history.map(entry => h('div', { className: 'dsh-ws-perm-history-row', key: entry.id },
            h('span', { className: 'dsh-ws-perm-history-cmd', title: entry.command }, entry.command),
            h('span', { className: 'dsh-ws-perm-history-out', 'data-tone': outcomeTone(entry.outcome) }, translate(outcomeKey(entry.outcome))),
            h('span', { className: 'dsh-ws-perm-history-time' }, clockOf(entry.at)))))
      : null)

  return h('section', { className: 'dsh-ws-perm' },
    h('header', { className: 'dsh-ws-perm-head' },
      h('div', { className: 'dsh-ws-perm-title-row' },
        h('span', { className: 'dsh-ws-perm-shield' }, h(IconShield)),
        h('strong', { className: 'dsh-ws-perm-title' }, translate('permissions.tab')),
        h('span', { className: 'dsh-ws-perm-scope', title: scopeLabel }, scopeLabel),
        h('button', {
          'aria-label': translate('permissions.refresh'),
          className: 'dsh-ws-perm-icon-button',
          onClick: refresh,
          title: translate('permissions.refresh'),
          type: 'button',
        }, h(IconRefresh))),
      h('p', { className: 'dsh-ws-perm-desc' }, translate('permissions.desc')),
      snapshot.enabled === false ? h('p', { className: 'dsh-ws-perm-paused' }, translate('permissions.paused')) : null,
      paused
        ? h('div', { className: 'dsh-ws-perm-scope-paused' },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-perm-scope-paused-icon' }, '⏸'),
          h('div', { className: 'dsh-ws-perm-scope-paused-main' },
            h('strong', null, translate('permissions.scopePaused.title')),
            h('p', null, translate('permissions.scopePaused.body', { scope: scopeLabel })),
            h('p', { className: 'dsh-ws-perm-scope-paused-since' },
              snapshot.pausedAt > 0
                ? translate('permissions.scopePaused.since', { time: clockOf(snapshot.pausedAt) })
                : translate('permissions.scopePaused.persisted'))))
        : null,
      h('div', { className: 'dsh-ws-perm-summary' },
        h('span', null, translate('permissions.summary', { folders: String(folderGrants.length), files: String(fileGrants.length) })),
        h('button', {
          'aria-pressed': paused,
          className: 'dsh-ws-perm-pause',
          'data-paused': paused || undefined,
          disabled: pausing || snapshot.enabled === false,
          onClick: () => {
            if (paused) { void resume() } else { setConfirmPause(true) }
          },
          title: snapshot.enabled === false
            ? translate('permissions.pause.disabled')
            : paused ? translate('permissions.resume.title') : translate('permissions.pause.title'),
          type: 'button',
        }, paused ? translate('permissions.resume.action') : translate('permissions.pause.action')),
        h('button', {
          className: 'dsh-ws-perm-revoke-all',
          disabled: revokingAll || grants.length === 0,
          onClick: () => setConfirmRevokeAll(true),
          type: 'button',
        }, revokingAll ? translate('permissions.revoking') : translate('permissions.revokeAll'))),
      h('p', {
        className: 'dsh-ws-perm-cache',
        'data-empty': grants.length === 0 && !saveFailed || undefined,
        'data-error': saveFailed || undefined,
      },
      h('span', { 'aria-hidden': true }, saveFailed ? '⚠' : grants.length === 0 ? '·' : '✓'),
      h('span', null, saveFailed
        ? translate('permissions.cache.failed', { message: snapshot.saveError })
        : grants.length === 0 ? translate('permissions.cache.empty') : translate('permissions.cache.saved'))),
      h('p', { className: 'dsh-ws-perm-lifetime', title: snapshot.cachePath }, translate('permissions.lifetime'))),

    h('div', { className: 'dsh-ws-perm-body' },
      pending.length > 0
        ? h('div', { className: 'dsh-ws-perm-pending' },
          h('div', { className: 'dsh-ws-perm-pending-top' },
            h('span', { 'aria-hidden': true, className: 'dsh-ws-perm-pending-dot' }),
            h('span', null, translate('permissions.pending', { n: String(pending.length) })),
            h('button', { className: 'dsh-ws-perm-pending-action', onClick: focusPrompt, type: 'button' }, translate('permissions.pending.handle'))),
          h('div', { className: 'dsh-ws-perm-pending-command' }, `${pending[0].tool} · ${pending[0].command}`))
        : null,
      grants.length === 0
        ? h('div', { className: 'dsh-ws-perm-empty' },
          h('span', { className: 'dsh-ws-perm-empty-icon' }, h(IconShield, { size: 22 })),
          h('strong', null, translate('permissions.empty.title')),
          h('p', null, translate('permissions.empty.hint')),
          h('p', { className: 'dsh-ws-perm-empty-life' }, translate('permissions.lifetime')))
        : h(Fragment, null,
          folderGrants.length > 0
            ? h('div', { className: 'dsh-ws-perm-group' },
              h('div', { className: 'dsh-ws-perm-group-head' }, translate('permissions.group.folders'), h('span', null, String(folderGrants.length))),
              folderGrants.map(grant => h(GrantRow, { busy: busyPath === grant.path, grant, key: `folder:${grant.path}`, onRevoke: revoke })))
            : null,
          fileGrants.length > 0
            ? h('div', { className: 'dsh-ws-perm-group' },
              h('div', { className: 'dsh-ws-perm-group-head' }, translate('permissions.group.files'), h('span', null, String(fileGrants.length))),
              fileGrants.map(grant => h(GrantRow, { busy: busyPath === grant.path, grant, key: `file:${grant.path}`, onRevoke: revoke })))
            : null),
      historySection,
      h('p', { className: 'dsh-ws-perm-not-sandbox' }, translate('permissions.notSandbox')),
      notice === undefined
        ? null
        : h('div', { className: 'dsh-ws-perm-notice', 'data-error': notice.error === true || undefined, role: 'status' }, notice.text)),

    confirmRevokeAll
      ? h(Modal, {
        actions: [
          { key: 'cancel', label: translate('dialog.cancel'), onClick: () => setConfirmRevokeAll(false) },
          { key: 'revoke', label: translate('permissions.revokeAll'), danger: true, onClick: () => { void revokeAll() } },
        ],
        onCancel: () => setConfirmRevokeAll(false),
        title: translate('permissions.revokeAll.confirm'),
      }, h('p', { className: 'dsh-ws-dialog-message' }, translate('permissions.revokeAll.message')))
      : null,

    confirmPause
      ? h(Modal, {
        actions: [
          { key: 'cancel', label: translate('dialog.cancel'), onClick: () => setConfirmPause(false) },
          { key: 'pause', label: translate('permissions.pause.action'), onClick: () => { void pause() } },
        ],
        onCancel: () => setConfirmPause(false),
        title: translate('permissions.pause.confirm'),
      },
      h('p', { className: 'dsh-ws-dialog-message' }, translate('permissions.pause.message', { scope: scopeLabel })),
      pending.length > 0
        ? h('p', { className: 'dsh-ws-dialog-message' }, translate('permissions.pause.pending', { n: String(pending.length) }))
        : null)
      : null)
}

function PromptTarget({ busy, copiedPath, onCopyPath, onToggleWiden, target, widened }) {
  const operations = Array.isArray(target.operations) ? target.operations : []
  /* Deleting / renaming a folder itself is never covered by a grant ON that folder; the prompt must
     record the parent instead. The row always shows the ACCESSED path; the grant boundary is a
     separate line so the user never has to infer which path is remembered. */
  const parentNeeded = target.kind === 'folder' && target.uncertain !== true
    && (operations.includes('delete') || operations.includes('move'))
  const widenedFile = target.kind === 'file' && widened === true
  const grantPath = parentNeeded || widenedFile ? parentPathOf(target.path) : target.path
  const grantDiffers = !samePathClient(grantPath, target.path)
  const { name, parent } = splitPath(target.path)
  const folder = target.kind === 'folder'
  const opTone = promptRiskOp(target)
  const copied = copiedPath === target.path
  return h('div', {
    className: 'dsh-ws-pp-path',
    'data-op': opTone,
    'data-source': target.source === 'ai' ? 'ai' : target.source === 'fallback' ? 'fallback' : 'static',
  },
  h('span', { className: 'dsh-ws-pp-path-icon' }, folder ? h(IconFolder, { size: 12 }) : h(IconFile, { size: 12 })),
  h('div', { className: 'dsh-ws-pp-path-main' },
    h('div', { className: 'dsh-ws-pp-path-line' },
      h('p', { className: 'dsh-ws-pp-path-text', title: target.path },
        parent === '' ? null : h('span', { className: 'dsh-ws-pp-dir' }, parent),
        h('span', { className: 'dsh-ws-pp-leaf' }, name)),
      h('button', {
        'aria-label': translate(copied ? 'permission.prompt.analysis.copiedPath' : 'permission.prompt.analysis.copyPath'),
        className: 'dsh-ws-pp-copy',
        'data-copied': copied || undefined,
        onClick: () => onCopyPath(target.path),
        title: translate(copied ? 'permission.prompt.analysis.copiedPath' : 'permission.prompt.analysis.copyPath'),
        type: 'button',
      }, h(IconCopy))),
    h('div', { className: 'dsh-ws-pp-path-meta' },
      ...operations.map(op => h('span', {
        className: 'dsh-ws-pp-op',
        'data-tone': operationTone(op),
        key: op,
      }, translate(operationKey(op)))),
      h('span', { className: 'dsh-ws-pp-kind' }, translate(folder ? 'permission.prompt.analysis.kind.folder' : 'permission.prompt.analysis.kind.file')),
      h('span', { className: 'dsh-ws-pp-source', 'data-tone': target.source === 'ai' ? 'ai' : target.source === 'fallback' ? 'warn' : 'static' }, translate(promptSourceKey(target))),
      typeof target.script === 'string' && target.script !== ''
        ? h('span', { className: 'dsh-ws-pp-script' }, target.script)
        : null,
      target.kind === 'file'
        ? h('button', {
          className: 'dsh-ws-pp-widen',
          disabled: busy === true || isRootPath(parentPathOf(target.path)),
          onClick: () => onToggleWiden(target.path),
          title: translate(widened ? 'permission.prompt.file' : 'permission.prompt.widen'),
          type: 'button',
        }, translate(widened ? 'permission.prompt.file' : 'permission.prompt.widen'))
        : null),
    grantDiffers
      ? h('div', { className: 'dsh-ws-pp-grant' },
        h(IconShield, { size: 9 }),
        h('span', null,
          translate('permission.prompt.analysis.grant', { path: grantPath }),
          parentNeeded ? translate('permission.prompt.analysis.grantSelf') : ''))
      : null))
}

export function PermissionPrompt() {
  const pending = usePendingPermissions()
  const request = pending.requests[0]
  const [widen, setWiden] = useState({})
  const [remember, setRemember] = useState(true)
  const [localError, setLocalError] = useState(undefined)
  const [copied, setCopied] = useState(false)
  const [copiedPath, setCopiedPath] = useState(null)
  const [now, setNow] = useState(Date.now())
  const busy = usePermissionRequestBusy(request?.id)

  useEffect(() => {
    setWiden({})
    setRemember(true)
    setLocalError(undefined)
    setCopied(false)
    setCopiedPath(null)
    setNow(Date.now())
  }, [request?.id])

  useEffect(() => {
    if (request === undefined || request === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [request?.id])

  useEffect(() => {
    if (copiedPath === null) return undefined
    const timer = setTimeout(() => setCopiedPath(null), 1200)
    return () => clearTimeout(timer)
  }, [copiedPath])

  /* All hooks must run on every render: the prompt mounts and unmounts as requests arrive, so an
     early return BEFORE useMemo changes the hook count between renders (React error #310). */
  const targets = Array.isArray(request?.targets) ? request.targets : []
  /* Present the dangerous rows first (the Host's grant list is order-independent). */
  const displayTargets = useMemo(
    () => [...targets].sort((left, right) => promptRiskRank(left) - promptRiskRank(right)),
    [targets],
  )

  if (request === undefined || request === null) return null
  const grants = displayTargets.map(target => {
    const operations = Array.isArray(target.operations) ? target.operations : []
    const parentNeeded = target.kind === 'folder' && target.uncertain !== true
      && (operations.includes('delete') || operations.includes('move'))
    if (parentNeeded || (target.kind === 'file' && widen[target.path] === true)) {
      return { path: parentPathOf(target.path), kind: 'folder' }
    }
    return { path: target.path, kind: target.kind === 'folder' ? 'folder' : 'file' }
  })
  /* A folder grant on a filesystem root / the user's home is refused by the Host. That can happen
     when a command deletes a folder directly under such a root: the parent is the only valid grant
     shape, and it is too broad to remember. Allow-once remains available. */
  const rememberBlocked = grants.some(grant => grant.kind === 'folder'
    && (isRootPath(grant.path) || (typeof request.home === 'string' && request.home !== '' && samePathClient(grant.path, request.home))))
  const remaining = Math.max(0, Math.ceil(((Number(request.expiresAt) || 0) - now) / 1000))
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  const totalMs = Math.max(1, (Number(request.expiresAt) || 0) - (Number(request.createdAt) || 0))
  const progress = Math.max(0, Math.min(100, ((Number(request.expiresAt) || 0) - now) / totalMs * 100))
  const queued = Math.max(0, pending.requests.length - 1)
  const scope = request.scope
  const scopeKind = scope?.kind === 'mindmap' ? 'permissions.scope.mindmap' : 'permissions.scope.session'
  const scopeTitle = typeof scope?.title === 'string' && scope.title !== '' ? scope.title : ''
  const analysis = request.analysis !== null && typeof request.analysis === 'object' && !Array.isArray(request.analysis)
    ? request.analysis
    : {}
  const analysisKind = analysis.kind === 'ai' || analysis.kind === 'fallback'
    ? analysis.kind
    : (request.opaque === true ? 'fallback' : 'static')
  const model = typeof analysis.model === 'string' && analysis.model !== ''
    ? analysis.model
    : (typeof request.model === 'string' && request.model !== '' ? request.model : null)
  /* A fallback without a model means AI was not involved at all: do not label it as an AI card. */
  const aiInvolved = analysisKind === 'ai' || request.ai === true || model !== null
  const confidence = analysis.confidence === 'high' || analysis.confidence === 'medium' || analysis.confidence === 'low'
    ? analysis.confidence
    : 'low'
  const cached = analysis.cached === true
  const scriptCount = Number.isSafeInteger(analysis.scriptCount) && analysis.scriptCount > 0 ? analysis.scriptCount : 0
  const elapsedMs = Number.isFinite(analysis.elapsedMs) && analysis.elapsedMs > 0 ? Number(analysis.elapsedMs) : 0
  /* The Host may hand over either the script names (current) or its older "命令 + names" prose
     (a Host that was started before the last bundle); normalize both so the localized prefix is
     never doubled. Static analysis always shows the command-only basis. */
  const basisSource = typeof analysis.basis === 'string' ? analysis.basis.trim() : ''
  const basisScripts = analysisKind === 'static'
    ? ''
    : basisSource.replace(/^(?:命令|command)\s*\+\s*/iu, '')
  const basis = basisScripts === ''
    ? translate('permission.prompt.analysis.basisCommand')
    : `${translate('permission.prompt.analysis.basisCommand')} + ${basisScripts}`
  const aiPathCount = displayTargets.filter(target => target.source === 'ai').length
  const counts = { delete: 0, create: 0, modify: 0, move: 0 }
  for (const target of displayTargets) {
    for (const operation of Array.isArray(target.operations) ? target.operations : []) {
      if (counts[operation] !== undefined) counts[operation] += 1
    }
  }
  const detailParts = []
  if (counts.delete > 0) detailParts.push(`${translate('permission.operation.delete')} ${counts.delete}`)
  if (counts.create > 0) detailParts.push(`${translate('permission.operation.create')} ${counts.create}`)
  if (counts.modify > 0) detailParts.push(`${translate('permission.operation.modify')} ${counts.modify}`)
  if (counts.move > 0) detailParts.push(`${translate('permission.operation.move')} ${counts.move}`)
  const staticBrief = detailParts.length > 0
    ? translate('permission.prompt.analysis.staticBrief', {
      n: String(targets.length),
      detail: detailParts.join(translate('permission.prompt.analysis.detailSeparator')),
    })
    : translate('permission.prompt.analysis.staticBriefEmpty', { n: String(targets.length) })
  const suppliedBrief = typeof analysis.brief === 'string' ? analysis.brief.trim() : ''
  const analysisText = analysisKind === 'static'
    ? staticBrief
    : (suppliedBrief !== ''
      ? suppliedBrief
      : (analysisKind === 'ai'
        ? translate('permission.prompt.analysis.aiBrief', { n: String(targets.length) })
        : (aiInvolved
          ? translate('permission.prompt.analysis.aiFallbackBrief')
          : translate('permission.prompt.analysis.fallbackBrief'))))
  const analysisTitleKey = analysisKind === 'static'
    ? 'permission.prompt.analysis.static'
    : (analysisKind === 'ai' ? 'permission.prompt.analysis.ai'
      : (aiInvolved ? 'permission.prompt.analysis.ai' : 'permission.prompt.analysis.fallback'))
  const analysisIcon = analysisKind === 'static'
    ? h(IconChart)
    : (analysisKind === 'fallback' ? h(IconWarning) : h(IconSpark))
  const summaryChips = [
    counts.delete > 0 ? h('span', { className: 'dsh-ws-pp-sum', 'data-tone': 'del', key: 'delete' }, `${translate('permission.operation.delete')} ${counts.delete}`) : null,
    counts.create > 0 ? h('span', { className: 'dsh-ws-pp-sum', 'data-tone': 'create', key: 'create' }, `${translate('permission.operation.create')} ${counts.create}`) : null,
    counts.modify > 0 ? h('span', { className: 'dsh-ws-pp-sum', 'data-tone': 'modify', key: 'modify' }, `${translate('permission.operation.modify')} ${counts.modify}`) : null,
    counts.move > 0 ? h('span', { className: 'dsh-ws-pp-sum', 'data-tone': 'modify', key: 'move' }, `${translate('permission.operation.move')} ${counts.move}`) : null,
  ].filter(Boolean)
  const analysisChips = []
  if (!aiInvolved) {
    analysisChips.push(h('span', { className: 'dsh-ws-pp-chip', key: 'no-ai' }, translate('permission.prompt.analysis.noAi')))
    analysisChips.push(h('span', { className: 'dsh-ws-pp-chip', key: 'scripts' }, translate('permission.prompt.analysis.scripts', { n: String(scriptCount) })))
  } else {
    if (model !== null) analysisChips.push(h('span', { className: 'dsh-ws-pp-chip', 'data-tone': 'brand', key: 'model' }, model))
    analysisChips.push(h('span', {
      className: 'dsh-ws-pp-chip',
      'data-tone': confidence === 'high' ? 'ok' : confidence === 'low' ? 'warn' : undefined,
      key: 'confidence',
    }, translate(`permission.prompt.analysis.confidence.${confidence}`)))
    analysisChips.push(h('span', { className: 'dsh-ws-pp-chip', key: 'cache' }, translate(cached ? 'permission.prompt.analysis.cached' : 'permission.prompt.analysis.uncached')))
    if (scriptCount > 0) analysisChips.push(h('span', { className: 'dsh-ws-pp-chip', key: 'scripts' }, translate('permission.prompt.analysis.scripts', { n: String(scriptCount) })))
  }
  const analysisMeta = [
    h('span', { key: 'basis' }, translate('permission.prompt.analysis.basis', { basis })),
    elapsedMs > 0 ? h('span', { className: 'dsh-ws-pp-meta-sep', key: 'elapsed-sep' }, '·') : null,
    elapsedMs > 0 ? h('span', { key: 'elapsed' }, translate('permission.prompt.analysis.elapsed', { seconds: (elapsedMs / 1000).toFixed(1) })) : null,
    aiPathCount > 0 ? h('span', { className: 'dsh-ws-pp-meta-sep', key: 'ai-sep' }, '·') : null,
    aiPathCount > 0 ? h('span', { key: 'ai-paths' }, translate('permission.prompt.analysis.aiPaths', { n: String(aiPathCount) })) : null,
    h('span', { className: 'dsh-ws-pp-meta-sep', key: 'advisory-sep' }, '·'),
    aiInvolved
      ? h('span', { className: 'dsh-ws-pp-advisory', key: 'advisory' }, translate('permission.prompt.analysis.advisory'))
      : h('span', { className: 'dsh-ws-pp-advisory', key: 'static-note' }, translate('permission.prompt.analysis.staticNote')),
  ].filter(Boolean)
  const toggleWiden = (path) => setWiden(current => ({ ...current, [path]: current[path] !== true }))
  const decide = async (outcome) => {
    setLocalError(undefined)
    const result = await decidePermissionRequest(request.id, outcome, outcome === 'allow-remember' ? grants : undefined)
    if (result === null) {
      setLocalError(pending.error !== null && pending.error !== undefined && pending.error !== ''
        ? pending.error
        : translate('permission.prompt.error', { message: '' }))
    }
  }
  const copy = async () => {
    await copyText(request.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const copyPath = (path) => {
    void copyText(path)
    setCopiedPath(path)
  }

  const foot = h('div', { className: 'dsh-ws-perm-prompt-foot dsh-ws-pp-actions' },
    h('button', { className: 'dsh-ws-perm-prompt-btn dsh-ws-perm-prompt-deny', disabled: busy === true, onClick: () => { void decide('deny') }, type: 'button' }, translate('permission.prompt.deny')),
    h('span', { className: 'dsh-ws-perm-prompt-spacer' }),
    queued > 0 ? h('span', { className: 'dsh-ws-perm-prompt-queue' }, translate('permission.prompt.queue', { n: String(queued) })) : null,
    h('button', { className: 'dsh-ws-perm-prompt-btn', disabled: busy === true, onClick: () => { void decide('allow-once') }, type: 'button' }, translate('permission.prompt.allowOnce')),
    h('button', { className: 'dsh-ws-perm-prompt-btn dsh-ws-perm-prompt-primary', disabled: busy === true || remember !== true || rememberBlocked, onClick: () => { void decide('allow-remember') }, type: 'button' }, busy === true ? translate('permission.prompt.submitting') : translate('permission.prompt.allowRemember')))

  return h(Modal, {
    busy,
    bodyClassName: 'dsh-ws-pp-body',
    className: 'dsh-ws-perm-prompt dsh-ws-pp-prompt',
    closable: false,
    dismissOnBackdrop: false,
    foot,
    onCancel: () => {},
    title: h('span', { className: 'dsh-ws-pp-title' }, h(IconShield, { size: 15 }), translate(request.opaque ? 'permission.prompt.titleOpaque' : 'permission.prompt.title')),
  },
  h('div', { className: 'dsh-ws-pp-subline' },
    h('span', { className: 'dsh-ws-pp-tool' }, request.tool),
    h('span', { className: 'dsh-ws-pp-sep', 'aria-hidden': true }),
    h('span', { className: 'dsh-ws-pp-scope' }, h(IconFolder, { size: 9 }), translate(scopeKind)),
    scopeTitle === '' ? null : h('span', { className: 'dsh-ws-pp-scope-title', title: scopeTitle }, scopeTitle),
    h('span', { className: 'dsh-ws-pp-countdown' }, h(IconClock), translate('permission.prompt.countdown', { time: countdown }))),
  h('div', { className: 'dsh-ws-pp-progress', 'aria-hidden': true }, h('i', { style: { width: `${progress}%` } })),
  h('div', { className: 'dsh-ws-pp-command' },
    h('div', { className: 'dsh-ws-pp-command-top' },
      h('span', { className: 'dsh-ws-pp-command-label' }, translate('permission.prompt.analysis.command')),
      h('span', { className: 'dsh-ws-pp-tool-chip' }, request.tool),
      scriptCount > 0 ? h('span', { className: 'dsh-ws-pp-tool-chip' }, translate('permission.prompt.analysis.scripts', { n: String(scriptCount) })) : null,
      h('button', { className: 'dsh-ws-pp-command-copy', onClick: () => { void copy() }, title: translate('permission.prompt.copy'), type: 'button' },
        h(IconCopy),
        translate(copied ? 'permission.prompt.copied' : 'permission.prompt.copy'))),
    h('pre', { className: 'dsh-ws-pp-command-code' }, request.command),
    h('div', { className: 'dsh-ws-pp-command-cwd' },
      h(IconFolder, { size: 10 }),
      h('span', null, translate('permission.prompt.cwd')),
      h('code', { title: request.cwd }, request.cwd))),
  h('div', { className: 'dsh-ws-pp-brief', 'data-kind': analysisKind },
    h('div', { className: 'dsh-ws-pp-brief-top' },
      h('span', { className: 'dsh-ws-pp-brief-icon' }, analysisIcon),
      h('span', { className: 'dsh-ws-pp-brief-title' }, translate(analysisTitleKey)),
      h('span', { className: 'dsh-ws-pp-spacer' }),
      ...analysisChips),
    h('p', { className: 'dsh-ws-pp-brief-text' }, analysisText),
    h('div', { className: 'dsh-ws-pp-brief-meta' }, ...analysisMeta)),
  h('div', { className: 'dsh-ws-pp-paths-head' },
    h('div', { className: 'dsh-ws-pp-paths-heading' },
      h('span', { className: 'dsh-ws-pp-paths-title' }, translate('permission.prompt.analysis.paths', { n: String(displayTargets.length) })),
      h('span', { className: 'dsh-ws-pp-paths-risk' }, translate('permission.prompt.analysis.risk'))),
    h('div', { className: 'dsh-ws-pp-summary' }, ...summaryChips)),
  h('div', { className: 'dsh-ws-pp-paths' },
    displayTargets.map(target => h(PromptTarget, {
      busy,
      copiedPath,
      key: `${target.path}:${target.kind}`,
      onCopyPath: copyPath,
      onToggleWiden: toggleWiden,
      target,
      widened: widen[target.path] === true,
    }))),
  request.opaque === true
    ? h('p', { className: 'dsh-ws-pp-warning' }, h(IconWarning), h('span', null, translate('permission.prompt.analysis.opaqueNote')))
    : null,
  h('label', { className: 'dsh-ws-perm-prompt-remember dsh-ws-pp-remember' },
    h('input', { checked: remember, onChange: event => setRemember(event.target.checked), type: 'checkbox' }),
    h('span', null, translate('permission.prompt.remember', { scope: translate(scope?.kind === 'mindmap' ? 'permissions.scope.mindmap' : 'permissions.scope.session') })),
    h('span', { className: 'dsh-ws-pp-remember-count' }, translate('permission.prompt.analysis.rememberCount', { n: String(targets.length) }))),
  h('p', { className: 'dsh-ws-perm-prompt-note' }, translate('permission.prompt.allOrNothing')),
  rememberBlocked ? h('p', { className: 'dsh-ws-perm-prompt-note', 'data-warn': true }, translate('permission.prompt.rememberRootDisabled')) : null,
  localError === undefined ? null : h('p', { className: 'dsh-ws-perm-prompt-error', role: 'alert' }, translate('permission.prompt.error', { message: localError })))
}

