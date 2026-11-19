/* Web Audio playback for the music workshop.
 *
 * No samples and no network: every voice is synthesised from oscillators and one shared
 * noise buffer, so the desktop build behaves exactly like the browser build. Scheduling
 * uses a short look-ahead loop (80 ms interval, 300 ms horizon) instead of one timer per
 * note, which keeps swing/humanize offsets sample-accurate and lets a loop wrap without
 * re-creating the graph.
 */
const A4 = 69

function hz(midi) {
  return 440 * Math.pow(2, (midi - A4) / 12)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/* One noise buffer reused by every percussive voice. */
function noiseBuffer(context) {
  const length = Math.floor(context.sampleRate * 1.2)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

export function createMusicEngine() {
  let audio = null
  let master = null
  let noise = null
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
  const sources = new Set()
  let trackGains = {}

  function ensureAudio() {
    if (audio !== null) return audio
    const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? window.webkitAudioContext)
    if (Ctor === undefined) return null
    audio = new Ctor()
    master = audio.createGain()
    master.gain.value = volume
    master.connect(audio.destination)
    noise = noiseBuffer(audio)
    return audio
  }

  function trackGain(id, volume = 1) {
    if (trackGains[id] !== undefined) {
      trackGains[id].gain.value = volume
      return trackGains[id]
    }
    const gain = audio.createGain()
    gain.gain.value = volume
    gain.connect(master)
    trackGains[id] = gain
    return gain
  }

  function envelope(gain, when, peak, duration, attack = 0.012) {
    const safe = Math.max(0.02, duration)
    const rise = Math.min(Math.max(0.002, attack), safe * 0.5)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.linearRampToValueAtTime(Math.max(0.001, peak), when + rise)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + safe)
  }

  /* One oscillator-based voice per instrument; no samples. `decay` caps a sustained note
     (a piano key cannot ring for a whole bar), 0 means "follow the note length". */
  const VOICES = {
    lead: { parts: [['triangle', 1, 1], ['sine', 2, 0.2]], cutoff: 4200, attack: 0.008, decay: 0, gain: 0.12 },
    epiano: { parts: [['sine', 1, 1], ['sine', 2, 0.34], ['triangle', 3, 0.12]], cutoff: 3200, attack: 0.005, decay: 1.4, gain: 0.09 },
    piano: { parts: [['triangle', 1, 1], ['sine', 2, 0.24], ['sine', 3, 0.08]], cutoff: 4200, attack: 0.004, decay: 1.8, gain: 0.1 },
    pad: { parts: [['sawtooth', 1, 0.5], ['triangle', 2, 0.22]], cutoff: 1600, attack: 0.22, decay: 0, gain: 0.06 },
    bass: { parts: [['sine', 1, 1], ['triangle', 2, 0.12]], cutoff: 700, attack: 0.006, decay: 0.9, gain: 0.16 },
    guitar: { parts: [['triangle', 1, 1], ['sine', 2, 0.18]], cutoff: 3200, attack: 0.005, decay: 0.6, gain: 0.1 },
    strings: { parts: [['sawtooth', 1, 0.5], ['sawtooth', 2, 0.26]], cutoff: 2400, attack: 0.18, decay: 0, gain: 0.07 },
    organ: { parts: [['sine', 1, 1], ['sine', 2, 0.38], ['sine', 3, 0.18]], cutoff: 5000, attack: 0.02, decay: 0, gain: 0.07 },
    pluck: { parts: [['triangle', 1, 1], ['sine', 3, 0.2]], cutoff: 5200, attack: 0.004, decay: 0.4, gain: 0.1 },
    brass: { parts: [['sawtooth', 1, 0.55], ['sawtooth', 2, 0.24]], cutoff: 3000, attack: 0.035, decay: 0, gain: 0.08 },
  }

  /* Register every started voice so stop() can silence the tail immediately (a scheduled
     oscillator otherwise keeps ringing until its own stop time). */
  function track(source) {
    sources.add(source)
    source.onended = () => sources.delete(source)
  }

  function playTone(destination, freq, when, duration, peak, type = 'triangle') {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    const filter = audio.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(9000, freq * 7)
    filter.Q.value = 0.6
    osc.type = type
    osc.frequency.value = freq
    envelope(gain, when, peak, duration)
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    osc.start(when)
    osc.stop(when + duration + 0.02)
    track(osc)
  }

  /* One note on an instrument track: the palette's oscillator stack through a low-pass,
     with an optional per-instrument decay cap and a longer attack for pads/strings. */
  function playInstrument(destination, instrument, frequency, when, duration, peak, release = 0) {
    const voice = VOICES[instrument] ?? VOICES.lead
    const soundDur = voice.decay > 0 ? Math.min(duration, voice.decay) : duration
    const safe = Math.max(0.03, soundDur)
    const tail = Math.max(0, release)
    const filter = audio.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = voice.cutoff
    filter.Q.value = 0.6
    const gain = audio.createGain()
    envelope(gain, when, peak, safe + tail, voice.attack)
    gain.connect(filter)
    filter.connect(destination)
    for (const [type, ratio, level] of voice.parts) {
      const osc = audio.createOscillator()
      osc.type = type
      osc.frequency.value = frequency * ratio
      const partGain = audio.createGain()
      partGain.gain.value = level
      osc.connect(partGain)
      partGain.connect(gain)
      osc.start(when)
      osc.stop(when + safe + tail + 0.03)
      track(osc)
    }
  }

  function noiseHit(destination, when, duration, peak, filterType, frequency, q = 0.9) {
    const source = audio.createBufferSource()
    source.buffer = noise
    const filter = audio.createBiquadFilter()
    filter.type = filterType
    filter.frequency.value = frequency
    filter.Q.value = q
    const gain = audio.createGain()
    envelope(gain, when, peak, duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    source.start(when, Math.random() * 0.3)
    source.stop(when + duration + 0.02)
    track(source)
  }

  function playKick(destination, when, peak) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, when)
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.14)
    envelope(gain, when, peak, 0.34)
    osc.connect(gain)
    gain.connect(destination)
    osc.start(when)
    osc.stop(when + 0.36)
    track(osc)
  }

  function playSnare(destination, when, peak) {
    noiseHit(destination, when, 0.16, peak, 'bandpass', 1900, 0.7)
    playTone(destination, 190, when, 0.1, peak * 0.35, 'triangle')
  }

  function playHat(destination, when, peak, open) {
    noiseHit(destination, when, open ? 0.26 : 0.05, peak * 0.75, 'highpass', open ? 6800 : 8200, 0.8)
  }

  function playClap(destination, when, peak) {
    for (const delayBurst of [0, 0.012, 0.024]) {
      noiseHit(destination, when + delayBurst, 0.06, peak * (delayBurst === 0 ? 0.9 : 0.5), 'bandpass', 1200, 0.6)
    }
  }

  function playPerc(destination, when, peak) {
    /* A square at 640 Hz stacked every odd harmonic and read as a piercing beep, especially
       repeated on off-beats. A short falling triangle gives a wooden body instead, and the
       attack tick is a narrow band-passed noise (not a 3 kHz high-pass), both on a 4.8 kHz
       low-pass bus so the lane stays percussive without the hiss. */
    const bus = audio.createGain()
    const shape = audio.createBiquadFilter()
    shape.type = 'lowpass'
    shape.frequency.value = 4800
    shape.Q.value = 0.4
    bus.connect(shape)
    shape.connect(destination)

    const osc = audio.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(560, when)
    osc.frequency.exponentialRampToValueAtTime(380, when + 0.05)
    const body = audio.createGain()
    envelope(body, when, peak * 0.5, 0.085)
    osc.connect(body)
    body.connect(bus)
    osc.start(when)
    osc.stop(when + 0.11)
    track(osc)

    noiseHit(bus, when, 0.02, peak * 0.12, 'bandpass', 2600, 1.6)
  }

  function scheduleDrum(lane, velocity, when, destination) {
    const peak = clamp(velocity / 127, 0, 1) * 0.32
    if (lane === 'kick') playKick(destination, when, peak)
    else if (lane === 'snare') playSnare(destination, when, peak)
    else if (lane === 'hat') playHat(destination, when, peak, false)
    else if (lane === 'open') playHat(destination, when, peak, true)
    else if (lane === 'clap') playClap(destination, when, peak)
    else if (lane === 'perc') playPerc(destination, when, peak)
  }

  function buildEvents(doc) {
    const events = new Map()
    const push = (step, event) => {
      if (!events.has(step)) events.set(step, [])
      events.get(step).push(event)
    }
    const soloed = doc.tracks.some(track => track.solo === true)
    for (const track of doc.tracks) {
      if (track.muted || (soloed && track.solo !== true)) continue
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
      const destination = trackGain(track.id, track.volume)
      if (event.kind === 'drum') {
        scheduleDrum(event.lane, event.vel, at, destination)
        continue
      }
      const noteDur = Math.max(0.05, event.len * stepDur * 0.96)
      const voice = VOICES[track.instrument] ?? VOICES.lead
      const release = seamless && voice.decay === 0 ? 0.25 : 0
      playInstrument(destination, track.instrument, hz(event.midi), at, noteDur, (event.vel / 127) * voice.gain, release)
    }
  }

  function stopAllSources() {
    for (const source of sources) {
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
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
    /** Play (or resume) one document. `from` is a position in seconds. */
    play(doc, options = {}) {
      if (ensureAudio() === null) return false
      if (audio.state === 'suspended') void audio.resume()
      stop(false)
      current = { doc, events: buildEvents(doc) }
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
    /** Stop and report "ended" so the UI can reset its play button (natural end). */
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
      noise = null
      trackGains = {}
    },
  }
}




