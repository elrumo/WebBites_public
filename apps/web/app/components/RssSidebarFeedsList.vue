<template>
  <div class="px-1 flex items-center justify-between">
    <button
      type="button"
      class="flex items-center gap-1 min-w-0 opacity-70 hover:opacity-100 transition-opacity"
      @click="expanded = !expanded"
    >
      <UIcon
        name="i-tabler-chevron-down"
        class="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
        :class="{ '-rotate-90': !expanded }"
      />
      <h4 class="label">
        {{ $t('rss.sidebar.feeds') }}
      </h4>
    </button>
    <div class="flex items-center">
      <UButton
        size="xs"
        square
        variant="ghost"
        icon="i-tabler-plus"
        class="opacity-60 hover:opacity-100 p-1"
        :title="$t('rss.add_feed.title')"
        @click="showAddFeedModal = true"
      />
      <UDropdownMenu :items="overflowItems">
        <UButton
          size="xs"
          square
          variant="ghost"
          icon="i-tabler-dots"
          class="opacity-60 hover:opacity-100 p-1"
        />
      </UDropdownMenu>
    </div>
  </div>

  <UCollapsible v-model:open="expanded" :unmount-on-hide="false">
    <template #content>
      <div class="bookmark-sidebar-list">
        <div v-if="rssSubscriptionsLoading && !rssSubscriptionsLoaded" class="flex justify-center py-3">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin opacity-50" />
        </div>

        <UTabs
          :items="feedTabItems"
          v-model="selectedScope"
          value-key="value"
          orientation="vertical"
          size="sm"
          :ui="{
            root: ['flex items-center gap-4'],
            list: 'relative w-full h-full bg-transparent dark:bg-transparent p-0',
            indicator: [
              'bg-neutral-600 dark:bg-neutral-950 ring-1 ring-neutral-200/20 dark:ring-neutral-700/50 shadow-md shadow-neutral-600/20 dark:shadow-black/30 rounded-lg transition-all duration-200 ease-out',
              isRssActive ? 'opacity-100' : 'opacity-0'
            ],
            trigger: 'w-full relative mb-0.5 px-2 w-full h-7 text-gray-500 transition-colors rounded-lg data-[state=inactive]:hover:bg-neutral-200 data-[state=inactive]:dark:hover:bg-neutral-700/60 data-[state=active]:bg-transparent data-[state=active]:text-white dark:data-[state=active]:text-white',
            label: 'w-full truncate'
          }"
          :content="false"
        >
          <template #default="{ item, selected }">
            <span class="flex items-center justify-between gap-0.5 w-full text-sm p-0.5 group/feed">
              <span class="flex items-center gap-2 min-w-0 truncate w-full">
                <img
                  v-if="item.iconUrl"
                  :src="item.iconUrl"
                  class="w-3.5 h-3.5 rounded-sm flex-shrink-0"
                  :class="selected ? 'opacity-100' : 'opacity-70'"
                  alt=""
                  loading="lazy"
                  @error="onIconError"
                />
                <UIcon
                  v-else
                  :name="item.glyph || 'i-tabler-rss'"
                  class="w-3.5 h-3.5 flex-shrink-0"
                  :class="selected ? 'opacity-100' : 'opacity-60'"
                />
                <span class="truncate" :class="selected ? 'font-medium' : 'font-normal'">
                  {{ item.label }}
                </span>
              </span>

              <span class="flex items-center gap-1 flex-shrink-0">
                <span v-if="item.unreadCount > 0" class="text-xs opacity-50 group-hover/feed:pr-1 transition-all tabular-nums">
                  {{ item.unreadCount }}
                </span>

                <UButton
                  v-if="item.subscription"
                  size="2xs"
                  variant="ghost"
                  square
                  icon="i-tabler-pencil"
                  class="opacity-0 rounded-md group-hover/feed:opacity-100 transition-all -ml-4 group-hover/feed:ml-0 p-0.5"
                  :class="selected ? 'text-white dark:text-white' : ''"
                  @click.stop="openFeedSettings(item.subscription)"
                />
              </span>
            </span>
          </template>
        </UTabs>
      </div>
    </template>
  </UCollapsible>

  <!-- OPML import is a file the user picks; the input itself stays hidden. -->
  <input
    ref="opmlInput"
    type="file"
    accept=".opml,.xml,text/xml,application/xml"
    class="hidden"
    @change="onOpmlPicked"
  />
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const expanded = ref(true)

const { t } = useI18n()
const store = useStore()
const { fetchRssSubscriptions, selectRssScope } = store
const {
  rssSubscriptions,
  rssTotalUnread,
  rssScope,
  rssSubscriptionsLoaded,
  rssSubscriptionsLoading,
  showAddFeedModal,
  showFeedSettingsModal,
  feedToEdit
} = storeToRefs(store)

const isRssActive = computed(() => rssScope.value !== null)
const opmlInput = ref(null)

/**
 * All Articles and Unread sit above the feeds as pseudo-rows, so the whole
 * group is one `UTabs` and the selection indicator can travel between them.
 */
const feedTabItems = computed(() => [
  {
    value: 'all',
    label: t('rss.sidebar.all_articles'),
    glyph: 'i-tabler-rss',
    unreadCount: 0,
    subscription: null
  },
  {
    value: 'unread',
    label: t('rss.sidebar.unread'),
    glyph: 'i-tabler-circle-dot',
    unreadCount: rssTotalUnread.value,
    subscription: null
  },
  ...rssSubscriptions.value.map(sub => ({
    value: sub.id,
    label: sub.title,
    iconUrl: sub.feed?.iconUrl,
    unreadCount: sub.unreadCount ?? 0,
    subscription: sub
  }))
])

const selectedScope = computed({
  get() {
    return rssScope.value ?? '__none__'
  },
  set(value) {
    if (value && value !== '__none__') selectRssScope(value)
  }
})

const overflowItems = computed(() => [[
  { label: t('rss.sidebar.import_opml'), icon: 'i-tabler-file-import', onSelect: () => opmlInput.value?.click() },
  { label: t('rss.sidebar.export_feeds'), icon: 'i-tabler-file-export', onSelect: exportFeeds },
  { label: t('rss.mark_all_read'), icon: 'i-tabler-checks', onSelect: () => store.markAllRssRead(null) }
]])

const openFeedSettings = (subscription) => {
  feedToEdit.value = subscription
  showFeedSettingsModal.value = true
}

/**
 * A feed icon that 404s should fall back to the generic glyph rather than
 * leave a broken-image box in the sidebar — third-party favicons disappear
 * all the time.
 */
const onIconError = (event) => {
  event.target.style.display = 'none'
}

const onOpmlPicked = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const opml = await file.text()
    const { importOpml } = useRssFeeds()
    const result = await importOpml(opml)
    await fetchRssSubscriptions()

    // A large import is only partly done when the request returns, so the
    // message has to distinguish what landed from what is still arriving.
    const parts = [t('rss.sidebar.import_added', { count: result.subscribed.length }, result.subscribed.length)]
    if (result.queued > 0) parts.push(t('rss.sidebar.import_queued', { count: result.queued }))
    if (result.failed.length > 0) parts.push(t('rss.sidebar.import_failed_rows', { count: result.failed.length }))
    store.showAlert({ message: parts.join(' · ') })
  } catch (error) {
    console.error('[RSS] OPML import failed:', error)
    store.showAlert({ message: t('rss.sidebar.import_failed'), type: 'danger' })
  } finally {
    // Clear the input so picking the same file twice still fires a change.
    event.target.value = ''
  }
}

const exportFeeds = async () => {
  try {
    const { exportOpml } = useRssFeeds()
    const opml = await exportOpml()
    const blob = new Blob([opml], { type: 'text/x-opml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'webbites-feeds.opml'
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('[RSS] OPML export failed:', error)
    store.showAlert({ message: t('rss.sidebar.export_failed'), type: 'danger' })
  }
}

onMounted(() => {
  if (!rssSubscriptionsLoaded.value && !rssSubscriptionsLoading.value) {
    fetchRssSubscriptions()
  }
})
</script>
