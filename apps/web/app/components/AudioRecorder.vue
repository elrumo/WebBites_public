<template>
  <div class="audio-recorder">
    <!-- The name goes on from the start, in every state: people name a note
         while they think about what to say, not after they have said it. -->
    <input
      v-model="title"
      type="text"
      class="ar-title"
      enterkeyhint="done"
      autocomplete="off"
      :placeholder="$t('bookmarks.recorder.title_placeholder')"
      :aria-label="$t('bookmarks.recorder.title_placeholder')"
    />

    <!-- Microphone refused, or a browser with no recorder at all. The upload
         button stays: there is still a way to save a recording here, and
         hiding it would make the panel a dead end. -->
    <div v-if="!isReady && (state === 'denied' || state === 'unsupported')" class="ar-denied">
      <UIcon name="i-heroicons-microphone" class="ar-denied-icon" />
      <p class="ar-denied-text">
        {{ state === 'unsupported' ? $t('bookmarks.recorder.unsupported') : $t('bookmarks.recorder.mic_denied') }}
      </p>
      <UButton variant="soft" color="primary" size="sm" @click="pickFile">
        {{ $t('bookmarks.recorder.upload') }}
      </UButton>
    </div>

    <!-- Ready to save: a take, or a file that was picked instead. One row the
         shape of the card it becomes — play, the waveform to scrub, the time —
         rather than the browser's own player, which on iOS is a grey slab with
         an AirPlay button in it. -->
    <template v-else-if="isReady">
      <div class="ar-player">
        <button
          type="button"
          class="ar-play"
          :aria-label="playing ? $t('bookmarks.recorder.pause') : $t('bookmarks.recorder.play')"
          @click="togglePlayback"
        >
          <UIcon :name="playing ? 'i-heroicons-pause-solid' : 'i-heroicons-play-solid'" class="ar-play-icon" :class="{ 'ar-play-icon--play': !playing }" />
        </button>

        <div
          class="ar-scrub"
          role="slider"
          tabindex="0"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(total)"
          :aria-valuenow="Math.round(position)"
          :aria-valuetext="clock(position)"
          @pointerdown="scrubStart"
          @keydown.left.prevent="seekBy(-5)"
          @keydown.right.prevent="seekBy(5)"
        >
          <span
            v-for="(bar, index) in reviewBars"
            :key="index"
            class="ar-scrub-bar"
            :class="{ 'ar-scrub-bar--played': (index + 0.5) / reviewBars.length <= progress }"
            :style="{ height: `${Math.max(12, bar * 100)}%` }"
          ></span>
        </div>

        <span class="ar-player-time">{{ clock(playing || position > 0 ? position : total) }}</span>
      </div>

      <div class="ar-review-actions">
        <UButton variant="ghost" color="neutral" size="sm" icon="i-heroicons-arrow-path" class="ar-again" @click="again">
          {{ picked ? $t('bookmarks.recorder.record_instead') : $t('bookmarks.recorder.record_again') }}
        </UButton>
        <span v-if="picked" class="ar-file-name">{{ picked.file.name }}</span>
      </div>

      <audio
        ref="player"
        class="hidden"
        :src="reviewUrl"
        preload="metadata"
        @loadedmetadata="onMetadata"
        @play="onPlay"
        @pause="onPause"
        @ended="onEnded"
      ></audio>
    </template>

    <!-- Recording, paused, or waiting to start. One layout for all three: the
         timer and the waveform stay put and only the controls change, so
         pressing pause does not reflow the panel under the finger. -->
    <template v-else>
      <div class="ar-stage">
        <p class="ar-time" :class="{ 'ar-time--live': isRecording }">{{ elapsedLabel }}</p>

        <div class="ar-wave" :class="{ 'ar-wave--idle': state === 'idle' || state === 'requesting' }">
          <span
            v-for="(bar, index) in bars"
            :key="index"
            class="ar-bar"
            :style="{ height: `${Math.max(3, bar * 100)}%` }"
          ></span>
        </div>

        <p v-if="state === 'empty'" class="ar-hint ar-hint--warn">{{ $t('bookmarks.recorder.empty') }}</p>
        <p v-else-if="state === 'idle'" class="ar-hint">{{ $t('bookmarks.recorder.hint') }}</p>
        <p v-else-if="state === 'paused'" class="ar-hint">{{ $t('bookmarks.recorder.paused') }}</p>
        <p v-else-if="state === 'requesting'" class="ar-hint">{{ $t('bookmarks.recorder.requesting') }}</p>
      </div>

      <div class="ar-controls">
        <!-- Restart and Stop flank the record button and are only live once
             there is a take to act on, so the row never changes width. -->
        <UButton
          class="ar-side"
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-heroicons-arrow-path"
          :disabled="!started"
          :aria-label="$t('bookmarks.recorder.restart')"
          @click="restartTake"
        />

        <button
          type="button"
          class="ar-record"
          :class="{ 'ar-record--live': isRecording }"
          :disabled="state === 'requesting'"
          :aria-label="recordLabel"
          @click="toggle"
        >
          <span class="ar-record-glyph" :class="isRecording ? 'ar-record-glyph--pause' : 'ar-record-glyph--dot'"></span>
        </button>

        <UButton
          class="ar-side"
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-heroicons-stop"
          :disabled="!started"
          :aria-label="$t('bookmarks.recorder.stop')"
          @click="stopTake"
        />
      </div>

      <UButton
        v-if="state === 'idle' || state === 'empty'"
        class="ar-upload"
        variant="link"
        color="neutral"
        size="xs"
        @click="pickFile"
      >
        {{ $t('bookmarks.recorder.upload') }}
      </UButton>
    </template>

    <input
      ref="fileInput"
      type="file"
      class="hidden"
      accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac"
      @change="onPicked"
    />
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, watch, inject, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useAudioRecorder } from '~/composables/useAudioRecorder'

const { t } = useI18n()
const store = useStore()
const { filesToUpload } = storeToRefs(store)

const {
  state, elapsed, samples, result: recording,
  isRecording, hasRecording,
  start, pause, resume, stop, reset, restart, PEAK_COUNT
} = useAudioRecorder()

const title = ref('')
const fileInput = ref(null)

/** A file picked instead of recorded: `{ file, url }`. */
const picked = shallowRef(null)

/** A take exists to stop or throw away. */
const started = computed(() => isRecording.value || state.value === 'paused')

/** There is something to play back and save. */
const isReady = computed(() => hasRecording.value || !!picked.value)

/** `m:ss`, for the timer and the player alike. */
const clock = (value) => {
  const seconds = Math.max(0, Math.floor(value || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const elapsedLabel = computed(() => clock(elapsed.value))

const recordLabel = computed(() => isRecording.value
  ? t('audio_recorder.pause_recording')
  : state.value === 'paused' ? t('audio_recorder.resume_recording') : t('audio_recorder.start_recording'))

/**
 * The live waveform.
 *
 * Fills from the right so a fresh recording grows into the panel rather than
 * starting as a full-width flat line, and holds its last shape while paused —
 * the bars are the take so far, not a level meter.
 */
const bars = computed(() => {
  const captured = samples.value
  const padding = Array(Math.max(0, PEAK_COUNT - captured.length)).fill(0)
  return [...padding, ...captured.slice(-PEAK_COUNT)]
})

// ── Review ────────────────────────────────────────────────────────────────

const REVIEW_BARS = 44

const player = ref(null)
const playing = ref(false)
const position = ref(0)
/** Read off the file once it loads; a MediaRecorder WebM reports Infinity. */
const mediaDuration = ref(0)

const reviewUrl = computed(() => recording.value?.url || picked.value?.url || '')

const total = computed(() => {
  if (Number.isFinite(mediaDuration.value) && mediaDuration.value > 0) return mediaDuration.value
  return recording.value?.duration || 0
})

const progress = computed(() => total.value > 0 ? Math.min(1, position.value / total.value) : 0)

/**
 * The take's own shape, thinned to fit the row. Decoding can fail — Safari's
 * own recordings, a file the browser cannot read — and then the tail of the
 * live meter stands in; a picked file that never had one gets a flat track.
 */
const reviewBars = computed(() => {
  const source = recording.value?.peaks?.length
    ? recording.value.peaks
    : recording.value && samples.value.length ? samples.value : null
  if (!source) return Array(REVIEW_BARS).fill(0.18)

  const loudest = Math.max(...source, 0.001)
  return Array.from({ length: REVIEW_BARS }, (_, bar) => {
    const from = Math.floor((bar / REVIEW_BARS) * source.length)
    const to = Math.max(from + 1, Math.floor(((bar + 1) / REVIEW_BARS) * source.length))
    return Math.max(...source.slice(from, to)) / loudest
  })
})

// `timeupdate` lands four times a second, which reads as a stutter across a
// row this wide; while playing, the position is read every frame instead.
let frame = null
const follow = () => {
  if (player.value) position.value = player.value.currentTime
  frame = requestAnimationFrame(follow)
}
const stopFollowing = () => {
  if (frame) cancelAnimationFrame(frame)
  frame = null
}

const onMetadata = () => { mediaDuration.value = player.value?.duration || 0 }
const onPlay = () => { playing.value = true; stopFollowing(); follow() }
const onPause = () => {
  playing.value = false
  stopFollowing()
  if (player.value) position.value = player.value.currentTime
}
const onEnded = () => {
  playing.value = false
  stopFollowing()
  position.value = 0
  if (player.value) player.value.currentTime = 0
}

const togglePlayback = () => {
  const audio = player.value
  if (!audio) return
  if (audio.paused) audio.play().catch(() => { playing.value = false })
  else audio.pause()
}

const seekTo = (seconds) => {
  const audio = player.value
  if (!audio || !(total.value > 0)) return
  const clamped = Math.min(Math.max(seconds, 0), total.value)
  audio.currentTime = clamped
  position.value = clamped
}

const seekBy = (delta) => seekTo(position.value + delta)

const seekToPointer = (event, element) => {
  const rect = element.getBoundingClientRect()
  seekTo(((event.clientX - rect.left) / rect.width) * total.value)
}

/** Tap to jump, drag to scrub. */
const scrubStart = (event) => {
  const element = event.currentTarget
  element.setPointerCapture?.(event.pointerId)
  seekToPointer(event, element)
  const move = (moveEvent) => seekToPointer(moveEvent, element)
  const end = () => {
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', end)
    element.removeEventListener('pointercancel', end)
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', end)
  element.addEventListener('pointercancel', end)
}

const resetPlayback = () => {
  player.value?.pause()
  stopFollowing()
  playing.value = false
  position.value = 0
  mediaDuration.value = 0
}

// ── Handing over ──────────────────────────────────────────────────────────

/**
 * The composer saves from `store.filesToUpload`, the same as a picture or a
 * document, so a finished take is handed over the moment it exists rather than
 * on a second button press. `audioMeta` carries what only the recorder knows.
 */
const handOver = (value) => {
  filesToUpload.value = [value.file]
  store.audioMeta = {
    duration: value.duration,
    peaks: value.peaks,
    isVoiceNote: true,
    title: title.value.trim() || ''
  }
}

watch(recording, (value) => {
  if (!value) {
    if (store.audioMeta && !picked.value) store.audioMeta = null
    return
  }
  handOver(value)
})

/**
 * Save pressed while a take is still running.
 *
 * Only a stopped take has a file. While one is running, the composer turns its
 * Save button into Stop and calls this: the take ends and its file is handed
 * over directly, rather than waiting on the `recording` watcher, so the button
 * is Save again — with something to save — the moment it returns.
 */
const composeAudioTake = inject('composeAudioTake', null)

const finishTake = async () => {
  if (!started.value) return filesToUpload.value.length > 0
  const value = await stop()
  if (!value) return false
  handOver(value)
  return true
}

watch(started, (value) => {
  if (composeAudioTake) composeAudioTake.value = value ? { finish: finishTake } : null
}, { immediate: true })

watch(title, (value) => {
  if (store.audioMeta) store.audioMeta.title = value.trim()
})

const toggle = async () => {
  if (isRecording.value) return pause()
  if (state.value === 'paused') return resume()
  await start()
}

const stopTake = async () => { await stop() }

const restartTake = async () => { await restart() }

const dropPicked = () => {
  if (picked.value?.url) URL.revokeObjectURL(picked.value.url)
  picked.value = null
}

/** Throws away what is ready and goes back to the recorder. The name stays. */
const again = () => {
  resetPlayback()
  dropPicked()
  reset()
  filesToUpload.value = []
  store.audioMeta = null
}

const pickFile = () => fileInput.value?.click()

/** A picked file skips the recorder entirely — the composer uploads it. */
const onPicked = (event) => {
  const file = Array.from(event.target?.files || [])[0]
  if (event.target) event.target.value = ''
  if (!file) return
  resetPlayback()
  reset()
  dropPicked()
  picked.value = { file, url: URL.createObjectURL(file) }
  filesToUpload.value = [file]
  // Not a voice note, and nothing is known of it but the name it is given.
  store.audioMeta = { title: title.value.trim() || '' }
}

onBeforeUnmount(() => {
  if (composeAudioTake) composeAudioTake.value = null
  resetPlayback()
  dropPicked()
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.audio-recorder {
  @apply flex flex-col items-center gap-3 w-full pt-0.5 pb-1;
}

/* ---- Name ----
   16px so iOS does not zoom the page when the field takes focus. */
.ar-title {
  @apply w-full rounded-xl px-3.5 py-2.5 text-base font-medium
         text-neutral-900 dark:text-neutral-100
         placeholder:text-neutral-400 dark:placeholder:text-neutral-500
         outline-none transition-shadow duration-150;
  background: rgba(120, 120, 128, 0.1);
}

.ar-title:focus {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 45%, transparent);
}

/* ---- Stage ---- */
.ar-stage {
  @apply flex flex-col items-center gap-2 w-full;
}

.ar-time {
  @apply text-3xl font-semibold tabular-nums text-neutral-400 dark:text-neutral-500 transition-colors duration-200;
}

.ar-time--live {
  @apply text-neutral-900 dark:text-neutral-100;
}

.ar-wave {
  @apply flex flex-row items-center justify-center gap-[2px] w-full h-14 px-2;
}

.ar-wave--idle {
  @apply opacity-40;
}

.ar-bar {
  @apply flex-1 min-w-[2px] max-w-[5px] rounded-full bg-red-500/80 dark:bg-red-400/80;
  transition: height 80ms linear;
}

.ar-hint {
  @apply text-xs text-neutral-500 dark:text-neutral-400;
}

.ar-hint--warn {
  @apply text-amber-600 dark:text-amber-400;
}

/* ---- Controls ---- */
.ar-controls {
  @apply flex flex-row items-center justify-center gap-6;
}

.ar-side {
  @apply rounded-full;
}

.ar-record {
  @apply flex items-center justify-center size-16 rounded-full
         bg-white dark:bg-neutral-800
         ring-2 ring-neutral-300 dark:ring-neutral-600
         transition-transform duration-150;
}

.ar-record:active {
  @apply scale-95;
}

.ar-record:disabled {
  @apply opacity-50;
}

/* The dot becomes a pause bar pair, the way a recorder's button does — one
   control, two states, no second button appearing beside it. */
.ar-record-glyph {
  @apply block bg-red-500 dark:bg-red-400;
  transition: width 180ms cubic-bezier(0.32, 0.72, 0, 1),
              height 180ms cubic-bezier(0.32, 0.72, 0, 1),
              border-radius 180ms cubic-bezier(0.32, 0.72, 0, 1);
}

.ar-record-glyph--dot {
  @apply size-10 rounded-full;
}

.ar-record-glyph--pause {
  @apply size-6 rounded-[4px];
}

.ar-upload {
  @apply text-neutral-500 dark:text-neutral-400;
}

/* ---- Review ---- */
.ar-player {
  @apply flex flex-row items-center gap-3 w-full rounded-2xl py-2 ps-2 pe-3.5;
  background: rgba(120, 120, 128, 0.1);
}

.ar-play {
  @apply flex items-center justify-center size-10 shrink-0 rounded-full text-white
         transition-transform duration-150;
  background: var(--ui-primary);
  box-shadow: 0 4px 10px -4px color-mix(in srgb, var(--ui-primary) 70%, transparent);
}

.ar-play:active {
  @apply scale-95;
}

.ar-play-icon {
  @apply size-5;
}

/* A play triangle's weight sits left of its box; nudged so it reads centred. */
.ar-play-icon--play {
  @apply translate-x-px;
}

.ar-scrub {
  @apply flex flex-1 flex-row items-center gap-[2px] h-9 min-w-0 cursor-pointer touch-none outline-none rounded-md;
}

.ar-scrub:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 45%, transparent);
}

.ar-scrub-bar {
  @apply flex-1 min-w-[2px] rounded-full bg-neutral-400/50 dark:bg-neutral-500/60;
  transition: background-color 120ms linear;
}

.ar-scrub-bar--played {
  background: var(--ui-primary);
}

.ar-player-time {
  @apply text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400 min-w-[2.25rem] text-end;
}

.ar-review-actions {
  @apply flex flex-row items-center justify-between gap-2 w-full min-w-0;
}

.ar-again {
  @apply -ms-1.5;
}

.ar-file-name {
  @apply text-xs text-neutral-500 dark:text-neutral-400 truncate;
}

/* ---- Refused ---- */
.ar-denied {
  @apply flex flex-col items-center gap-2 py-4 text-center;
}

.ar-denied-icon {
  @apply size-8 text-neutral-400 dark:text-neutral-500;
}

.ar-denied-text {
  @apply text-sm text-neutral-600 dark:text-neutral-300 max-w-[260px];
}
</style>
