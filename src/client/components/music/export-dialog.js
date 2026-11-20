/* Export dialog for the music workshop.
 *
 *  The panel only edits the choice: the dialog encodes the current score (offline WAV, SMF MIDI
 *  or the v3 score JSON), uploads the bytes to `POST /music/export`, and turns the Host's 409
 *  into the explicit 「覆盖导出」 step. Paths are workspace-relative like the save dialog: the
 *  Host's trust fence is the only place a file can land, on Web and Desktop alike.
 */
import { createElement as h, useMemo, useRef, useState } from 'react'
import { translate, useLocaleText } from '../../locale/index.js'
import { musicNoteCount, scoreSeconds } from '../../../shared/music-score.js'
import {
  MUSIC_EXPORT_WAV_CHANNELS,
  MUSIC_EXPORT_WAV_DEPTHS,
  MUSIC_EXPORT_WAV_RATES,
  musicExportExtension,
  musicExportFileName,
  stripMusicExportExtension,
} from '../../../shared/music-export.js'
import { Modal } from '../dialogs.js'
import { estimateMusicExportBytes } from './export-render.js'
import { isMusicExportExists, musicExportStages, runMusicExport } from './export-run.js'

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value >= 1000) return `${Math.round(value / 1000)} KB`
  return `${Math.round(value)} B`
}

function Segmented({ label, onChange, options, value }) {
  return h('div', { className: 'dsh-ws-music-export-row' },
    h('span', { className: 'dsh-ws-music-export-name' }, label),
    h('span', { className: 'dsh-ws-music-export-pills' }, options.map(option => h('button', {
      'aria-pressed': option.value === value,
      className: 'dsh-ws-music-export-pill',
      key: String(option.value),
      onClick: () => onChange(option.value),
      type: 'button',
    }, option.label))))
}

export function MusicExportDialog({
  defaultDir,
  defaultName,
  doc,
  onCancel,
  onDone,
  onPrefs,
  prefs,
  workspaceId,
}) {
  useLocaleText()
  const [settings, setSettings] = useState(prefs)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [dir, setDir] = useState(defaultDir)
  const [name, setName] = useState(() => stripMusicExportExtension(defaultName, prefs.format))
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(null)
  const [error, setError] = useState(null)
  const [exists, setExists] = useState(false)

  const update = (patch) => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    onPrefs?.(next)
  }
  const change = (patch) => {
    setExists(false)
    setError(null)
    update(patch)
  }

  const format = settings.format
  const extension = musicExportExtension(format)
  const fileName = musicExportFileName(format, name)
  const trimmedDir = dir.trim().replace(/^\/+|\/+$/g, '')
  const fullPath = fileName === '' ? '—' : (trimmedDir === '' ? fileName : `${trimmedDir}/${fileName}`)
  const seconds = useMemo(() => scoreSeconds(doc), [doc])
  const events = useMemo(() => musicNoteCount(doc), [doc])
  const estimate = useMemo(() => estimateMusicExportBytes(doc, format, settings.wav), [doc, format, settings.wav])
  const empty = events === 0

  const formats = [
    { label: translate('music.export.wav'), description: translate('music.export.wav.desc'), format: 'wav', extension: '.wav' },
    { label: translate('music.export.midi'), description: translate('music.export.midi.desc'), format: 'midi', extension: '.mid' },
    { label: translate('music.export.json'), description: translate('music.export.json.desc'), format: 'json', extension: '.music.json' },
  ]
  const stages = musicExportStages(format)
  const activeStage = stage === null ? 0 : Math.max(0, stages.indexOf(stage))
  const formatLabel = translate(`music.export.${format}`)

  const run = async (overwrite) => {
    if (busy || fileName === '') return
    setBusy(true)
    setError(null)
    setStage(stages[0])
    try {
      const result = await runMusicExport({
        doc,
        dir: trimmedDir,
        name,
        onStage: setStage,
        overwrite,
        settings: settingsRef.current,
        workspaceId,
      })
      onDone?.(result)
    } catch (failure) {
      if (isMusicExportExists(failure)) {
        setExists(true)
        setError(translate('music.export.exists', { path: fullPath }))
      } else {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
      setBusy(false)
      setStage(null)
    }
  }

  const fields = [
    h('div', { className: 'dsh-ws-music-export-label', key: 'location' },
      translate('music.export.location'),
      h('span', null, translate('music.export.locationHint'))),
    h('label', { className: 'dsh-ws-music-export-field', key: 'dir' },
      h('span', null, translate('music.export.dir')),
      h('input', {
        className: 'dsh-ws-dialog-input',
        disabled: busy,
        onChange: (event) => { setExists(false); setError(null); setDir(event.target.value) },
        spellCheck: false,
        type: 'text',
        value: dir,
      })),
    h('label', { className: 'dsh-ws-music-export-field', key: 'name' },
      h('span', null, translate('music.export.name')),
      h('span', { className: 'dsh-ws-music-export-namewrap' },
        h('input', {
          className: 'dsh-ws-dialog-input',
          disabled: busy,
          onChange: (event) => { setExists(false); setError(null); setName(event.target.value) },
          spellCheck: false,
          type: 'text',
          value: name,
        }),
        h('span', { className: 'dsh-ws-music-export-suffix' }, extension))),
    h('p', { className: 'dsh-ws-music-dialog-path', key: 'path' },
      `${translate('music.export.path')} · ${fullPath}`),
    h('div', { className: 'dsh-ws-music-export-meta', key: 'estimate' },
      h('span', { className: 'dsh-ws-music-export-estimate' }, translate('music.export.estimate', { size: formatBytes(estimate) })),
      h('span', null, translate('music.export.usesCurrent'))),
  ]

  const params = []
  if (format === 'wav') {
    params.push(h(Segmented, {
      key: 'rate',
      label: translate('music.export.rate'),
      onChange: value => change({ wav: { ...settings.wav, rate: value } }),
      options: MUSIC_EXPORT_WAV_RATES.map(rate => ({ label: `${rate / 1000} kHz`, value: rate })),
      value: settings.wav.rate,
    }))
    params.push(h(Segmented, {
      key: 'depth',
      label: translate('music.export.depth'),
      onChange: value => change({ wav: { ...settings.wav, depth: value } }),
      options: MUSIC_EXPORT_WAV_DEPTHS.map(depth => ({ label: `${depth} bit`, value: depth })),
      value: settings.wav.depth,
    }))
    params.push(h(Segmented, {
      key: 'channels',
      label: translate('music.export.channels'),
      onChange: value => change({ wav: { ...settings.wav, channels: value } }),
      options: MUSIC_EXPORT_WAV_CHANNELS.map(channels => ({ label: translate(channels === 1 ? 'music.export.mono' : 'music.export.stereo'), value: channels })),
      value: settings.wav.channels,
    }))
  } else if (format === 'midi') {
    params.push(h(Segmented, {
      key: 'swing',
      label: translate('music.export.midiSwing'),
      onChange: value => change({ midi: { ...settings.midi, swing: value } }),
      options: [
        { label: translate('music.export.midiSwing.bake'), value: 'bake' },
        { label: translate('music.export.midiSwing.grid'), value: 'grid' },
      ],
      value: settings.midi.swing,
    }))
    params.push(h(Segmented, {
      key: 'drums',
      label: translate('music.export.midiDrums'),
      onChange: value => change({ midi: { ...settings.midi, drums: value } }),
      options: [
        { label: translate('music.export.midiDrums.gm'), value: 'gm' },
        { label: translate('music.export.midiDrums.track'), value: 'track' },
      ],
      value: settings.midi.drums,
    }))
  } else {
    params.push(h(Segmented, {
      key: 'prompt',
      label: translate('music.export.jsonPrompt'),
      onChange: value => change({ json: { prompt: value } }),
      options: [
        { label: translate('music.export.jsonPrompt.on'), value: true },
        { label: translate('music.export.jsonPrompt.off'), value: false },
      ],
      value: settings.json.prompt,
    }))
  }

  const hintKey = `music.export.hint.${format}`

  return h(Modal, {
    actions: [
      { key: 'cancel', label: translate('dialog.cancel'), onClick: onCancel, disabled: busy },
      {
        key: 'export',
        label: busy
          ? translate('music.export.running')
          : (exists ? translate('music.export.overwrite') : translate('music.export.confirm')),
        onClick: () => { if (!busy) void run(exists) },
        disabled: busy || fileName === '',
      },
    ],
    busy,
    className: 'dsh-ws-music-export-dialog',
    onCancel,
    title: translate('music.export.title'),
  },
  h('div', { className: 'dsh-ws-music-export-summary' },
    h('b', null, doc.title),
    h('div', { className: 'dsh-ws-music-export-meta' },
      h('span', null, `${doc.bars} ${translate('music.barsUnit')}`),
      h('span', null, `${doc.bpm} BPM`),
      h('span', null, translate(doc.keyMode === 'minor' ? 'music.export.keyMinor' : 'music.export.keyMajor', { root: doc.keyRoot })),
      h('span', null, `${Math.round(seconds)} ${translate('music.duration.unit')}`),
      h('span', null, translate('music.status.tracks', { count: String(doc.tracks.length) })),
      h('span', null, translate('music.status.notes', { count: events })))),
  busy
    ? h('div', { className: 'dsh-ws-music-export-busy' },
      h('div', { className: 'dsh-ws-music-export-steps' }, stages.map((id, index) => h('div', {
        className: `dsh-ws-music-export-step${index < activeStage ? ' dsh-ws-music-export-step-done' : index === activeStage ? ' dsh-ws-music-export-step-active' : ''}`,
        key: id,
      },
      h('span', { className: 'dsh-ws-music-export-step-dot' }, index < activeStage ? '✓' : String(index + 1)),
      h('span', { className: 'dsh-ws-music-export-step-name' }, translate(`music.export.stage.${id}`))))),
      h('p', { className: 'dsh-ws-music-dialog-hint' },
        format === 'wav'
          ? translate('music.export.busyAudio', { format: formatLabel, seconds: Math.round(seconds) })
          : translate('music.export.busyFile', { path: fullPath })),
      h('p', { className: 'dsh-ws-music-dialog-hint' }, translate('music.export.busyHint')))
    : h('div', { className: 'dsh-ws-music-export-form' },
      h('div', { className: 'dsh-ws-music-export-label' },
        translate('music.export.format'),
        h('span', null, translate('music.export.formatHint'))),
      h('div', { className: 'dsh-ws-music-export-formats' }, formats.map(entry => h('button', {
        'aria-pressed': entry.format === format,
        className: 'dsh-ws-music-export-format',
        key: entry.format,
        onClick: () => change({ format: entry.format }),
        type: 'button',
      },
      h('span', { className: 'dsh-ws-music-export-badge' }, entry.format.toUpperCase()),
      h('span', { className: 'dsh-ws-music-export-format-text' },
        h('span', { className: 'dsh-ws-music-export-format-name' }, entry.label),
        h('span', { className: 'dsh-ws-music-export-format-desc' }, entry.description)),
      h('span', { className: 'dsh-ws-music-export-ext' }, entry.extension)))),
      h('div', { className: 'dsh-ws-music-export-params' }, params),
      fields,
      empty ? h('p', { className: 'dsh-ws-music-export-warn' }, translate('music.export.empty')) : null,
      error === null ? null : h('div', { className: 'dsh-ws-dialog-error', role: 'alert' }, error),
      h('p', { className: 'dsh-ws-music-dialog-hint' }, translate(hintKey)))
  )
}
