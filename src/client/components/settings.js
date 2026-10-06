import { createElement as h, Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Card, ColorCell, ColorRow, PresetCell, Row, Section, SliderRow, Sub, SwitchRow } from './settings-rows.js'
import { InterpreterCard } from './settings-interpreters.js'
import { AUTO_SYNC_MODE_AUTO, AUTO_SYNC_MODE_WATCH_ONLY, CONFLICT_FONT_SIZE_DEFAULT, CONFLICT_FONT_SIZE_MAX, CONFLICT_FONT_SIZE_MIN, DIFF_RULER_WIDTH_DEFAULT, DIFF_RULER_WIDTH_MAX, DIFF_RULER_WIDTH_MIN, EDIT_LINES_DEFAULT, EDIT_LINES_MAX, EDIT_LINES_MIN, EDIT_LINES_STEP, FONT_SCALE_DEFAULT, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, MINDMAP_END_COLOR_DEFAULT, MINDMAP_HEAD_COLOR_DEFAULT, MINDMAP_HOVER_COLOR_FALLBACK, MINDMAP_HOVER_THEME_VAR, MINDMAP_MOUNT_BULGE_DEFAULT_X, MINDMAP_MOUNT_BULGE_MAX_X, MINDMAP_MOUNT_BULGE_MIN_X, MINDMAP_SELECTED_COLOR_FALLBACK, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SPIN_SPEED_DEFAULT_X, MINDMAP_SPIN_SPEED_MAX_X, MINDMAP_SPIN_SPEED_MIN_X, MINDMAP_SUMMARY_DEFAULT_LENGTH, MINDMAP_SUMMARY_LENGTH_STEP, MINDMAP_SUMMARY_MAX_LENGTH, MINDMAP_SUMMARY_MIN_LENGTH, MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH, MINDMAP_SUMMARY_SESSION_LENGTH_STEP, MINDMAP_SUMMARY_SESSION_MAX_LENGTH, MINDMAP_SUMMARY_SESSION_MIN_LENGTH, mindmapEffectiveColor, PREVIEW_RIGHT_DEFAULT, ROW_HEIGHT_DEFAULT, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, SEARCH_MATCH_EXPAND_DEFAULT, THINK_LINES_DEFAULT, THINK_LINES_MAX, THINK_LINES_MIN, THINK_LINES_STEP, WATCH_FILES_DEFAULT } from '../constants.js'
import { translate } from '../locale/index.js'
import { IconSearch } from '../icons.js'
import { clearPreviewFontOverrides } from '../preview-font.js'
import { DIFF_TONE_GROUPS, diffColorOf, diffGroupLabel, FILE_COLOR_GROUPS, fileColorGroupLabel, fileColorOf, highlightPresetOf, VCS_STATUS_GROUPS, vcsStatusColorOf, vcsStatusGroupLabel } from '../format.js'
import { focusRunConfig, probeInterpreter, useRunConfig } from '../run-config.js'
import { checkUpdate, downloadUpdate, fetchInstalledUpdateInfo } from '../api.js'
import { readVcsHostEnabled, subscribeVcsHostEnabled } from '../vcs.js'
import { TokenStatsRow } from './token-stats.js'
import { useMindmapSummaryModels } from '../hooks/mindmap-summary-models.js'
/* =====================================================================================
   Settings page skeleton: seven cards (维护与统计 / 浏览与预览 / 图标与高亮配色 /
   版本控制 / 导图 / 对话 / 解释器). Every row is the same three-column grid —
   label | control | reset slot — so controls line up down the page; long explanations
   live in a per-card 说明 block that is collapsed by default.
   ===================================================================================== */

/* Cards and their jump-chip labels, in page order. */
const CARDS = Object.freeze([
  { id: 'maint', chip: 'settings.chip.maint' },
  { id: 'browse', chip: 'settings.chip.browse' },
  { id: 'palette', chip: 'settings.chip.palette' },
  { id: 'vcs', chip: 'settings.chip.vcs' },
  { id: 'mindmap', chip: 'settings.chip.mindmap' },
  { id: 'dialog', chip: 'settings.chip.dialog' },
  { id: 'interp', chip: 'settings.chip.interp' },
])
const CARD_IDS = Object.freeze(CARDS.map(card => card.id))
/* Version of the running bundle, inlined by tsdown's define — the LAST fallback for 「当前版本」:
   the Host's local read and a check's own answer report what is installed on disk and win; this
   covers only a Host that cannot answer at all (older Host without the route, or offline), where
   the running build beats showing nothing. `typeof` keeps the identifier safe under evaluation
   WITHOUT the build step (`check:client-modules`, SSR): a bare reference would throw ReferenceError. */
const BUILD_VERSION = typeof __DSH_WS_VERSION__ === 'string' ? __DSH_WS_VERSION__ : null

/* =====================================================================================
   Search: a DOM-level filter over the rendered rows. Text and value already live in the DOM,
   so a query hides non-matching units (and empties their sections/cards) without re-plumbing
   the page into a data model. Re-applied after every render, with a childList observer
   covering nodes React adds later (interpreter rows, probe results).
   ===================================================================================== */
const FILTER_UNITS = '[data-unit]'
const FILTER_BLOCKS = '[data-block]'

function unitText(el) {
  const label = el.getAttribute('data-label')
  if (label !== null && label !== '') return label
  return el.textContent ?? ''
}

function applySettingsFilter(root, query) {
  if (root === null) return 0
  const units = [...root.querySelectorAll(FILTER_UNITS)]
  const blocks = [...root.querySelectorAll(FILTER_BLOCKS)]
  const q = query.trim().toLowerCase()
  if (q === '') {
    for (const el of units) el.hidden = false
    for (const el of blocks) el.hidden = false
    for (const el of root.querySelectorAll('[data-card]')) el.hidden = false
    return 0
  }
  const hit = new Set(units.filter(el => unitText(el).toLowerCase().includes(q)))
  /* A section whose own title matches pulls its whole section in. */
  for (const block of blocks) {
    const label = block.getAttribute('data-label')
    if (label !== null && label !== '' && label.toLowerCase().includes(q)) {
      for (const el of block.querySelectorAll(FILTER_UNITS)) hit.add(el)
    }
  }
  for (const el of units) el.hidden = !hit.has(el)
  for (const block of blocks) {
    block.hidden = ![...block.querySelectorAll(FILTER_UNITS)].some(el => !el.hidden)
  }
  let visible = 0
  for (const card of root.querySelectorAll('[data-card]')) {
    const shown = [...card.querySelectorAll(FILTER_UNITS)].filter(el => !el.hidden)
    card.hidden = shown.length === 0
    visible += shown.length
  }
  return visible
}

/* The sticky bar: jump chips for every card, the match count, and the search box. */
function SettingsBar({ query, onQuery, matches }) {
  const chipsRef = useRef(null)
  /* The clicked chip stays lit while its smooth scroll runs: the scroll spy would otherwise report
     whatever ends up under the threshold (at the page bottom, always the LAST card — clicking 对话
     would light 解释器). The pin is released by the user's next interaction (wheel, scrollbar drag,
     key), none of which the jump itself produces, so it never depends on the animation's duration. */
  const pinnedRef = useRef(null)
  useEffect(() => {
    const chips = chipsRef.current
    if (chips === null) return undefined
    const root = chips.closest('.dsh-ws-settings')
    if (root === null) return undefined
    /* The scroll container belongs to the harness settings shell: walk up to the first scrollable ancestor. */
    let scroller = root.parentElement
    while (scroller !== null && scroller !== document.body) {
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(scroller) : null
      if (style !== null && (style.overflowY === 'auto' || style.overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break
      scroller = scroller.parentElement
    }
    const onScroll = () => {
      if (pinnedRef.current !== null) return
      const idOf = (card) => card.id.slice('dsh-ws-card-'.length)
      const list = CARD_IDS.map(id => document.getElementById(`dsh-ws-card-${id}`)).filter(card => card !== null && !card.hidden)
      let activeId = list.length === 0 ? CARD_IDS[0] : idOf(list[0])
      if (scroller !== null && list.length > 0) {
        /* At the very bottom the last cards can never reach the threshold, so the active chip is simply the last one. */
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
        if (atBottom) activeId = idOf(list[list.length - 1])
        else {
          const top = scroller.getBoundingClientRect().top + 56
          for (const card of list) if (card.getBoundingClientRect().top <= top) activeId = idOf(card)
        }
      }
      for (const button of chips.querySelectorAll('[data-chip]')) {
        button.setAttribute('aria-current', String(button.getAttribute('data-chip') === activeId))
      }
    }
    /* Any interaction outside the bar means the user took over the scroll. */
    const releasePin = (event) => {
      const target = event?.target
      if (target !== null && target !== undefined && typeof target.closest === 'function' && target.closest('.dsh-ws-settings-bar') !== null) return
      pinnedRef.current = null
    }
    const target = scroller === null ? window : scroller
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', releasePin, { passive: true, capture: true })
    window.addEventListener('touchstart', releasePin, { passive: true, capture: true })
    window.addEventListener('pointerdown', releasePin, { capture: true })
    window.addEventListener('keydown', releasePin, { capture: true })
    onScroll()
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', releasePin, { capture: true })
      window.removeEventListener('touchstart', releasePin, { capture: true })
      window.removeEventListener('pointerdown', releasePin, { capture: true })
      window.removeEventListener('keydown', releasePin, { capture: true })
      pinnedRef.current = null
    }
  }, [])
  const jumpTo = (id) => {
    const card = document.getElementById(`dsh-ws-card-${id}`)
    if (card === null) return
    pinnedRef.current = id
    const chips = chipsRef.current
    if (chips !== null) {
      for (const button of chips.querySelectorAll('[data-chip]')) {
        button.setAttribute('aria-current', String(button.getAttribute('data-chip') === id))
      }
    }
    card.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return h('div', { className: 'dsh-ws-settings-bar' },
    h('div', { className: 'dsh-ws-settings-chips', ref: chipsRef },
      CARDS.map(card => h('button', {
        'aria-current': 'false',
        className: 'dsh-ws-chip',
        'data-chip': card.id,
        key: card.id,
        onClick: () => jumpTo(card.id),
        type: 'button',
      }, translate(card.chip)))),
    query.trim() === '' ? null : h('span', { className: 'dsh-ws-settings-match' }, translate('settings.search.match', { count: String(matches) })),
    h('label', { className: 'dsh-ws-settings-search' },
      h(IconSearch),
      h('input', {
        'aria-label': translate('settings.search'),
        onChange: event => onQuery(event.target.value),
        placeholder: translate('settings.search.placeholder'),
        type: 'search',
        value: query,
      }),
      query === '' ? null : h('button', {
        'aria-label': translate('settings.search.clear'),
        className: 'dsh-ws-settings-search-clear',
        onClick: () => onQuery(''),
        title: translate('settings.search.clear'),
        type: 'button',
      }, '×')))
}

/* =====================================================================================
   1. 维护与统计: plugin update (with the permanently visible installed-version badge) and
   the token-statistics entry.
   ===================================================================================== */
function UpdateRow() {
  const [state, setState] = useState({ phase: 'idle' })
  /* Local facts (installed version, install mode) so the badge and install note exist before any check. A Host without the route answers 404 and this stays null — the badge waits for a check. */
  const [info, setInfo] = useState(null)
  const mountedRef = useRef(false)
  const setPhase = useCallback((phase, extra) => {
    if (mountedRef.current) setState({ phase, ...(extra ?? {}) })
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    let cancelled = false
    fetchInstalledUpdateInfo()
      .then((payload) => { if (!cancelled) setInfo(payload) })
      .catch(() => { /* version unknown (older Host / offline): the badge stays empty until a check answers */ })
    return () => { cancelled = true }
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
        setPhase('done', { latest: payload.latest, current: payload.current, pending: true })
        return
      }
      if (payload.updateAvailable === true) {
        setPhase('available', {
          current: payload.current,
          latest: payload.latest,
          installMode: payload.installMode,
          /* Host-computed: false when the swap target is not a copy inside a profile (link: / built-in installs) — the download button is then replaced by an explanation. */
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
  const disabled = state.phase === 'disabled' || info?.enabled === false
  /* Badge precedence: the check's own answer, else the Host's local read (available the moment the page opens), else the running bundle's own version. */
  const reported = state.phase === 'done'
    ? (state.latest ?? info?.current ?? null)
    : (state.current ?? info?.current ?? null)
  const installed = reported ?? BUILD_VERSION
  /* The number came from the bundle itself only when the Host could not report one (older Host / offline), so the tooltip says so instead of claiming a profile read. */
  const fromBuild = reported === null && BUILD_VERSION !== null
  const badgeFresh = state.phase === 'done' || info?.restartPending === true
  const installNote = state.phase === 'available' && state.updateSupported === false
    ? translate('settings.update.otherInstallNote')
    : state.phase === 'done'
      ? (state.installMode === 'file'
        ? translate('settings.update.fileInstallNote')
        : state.installMode === 'git' ? translate('settings.update.gitInstallNote') : null)
      : state.phase === 'idle' && info !== null && info.updateSupported === false && info.enabled !== false
        ? translate('settings.update.otherInstallNote')
        : null
  const statusArea = () => {
    if (disabled) return h('span', { className: 'dsh-ws-state' }, translate('settings.update.disabledByHost'))
    switch (state.phase) {
      case 'idle':
        return h('button', { className: 'dsh-ws-text-button', onClick: () => void runCheck(false), type: 'button' }, translate('settings.update.check'))
      case 'checking':
        return h('span', { className: 'dsh-ws-state' }, translate('settings.update.checking'))
      case 'up-to-date':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-state', 'data-ok': true }, translate('settings.update.upToDate')),
          h('button', { className: 'dsh-ws-text-button', onClick: () => void runCheck(true), type: 'button' }, translate('settings.update.recheck')))
      case 'available':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-state', 'data-new': true }, translate('settings.update.available', { latest: state.latest })),
          state.updateSupported === false
            ? null
            : h('button', { className: 'dsh-ws-text-button', onClick: () => void runDownload(), type: 'button' }, translate('settings.update.download')))
      case 'downloading':
        return h('span', { className: 'dsh-ws-state' }, translate('settings.update.downloading'))
      case 'done':
        return h('span', { className: 'dsh-ws-state', 'data-ok': true }, translate(state.pending === true ? 'settings.update.done.pending' : 'settings.update.done', { latest: state.latest }))
      case 'error':
        return h(Fragment, null,
          h('span', { className: 'dsh-ws-state', 'data-error': true }, state.message),
          h('button', { className: 'dsh-ws-text-button', onClick: () => void runCheck(true), type: 'button' }, translate('settings.update.retry')))
      default:
        return null
    }
  }
  return h(Row, {
    label: translate('settings.update.label'),
    dataLabel: `${translate('settings.update.label')} ${translate('settings.update.current')} v${installed ?? ''}`,
    note: installNote,
    reset: null,
    badge: installed === null
      ? null
      : h('i', {
        className: 'dsh-ws-version',
        'data-fresh': badgeFresh ? '' : undefined,
        title: translate(badgeFresh
          ? 'settings.update.current.fresh.title'
          : fromBuild ? 'settings.update.current.build.title' : 'settings.update.current.title'),
      }, translate('settings.update.current'), h('b', null, `v${installed}`)),
    control: h('span', { className: 'dsh-ws-row-status' }, statusArea()),
  })
}

function MaintenanceCard() {
  return h(Card, {
    id: 'maint',
    title: translate('settings.group.maint'),
    notes: ['settings.notes.maint.1', 'settings.notes.maint.2', 'settings.notes.maint.3'],
  }, h(UpdateRow), h(TokenStatsRow))
}

/* =====================================================================================
   2. 浏览与预览
   ===================================================================================== */
function BrowseCard({ settings, settingsStore }) {
  const rowHeight = settings.rowHeight
  const previewFontScale = settings.previewFontScale
  const conflictFontSize = settings.conflictFontSize
  const watchFiles = (settings.watchFiles ?? WATCH_FILES_DEFAULT) === true
  const changed = [
    rowHeight !== ROW_HEIGHT_DEFAULT,
    (settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT) !== SEARCH_MATCH_EXPAND_DEFAULT,
    previewFontScale !== FONT_SCALE_DEFAULT,
    conflictFontSize !== CONFLICT_FONT_SIZE_DEFAULT,
    (settings.previewRight ?? PREVIEW_RIGHT_DEFAULT) !== PREVIEW_RIGHT_DEFAULT,
    watchFiles !== WATCH_FILES_DEFAULT,
    (settings.autoSyncMode ?? AUTO_SYNC_MODE_AUTO) !== AUTO_SYNC_MODE_AUTO,
  ].filter(Boolean).length
  return h(Card, {
    id: 'browse',
    title: translate('settings.group.browse'),
    meta: changed === 0 ? null : translate('settings.changed', { count: String(changed) }),
    notes: ['settings.notes.browse.1', 'settings.notes.browse.2', 'settings.notes.browse.3'],
  },
    h(SliderRow, {
      label: translate('settings.rowHeight'),
      labelTitle: translate('settings.rowHeight'),
      hint: `${ROW_HEIGHT_MIN}–${ROW_HEIGHT_MAX}px`,
      min: ROW_HEIGHT_MIN, max: ROW_HEIGHT_MAX, step: 2,
      value: rowHeight, unit: `${rowHeight}px`,
      onChange: value => settingsStore.actions.setRowHeight(value),
      resetTitle: translate('settings.rowHeight.reset.title'),
      onReset: () => settingsStore.actions.setRowHeight(ROW_HEIGHT_DEFAULT),
      custom: rowHeight !== ROW_HEIGHT_DEFAULT,
    }),
    h(Row, {
      label: translate('settings.searchResult'),
      reset: null,
      control: h('select', {
        'aria-label': translate('settings.searchResult'),
        className: 'dsh-ws-select',
        onChange: event => settingsStore.actions.setExpandSearchMatches(event.target.value === 'expanded'),
        value: (settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT) ? 'expanded' : 'collapsed',
      },
      h('option', { value: 'expanded' }, translate('settings.expanded')),
      h('option', { value: 'collapsed' }, translate('settings.collapsed'))),
    }),
    h(SliderRow, {
      label: translate('settings.previewFontScale'),
      min: FONT_SCALE_MIN, max: FONT_SCALE_MAX, step: FONT_SCALE_STEP,
      value: previewFontScale, unit: translate('settings.previewFontScale.value', { percent: String(previewFontScale) }),
      onChange: value => settingsStore.actions.setPreviewFontScale(value),
      resetTitle: translate('settings.previewFontScale.reset.title'),
      onReset: () => settingsStore.actions.setPreviewFontScale(FONT_SCALE_DEFAULT),
      custom: previewFontScale !== FONT_SCALE_DEFAULT,
    }),
    /* One action row, shaped like a block action: it clears every open tab's own size so all follow the base size. It cannot know how many tabs carry one (they live in the explorer), so it is always enabled and the explorer's status bar reports the outcome. */
    h('div', { className: 'dsh-ws-row-action' },
      h('button', {
        className: 'dsh-ws-text-button',
        onClick: clearPreviewFontOverrides,
        title: translate('settings.previewFontScale.applyAll.title'),
        type: 'button',
      }, translate('settings.previewFontScale.applyAll'))),
    h(SliderRow, {
      label: translate('settings.conflictFontSize'),
      min: CONFLICT_FONT_SIZE_MIN, max: CONFLICT_FONT_SIZE_MAX, step: 1,
      value: conflictFontSize, unit: `${conflictFontSize}px`,
      onChange: value => settingsStore.actions.setConflictFontSize(value),
      resetTitle: translate('settings.conflictFontSize.reset.title'),
      onReset: () => settingsStore.actions.setConflictFontSize(CONFLICT_FONT_SIZE_DEFAULT),
      custom: conflictFontSize !== CONFLICT_FONT_SIZE_DEFAULT,
    }),
    h(SwitchRow, {
      label: translate('settings.previewRight'),
      checked: (settings.previewRight ?? PREVIEW_RIGHT_DEFAULT) === true,
      onChange: value => settingsStore.actions.setPreviewRight(value),
      resetTitle: translate('settings.resetDefault'),
      onReset: () => settingsStore.actions.setPreviewRight(PREVIEW_RIGHT_DEFAULT),
      custom: (settings.previewRight ?? PREVIEW_RIGHT_DEFAULT) !== PREVIEW_RIGHT_DEFAULT,
    }),
    h(SwitchRow, {
      label: translate('settings.watchFiles'),
      checked: watchFiles,
      onChange: value => settingsStore.actions.setWatchFiles(value),
      resetTitle: translate('settings.resetDefault'),
      onReset: () => settingsStore.actions.setWatchFiles(WATCH_FILES_DEFAULT),
      custom: watchFiles !== WATCH_FILES_DEFAULT,
    }),
    h(Sub, { off: !watchFiles },
      h(SwitchRow, {
        label: translate('settings.watchOnly'),
        checked: (settings.autoSyncMode ?? AUTO_SYNC_MODE_AUTO) === AUTO_SYNC_MODE_WATCH_ONLY,
        disabled: !watchFiles,
        onChange: value => settingsStore.actions.setAutoSyncMode(value ? AUTO_SYNC_MODE_WATCH_ONLY : AUTO_SYNC_MODE_AUTO),
        resetTitle: translate('settings.resetDefault'),
        onReset: () => settingsStore.actions.setAutoSyncMode(AUTO_SYNC_MODE_AUTO),
        custom: (settings.autoSyncMode ?? AUTO_SYNC_MODE_AUTO) !== AUTO_SYNC_MODE_AUTO,
      })))
}

/* =====================================================================================
   3. 图标与高亮配色
   ===================================================================================== */
function PaletteCard({ settings, settingsStore }) {
  const fileCount = Object.keys(settings.fileColors).length
  const presetCount = Object.keys(settings.highlightPresets).length
  const changed = fileCount + presetCount
  return h(Card, {
    id: 'palette',
    title: translate('settings.group.palette'),
    meta: changed === 0 ? null : translate('settings.changed', { count: String(changed) }),
    notes: ['settings.notes.palette.1', 'settings.notes.palette.2'],
  },
    h(Section, {
      label: translate('settings.fileColors'),
      action: fileCount === 0
        ? null
        : h('button', { className: 'dsh-ws-text-button dsh-ws-text-button-accent', onClick: () => settingsStore.actions.resetFileColors(), type: 'button' }, translate('settings.resetAllColors')),
    },
    h('div', { className: 'dsh-ws-palette', 'data-block': '' },
      FILE_COLOR_GROUPS.map(({ group }) => {
        const label = fileColorGroupLabel(group)
        return h(ColorCell, {
          key: group,
          label,
          value: fileColorOf(settings, group),
          onChange: value => settingsStore.actions.setFileColor(group, value),
          resetTitle: translate('settings.fileColor.reset.title', { label }),
          onReset: () => settingsStore.actions.resetFileColor(group),
          custom: settings.fileColors?.[group] !== undefined,
        })
      }))),
    h(Section, {
      label: translate('settings.presets'),
      action: presetCount === 0
        ? null
        : h('button', { className: 'dsh-ws-text-button dsh-ws-text-button-accent', onClick: () => settingsStore.actions.resetHighlightPresets(), type: 'button' }, translate('settings.resetAllPresets')),
    },
    h('div', { className: 'dsh-ws-palette', 'data-block': '' },
      FILE_COLOR_GROUPS.map(({ group }) => {
        const label = fileColorGroupLabel(group)
        return h(PresetCell, {
          key: `preset-${group}`,
          label,
          value: highlightPresetOf(settings, group),
          onChange: preset => settingsStore.actions.setHighlightPreset(group, preset),
          resetTitle: translate('settings.preset.reset.title', { label }),
          onReset: () => settingsStore.actions.resetHighlightPreset(group),
          custom: settings.highlightPresets?.[group] !== undefined,
        })
      }))))
}

/* =====================================================================================
   4. 版本控制
   ===================================================================================== */
function VcsCard({ settings, settingsStore, vcsHostEnabled }) {
  const masterOff = settings.vcsEnabled === false || vcsHostEnabled === false
  const rulerOff = settings.diffRuler === false
  const vcsColorCount = Object.keys(settings.vcsColors).length
  const diffColorCount = Object.keys(settings.diffColors).length
  const diffRulerWidth = settings.diffRulerWidth
  const changed = [
    settings.vcsEnabled === false,
    settings.vcsShowIgnored === true,
    settings.vcsHideDirs === false,
    settings.vcsAutoRefresh === false,
    settings.diffLineTint === false,
    rulerOff,
    diffRulerWidth !== DIFF_RULER_WIDTH_DEFAULT,
    settings.diffRulerSpan === 'full',
    settings.diffRulerThumb === 'full',
  ].filter(Boolean).length + vcsColorCount + diffColorCount
  return h(Card, {
    id: 'vcs',
    title: translate('settings.group.vcs'),
    meta: changed === 0 ? null : translate('settings.changed', { count: String(changed) }),
    notes: ['settings.notes.vcs.1', 'settings.notes.vcs.2', 'settings.notes.vcs.3'],
  },
    h(SwitchRow, {
      label: translate('settings.vcs.enabled'),
      checked: settings.vcsEnabled !== false,
      disabled: vcsHostEnabled === false,
      onChange: value => settingsStore.actions.setVcsEnabled(value),
      resetTitle: translate('settings.resetDefault'),
      onReset: () => settingsStore.actions.setVcsEnabled(true),
      custom: settings.vcsEnabled === false,
    }),
    vcsHostEnabled === false
      ? h('div', { className: 'dsh-ws-card-banner', 'data-tone': 'error' }, translate('settings.vcs.disabledByHost'))
      : null,
    h(Sub, { off: masterOff },
      h(SwitchRow, {
        label: translate('settings.vcs.ignored'),
        checked: settings.vcsShowIgnored === true,
        disabled: masterOff,
        onChange: value => settingsStore.actions.setVcsShowIgnored(value),
        resetTitle: translate('settings.resetDefault'),
        onReset: () => settingsStore.actions.setVcsShowIgnored(false),
        custom: settings.vcsShowIgnored === true,
      }),
      h(SwitchRow, {
        label: translate('settings.vcs.hideDirs'),
        checked: settings.vcsHideDirs !== false,
        disabled: masterOff,
        onChange: value => settingsStore.actions.setVcsHideDirs(value),
        resetTitle: translate('settings.resetDefault'),
        onReset: () => settingsStore.actions.setVcsHideDirs(true),
        custom: settings.vcsHideDirs === false,
      }),
      h(SwitchRow, {
        label: translate('settings.vcs.autoRefresh'),
        checked: settings.vcsAutoRefresh !== false,
        disabled: masterOff,
        onChange: value => settingsStore.actions.setVcsAutoRefresh(value),
        resetTitle: translate('settings.resetDefault'),
        onReset: () => settingsStore.actions.setVcsAutoRefresh(true),
        custom: settings.vcsAutoRefresh === false,
      })),
    h(Section, {
      label: translate('settings.vcs.colors'),
      action: vcsColorCount === 0
        ? null
        : h('button', { className: 'dsh-ws-text-button dsh-ws-text-button-accent', onClick: () => settingsStore.actions.resetVcsColors(), type: 'button' }, translate('settings.resetAllColors')),
    },
    h('div', { className: 'dsh-ws-palette', 'data-block': '' },
      VCS_STATUS_GROUPS.map(({ group }) => {
        const label = vcsStatusGroupLabel(group)
        return h(ColorCell, {
          key: group,
          label,
          value: vcsStatusColorOf(settings, group),
          onChange: value => settingsStore.actions.setVcsColor(group, value),
          resetTitle: translate('settings.vcs.color.reset.title', { label }),
          onReset: () => settingsStore.actions.resetVcsColor(group),
          custom: settings.vcsColors?.[group] !== undefined,
        })
      }))),
    h(Section, {
      label: translate('settings.diffColors'),
      action: diffColorCount === 0
        ? null
        : h('button', { className: 'dsh-ws-text-button dsh-ws-text-button-accent', onClick: () => settingsStore.actions.resetDiffColors(), type: 'button' }, translate('settings.resetAllColors')),
    },
    h('div', { className: 'dsh-ws-palette', 'data-block': '' },
      DIFF_TONE_GROUPS.map(({ group }) => {
        const label = diffGroupLabel(group)
        return h(ColorCell, {
          key: `diff-${group}`,
          label,
          value: diffColorOf(settings, group),
          onChange: value => settingsStore.actions.setDiffColor(group, value),
          resetTitle: translate('settings.diffColor.reset.title', { label }),
          onReset: () => settingsStore.actions.resetDiffColor(group),
          custom: settings.diffColors?.[group] !== undefined,
        })
      })),
    h(SwitchRow, {
      label: translate('settings.diffLineTint'),
      checked: settings.diffLineTint !== false,
      disabled: masterOff,
      onChange: value => settingsStore.actions.setDiffLineTint(value),
      resetTitle: translate('settings.resetDefault'),
      onReset: () => settingsStore.actions.setDiffLineTint(true),
      custom: settings.diffLineTint === false,
    })),
    /* Scrollbar change ruler: the widened track plus its three geometry choices. Everything is display-only, so the sub-rows simply grey out while the feature itself is off. */
    h(SwitchRow, {
      label: translate('settings.diffRuler'),
      checked: settings.diffRuler !== false,
      disabled: masterOff,
      onChange: value => settingsStore.actions.setDiffRuler(value),
      resetTitle: translate('settings.resetDefault'),
      onReset: () => settingsStore.actions.setDiffRuler(true),
      custom: rulerOff,
    }),
    h(Sub, { off: rulerOff || masterOff },
      h(SliderRow, {
        label: translate('settings.diffRulerWidth'),
        min: DIFF_RULER_WIDTH_MIN, max: DIFF_RULER_WIDTH_MAX, step: 2,
        value: diffRulerWidth, unit: `${diffRulerWidth}px`,
        disabled: rulerOff,
        onChange: value => settingsStore.actions.setDiffRulerWidth(value),
        resetTitle: translate('settings.diffRulerWidth.reset.title'),
        onReset: () => settingsStore.actions.setDiffRulerWidth(DIFF_RULER_WIDTH_DEFAULT),
        custom: diffRulerWidth !== DIFF_RULER_WIDTH_DEFAULT,
      }),
      h(SwitchRow, {
        label: translate('settings.diffRulerSpan'),
        checked: settings.diffRulerSpan === 'full',
        disabled: rulerOff,
        onChange: value => settingsStore.actions.setDiffRulerSpan(value ? 'full' : 'inset'),
        resetTitle: translate('settings.resetDefault'),
        onReset: () => settingsStore.actions.setDiffRulerSpan('inset'),
        custom: settings.diffRulerSpan === 'full',
      }),
      h(SwitchRow, {
        label: translate('settings.diffRulerThumb'),
        checked: settings.diffRulerThumb === 'full',
        disabled: rulerOff,
        onChange: value => settingsStore.actions.setDiffRulerThumb(value ? 'full' : 'slim'),
        resetTitle: translate('settings.resetDefault'),
        onReset: () => settingsStore.actions.setDiffRulerThumb('slim'),
        custom: settings.diffRulerThumb === 'full',
      })))
}

/* =====================================================================================
   5. 导图
   ===================================================================================== */
function MindmapCard({ settings, settingsStore, summaryModels }) {
  const summaryModelsAvailable = summaryModels !== null && summaryModels?.available === true
    && Array.isArray(summaryModels?.models) && summaryModels.models.length > 0
  const summaryModelList = summaryModelsAvailable ? summaryModels.models : []
  const summaryLength = settings.mindmapSummaryLength
  const summarySessionLength = settings.mindmapSummarySessionLength
  const spinSpeed = settings.mindmapSpinSpeed
  const mountBulge = settings.mindmapMountBulge
  const summaryOn = settings.mindmapSummaryEnabled === true
  /* Effective highlight colors: a stored hex, else the theme default resolved to a concrete hex (what a color input needs). */
  const hoverHex = mindmapEffectiveColor(settings.mindmapHoverColor, MINDMAP_HOVER_THEME_VAR, MINDMAP_HOVER_COLOR_FALLBACK)
  const selectedHex = mindmapEffectiveColor(settings.mindmapSelectedColor, MINDMAP_SELECTED_THEME_VAR, MINDMAP_SELECTED_COLOR_FALLBACK)
  /* "Customized" means the user stored a non-default hex; comparing against the effective hex was always true and left the reset buttons disabled. */
  const hoverCustom = settings.mindmapHoverColor !== undefined
  const selectedCustom = settings.mindmapSelectedColor !== undefined
  /* Session-head accent: default is the fixed violet (not theme adaptive), so the effective hex is the stored override or the default constant. End-of-branch accent: fixed success green. */
  const headHex = settings.mindmapHeadColor ?? MINDMAP_HEAD_COLOR_DEFAULT
  const endHex = settings.mindmapEndColor ?? MINDMAP_END_COLOR_DEFAULT
  const headCustom = settings.mindmapHeadColor !== undefined
  const endCustom = settings.mindmapEndColor !== undefined
  const changed = [
    hoverCustom, selectedCustom, headCustom, endCustom,
    mountBulge !== MINDMAP_MOUNT_BULGE_DEFAULT_X,
    spinSpeed !== MINDMAP_SPIN_SPEED_DEFAULT_X,
    summaryOn,
    settings.mindmapSummaryModel !== undefined,
    summaryLength !== MINDMAP_SUMMARY_DEFAULT_LENGTH,
    summarySessionLength !== MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH,
  ].filter(Boolean).length
  return h(Card, {
    id: 'mindmap',
    title: translate('settings.group.mindmap'),
    meta: changed === 0 ? null : translate('settings.changed', { count: String(changed) }),
    notes: ['settings.notes.mindmap.1', 'settings.notes.mindmap.2', 'settings.notes.mindmap.3'],
  },
    h(ColorRow, {
      label: translate('settings.mindmapHoverColor'),
      value: hoverHex,
      onChange: value => settingsStore.actions.setMindmapHoverColor(value),
      resetTitle: translate('settings.mindmapHoverColor.reset.title'),
      onReset: () => settingsStore.actions.resetMindmapHoverColor(),
      custom: hoverCustom,
    }),
    h(ColorRow, {
      label: translate('settings.mindmapSelectedColor'),
      value: selectedHex,
      onChange: value => settingsStore.actions.setMindmapSelectedColor(value),
      resetTitle: translate('settings.mindmapSelectedColor.reset.title'),
      onReset: () => settingsStore.actions.resetMindmapSelectedColor(),
      custom: selectedCustom,
    }),
    h(ColorRow, {
      label: translate('settings.mindmapHeadColor'),
      value: headHex,
      onChange: value => settingsStore.actions.setMindmapHeadColor(value),
      resetTitle: translate('settings.mindmapHeadColor.reset.title'),
      onReset: () => settingsStore.actions.resetMindmapHeadColor(),
      custom: headCustom,
    }),
    h(ColorRow, {
      label: translate('settings.mindmapEndColor'),
      value: endHex,
      onChange: value => settingsStore.actions.setMindmapEndColor(value),
      resetTitle: translate('settings.mindmapEndColor.reset.title'),
      onReset: () => settingsStore.actions.resetMindmapEndColor(),
      custom: endCustom,
    }),
    h(SliderRow, {
      label: translate('settings.mindmapMountBulge'),
      min: MINDMAP_MOUNT_BULGE_MIN_X, max: MINDMAP_MOUNT_BULGE_MAX_X, step: 0.5,
      value: mountBulge, unit: `${mountBulge.toFixed(1)}×`,
      onChange: value => settingsStore.actions.setMindmapMountBulge(value),
      resetTitle: translate('settings.mindmapMountBulge.reset.title'),
      onReset: () => settingsStore.actions.setMindmapMountBulge(MINDMAP_MOUNT_BULGE_DEFAULT_X),
      custom: mountBulge !== MINDMAP_MOUNT_BULGE_DEFAULT_X,
    }),
    h(SliderRow, {
      label: translate('settings.mindmapSpinSpeed'),
      min: MINDMAP_SPIN_SPEED_MIN_X, max: MINDMAP_SPIN_SPEED_MAX_X, step: 0.1,
      value: spinSpeed, unit: `${spinSpeed.toFixed(1)}×`,
      onChange: value => settingsStore.actions.setMindmapSpinSpeed(value),
      resetTitle: translate('settings.mindmapSpinSpeed.reset.title'),
      onReset: () => settingsStore.actions.setMindmapSpinSpeed(MINDMAP_SPIN_SPEED_DEFAULT_X),
      custom: spinSpeed !== MINDMAP_SPIN_SPEED_DEFAULT_X,
    }),
    h(Section, { label: translate('settings.mindmapSummary') },
      h(SwitchRow, {
        label: translate('settings.mindmapSummary.enabled'),
        checked: summaryOn,
        onChange: value => settingsStore.actions.setMindmapSummaryEnabled(value),
        /* Reset here only turns the feature off: the chosen model and length stay, so re-enabling is a single click. */
        resetTitle: translate('settings.mindmapSummary.reset.title'),
        onReset: () => settingsStore.actions.setMindmapSummaryEnabled(false),
        custom: summaryOn,
      }),
      h(Sub, { off: !summaryOn },
        summaryModels === null
          ? h(Row, { label: translate('settings.mindmapSummary.model'), reset: null, control: h('span', { className: 'dsh-ws-value' }, translate('settings.loading')) })
          : !summaryModelsAvailable
            ? h(Row, { label: translate('settings.mindmapSummary.model'), reset: null, control: h('span', { className: 'dsh-ws-value' }, translate('settings.mindmapSummary.model.missing')) })
            : h(Row, {
              label: translate('settings.mindmapSummary.model'),
              reset: null,
              /* Always selectable: the choice is remembered even while the feature is off, so re-enabling needs no re-picking. */
              control: h('select', {
                'aria-label': translate('settings.mindmapSummary.model'),
                className: 'dsh-ws-select',
                onChange: event => {
                  const raw = event.target.value
                  if (raw === 'session') settingsStore.actions.setMindmapSummaryModel(undefined)
                  else {
                    const hit = summaryModelList.find(model => `${model.provider}/${model.model}` === raw)
                    if (hit !== undefined) settingsStore.actions.setMindmapSummaryModel({ provider: hit.provider, model: hit.model })
                  }
                },
                /* A stored route no longer in the catalog falls back to "follow session model" visually (the stored value stays so a re-appearing model is picked up again). */
                value: settings.mindmapSummaryModel !== undefined && settings.mindmapSummaryModel !== null
                  && summaryModelList.some(model => model.provider === settings.mindmapSummaryModel.provider && model.model === settings.mindmapSummaryModel.model)
                  ? `${settings.mindmapSummaryModel.provider}/${settings.mindmapSummaryModel.model}`
                  : 'session',
              },
              h('option', { value: 'session' }, translate('settings.mindmapSummary.model.session')),
              summaryModelList.map(model => h('option', { key: `${model.provider}/${model.model}`, value: `${model.provider}/${model.model}` }, `${model.name} — ${model.provider}`))),
            }),
        h(SliderRow, {
          label: translate('settings.mindmapSummary.length'),
          min: MINDMAP_SUMMARY_MIN_LENGTH, max: MINDMAP_SUMMARY_MAX_LENGTH, step: MINDMAP_SUMMARY_LENGTH_STEP,
          value: summaryLength, unit: translate('settings.mindmapSummary.length.unit', { n: String(summaryLength) }),
          disabled: !summaryOn,
          onChange: value => settingsStore.actions.setMindmapSummaryLength(value),
          resetTitle: translate('settings.mindmapSummary.length.reset.title', { n: String(MINDMAP_SUMMARY_DEFAULT_LENGTH) }),
          onReset: () => settingsStore.actions.setMindmapSummaryLength(MINDMAP_SUMMARY_DEFAULT_LENGTH),
          custom: summaryLength !== MINDMAP_SUMMARY_DEFAULT_LENGTH,
        }),
        h(SliderRow, {
          label: translate('settings.mindmapSummary.sessionLength'),
          min: MINDMAP_SUMMARY_SESSION_MIN_LENGTH, max: MINDMAP_SUMMARY_SESSION_MAX_LENGTH, step: MINDMAP_SUMMARY_SESSION_LENGTH_STEP,
          value: summarySessionLength, unit: translate('settings.mindmapSummary.length.unit', { n: String(summarySessionLength) }),
          disabled: !summaryOn,
          onChange: value => settingsStore.actions.setMindmapSummarySessionLength(value),
          resetTitle: translate('settings.mindmapSummary.sessionLength.reset.title', { n: String(MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH) }),
          onReset: () => settingsStore.actions.setMindmapSummarySessionLength(MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH),
          custom: summarySessionLength !== MINDMAP_SUMMARY_SESSION_DEFAULT_LENGTH,
        }))))
}

/* =====================================================================================
   6. 对话
   ===================================================================================== */
function DialogCard({ settings, settingsStore }) {
  const thinkLines = settings.thinkLines
  const editLines = settings.editLines
  const changed = [thinkLines !== THINK_LINES_DEFAULT, editLines !== EDIT_LINES_DEFAULT].filter(Boolean).length
  return h(Card, {
    id: 'dialog',
    title: translate('settings.group.dialog'),
    meta: changed === 0 ? null : translate('settings.changed', { count: String(changed) }),
    notes: ['settings.notes.dialog.1', 'settings.notes.dialog.2'],
  },
    h(SliderRow, {
      label: translate('settings.thinkLines'),
      min: THINK_LINES_MIN, max: THINK_LINES_MAX, step: THINK_LINES_STEP,
      value: thinkLines, unit: translate('settings.thinkLines.value', { n: String(thinkLines) }),
      onChange: value => settingsStore.actions.setThinkLines(value),
      resetTitle: translate('settings.thinkLines.reset.title'),
      onReset: () => settingsStore.actions.setThinkLines(THINK_LINES_DEFAULT),
      custom: thinkLines !== THINK_LINES_DEFAULT,
    }),
    h(SliderRow, {
      label: translate('settings.editLines'),
      min: EDIT_LINES_MIN, max: EDIT_LINES_MAX, step: EDIT_LINES_STEP,
      value: editLines, unit: translate('settings.editLines.value', { n: String(editLines) }),
      onChange: value => settingsStore.actions.setEditLines(value),
      resetTitle: translate('settings.editLines.reset.title'),
      onReset: () => settingsStore.actions.setEditLines(EDIT_LINES_DEFAULT),
      custom: editLines !== EDIT_LINES_DEFAULT,
    }))
}

/* =====================================================================================
   7. 解释器（表格 + 文件级覆盖）
   ===================================================================================== */

/* =====================================================================================
   Section root
   ===================================================================================== */
export function ExplorerSettingsSection({ settingsStore }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const summaryModels = useMindmapSummaryModels()
  /* The Host can disable the whole version-control feature (`enableVcsStatus:false`); the explorer mirrors
     that answer here so the card explains itself instead of showing switches that do nothing. */
  const vcsHostEnabled = useSyncExternalStore(subscribeVcsHostEnabled, readVcsHostEnabled) !== false
  const runConfig = useRunConfig()
  const [interpreterExt, setInterpreterExt] = useState(null)
  const [probingExt, setProbingExt] = useState(null)
  const [probeResults, setProbeResults] = useState({})
  const [query, setQuery] = useState('')
  /* Visible-unit count under the current query: owned by the layout effect so the bar and the empty
     state re-render with it (the filter itself is a DOM pass, not a data-model pass). */
  const [matches, setMatches] = useState(0)
  const rootRef = useRef(null)
  const matchesRef = useRef(0)
  useEffect(() => { void focusRunConfig() }, [])
  /* A probe result describes one concrete path: drop it when the policy changes underneath. */
  useEffect(() => { setProbeResults({}) }, [runConfig.policy])
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
  /* Re-apply the filter after every render (rows re-render on any store change) and keep watching for
     nodes React adds later while a query is active. */
  useLayoutEffect(() => {
    const visible = applySettingsFilter(rootRef.current, query)
    setMatches(current => (current === visible ? current : visible))
  })
  useEffect(() => {
    if (query.trim() === '' || typeof MutationObserver === 'undefined') return undefined
    const root = rootRef.current
    if (root === null) return undefined
    const observer = new MutationObserver(() => {
      const visible = applySettingsFilter(root, query)
      setMatches(current => (current === visible ? current : visible))
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [query])
  return h('div', { className: 'dsh-ws-settings', ref: rootRef },
    h(SettingsBar, { matches, onQuery: setQuery, query }),
    h(MaintenanceCard, null),
    h(BrowseCard, { settings, settingsStore }),
    h(PaletteCard, { settings, settingsStore }),
    h(VcsCard, { settings, settingsStore, vcsHostEnabled }),
    h(MindmapCard, { settings, settingsStore, summaryModels }),
    h(DialogCard, { settings, settingsStore }),
    h(InterpreterCard, {
      interpreterExt,
      onClearProbe: () => setProbeResults({}),
      onProbe: runRowProbe,
      probeResults,
      probingExt,
      runConfig,
      setInterpreterExt,
    }),
    h('div', { className: 'dsh-ws-settings-empty', hidden: query.trim() === '' || matches !== 0 }, translate('settings.search.empty')))
}