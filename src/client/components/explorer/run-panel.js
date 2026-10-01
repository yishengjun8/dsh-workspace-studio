/* Run console: the preview column's lower half for an executable file.
 *
 * The panel is deliberately thin over two owners: host/run.js owns the process and the output ring
 * buffer, run-store.js owns the rendered tail and the poll cursor. What lives here is presentation
 * and the interactions a console needs — run / stop / rerun / clear / copy / follow-the-tail, the
 * confirm-before-first-run gate, the splitter drag, and the "cannot run" guidance.
 */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { RUN_ARGS_MAX_LENGTH, RUN_CODE_MIN_PX, RUN_PANEL_MIN_PX, RUN_PANEL_RATIO_DEFAULT } from '../../constants.js'
import { translate } from '../../locale/index.js'
import { copyText } from '../../paths.js'
import { formatRunDuration, runBufferText, runChipTone, runInterpreterEditable, runInterpreterLabel, runInterpreterSourceLabel, runInterpreterSourceOf, runStaleOverrideOf, runStateOf } from '../../run-detect.js'
import { clearRunOutput, focusRunPath, loadRunPlan, setRunArgsText, setRunFollow, setRunPanelPx, startRunFor, stopRunFor, trustRunWorkspace, useRunEntry } from '../../run-store.js'
import { InterpreterDialog } from '../interpreter-dialog.js'

const clampPanel = (value, available) => Math.max(RUN_PANEL_MIN_PX, Math.min(value, Math.max(RUN_PANEL_MIN_PX, available - RUN_CODE_MIN_PX)))

/* The chip text of one state. Live states carry the elapsed time, terminal ones the exit code, so a
   glance at the console says both what happened and how long it took. */
function chipText(state, entry) {
  const duration = formatRunDuration(entry?.durationMs)
  if (state === 'stopping') return translate('run.chip.stopping')
  if (state === 'running') return translate('run.chip.running', { duration })
  if (state === 'ok') return translate('run.chip.exitedOk', { duration })
  if (state === 'fail') return translate('run.chip.exitedFail', { code: String(entry?.code ?? '?'), duration })
  if (state === 'killed') return translate('run.chip.killed', { duration })
  if (state === 'error') return translate('run.chip.error')
  if (state === 'nointerpreter') return translate('run.chip.unavailable')
  return translate('run.chip.idle')
}

/* The trailing line that closes a finished run: one line, in the same mono voice as the output. */
function exitLine(state, entry) {
  const duration = formatRunDuration(entry?.durationMs)
  if (state === 'ok') return { key: 'run.line.exitOk', tone: 'sys', params: { duration } }
  if (state === 'fail') return { key: 'run.line.exitFail', tone: 'err', params: { code: String(entry?.code ?? '?'), duration } }
  if (state === 'killed') return { key: 'run.line.killed', tone: 'sys', params: { duration } }
  if (state === 'error') return { key: 'run.line.error', tone: 'err', params: { message: entry?.errorMessage ?? '' } }
  return null
}

function reasonKey(reason) {
  if (reason === 'missing-interpreter') return 'run.reason.missingInterpreter'
  if (reason === 'unsupported-platform') return 'run.reason.platform'
  if (reason === 'not-executable') return 'run.reason.notExecutable'
  return 'run.reason.notRunnable'
}

/* The interpreter button's tooltip: the effective tier plus the full path (which never fits on the
   button itself), the reason it cannot run at all, or which stored setting stopped working. */
function interpreterTitle(source, stale, plan) {
  if (plan === null || plan === undefined) return translate('run.interp.title.pending')
  if (stale !== null) {
    return translate('run.interp.title.stale', { path: stale.path, source: runInterpreterSourceLabel(source, plan?.extension) })
  }
  if (source === 'direct') return translate('run.interp.title.direct')
  if (plan?.reason === 'missing-interpreter') {
    return translate('run.interp.title.missing', { candidates: (plan?.candidates ?? []).join(', ') })
  }
  const path = typeof plan?.interpreter === 'string' && plan.interpreter !== '' ? `（${plan.interpreter}）` : ''
  return translate('run.interp.title.set', { source: runInterpreterSourceLabel(source, plan?.extension), path })
}

export function RunConsole({ workspaceId, path, name }) {
  const entry = useRunEntry(path)
  const [confirming, setConfirming] = useState(false)
  const [noAsk, setNoAsk] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const outputRef = useRef(null)
  const rootRef = useRef(null)

  const state = runStateOf(entry)
  const plan = entry?.plan ?? null
  const running = state === 'running' || state === 'stopping'
  const supported = plan === null || plan.supported !== false
  const canRun = !running && entry?.busy !== true && supported
  const collapsed = entry?.collapsed === true
  const follow = entry?.follow !== false
  const argsText = entry?.argsText ?? ''
  const prefix = typeof plan?.command === 'string' && plan.command !== '' ? plan.command : (entry?.command ?? '')
  const cwdRelative = entry?.cwdRelative ?? plan?.cwdRelative ?? ''
  const lines = entry?.buffer?.lines ?? []
  const pendingOut = entry?.buffer?.pendingStdout ?? ''
  const pendingErr = entry?.buffer?.pendingStderr ?? ''
  const droppedLines = entry?.buffer?.droppedLines ?? 0
  const tail = exitLine(state, entry)
  const failureNotice = entry?.notice ?? (entry?.errorCode === 'stop-failed'
    ? { error: true, text: entry.errorMessage ?? translate('run.stopFailed') }
    : undefined)
  /* Where this file's interpreter comes from, what it is called on the button, and the tier that
     stopped working (if any). The button is the ONLY entry point: 「解释器 py -3（自动）▾」 opens the
     file-scoped dialog, so a fix lands on exactly the file the user is looking at. */
  const interpreterSource = runInterpreterSourceOf(plan)
  const interpreterName = runInterpreterLabel(plan, entry)
  const interpreterEditable = runInterpreterEditable(plan)
  const staleOverride = runStaleOverrideOf(plan)

  /* Load the plan / policy and discover whether a run is already live on the Host. */
  useEffect(() => { void focusRunPath(workspaceId, path) }, [workspaceId, path])

  /* Follow the tail: pinned to the bottom while `follow`, released the moment the user scrolls up. */
  useEffect(() => {
    const node = outputRef.current
    if (node === null || !follow) return
    node.scrollTop = node.scrollHeight
  }, [follow, lines.length, pendingOut, pendingErr, tail?.key, path])

  useEffect(() => {
    if (!confirming) return undefined
    const onKeyDown = event => { if (event.key === 'Escape') setConfirming(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirming])

  /* Splitter drag: the panel height is measured from the bottom of the preview body, so the code
     pane keeps whatever is left (bounded so neither half can be squeezed shut). */
  const handleSplitterDown = useCallback((event) => {
    event.preventDefault()
    const parent = rootRef.current?.parentElement
    if (parent === null || parent === undefined) return
    const rect = parent.getBoundingClientRect()
    const move = (moveEvent) => setRunPanelPx(path, clampPanel(rect.bottom - moveEvent.clientY, rect.height))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [path])

  const handleSplitterKey = useCallback((event) => {
    const parent = rootRef.current?.parentElement
    const available = parent === null || parent === undefined ? 600 : parent.getBoundingClientRect().height
    const current = entry?.panelPx ?? Math.round(available * RUN_PANEL_RATIO_DEFAULT)
    if (event.key === 'ArrowUp') { event.preventDefault(); setRunPanelPx(path, clampPanel(current + 24, available)) } else if (event.key === 'ArrowDown') { event.preventDefault(); setRunPanelPx(path, clampPanel(current - 24, available)) } else if (event.key === 'Enter') { event.preventDefault(); setRunPanelPx(path, null) }
  }, [entry?.panelPx, path])

  const runNow = useCallback((trusted) => {
    if (trusted === true) void trustRunWorkspace(workspaceId, path)
    void startRunFor(workspaceId, path, argsText)
  }, [argsText, path, workspaceId])

  const handleRun = useCallback(() => {
    if (!canRun) return
    /* First run of a file in a workspace the user has not trusted: confirm what will actually run.
       The confirmation is the point of the feature, so it is never skipped silently. */
    if (entry?.trusted !== true) { setNoAsk(false); setConfirming(true); return }
    runNow(false)
  }, [canRun, entry?.trusted, runNow])

  const handleCopy = useCallback(() => {
    const omittedLabel = droppedLines > 0 ? translate('run.linesOmitted', { count: String(droppedLines) }) : undefined
    void copyText(runBufferText(entry?.buffer, omittedLabel))
  }, [droppedLines, entry?.buffer])

  const handleOutputScroll = useCallback((event) => {
    const node = event.currentTarget
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    if (atBottom !== follow) setRunFollow(path, atBottom)
  }, [follow, path])

  const handleArgsKey = useCallback((event) => {
    if (event.key === 'Enter' && event.nativeEvent?.isComposing !== true) {
      event.preventDefault()
      handleRun()
    }
  }, [handleRun])

  /* A collapsed console renders nothing at all: the file header's toggle brings it back. */
  if (collapsed) return null

  const fullCommand = `${prefix}${argsText === '' ? '' : ` ${argsText}`}`
  const family = typeof plan?.kind === 'string' ? plan.kind : ''

  const outputNodes = h('div', { className: 'dsh-ws-run-output-body' },
    ...lines.map((line, index) => h('div', {
      'data-error': line.s === 'stderr' || undefined,
      className: 'dsh-ws-run-line',
      key: `${index}:${line.t.length}`,
    }, line.t === '' ? '\u00a0' : line.t)),
    pendingOut === '' && pendingErr === '' && !running
      ? null
      : h('div', { className: 'dsh-ws-run-line', 'data-error': pendingErr !== '' || undefined, key: 'tail' },
        pendingOut,
        pendingErr === '' ? null : h('span', { className: 'dsh-ws-run-tail-error' }, pendingErr),
        running ? h('span', { 'aria-hidden': true, className: 'dsh-ws-run-cursor' }) : null),
    droppedLines > 0
      ? h('div', { className: 'dsh-ws-run-line dsh-ws-run-omitted', key: 'omitted' }, translate('run.linesOmitted', { count: String(droppedLines) }))
      : null,
    tail === null
      ? null
      : h('div', {
        className: 'dsh-ws-run-line dsh-ws-run-exit',
        'data-error': tail.tone === 'err' || undefined,
        key: 'exit',
      }, translate(tail.key, tail.params)))

  const confirmDialog = confirming
    ? h('div', { className: 'dsh-ws-dialog-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) setConfirming(false) } },
      h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-run-dialog', role: 'dialog' },
        h('div', { className: 'dsh-ws-dialog-header' },
          h('div', { className: 'dsh-ws-dialog-title' }, translate('run.confirm.title', { name })),
          h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', onClick: () => setConfirming(false), title: translate('dialog.close'), type: 'button' }, '×')),
        h('div', { className: 'dsh-ws-dialog-body' },
          h('div', { className: 'dsh-ws-run-field' }, h('i', null, translate('run.confirm.file')), h('div', null, path)),
          h('div', { className: 'dsh-ws-run-field' }, h('i', null, translate('run.confirm.command')), h('div', null, fullCommand)),
          h('div', { className: 'dsh-ws-run-field' }, h('i', null, translate('run.confirm.cwd')), h('div', null, plan?.cwd ?? '—')),
          plan?.interpreter === null || plan?.interpreter === undefined
            ? null
            : h('div', { className: 'dsh-ws-run-field' }, h('i', null, translate('run.confirm.interpreter')),
              /* The confirmation names the SOURCE too: with an override in play, "python -3 main.py"
                 no longer says which python the user is about to trust. */
              h('div', null, interpreterSource === null || interpreterSource === 'auto'
                ? plan.interpreter
                : `${plan.interpreter}（${runInterpreterSourceLabel(interpreterSource, plan.extension)}）`)),
          h('div', { className: 'dsh-ws-run-warning' }, translate('run.confirm.warning')),
          h('label', { className: 'dsh-ws-run-check' },
            h('input', { checked: noAsk, onChange: event => setNoAsk(event.target.checked), type: 'checkbox' }),
            h('span', null, translate('run.confirm.noAsk')))),
        h('div', { className: 'dsh-ws-dialog-footer' },
          h('button', { className: 'dsh-ws-text-button', onClick: () => setConfirming(false), type: 'button' }, translate('dialog.cancel')),
          h('button', { className: 'dsh-ws-text-button dsh-ws-run-confirm-button', onClick: () => { setConfirming(false); runNow(noAsk) }, type: 'button' }, translate('run.confirm.run')))))
    : null

  const pickerDialog = dialogOpen
    ? h(InterpreterDialog, {
      ext: plan?.extension,
      family,
      mode: 'file',
      onClose: () => setDialogOpen(false),
      path,
      plan,
      workspaceId,
    })
    : null

  return h('div', {
    className: 'dsh-ws-run-console',
    ref: rootRef,
    /* Percentage until the user drags (then the exact pixel height they chose). Percentage keeps
       the 38% default meaningful when the preview column is resized. */
    style: { height: entry?.panelPx === null || entry?.panelPx === undefined ? `${Math.round(RUN_PANEL_RATIO_DEFAULT * 100)}%` : `${entry.panelPx}px` },
  },
    h('div', {
      'aria-label': translate('run.resize'),
      'aria-orientation': 'horizontal',
      className: 'dsh-ws-run-splitter',
      onDoubleClick: () => setRunPanelPx(path, null),
      onKeyDown: handleSplitterKey,
      onPointerDown: handleSplitterDown,
      role: 'separator',
      tabIndex: 0,
      title: translate('run.resize.title'),
    }),
    h('section', { className: 'dsh-ws-run-panel', 'data-state': state },
      h('div', { className: 'dsh-ws-run-bar' },
        h('span', { className: 'dsh-ws-run-chip', 'data-tone': runChipTone(state) }, chipText(state, entry)),
        h('div', { className: 'dsh-ws-run-cmd', title: fullCommand },
          prefix === '' ? null : h('span', { className: 'dsh-ws-run-cmd-prefix' }, prefix),
          h('input', {
            'aria-label': translate('run.args'),
            className: 'dsh-ws-run-args',
            maxLength: RUN_ARGS_MAX_LENGTH,
            onChange: event => setRunArgsText(path, event.target.value),
            onKeyDown: handleArgsKey,
            placeholder: translate('run.argsPlaceholder'),
            spellCheck: false,
            type: 'text',
            value: argsText,
          })),
        h('div', { className: 'dsh-ws-run-actions' },
          h('button', {
            className: 'dsh-ws-run-button dsh-ws-run-button-run',
            disabled: !canRun,
            onClick: handleRun,
            title: translate('run.run.title', { name }),
            type: 'button',
          }, translate('run.run')),
          h('button', {
            className: 'dsh-ws-run-button',
            'data-tone': 'danger',
            disabled: state !== 'running' || entry?.busy === true,
            onClick: () => void stopRunFor(path),
            title: translate('run.stop.title'),
            type: 'button',
          }, state === 'stopping' ? translate('run.stopping') : translate('run.stop')),
          h('button', {
            className: 'dsh-ws-run-button',
            disabled: !canRun,
            onClick: handleRun,
            title: translate('run.rerun.title'),
            type: 'button',
          }, translate('run.rerun')),
          h('button', {
            className: 'dsh-ws-run-button',
            disabled: lines.length === 0 && pendingOut === '' && pendingErr === '' && tail === null,
            onClick: () => clearRunOutput(path),
            type: 'button',
          }, translate('run.clear')),
          h('button', { className: 'dsh-ws-run-button', onClick: handleCopy, type: 'button' }, translate('run.copy')),
          h('button', {
            'aria-pressed': follow,
            className: 'dsh-ws-run-button',
            'data-active': follow || undefined,
            onClick: () => setRunFollow(path, !follow),
            title: translate('run.follow.title'),
            type: 'button',
          }, translate('run.follow')))),
      h('div', { className: 'dsh-ws-run-meta' },
        h('span', null, translate('run.meta.cwd', { cwd: cwdRelative === '' ? '.' : cwdRelative })),
        h('span', null, translate('run.meta.stdin')),
        h('span', { className: 'dsh-ws-run-meta-label' }, translate('run.meta.interpreter')),
        h('button', {
          'aria-label': translate('run.interp.aria'),
          className: 'dsh-ws-run-interp',
          'data-source': interpreterSource ?? 'unknown',
          disabled: !interpreterEditable,
          onClick: () => setDialogOpen(true),
          title: interpreterTitle(interpreterSource, staleOverride, plan),
          type: 'button',
        },
        h('span', { className: 'dsh-ws-run-interp-name' }, interpreterName === '' ? translate('run.interp.unknown') : interpreterName),
        interpreterSource === null || interpreterSource === 'auto'
          ? null
          : h('span', { className: 'dsh-ws-run-interp-source' }, runInterpreterSourceLabel(interpreterSource, plan?.extension)),
        h('span', { 'aria-hidden': true, className: 'dsh-ws-run-interp-caret' }, '▾'))),
      /* A stored override that no longer resolves is reported where the user is looking: which tier
         fell through, which path failed, and what is being used instead. Never silent. */
      staleOverride === null
        ? null
        : h('div', { className: 'dsh-ws-run-stale', role: 'status' },
          h('span', { 'aria-hidden': true, className: 'dsh-ws-run-stale-icon' }, '⚠'),
          h('span', null, translate(`run.interp.stale.${staleOverride.scope}`, {
            ext: `.${String(plan?.extension ?? '')}`,
            path: staleOverride.path,
            source: runInterpreterSourceLabel(interpreterSource, plan?.extension),
          }))),
      /* A stop that could not take the process tree down must be visible where the user is looking,
         not only in the Host log — and the Host settles the entry so the console is never stuck on
         「正在停止…」. */
      failureNotice === undefined
        ? null
        : h('div', { className: 'dsh-ws-run-notice', 'data-error': failureNotice.error === true || undefined, role: 'alert' }, failureNotice.text),
      h('div', { className: 'dsh-ws-run-output', onScroll: handleOutputScroll, ref: outputRef, tabIndex: 0 },
        state === 'idle' && lines.length === 0 && tail === null
          ? h('div', { className: 'dsh-ws-run-empty' },
            h('div', null, translate('run.empty.title', { name })),
            prefix === '' ? null : h('div', { className: 'dsh-ws-run-empty-cmd' }, `$ ${fullCommand}`),
            h('div', { className: 'dsh-ws-run-empty-hint' }, translate('run.empty.hint')))
          : null,
        state === 'nointerpreter'
          ? h('div', { className: 'dsh-ws-run-unavailable' },
            h('b', null, translate(reasonKey(plan?.reason))),
            /* The Host sends a structured `hint` rather than prose, so this card reads naturally in
               either language: the Windows-shell case has its own actionable wording (install Git
               for Windows / point at a bash path) instead of a bare candidate list. */
            h('div', null, translate(plan?.hint === 'shell-windows' ? 'run.unavailable.shellWindows' : 'run.unavailable.missing', {
              candidates: (plan?.candidates ?? []).join(', '),
            })),
            plan?.hint === 'shell-windows'
              ? h('div', { className: 'dsh-ws-run-unavailable-tried' }, translate('run.unavailable.tried', { candidates: (plan?.candidates ?? []).join(', ') }))
              : null,
            h('div', { className: 'dsh-ws-run-unavailable-actions' },
              h('button', { className: 'dsh-ws-run-button', onClick: () => void loadRunPlan(workspaceId, path, true), type: 'button' }, translate('run.detect')),
              /* The fix belongs to THIS file (the settings page owns the global per-suffix map). */
              interpreterEditable
                ? h('button', { className: 'dsh-ws-run-button', onClick: () => setDialogOpen(true), type: 'button' }, translate('run.unavailable.pick'))
                : null))
          : null,
        state === 'error'
          ? h('div', { className: 'dsh-ws-run-unavailable', 'data-tone': 'error' },
            h('b', null, translate('run.reason.spawnFailed')),
            h('div', null, entry?.errorMessage ?? ''))
          : null,
        outputNodes),
      confirmDialog,
      pickerDialog))
}
