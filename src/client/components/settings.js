import { createElement as h, Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AUTO_SYNC_MODE_AUTO, AUTO_SYNC_MODE_WATCH_ONLY, CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN, DIFF_RULER_WIDTH_DEFAULT, DIFF_RULER_WIDTH_MAX, DIFF_RULER_WIDTH_MIN, EDIT_LINES_DEFAULT, EDIT_LINES_MAX, EDIT_LINES_MIN, EDIT_LINES_STEP, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, MINDMAP_END_COLOR_DEFAULT, MINDMAP_HEAD_COLOR_DEFAULT, MINDMAP_HOVER_COLOR_FALLBACK, MINDMAP_HOVER_THEME_VAR, MINDMAP_MOUNT_BULGE_DEFAULT_X, MINDMAP_MOUNT_BULGE_MAX_X, MINDMAP_MOUNT_BULGE_MIN_X, MINDMAP_SELECTED_COLOR_FALLBACK, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SPIN_SPEED_DEFAULT_X, MINDMAP_SPIN_SPEED_MAX_X, MINDMAP_SPIN_SPEED_MIN_X, MINDMAP_SUMMARY_DEFAULT_LENGTH, MINDMAP_SUMMARY_LENGTH_STEP, MINDMAP_SUMMARY_MAX_LENGTH, MINDMAP_SUMMARY_MIN_LENGTH, MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH, MINDMAP_SUMMARY_SESSION_LENGTH_STEP, MINDMAP_SUMMARY_SESSION_MAX_LENGTH, MINDMAP_SUMMARY_SESSION_MIN_LENGTH, mindmapEffectiveColor, PREVIEW_RIGHT_DEFAULT, ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, RUN_FILE_OVERRIDE_MAX, SEARCH_MATCH_EXPAND_DEFAULT, THINK_LINES_DEFAULT, THINK_LINES_MAX, THINK_LINES_MIN, THINK_LINES_STEP, WATCH_FILES_DEFAULT } from '../constants.js'
import { translate } from '../locale/index.js'
import { clearPreviewFontOverrides } from '../preview-font.js'
import { DIFF_TONE_GROUPS, diffColorOf, diffGroupLabel, FILE_COLOR_GROUPS, fileColorGroupLabel, fileColorOf, HIGHLIGHT_PRESETS, highlightPresetLabel, highlightPresetOf, VCS_STATUS_GROUPS, vcsStatusColorOf, vcsStatusGroupLabel } from '../format.js'
import { pathBasename, runInterpreterSourceLabel } from '../run-detect.js'
import { clearAllFileInterpreters, clearFileInterpreter, focusRunConfig, probeInterpreter, refreshRunConfig, resetAllInterpreters, runConfigFileOverrides, runConfigRowOf, saveExtensionInterpreter, useRunConfig } from '../run-config.js'
import { checkUpdate, downloadUpdate, fetchMindmapModels } from '../api.js'
import { readVcsHostEnabled, subscribeVcsHostEnabled } from '../vcs.js'
import { InterpreterDialog } from './interpreter-dialog.js'
import { PanelHeader } from './menus.js'
import { TokenStatsGroup } from './token-stats.js'

export function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle }) {
  const treeSection = h('section', { className: 'dsh-ws-tree' }, h(PanelHeader, { title: sessionTitle ?? translate('panel.workspaceFiles'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseSession')))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-ws-preview' }, h(PanelHeader, { title: translate('panel.filePreview'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseWorkspaceToBrowse'))))
}/* Configured models for the AI-summary picker, shared by the settings panel and map view; degrades to an empty list on failure. */
export function useMindmapSummaryModels() {
  const [summaryModels, setSummaryModels] = useState(null) // null = loading; { available, models } after
  useEffect(() => {
    let cancelled = false
    fetchMindmapModels()
      .then((payload) => { if (!cancelled) setSummaryModels(payload) })
      .catch(() => { if (!cancelled) setSummaryModels({ available: false, models: [] }) })
    return () => { cancelled = true }
  }, [])
  return summaryModels
}
/* Plugin self-update group: checking is an explicit user action (no auto-checks), walking the check → download → install → restart state machine; returns null when disabled by host config. */
function UpdateSettingsGroup() {
  const [state, setState] = useState({ phase: 'idle' })
  const mountedRef = useRef(false)
  const setPhase = useCallback((phase, extra) => {
    if (mountedRef.current) setState({ phase, ...(extra ?? {}) })
  }, [])
  const runCheck = useCallback(async (force) => {
    setPhase('checking')
    try {
      const payload = await checkUpdate(undefined, force === true)
      if (payload.enabled === false) {
        setPhase('disabled')
        return
      }
      if (payload.restartPending === true) {
        setPhase('done', { latest: payload.latest, pending: true })
        return
      }
      if (payload.updateAvailable === true) {
        setPhase('available', {
          current: payload.current,
          latest: payload.latest,
          installMode: payload.installMode,
          /* Host-computed: false when the swap target is not a copy inside a profile (link: / built-in installs), in which case the download button is replaced by an explanation. */
          updateSupported: payload.updateSupported !== false,
        })
        return
      }
      setPhase('up-to-date', { current: payload.current })
    } catch (error) {
      /* A timeout is a real failure, not a cancellation (AbortError is shared by both — distinguish by reason); surface it rather than hang on 'checking'. */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      setPhase('error', { message: error instanceof Error ? error.message : String(error) })
    }
  }, [setPhase])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const runDownload = useCallback(async () => {
    if (state.phase !== 'available') return
    setPhase('downloading')
    try {
      const result = await downloadUpdate(state.latest)
      /* The install recomputes the mode on the Host; prefer its answer so the note matches what was actually replaced. */
      setPhase('done', { latest: state.latest, installMode: result?.installMode ?? state.installMode, pending: false })
    } catch (error) {
      /* Same timeout rule as runCheck: a timed-out download must land on the error state, not hang on 'downloading'. */
      if (error?.name === 'AbortError' && error?.reason?.name !== 'TimeoutError') return
      setPhase('error', { message: error instanceof Error ? error.message : String(error) })
    }
  }, [setPhase, state.installMode, state.latest, state.phase])
  if (state.phase === 'disabled') return null
  const statusArea = () => {
    switch (state.phase) {
      case 'idle':
        return h('button', { className: 'dsh-ws-text-button', onClick: () => void runCheck(false), type: 'button' }, translate('settings.update.check'))
      case 'checking':
        return h('span', { className: 'dsh-ws-settings-value' }, translate('settings.update.checking'))
      case 'up-to-date':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-update-state', 'data-ok': true }, translate('settings.update.upToDate', { current: state.current })),
          h('button', { className: 'dsh-ws-text-button', onClick: () => void runCheck(true), type: 'button' }, translate('settings.update.recheck')))
      case 'available':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-update-state', 'data-new': true }, translate('settings.update.available', { latest: state.latest, current: state.current })),
          state.updateSupported === false
            ? h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.update.otherInstallNote'))
            : h('button', { className: 'dsh-ws-text-button', onClick: () => void runDownload(), type: 'button' }, translate('settings.update.download')))
      case 'downloading':
        return h('span', { className: 'dsh-ws-settings-value' }, translate('settings.update.downloading'))
      case 'done':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-update-state', 'data-ok': true }, translate(state.pending === true ? 'settings.update.done.pending' : 'settings.update.done', { latest: state.latest })),
          state.installMode === 'file'
            ? h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.update.fileInstallNote'))
            : state.installMode === 'git'
              ? h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.update.gitInstallNote'))
              : null)
      case 'error':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-update-state', 'data-error': true }, state.message),
          h('button', { className: 'dsh-ws-text-button', onClick: () => void runCheck(true), type: 'button' }, translate('settings.update.retry')))
      default:
        return null
    }
  }
  return h(Fragment, null,
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.update')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('span', { className: 'dsh-ws-settings-label' }, translate('settings.update.check')),
        statusArea()),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.update.hint'))),
    h('div', { className: 'dsh-ws-explorer-divider' }),
  )
}
export function ExplorerSettingsSection({ settingsStore }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const summaryModels = useMindmapSummaryModels()
  const summaryModelsAvailable = summaryModels !== null && summaryModels?.available === true
    && Array.isArray(summaryModels?.models) && summaryModels.models.length > 0
  const summaryModelList = summaryModelsAvailable ? summaryModels.models : []
  /* Every slider reads its value straight from the settings store: persisted-state.js'
     schema owns the range and the step, so the widget never needs a second clamp. */
  const mindmapSummaryLengthValue = settings.mindmapSummaryLength
  const mindmapSummarySessionLengthValue = settings.mindmapSummarySessionLength
  const thinkLinesValue = settings.thinkLines
  const editLinesValue = settings.editLines
  const rowHeight = settings.rowHeight
  const diffRulerWidth = settings.diffRulerWidth
  const conflictFontSize = settings.conflictFontSize
  /* Preview text size (percent): the BASE size a tab without its own value follows. */
  const previewFontScale = settings.previewFontScale
  const mindmapSpinSpeed = settings.mindmapSpinSpeed
  /* Effective mind-map highlight colors: user hex or theme default resolved to a concrete hex (color input), plus whether customized (drives each reset button's disabled state). */
  const mindmapHoverColorHex = mindmapEffectiveColor(settings.mindmapHoverColor, MINDMAP_HOVER_THEME_VAR, MINDMAP_HOVER_COLOR_FALLBACK)
  const mindmapSelectedColorHex = mindmapEffectiveColor(settings.mindmapSelectedColor, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SELECTED_COLOR_FALLBACK)
  /* "Customized" means the user stored a non-default hex; comparing against the effective hex was always true and left the reset buttons disabled. */
  const mindmapHoverColorCustom = settings.mindmapHoverColor !== undefined
  const mindmapSelectedColorCustom = settings.mindmapSelectedColor !== undefined
  /* Session-head accent: default is the fixed violet (not theme adaptive), so the effective hex is the stored override or the default constant. */
  const mindmapHeadColorHex = settings.mindmapHeadColor ?? MINDMAP_HEAD_COLOR_DEFAULT
  const mindmapHeadColorCustom = settings.mindmapHeadColor !== undefined
  /* End-of-branch accent: default is the fixed success green (not theme adaptive), so the effective hex is the stored override or the default constant. */
  const mindmapEndColorHex = settings.mindmapEndColor ?? MINDMAP_END_COLOR_DEFAULT
  const mindmapEndColorCustom = settings.mindmapEndColor !== undefined
  const mindmapMountBulge = settings.mindmapMountBulge
  const customizedCount = Object.keys(settings.fileColors).length
  const customizedPresetCount = Object.keys(settings.highlightPresets).length
  const customizedVcsColorCount = Object.keys(settings.vcsColors).length
  const customizedDiffColorCount = Object.keys(settings.diffColors).length
  /* The Host can disable the whole feature (`enableVcsStatus:false`); the explorer mirrors that
     answer here so the group explains itself instead of showing switches that do nothing. */
  const vcsHostEnabled = useSyncExternalStore(subscribeVcsHostEnabled, readVcsHostEnabled) !== false
  /* Interpreter configuration: the global per-suffix map plus the per-file overrides. Loaded once per
     page through run-config's idempotent focus, and every write there refreshes the resolved table —
     so this page shows what each suffix would ACTUALLY use right now, not what was configured once. */
  const runConfig = useRunConfig()
  const [interpreterExt, setInterpreterExt] = useState(null)
  const [probingExt, setProbingExt] = useState(null)
  const [probeResults, setProbeResults] = useState({})
  useEffect(() => { void focusRunConfig() }, [])
  /* A probe result describes one concrete path: drop it when the policy changes underneath. */
  useEffect(() => { setProbeResults({}) }, [runConfig.policy])
  const fileOverrides = runConfigFileOverrides(runConfig)
  const customizedExtensions = Object.keys(runConfig.policy?.extensions ?? {}).length
  const runRowProbe = useCallback(async (row) => {
    const target = typeof row?.interpreter === 'string' ? row.interpreter : ''
    if (target === '' || probingExt !== null) return
    setProbingExt(row.ext)
    const result = await probeInterpreter(target, row.family)
    setProbingExt(null)
    setProbeResults(current => ({
      ...current,
      [row.ext]: {
        ok: result.ok === true,
        text: result.ok === true
          ? (result.output === '' ? translate('run.interp.dlg.testEmpty') : result.output)
          : (result.error !== undefined && result.error !== '' ? result.error : translate('run.interp.dlg.testFail', { output: result.output })),
      },
    }))
  }, [probingExt])
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
    return h('tr', { 'data-stale': row.stale === true || undefined, key: row.ext },
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
                onClick: () => void runRowProbe(row),
                type: 'button',
              }, translate(probingExt === row.ext ? 'settings.interpreters.testing' : 'settings.interpreters.test'))
              : null,
            h('button', {
              className: 'dsh-ws-text-button',
              onClick: () => { setProbeResults({}); setInterpreterExt(row.ext) },
              type: 'button',
            }, translate(stored ? 'settings.interpreters.edit' : 'settings.interpreters.set')),
            stored
              ? h('button', {
                className: 'dsh-ws-text-button',
                disabled: runConfig.writing === true,
                /* 清除 stores an empty value for this one suffix, which sends it back to
                   auto-detection. */
                onClick: () => void saveExtensionInterpreter(row.ext, '', false),
                type: 'button',
              }, translate('settings.interpreters.clear'))
              : null)))
  })
  /* One version-control display switch: a label plus a checkbox, disabled while the feature is off. */
  const vcsToggleRow = (key, id, checked, onChange, disabled) => h('div', { className: 'dsh-ws-settings-row' },
    h('label', { className: 'dsh-ws-settings-label', htmlFor: id }, translate(key)),
    h('input', {
      'aria-label': translate(key),
      checked: checked === true,
      className: 'dsh-ws-settings-checkbox',
      disabled: disabled === true || undefined,
      id,
      onChange: e => onChange(e.target.checked),
      type: 'checkbox',
    }))
  return h('div', { className: 'dsh-ws-explorer-settings' },
    h(UpdateSettingsGroup, null),
    h(TokenStatsGroup, null),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.session')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-spin-speed' }, translate('settings.mindmapSpinSpeed')),
        h('input', {
          'aria-label': translate('settings.mindmapSpinSpeed'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-mindmap-spin-speed',
          max: MINDMAP_SPIN_SPEED_MAX_X,
          min: MINDMAP_SPIN_SPEED_MIN_X,
          onChange: e => settingsStore.actions.setMindmapSpinSpeed(Number(e.target.value)),
          step: 0.1,
          type: 'range',
          value: mindmapSpinSpeed,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${mindmapSpinSpeed.toFixed(1)}×`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: mindmapSpinSpeed === MINDMAP_SPIN_SPEED_DEFAULT_X || undefined,
          onClick: () => settingsStore.actions.setMindmapSpinSpeed(MINDMAP_SPIN_SPEED_DEFAULT_X),
          title: translate('settings.mindmapSpinSpeed.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.mindmap')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-hover-color' }, translate('settings.mindmapHoverColor')),
        h('input', {
          'aria-label': translate('settings.mindmapHoverColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-hover-color',
          onChange: e => settingsStore.actions.setMindmapHoverColor(e.target.value),
          type: 'color',
          value: mindmapHoverColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapHoverColorCustom,
          onClick: () => settingsStore.actions.resetMindmapHoverColor(),
          title: translate('settings.mindmapHoverColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-selected-color' }, translate('settings.mindmapSelectedColor')),
        h('input', {
          'aria-label': translate('settings.mindmapSelectedColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-selected-color',
          onChange: e => settingsStore.actions.setMindmapSelectedColor(e.target.value),
          type: 'color',
          value: mindmapSelectedColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapSelectedColorCustom,
          onClick: () => settingsStore.actions.resetMindmapSelectedColor(),
          title: translate('settings.mindmapSelectedColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-head-color' }, translate('settings.mindmapHeadColor')),
        h('input', {
          'aria-label': translate('settings.mindmapHeadColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-head-color',
          onChange: e => settingsStore.actions.setMindmapHeadColor(e.target.value),
          type: 'color',
          value: mindmapHeadColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapHeadColorCustom,
          onClick: () => settingsStore.actions.resetMindmapHeadColor(),
          title: translate('settings.mindmapHeadColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-end-color' }, translate('settings.mindmapEndColor')),
        h('input', {
          'aria-label': translate('settings.mindmapEndColor'),
          className: 'dsh-ws-settings-color',
          id: 'dsh-ws-mindmap-end-color',
          onChange: e => settingsStore.actions.setMindmapEndColor(e.target.value),
          type: 'color',
          value: mindmapEndColorHex,
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: !mindmapEndColorCustom,
          onClick: () => settingsStore.actions.resetMindmapEndColor(),
          title: translate('settings.mindmapEndColor.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-mount-bulge' }, translate('settings.mindmapMountBulge')),
        h('input', {
          'aria-label': translate('settings.mindmapMountBulge'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-mindmap-mount-bulge',
          max: MINDMAP_MOUNT_BULGE_MAX_X,
          min: MINDMAP_MOUNT_BULGE_MIN_X,
          onChange: e => settingsStore.actions.setMindmapMountBulge(Number(e.target.value)),
          step: 0.5,
          type: 'range',
          value: mindmapMountBulge,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${mindmapMountBulge.toFixed(1)}×`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: mindmapMountBulge === MINDMAP_MOUNT_BULGE_DEFAULT_X || undefined,
          onClick: () => settingsStore.actions.setMindmapMountBulge(MINDMAP_MOUNT_BULGE_DEFAULT_X),
          title: translate('settings.mindmapMountBulge.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-summary-enabled' }, translate('settings.mindmapSummary.enabled')),
        h('input', {
          'aria-label': translate('settings.mindmapSummary.enabled'),
          checked: settings.mindmapSummaryEnabled === true,
          className: 'dsh-ws-settings-checkbox',
          id: 'dsh-ws-mindmap-summary-enabled',
          onChange: e => settingsStore.actions.setMindmapSummaryEnabled(e.target.checked),
          type: 'checkbox',
        }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: settings.mindmapSummaryEnabled !== true || undefined,
          /* Reset here only turns the feature off: the chosen model and length stay, so re-enabling is a single click. */
          onClick: () => settingsStore.actions.setMindmapSummaryEnabled(false),
          title: translate('settings.mindmapSummary.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-summary-model' }, translate('settings.mindmapSummary.model')),
        summaryModels === null
          ? h('span', { className: 'dsh-ws-settings-value' }, translate('settings.loading'))
          : !summaryModelsAvailable
            ? h('span', { className: 'dsh-ws-settings-value' }, translate('settings.mindmapSummary.model.missing'))
            : h('select', {
              'aria-label': translate('settings.mindmapSummary.model'),
              className: 'dsh-ws-settings-select',
              /* Always selectable: the choice is remembered even while the feature is off, so re-enabling needs no re-picking. */
              id: 'dsh-ws-mindmap-summary-model',
              onChange: e => {
                const raw = e.target.value
                if (raw === 'session') settingsStore.actions.setMindmapSummaryModel(undefined)
                else {
                  const hit = summaryModelList.find(m => `${m.provider}/${m.model}` === raw)
                  if (hit !== undefined) settingsStore.actions.setMindmapSummaryModel({ provider: hit.provider, model: hit.model })
                }
              },
              /* A stored route no longer in the catalog falls back to "follow session model" visually (the stored value stays so a re-appearing model is picked up again). */
              value: settings.mindmapSummaryModel !== undefined && settings.mindmapSummaryModel !== null
                && summaryModelList.some(m => m.provider === settings.mindmapSummaryModel.provider && m.model === settings.mindmapSummaryModel.model)
                ? `${settings.mindmapSummaryModel.provider}/${settings.mindmapSummaryModel.model}`
                : 'session',
            },
              h('option', { value: 'session' }, translate('settings.mindmapSummary.model.session')),
              summaryModelList.map(m => h('option', { key: `${m.provider}/${m.model}`, value: `${m.provider}/${m.model}` }, `${m.name} — ${m.provider}`)))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-summary-length' }, translate('settings.mindmapSummary.length')),
        h('input', {
          'aria-label': translate('settings.mindmapSummary.length'),
          className: 'dsh-ws-settings-slider',
          disabled: settings.mindmapSummaryEnabled !== true || undefined,
          id: 'dsh-ws-mindmap-summary-length',
          max: MINDMAP_SUMMARY_MAX_LENGTH,
          min: MINDMAP_SUMMARY_MIN_LENGTH,
          onChange: e => settingsStore.actions.setMindmapSummaryLength(Number(e.target.value)),
          step: MINDMAP_SUMMARY_LENGTH_STEP,
          title: translate('settings.mindmapSummary.length.hint'),
          type: 'range',
          value: mindmapSummaryLengthValue,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, translate('settings.mindmapSummary.length.unit', { n: mindmapSummaryLengthValue })),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: mindmapSummaryLengthValue === MINDMAP_SUMMARY_DEFAULT_LENGTH || undefined,
          onClick: () => settingsStore.actions.setMindmapSummaryLength(MINDMAP_SUMMARY_DEFAULT_LENGTH),
          title: translate('settings.mindmapSummary.length.reset.title', { n: MINDMAP_SUMMARY_DEFAULT_LENGTH }),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-mindmap-summary-session-length' }, translate('settings.mindmapSummary.sessionLength')),
        h('input', {
          'aria-label': translate('settings.mindmapSummary.sessionLength'),
          className: 'dsh-ws-settings-slider',
          disabled: settings.mindmapSummaryEnabled !== true || undefined,
          id: 'dsh-ws-mindmap-summary-session-length',
          max: MINDMAP_SUMMARY_SESSION_MAX_LENGTH,
          min: MINDMAP_SUMMARY_SESSION_MIN_LENGTH,
          onChange: e => settingsStore.actions.setMindmapSummarySessionLength(Number(e.target.value)),
          step: MINDMAP_SUMMARY_SESSION_LENGTH_STEP,
          title: translate('settings.mindmapSummary.sessionLength.hint'),
          type: 'range',
          value: mindmapSummarySessionLengthValue,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, translate('settings.mindmapSummary.length.unit', { n: mindmapSummarySessionLengthValue })),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: mindmapSummarySessionLengthValue === MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH || undefined,
          onClick: () => settingsStore.actions.setMindmapSummarySessionLength(MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH),
          title: translate('settings.mindmapSummary.sessionLength.reset.title', { n: MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH }),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.mindmapSummary.hint')),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.browse')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-row-height' }, translate('settings.rowHeight')),
        h('input', {
          'aria-label': translate('settings.rowHeight'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-row-height',
          max: ROW_HEIGHT_MAX,
          min: ROW_HEIGHT_MIN,
          onChange: e => settingsStore.actions.setRowHeight(Number(e.target.value)),
          step: 2,
          type: 'range',
          value: rowHeight,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${rowHeight}px`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: rowHeight === ROW_HEIGHT_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setRowHeight(ROW_HEIGHT_DEFAULT),
          title: translate('settings.rowHeight.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-search-expand-default' }, translate('settings.searchResult')),
        h('select', {
          'aria-label': translate('settings.searchResult'),
          className: 'dsh-ws-highlight-preset-select',
          id: 'dsh-ws-search-expand-default',
          onChange: e => settingsStore.actions.setExpandSearchMatches(e.target.value === 'expanded'),
          value: (settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT) ? 'expanded' : 'collapsed',
        },
          h('option', { value: 'expanded' }, translate('settings.expanded')),
          h('option', { value: 'collapsed' }, translate('settings.collapsed')))),
      h('div', { className: 'dsh-ws-file-colors-title' }, translate('settings.fileColors')),
      h('div', { className: 'dsh-ws-file-colors' },
        FILE_COLOR_GROUPS.map(({ group }) => { const label = fileColorGroupLabel(group); return h('div', { className: 'dsh-ws-file-color-row', key: group },
          h('span', { className: 'dsh-ws-file-color-name', title: label }, label),
          h('input', {
            'aria-label': translate('settings.fileColor.aria', { label }),
            className: 'dsh-ws-file-color-input',
            onChange: e => settingsStore.actions.setFileColor(group, e.target.value),
            type: 'color',
            value: fileColorOf(settings, group),
          }),
          h('button', {
            className: 'dsh-ws-file-color-reset',
            disabled: settings.fileColors?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetFileColor(group),
            title: translate('settings.fileColor.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetFileColors(),
          type: 'button',
        }, translate('settings.resetAllColors'))),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.vcs')),
      vcsToggleRow('settings.vcs.enabled', 'dsh-ws-vcs-enabled', settings.vcsEnabled !== false, value => settingsStore.actions.setVcsEnabled(value), vcsHostEnabled === false),
      vcsToggleRow('settings.vcs.ignored', 'dsh-ws-vcs-ignored', settings.vcsShowIgnored === true, value => settingsStore.actions.setVcsShowIgnored(value), settings.vcsEnabled === false || vcsHostEnabled === false),
      vcsToggleRow('settings.vcs.hideDirs', 'dsh-ws-vcs-hide-dirs', settings.vcsHideDirs !== false, value => settingsStore.actions.setVcsHideDirs(value), settings.vcsEnabled === false || vcsHostEnabled === false),
      vcsToggleRow('settings.vcs.autoRefresh', 'dsh-ws-vcs-auto-refresh', settings.vcsAutoRefresh !== false, value => settingsStore.actions.setVcsAutoRefresh(value), settings.vcsEnabled === false || vcsHostEnabled === false),
      vcsHostEnabled === false ? h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.vcs.disabledByHost')) : null,
      h('div', { className: 'dsh-ws-file-colors-title' }, translate('settings.vcs.colors')),
      h('div', { className: 'dsh-ws-file-colors' },
        VCS_STATUS_GROUPS.map(({ group }) => { const label = vcsStatusGroupLabel(group); return h('div', { className: 'dsh-ws-file-color-row', key: group },
          h('span', { className: 'dsh-ws-file-color-name', title: label }, label),
          h('input', {
            'aria-label': translate('settings.vcs.color.aria', { label }),
            className: 'dsh-ws-file-color-input',
            onChange: e => settingsStore.actions.setVcsColor(group, e.target.value),
            type: 'color',
            value: vcsStatusColorOf(settings, group),
          }),
          h('button', {
            className: 'dsh-ws-file-color-reset',
            disabled: settings.vcsColors?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetVcsColor(group),
            title: translate('settings.vcs.color.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedVcsColorCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetVcsColors(),
          type: 'button',
        }, translate('settings.resetAllColors'))),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.vcs.hint')),
      /* Editor change marks and the scrollbar change ruler: both compare against the same
         repository baseline as the tree badges above, so they belong to this group. */
      h('div', { className: 'dsh-ws-file-colors-title' }, translate('settings.diffColors')),
      h('div', { className: 'dsh-ws-file-colors' },
        DIFF_TONE_GROUPS.map(({ group }) => { const label = diffGroupLabel(group); return h('div', { className: 'dsh-ws-file-color-row', key: `diff-${group}` },
          h('span', { className: 'dsh-ws-file-color-name', title: label }, label),
          h('input', {
            'aria-label': translate('settings.diffColor.aria', { label }),
            className: 'dsh-ws-file-color-input',
            onChange: e => settingsStore.actions.setDiffColor(group, e.target.value),
            type: 'color',
            value: diffColorOf(settings, group),
          }),
          h('button', {
            className: 'dsh-ws-file-color-reset',
            disabled: settings.diffColors?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetDiffColor(group),
            title: translate('settings.diffColor.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedDiffColorCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetDiffColors(),
          type: 'button',
        }, translate('settings.resetAllColors'))),
      vcsToggleRow('settings.diffLineTint', 'dsh-ws-diff-line-tint', settings.diffLineTint !== false, value => settingsStore.actions.setDiffLineTint(value), settings.vcsEnabled === false || vcsHostEnabled === false),
      /* Scrollbar change ruler: the widened track plus its three geometry choices. Everything is
         display-only, so the sub-rows simply grey out while the feature itself is off. */
      vcsToggleRow('settings.diffRuler', 'dsh-ws-diff-ruler', settings.diffRuler !== false, value => settingsStore.actions.setDiffRuler(value), settings.vcsEnabled === false || vcsHostEnabled === false),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-diff-ruler-width' }, translate('settings.diffRulerWidth')),
        h('input', {
          'aria-label': translate('settings.diffRulerWidth'),
          className: 'dsh-ws-settings-slider',
          disabled: settings.diffRuler === false || undefined,
          id: 'dsh-ws-diff-ruler-width',
          max: DIFF_RULER_WIDTH_MAX,
          min: DIFF_RULER_WIDTH_MIN,
          onChange: e => settingsStore.actions.setDiffRulerWidth(Number(e.target.value)),
          step: 2,
          type: 'range',
          value: diffRulerWidth,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${diffRulerWidth}px`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: diffRulerWidth === DIFF_RULER_WIDTH_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setDiffRulerWidth(DIFF_RULER_WIDTH_DEFAULT),
          title: translate('settings.diffRulerWidth.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      vcsToggleRow('settings.diffRulerSpan', 'dsh-ws-diff-ruler-span', settings.diffRulerSpan === 'full', value => settingsStore.actions.setDiffRulerSpan(value ? 'full' : 'inset'), settings.diffRuler === false || settings.vcsEnabled === false || vcsHostEnabled === false),
      vcsToggleRow('settings.diffRulerThumb', 'dsh-ws-diff-ruler-thumb', settings.diffRulerThumb === 'full', value => settingsStore.actions.setDiffRulerThumb(value ? 'full' : 'slim'), settings.diffRuler === false || settings.vcsEnabled === false || vcsHostEnabled === false),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.diffRuler.hint')),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.diff.hint')),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.content')),
      h('div', { className: 'dsh-ws-file-colors-title' }, translate('settings.presets')),
      h('div', { className: 'dsh-ws-file-colors' },
        FILE_COLOR_GROUPS.map(({ group }) => { const label = fileColorGroupLabel(group); return h('div', { className: 'dsh-ws-file-color-row', key: `preset-${group}` },
          h('span', { className: 'dsh-ws-file-color-name', title: label }, label),
          h('select', {
            'aria-label': translate('settings.preset.aria', { label }),
            className: 'dsh-ws-highlight-preset-select',
            onChange: e => settingsStore.actions.setHighlightPreset(group, e.target.value),
            value: highlightPresetOf(settings, group),
          },
            HIGHLIGHT_PRESETS.map(preset => h('option', { key: preset.id, value: preset.id }, highlightPresetLabel(preset.id)))),
          h('button', {
            className: 'dsh-ws-file-color-reset',
            disabled: settings.highlightPresets?.[group] === undefined || undefined,
            onClick: () => settingsStore.actions.resetHighlightPreset(group),
            title: translate('settings.preset.reset.title', { label }),
            type: 'button',
          }, translate('settings.reset')),
        ) })),
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedPresetCount === 0 || undefined,
          onClick: () => settingsStore.actions.resetHighlightPresets(),
          type: 'button',
        }, translate('settings.resetAllPresets'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-preview-font-scale' }, translate('settings.previewFontScale')),
        h('input', {
          'aria-label': translate('settings.previewFontScale'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-preview-font-scale',
          max: FONT_SCALE_MAX,
          min: FONT_SCALE_MIN,
          onChange: e => settingsStore.actions.setPreviewFontScale(Number(e.target.value)),
          step: FONT_SCALE_STEP,
          type: 'range',
          value: previewFontScale,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, translate('settings.previewFontScale.value', { percent: previewFontScale })),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: previewFontScale === FONT_SCALE_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setPreviewFontScale(FONT_SCALE_DEFAULT),
          title: translate('settings.previewFontScale.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      /* One action row, the same shape as the highlight-preset group above: the button clears every
         open tab's own size so they all follow the base size. It cannot know how many tabs carry
         one (they live in the explorer), so it is always enabled and the explorer's status bar
         reports the outcome. */
      h('div', { className: 'dsh-ws-file-colors-actions' },
        h('button', {
          className: 'dsh-ws-text-button',
          onClick: clearPreviewFontOverrides,
          title: translate('settings.previewFontScale.applyAll.title'),
          type: 'button',
        }, translate('settings.previewFontScale.applyAll'))),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.previewFontScale.hint')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-conflict-font-size' }, translate('settings.conflictFontSize')),
        h('input', {
          'aria-label': translate('settings.conflictFontSize'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-conflict-font-size',
          max: CONFLICT_FONT_SIZE_MAX,
          min: CONFLICT_FONT_SIZE_MIN,
          onChange: e => settingsStore.actions.setConflictFontSize(Number(e.target.value)),
          step: 1,
          type: 'range',
          value: conflictFontSize,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${conflictFontSize}px`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: conflictFontSize === CONFLICT_FONT_SIZE_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setConflictFontSize(CONFLICT_FONT_SIZE_DEFAULT),
          title: translate('settings.conflictFontSize.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-preview-right' }, translate('settings.previewRight')),
        h('input', {
          'aria-label': translate('settings.previewRight'),
          checked: (settings.previewRight ?? PREVIEW_RIGHT_DEFAULT) === true,
          className: 'dsh-ws-settings-checkbox',
          id: 'dsh-ws-preview-right',
          onChange: e => settingsStore.actions.setPreviewRight(e.target.checked),
          type: 'checkbox',
        })),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-watch-files' }, translate('settings.watchFiles')),
        h('input', {
          'aria-label': translate('settings.watchFiles'),
          checked: (settings.watchFiles ?? WATCH_FILES_DEFAULT) === true,
          className: 'dsh-ws-settings-checkbox',
          id: 'dsh-ws-watch-files',
          onChange: e => settingsStore.actions.setWatchFiles(e.target.checked),
          type: 'checkbox',
        })),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-auto-sync-mode' }, translate('settings.watchOnly')),
        h('input', {
          'aria-label': translate('settings.watchOnly'),
          checked: (settings.autoSyncMode ?? AUTO_SYNC_MODE_AUTO) === AUTO_SYNC_MODE_WATCH_ONLY,
          className: 'dsh-ws-settings-checkbox',
          disabled: (settings.watchFiles ?? WATCH_FILES_DEFAULT) !== true || undefined,
          id: 'dsh-ws-auto-sync-mode',
          onChange: e => settingsStore.actions.setAutoSyncMode(e.target.checked ? AUTO_SYNC_MODE_WATCH_ONLY : AUTO_SYNC_MODE_AUTO),
          type: 'checkbox',
        })),
      /* 全局自定义解释器：按后缀给所有工作区指定解释器；运行控制台里为单个文件指定的优先。 */
      h('div', { className: 'dsh-ws-interp-title' },
        translate('settings.interpreters'),
        h('span', { className: 'dsh-ws-interp-spacer' }),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: runConfig.refreshing === true,
          onClick: () => void refreshRunConfig(),
          type: 'button',
        }, translate(runConfig.refreshing === true ? 'settings.loading' : 'settings.interpreters.recheck'))),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.interpreters.hint')),
      runConfig.status === 'error'
        ? h('div', { className: 'dsh-ws-settings-hint', 'data-tone': 'error' }, translate('settings.interpreters.error', { message: runConfig.error ?? '' }))
        : null,
      h('table', { className: 'dsh-ws-interp-table' },
        h('thead', null, h('tr', null,
          h('th', { className: 'dsh-ws-interp-th-ext' }, translate('settings.interpreters.ext')),
          h('th', null, translate('settings.interpreters.effective')),
          h('th', { className: 'dsh-ws-interp-th-actions' }, translate('settings.interpreters.actions')))),
        h('tbody', null, ...interpreterRows())),
      h('div', { className: 'dsh-ws-settings-row' },
        h('span', { className: 'dsh-ws-settings-hint dsh-ws-interp-count' },
          translate('settings.interpreters.count', { count: String(customizedExtensions), max: String(RUN_FILE_OVERRIDE_MAX) })),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: customizedExtensions === 0 || runConfig.writing === true,
          onClick: () => void resetAllInterpreters(),
          type: 'button',
        }, translate('settings.interpreters.resetAll'))),
      h('div', { className: 'dsh-ws-interp-title' }, translate('settings.interpreters.files', { count: String(fileOverrides.length) })),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.interpreters.filesHint', { max: String(RUN_FILE_OVERRIDE_MAX) })),
      fileOverrides.length === 0
        ? h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.interpreters.filesEmpty'))
        : h('div', { className: 'dsh-ws-interp-files' },
          ...fileOverrides.map(item => h('div', { className: 'dsh-ws-interp-file', key: item.key },
            h('span', { className: 'dsh-ws-interp-file-name', title: item.key }, pathBasename(item.key)),
            h('span', { className: 'dsh-ws-interp-file-dir', title: item.key }, item.key),
            h('span', { className: 'dsh-ws-interp-file-path', title: item.interpreter }, item.interpreter),
            h('button', {
              className: 'dsh-ws-text-button',
              disabled: runConfig.writing === true,
              onClick: () => void clearFileInterpreter(item.key),
              type: 'button',
            }, translate('settings.interpreters.clear'))))),
      fileOverrides.length === 0
        ? null
        : h('div', { className: 'dsh-ws-file-colors-actions' },
          h('button', {
            className: 'dsh-ws-text-button',
            disabled: runConfig.writing === true,
            onClick: () => void clearAllFileInterpreters(),
            type: 'button',
          }, translate('settings.interpreters.filesClearAll'))),
      runConfig.notice === undefined
        ? null
        : h('div', { className: 'dsh-ws-settings-hint', 'data-tone': 'error', role: 'alert' }, runConfig.notice.text),
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.dialog')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-think-lines' }, translate('settings.thinkLines')),
        h('input', {
          'aria-label': translate('settings.thinkLines'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-think-lines',
          max: THINK_LINES_MAX,
          min: THINK_LINES_MIN,
          onChange: e => settingsStore.actions.setThinkLines(Number(e.target.value)),
          step: THINK_LINES_STEP,
          type: 'range',
          value: thinkLinesValue,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, translate('settings.thinkLines.value', { n: thinkLinesValue })),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: thinkLinesValue === THINK_LINES_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setThinkLines(THINK_LINES_DEFAULT),
          title: translate('settings.thinkLines.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-edit-lines' }, translate('settings.editLines')),
        h('input', {
          'aria-label': translate('settings.editLines'),
          className: 'dsh-ws-settings-slider',
          id: 'dsh-ws-edit-lines',
          max: EDIT_LINES_MAX,
          min: EDIT_LINES_MIN,
          onChange: e => settingsStore.actions.setEditLines(Number(e.target.value)),
          step: EDIT_LINES_STEP,
          type: 'range',
          value: editLinesValue,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, translate('settings.editLines.value', { n: editLinesValue })),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: editLinesValue === EDIT_LINES_DEFAULT || undefined,
          onClick: () => settingsStore.actions.setEditLines(EDIT_LINES_DEFAULT),
          title: translate('settings.editLines.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.hint')),
    interpreterExt === null
      ? null
      : h(InterpreterDialog, {
        ext: interpreterExt,
        family: runConfigRowOf(runConfig, interpreterExt)?.family ?? '',
        mode: 'extension',
        onClose: () => setInterpreterExt(null),
        platform: runConfig.platform,
        row: runConfigRowOf(runConfig, interpreterExt),
      }),
  )
}