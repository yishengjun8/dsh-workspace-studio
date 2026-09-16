/** Token usage statistics: settings group (设置 → 工作区设置 → Token 统计) with a modal panel that queries the Host's token-stats endpoint. Ranges (standard week/month presets and a custom date pair) are resolved to [from, to) epoch-ms in the browser's local timezone; the per-model view checkboxes decide which models feed the Summary row. The Host answers from its cached usage index and flags `warming` while a background scan is still running, so the panel shows the partial numbers and polls until that scan settles. */
import { createElement as h, Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../locale/index.js'
import { fetchTokenStats } from '../api.js'
import { useDialogFocusTrap } from './dialogs.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const TOKEN_RANGE_IDS = ['this-week', 'last-week', 'this-month', 'last-month', 'all', 'custom']

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
function startOfIsoWeek(date) {
  const d = startOfDay(date)
  const day = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - day)
  return d
}
function startOfMonth(date) {
  const d = startOfDay(date)
  d.setDate(1)
  return d
}
/* yyyy-mm-dd (local) serialization for <input type="date"> values. */
function dateInputValue(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function parseDateInput(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}
/* Resolve a selection to a concrete [from, to) window; custom ranges return { invalid } instead when the date pair is incomplete or reversed. Every boundary is day-aligned so the Host's per-day buckets filter exactly. */
function rangeBoundsOf(range, startDate, endDate) {
  const now = Date.now()
  if (range === 'custom') {
    const start = parseDateInput(startDate)
    const end = parseDateInput(endDate)
    if (start === null || end === null) return { invalid: 'date' }
    if (start.getTime() > end.getTime()) return { invalid: 'range' }
    return { from: start.getTime(), to: end.getTime() + DAY_MS }
  }
  const current = new Date(now)
  const weekStart = startOfIsoWeek(current)
  const monthStart = startOfMonth(current)
  switch (range) {
    case 'this-week':
      return { from: weekStart.getTime(), to: now }
    case 'last-week':
      return { from: weekStart.getTime() - WEEK_MS, to: weekStart.getTime() }
    case 'this-month':
      return { from: monthStart.getTime(), to: now }
    case 'last-month':
      return { from: startOfMonth(new Date(monthStart.getTime() - 1)).getTime(), to: monthStart.getTime() }
    default:
      return { from: 0, to: now }
  }
}

function fmtCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '0'
}
function fmtDate(ms) {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

/* Settings entry point: the group renders after the plugin-update group; the dialog lives inside it so no external state wiring is needed. */
export function TokenStatsGroup() {
  const [open, setOpen] = useState(false)
  return h(Fragment, null,
    h('div', { className: 'dsh-ws-settings-group' },
      h('div', { className: 'dsh-ws-settings-group-title' }, translate('settings.group.tokens')),
      h('div', { className: 'dsh-ws-settings-row' },
        h('span', { className: 'dsh-ws-settings-label' }, translate('settings.tokens.usage')),
        h('button', { className: 'dsh-ws-text-button', onClick: () => setOpen(true), type: 'button' }, translate('settings.tokens.open'))),
      h('div', { className: 'dsh-ws-settings-hint' }, translate('settings.tokens.hint'))),
    h('div', { className: 'dsh-ws-explorer-divider' }),
    open ? h(TokenStatsDialog, { onClose: () => setOpen(false) }) : null,
  )
}

function TokenStatsDialog({ onClose }) {
  const dialogFocusRef = useDialogFocusTrap()
  const [range, setRange] = useState('this-week')
  const firstOfMonth = new Date()
  firstOfMonth.setDate(1)
  const [startDate, setStartDate] = useState(() => dateInputValue(firstOfMonth))
  const [endDate, setEndDate] = useState(() => dateInputValue(new Date()))
  const [view, setView] = useState('model')
  const [archived, setArchived] = useState(true)
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  /* Per-model exclusion set (default all checked); survives range switches while the dialog is open. */
  const [uncheckedKeys, setUncheckedKeys] = useState(() => new Set())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const toggleKey = useCallback((key) => {
    setUncheckedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  /* Fetch whenever the window or the archived flag changes; a superseded request is aborted so rapid switches never race. */
  useEffect(() => {
    const bounds = rangeBoundsOf(range, startDate, endDate)
    if (bounds.invalid !== undefined) {
      setPayload(null)
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchTokenStats(bounds.from, bounds.to, archived, controller.signal)
      .then(value => {
        if (!mountedRef.current) return
        setPayload(value)
        setLoading(false)
      })
      .catch(failure => {
        if (failure?.name === 'AbortError') return
        if (!mountedRef.current) return
        setPayload(null)
        setError(failure instanceof Error ? failure.message : String(failure))
        setLoading(false)
      })
    return () => controller.abort()
  }, [archived, attempt, endDate, range, startDate])
  /* The Host answers from its cached usage index while a background scan is still running: keep the partial numbers on screen and poll until the scan settles. */
  const warming = payload !== null && payload.available !== false && payload.warming === true
  useEffect(() => {
    if (!warming) return undefined
    const timer = setTimeout(retry, 1500)
    return () => clearTimeout(timer)
  }, [payload, retry, warming])
  /* Window-level Escape; every request is abortable, so closing is always allowed (the cleanup aborts the in-flight fetch). */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const bounds = rangeBoundsOf(range, startDate, endDate)
  const customSel = range === 'custom'
  const invalid = bounds.invalid === 'range'
    ? translate('tokens.invalid.range')
    : bounds.invalid === 'date'
      ? translate('tokens.invalid.date')
      : null
  const numberHeaders = [
    translate('tokens.col.calls'),
    translate('tokens.col.input'),
    translate('tokens.col.cacheRead'),
    translate('tokens.col.cacheWrite'),
    translate('tokens.col.output'),
    translate('tokens.col.sum'),
  ]
  const numberCells = (row) => h(Fragment, null,
    h('td', null, fmtCount(row.calls)),
    h('td', null, fmtCount(row.input)),
    h('td', null, fmtCount(row.cacheRead)),
    h('td', null, fmtCount(row.cacheWrite)),
    h('td', null, fmtCount(row.output)),
    h('td', null, fmtCount(row.input + row.cacheRead + row.cacheWrite + row.output)))
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  const summaryRows = view === 'total'
    ? rows
    : rows.filter(row => !uncheckedKeys.has(`${row.provider}\u0001${row.model}`))
  const summary = summaryRows.reduce((acc, row) => {
    acc.calls += row.calls
    acc.input += row.input
    acc.cacheRead += row.cacheRead
    acc.cacheWrite += row.cacheWrite
    acc.output += row.output
    return acc
  }, { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
  const stateBox = (text, isError) => h('div', { className: 'dsh-ws-token-state', ...(isError ? { 'data-error': true } : {}) }, h('span', null, text))
  let content
  if (invalid !== null) {
    content = stateBox(invalid, true)
  } else if (loading && payload === null) {
    content = stateBox(translate('tokens.loading'))
  } else if (error !== null) {
    content = h('div', { className: 'dsh-ws-token-state', 'data-error': true },
      h('span', null, error),
      h('button', { className: 'dsh-ws-text-button', onClick: retry, type: 'button' }, translate('tokens.retry')))
  } else if (payload === null || payload.available === false) {
    content = h('div', { className: 'dsh-ws-token-state', 'data-error': true },
      h('span', null, translate('tokens.error')),
      h('button', { className: 'dsh-ws-text-button', onClick: retry, type: 'button' }, translate('tokens.retry')))
  } else if (rows.length === 0) {
    content = stateBox(archived ? translate('tokens.empty') : translate('tokens.empty.filtered'))
  } else if (view === 'total') {
    content = h(Fragment, null,
      h('div', { className: 'dsh-ws-token-table-wrap' },
        h('table', { className: 'dsh-ws-token-table' },
          h('thead', null, h('tr', null,
            h('th', null, translate('tokens.col.total')),
            numberHeaders.map(header => h('th', { key: header }, header)))),
          h('tbody', null,
            h('tr', { className: 'dsh-ws-token-total-row' },
              h('td', { className: 'dsh-ws-token-model' }, translate('tokens.totalRow')),
              h('td', null, fmtCount(summary.calls)),
              h('td', null, fmtCount(summary.input)),
              h('td', null, fmtCount(summary.cacheRead)),
              h('td', null, fmtCount(summary.cacheWrite)),
              h('td', null, fmtCount(summary.output)),
              h('td', null, fmtCount(summary.input + summary.cacheRead + summary.cacheWrite + summary.output)))))))
  } else {
    content = h(Fragment, null,
      h('div', { className: 'dsh-ws-settings-hint' }, translate('tokens.viewNote.model')),
      h('div', { className: 'dsh-ws-token-table-wrap' },
        h('table', { className: 'dsh-ws-token-table' },
          h('thead', null, h('tr', null,
            h('th', { className: 'dsh-ws-token-chk' }, null),
            h('th', null, translate('tokens.col.model')),
            numberHeaders.map(header => h('th', { key: header }, header)))),
          h('tbody', null,
            rows.map(row => {
              const key = `${row.provider}\u0001${row.model}`
              const off = uncheckedKeys.has(key)
              return h('tr', { className: off ? 'dsh-ws-token-dim' : undefined, key },
                h('td', { className: 'dsh-ws-token-chk' },
                  h('input', { 'aria-label': translate('tokens.col.model'), checked: !off, onChange: () => toggleKey(key), type: 'checkbox' })),
                h('td', { className: 'dsh-ws-token-model' }, `${row.provider}/${row.model}`),
                numberCells(row))
            }),
            h('tr', { className: 'dsh-ws-token-total-row' },
              h('td', { className: 'dsh-ws-token-chk' }, null),
              h('td', { className: 'dsh-ws-token-model' }, translate('tokens.totalRow')),
              h('td', null, fmtCount(summary.calls)),
              h('td', null, fmtCount(summary.input)),
              h('td', null, fmtCount(summary.cacheRead)),
              h('td', null, fmtCount(summary.cacheWrite)),
              h('td', null, fmtCount(summary.output)),
              h('td', null, fmtCount(summary.input + summary.cacheRead + summary.cacheWrite + summary.output)))))))
  }
  const rangeLine = range === 'all'
    ? translate('tokens.range.all.label')
    : payload !== null && payload.available !== false
      ? translate('tokens.rangeHint', { from: fmtDate(payload.from), to: fmtDate(payload.to), label: translate(`tokens.range.${range}`) })
      : ''
  const failedLine = payload !== null && typeof payload?.failed === 'number' && payload.failed > 0
    ? translate('tokens.failedHint', { n: payload.failed })
    : null
  const warmingLine = warming
    ? translate('tokens.warming', { done: fmtCount(payload?.progress?.processed ?? 0), total: fmtCount(payload?.progress?.total ?? 0) })
    : null
  return h('div', { className: 'dsh-ws-dialog-backdrop', onMouseDown: e => { if (e.target === e.currentTarget) onClose() } },
    h('div', { 'aria-modal': true, className: 'dsh-ws-dialog dsh-ws-token-dialog', ref: dialogFocusRef, role: 'dialog' },
      h('div', { className: 'dsh-ws-dialog-header' },
        h('div', { className: 'dsh-ws-dialog-title' }, translate('tokens.dialog.title')),
        h('button', { 'aria-label': translate('dialog.close'), className: 'dsh-ws-icon-button', onClick: onClose, title: translate('dialog.close'), type: 'button' }, '×')),
      h('div', { className: 'dsh-ws-dialog-body dsh-ws-token-body' },
        h('div', { className: 'dsh-ws-token-controls' },
          h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-token-range' }, translate('tokens.range')),
          h('select', {
            'aria-label': translate('tokens.range'),
            className: 'dsh-ws-settings-select dsh-ws-token-select',
            id: 'dsh-ws-token-range',
            onChange: e => setRange(e.target.value),
            value: range,
          }, TOKEN_RANGE_IDS.map(id => h('option', { key: id, value: id }, translate(`tokens.range.${id}`)))),
          customSel ? h(Fragment, null,
            h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-token-start' }, translate('tokens.custom.start')),
            h('input', {
              'aria-label': translate('tokens.custom.start'),
              className: 'dsh-ws-token-date',
              id: 'dsh-ws-token-start',
              max: endDate === '' ? undefined : endDate,
              onChange: e => setStartDate(e.target.value),
              type: 'date',
              value: startDate,
            }),
            h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-token-end' }, translate('tokens.custom.end')),
            h('input', {
              'aria-label': translate('tokens.custom.end'),
              className: 'dsh-ws-token-date',
              id: 'dsh-ws-token-end',
              min: startDate === '' ? undefined : startDate,
              onChange: e => setEndDate(e.target.value),
              type: 'date',
              value: endDate,
            })) : null,
          h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-token-view' }, translate('tokens.view')),
          h('select', {
            'aria-label': translate('tokens.view'),
            className: 'dsh-ws-settings-select dsh-ws-token-select',
            id: 'dsh-ws-token-view',
            onChange: e => setView(e.target.value),
            value: view,
          },
            h('option', { value: 'total' }, translate('tokens.view.total')),
            h('option', { value: 'model' }, translate('tokens.view.model'))),
          h('label', { className: 'dsh-ws-token-check' },
            h('input', { checked: archived, onChange: e => setArchived(e.target.checked), type: 'checkbox' }),
            translate('tokens.archived'))),
        content),
      h('div', { className: 'dsh-ws-token-foot' },
        warmingLine === null ? null : h('div', { className: 'dsh-ws-token-warming' }, warmingLine),
        failedLine === null ? null : h('div', { className: 'dsh-ws-token-failed' }, failedLine),
        h('div', null, rangeLine),
        h('div', null, translate('tokens.hint'))),
    ))
}
