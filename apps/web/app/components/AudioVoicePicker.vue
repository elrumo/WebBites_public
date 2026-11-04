<!-- Voice picker for the listen-to-article feature. Choice persists in userOptions.aiVoice. -->
<template>
  <UPopover @update:open="open => !open && stopPreview()">
    <UTooltip :text="$t('reader.voice_settings')">
      <UButton
        variant="ghost"
        color="neutral"
        size="sm"
        square
        class="rounded-full"
        icon="i-tabler-adjustments-horizontal"
        :aria-label="$t('reader.voice_settings')"
      />
    </UTooltip>

    <template #content>
      <div class="p-4 w-72">
        <h6 class="mb-1 font-bold opacity-80">{{ $t('reader.voice_settings') }}</h6>
        <p class="text-xs opacity-60 mb-3">{{ $t('reader.voice_description') }}</p>

        <div class="flex flex-col gap-0.5 max-h-64 overflow-y-auto -mx-1">
          <div
            v-for="voice in audioVoices"
            :key="voice.id"
            role="radio"
            tabindex="0"
            :aria-checked="userOptions.aiVoice === voice.id"
            class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800"
            :class="{ 'bg-neutral-100 dark:bg-neutral-800': userOptions.aiVoice === voice.id }"
            @click="select('aiVoice', voice.id)"
            @keydown.enter.space.prevent="select('aiVoice', voice.id)"
          >
            <UButton
              variant="soft"
              color="neutral"
              size="xs"
              square
              class="rounded-full"
              :icon="previewing === `voices/${voice.id}` ? 'i-tabler-player-stop-filled' : 'i-tabler-player-play-filled'"
              :aria-label="$t('reader.voice_preview')"
              @click.stop="togglePreview(`voices/${voice.id}`)"
            />
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-medium capitalize">{{ voice.id }}</span>
              <span class="block text-xs opacity-60">{{ $t(`audio_voice_picker.voices.${voice.id}`) }}</span>
            </span>
            <UIcon v-if="userOptions.aiVoice === voice.id" name="i-tabler-check" class="w-4 h-4 shrink-0" />
          </div>
        </div>

        <h6 class="mt-4 mb-1 font-bold opacity-80">{{ $t('reader.accent_settings') }}</h6>
        <p class="text-xs opacity-60 mb-2">{{ $t('reader.accent_description') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="accent in audioAccents"
            :key="accent.id"
            size="xs"
            color="neutral"
            :variant="userOptions.aiAccent === accent.id ? 'solid' : 'soft'"
            :icon="previewing === `accents/${accent.id}` ? 'i-tabler-player-stop-filled' : 'i-tabler-player-play-filled'"
            :label="$t(`audio_voice_picker.accents.${accent.id}`)"
            :aria-pressed="userOptions.aiAccent === accent.id"
            @click="select('aiAccent', accent.id); togglePreview(`accents/${accent.id}`)"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { audioVoices, audioAccents } from '~/composables/useStoreConstants'

const store = useStore()
const { userOptions } = storeToRefs(store)

const previewing = ref(null)
let player = null

const stopPreview = () => {
  player?.pause()
  previewing.value = null
}

/** `path` is `voices/<id>` or `accents/<id>`, under /public/audio. */
const togglePreview = (path) => {
  if (previewing.value === path) return stopPreview()
  if (!player) {
    player = new Audio()
    player.addEventListener('ended', stopPreview)
    player.addEventListener('error', stopPreview)
  }
  player.src = `/audio/${path}.mp3`
  previewing.value = path
  player.play().catch(stopPreview)
}

const select = (key, id) => {
  if (userOptions.value[key] === id) return
  userOptions.value[key] = id
  store.saveUserOptions(key)
}

onBeforeUnmount(stopPreview)
</script>
