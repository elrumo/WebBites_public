<template>
  <UModal v-model:open="showFeedSettingsModal">
    <template #content>
      <div v-if="feedToEdit" class="p-6 flex flex-col gap-4">
        <h5 class="m-0 font-semibold">{{ feedToEdit.title }}</h5>

        <UFormField :label="$t('rss.settings.name')" :hint="customTitle ? '' : $t('rss.settings.name_hint')">
          <UInput
            v-model="customTitle"
            :placeholder="feedToEdit.feed?.title"
            :maxlength="100"
          />
        </UFormField>

        <div class="flex flex-col gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800">
          <div class="flex items-center justify-between gap-4">
            <label class="text-sm font-medium">{{ $t('rss.settings.fetch_full') }}</label>
            <USwitch v-model="extractionEnabled" />
          </div>
          <p class="text-xs opacity-60 m-0">
            {{ $t('rss.settings.fetch_full_description') }}
          </p>
        </div>

        <div class="flex flex-col gap-1 text-xs opacity-60">
          <span class="break-all">{{ feedToEdit.feed?.feedUrl }}</span>
          <a
            v-if="feedToEdit.feed?.siteUrl"
            :href="feedToEdit.feed.siteUrl"
            target="_blank"
            rel="noopener"
            class="underline w-fit"
          >
            {{ $t('rss.settings.open_website') }}
          </a>
          <span v-if="feedToEdit.feed?.status === 'dead'" class="text-amber-600 dark:text-amber-400">
            {{ $t('rss.settings.feed_dead') }}
          </span>
        </div>

        <div class="flex justify-between items-center gap-2 mt-2">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-tabler-checks"
            :label="$t('rss.mark_all_read')"
            :disabled="(feedToEdit.unreadCount ?? 0) === 0"
            @click="markAllRead"
          />
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="close" />
            <UButton :loading="saving" :disabled="!hasChanges" :label="$t('common.save')" @click="save" />
          </div>
        </div>

        <div class="flex justify-start border-t pt-3 dark:border-neutral-700">
          <UButton
            color="error"
            variant="ghost"
            :loading="unsubscribing"
            :label="$t('rss.settings.unsubscribe')"
            @click="unsubscribe"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const store = useStore()
const { showFeedSettingsModal, feedToEdit, showUpgradeModal } = storeToRefs(store)

const customTitle = ref('')
const extractionEnabled = ref(false)
const saving = ref(false)
const unsubscribing = ref(false)

watch(feedToEdit, (subscription) => {
  customTitle.value = subscription?.customTitle || ''
  extractionEnabled.value = subscription?.extractionEnabled || false
}, { immediate: true })

const hasChanges = computed(() =>
  customTitle.value !== (feedToEdit.value?.customTitle || '') ||
  extractionEnabled.value !== (feedToEdit.value?.extractionEnabled || false)
)

const close = () => {
  showFeedSettingsModal.value = false
  feedToEdit.value = null
}

const save = async () => {
  if (!feedToEdit.value) return
  saving.value = true
  try {
    const trimmed = customTitle.value.trim()
    await store.updateRssSubscription(feedToEdit.value.id, {
      // `null` clears the rename; omitting the key would mean "leave it alone",
      // which is a different thing and would make un-renaming impossible.
      customTitle: trimmed || null,
      extractionEnabled: extractionEnabled.value
    })
    close()
  } catch (error) {
    // The one failure worth handling in place: turning extraction on without
    // the plan for it. The proxy forwards the backend's UsageError body.
    const body = error?.data?.data || error?.data
    if (body?.errorType === 'UsageError') {
      extractionEnabled.value = false
      showFeedSettingsModal.value = false
      showUpgradeModal.value = true
    } else {
      console.error('[RSS] Feed settings save failed:', error)
      store.showAlert({ message: t('rss.settings.save_failed'), type: 'danger' })
    }
  } finally {
    saving.value = false
  }
}

const markAllRead = async () => {
  if (!feedToEdit.value) return
  await store.markAllRssRead(feedToEdit.value.id)
  close()
}

const unsubscribe = async () => {
  if (!feedToEdit.value) return
  unsubscribing.value = true
  try {
    await store.unsubscribeFromRssFeed(feedToEdit.value.id)
    close()
  } finally {
    unsubscribing.value = false
  }
}
</script>
