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
  refreshPermissionSnapshot,
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

function splitPath(value) {
  const text = String(value ?? '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  if (index < 0) return { name: text, parent: '' }
  return { name: text.slice(index + 1) || text, parent: text.slice(0, index + 1) }
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

function outcomeKey(outcome) {
  if (outcome === 'allowed') return 'permissions.history.allowed'
  if (outcome === 'allowed-once') return 'permissions.history.allowedOnce'
  if (outcome === 'expired') return 'permissions.history.expired'
  if (outcome === 'blocked') return 'permissions.history.blocked'
  return 'permissions.history.denied'
}

function outcomeTone(outcome) {
  if (outcome === 'allowed' || outcome === 'allowed-once') return 'ok'
  if (outcome === 'expired' || outcome === 'blocked') return 'warn'
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
  const { name, parent } = splitPath(grant.path)
  const folder = grant.kind === 'folder'
  return h('div', { className: 'dsh-ws-perm-grant' },
    h('div', { className: 'dsh-ws-perm-grant-main' },
      h('span', { className: 'dsh-ws-perm-grant-icon', 'data-kind': folder ? 'folder' : 'file' }, folder ? h(IconFolder) : h(IconFile)),
      h('span', { className: 'dsh-ws-perm-grant-name' },
        h('strong', { title: grant.path }, name),
        h('span', { title: grant.path }, parent)),
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
  const snapshot = state.value
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

  const scope = snapshot.scope
  const scopeTitle = scopeTitleOf(scope, sessionTitle)
  const saveFailed = typeof snapshot.saveError === 'string' && snapshot.saveError !== ''
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
        h('span', { className: 'dsh-ws-perm-scope', title: `${scopeKindLabel(scope)} · ${scopeTitle}` }, `${scopeKindLabel(scope)} · ${scopeTitle}`),
        h('button', {
          'aria-label': translate('permissions.refresh'),
          className: 'dsh-ws-perm-icon-button',
          onClick: refresh,
          title: translate('permissions.refresh'),
          type: 'button',
        }, h(IconRefresh))),
      h('p', { className: 'dsh-ws-perm-desc' }, translate('permissions.desc')),
      snapshot.enabled === false ? h('p', { className: 'dsh-ws-perm-paused' }, translate('permissions.paused')) : null,
      h('div', { className: 'dsh-ws-perm-summary' },
        h('span', null, translate('permissions.summary', { folders: String(folderGrants.length), files: String(fileGrants.length) })),
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
      : null)
}

function PromptTarget({ busy, onToggleWiden, target, widened }) {
  const operations = Array.isArray(target.operations) ? target.operations : []
  /* Deleting / renaming a folder itself is never covered by a grant ON that folder; the prompt must
     record the parent instead. Show the parent as the effective grant. */
  const parentNeeded = target.kind === 'folder' && target.uncertain !== true
    && (operations.includes('delete') || operations.includes('move'))
  const displayPath = parentNeeded || widened ? parentPathOf(target.path) : target.path
  const { name, parent } = splitPath(displayPath)
  const folder = target.kind === 'folder' || widened || parentNeeded
  const source = analysisLabel(target)
  return h('div', { className: 'dsh-ws-perm-target' },
    h('span', { className: 'dsh-ws-perm-target-icon', 'data-kind': folder ? 'folder' : 'file' }, folder ? h(IconFolder) : h(IconFile)),
    h('div', { className: 'dsh-ws-perm-target-main' },
      h('div', { className: 'dsh-ws-perm-target-name' },
        h('strong', { title: displayPath }, name),
        h('span', { className: 'dsh-ws-perm-source', 'data-tone': target.source === 'ai' ? 'ai' : target.source === 'fallback' ? 'warn' : 'static' }, source)),
      h('span', { className: 'dsh-ws-perm-target-path', title: displayPath }, parent),
      h('div', { className: 'dsh-ws-perm-target-ops' },
        ...operations.map(op => h('span', { className: 'dsh-ws-perm-op', 'data-tone': operationTone(op), key: op }, translate(operationKey(op)))),
        typeof target.script === 'string' && target.script !== ''
          ? h('span', { className: 'dsh-ws-perm-target-script' }, translate('permission.prompt.scriptSource', { script: target.script }))
          : null)),
    parentNeeded
      ? h('span', { className: 'dsh-ws-perm-target-fixed', title: translate('permission.prompt.parentFolder.title') }, translate('permission.prompt.parentFolder'))
      : folder
        ? h('span', { className: 'dsh-ws-perm-target-fixed' }, translate('permission.prompt.folder'))
        : h('button', {
          className: 'dsh-ws-perm-target-toggle',
          disabled: busy === true || isRootPath(parentPathOf(target.path)),
          onClick: () => onToggleWiden(target.path),
          type: 'button',
        }, translate(widened ? 'permission.prompt.file' : 'permission.prompt.widen')))
}

export function PermissionPrompt() {
  const pending = usePendingPermissions()
  const request = pending.requests[0]
  const [widen, setWiden] = useState({})
  const [remember, setRemember] = useState(true)
  const [localError, setLocalError] = useState(undefined)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())
  const busy = usePermissionRequestBusy(request?.id)

  useEffect(() => {
    setWiden({})
    setRemember(true)
    setLocalError(undefined)
    setCopied(false)
    setNow(Date.now())
  }, [request?.id])

  useEffect(() => {
    if (request === undefined || request === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [request?.id])

  if (request === undefined || request === null) return null

  const targets = Array.isArray(request.targets) ? request.targets : []
  const grants = targets.map(target => {
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
  const queued = Math.max(0, pending.requests.length - 1)
  const scope = request.scope
  const scopeText = `${translate('permission.prompt.scope')}：${translate(scope?.kind === 'mindmap' ? 'permissions.scope.mindmapHint' : 'permissions.scope.sessionHint')}`
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

  const foot = h('div', { className: 'dsh-ws-perm-prompt-foot' },
    h('button', { className: 'dsh-ws-perm-prompt-btn dsh-ws-perm-prompt-deny', disabled: busy === true, onClick: () => { void decide('deny') }, type: 'button' }, translate('permission.prompt.deny')),
    h('span', { className: 'dsh-ws-perm-prompt-spacer' }),
    queued > 0 ? h('span', { className: 'dsh-ws-perm-prompt-queue' }, translate('permission.prompt.queue', { n: String(queued) })) : null,
    h('button', { className: 'dsh-ws-perm-prompt-btn', disabled: busy === true, onClick: () => { void decide('allow-once') }, type: 'button' }, translate('permission.prompt.allowOnce')),
    h('button', { className: 'dsh-ws-perm-prompt-btn dsh-ws-perm-prompt-primary', disabled: busy === true || remember !== true || rememberBlocked, onClick: () => { void decide('allow-remember') }, type: 'button' }, busy === true ? translate('permission.prompt.submitting') : translate('permission.prompt.allowRemember')))

  return h(Modal, {
    busy,
    className: 'dsh-ws-perm-prompt',
    closable: false,
    dismissOnBackdrop: false,
    foot,
    onCancel: () => {},
    title: h('span', { className: 'dsh-ws-perm-prompt-title' }, h(IconShield, { size: 15 }), translate(request.opaque ? 'permission.prompt.titleOpaque' : 'permission.prompt.title')),
  },
  h('div', { className: 'dsh-ws-perm-prompt-body' },
    h('div', { className: 'dsh-ws-perm-command' },
      h('span', { className: 'dsh-ws-perm-command-tool' }, request.tool),
      h('code', { title: request.command }, request.command),
      h('button', { className: 'dsh-ws-perm-command-copy', onClick: () => { void copy() }, type: 'button' }, translate(copied ? 'permission.prompt.copied' : 'permission.prompt.copy'))),
    h('div', { className: 'dsh-ws-perm-prompt-meta' },
      h('span', null, `${translate('permission.prompt.cwd')}：${request.cwd}`),
      h('span', null, scopeText),
      h('span', { className: 'dsh-ws-perm-prompt-countdown' }, translate('permission.prompt.countdown', { time: countdown }))),
    h('div', { className: 'dsh-ws-perm-prompt-targets-label' }, translate('permission.prompt.targets')),
    h('div', { className: 'dsh-ws-perm-prompt-targets' },
      targets.map(target => h(PromptTarget, {
        busy,
        key: `${target.path}:${target.kind}`,
        onToggleWiden: toggleWiden,
        target,
        widened: widen[target.path] === true,
      }))),
    request.opaque === true
      ? h('div', { className: 'dsh-ws-perm-prompt-warning' }, h('span', { 'aria-hidden': true }, '⚠'), h('span', null, translate('permission.prompt.opaque')))
      : null,
    h('label', { className: 'dsh-ws-perm-prompt-remember' },
      h('input', { checked: remember, onChange: event => setRemember(event.target.checked), type: 'checkbox' }),
      h('span', null, translate('permission.prompt.remember', { scope: translate(scope?.kind === 'mindmap' ? 'permissions.scope.mindmap' : 'permissions.scope.session') }))),
    h('p', { className: 'dsh-ws-perm-prompt-note' }, translate('permission.prompt.allOrNothing')),
    rememberBlocked ? h('p', { className: 'dsh-ws-perm-prompt-note', 'data-warn': true }, translate('permission.prompt.rememberRootDisabled')) : null,
    localError === undefined ? null : h('p', { className: 'dsh-ws-perm-prompt-error', role: 'alert' }, translate('permission.prompt.error', { message: localError }))))
}
