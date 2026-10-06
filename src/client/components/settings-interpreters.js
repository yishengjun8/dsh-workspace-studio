/* The interpreter card: one row per runnable extension, plus the dialog for editing one.
 *
 * Extracted from settings.js, which keeps the page shell (the row design system is in settings-rows.js).
 */
import { createElement as h, Fragment } from 'react'
import { translate } from '../locale/index.js'
import { RUN_FILE_OVERRIDE_MAX } from '../constants.js'
import { pathBasename, runInterpreterSourceLabel } from '../run-detect.js'
import { clearAllFileInterpreters, clearFileInterpreter, refreshRunConfig, resetAllInterpreters, runConfigFileOverrides, runConfigRowOf, saveExtensionInterpreter } from '../run-config.js'
import { Card, Section } from './settings-rows.js'
import { InterpreterDialog } from './interpreter-dialog.js'
export function InterpreterCard({ runConfig, interpreterExt, setInterpreterExt, probingExt, probeResults, onProbe, onClearProbe }) {
  const fileOverrides = runConfigFileOverrides(runConfig)
  const customizedExtensions = Object.keys(runConfig.policy?.extensions ?? {}).length
  /* One row per runnable extension: what it resolves to, where that came from, and the three actions
     (指定 / 修改 / 清除). Directly executed suffixes have no interpreter by definition, and a suffix
     the current platform cannot run at all is greyed out with the reason spelled out. */
  const interpreterRows = () => (runConfig.rows ?? []).map((row) => {
    const unsupported = row.reason === 'unsupported-platform'
    const direct = row.source === 'direct'
    const missing = row.reason === 'missing-interpreter'
    const stored = typeof row.override === 'string' && row.override !== ''
    const effective = direct
      ? translate('settings.interpreters.direct')
      : missing
        ? translate('settings.interpreters.missing', { candidates: (row.candidates ?? []).join(', ') })
        : (row.interpreterName ?? '')
    const probe = probeResults[row.ext]
    return h('tr', { 'data-label': `.${row.ext} ${effective}`, 'data-stale': row.stale === true || undefined, 'data-unit': '', key: row.ext },
      h('td', { className: 'dsh-ws-interp-ext' }, `.${row.ext}`),
      h('td', null,
        h('div', { className: 'dsh-ws-interp-eff' },
          h('span', { className: 'dsh-ws-interp-eff-name', title: typeof row.interpreter === 'string' ? row.interpreter : '' }, effective),
          direct || unsupported
            ? null
            : h('span', { className: 'dsh-ws-interp-tag', 'data-kind': row.stale === true ? 'stale' : (row.source ?? 'auto') },
              row.stale === true ? translate('settings.interpreters.stale') : runInterpreterSourceLabel(row.source, row.ext)),
          probe === undefined
            ? null
            : h('span', { className: 'dsh-ws-interp-probe', 'data-tone': probe.ok ? 'ok' : 'error', title: probe.text },
              probe.ok ? translate('settings.interpreters.probeOk', { output: probe.text }) : translate('settings.interpreters.probeFail', { output: probe.text })))),
      h('td', { className: 'dsh-ws-interp-actions' },
        unsupported || direct
          ? h('span', { className: 'dsh-ws-interp-note' }, translate(direct ? 'settings.interpreters.directNote' : 'settings.interpreters.unsupportedNote'))
          : h(Fragment, null,
            stored && row.stale !== true
              ? h('button', {
                className: 'dsh-ws-text-button',
                disabled: probingExt !== null,
                onClick: () => void onProbe(row),
                type: 'button',
              }, translate(probingExt === row.ext ? 'settings.interpreters.testing' : 'settings.interpreters.test'))
              : null,
            h('button', {
              className: 'dsh-ws-text-button',
              onClick: () => { onClearProbe(); setInterpreterExt(row.ext) },
              type: 'button',
            }, translate(stored ? 'settings.interpreters.edit' : 'settings.interpreters.set')),
            stored
              ? h('button', {
                className: 'dsh-ws-text-button',
                disabled: runConfig.writing === true,
                /* 清除 stores an empty value for this one suffix, which sends it back to auto-detection. */
                onClick: () => void saveExtensionInterpreter(row.ext, '', false),
                type: 'button',
              }, translate('settings.interpreters.clear'))
              : null)))
  })
  return h(Card, {
    id: 'interp',
    title: translate('settings.interpreters'),
    actions: h('button', {
      className: 'dsh-ws-text-button',
      disabled: runConfig.refreshing === true,
      onClick: () => void refreshRunConfig(),
      type: 'button',
    }, translate(runConfig.refreshing === true ? 'settings.loading' : 'settings.interpreters.recheck')),
    notes: ['settings.notes.interp.1', 'settings.notes.interp.2', { key: 'settings.notes.interp.3', params: { max: String(RUN_FILE_OVERRIDE_MAX) } }],
  },
    runConfig.status === 'error'
      ? h('div', { className: 'dsh-ws-card-banner', 'data-tone': 'error' }, translate('settings.interpreters.error', { message: runConfig.error ?? '' }))
      : null,
    h('table', { className: 'dsh-ws-interp-table' },
      h('thead', null, h('tr', null,
        h('th', { className: 'dsh-ws-interp-th-ext' }, translate('settings.interpreters.ext')),
        h('th', null, translate('settings.interpreters.effective')),
        h('th', { className: 'dsh-ws-interp-th-actions' }, translate('settings.interpreters.actions')))),
      h('tbody', null, ...interpreterRows())),
    h('div', { className: 'dsh-ws-count-line' },
      h('span', { className: 'dsh-ws-count-text' }, translate('settings.interpreters.count', { count: String(customizedExtensions), max: String(RUN_FILE_OVERRIDE_MAX) })),
      h('button', {
        className: 'dsh-ws-text-button',
        disabled: customizedExtensions === 0 || runConfig.writing === true,
        onClick: () => void resetAllInterpreters(),
        type: 'button',
      }, translate('settings.interpreters.resetAll'))),
    h(Section, {
      label: translate('settings.interpreters.files', { count: String(fileOverrides.length) }),
      action: fileOverrides.length === 0
        ? null
        : h('button', {
          className: 'dsh-ws-text-button dsh-ws-text-button-accent',
          disabled: runConfig.writing === true,
          onClick: () => void clearAllFileInterpreters(),
          type: 'button',
        }, translate('settings.interpreters.filesClearAll')),
    },
    fileOverrides.length === 0
      ? h('div', { className: 'dsh-ws-empty-note' }, translate('settings.interpreters.filesEmpty'))
      : h('div', { className: 'dsh-ws-interp-files', 'data-block': '' },
        ...fileOverrides.map(item => h('div', { className: 'dsh-ws-interp-file', 'data-label': `${pathBasename(item.key)} ${item.interpreter}`, 'data-unit': '', key: item.key },
          h('span', { className: 'dsh-ws-interp-file-name', title: item.key }, pathBasename(item.key)),
          h('span', { className: 'dsh-ws-interp-file-dir', title: item.key }, item.key),
          h('span', { className: 'dsh-ws-interp-file-path', title: item.interpreter }, item.interpreter),
          h('button', {
            className: 'dsh-ws-text-button',
            disabled: runConfig.writing === true,
            onClick: () => void clearFileInterpreter(item.key),
            type: 'button',
          }, translate('settings.interpreters.clear')))))),
    runConfig.notice === undefined
      ? null
      : h('div', { className: 'dsh-ws-card-banner', 'data-tone': 'error', role: 'alert' }, runConfig.notice.text),
    interpreterExt === null
      ? null
      : h(InterpreterDialog, {
        ext: interpreterExt,
        family: runConfigRowOf(runConfig, interpreterExt)?.family ?? '',
        mode: 'extension',
        onClose: () => setInterpreterExt(null),
        platform: runConfig.platform,
        row: runConfigRowOf(runConfig, interpreterExt),
      }))
}