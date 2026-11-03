<template>
  <div class="audio-view">
    <div v-if="!fileUrl" class="av-empty">
      <UIcon name="i-heroicons-microphone" class="av-empty-icon" />
      <p>{{ $t('website_modal.audio.unavailable') }}</p>
    </div>

    <template v-else>
      <!-- Player. The waveform is the scrubber: a recording has no frames to
           scrub through, and its own shape is the only landmark in it. -->
      <div class="av-player">
        <audio
          ref="player"
          :src="fileUrl"
          preload="metadata"
          @loadedmetadata="onMeta"
          @timeupdate="onTime"
          @play="onPlay"
          @pause="playing = false"
          @ended="onEnded"
        ></audio>

        <UButton
          class="av-play"
          size="xl"
          color="primary"
          variant="solid"
          :icon="playing ? 'i-heroicons-pause-solid' : 'i-heroicons-play-solid'"
          :aria-label="playing ? $t('website_modal.audio.pause') : $t('website_modal.audio.play')"
          square
          @click="toggle"
        />

        <div class="av-scrub">
          <div
            ref="wave"
            class="av-wave"
            role="slider"
            tabindex="0"
            :aria-label="$t('website_modal.audio.scrub')"
            :aria-valuemin="0"
            :aria-valuemax="Math.round(duration)"
            :aria-valuenow="Math.round(position)"
            @click="scrubTo"
            @keydown.left.prevent="nudge(-5)"
            @keydown.right.prevent="nudge(5)"
          >
            <span
              v-for="(bar, index) in bars"
              :key="index"
              class="av-bar"
              :class="{ 'av-bar--played': (index + 1) / bars.length <= progress }"
              :style="{ height: `${Math.max(8, bar * 100)}%` }"
            ></span>
          </div>

          <div class="av-times">
            <span>{{ positionLabel }}</span>
            <div class="av-times-right">
              <UDropdownMenu :items="speedItems">
                <UButton size="xs" variant="ghost" color="neutral" class="av-speed">{{ rate }}×</UButton>
              </UDropdownMenu>
              <span>{{ durationLabel }}</span>
            </div>
          </div>
        </div>

        <UButton
          class="shrink-0"
          :to="fileUrl"
          target="_blank"
          rel="noopener"
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-down-tray"
          :aria-label="$t('website_modal.audio.download')"
        />
      </div>

      <!-- Transcript -->
      <div class="av-transcript">
        <div class="av-transcript-head">
          <h3 class="av-transcript-title">{{ $t('website_modal.audio.transcript') }}</h3>
          <UBadge v-if="status === 'done' && segments.length" size="xs" variant="soft" color="neutral">
            {{ $t('website_modal.audio.segments', segments.length, { n: segments.length }) }}
          </UBadge>
        </div>

        <!-- Being made. Not a spinner alone: the row says who is making it and
             that the page need not be kept open for it. -->
        <div v-if="status === 'pending'" class="av-state">
          <UIcon name="i-heroicons-arrow-path" class="animate-spin" />
          <span>{{ $t('website_modal.audio.transcribing_long') }}</span>
        </div>

        <!-- Seekable when there are timestamps, a plain read when there are
             not — a transcript made on a device that sent only text. -->
        <div v-else-if="segments.length > 0" class="av-segments">
          <button
            v-for="(segment, index) in segments"
            :key="index"
            type="button"
            class="av-segment"
            :class="{ 'av-segment--active': index === activeSegment }"
            @click="seek(segment.start)"
          >
            <span class="av-segment-time">{{ stamp(segment.start) }}</span>
            <span class="av-segment-text">{{ segment.text }}</span>
          </button>
        </div>

        <p v-else-if="text" class="av-plain">{{ text }}</p>

        <div v-else class="av-state av-state--offer">
          <p>
            {{ status === 'failed'
              ? $t('website_modal.audio.failed')
              : status === 'quota'
                ? $t('website_modal.audio.quota')
                : $t('website_modal.audio.none') }}
          </p>
          <UButton
            size="sm"
            variant="soft"
            color="primary"
            :loading="requesting"
            icon="i-heroicons-sparkles"
            @click="requestTranscript"
          >
            {{ status === 'failed' ? $t('website_modal.audio.retry') : $t('website_modal.audio.generate') }}
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import {
  audioFileUrl,
  audioPeaks,
  timeLabel,
  transcriptText,
  transcriptSegments
} from '~/composables/useBookmarkAudio'

const store = useStore()
const { webToShow, globalAudioInstance } = storeToRefs(store)

const player = ref(null)
const wave = ref(null)
const playing = ref(false)
const position = ref(0)
const duration = ref(0)
const rate = ref(1)
const requesting = ref(false)

const fileUrl = computed(() => audioFileUrl(webToShow.value))
const bars = computed(() => audioPeaks(webToShow.value, 96))
const segments = computed(() => transcriptSegments(webToShow.value))
const text = computed(() => transcriptText(webToShow.value))
const status = computed(() => webToShow.value?.transcriptStatus || 'none')

// The stored length until the file's own metadata lands: the scrubber should
// be the right length on the first frame, not after the audio has loaded.
const totalLength = computed(() => duration.value || Number(webToShow.value?.audioDuration) || 0)
const progress = computed(() => (totalLength.value > 0 ? position.value / totalLength.value : 0))

const positionLabel = computed(() => stamp(position.value))
const durationLabel = computed(() => (totalLength.value ? stamp(totalLength.value) : '—:—'))

/** The segment the playhead is inside, for the highlight. */
const activeSegment = computed(() =>
  segments.value.findIndex(segment => position.value >= segment.start && position.value < segment.end))

const speedItems = computed(() => [[0.75, 1, 1.25, 1.5, 2].map(value => ({
  label: `${value}×`,
  onSelect: () => {
    rate.value = value
    if (player.value) player.value.playbackRate = value
  }
}))])

function stamp(seconds) {
  return timeLabel(Math.floor(Number(seconds) || 0))
}

/**
 * Article narration and a recording are both audio out of the same speakers,
 * so starting one stops the other — the store already holds the narrator's
 * element for exactly this.
 */
function onPlay() {
  playing.value = true
  const narrator = globalAudioInstance.value
  if (narrator && narrator !== player.value) narrator.pause()
}

function toggle() {
  if (!player.value) return
  if (playing.value) player.value.pause()
  else player.value.play().catch(() => { playing.value = false })
}

function onMeta() {
  // A WebM recorded in a browser can report Infinity until it has been seeked;
  // the stored length is the honest number in that case.
  const measured = player.value?.duration
  duration.value = Number.isFinite(measured) && measured > 0 ? measured : 0
}

function onTime() { position.value = player.value?.currentTime || 0 }

function onEnded() {
  playing.value = false
  position.value = 0
}

function seek(seconds) {
  if (!player.value) return
  player.value.currentTime = Math.max(0, Math.min(seconds, totalLength.value || seconds))
  position.value = player.value.currentTime
  if (!playing.value) player.value.play().catch(() => {})
}

function nudge(by) { seek((position.value || 0) + by) }

function scrubTo(event) {
  const box = wave.value?.getBoundingClientRect()
  if (!box || !totalLength.value) return
  seek(((event.clientX - box.left) / box.width) * totalLength.value)
}

async function requestTranscript() {
  requesting.value = true
  try {
    await store.requestTranscript(webToShow.value?.objectId)
  } finally {
    requesting.value = false
  }
}

// Switching bookmark inside the modal keeps this component mounted, so the
// player has to be told; otherwise the previous recording keeps playing under
// the next one's waveform.
watch(fileUrl, () => {
  playing.value = false
  position.value = 0
  duration.value = 0
  player.value?.pause()
})

onBeforeUnmount(() => player.value?.pause())
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.audio-view {
  @apply flex flex-col gap-4 w-full h-full overflow-y-auto p-4 sm:p-6;
}

/* ---- Player ---- */
.av-player {
  @apply
    flex flex-row items-center gap-3 sm:gap-4
    w-full p-3 sm:p-4
    rounded-2xl
    bg-neutral-100 dark:bg-neutral-800
  ;
}

.av-play {
  @apply rounded-full shrink-0;
}

.av-scrub {
  @apply flex flex-col gap-1 flex-1 min-w-0;
}

.av-wave {
  @apply flex flex-row items-center gap-[2px] h-12 w-full cursor-pointer;
}

.av-bar {
  @apply flex-1 min-w-[2px] rounded-full bg-neutral-300 dark:bg-neutral-600 transition-colors duration-75;
}

.av-bar--played {
  @apply bg-primary-500 dark:bg-primary-400;
}

.av-times {
  @apply flex flex-row items-center justify-between text-xs tabular-nums text-neutral-500 dark:text-neutral-400;
}

.av-times-right {
  @apply flex flex-row items-center gap-2;
}

.av-speed {
  @apply tabular-nums;
}

/* ---- Transcript ---- */
.av-transcript {
  @apply flex flex-col gap-3 w-full;
}

.av-transcript-head {
  @apply flex flex-row items-center gap-2;
}

.av-transcript-title {
  @apply text-sm font-semibold text-neutral-900 dark:text-neutral-100;
}

.av-segments {
  @apply flex flex-col;
}

/* A row rather than a paragraph: the timestamp is a control, and the whole
   line is the target because a 4-character timestamp is not. */
.av-segment {
  @apply
    flex flex-row gap-3 items-baseline
    w-full text-left
    px-2 py-1.5 rounded-lg
    transition-colors duration-100
    hover:bg-neutral-100 dark:hover:bg-neutral-800
  ;
}

.av-segment--active {
  @apply bg-primary-50 dark:bg-primary-950/40;
}

.av-segment-time {
  @apply text-xs tabular-nums text-neutral-400 dark:text-neutral-500 shrink-0 w-10;
}

.av-segment--active .av-segment-time {
  @apply text-primary-600 dark:text-primary-400;
}

.av-segment-text {
  @apply text-sm leading-relaxed text-neutral-700 dark:text-neutral-200;
}

.av-plain {
  @apply text-sm leading-relaxed text-neutral-700 dark:text-neutral-200 whitespace-pre-wrap px-2;
}

/* ---- States ---- */
.av-state {
  @apply
    flex flex-row items-center gap-2
    text-sm text-neutral-500 dark:text-neutral-400
    px-2 py-3
  ;
}

.av-state--offer {
  @apply flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between;
}

.av-empty {
  @apply flex flex-col items-center justify-center gap-2 h-full text-sm text-neutral-500 dark:text-neutral-400;
}

.av-empty-icon {
  @apply size-8;
}
</style>
