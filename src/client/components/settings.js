import { createElement as h, Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AUTO_EXPAND_THINK_DEFAULT, AUTO_SYNC_MODE_AUTO, AUTO_SYNC_MODE_WATCH_ONLY, clampMountBulge, clampSpinSpeed, CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN, MINDMAP_END_COLOR_DEFAULT, MINDMAP_HEAD_COLOR_DEFAULT, MINDMAP_HOVER_COLOR_FALLBACK, MINDMAP_HOVER_THEME_VAR, MINDMAP_MOUNT_BULGE_DEFAULT_X, MINDMAP_MOUNT_BULGE_MAX_X, MINDMAP_MOUNT_BULGE_MIN_X, MINDMAP_SELECTED_COLOR_FALLBACK, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SPIN_SPEED_DEFAULT_X, MINDMAP_SPIN_SPEED_MAX_X, MINDMAP_SPIN_SPEED_MIN_X, MINDMAP_SUMMARY_DEFAULT_LENGTH, MINDMAP_SUMMARY_LENGTH_STEP, MINDMAP_SUMMARY_MAX_LENGTH, MINDMAP_SUMMARY_MIN_LENGTH, MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH, MINDMAP_SUMMARY_SESSION_LENGTH_STEP, MINDMAP_SUMMARY_SESSION_MAX_LENGTH, MINDMAP_SUMMARY_SESSION_MIN_LENGTH, mindmapEffectiveColor, PREVIEW_RIGHT_DEFAULT, ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, SEARCH_MATCH_EXPAND_DEFAULT, THINK_COLLAPSE_DELAY_DEFAULT_S, THINK_COLLAPSE_DELAY_MAX_S, THINK_COLLAPSE_DELAY_MIN_S, THINK_COLLAPSE_DELAY_STEP_S, WATCH_FILES_DEFAULT } from '../constants.js'
import { translate } from '../locale/index.js'
import { clamp, FILE_COLOR_GROUPS, fileColorGroupLabel, fileColorOf, HIGHLIGHT_PRESETS, highlightPresetLabel, highlightPresetOf } from '../format.js'
import { checkUpdate, downloadUpdate, fetchMindmapModels } from '../api.js'
import { PanelHeader } from './menus.js'

export function EmptyWorkspaceExplorer({ treePortalTarget, sessionTitle }) {
  const treeSection = h('section', { className: 'dsh-ws-tree' }, h(PanelHeader, { title: sessionTitle ?? translate('panel.workspaceFiles'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseSession')))
  return h(Fragment, null,
    treePortalTarget ? createPortal(treeSection, treePortalTarget) : null,
    h('section', { className: 'dsh-ws-preview' }, h(PanelHeader, { title: translate('panel.filePreview'), subtitle: translate('panel.noWorkspace') }), h('div', { className: 'dsh-ws-empty' }, translate('panel.chooseWorkspaceToBrowse'))))
}/* Configured models for the AI-summary picker AND the effective summary
   config: shared by the settings panel and the map view (the 60 s module
   cache makes the second consumer free). Degraded to an empty list on
   failure so neither consumer ever blocks. */
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
/* Plugin self-update group — the FIRST group of the workspace settings
   section. Checking is an EXPLICIT user action (the README contract: no
   automatic checks — an auto-check on every settings open would re-download
   the main-branch tarball whenever the Host's check cache is cold); the
   version signal is the main-branch package.json (the repo publishes no
   tags/releases). Walks the check → download → install → restart state
   machine. The "restart dsh" outcome is a PERSISTENT inline notice (not a
   transient toast) so it cannot be missed; a `file` install additionally
   notes that only the profile copy was replaced. Returns null when the
   feature is disabled by host config. */
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
        })
        return
      }
      setPhase('up-to-date', { current: payload.current })
    } catch (error) {
      /* A TIMEOUT is a real failure, not a cancellation (the AbortError name
         is shared by both — distinguish by reason, the same rule as the
         save/search paths): silently returning here would leave the phase
         stuck on 'checking' with no retry button. No user signal is passed
         to checkUpdate, so a plain AbortError without a TimeoutError reason
         can only be an environment quirk — surface it too rather than hang. */
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
      await downloadUpdate(state.latest)
      setPhase('done', { latest: state.latest, installMode: state.installMode, pending: false })
    } catch (error) {
      /* Same timeout rule as runCheck: a timed-out download must land on the
         error state (with its retry button), not hang on 'downloading'. */
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
          h('button', { className: 'dsh-ws-text-button', onClick: () => void runDownload(), type: 'button' }, translate('settings.update.download')))
      case 'downloading':
        return h('span', { className: 'dsh-ws-settings-value' }, translate('settings.update.downloading'))
      case 'done':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-update-state', 'data-ok': true }, translate(state.pending === true ? 'settings.update.done.pending' : 'settings.update.done', { latest: state.latest })),
          state.installMode === 'file' ? h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.update.fileInstallNote')) : null)
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
  /* Render-side normalization for the summary-length sliders: the store
     clamps on write, but a legacy/out-of-range persisted value (e.g. 47)
     would otherwise show off-grid while the slider thumb sits between
     ticks — snap to the configured step (4) exactly like the store action. */
  const stepAligned = (value, min, max, step) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return min
    const bounded = Math.min(max, Math.max(min, number))
    return min + Math.round((bounded - min) / step) * step
  }
  const mindmapSummaryLengthValue = stepAligned(
    settings.mindmapSummaryLength ?? MINDMAP_SUMMARY_DEFAULT_LENGTH,
    MINDMAP_SUMMARY_MIN_LENGTH,
    MINDMAP_SUMMARY_MAX_LENGTH,
    MINDMAP_SUMMARY_LENGTH_STEP,
  )
  const mindmapSummarySessionLengthValue = stepAligned(
    settings.mindmapSummarySessionLength ?? MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH,
    MINDMAP_SUMMARY_SESSION_MIN_LENGTH,
    MINDMAP_SUMMARY_SESSION_MAX_LENGTH,
    MINDMAP_SUMMARY_SESSION_LENGTH_STEP,
  )
  /* Render-side normalization of the think-collapse delay: the store clamps on
     write, but a legacy/out-of-range persisted value would otherwise show
     "50.0s" next to a slider visually pinned at 10 (and keep the reset button
     enabled). Same min/max + 0.1 rounding as setThinkCollapseDelay. */
  const thinkCollapseDelayValue = (() => {
    const seconds = Number(settings.thinkCollapseDelay ?? THINK_COLLAPSE_DELAY_DEFAULT_S)
    const bounded = Number.isFinite(seconds)
      ? Math.min(THINK_COLLAPSE_DELAY_MAX_S, Math.max(THINK_COLLAPSE_DELAY_MIN_S, seconds))
      : THINK_COLLAPSE_DELAY_DEFAULT_S
    return Math.round(bounded * 10) / 10
  })()
  const rowHeight = clamp(settings.rowHeight ?? ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX)
  const conflictFontSize = clamp(settings.conflictFontSize ?? CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MIN, CONFLICT_FONT_SIZE_MAX)
  const mindmapSpinSpeed = clampSpinSpeed(settings.mindmapSpinSpeed)
  /* Effective mind-map highlight colors: user hex or theme default resolved to a concrete hex
     (color input), plus whether customized (drives each reset button's disabled state). */
  const mindmapHoverColorHex = mindmapEffectiveColor(settings.mindmapHoverColor, MINDMAP_HOVER_THEME_VAR, MINDMAP_HOVER_COLOR_FALLBACK)
  const mindmapSelectedColorHex = mindmapEffectiveColor(settings.mindmapSelectedColor, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SELECTED_COLOR_FALLBACK)
  /* "Customized" = the user stored a non-default hex (the store deletes the entry when the
     picked color equals the theme default). Comparing the stored value against the EFFECTIVE
     hex was always true, which left both reset buttons permanently disabled. */
  const mindmapHoverColorCustom = settings.mindmapHoverColor !== undefined
  const mindmapSelectedColorCustom = settings.mindmapSelectedColor !== undefined
  /* Session-head accent: default is the fixed violet (not theme adaptive), so the effective
     hex is the stored override or the default constant. */
  const mindmapHeadColorHex = settings.mindmapHeadColor ?? MINDMAP_HEAD_COLOR_DEFAULT
  const mindmapHeadColorCustom = settings.mindmapHeadColor !== undefined
  /* End-of-branch accent: default is the fixed success green (not theme adaptive), so the
     effective hex is the stored override or the default constant. */
  const mindmapEndColorHex = settings.mindmapEndColor ?? MINDMAP_END_COLOR_DEFAULT
  const mindmapEndColorCustom = settings.mindmapEndColor !== undefined
  const mindmapMountBulge = clampMountBulge(settings.mindmapMountBulge)
  const customizedCount = Object.keys(settings.fileColors ?? {}).length
  const customizedPresetCount = Object.keys(settings.highlightPresets ?? {}).length
  return h('div', { className: 'dsh-ws-explorer-settings' },
    h(UpdateSettingsGroup, null),
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
          /* 恢复默认 here ONLY turns the feature off: the chosen model and the
             length stay as they are, so re-enabling is a single click. */
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
              /* Always selectable: the choice is remembered even while the
                 feature is off, so re-enabling needs no re-picking. */
              id: 'dsh-ws-mindmap-summary-model',
              onChange: e => {
                const raw = e.target.value
                if (raw === 'session') settingsStore.actions.setMindmapSummaryModel(undefined)
                else {
                  const hit = summaryModelList.find(m => `${m.provider}/${m.model}` === raw)
                  if (hit !== undefined) settingsStore.actions.setMindmapSummaryModel({ provider: hit.provider, model: hit.model })
                }
              },
              /* A stored route that is no longer in the catalog falls back to
                 "follow session model" visually (the stored value stays so a
                 re-appearing model is picked up again). */
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
    ),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.dialog')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-auto-expand-think' }, translate('settings.autoExpandThink')),
        h('input', {
          'aria-label': translate('settings.autoExpandThink'),
          checked: (settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) === true,
          className: 'dsh-ws-settings-checkbox',
          id: 'dsh-ws-auto-expand-think',
          onChange: e => settingsStore.actions.setAutoExpandThink(e.target.checked),
          type: 'checkbox',
        })),
      h('div', { className: 'dsh-ws-settings-row' },
        h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-think-collapse-delay' }, translate('settings.thinkDelay')),
        h('input', {
          'aria-label': translate('settings.thinkDelay'),
          className: 'dsh-ws-settings-slider',
          disabled: (settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) !== true || undefined,
          id: 'dsh-ws-think-collapse-delay',
          max: THINK_COLLAPSE_DELAY_MAX_S,
          min: THINK_COLLAPSE_DELAY_MIN_S,
          onChange: e => settingsStore.actions.setThinkCollapseDelay(Number(e.target.value)),
          step: THINK_COLLAPSE_DELAY_STEP_S,
          type: 'range',
          value: thinkCollapseDelayValue,
        }),
        h('span', { className: 'dsh-ws-settings-value' }, `${thinkCollapseDelayValue.toFixed(1)}s`),
        h('button', {
          className: 'dsh-ws-text-button',
          disabled: ((settings.autoExpandThink ?? AUTO_EXPAND_THINK_DEFAULT) !== true || thinkCollapseDelayValue === THINK_COLLAPSE_DELAY_DEFAULT_S) || undefined,
          onClick: () => settingsStore.actions.setThinkCollapseDelay(THINK_COLLAPSE_DELAY_DEFAULT_S),
          title: translate('settings.thinkDelay.reset.title'),
          type: 'button',
        }, translate('settings.resetDefault'))),
    ),
    h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.hint')),
  )
}
/* Session-switcher dropdown: rendered in the conversation header's action row (order -400,
   leftmost) as the visible session title (the harness's current-title crumb is hidden by CSS).
   The trigger opens a portalled panel listing every session (most recently updated first, the
   current one highlighted, rows showing title + workspace name as suffix); clicking a row
   switches session via the same ctx.sessions.open the sidebar uses. The panel is portalled to
   document.body and fixed-positioned from the trigger rect so the chat column can't clip it. */