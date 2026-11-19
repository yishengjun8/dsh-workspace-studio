/* Settings card: console-command file permissions.
 *
 * The card edits HOST-side settings (not the plugin's localStorage settings store): the pre-execute
 * gate runs in the Host and needs the same answer on both ends, including after a restart. The model
 * picker is a separate, independent configuration from the mind-map summary model.
 */
import { createElement as h, useState } from 'react'
import { translate } from '../locale/index.js'
import { useMindmapSummaryModels } from '../hooks/mindmap-summary-models.js'
import {
  clearAllPermissions,
  clearPermissionAnalysisCache,
  refreshPermissionConfig,
  savePermissionSettings,
  usePermissionConfig,
} from '../permission-store.js'
import { Card, Row, Section, SliderRow, SwitchRow } from './settings-rows.js'
import { Modal } from './dialogs.js'

function modelValue(model) {
  return model === null || model === undefined || typeof model.provider !== 'string' || typeof model.model !== 'string'
    ? 'session'
    : `${model.provider}/${model.model}`
}

export function CommandPermissionCard() {
  const config = usePermissionConfig()
  const models = useMindmapSummaryModels()
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState(undefined)
  const [notice, setNotice] = useState(undefined)
  const [confirmClear, setConfirmClear] = useState(false)
  const settings = config.value?.settings ?? null
  const modelOptions = models !== null && models?.available === true && Array.isArray(models?.models) ? models.models : []

  const update = async (patch, key) => {
    setSaving(key)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await savePermissionSettings(patch)
      if (result === undefined) throw new Error(translate('settings.permissions.saveFailed'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(null)
    }
  }
  const clearCache = async () => {
    setSaving('cache')
    setError(undefined)
    setNotice(undefined)
    try {
      await clearPermissionAnalysisCache()
      setNotice(translate('settings.permissions.ai.cache.cleared'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(null)
    }
  }
  const clearRecords = async () => {
    setConfirmClear(false)
    setSaving('records')
    setError(undefined)
    setNotice(undefined)
    try {
      await clearAllPermissions()
      setNotice(translate('settings.permissions.clearAll.done'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(null)
    }
  }

  if (settings === null) {
    return h(Card, {
      id: 'permissions',
      title: translate('settings.group.permissions'),
      notes: ['settings.notes.permissions.1', 'settings.notes.permissions.2', 'settings.notes.permissions.3'],
    },
    h(Row, {
      label: translate('settings.permissions.loading'),
      reset: null,
      control: h('button', {
        className: 'dsh-ws-text-button',
        onClick: () => { void refreshPermissionConfig() },
        type: 'button',
      }, translate('permissions.retry')),
    }))
  }

  const depth = Number.isSafeInteger(settings.maxDepth) ? settings.maxDepth : 3
  const aiOn = settings.aiAnalysis === true
  const model = settings.model ?? null
  const modelAvailable = modelOptions.length > 0
  const selectedModel = modelValue(model)

  return h(Card, {
    id: 'permissions',
    title: translate('settings.group.permissions'),
    notes: ['settings.notes.permissions.1', 'settings.notes.permissions.2', 'settings.notes.permissions.3'],
  },
  h(SwitchRow, {
    label: translate('settings.permissions.enabled'),
    hint: translate('settings.permissions.enabled.desc'),
    checked: settings.enabled === true,
    onChange: value => { void update({ enabled: value }, 'enabled') },
    resetTitle: translate('settings.resetDefault'),
    onReset: () => { void update({ enabled: true }, 'enabled') },
    custom: settings.enabled !== true,
  }),
  h(SwitchRow, {
    label: translate('settings.permissions.scriptAnalysis'),
    hint: translate('settings.permissions.scriptAnalysis.desc'),
    checked: settings.scriptAnalysis === true,
    onChange: value => { void update({ scriptAnalysis: value }, 'script') },
    resetTitle: translate('settings.resetDefault'),
    onReset: () => { void update({ scriptAnalysis: true }, 'script') },
    custom: settings.scriptAnalysis !== true,
  }),
  h(Section, { label: translate('settings.permissions.ai') },
    h(SwitchRow, {
      label: translate('settings.permissions.ai.enabled'),
      hint: translate('settings.permissions.ai.desc'),
      checked: aiOn,
      onChange: value => { void update({ aiAnalysis: value }, 'ai') },
      resetTitle: translate('settings.resetDefault'),
      onReset: () => { void update({ aiAnalysis: true }, 'ai') },
      custom: aiOn !== true,
    }),
    h(Row, {
      label: translate('settings.permissions.ai.model'),
      note: translate('settings.permissions.ai.privacy'),
      reset: null,
      control: modelAvailable
        ? h('select', {
          'aria-label': translate('settings.permissions.ai.model'),
          className: 'dsh-ws-select',
          onChange: (event) => {
            const raw = event.target.value
            if (raw === 'session') { void update({ model: null }, 'model'); return }
            const hit = modelOptions.find(entry => `${entry.provider}/${entry.model}` === raw)
            if (hit !== undefined) void update({ model: { provider: hit.provider, model: hit.model } }, 'model')
          },
          value: modelOptions.some(entry => `${entry.provider}/${entry.model}` === selectedModel) ? selectedModel : 'session',
        },
        h('option', { value: 'session' }, translate('settings.permissions.ai.model.session')),
        ...modelOptions.map(entry => h('option', { key: `${entry.provider}/${entry.model}`, value: `${entry.provider}/${entry.model}` }, `${entry.name} — ${entry.provider}`)))
        : h('span', { className: 'dsh-ws-value' }, translate('settings.permissions.ai.model.missing')),
    }),
    h(SliderRow, {
      label: translate('settings.permissions.ai.depth'),
      min: 1,
      max: 5,
      step: 1,
      value: depth,
      unit: translate('settings.permissions.ai.depth.value', { n: String(depth) }),
      disabled: settings.scriptAnalysis !== true,
      onChange: value => { void update({ maxDepth: value }, 'depth') },
      resetTitle: translate('settings.resetDefault'),
      onReset: () => { void update({ maxDepth: 3 }, 'depth') },
      custom: depth !== 3,
    }),
    h(SwitchRow, {
      label: translate('settings.permissions.ai.cache'),
      hint: translate('settings.permissions.ai.cache.desc'),
      checked: settings.aiCache === true,
      onChange: value => { void update({ aiCache: value }, 'cache') },
      resetTitle: translate('settings.resetDefault'),
      onReset: () => { void update({ aiCache: true }, 'cache') },
      custom: settings.aiCache !== true,
    }),
    h(Row, {
      label: translate('settings.permissions.ai.cache.clear'),
      reset: null,
      control: h('button', {
        className: 'dsh-ws-text-button',
        disabled: saving !== null,
        onClick: () => { void clearCache() },
        type: 'button',
      }, translate('settings.permissions.ai.cache.clear')),
    })),
  h(Row, {
    label: translate('settings.permissions.clearAll'),
    note: translate('settings.permissions.clearAll.desc'),
    reset: null,
    control: h('button', {
      className: 'dsh-ws-text-button dsh-ws-danger-button',
      disabled: saving !== null,
      onClick: () => setConfirmClear(true),
      type: 'button',
    }, translate('settings.permissions.clearAll')),
  }),
  h(Row, {
    label: translate('settings.permissions.storage'),
    note: translate('settings.permissions.storage.desc'),
    reset: null,
    control: h('span', { className: 'dsh-ws-value', title: config.value?.cachePath }, config.value?.cachePath ?? ''),
  }),
  error === undefined ? null : h('div', { className: 'dsh-ws-dialog-error' }, error),
  notice === undefined ? null : h('div', { className: 'dsh-ws-row-note' }, notice),
  confirmClear
    ? h(Modal, {
      actions: [
        { key: 'cancel', label: translate('dialog.cancel'), onClick: () => setConfirmClear(false) },
        { key: 'clear', label: translate('settings.permissions.clearAll'), danger: true, onClick: () => { void clearRecords() } },
      ],
      onCancel: () => setConfirmClear(false),
      title: translate('settings.permissions.clearAll.confirm'),
    }, h('p', { className: 'dsh-ws-dialog-message' }, translate('settings.permissions.clearAll.message')))
    : null)
}
