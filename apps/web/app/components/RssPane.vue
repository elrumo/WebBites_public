<template>
  <div class="rss-pane">
    <!-- Two panes side by side from `lg` up; below that the list is the page
         and the reader replaces it, with a back button. -->
    <div
      class="rss-list-column"
      :class="{ 'hidden lg:flex': showReaderOnMobile }"
    >
      <RssArticleList />
    </div>

    <div
      class="rss-reader-column"
      :class="{ 'hidden lg:flex': !showReaderOnMobile }"
    >
      <div v-if="showReaderOnMobile" class="lg:hidden px-3 py-2 border-b border-neutral-200/60 dark:border-neutral-700/60">
        <UButton
          size="xs"
          variant="ghost"
          icon="i-tabler-chevron-left"
          :label="$t('rss.pane.articles')"
          @click="activeRssItem = null"
        />
      </div>

      <RssArticleReader />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const { activeRssItem, activeRssItemLoading } = storeToRefs(store)

/**
 * On a narrow screen the two columns are one at a time. "An article is open"
 * includes the moment it is still loading — otherwise tapping a row flashes
 * the list again before the reader arrives.
 */
const showReaderOnMobile = computed(() => Boolean(activeRssItem.value) || activeRssItemLoading.value)
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.rss-pane {
  @apply flex w-full min-h-0
    rounded-xl overflow-hidden
    ring-1 ring-neutral-200/60 dark:ring-neutral-700/60
    bg-white/60 dark:bg-neutral-900/40
    shadow-xl
  ;
  /* `dvh` accounts for mobile browser chrome (address bar) that `vh` doesn't;
     the `vh` line is a fallback for browsers that don't support it. */
  height: calc(100vh - 7rem);
  height: calc(100dvh - 7rem);
}

.rss-list-column {
  @apply flex flex-col min-h-0 w-full lg:w-[380px] lg:flex-shrink-0;
}

.rss-reader-column {
  @apply flex flex-col min-h-0 flex-1 w-full;
}
</style>
