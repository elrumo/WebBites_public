/**
 * Recording a voice note in the browser.
 *
 * A thin wrapper around `MediaRecorder`, which is the only thing here that is
 * not a plain timer or a canvas: the platform already does the encoding, the
 * pausing and the chunking, and a library on top of it would only be a second
 * opinion about what a Blob is.
 *
 * Two browser facts shape the rest:
 *
 * 1. **Nobody agrees on a container.** Safari records MP4/AAC; Chrome and
 *    Firefox record WebM/Opus, which no Apple player will open. We ask for MP4
 *    when the browser has it and send whatever we got — the server transcodes
 *    to `.m4a` on the way in, so a note recorded in Chrome still plays on a
 *    watch. Doing it there rather than here keeps ffmpeg-in-wasm out of the
 *    bundle for a feature most recordings do not need.
 *
 * 2. **A paused recorder still holds the microphone.** The tracks are stopped
 *    explicitly on `stop()` and `reset()`, or the tab keeps its recording
 *    indicator lit long after the user has saved.
 */

import { ref, computed, shallowRef, onScopeDispose } from 'vue'

/** How many bars the waveform on the card is drawn from. Matches the server. */
const PEAK_COUNT = 64

/** What we ask for, best first. */
const PREFERRED_TYPES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus'
]

function bestMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return PREFERRED_TYPES.find(type => {
    try { return MediaRecorder.isTypeSupported(type) } catch { return false }
  }) || ''
}

function extensionFor(mimeType) {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

/**
 * The type the file is uploaded under.
 *
 * Older Safari has no `audio/mp4` to ask for and records a microphone-only
 * stream as `video/mp4`. The composer files uploads by type, and a `video/`
 * type is not audio there, so the take was refused as an unsupported file.
 * There is no picture in it: say what it is.
 */
function audioTypeFor(mimeType) {
  return mimeType.startsWith('video/') ? mimeType.replace(/^video\//, 'audio/') : mimeType
}

/** Settles with `fallback` if `promise` has not settled within `ms`. */
function within(promise, ms, fallback) {
  let timer
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  ]).finally(() => clearTimeout(timer))
}

export function useAudioRecorder() {
  /** `idle` | `requesting` | `recording` | `paused` | `finished` | `denied` | `unsupported` */
  const state = ref('idle')
  /** Seconds of audio captured — not wall-clock, so a pause does not count. */
  const elapsed = ref(0)
  /** 0..1, the current input level, for the live meter. */
  const level = ref(0)
  /** A rolling tail of levels: what the live waveform draws. */
  const samples = ref([])
  const error = ref('')
  /** The finished recording: `{ file, duration, peaks, url }`. */
  const result = shallowRef(null)

  const isRecording = computed(() => state.value === 'recording')
  const isPaused = computed(() => state.value === 'paused')
  const hasRecording = computed(() => state.value === 'finished' && !!result.value)
  const canRecord = computed(() =>
    typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined')

  let recorder = null
  let stream = null
  let chunks = []
  let audioContext = null
  let analyser = null
  let meterFrame = null
  let ticker = null
  /** Wall-clock at the last resume, and the seconds banked before it. */
  let startedAt = 0
  let banked = 0

  const stopMeter = () => {
    if (meterFrame) cancelAnimationFrame(meterFrame)
    meterFrame = null
  }

  const stopTicker = () => {
    if (ticker) clearInterval(ticker)
    ticker = null
  }

  /** Lets go of the microphone. The tab's recording indicator hangs on it. */
  const releaseStream = () => {
    stopMeter()
    stopTicker()
    if (stream) stream.getTracks().forEach(track => track.stop())
    stream = null
    if (audioContext) audioContext.close().catch(() => {})
    audioContext = null
    analyser = null
    recorder = null
  }

  const readLevel = () => {
    if (!analyser) return
    const buffer = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(buffer)

    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      const value = (buffer[i] - 128) / 128
      sum += value * value
    }
    // Square-rooted twice over: RMS, then a gentle curve, because speech sits
    // low enough that a linear meter reads as a flat line.
    const rms = Math.sqrt(sum / buffer.length)
    level.value = Math.min(1, Math.sqrt(rms) * 1.6)

    if (state.value === 'recording') {
      samples.value = [...samples.value, level.value].slice(-PEAK_COUNT)
    }
    meterFrame = requestAnimationFrame(readLevel)
  }

  const startTicker = () => {
    stopTicker()
    ticker = setInterval(() => {
      if (state.value !== 'recording') return
      elapsed.value = banked + (Date.now() - startedAt) / 1000
    }, 100)
  }

  /**
   * Decodes what was recorded into the bars the card draws.
   *
   * The live meter's samples are not reused: they are a tail of the last few
   * seconds, and a two-minute note would be drawn from its own ending. Null on
   * failure — the server reads the waveform itself when one does not arrive.
   */
  const peaksFrom = async (blob) => {
    try {
      const Context = window.AudioContext || window.webkitAudioContext
      if (!Context) return null
      const context = new Context()
      // Safari can leave the promise for its own MP4 recordings unsettled,
      // which held the take in "paused" with nothing to save. The server
      // draws the waveform when none arrives, so giving up is safe.
      const decoded = await within(context.decodeAudioData(await blob.arrayBuffer()), 4000, null)
      context.close().catch(() => {})
      if (!decoded) return null
      const channel = decoded.getChannelData(0)

      const perBar = Math.floor(channel.length / PEAK_COUNT)
      if (perBar < 1) return null

      const peaks = []
      for (let bar = 0; bar < PEAK_COUNT; bar++) {
        let sum = 0
        for (let i = 0; i < perBar; i++) {
          const value = channel[bar * perBar + i]
          sum += value * value
        }
        peaks.push(Math.sqrt(sum / perBar))
      }

      const loudest = Math.max(...peaks)
      if (!(loudest > 0)) return null
      return peaks.map(peak => Math.round((peak / loudest) * 1000) / 1000)
    } catch {
      return null
    }
  }

  /** True while `getUserMedia` has been asked and has not answered. */
  const start = async () => {
    if (!canRecord.value) {
      state.value = 'unsupported'
      error.value = 'unsupported'
      return false
    }

    reset()
    state.value = 'requesting'

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
    } catch (denied) {
      state.value = 'denied'
      error.value = denied?.name === 'NotFoundError' ? 'no_mic' : 'mic_denied'
      return false
    }

    try {
      const Context = window.AudioContext || window.webkitAudioContext
      if (Context) {
        audioContext = new Context()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 1024
        audioContext.createMediaStreamSource(stream).connect(analyser)
        // Created after `getUserMedia` resolved, which is no longer the tap
        // that started it, so iOS hands it over suspended and the meter reads
        // silence. Resuming is allowed while the microphone is live.
        audioContext.resume?.().catch(() => {})
      }
    } catch {
      // No meter. The recording still works, which is the part that matters.
    }

    const mimeType = bestMimeType()
    chunks = []
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }
    // Timesliced so a tab that is closed mid-recording has left something
    // behind, and so `stop()` never waits on one huge final chunk.
    recorder.start(1000)

    banked = 0
    elapsed.value = 0
    startedAt = Date.now()
    state.value = 'recording'
    startTicker()
    readLevel()
    return true
  }

  const pause = () => {
    if (state.value !== 'recording' || !recorder) return
    recorder.pause()
    banked += (Date.now() - startedAt) / 1000
    elapsed.value = banked
    state.value = 'paused'
    level.value = 0
  }

  const resume = () => {
    if (state.value !== 'paused' || !recorder) return
    recorder.resume()
    startedAt = Date.now()
    state.value = 'recording'
  }

  const stop = async () => {
    if (!recorder || (state.value !== 'recording' && state.value !== 'paused')) return null

    if (state.value === 'recording') banked += (Date.now() - startedAt) / 1000
    elapsed.value = banked

    const mimeType = audioTypeFor(recorder.mimeType || bestMimeType() || 'audio/webm')
    const finished = new Promise(resolve => { recorder.onstop = resolve })
    recorder.stop()
    // WebKit has been known not to fire `stop` for a recorder stopped while
    // paused. The chunks are timesliced, so whatever arrived is still a take;
    // waiting forever for the event is what left Save with nothing to send.
    await within(finished, 3000, null)
    releaseStream()

    const blob = new Blob(chunks, { type: mimeType })
    chunks = []
    // Nothing was captured: a microphone that was muted at the OS level, or a
    // device that went away mid-take. Going quietly back to idle looked like
    // the stop button had simply not worked, so this is a state of its own.
    if (blob.size === 0) {
      state.value = 'empty'
      error.value = 'empty'
      elapsed.value = 0
      samples.value = []
      return null
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = new File([blob], `voice-note-${stamp}.${extensionFor(mimeType)}`, { type: mimeType })

    result.value = {
      file,
      duration: Math.round(elapsed.value * 10) / 10,
      peaks: await peaksFrom(blob),
      url: URL.createObjectURL(blob)
    }
    state.value = 'finished'
    level.value = 0
    return result.value
  }

  /** Throws the take away and goes back to the start. */
  const reset = () => {
    if (recorder && (state.value === 'recording' || state.value === 'paused')) {
      recorder.onstop = null
      try { recorder.stop() } catch { /* already stopped */ }
    }
    releaseStream()
    if (result.value?.url) URL.revokeObjectURL(result.value.url)
    result.value = null
    chunks = []
    banked = 0
    elapsed.value = 0
    level.value = 0
    samples.value = []
    error.value = ''
    state.value = 'idle'
  }

  /** Stop the take and start a fresh one, in one gesture. */
  const restart = async () => {
    reset()
    return await start()
  }

  onScopeDispose(reset)

  return {
    state, elapsed, level, samples, error, result,
    isRecording, isPaused, hasRecording, canRecord,
    start, pause, resume, stop, reset, restart,
    PEAK_COUNT
  }
}
