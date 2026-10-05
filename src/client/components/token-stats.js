/** Token usage statistics: settings group (设置 → 工作区设置 → Token 统计) with a modal panel that queries the Host's token-stats endpoint. Ranges (standard week/month presets and a custom date pair) are resolved to [from, to) epoch-ms in the browser's local timezone; the per-model view checkboxes decide which models feed the Summary row. That view also carries a name-fragment filter: keywords are matched (case-insensitively, OR-combined) against the whole `provider/model` label and narrow both the table and the Summary row — client-side only, so it never re-queries the Host. The Host answers from its cached usage index and flags `warming` while a background scan is still running, so the panel shows the partial numbers and polls until that scan settles.

Below the table sits the quick calculator: three unit-price fields (input / cache read / output, per 1M tokens), a currency symbol and one money column. It multiplies the Host's own token numbers — the same visible rows the Summary covers — so nothing has to be retyped, and every row may override any of the three prices (an empty cell falls back to the shared default). Prices are per-million-token numbers only; the panel never guesses a unit or a rate. Everything typed here (defaults, per-row overrides, currency) is local-only localStorage state and is never sent to the Host. */
import { createElement as h, Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../locale/index.js'
import { PanelState } from '../panel-state.js'
import { fetchTokenStats } from '../api.js'
import { TOKEN_CURRENCY_MAX_LENGTH, TOKEN_PRICE_DEFAULT_CURRENCY, TOKEN_PRICE_FIELDS, TOKEN_PRICE_MAX_LENGTH, TOKEN_PRICES_STORE_KEY } from '../constants.js'
import { readPersistedState } from '../persisted-state.js'
import { Modal } from './dialogs.js'

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

/* ---- Quick calculator (bottom of the token panel) ---- */
/* The priced fields, their default currency and the input caps live in constants.js so the
   persisted-state schema and this panel share one definition; a field the schema does not name
   (including one a previous format wrote) simply is not part of the record and is dropped there. */
const MILLION = 1000000

/* One price field: a plain text input with decimal keypad hints, so a number input's spinners (and its wheel-changes-value behaviour inside the scrolling dialog) never appear. Anything that is not a digit or a single dot is dropped instead of stored, and the length is capped so a paste cannot bloat the persisted value. An empty string means "not filled in" and is worth 0. */
function sanitizePriceInput(value) {
  let text = ''
  let dot = false
  for (const ch of String(value)) {
    if (ch >= '0' && ch <= '9') text += ch
    else if (ch === '.' && !dot) { dot = true; text += ch }
    if (text.length >= TOKEN_PRICE_MAX_LENGTH) break
  }
  return text === '.' ? '' : text
}
function priceValue(text) {
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}
function fmtMoney(value, currency) {
  const amount = Number.isFinite(value) ? value : 0
  return `${currency}${amount.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
}
/* A drag across a model name that ended as a text selection (the user is copying it) must not flip that row's checkbox. No selection API (or an empty/collapsed one) means a plain click, which does toggle. */
function hasTextSelection() {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
  const selection = window.getSelection()
  return selection !== null && selection !== undefined && String(selection).trim() !== ''
}
/* Prices survive reloads (they are user-typed reference data, not session state). The shape is
   owned by persisted-state.js: an absent or unusable key simply yields the empty calculator. */
function readPersistedTokenPrices() {
  return readPersistedState(TOKEN_PRICES_STORE_KEY) ?? {
    currency: TOKEN_PRICE_DEFAULT_CURRENCY,
    prices: {},
    overrides: {},
  }
}
function writePersistedTokenPrices(state) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TOKEN_PRICES_STORE_KEY, JSON.stringify(state))
  } catch { /* quota / private mode: the calculator keeps working in memory */ }
}
/* A price input; `placeholder` shows the effective default inside an empty per-row override cell, so "leave empty to use the default price" is visible without a tooltip. */
function priceInput(options) {
  return h('input', {
    'aria-label': options.ariaLabel,
    className: options.className === undefined ? 'dsh-ws-token-price-input' : `dsh-ws-token-price-input ${options.className}`,
    id: options.id,
    inputMode: 'decimal',
    onChange: event => options.onChange(event.target.value),
    placeholder: options.placeholder ?? '0',
    spellCheck: false,
    title: options.title,
    type: 'text',
    value: options.value,
  })
}

/* Name-fragment filter for the per-model view: lowercase keywords split on spaces / commas / CJK separators. Matched against the whole `provider/model` label, so a provider keyword such as "ollama" also hits rows whose model name does not contain it. No keyword means no filtering. */
function filterTerms(query) {
  const terms = []
  for (const term of String(query).toLowerCase().split(/[\s,，、;；]+/)) {
    if (term !== '' && !terms.includes(term)) terms.push(term)
  }
  return terms
}
/* Half-open [start, end) match ranges of every keyword, merged so overlapping hits highlight as one span. */
function matchRanges(text, terms) {
  const lower = text.toLowerCase()
  const found = []
  for (const term of terms) {
    let index = lower.indexOf(term)
    while (index !== -1) {
      found.push([index, index + term.length])
      index = lower.indexOf(term, index + term.length)
    }
  }
  if (found.length === 0) return []
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = [found[0]]
  for (let i = 1; i < found.length; i += 1) {
    const last = merged[merged.length - 1]
    if (found[i][0] <= last[1]) last[1] = Math.max(last[1], found[i][1])
    else merged.push(found[i])
  }
  return merged
}
function matchesFilter(label, terms) {
  return terms.length === 0 || matchRanges(label, terms).length > 0
}
/* Model-cell children with every matched fragment wrapped in the shared search-hit span. */
function highlightLabel(label, terms) {
  const ranges = matchRanges(label, terms)
  if (ranges.length === 0) return [label]
  const parts = []
  let position = 0
  ranges.forEach(([start, end], index) => {
    if (start > position) parts.push(label.slice(position, start))
    parts.push(h('span', { className: 'dsh-ws-search-hit', key: `hit-${index}` }, label.slice(start, end)))
    position = end
  })
  if (position < label.length) parts.push(label.slice(position))
  return parts
}

/* Settings entry point: one row inside the 维护与统计 card (label | action | reset slot) plus the dialog it owns, so the settings page needs no state wiring for it. */
export function TokenStatsRow() {
  const [open, setOpen] = useState(false)
  return h(Fragment, null,
    h('div', { className: 'dsh-ws-row', 'data-unit': '' },
      h('div', { className: 'dsh-ws-row-label' },
        h('span', { className: 'dsh-ws-row-label-text' }, translate('settings.tokens.usage'))),
      h('div', { className: 'dsh-ws-row-control' },
        h('button', { className: 'dsh-ws-text-button', onClick: () => setOpen(true), type: 'button' }, translate('settings.tokens.open'))),
      h('span', { className: 'dsh-ws-row-reset' })),
    open ? h(TokenStatsDialog, { onClose: () => setOpen(false) }) : null,
  )
}

function TokenStatsDialog({ onClose }) {
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
  /* Per-model name filter (empty = show everything); also survives range switches while the dialog is open. */
  const [filterQuery, setFilterQuery] = useState('')
  /* Quick calculator: shared unit prices + per-model overrides + currency symbol, restored from localStorage and written back on every change. */
  const [priceState, setPriceState] = useState(readPersistedTokenPrices)
  const [costCollapsed, setCostCollapsed] = useState(false)
  /* Models whose price line the user revealed by clicking the row. In-memory only: a reload starts collapsed again, except for rows that carry their own prices — those are persisted and therefore always open. */
  const [openPriceRows, setOpenPriceRows] = useState(() => new Set())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => { writePersistedTokenPrices(priceState) }, [priceState])
  const setDefaultPrice = useCallback((field, text) => {
    setPriceState(prev => ({ ...prev, prices: { ...prev.prices, [field]: sanitizePriceInput(text) } }))
  }, [])
  const setCurrency = useCallback((text) => {
    setPriceState(prev => ({ ...prev, currency: String(text).slice(0, TOKEN_CURRENCY_MAX_LENGTH) }))
  }, [])
  /* An empty cell removes the override for that one field; a row whose three cells are all empty drops out of the override map entirely, so the stored object stays as small as what the user actually typed. */
  const setRowPrice = useCallback((key, field, text) => {
    setPriceState(prev => {
      const clean = sanitizePriceInput(text)
      const record = { ...(prev.overrides[key] ?? {}) }
      if (clean === '') delete record[field]
      else record[field] = clean
      const overrides = { ...prev.overrides }
      if (Object.keys(record).length === 0) delete overrides[key]
      else overrides[key] = record
      return { ...prev, overrides }
    })
  }, [])
  /* A row that carries its own prices is always open and cannot be collapsed; clearing its last override hands the toggle back (and keeps it open right now, so the boxes do not vanish under the pointer). */
  const clearRowPrices = useCallback((key) => {
    setOpenPriceRows(prev => (prev.has(key) ? prev : new Set(prev).add(key)))
    setPriceState(prev => {
      if (prev.overrides[key] === undefined) return prev
      const overrides = { ...prev.overrides }
      delete overrides[key]
      return { ...prev, overrides }
    })
  }, [])
  const togglePriceRow = useCallback((key) => {
    setOpenPriceRows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
  /* Window-level Escape; every request is abortable, so closing is always allowed (the cleanup aborts the in-flight fetch). A composing keystroke is never a command (same guard as every other text input in this plugin), so an IME composition inside the currency / price fields is cancelled instead of closing the dialog. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.isComposing || event.key !== 'Escape') return
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
  /* Cache-write tokens are deliberately not shown, not summed and not priced (the Host still reports the field; the panel ignores it), so the total is input + cache read + output. */
  const numberHeaders = [
    translate('tokens.col.calls'),
    translate('tokens.col.input'),
    translate('tokens.col.cacheRead'),
    translate('tokens.col.output'),
    translate('tokens.col.sum'),
  ]
  const numberCells = (row) => h(Fragment, null,
    h('td', null, fmtCount(row.calls)),
    h('td', null, fmtCount(row.input)),
    h('td', null, fmtCount(row.cacheRead)),
    h('td', null, fmtCount(row.output)),
    h('td', null, fmtCount(row.input + row.cacheRead + row.output)))
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  /* Name filter is display-only: the fetched rows stay untouched, and the Summary row follows what is currently visible. */
  const terms = filterTerms(filterQuery)
  const filteredRows = terms.length === 0 ? rows : rows.filter(row => matchesFilter(`${row.provider}/${row.model}`, terms))
  const filterActive = view === 'model' && rows.length > 0
  const summaryRows = view === 'total'
    ? rows
    : filteredRows.filter(row => !uncheckedKeys.has(`${row.provider}\u0001${row.model}`))
  const summary = summaryRows.reduce((acc, row) => {
    acc.calls += row.calls
    acc.input += row.input
    acc.cacheRead += row.cacheRead
    acc.output += row.output
    return acc
  }, { calls: 0, input: 0, cacheRead: 0, output: 0 })
  /* The token panel's state line: the shared panel message pinned to this panel's class. */
  const stateBox = (text, isError) => h(PanelState, { className: 'dsh-ws-token-state', error: isError === true, layout: 'inline', message: text })
  let content
  if (invalid !== null) {
    content = stateBox(invalid, true)
  } else if (loading && payload === null) {
    content = stateBox(translate('tokens.loading'))
  } else if (error !== null) {
    content = h(PanelState, { className: 'dsh-ws-token-state', error: true, layout: 'inline', message: error, retry, retryLabel: translate('tokens.retry') })
  } else if (payload === null || payload.available === false) {
    content = h(PanelState, { className: 'dsh-ws-token-state', error: true, layout: 'inline', message: translate('tokens.error'), retry, retryLabel: translate('tokens.retry') })
  } else if (rows.length === 0) {
    content = stateBox(archived ? translate('tokens.empty') : translate('tokens.empty.filtered'))
  } else if (view === 'total') {
    content = h(Fragment, null,
      h('div', { className: 'dsh-ws-token-table-wrap' },
        h('table', { className: 'dsh-ws-token-table' },
          h('thead', null, h('tr', null,
            h('th', { className: 'dsh-ws-token-model' }, translate('tokens.col.total')),
            numberHeaders.map(header => h('th', { key: header }, header)))),
          h('tbody', null,
            h('tr', { className: 'dsh-ws-token-total-row' },
              h('td', { className: 'dsh-ws-token-model' }, translate('tokens.totalRow')),
              h('td', null, fmtCount(summary.calls)),
              h('td', null, fmtCount(summary.input)),
              h('td', null, fmtCount(summary.cacheRead)),
              h('td', null, fmtCount(summary.output)),
              h('td', null, fmtCount(summary.input + summary.cacheRead + summary.output)))))))
  } else if (terms.length > 0 && filteredRows.length === 0) {
    content = h('div', { className: 'dsh-ws-token-state' },
      h('span', null, translate('tokens.filter.empty', { q: filterQuery.trim() })),
      h('button', { className: 'dsh-ws-text-button', onClick: () => setFilterQuery(''), type: 'button' }, translate('tokens.filter.clear')))
  } else {
    /* No explanatory line above the table: the checkbox linkage and the filter's multi-keyword behaviour are meant to be discovered from the controls themselves. */
    content = h(Fragment, null,
      h('div', { className: 'dsh-ws-token-table-wrap' },
        h('table', { className: 'dsh-ws-token-table' },
          h('thead', null, h('tr', null,
            h('th', { className: 'dsh-ws-token-chk' }, null),
            h('th', { className: 'dsh-ws-token-model' }, translate('tokens.col.model')),
            numberHeaders.map(header => h('th', { key: header }, header)))),
          h('tbody', null,
            filteredRows.map(row => {
              const key = `${row.provider}\u0001${row.model}`
              const off = uncheckedKeys.has(key)
              /* The whole row toggles this model's checkbox (same single entry point as the checkbox itself): one is not a second code path, it is a second hit area for the very same action. */
              return h('tr', {
                className: `dsh-ws-token-selectable${off ? ' dsh-ws-token-dim' : ''}`,
                key,
                onClick: event => {
                  /* The checkbox handles its own clicks through its change event; reacting to the bubbled click as well would flip the row twice, i.e. never. */
                  if (event.target?.tagName === 'INPUT') return
                  if (hasTextSelection()) return
                  toggleKey(key)
                },
              },
                h('td', { className: 'dsh-ws-token-chk' },
                  h('input', { 'aria-label': translate('tokens.col.model'), checked: !off, onChange: () => toggleKey(key), type: 'checkbox' })),
                h('td', { className: 'dsh-ws-token-model' }, ...highlightLabel(`${row.provider}/${row.model}`, terms)),
                numberCells(row))
            }),
            h('tr', { className: 'dsh-ws-token-total-row' },
              h('td', { className: 'dsh-ws-token-chk' }, null),
              h('td', { className: 'dsh-ws-token-model' }, translate('tokens.totalRow')),
              h('td', null, fmtCount(summary.calls)),
              h('td', null, fmtCount(summary.input)),
              h('td', null, fmtCount(summary.cacheRead)),
              h('td', null, fmtCount(summary.output)),
              h('td', null, fmtCount(summary.input + summary.cacheRead + summary.output)))))))
  }
  /* ---- Quick calculator: the same visible rows the Summary row covers. An unchecked row (per-model view) is greyed out and excluded from the money total, and a filter matching nothing hides the calculator together with the table. ---- */
  const costKeyOf = row => `${row.provider}\u0001${row.model}`
  const priceOf = (key, field) => priceValue(priceState.overrides[key]?.[field] ?? priceState.prices[field] ?? '')
  const costOf = row => TOKEN_PRICE_FIELDS.reduce((sum, field) => sum + (Number(row[field]) || 0) * priceOf(costKeyOf(row), field), 0) / MILLION
  const costRows = view === 'total' ? rows : filteredRows
  const costExcluded = row => view === 'model' && uncheckedKeys.has(costKeyOf(row))
  const costIncluded = costRows.filter(row => !costExcluded(row))
  const costTotal = costIncluded.reduce((sum, row) => sum + costOf(row), 0)
  /* An empty override cell shows the effective default price as its placeholder, so "leave empty to use the default" needs no extra hint. */
  const defaultPricePlaceholder = field => (priceState.prices[field] === undefined || priceState.prices[field] === '' ? '0' : priceState.prices[field])
  /* `dash` marks a row that is excluded from the total; `muted` keeps a genuine zero (no prices filled in yet) visually quiet instead of hiding it. */
  const costAmountCell = (value, { dash = false, muted = false } = {}) => h('td', { className: 'dsh-ws-token-money', ...(muted ? { 'data-zero': true } : {}) }, dash ? '—' : fmtMoney(value, priceState.currency))
  const costSection = costRows.length === 0 ? null : h('div', { className: 'dsh-ws-token-cost' },
    h('div', { className: 'dsh-ws-token-cost-head' },
      h('span', { className: 'dsh-ws-token-cost-title' }, translate('tokens.cost.title')),
      h('span', { className: 'dsh-ws-token-cost-sub' }, translate('tokens.cost.sub', { n: fmtCount(costIncluded.length), amount: fmtMoney(costTotal, priceState.currency) })),
      h('button', { className: 'dsh-ws-text-button', onClick: () => setCostCollapsed(value => !value), type: 'button' },
        costCollapsed ? translate('tokens.cost.expand') : translate('tokens.cost.collapse'))),
    costCollapsed ? null : h(Fragment, null,
      /* One bordered chip per default price: each label stays glued to its own input, so which box belongs to which price is unmistakable. */
      h('div', { className: 'dsh-ws-token-prices' },
        h('span', { className: 'dsh-ws-token-price-group' },
          h('label', { className: 'dsh-ws-token-price-label', htmlFor: 'dsh-ws-token-currency' }, translate('tokens.cost.currencyShort')),
          h('input', {
            'aria-label': translate('tokens.cost.currency'),
            className: 'dsh-ws-token-price-input dsh-ws-token-price-cur',
            id: 'dsh-ws-token-currency',
            maxLength: TOKEN_CURRENCY_MAX_LENGTH,
            onChange: event => setCurrency(event.target.value),
            spellCheck: false,
            type: 'text',
            value: priceState.currency,
          })),
        TOKEN_PRICE_FIELDS.map(field => h('span', { className: 'dsh-ws-token-price-group', key: field },
          h('label', { className: 'dsh-ws-token-price-label', htmlFor: `dsh-ws-token-price-${field}` }, translate(`tokens.col.${field}`)),
          priceInput({
            ariaLabel: translate(`tokens.col.${field}`),
            id: `dsh-ws-token-price-${field}`,
            onChange: text => setDefaultPrice(field, text),
            value: priceState.prices[field] ?? '',
          }))),
        h('span', { className: 'dsh-ws-token-price-unit' }, translate('tokens.cost.unit'))),
      h('div', { className: 'dsh-ws-token-table-wrap' },
        h('table', { className: 'dsh-ws-token-table dsh-ws-token-cost-table' },
          h('thead', null, h('tr', null,
            h('th', { className: 'dsh-ws-token-model' }, translate('tokens.col.model')),
            TOKEN_PRICE_FIELDS.map(field => h('th', { key: `token-${field}` }, translate(`tokens.col.${field}`))),
            h('th', null, translate('tokens.cost.amount')))),
          /* One <tbody> per model: the token/money line and, only when revealed, the price line. Five columns total, so this table never needs a horizontal scrollbar, and hovering a model highlights both of its lines. */
          costRows.map(row => {
            const key = costKeyOf(row)
            const override = priceState.overrides[key] ?? {}
            const overridden = TOKEN_PRICE_FIELDS.some(field => override[field] !== undefined)
            /* A row with its own prices stays open for good (the prices are persisted, so it must stay reachable); every other row opens on click only. */
            const priceRowOpen = overridden || openPriceRows.has(key)
            const off = costExcluded(row)
            const rowToggleLabel = translate(priceRowOpen ? 'tokens.cost.rowCollapse' : 'tokens.cost.rowExpand')
            return h('tbody', { 'data-open': priceRowOpen ? 'true' : undefined, className: off ? 'dsh-ws-token-dim' : undefined, key },
              h('tr', {
                className: 'dsh-ws-token-cost-row',
                ...(overridden ? { 'data-locked': 'true' } : { onClick: () => togglePriceRow(key) }),
                ...(overridden ? {} : { title: rowToggleLabel }),
              },
                h('td', { className: 'dsh-ws-token-model' },
                  h('button', {
                    'aria-expanded': priceRowOpen,
                    'aria-label': rowToggleLabel,
                    className: 'dsh-ws-token-cost-toggle',
                    disabled: overridden,
                    onClick: event => { event.stopPropagation(); togglePriceRow(key) },
                    title: rowToggleLabel,
                    type: 'button',
                  }, priceRowOpen ? '▾' : '▸'),
                  `${row.provider}/${row.model}`),
                TOKEN_PRICE_FIELDS.map(field => h('td', { key: `token-${field}` }, fmtCount(row[field]))),
                costAmountCell(costOf(row), { dash: off, muted: off || costOf(row) === 0 })),
              priceRowOpen ? h('tr', { className: 'dsh-ws-token-cost-prices' },
                /* One cell per token column, so each override box sits exactly under the number it prices (right edges line up). The first cell carries the 单价 legend, the last one the per-row clear button. */
                h('td', { className: 'dsh-ws-token-cost-pricelegend' }, translate('tokens.cost.price')),
                TOKEN_PRICE_FIELDS.map(field => h('td', { key: field },
                  priceInput({
                    ariaLabel: `${row.provider}/${row.model} ${translate(`tokens.col.${field}`)}${translate('tokens.cost.priceSuffix')}`,
                    onChange: text => setRowPrice(key, field, text),
                    placeholder: defaultPricePlaceholder(field),
                    title: translate('tokens.cost.overrideHint'),
                    value: override[field] ?? '',
                  }))),
                h('td', null,
                  overridden ? h('button', {
                    'aria-label': translate('tokens.cost.clearRow'),
                    className: 'dsh-ws-token-override-clear',
                    onClick: () => clearRowPrices(key),
                    title: translate('tokens.cost.clearRow'),
                    type: 'button',
                  }, '↺') : null)) : null)
          }),
          h('tbody', { key: 'total' },
            h('tr', { className: 'dsh-ws-token-total-row' },
              h('td', { className: 'dsh-ws-token-model' }, translate('tokens.cost.totalRow')),
              TOKEN_PRICE_FIELDS.map(field => h('td', { key: `token-${field}` }, fmtCount(costIncluded.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)))),
              costAmountCell(costTotal, { muted: costTotal === 0 }))))),
      h('div', { className: 'dsh-ws-token-cost-note' }, translate('tokens.cost.formula'))))
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
  return h(Modal, {
    /* No footer buttons: the close button, the backdrop and Escape are its ways out. Its own foot line sits */
    /* outside the scrolling body, so it travels as the foot slot. */
    bodyClassName: 'dsh-ws-token-body',
    className: 'dsh-ws-token-dialog',
    onCancel: onClose,
    title: translate('tokens.dialog.title'),
    foot: h('div', { className: 'dsh-ws-token-foot' },
    warmingLine === null ? null : h('div', { className: 'dsh-ws-token-warming' }, warmingLine),
    failedLine === null ? null : h('div', { className: 'dsh-ws-token-failed' }, failedLine),
    h('div', null, rangeLine),
    h('div', null, translate('tokens.hint'))),
  },
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
        filterActive ? h('div', { className: 'dsh-ws-token-filter' },
          h('label', { className: 'dsh-ws-settings-label', htmlFor: 'dsh-ws-token-filter' }, translate('tokens.filter')),
          h('div', { className: 'dsh-ws-token-filter-field' },
            h('input', {
              'aria-label': translate('tokens.filter'),
              autoComplete: 'off',
              className: 'dsh-ws-search-input',
              id: 'dsh-ws-token-filter',
              onChange: e => setFilterQuery(e.target.value),
              onKeyDown: e => {
                /* IME composition must never be read as a command (same guard as every other text input in this plugin). */
                if (e.isComposing) return
                /* A non-empty filter swallows Escape (clear it) instead of letting the window-level handler close the dialog. */
                if (e.key !== 'Escape' || filterQuery === '') return
                e.preventDefault()
                e.stopPropagation()
                setFilterQuery('')
              },
              placeholder: translate('tokens.filter.placeholder'),
              spellCheck: false,
              type: 'text',
              value: filterQuery,
            }),
            filterQuery === '' ? null : h('button', {
              'aria-label': translate('tokens.filter.clear'),
              className: 'dsh-ws-icon-button dsh-ws-token-filter-clear',
              onClick: () => setFilterQuery(''),
              title: translate('tokens.filter.clear'),
              type: 'button',
            }, '×')),
          h('span', { 'aria-live': 'polite', className: 'dsh-ws-token-filter-count' },
            terms.length === 0
              ? translate('tokens.filter.count', { n: fmtCount(rows.length) })
              : translate('tokens.filter.countFiltered', { shown: fmtCount(filteredRows.length), total: fmtCount(rows.length) }))) : null,
        content,
          costSection
  )
}