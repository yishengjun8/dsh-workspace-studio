/* The client-side instrument palette: localized labels live in the locale files, the
 * stable ids/colors/kinds in the shared score model. One catalogue entry per instrument. */
import { createElement as h } from 'react'
import { MUSIC_INSTRUMENTS, MUSIC_INSTRUMENT_IDS } from '../../../shared/music-score.js'
import { translate } from '../../locale/index.js'

export const INSTRUMENT_CATEGORIES = Object.freeze(['all', 'keys', 'plucked', 'bowed', 'winds', 'percussion'])

const CATALOG = Object.freeze({
  piano: { cat: 'keys', icon: 'keys' },
  epiano: { cat: 'keys', icon: 'keys' },
  organ: { cat: 'keys', icon: 'keys' },
  harpsichord: { cat: 'keys', icon: 'keys' },
  harp: { cat: 'plucked', icon: 'string' },
  strumstick: { cat: 'plucked', icon: 'guitar' },
  psaltery: { cat: 'bowed', icon: 'string' },
  sax: { cat: 'winds', icon: 'wave' },
  recorder: { cat: 'winds', icon: 'wave' },
  glockenspiel: { cat: 'percussion', icon: 'bell' },
  timpani: { cat: 'percussion', icon: 'drum' },
  drums: { cat: 'percussion', icon: 'drum' },
})

const GLYPHS = {
  wave: 'M1.8 8c1.6-5 3.2 5 4.8 0s3.2 5 4.8 0 2.4 2.5 2.8.6',
  keys: 'M2.6 3.4h10.8v9.2H2.6zM5.2 3.4v5.4M8 3.4v5.4M10.8 3.4v5.4M2.6 8.8h10.8',
  guitar: 'M10.2 2.4 13.6 5.8M9 3.6l3.4 3.4M8.4 5.4 5.6 8.2c-1.1 1.1-1 2.6.1 3.7 1.1 1.1 2.6 1.2 3.7.1l2.8-2.8',
  drum: 'M3 5.4c0-1.2 2.3-2.2 5-2.2s5 1 5 2.2M3 5.4v4.4c0 1.2 2.3 2.2 5 2.2s5-1 5-2.2V5.4M3 5.4c0 1.2 2.3 2.2 5 2.2s5-1 5-2.2',
  string: 'M3.2 2.8v10.4M8 2.8v10.4M12.8 2.8v10.4M2.4 6.4h11.2M2.4 9.6h11.2',
  bell: 'M8 2.2c2.2 0 3.6 1.6 3.6 3.8v3.2l1.1 1.6H3.3l1.1-1.6V6c0-2.2 1.4-3.8 3.6-3.8zM6.4 12.4a1.7 1.7 0 0 0 3.2 0',
}

export function instrumentInfo(id) {
  const key = MUSIC_INSTRUMENT_IDS.includes(id) ? id : 'piano'
  const base = MUSIC_INSTRUMENTS[key]
  const entry = CATALOG[key] ?? CATALOG.piano
  return {
    id: key,
    kind: base.kind,
    color: base.color,
    cat: entry.cat,
    icon: entry.icon,
    nameKey: `music.inst.${key}`,
    descKey: `music.inst.${key}.desc`,
  }
}

export function instrumentGlyph(icon, size = 13) {
  return h('svg', { 'aria-hidden': true, height: size, viewBox: '0 0 16 16', width: size },
    h('path', {
      d: GLYPHS[icon] ?? GLYPHS.wave,
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.2,
    }))
}

export const INSTRUMENT_LIST = Object.freeze(MUSIC_INSTRUMENT_IDS.map(id => instrumentInfo(id)))

/** Display name of a track: its own name, or the instrument's arrangement role. */
export function trackDisplayName(track) {
  if (track === null || track === undefined) return ''
  return typeof track.name === 'string' && track.name.trim() !== '' ? track.name : translate(`music.role.${track.instrument}`)
}

