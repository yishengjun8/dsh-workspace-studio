/* Offline encoders for the music workshop's export dialog.
 *
 *  WAV is rendered with an OfflineAudioContext using the same bundled VCSL samples, zone
 *  selection, swing/humanize and mix rules as live playback; MIDI is written as an SMF Type 1
 *  file from the score grid. Both return raw bytes, so the dialog only has to upload them.
 *
 *  The module never touches the network or the live sampler: loaders are injected by the caller,
 *  which also keeps the module importable outside a browser (the client module check evaluates
 *  every file with plain Node).
 */
import { MUSIC_STEPS_PER_BAR, scoreSeconds } from '../../../shared/music-score.js'

const PPQ = 480
const TICKS_PER_STEP = PPQ / (MUSIC_STEPS_PER_BAR / 4)
const DEFAULT_TAIL_SECONDS = 0.3

/* General MIDI programs for the palette ids (0-based). Drums are channel 10, not a program. */
const GM_PROGRAM = Object.freeze({
  epiano: 4,
  glockenspiel: 9,
  harpsichord: 6,
  harp: 46,
  organ: 19,
  piano: 0,
  psaltery: 45,
  recorder: 74,
  sax: 66,
  strumstick: 24,
  timpani: 47,
})
const DRUM_NOTE = Object.freeze({ clap: 39, hat: 42, kick: 36, open: 46, perc: 50, snare: 38 })

/* Key signature meta: sharps (+) / flats (-) per pitch class, major and minor. */
const MAJOR_SF = Object.freeze({ 0: 0, 1: 7, 2: 2, 3: -3, 4: 4, 5: -1, 6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5 })
const MINOR_SF = Object.freeze({ 0: -3, 1: 4, 2: -1, 3: 6, 4: 1, 5: -4, 6: 3, 7: -2, 8: 5, 9: 0, 10: 7, 11: 2 })
const KEY_ROOTS = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function noteEventsOf(track) {
  if (track?.kind === 'drums') {
    let count = 0
    for (const bars of Object.values(track.drums ?? {})) {
      for (const steps of Array.isArray(bars) ? bars : []) count += Object.keys(steps ?? {}).length
    }
    return count
  }
  return Array.isArray(track?.notes) ? track.notes.length : 0
}

function totalEventCount(doc) {
  let count = 0
  for (const track of doc?.tracks ?? []) count += noteEventsOf(track)
  return count
}

/** Rough output size for the dialog's "≈ 7.1 MB" readout (not an exact encoder count). */
export function estimateMusicExportBytes(doc, format, options = {}) {
  const seconds = scoreSeconds(doc) + DEFAULT_TAIL_SECONDS
  if (format === 'wav') {
    const rate = options.rate === 48000 ? 48000 : 44100
    const depth = options.depth === 24 ? 24 : 16
    const channels = options.channels === 1 ? 1 : 2
    return Math.ceil(rate * (depth / 8) * channels * seconds) + 44
  }
  if (format === 'midi') return 1024 + totalEventCount(doc) * 5
  return 2048 + totalEventCount(doc) * 36
}

/* ── WAV ─────────────────────────────────────────────────────────────────────── */

function sampleFilesOf(entry) {
  const files = []
  for (const zone of Array.isArray(entry?.zones) ? entry.zones : []) {
    if (typeof zone.file === 'string') files.push(zone.file)
  }
  for (const variants of Object.values(entry?.lanes ?? {})) {
    for (const variant of Array.isArray(variants) ? variants : []) {
      if (typeof variant.file === 'string') files.push(variant.file)
    }
  }
  return files
}

function peakOfBuffer(buffer) {
  let peak = 0
  const channels = typeof buffer?.numberOfChannels === 'number' ? buffer.numberOfChannels : 1
  for (let channel = 0; channel < channels; channel += 1) {
    const data = typeof buffer?.getChannelData === 'function' ? buffer.getChannelData(channel) : null
    if (data === null) continue
    for (let index = 0; index < data.length; index += 1) {
      const value = Math.abs(data[index])
      if (value > peak) peak = value
    }
  }
  return peak
}

/* The live sampler normalizes each instrument up to a median zone level; the export reuses the
   same rule so the rendered file matches what the transport plays. */
function instrumentTrimsOf(manifest, peaks) {
  const trims = new Map()
  for (const [id, entry] of Object.entries(manifest?.instruments ?? {})) {
    const levels = []
    for (const zone of Array.isArray(entry?.zones) ? entry.zones : []) {
      const peak = peaks.get(zone.file)
      if (peak === undefined || peak <= 0) continue
      levels.push(peak * (zone.gain ?? 0.8))
    }
    if (levels.length === 0) {
      trims.set(id, 1)
      continue
    }
    levels.sort((left, right) => left - right)
    const median = levels[Math.floor(levels.length / 2)]
    trims.set(id, median <= 0 ? 1 : Math.min(32, Math.max(1, 0.12 / median)))
  }
  return trims
}

function chooseZone(entry, midi) {
  let best = null
  for (const zone of Array.isArray(entry?.zones) ? entry.zones : []) {
    if (midi < zone.low || midi > zone.high) continue
    if (best === null || Math.abs(zone.root - midi) < Math.abs(best.root - midi)) best = zone
    if (zone.root === midi) return zone
  }
  if (best !== null) return best
  for (const zone of Array.isArray(entry?.zones) ? entry.zones : []) {
    if (best === null || Math.abs(zone.root - midi) < Math.abs(best.root - midi)) best = zone
  }
  return best
}

function buildStepEvents(doc) {
  const events = new Map()
  const push = (step, event) => {
    if (!events.has(step)) events.set(step, [])
    events.get(step).push(event)
  }
  for (const track of doc.tracks) {
    if (track.kind === 'drums') {
      for (const [lane, bars] of Object.entries(track.drums ?? {})) {
        if (!Array.isArray(bars)) continue
        bars.forEach((steps, barIndex) => {
          for (const [stepText, velocity] of Object.entries(steps ?? {})) {
            push(barIndex * MUSIC_STEPS_PER_BAR + Number(stepText), { kind: 'drum', lane, trackId: track.id, vel: velocity })
          }
        })
      }
      continue
    }
    for (const note of track.notes ?? []) {
      push((note.bar - 1) * MUSIC_STEPS_PER_BAR + note.step, { kind: 'note', len: note.len, midi: note.midi, trackId: track.id, vel: note.vel })
    }
  }
  return events
}

function scheduleBuffer(context, destination, buffer, when, holdSeconds, peak, rate, release, oneShot) {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = rate
  const gain = context.createGain()
  const hold = Math.max(0.03, oneShot ? Math.min(holdSeconds, buffer.duration) : holdSeconds)
  const tail = Math.min(Math.max(0.02, release), hold * 0.8)
  const end = when + hold
  const attackEnd = when + 0.006
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.linearRampToValueAtTime(Math.max(0.001, peak), attackEnd)
  gain.gain.setValueAtTime(Math.max(0.001, peak), Math.max(attackEnd, end - tail))
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  source.connect(gain)
  gain.connect(destination)
  source.start(when)
  source.stop(end + 0.02)
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}

function writeSample(view, offset, value, bitDepth) {
  const clamped = clamp(value, -1, 1)
  if (bitDepth === 16) {
    view.setInt16(offset, Math.round(clamped * 32767), true)
    return
  }
  const int = Math.round(clamped * 8388607)
  view.setUint8(offset, int & 0xff)
  view.setUint8(offset + 1, (int >> 8) & 0xff)
  view.setUint8(offset + 2, (int >> 16) & 0xff)
}

/** PCM WAV of a rendered AudioBuffer (interleaved, little-endian). */
export function encodeWavBuffer(buffer, bitDepth = 16, channels = 2) {
  const depth = bitDepth === 24 ? 24 : 16
  const outChannels = channels === 1 ? 1 : 2
  const frames = buffer.length
  const bytesPerSample = depth / 8
  const dataBytes = frames * outChannels * bytesPerSample
  const out = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(out)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, outChannels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * outChannels * bytesPerSample, true)
  view.setUint16(32, outChannels * bytesPerSample, true)
  view.setUint16(34, depth, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  let offset = 44
  for (let frame = 0; frame < frames; frame += 1) {
    const leftValue = left[frame] ?? 0
    if (outChannels === 1) {
      const mono = right === null ? leftValue : (leftValue + (right[frame] ?? 0)) / 2
      writeSample(view, offset, mono, depth)
    } else {
      writeSample(view, offset, leftValue, depth)
      writeSample(view, offset + bytesPerSample, right === null ? leftValue : (right[frame] ?? 0), depth)
    }
    offset += outChannels * bytesPerSample
  }
  return new Uint8Array(out)
}

/**
 * Render the score to WAV bytes.
 * @param options { rate?: 44100|48000, depth?: 16|24, channels?: 1|2 }
 * @param deps { loadManifest, loadSample }
 * @param onStage stage callback: 'samples' | 'render' | 'encode'
 */
export async function renderMusicWav(doc, options, deps, onStage) {
  const rate = options?.rate === 48000 ? 48000 : 44100
  const depth = options?.depth === 24 ? 24 : 16
  const channels = options?.channels === 1 ? 1 : 2
  const Ctor = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext
  if (typeof Ctor !== 'function') throw new Error('当前环境不支持离线音频渲染')
  if (typeof deps?.loadManifest !== 'function' || typeof deps?.loadSample !== 'function') {
    throw new Error('缺少音色加载器')
  }
  const seconds = scoreSeconds(doc) + DEFAULT_TAIL_SECONDS
  const frames = Math.max(1, Math.ceil(seconds * rate))
  onStage?.('samples')
  const context = new Ctor(channels, frames, rate)
  const manifest = await deps.loadManifest()
  if (manifest === null || typeof manifest !== 'object' || manifest.instruments === null || typeof manifest.instruments !== 'object') {
    throw new Error('音色包 manifest 无效')
  }
  const instruments = [...new Set(doc.tracks.map(track => track.instrument).filter(id => typeof id === 'string'))]
  const buffers = new Map()
  const peaks = new Map()
  await Promise.all(instruments.map(async (id) => {
    const entry = manifest.instruments[id]
    if (entry === null || entry === undefined) throw new Error(`缺少音色：${id}`)
    for (const file of sampleFilesOf(entry)) {
      if (buffers.has(file)) continue
      const raw = await deps.loadSample(file)
      const bytes = raw instanceof ArrayBuffer ? raw.slice(0) : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
      const decoded = await context.decodeAudioData(bytes)
      buffers.set(file, decoded)
      peaks.set(file, peakOfBuffer(decoded))
    }
  }))
  const trims = instrumentTrimsOf(manifest, peaks)
  const master = context.createGain()
  master.gain.value = 1
  master.connect(context.destination)
  const soloed = doc.tracks.some(track => track.solo === true)
  const gains = new Map()
  for (const track of doc.tracks) {
    const gain = context.createGain()
    const level = track.muted === true ? 0 : (soloed && track.solo !== true ? 0 : clamp(Number(track.volume) || 0, 0, 1))
    gain.gain.value = level
    gain.connect(master)
    gains.set(track.id, gain)
  }
  const stepDuration = 60 / doc.bpm / 4
  const totalSteps = doc.bars * MUSIC_STEPS_PER_BAR
  const seamless = doc.prompt?.seamless === true
  const events = buildStepEvents(doc)
  for (let step = 0; step < totalSteps; step += 1) {
    const stepEvents = events.get(step)
    if (stepEvents === undefined) continue
    const swing = doc.swing > 0 && step % 2 === 1 ? doc.swing * stepDuration * 0.5 : 0
    for (const event of stepEvents) {
      const humanize = doc.humanize > 0 ? (Math.random() - 0.5) * doc.humanize * stepDuration * 0.5 : 0
      const when = Math.max(0, step * stepDuration + swing + humanize)
      const track = doc.tracks.find(item => item.id === event.trackId)
      if (track === undefined) continue
      const entry = manifest.instruments[track.instrument]
      if (entry === null || entry === undefined) continue
      const destination = gains.get(track.id)
      if (destination === undefined) continue
      if (event.kind === 'drum') {
        const variants = entry.lanes?.[event.lane] ?? []
        if (variants.length === 0) continue
        const variant = variants[Math.floor(Math.random() * variants.length)]
        const buffer = buffers.get(variant.file)
        if (buffer === undefined) continue
        scheduleBuffer(context, destination, buffer, when, buffer.duration, (event.vel / 127) * (variant.gain ?? 0.8), 1, 0.08, true)
        continue
      }
      const zone = chooseZone(entry, event.midi)
      if (zone === null) continue
      const buffer = buffers.get(zone.file)
      if (buffer === undefined) continue
      const noteSeconds = Math.max(0.05, event.len * stepDuration * 0.96)
      const peak = (event.vel / 127) * (zone.gain ?? 0.8) * (trims.get(track.instrument) ?? 1)
      const ratio = Math.pow(2, (event.midi - zone.root) / 12)
      scheduleBuffer(context, destination, buffer, when, noteSeconds, peak, ratio, seamless ? 0.25 : 0.12, true)
    }
  }
  onStage?.('render')
  const rendered = await context.startRendering()
  onStage?.('encode')
  return encodeWavBuffer(rendered, depth, channels)
}

/* ── MIDI ────────────────────────────────────────────────────────────────────── */

function vlq(value) {
  let remaining = Math.max(0, Math.round(value))
  const out = [remaining & 0x7f]
  remaining >>= 7
  while (remaining > 0) {
    out.unshift((remaining & 0x7f) | 0x80)
    remaining >>= 7
  }
  return out
}

function chunk(id, data) {
  return [
    id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3),
    (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff,
    ...data,
  ]
}

function metaText(text) {
  const bytes = [...new TextEncoder().encode(text)].slice(0, 120)
  return [0xff, 0x03, ...vlq(bytes.length), ...bytes]
}

function trackChunk(events) {
  const data = []
  let previous = 0
  for (const event of events) {
    const tick = Math.max(0, Math.round(event.tick))
    data.push(...vlq(tick - previous))
    previous = tick
    data.push(...event.bytes)
  }
  data.push(...vlq(0), 0xff, 0x2f, 0x00)
  return chunk('MTrk', data)
}

/**
 * Write the score as an SMF Type 1 file.
 * @param options { swing?: 'bake'|'grid', drums?: 'gm'|'track' }
 */
export function encodeMusicMidi(doc, options = {}) {
  const bake = options.swing !== 'grid'
  const gmDrums = options.drums !== 'track'
  const stepDurationTicks = TICKS_PER_STEP
  const swingTicks = bake && doc.swing > 0 ? Math.round(doc.swing * stepDurationTicks * 0.5) : 0
  const humanizeTicks = bake && doc.humanize > 0 ? doc.humanize * stepDurationTicks * 0.5 : 0
  const tickOf = (bar, step) => {
    const index = (bar - 1) * MUSIC_STEPS_PER_BAR + step
    const jitter = humanizeTicks > 0 ? (Math.random() - 0.5) * humanizeTicks : 0
    return Math.max(0, Math.round(index * stepDurationTicks + (index % 2 === 1 ? swingTicks : 0) + jitter))
  }
  const rootIndex = Math.max(0, KEY_ROOTS.indexOf(doc.keyRoot))
  const minor = doc.keyMode === 'minor'
  const signature = minor ? MINOR_SF[rootIndex] : MAJOR_SF[rootIndex]
  const tempo = Math.round(60000000 / clamp(doc.bpm, 40, 200))
  const conductor = [
    { tick: 0, bytes: metaText('Conductor') },
    { tick: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
    { tick: 0, bytes: [0xff, 0x59, 0x02, signature < 0 ? signature + 256 : signature, minor ? 1 : 0] },
    { tick: 0, bytes: [0xff, 0x51, 0x03, (tempo >>> 16) & 0xff, (tempo >>> 8) & 0xff, tempo & 0xff] },
  ]
  let nextChannel = 1
  const takeChannel = () => {
    const channel = nextChannel
    nextChannel = (nextChannel + 1) % 16
    if (nextChannel === 9) nextChannel = (nextChannel + 1) % 16
    return channel
  }
  const tracks = []
  for (const track of doc.tracks) {
    if (noteEventsOf(track) === 0) continue
    const isDrums = track.kind === 'drums'
    const channel = isDrums && gmDrums ? 9 : takeChannel()
    const events = []
    const name = typeof track.name === 'string' && track.name.trim() !== '' ? track.name : track.instrument
    events.push({ order: -3, tick: 0, bytes: metaText(name) })
    if (!(isDrums && gmDrums)) {
      const program = GM_PROGRAM[track.instrument] ?? 0
      events.push({ order: -2, tick: 0, bytes: [0xc0 | channel, program] })
    }
    if (isDrums) {
      for (const [lane, bars] of Object.entries(track.drums ?? {})) {
        const note = DRUM_NOTE[lane]
        if (note === undefined || !Array.isArray(bars)) continue
        bars.forEach((steps, barIndex) => {
          for (const [stepText, velocity] of Object.entries(steps ?? {})) {
            const tick = tickOf(barIndex + 1, Number(stepText))
            events.push({ order: 1, tick, bytes: [0x90 | channel, note, clamp(Math.round(velocity), 1, 127)] })
            events.push({ order: 0, tick: tick + TICKS_PER_STEP, bytes: [0x80 | channel, note, 0] })
          }
        })
      }
    } else {
      for (const note of track.notes ?? []) {
        const tick = tickOf(note.bar, note.step)
        const length = Math.max(1, Math.round(note.len * TICKS_PER_STEP))
        events.push({ order: 1, tick, bytes: [0x90 | channel, clamp(Math.round(note.midi), 0, 127), clamp(Math.round(note.vel), 1, 127)] })
        events.push({ order: 0, tick: tick + length, bytes: [0x80 | channel, clamp(Math.round(note.midi), 0, 127), 0] })
      }
    }
    /* Note-offs before note-ons at the same tick, so a repeated pitch retriggers cleanly;
       the program change and the track name come first at tick 0. */
    events.sort((left, right) => (left.tick - right.tick) || (left.order - right.order))
    tracks.push(trackChunk(events))
  }
  const header = chunk('MThd', [0, 1, 0, tracks.length + 1, (PPQ >>> 8) & 0xff, PPQ & 0xff])
  return new Uint8Array([...header, ...trackChunk(conductor), ...tracks.flat()])
}
