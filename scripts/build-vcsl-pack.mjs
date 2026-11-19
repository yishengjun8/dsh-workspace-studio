/* Build the compact VCSL sample pack used by the music workshop.
 *
 * This is a maintainer tool, not part of `npm run bundle`: it reads a local VCSL
 * checkout, selects one articulation / velocity layer per instrument, converts the
 * samples to mono OGG Vorbis and writes the manifest the client sampler consumes.
 *
 * Usage: node scripts/build-vcsl-pack.mjs "C:/GIT/VCSL-1.2.2-RC"
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const sourceRoot = resolve(process.argv[2] ?? 'C:/GIT/VCSL-1.2.2-RC')
const outputRoot = resolve('assets/vcsl')
const oggRoot = join(outputRoot, 'ogg')
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'

const INSTRUMENTS = [
  {
    articulation: 'Sustains',
    duration: 6,
    id: 'piano',
    maxSamples: 48,
    sfz: 'Chordophones/Zithers/Grand Piano, Kawai.sfz',
  },
  {
    duration: 6,
    id: 'organ',
    maxSamples: 36,
    sfz: 'Aerophones/Edge-blown Aerophones/Renaissance Organ - Full.sfz',
  },
  {
    duration: 5,
    id: 'harpsichord',
    maxSamples: 36,
    sfz: 'Chordophones/Zithers/Harpsichord, French.sfz',
  },
  {
    duration: 5,
    id: 'harp',
    maxSamples: 30,
    sfz: 'Chordophones/Composite Chordophones/Concert Harp.sfz',
  },
  {
    duration: 5,
    id: 'strumstick',
    maxSamples: 30,
    sfz: 'Chordophones/Composite Chordophones/Strumstick.sfz',
  },
  {
    duration: 8,
    id: 'psaltery',
    maxSamples: 18,
    sfz: 'Chordophones/Zithers/Psaltery, Bowed and Plucked - LongBow.sfz',
  },
  {
    duration: 8,
    id: 'sax',
    maxSamples: 30,
    sfz: 'Aerophones/Reed Aerophones/Tenor Saxophone - Non-Vibrato.sfz',
  },
  {
    duration: 8,
    id: 'recorder',
    maxSamples: 24,
    sfz: 'Aerophones/Edge-blown Aerophones/Baroque Alto Recorder - Sustain.sfz',
  },
  {
    duration: 3,
    id: 'glockenspiel',
    maxSamples: 12,
    sfz: 'Idiophones/Struck Idiophones/Glockenspiel.sfz',
  },
  {
    duration: 4,
    id: 'timpani',
    maxSamples: 10,
    sfz: 'Membranophones/Struck Membranophones/Timpani 1 - Hit.sfz',
  },
]

const DRUMS = {
  clap: ['Idiophones/Struck Idiophones/Claps/Clap_rr1.wav', 'Idiophones/Struck Idiophones/Claps/Clap_rr2.wav', 'Idiophones/Struck Idiophones/Claps/Clap_rr3.wav'],
  hat: ['Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_Close_rr1_Mid.wav', 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_Close_rr2_Mid.wav'],
  kick: ['Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v3_rr1_Sum.wav', 'Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v3_rr2_Sum.wav'],
  open: ['Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitO_rr1_Mid.wav', 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitO_rr2_Mid.wav'],
  perc: ['Idiophones/Struck Idiophones/Tambourine 1/Tamb1_Hit_v1_rr1_Mid.wav', 'Idiophones/Struck Idiophones/Tambourine 1/Tamb1_Hit_v2_rr1_Mid.wav'],
  snare: ['Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_HitNS_v4_rr1_Mid.wav', 'Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_HitNS_v4_rr2_Mid.wav'],
}

function fail(message) {
  console.error(`build-vcsl-pack: ${message}`)
  process.exit(1)
}

function readWavInfo(file) {
  const buffer = readFileSync(file)
  let offset = 12
  let format = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      format = {
        bits: buffer.readUInt16LE(offset + 22),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
      }
    }
    if (id === 'data') return { ...format, dataBytes: size }
    offset += 8 + size + (size % 2)
  }
  return null
}

function parseSfz(file) {
  const text = readFileSync(file, 'utf8')
  const regions = []
  let group = {}
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const section = /^<([^>]+)>/.exec(line)
    if (section !== null) {
      const name = section[1].toLowerCase()
      if (name === 'group' || name === 'global') {
        group = {}
        current = group
      } else if (name === 'region') {
        current = { ...group }
        regions.push(current)
      } else {
        current = null
      }
      continue
    }
    if (current === null) continue
    const assignment = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (assignment !== null) current[assignment[1]] = assignment[2].trim()
  }
  return regions.filter(region => typeof region.sample === 'string'
    && Number.isFinite(Number(region.pitch_keycenter))
    && String(region.trigger ?? 'attack').toLowerCase() !== 'release'
    && !/\.(mp3|ogg)$/i.test(region.sample))
}

function regionScore(region) {
  const low = Number(region.lovel ?? 0)
  const high = Number(region.hivel ?? 127)
  const mid = (low + high) / 2
  const velocityPenalty = Math.abs(mid - 76)
  const roundRobinPenalty = Number(region.seq_position ?? 1) - 1
  return velocityPenalty + roundRobinPenalty * 0.01
}

function chooseRoots(regions, maxSamples) {
  const byRoot = new Map()
  for (const region of regions) {
    const root = Number(region.pitch_keycenter)
    if (!Number.isFinite(root)) continue
    const current = byRoot.get(root)
    if (current === undefined || regionScore(region) < regionScore(current)) byRoot.set(root, region)
  }
  const roots = [...byRoot.values()].sort((a, b) => Number(a.pitch_keycenter) - Number(b.pitch_keycenter))
  if (roots.length <= maxSamples) return roots
  const picked = []
  for (let index = 0; index < maxSamples; index += 1) {
    picked.push(roots[Math.round(index * (roots.length - 1) / (maxSamples - 1))])
  }
  return [...new Set(picked)]
}

function runFfmpeg(input, output, duration, offsetSeconds, fadeSeconds) {
  const fadeStart = Math.max(0.05, duration - fadeSeconds)
  const filter = `apad=whole_dur=${duration},atrim=0:${duration},afade=t=out:st=${fadeStart}:d=${fadeSeconds}`
  const args = ['-v', 'error', '-y']
  if (offsetSeconds > 0) args.push('-ss', offsetSeconds.toFixed(4))
  args.push('-i', input, '-af', filter, '-ac', '1', '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '4', '-map_metadata', '-1', output)
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8' })
  if (result.status !== 0) fail(`${relative(sourceRoot, input)}: ${result.stderr.trim()}`)
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

if (!existsSync(sourceRoot)) fail(`VCSL source not found: ${sourceRoot}`)
rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(oggRoot, { recursive: true })

const manifest = {
  instruments: {},
  license: 'CC0-1.0',
  pack: 'vcsl-1.2.2-rc-curated',
  source: 'VCSL 1.2.2-RC (commit b6e6ac82d22248edee98a0bde185eb9ef6d439ad)',
  version: 1,
}
const sources = {}

for (const config of INSTRUMENTS) {
  const sfzFile = join(sourceRoot, config.sfz)
  if (!existsSync(sfzFile)) fail(`missing SFZ: ${config.sfz}`)
  const regions = chooseRoots(parseSfz(sfzFile), config.maxSamples)
  if (regions.length === 0) fail(`no regions: ${config.sfz}`)
  const raw = regions.map(region => ({
    file: resolve(dirname(sfzFile), String(region.sample).replace(/\\/g, '/')),
    gain: Math.pow(10, Number(region.volume ?? 0) / 20),
    high: Number(region.hikey ?? region.pitch_keycenter),
    low: Number(region.lokey ?? region.pitch_keycenter),
    offset: Number(region.offset ?? 0),
    root: Number(region.pitch_keycenter),
    source: String(region.sample),
  })).filter(entry => existsSync(entry.file))
  if (raw.length === 0) fail(`no usable samples: ${config.sfz}`)
  const maxGain = Math.max(...raw.map(entry => entry.gain), 0.0001)
  const folder = join(oggRoot, config.id)
  mkdirSync(folder, { recursive: true })
  const zones = []
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index]
    const info = readWavInfo(entry.file)
    if (info === null) continue
    const file = join(folder, `${String(index).padStart(3, '0')}.ogg`)
    runFfmpeg(entry.file, file, config.duration, info.sampleRate > 0 ? entry.offset / info.sampleRate : 0, config.duration >= 5 ? 0.5 : 0.2)
    zones.push({
      file: relative(outputRoot, file).replace(/\\/g, '/'),
      gain: Math.round((0.82 * entry.gain / maxGain) * 1000) / 1000,
      high: entry.high,
      low: entry.low,
      root: entry.root,
      sha256: sha256(file),
    })
  }
  manifest.instruments[config.id] = { oneShot: true, zones }
  sources[config.id] = {
    articulation: config.articulation ?? config.sfz.split('/').pop(),
    source: config.sfz,
    sourceFiles: raw.map(entry => entry.source),
  }
  console.log(`${config.id}: ${zones.length} zones`)
}

/* TX81Z has no SFZ: filenames encode note and velocity. Use the middle layer. */
const fmRoot = join(sourceRoot, 'Electrophones/TX81Z/FM Piano')
const noteMidi = { C: 0, E: 4, 'G#': 8 }
const fmRegions = []
for (const name of existsSync(fmRoot) ? readdirSafe(fmRoot) : []) {
  const match = /^FMPiano_([A-G]#?)(\d)_vl2\.wav$/.exec(name)
  if (match === null) continue
  const midi = 12 * (Number(match[2]) + 2) + noteMidi[match[1]]
  fmRegions.push({ file: join(fmRoot, name), midi, source: `Electrophones/TX81Z/FM Piano/${name}` })
}
if (fmRegions.length === 0) fail('no FM Piano vl2 samples')
fmRegions.sort((a, b) => a.midi - b.midi)
mkdirSync(join(oggRoot, 'epiano'), { recursive: true })
const fmZones = []
for (let index = 0; index < fmRegions.length; index += 1) {
  const entry = fmRegions[index]
  const file = join(oggRoot, 'epiano', `${String(index).padStart(3, '0')}.ogg`)
  runFfmpeg(entry.file, file, 6, 0, 0.5)
  fmZones.push({ file: relative(outputRoot, file).replace(/\\/g, '/'), gain: 0.75, high: entry.midi, low: entry.midi, root: entry.midi, sha256: sha256(file) })
}
manifest.instruments.epiano = { oneShot: true, zones: fmZones }
sources.epiano = { articulation: 'FM Piano vl2', source: 'Electrophones/TX81Z/FM Piano', sourceFiles: fmRegions.map(entry => entry.source) }
console.log(`epiano: ${fmZones.length} zones`)

/* Drum kit: one-shots, two/three round robins per lane. */
const lanes = {}
sources.drums = { articulation: 'one-shot kit', source: 'VCSL percussion', sourceFiles: [] }
mkdirSync(join(oggRoot, 'drums'), { recursive: true })
for (const [lane, files] of Object.entries(DRUMS)) {
  lanes[lane] = []
  for (let index = 0; index < files.length; index += 1) {
    const source = join(sourceRoot, files[index])
    if (!existsSync(source)) fail(`missing drum sample: ${files[index]}`)
    const file = join(oggRoot, 'drums', `${lane}-${index}.ogg`)
    runFfmpeg(source, file, 1.6, 0, 0.25)
    lanes[lane].push({ file: relative(outputRoot, file).replace(/\\/g, '/'), gain: 0.8, sha256: sha256(file) })
    sources.drums.sourceFiles.push(files[index])
  }
}
manifest.instruments.drums = { lanes, oneShot: true }

writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(outputRoot, 'sources.json'), `${JSON.stringify({ pack: manifest.pack, version: manifest.version, source: manifest.source, instruments: sources }, null, 2)}\n`)
console.log(`wrote ${outputRoot}`)

function readdirSafe(folder) {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}
