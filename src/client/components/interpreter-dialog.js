/* One interpreter dialog, two scopes.
 *
 *   mode="file"      the console's 「解释器」 button: set the interpreter for THIS file only;
 *   mode="extension" the settings page: set the global interpreter for one suffix.
 *
 * Both scopes write the same Host policy file, differ only in which map they touch, and share the
 * whole interaction: show what is effective right now (and where it came from), take an absolute
 * path, offer a one-shot version probe, and keep validation errors inline instead of closing.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'
import { translate } from '../locale/index.js'
import { Modal } from './dialogs.js'
import { pathBasename, runInterpreterLabel, runInterpreterSourceLabel, runInterpreterSourceOf, runSiblingExtensions, runStaleOverrideOf } from '../run-detect.js'
import { RUN_FAMILY_BY_EXTENSION } from '../../shared/run-extensions.js'
import { clearFileInterpreter, probeInterpreter, saveExtensionInterpreter, saveFileInterpreter } from '../run-config.js'
import { reloadRunPath } from '../run-store.js'

/** Whether a typed value could be an absolute path on either platform (instant, local feedback;
 *  the Host re-validates and is the authority). */
function looksAbsolute(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')
}

function extensionOfPath(path) {
  const name = pathBasename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1)
}

function fileView(plan, path) {
  const ext = typeof plan?.extension === 'string' && plan.extension !== '' ? plan.extension : extensionOfPath(path)
  const source = runInterpreterSourceOf(plan)
  const stale = runStaleOverrideOf(plan)
  const family = typeof plan?.kind === 'string' && plan.kind !== 'none' ? plan.kind : (RUN_FAMILY_BY_EXTENSION[ext] ?? '')
  return {
    mode: 'file',
    ext,
    family,
    key: typeof plan?.fileKey === 'string' ? plan.fileKey : '',
    name: pathBasename(path),
    scope: path ?? '',
    source,
    effectivePath: typeof plan?.interpreter === 'string' ? plan.interpreter : '',
    effectiveName: runInterpreterLabel(plan, null),
    candidates: Array.isArray(plan?.candidates) ? plan.candidates : [],
    reason: typeof plan?.reason === 'string' ? plan.reason : null,
    stale,
    /* Prefill the FILE tier's own value: the stale one first (it is what the user must fix), then the
       winning one. An extension/auto source is edited on the settings page, so the box stays empty. */
    initial: stale?.scope === 'file' ? stale.path : (source === 'file' ? (plan?.interpreterRequested ?? plan?.interpreter ?? '') : ''),
    hasOverride: source === 'file' || stale?.scope === 'file',
  }
}

function extensionView(row, ext, family) {
  const source = typeof row?.source === 'string' ? row.source : null
  const staleOverride = row?.stale === true && typeof row?.override === 'string' && row.override !== '' ? row.override : null
  return {
    mode: 'extension',
    ext,
    family,
    key: '',
    name: `.${ext}`,
    scope: '',
    source,
    effectivePath: typeof row?.interpreter === 'string' ? row.interpreter : '',
    effectiveName: typeof row?.interpreterName === 'string' ? row.interpreterName : '',
    candidates: Array.isArray(row?.candidates) ? row.candidates : [],
    reason: typeof row?.reason === 'string' ? row.reason : null,
    /* 'family' can only arrive from a Host running a build that still resolved the retired
       per-family tier; the label mapping is kept for that restart window (see run-detect.js). */
    stale: staleOverride === null ? null : { scope: source === 'family' ? 'family' : 'extension', path: staleOverride },
    initial: typeof row?.override === 'string' && row.override !== '' ? row.override : (source === 'family' ? (row?.interpreter ?? '') : ''),
    hasOverride: typeof row?.override === 'string' && row.override !== '',
  }
}

export function InterpreterDialog({ mode, workspaceId, path, plan, row, ext, family, platform, onClose, onSaved }) {
  const view = mode === 'file'
    ? fileView(plan, path)
    : extensionView(row, String(ext ?? '').toLowerCase(), String(family ?? ''))
  const [value, setValue] = useState(view.initial)
  const [also, setAlso] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const siblings = runSiblingExtensions(view.ext)
  const canProbe = view.family !== '' && view.family !== 'direct' && view.source !== 'direct'

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const effectiveText = () => {
    if (view.reason === 'missing-interpreter') {
      return translate('run.interp.dlg.missing', { candidates: view.candidates.join(', ') })
    }
    if (view.source === 'direct') return translate('run.interp.source.direct')
    const label = runInterpreterSourceLabel(view.source, view.ext)
    return view.effectivePath === '' ? label : `${label} · ${view.effectivePath}`
  }

  const runTest = useCallback(async () => {
    const target = value.trim()
    if (target === '' || testing) return
    setError('')
    setTested(null)
    if (!looksAbsolute(target)) { setError(translate('run.interp.dlg.notAbsolute')); return }
    setTesting(true)
    const result = await probeInterpreter(target, view.family)
    setTesting(false)
    setTested(result)
  }, [testing, value, view.family])

  const save = useCallback(async () => {
    const target = value.trim()
    if (saving) return
    if (target !== '' && !looksAbsolute(target)) { setError(translate('run.interp.dlg.notAbsolute')); return }
    setError('')
    setSaving(true)
    const result = view.mode === 'file'
      ? await saveFileInterpreter(view.key, target, { alsoGlobal: also, ext: view.ext })
      : await saveExtensionInterpreter(view.ext, target, also)
    if (result.ok !== true) {
      setSaving(false)
      setError(result.error !== '' && result.error !== undefined ? result.error : translate('error.invalid-interpreter'))
      return
    }
    /* The console must show the new interpreter without a page refresh (and a run started right
       after must actually use it), so the plan is re-resolved before the dialog closes. */
    if (view.mode === 'file' && workspaceId !== null && workspaceId !== undefined && path !== null && path !== undefined) {
      await reloadRunPath(workspaceId, path)
    }
    setSaving(false)
    onSaved?.()
    onClose?.()
  }, [also, onClose, onSaved, path, saving, value, view.ext, view.family, view.key, view.mode, workspaceId])

  const clear = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError('')
    const result = view.mode === 'file'
      ? await clearFileInterpreter(view.key)
      : await saveExtensionInterpreter(view.ext, '', false)
    if (result.ok !== true) {
      setSaving(false)
      setError(result.error ?? '')
      return
    }
    if (view.mode === 'file' && workspaceId !== null && workspaceId !== undefined && path !== null && path !== undefined) {
      await reloadRunPath(workspaceId, path)
    }
    setSaving(false)
    onSaved?.()
    onClose?.()
  }, [onClose, onSaved, path, saving, view.ext, view.family, view.key, view.mode, workspaceId])

  const title = view.mode === 'file'
    ? translate('run.interp.dlg.titleFile', { name: view.name })
    : translate('run.interp.dlg.titleExtension', { ext: view.name })

  const testLine = tested === null
    ? null
    : tested.ok === true
      ? h('div', { className: 'dsh-ws-interp-line', 'data-tone': 'ok' },
        translate('run.interp.dlg.testOk', {
          output: tested.output === '' ? translate('run.interp.dlg.testEmpty') : tested.output,
          duration: tested.durationMs === null ? '—' : `${tested.durationMs}ms`,
        }))
      : h('div', { className: 'dsh-ws-interp-line', 'data-tone': 'error' },
        tested.error !== undefined && tested.error !== ''
          ? tested.error
          : translate(tested.timedOut === true ? 'run.interp.dlg.testTimeout' : 'run.interp.dlg.testFail', { output: tested.output }))

  const staleLine = view.stale === null || view.stale === undefined
    ? null
    : h('div', { className: 'dsh-ws-interp-line', 'data-tone': 'warn' },
      translate('run.interp.dlg.stale', { path: view.stale.path, source: runInterpreterSourceLabel(view.source, view.ext) }))

  /* Windows shell note: the settings page passes the platform so a `.sh` row explains itself even
     when a Git Bash is already configured — pointing `.sh` at the WSL launcher is the classic
     mistake here. (When NO bash exists at all the console shows its amber card from the Host's
     `plan.hint` instead; see explorer/run-panel.js.) */
  const shellNote = view.family === 'shell' && platform === 'win32' && view.ext !== 'zsh'
    ? h('div', { className: 'dsh-ws-interp-line', 'data-tone': 'warn' }, translate('run.unavailable.shellWindows'))
    : null

  return h(Modal, {
    actions: [
      {
        key: 'clear',
        label: translate(view.mode === 'file' ? 'run.interp.dlg.clearFile' : 'run.interp.dlg.clear'),
        onClick: () => void clear(),
        disabled: saving || view.hasOverride !== true || (view.mode === 'file' && view.key === ''),
      },
      /* The clear action sits on the left, the cancel/save pair on the right. */
      { key: 'spacer', element: h('div', { className: 'dsh-ws-interp-spacer' }) },
      { key: 'cancel', label: translate('dialog.cancel'), onClick: () => onClose?.() },
      {
        key: 'save',
        label: translate(view.mode === 'file' ? 'run.interp.dlg.saveFile' : 'run.interp.dlg.save'),
        onClick: () => void save(),
        disabled: saving || (view.mode === 'file' && view.key === ''),
        className: 'dsh-ws-text-button dsh-ws-run-confirm-button',
      },
    ],
    className: 'dsh-ws-interp-dialog',
    onCancel: () => onClose?.(),
    title,
  },
      h('div', { className: 'dsh-ws-run-field' },
        h('i', null, translate(view.mode === 'file' ? 'run.interp.dlg.file' : 'run.interp.dlg.scope')),
        h('div', null, view.mode === 'file' ? view.scope : translate('run.interp.dlg.scopeValue', { ext: view.name }))),
      h('div', { className: 'dsh-ws-run-field' },
        h('i', null, translate('run.interp.dlg.effective')),
        h('div', null, effectiveText())),
      staleLine,
      h('div', { className: 'dsh-ws-run-field' }, h('i', null, translate('run.interp.dlg.path'))),
      h('div', { className: 'dsh-ws-interp-inputrow' },
        h('input', {
          'aria-label': translate('run.interp.dlg.path'),
          autoFocus: true,
          className: 'dsh-ws-dialog-input',
          'data-invalid': error !== '' || undefined,
          onChange: (event) => { setValue(event.target.value); setTested(null); setError('') },
          onKeyDown: (event) => {
            if (event.key === 'Enter' && event.nativeEvent?.isComposing !== true) { event.preventDefault(); void save() }
          },
          placeholder: translate('run.interp.dlg.placeholder'),
          spellCheck: false,
          type: 'text',
          value,
        }),
        canProbe
          ? h('button', {
            className: 'dsh-ws-interp-test',
            disabled: testing || value.trim() === '',
            onClick: () => void runTest(),
            title: translate('run.interp.dlg.testTitle'),
            type: 'button',
          }, translate(testing ? 'run.interp.dlg.testing' : 'run.interp.dlg.test'))
          : null),
      h('div', { className: 'dsh-ws-interp-hint' }, translate(view.mode === 'file' ? 'run.interp.dlg.hintFile' : 'run.interp.dlg.hintExtension', {
        source: runInterpreterSourceLabel(view.source, view.ext),
      })),
      testLine,
      error === ''
        ? null
        : h('div', { className: 'dsh-ws-interp-line', 'data-tone': 'error', role: 'alert' }, error),
      shellNote,
      siblings.length === 0
        ? null
        : h('label', { className: 'dsh-ws-run-check' },
          h('input', { checked: also, onChange: (event) => setAlso(event.target.checked), type: 'checkbox' }),
          h('span', null, translate(view.mode === 'file' ? 'run.interp.dlg.alsoGlobal' : 'run.interp.dlg.alsoSiblings', {
            ext: view.mode === 'file' ? `.${view.ext}` : siblings.map(item => `.${item}`).join(' / '),
          }))),
      h('div', { className: 'dsh-ws-interp-hint' }, translate(view.mode === 'file' ? 'run.interp.dlg.elsewhere' : 'run.interp.dlg.fileNote')))
}
