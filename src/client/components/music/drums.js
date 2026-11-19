/* Drum machine for one drum-instrument track: 16 steps × 6 lanes for the selected bar,
 * plus the groove controls that shape playback (swing / humanize are read by the synth on
 * every pass). Pressing and dragging paints steps on/off, mirroring the piano roll's stroke. */
import { createElement as h, useRef } from 'react'
import { translate } from '../../locale/index.js'
import { MUSIC_DRUM_IDS, MUSIC_STEPS_PER_BAR } from '../../../shared/music-score.js'

const LANE_LABEL_KEYS = {
  kick: 'music.drum.kick',
  snare: 'music.drum.snare',
  hat: 'music.drum.hat',
  open: 'music.drum.open',
  clap: 'music.drum.clap',
  perc: 'music.drum.perc',
}

export function DrumMachine({ activeBar, bars, humanize, onActiveBar, onChange, onToggle, onVary, swing, track }) {
  const paintRef = useRef(null)
  const barIndex = Math.max(0, Math.min(bars - 1, activeBar - 1))
  const stepsOf = lane => track.drums?.[lane]?.[barIndex] ?? {}

  const startPaint = (event, lane, step, on) => {
    if (event.button !== 0) return
    event.preventDefault()
    paintRef.current = { lane, value: !on }
    onToggle(lane, barIndex, step)
  }
  const paintOver = (event, lane, step, on) => {
    const paint = paintRef.current
    if (paint === null || paint.lane !== lane) return
    if (on === paint.value) return
    onToggle(lane, barIndex, step)
  }
  const endPaint = () => { paintRef.current = null }

  return h('div', { className: 'dsh-ws-music-drums', onPointerCancel: endPaint, onPointerLeave: endPaint, onPointerUp: endPaint },
    h('div', { className: 'dsh-ws-music-drums-head' },
      h('div', { className: 'dsh-ws-music-bar-tabs', role: 'tablist', 'aria-label': translate('music.drums.bars') },
        Array.from({ length: bars }, (_, index) => h('button', {
          'aria-selected': activeBar === index + 1,
          className: 'dsh-ws-music-bar-tab',
          'data-active': activeBar === index + 1 || undefined,
          key: index,
          onClick: () => onActiveBar(index + 1),
          role: 'tab',
          type: 'button',
        }, String(index + 1)))),
      h('span', { className: 'dsh-ws-music-spacer' }),
      h('button', { className: 'dsh-ws-music-mini-button', onClick: onVary, type: 'button' }, translate('music.drums.vary'))),
    h('div', { className: 'dsh-ws-music-drum-scroll' },
      h('div', { className: 'dsh-ws-music-drum-grid' },
        h('span', { 'aria-hidden': true, key: 'beat-spacer' }),
        Array.from({ length: MUSIC_STEPS_PER_BAR }, (_, step) => h('span', {
          'aria-hidden': true,
          className: 'dsh-ws-music-drum-beat',
          'data-beat-start': step % 4 === 0 || undefined,
          key: step,
        }, step % 4 === 0 ? String(step / 4 + 1) : '')),
        MUSIC_DRUM_IDS.map(lane => {
          const steps = stepsOf(lane)
          return [
            h('div', { className: 'dsh-ws-music-drum-label', key: `${lane}-label`, 'data-lane': lane },
              h('i', { 'aria-hidden': true }),
              h('span', null, translate(LANE_LABEL_KEYS[lane]))),
            ...Array.from({ length: MUSIC_STEPS_PER_BAR }, (_, step) => {
              const velocity = steps[String(step)]
              const on = velocity !== undefined
              return h('button', {
                'aria-label': `${translate(LANE_LABEL_KEYS[lane])} ${step + 1}`,
                'aria-pressed': on,
                className: 'dsh-ws-music-drum-step',
                'data-lane': lane,
                'data-on': on || undefined,
                'data-step': step,
                key: `${lane}-${step}`,
                onPointerDown: event => startPaint(event, lane, step, on),
                onPointerEnter: event => paintOver(event, lane, step, on),
                style: velocity === undefined ? undefined : { '--dsh-ws-music-vel': String(Math.min(1, velocity / 127)) },
                type: 'button',
              })
            }),
          ]
        }),
      ),
    ),
    h('div', { className: 'dsh-ws-music-groove' },
      h('label', { className: 'dsh-ws-music-slider' },
        h('span', null, translate('music.drums.swing')),
        h('input', {
          'aria-label': translate('music.drums.swing'),
          max: 75,
          min: 0,
          onChange: event => onChange({ swing: Number(event.target.value) / 100 }),
          type: 'range',
          value: Math.round(swing * 100),
        }),
        h('b', null, `${Math.round(swing * 100)}%`)),
      h('label', { className: 'dsh-ws-music-slider' },
        h('span', null, translate('music.drums.humanize')),
        h('input', {
          'aria-label': translate('music.drums.humanize'),
          max: 40,
          min: 0,
          onChange: event => onChange({ humanize: Number(event.target.value) / 100 }),
          type: 'range',
          value: Math.round(humanize * 100),
        }),
        h('b', null, `${Math.round(humanize * 100)}%`)),
    ),
  )
}
