<template>
  <UModal v-model:open="showAddFeedModal">
    <template #content>
      <div class="flex flex-col max-h-[70vh]">
        <div class="p-5 pb-3 flex flex-col gap-3">
          <h5 class="m-0 font-semibold">{{ $t('rss.add_feed.title') }}</h5>

          <!-- One field for both: people do not know whether they have a feed
               address or just a name. The backend resolves an address live and
               matches a name against feeds other WebBites users already read. -->
          <UInput
            v-model="query"
            icon="i-tabler-search"
            :placeholder="$t('rss.add_feed.placeholder')"
            autofocus
            :loading="searching"
            @keydown.enter="search(true)"
          />
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
          <div v-if="!query.trim()" class="empty">
            <UIcon name="i-tabler-rss" class="w-8 h-8 opacity-30" />
            <p class="text-sm opacity-60 m-0">
              {{ $t('rss.add_feed.hint') }}
            </p>
          </div>

          <div v-else-if="searching && candidates.length === 0" class="empty">
            <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin opacity-50" />
          </div>

          <!-- Name search only sees feeds someone here already reads, so an
               empty result is an ordinary outcome — and the address still is
               worth a try, which is why that hint stays on screen. -->
          <div v-else-if="hasSearched && candidates.length === 0" class="empty">
            <UIcon name="i-tabler-help-circle" class="w-8 h-8 opacity-30" />
            <p class="font-medium m-0">{{ $t('rss.add_feed.nothing_found') }}</p>
            <p class="text-sm opacity-60 m-0">
              {{ $t('rss.add_feed.no_match', { query: query.trim() }) }}
            </p>
          </div>

          <div
            v-for="candidate in candidates"
            :key="candidate.feedUrl"
            class="candidate"
          >
            <img
              v-if="candidate.iconUrl"
              :src="candidate.iconUrl"
              class="w-7 h-7 rounded-md flex-shrink-0"
              alt=""
              loading="lazy"
              @error="hideImage"
            />
            <UIcon v-else name="i-tabler-rss" class="w-7 h-7 opacity-40 flex-shrink-0" />

            <div class="flex flex-col min-w-0 flex-1 gap-0.5">
              <span class="text-sm font-medium truncate">{{ candidate.title }}</span>
              <span class="text-xs opacity-60 line-clamp-2">
                {{ candidate.description || candidate.siteUrl || candidate.feedUrl }}
              </span>
              <span
                v-if="candidate.source === 'catalogue' && candidate.subscriberCount > 0"
                class="text-[11px] opacity-40"
              >
                {{ $t('rss.add_feed.readers', { count: candidate.subscriberCount }, candidate.subscriberCount) }}
              </span>
            </div>

            <!-- Shown, not hidden: "why isn't this appearing" should be
                 answered on screen. -->
            <UIcon
              v-if="candidate.alreadySubscribed"
              name="i-tabler-check"
              class="w-5 h-5 opacity-50 flex-shrink-0"
              :title="$t('rss.add_feed.already_subscribed')"
            />
            <UButton
              v-else
              size="xs"
              :loading="subscribingTo === candidate.feedUrl"
              :label="$t('rss.add_feed.add')"
              @click="subscribe(candidate)"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 p-4 pt-2 border-t dark:border-neutral-700">
          <UButton color="neutral" variant="ghost" :label="$t('rss.add_feed.done')" @click="showAddFeedModal = false" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const store = useStore()
const { showAddFeedModal } = storeToRefs(store)

const query = ref('')
const candidates = ref([])
const searching = ref(false)
const hasSearched = ref(false)
const subscribingTo = ref(null)

let debounceTimer = null
/** Guards against an earlier, slower search overwriting a later one. */
let searchToken = 0

/**
 * Debounced: discovery for an address is a live fetch of the user's site, so
 * firing one per keystroke would hammer someone else's server.
 */
const search = async (immediately = false) => {
  if (debounceTimer) clearTimeout(debounceTimer)

  const trimmed = query.value.trim()
  if (!trimmed) {
    candidates.value = []
    hasSearched.value = false
    searching.value = false
    return
  }

  const run = async () => {
    const token = ++searchToken
    searching.value = true
    try {
      const { discoverFeeds } = useRssFeeds()
      const response = await discoverFeeds(trimmed)
      if (token !== searchToken) return
      candidates.value = response.candidates || []
      hasSearched.value = true
    } catch (error) {
      if (token !== searchToken) return
      console.error('[RSS] Discovery failed:', error)
      candidates.value = []
      hasSearched.value = true
    } finally {
      if (token === searchToken) searching.value = false
    }
  }

  if (immediately) {
    await run()
  } else {
    debounceTimer = setTimeout(run, 450)
  }
}

const subscribe = async (candidate) => {
  subscribingTo.value = candidate.feedUrl
  try {
    await store.subscribeToRssFeed(candidate.feedUrl)
    // Reflect it in place rather than re-running discovery: the user may still
    // want to add a second feed from the same results.
    candidate.alreadySubscribed = true
  } catch (error) {
    store.showAlert({
      message: error?.data?.statusMessage || t('rss.add_feed.subscribe_failed'),
      type: 'danger'
    })
  } finally {
    subscribingTo.value = null
  }
}

const hideImage = (event) => {
  event.target.style.display = 'none'
}

watch(query, () => search(false))

// Reopening should start clean rather than showing the previous search.
watch(showAddFeedModal, (open) => {
  if (!open) {
    query.value = ''
    candidates.value = []
    hasSearched.value = false
  }
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.empty {
  @apply flex flex-col items-center justify-center gap-2 text-center px-6 py-12;
}

.candidate {
  @apply flex items-center gap-3 px-3 py-2 rounded-lg
    hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors;
}
</style>
