/* Web Audio sampler for the VCSL-backed music workshop.
 *
 * Every voice comes from a bundled OGG sample. The scheduling loop is the same
 * look-ahead design the old oscillator engine used, so swing/humanize and loop wrapping
 * stay sample-accurate; only the source of the sound changed.
 */
const A4 = 69

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function hzRatio(midi, root) {
  return Math.pow(2, (midi - root) / 12)
}

function buildEvents(doc) {
  const events = new Map()
  const push = (step, event) => {
    if (!events.has(step)) events.set(step, [])
    events.get(step).push(event)
  }
  /* Muted / non-soloed tracks still get their events: audibility is a live gain on the
     track's mixer node (see setMix), so muting mid-play silences notes already sounding and
     unmuting brings the same events straight back without a reschedule. */
  for (const track of doc.tracks) {
    if (track.kind === 'drums') {
      for (const [lane, bars] of Object.entries(track.drums ?? {})) {
        bars.forEach((steps, barIndex) => {
          for (const [stepText, velocity] of Object.entries(steps)) {
            push(barIndex * 16 + Number(stepText), { kind: 'drum', lane, trackId: track.id, vel: velocity })
          }
        })
      }
      continue
    }
    for (const note of track.notes) {
      const step = (note.bar - 1) * 16 + note.step
      push(step, { kind: 'note', trackId: track.id, midi: note.midi, len: note.len, vel: note.vel })
    }
  }
  return events
}

export function createMusicEngine({ loadManifest, loadSample } = {}) {
  let audio = null
  let master = null
  let timer = 0
  let playing = false
  let current = null
  let loop = true
  let seamless = false
  let volume = 0.8
  let stepDur = 0
  let totalSteps = 0
  let nextStep = 0
  let nextTime = 0
  let offset = 0
  let startedAt = 0
  let endTimer = 0
  let endedCallback = null
  const TARGET_ZONE_LEVEL = 0.12
  const MAX_INSTRUMENT_TRIM = 32
  /* Mute / unmute / solo / volume ramp: long enough to avoid a click, short enough to feel
     immediate while notes are sounding. */
  const MIX_RAMP_SECONDS = 0.015
  const sources = new Set()
  const trackGains = {}
  const buffers = new Map()
  const bufferPeaks = new Map()
  const instrumentTrims = new Map()
  const loading = new Map()
  const drumCursor = {}
  let manifest = null
  let manifestPromise = null

  function ensureAudio() {
    if (audio !== null) return audio
    const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? window.webkitAudioContext)
    if (Ctor === undefined) return null
    audio = new Ctor()
    master = audio.createGain()
    master.gain.value = volume
    master.connect(audio.destination)
    return audio
  }

  async function ensureManifest() {
    if (manifest !== null) return manifest
    if (manifestPromise === null) {
      manifestPromise = Promise.resolve(typeof loadManifest === 'function' ? loadManifest() : null)
        .then((value) => {
          if (value === null || typeof value !== 'object' || value.instruments === null || typeof value.instruments !== 'object') {
            throw new Error('音色包 manifest 无效')
          }
          manifest = value
          return value
        })
        .catch((error) => {
          manifestPromise = null
          throw error
        })
    }
    return manifestPromise
  }

  function instrumentEntry(id) {
    return manifest?.instruments?.[id] ?? null
  }

  function sampleFilesOf(id) {
    const entry = instrumentEntry(id)
    if (entry === null) return []
    const files = []
    for (const zone of Array.isArray(entry.zones) ? entry.zones : []) if (typeof zone.file === 'string') files.push(zone.file)
    for (const variants of Object.values(entry.lanes ?? {})) {
      for (const variant of Array.isArray(variants) ? variants : []) if (typeof variant.file === 'string') files.push(variant.file)
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

  /* The bundled SFZ gains are relative to one another, not to the decoded sample level:
     the piano pack lands around -47 dB while organ / e-piano land near -18 dB. Normalize
     each instrument as a whole (same trim for every zone, so dynamics stay intact) up to a
     common median zone level. Loud instruments keep trim 1; only quiet packs are raised. */
  function computeInstrumentTrim(instrumentId) {
    const entry = instrumentEntry(instrumentId)
    if (entry === null) return 1
    const levels = []
    for (const zone of entry.zones ?? []) {
      const peak = bufferPeaks.get(zone.file)
      if (peak === undefined || peak <= 0) continue
      levels.push(peak * (zone.gain ?? 0.8))
    }
    if (levels.length === 0) return 1
    levels.sort((left, right) => left - right)
    const median = levels[Math.floor(levels.length / 2)]
    if (median <= 0) return 1
    return Math.min(MAX_INSTRUMENT_TRIM, Math.max(1, TARGET_ZONE_LEVEL / median))
  }

  function instrumentTrim(instrumentId) {
    return instrumentTrims.get(instrumentId) ?? 1
  }

  async function decodeFile(file) {
    if (buffers.has(file)) return buffers.get(file)
    if (loading.has(file)) return loading.get(file)
    const task = Promise.resolve(loadSample(file))
      .then(async (bytes) => {
        const context = ensureAudio()
        if (context === null) throw new Error('当前环境不支持 Web Audio')
        const decoded = await context.decodeAudioData(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes)
        buffers.set(file, decoded)
        bufferPeaks.set(file, peakOfBuffer(decoded))
        return decoded
      })
      .finally(() => { loading.delete(file) })
    loading.set(file, task)
    return task
  }

  async function prepare(doc) {
    const ids = [...new Set((doc?.tracks ?? []).map(track => track.instrument).filter(id => typeof id === 'string'))]
    if (ids.length === 0) return true
    await ensureManifest()
    await Promise.all(ids.map(async (id) => {
      const entry = instrumentEntry(id)
      if (entry === null) throw new Error(`缺少音色：${id}`)
      await Promise.all(sampleFilesOf(id).map(decodeFile))
      instrumentTrims.set(id, computeInstrumentTrim(id))
    }))
    return true
  }

  function isReady(doc) {
    if (manifest === null) return false
    return (doc?.tracks ?? []).every(track => {
      const entry = instrumentEntry(track.instrument)
      if (entry === null) return false
      return sampleFilesOf(track.instrument).every(file => buffers.has(file))
    })
  }

  /* Every voice of a track routes through this persistent node, so changing its gain reaches
     notes that are already sounding. It is created at unity; setMix is the only level writer. */
  function ensureTrackGain(id) {
    if (trackGains[id] !== undefined) return trackGains[id]
    const gain = audio.createGain()
    gain.gain.value = 1
    gain.connect(master)
    trackGains[id] = gain
    return gain
  }

  function trackMixLevel(track, soloed) {
    if (track.muted === true) return 0
    if (soloed && track.solo !== true) return 0
    return clamp(Number(track.volume) || 0, 0, 1)
  }

  /* Cancel any automation still in flight, hold the current level, then ramp to the target.
     A 15 ms ramp is inaudible as a step but long enough to avoid a click on mute. */
  function rampGain(param, target, now, ramp) {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now)
    else {
      param.cancelScheduledValues(now)
      param.setValueAtTime(param.value, now)
    }
    if (ramp > 0) param.linearRampToValueAtTime(target, now + ramp)
    else param.setValueAtTime(target, now)
  }

  /* Live mixer for the running transport: mute, solo and per-track volume. Notes already
     scheduled (the look-ahead is 0.3 s) are re-routed by the same node, so an edit is audible
     at once instead of after a restart. */
  function setMix(tracks, ramp = MIX_RAMP_SECONDS) {
    if (audio === null || !Array.isArray(tracks)) return
    const now = audio.currentTime
    const soloed = tracks.some(track => track.solo === true)
    for (const track of tracks) {
      if (typeof track?.id !== 'string') continue
      rampGain(ensureTrackGain(track.id).gain, trackMixLevel(track, soloed), now, ramp)
    }
  }

  function chooseZone(entry, midi, velocity) {
    let best = null
    for (const zone of entry.zones ?? []) {
      if (midi < zone.low || midi > zone.high) continue
      if (best === null || Math.abs(zone.root - midi) < Math.abs(best.root - midi)) best = zone
      if (zone.root === midi) return zone
    }
    if (best !== null) return best
    for (const zone of entry.zones ?? []) {
      if (best === null || Math.abs(zone.root - midi) < Math.abs(best.root - midi)) best = zone
    }
    return best === null ? null : { ...best, velocity: velocity / 127 }
  }

  function playBuffer(destination, buffer, when, duration, peak, rate, release, oneShot) {
    const source = audio.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    const gain = audio.createGain()
    const hold = Math.max(0.03, oneShot ? Math.min(duration, buffer.duration) : duration)
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
    source.onended = () => {
      sources.delete(source)
      try { gain.disconnect() } catch { /* already disconnected */ }
    }
    sources.add(source)
  }

  function scheduleStep(step, when) {
    const events = current.events.get(step)
    if (events === undefined) return
    const swingOffset = current.doc.swing > 0 && step % 2 === 1 ? current.doc.swing * stepDur * 0.5 : 0
    for (const event of events) {
      const humanize = current.doc.humanize > 0
        ? (Math.random() - 0.5) * current.doc.humanize * stepDur * 0.5
        : 0
      const at = Math.max(audio.currentTime + 0.001, when + swingOffset + humanize)
      const track = current.doc.tracks.find(item => item.id === event.trackId)
      if (track === undefined) continue
      const entry = instrumentEntry(track.instrument)
      if (entry === null) continue
      const trim = instrumentTrim(track.instrument)
      const destination = ensureTrackGain(track.id)
      if (event.kind === 'drum') {
        const variants = entry.lanes?.[event.lane] ?? []
        if (variants.length === 0) continue
        const cursor = drumCursor[event.lane] ?? 0
        drumCursor[event.lane] = (cursor + 1) % variants.length
        const variant = variants[cursor % variants.length]
        const buffer = buffers.get(variant.file)
        if (buffer === undefined) continue
        playBuffer(destination, buffer, at, buffer.duration, (event.vel / 127) * (variant.gain ?? 0.8), 1, 0.08, true)
        continue
      }
      const zone = chooseZone(entry, event.midi, event.vel)
      if (zone === null) continue
      const buffer = buffers.get(zone.file)
      if (buffer === undefined) continue
      const noteDur = Math.max(0.05, event.len * stepDur * 0.96)
      const peak = (event.vel / 127) * (zone.gain ?? 0.8) * trim
      playBuffer(destination, buffer, at, noteDur, peak, hzRatio(event.midi, zone.root), seamless ? 0.25 : 0.12, true)
    }
  }

  /* One-shot audition for a piano-roll key. It uses the same zone selection and buffer as
     playback, but a short release so clicking keys quickly does not pile up long tails. */
  async function audition(instrumentId, midi, velocity = 104) {
    const entry = instrumentEntry(instrumentId)
    if (entry === null) return false
    const zone = chooseZone(entry, midi, velocity)
    if (zone === null) return false
    const buffer = buffers.get(zone.file)
    if (buffer === undefined) return false
    const context = ensureAudio()
    if (context === null) return false
    /* Sample decoding creates the context before any user gesture, so Chrome leaves it
       suspended. A one-shot audition must wait for resume: scheduling while suspended is
       silent, and unlike playback there is no timer to retry it. */
    if (context.state !== 'running') {
      try {
        await context.resume()
      } catch {
        return false
      }
    }
    if (context.state !== 'running') return false
    playBuffer(
      master,
      buffer,
      context.currentTime + 0.01,
      0.9,
      (velocity / 127) * (zone.gain ?? 0.8) * instrumentTrim(instrumentId),
      hzRatio(midi, zone.root),
      0.16,
      true,
    )
    return true
  }

  function stopAllSources() {
    for (const source of sources) {
      try { source.stop() } catch { /* already stopped */ }
    }
    sources.clear()
  }

  function clearTimers() {
    if (timer !== 0) clearInterval(timer)
    timer = 0
    if (endTimer !== 0) clearTimeout(endTimer)
    endTimer = 0
  }

  function stop(notify = false) {
    clearTimers()
    stopAllSources()
    playing = false
    if (notify && endedCallback !== null) endedCallback()
  }

  function durationOf() {
    return current === null ? 0 : totalSteps * stepDur
  }

  function schedule() {
    if (!playing || audio === null || current === null) return
    const horizon = audio.currentTime + 0.3
    while (nextTime < horizon) {
      if (nextStep >= totalSteps) {
        if (!loop) {
          const wait = Math.max(0, (nextTime - audio.currentTime) * 1000 + 30)
          clearInterval(timer)
          timer = 0
          endTimer = window.setTimeout(() => stop(true), wait)
          return
        }
        nextStep = 0
      }
      scheduleStep(nextStep, nextTime)
      nextStep += 1
      nextTime += stepDur
    }
  }

  return {
    async prepare(doc) {
      return prepare(doc)
    },
    isReady(doc) {
      return isReady(doc)
    },
    audition(instrumentId, midi, velocity = 104) {
      return audition(instrumentId, midi, velocity)
    },
    /** Live mute / solo / per-track volume; no-op before the first play (no context yet). */
    setMix(tracks) {
      setMix(tracks)
    },
    play(doc, options = {}) {
      if (ensureAudio() === null) return false
      if (!isReady(doc)) return false
      if (audio.state === 'suspended') void audio.resume()
      stop(false)
      current = { doc, events: buildEvents(doc) }
      /* Start from the document's mix (a score saved with muted tracks must not blurt them
         out on the first bar); edits afterwards ramp through setMix. */
      setMix(doc.tracks, 0)
      loop = options.loop !== false
      seamless = options.seamless === true
      stepDur = 60 / doc.bpm / 4
      totalSteps = doc.bars * 16
      const duration = totalSteps * stepDur
      offset = clamp(Number.isFinite(options.from) ? options.from : 0, 0, Math.max(0, duration - 0.001))
      nextStep = Math.ceil(offset / stepDur) % totalSteps
      startedAt = audio.currentTime + 0.08
      nextTime = startedAt + (nextStep * stepDur - offset)
      playing = true
      timer = window.setInterval(schedule, 80)
      schedule()
      return true
    },
    stop() {
      stop(false)
    },
    pause() {
      stop(false)
    },
    isPlaying() {
      return playing
    },
    position() {
      if (!playing || audio === null) return 0
      const duration = durationOf()
      if (duration <= 0) return 0
      const elapsed = (audio.currentTime - startedAt) + offset
      if (elapsed <= 0) return 0
      return loop ? elapsed % duration : Math.min(duration, elapsed)
    },
    duration() {
      return durationOf()
    },
    setVolume(next) {
      volume = clamp(Number(next) || 0, 0, 1)
      if (master !== null) master.gain.value = volume
    },
    onEnded(callback) {
      endedCallback = callback
    },
    dispose() {
      stop(false)
      if (audio !== null) {
        void audio.close().catch(() => {})
        audio = null
      }
      master = null
      buffers.clear()
      bufferPeaks.clear()
      instrumentTrims.clear()
      for (const key of Object.keys(trackGains)) delete trackGains[key]
    },
  }
}
