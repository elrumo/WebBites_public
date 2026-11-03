<template>
  <div class="rss-article-list">
    <!-- List header: filter, unread toggle, mark-all -->
    <div class="rss-list-header">
      <UInput
        v-model="rssFilterText"
        size="sm"
        variant="none"
        icon="i-tabler-filter"
        :placeholder="$t('rss.list.filter')"
        class="flex-1"
        :ui="{ base: 'bg-transparent' }"
      />

      <!-- The Unread scope *is* the unread filter, so the toggle would be
           inert there rather than merely redundant. -->
      <UButton
        v-if="rssScope !== 'unread'"
        size="xs"
        square
        variant="ghost"
        :icon="rssUnreadOnly ? 'i-tabler-circle-dot' : 'i-tabler-circle'"
        :title="rssUnreadOnly ? $t('rss.list.showing_unread') : $t('rss.list.show_unread')"
        @click="setRssUnreadOnly(!rssUnreadOnly)"
      />

      <UButton
        size="xs"
        square
        variant="ghost"
        icon="i-tabler-refresh"
        :title="$t('rss.list.refresh')"
        :loading="rssLoading"
        @click="refreshFeed"
      />

      <UPopover v-model:open="confirmMarkAll" :content="{ positionStrategy: 'absolute' }">
        <UButton
          size="xs"
          square
          variant="ghost"
          icon="i-tabler-checks"
          :title="$t('rss.mark_all_read')"
          :disabled="rssTotalUnread === 0"
        />

        <template #content>
          <div class="flex flex-col items-center gap-3 p-3 text-center">
            <p class="text-sm m-0">{{ markAllScopeLabel }}</p>
            <UButton size="sm" @click="confirmMarkAll = false; markAllRssRead()">
              {{ $t('rss.mark_all_read') }}
            </UButton>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- Skeleton rows shaped like real ones, so switching feeds paints the
         list instantly instead of waiting on the request. -->
    <div v-if="rssLoading && rssItems.length === 0" class="rss-list-scroll">
      <div v-for="n in 8" :key="n" class="rss-row pointer-events-none">
        <span class="rss-row-dot bg-transparent" />
        <span class="rss-row-body">
          <USkeleton class="h-3.5 rounded" :class="n % 3 === 0 ? 'w-2/3' : 'w-full'" />
          <USkeleton class="h-3 w-5/6 rounded" />
          <USkeleton class="h-2.5 w-1/3 rounded" />
        </span>
        <USkeleton v-if="n % 2 === 0" class="rss-row-thumb" />
      </div>
    </div>

    <div v-else-if="filteredRssItems.length === 0" class="rss-list-scroll">
      <div class="rss-empty">
        <UIcon :name="emptyState.icon" class="w-8 h-8 opacity-40" />
        <p class="font-medium m-0">{{ emptyState.title }}</p>
        <p class="text-sm opacity-60 m-0">{{ emptyState.description }}</p>
        <UButton
          v-if="rssSubscriptions.length === 0"
          size="sm"
          class="mt-2"
          @click="showAddFeedModal = true"
        >
          {{ $t('rss.add_feed.title') }}
        </UButton>
      </div>
    </div>

    <!-- Rows vary in height (excerpt, thumbnail), so the dynamic scroller
         measures each one. The buffer doubles as the pagination threshold:
         once the last row is rendered into it, load the next page. -->
    <DynamicScroller
      v-else
      class="rss-list-scroll"
      :items="filteredRssItems"
      :min-item-size="64"
      :buffer="400"
      key-field="id"
      emit-update
      @update="onRangeUpdate"
    >
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="[item.title, item.excerpt, item.imageUrl]"
        >
          <UContextMenu :items="rowMenuItems(item)">
            <button
              type="button"
              class="rss-row"
              :class="{ 'rss-row-active': activeRssItem?.id === item.id }"
              @click="openRssItem(item)"
            >
              <span class="rss-row-dot" :class="{ 'is-read': item.isRead }" />

              <span class="rss-row-body">
                <span class="rss-row-title" :class="item.isRead ? 'font-normal opacity-60' : 'font-semibold'">
                  {{ item.title }}
                </span>
                <span v-if="item.excerpt" class="rss-row-excerpt">{{ item.excerpt }}</span>
                <span class="rss-row-meta">
                  <span class="truncate">{{ item.feedTitle }}</span>
                  <span v-if="item.publishedAt">·</span>
                  <span v-if="item.publishedAt">{{ relativeDate(item.publishedAt) }}</span>
                  <UIcon
                    v-if="item.hasExtracted"
                    name="i-tabler-file-text"
                    class="w-3 h-3"
                    :title="$t('rss.list.full_text')"
                  />
                  <UIcon
                    v-if="item.hasSummary"
                    name="i-tabler-sparkles"
                    class="w-3 h-3"
                    :title="$t('rss.list.summary')"
                  />
                </span>
              </span>

              <!-- Keyed so a recycled row doesn't inherit another item's
                   hidden broken image. -->
              <img
                v-if="item.imageUrl"
                :key="item.imageUrl"
                :src="item.imageUrl"
                class="rss-row-thumb"
                alt=""
                loading="lazy"
                @error="hideImage"
              />
            </button>
          </UContextMenu>
        </DynamicScrollerItem>
      </template>

      <template #after>
        <div v-if="rssLoadingMore" class="flex justify-center py-4">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin opacity-50" />
        </div>
      </template>
    </DynamicScroller>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { relativeDate } from '~/utils/relativeDate'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

const { t } = useI18n()
const store = useStore()
const { openRssItem, markAllRssRead, loadMoreRssItems, setRssUnreadOnly, loadRssItems, fetchRssSubscriptions, setRssItemRead } = store
const {
  rssItems,
  rssScope,
  rssLoading,
  rssLoadingMore,
  rssUnreadOnly,
  rssFilterText,
  rssSubscriptions,
  rssTotalUnread,
  activeRssItem,
  showAddFeedModal
} = storeToRefs(store)

const filteredRssItems = computed(() => store.filteredRssItems)
const confirmMarkAll = ref(false)

const markAllScopeLabel = computed(() =>
  store.rssActiveSubscription ? t('rss.list.confirm_feed', { title: store.rssActiveSubscription.title }) : t('rss.list.confirm_all')
)

const rowMenuItems = (item) => [{
  label: item.isRead ? t('rss.mark_unread') : t('rss.mark_read'),
  icon: item.isRead ? 'i-tabler-circle' : 'i-tabler-circle-check',
  onSelect: () => setRssItemRead(item.id, !item.isRead)
}]

/** Re-reads what the server already polled; the poller itself runs every ten minutes. */
const refreshFeed = () => Promise.all([fetchRssSubscriptions(), loadRssItems()])

const emptyState = computed(() => {
  if (rssFilterText.value.trim()) {
    return {
      icon: 'i-tabler-search-off',
      title: t('rss.list.no_matches'),
      description: t('rss.list.no_matches_description', { query: rssFilterText.value.trim() })
    }
  }
  if (rssSubscriptions.value.length === 0) {
    return {
      icon: 'i-tabler-rss',
      title: t('rss.list.no_feeds'),
      description: t('rss.list.no_feeds_description')
    }
  }
  if (rssUnreadOnly.value || rssScope.value === 'unread') {
    return {
      icon: 'i-tabler-circle-check',
      title: t('rss.list.caught_up'),
      description: t('rss.list.caught_up_description')
    }
  }
  return {
    icon: 'i-tabler-file-text',
    title: t('rss.list.no_articles'),
    description: t('rss.list.no_articles_description')
  }
})

/** `scroll-end` is declared but never emitted in vue-virtual-scroller 2.0.0-beta.10. */
const onRangeUpdate = (startIndex, endIndex) => {
  if (endIndex >= filteredRssItems.value.length) loadMoreRssItems()
}

/** Publishers' images rot; a broken box is worse than no image. */
const hideImage = (event) => {
  event.target.style.display = 'none'
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.rss-article-list {
  @apply flex flex-col h-full min-h-0 border-r border-neutral-200/60 dark:border-neutral-700/60;
}

.rss-list-header {
  @apply flex items-center gap-1 px-2 py-1.5 border-b border-neutral-200/60 dark:border-neutral-700/60;
}

.rss-list-scroll {
  @apply flex-1 min-h-0 overflow-y-auto overscroll-contain;
}

.rss-empty {
  @apply flex flex-col items-center justify-center gap-2 text-center px-6 py-16;
}

.rss-row {
  @apply w-full flex items-start gap-3 px-3 py-3 text-left
    border-b border-neutral-100 dark:border-neutral-800
    hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60
    transition-colors;
}

.rss-row-active {
  @apply bg-neutral-200/70 dark:bg-neutral-800;
}

.rss-row-dot {
  @apply w-2 h-2 mt-1.5 rounded-full flex-shrink-0;
  /* The accent lives in Nuxt UI's theme layer, which `@reference
     "tailwindcss"` does not load — so `@apply bg-primary-500` here fails to
     resolve even though the same class works in markup. The variable does. */
  background-color: var(--color-primary-500);
}

.rss-row-dot.is-read {
  @apply bg-transparent;
}

.rss-row-body {
  @apply flex flex-col gap-1 min-w-0 flex-1;
}

.rss-row-title {
  @apply text-sm leading-snug line-clamp-2;
}

.rss-row-excerpt {
  @apply text-xs opacity-60 line-clamp-2;
}

.rss-row-meta {
  @apply flex items-center gap-1 text-[11px] opacity-50 min-w-0;
}

.rss-row-thumb {
  @apply w-14 h-14 rounded-lg object-cover flex-shrink-0;
}
</style>
