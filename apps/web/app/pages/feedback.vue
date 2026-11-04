<template>
  <div class="fb-page dark">
      <LandingNavBar :isLandingPage="true" />
      <img class="fixed top-0 left-0 w-screen h-screen mix-blend-multiply opacity-40 pointer-events-none" src="/images/grain_2.webp" alt="" />

      <UModal v-model:open="showFeedbackToDeleteModal" :ui="{ content: 'dark dark:bg-neutral-800 ring-white/10' }">
        <template #content>
          <div class="p-5 flex flex-col gap-3 text-white">
              <h4 class="text-lg font-semibold">
                  {{ $t('common.delete') }}
              </h4>

              <p class="text-neutral-400!">
                  {{ $t('feedback.delete_confirmation') }}
              </p>

              <div class="flex justify-end gap-2 mt-3">
                  <UButton color="neutral" variant="ghost" @click="showFeedbackToDeleteModal = false">
                      {{ $t('common.cancel') }}
                  </UButton>

                  <UButton color="error" @click="deleteFeedback">
                      {{ $t('common.delete') }}
                  </UButton>
              </div>
          </div>
        </template>
      </UModal>

      <FeedbackInfoModal ref="infoModal" />

      <header class="fb-hero">
        <h1 class="fb-title">
          {{ $t('feedback.hero_title') }}
          <span class="block landing-page-title text-shadow-green">{{ $t('feedback.hero_highlight') }}</span>
        </h1>
        <p class="hero-subtitle">
          {{ $t('feedback.hero_subtitle') }}
        </p>
        <ClientOnly>
          <UButton color="neutral" size="lg" icon="i-heroicons-plus" class="rounded-xl font-bold" @click="openFeedbackForm">
            {{ $t('navigation.feedback') }}
          </UButton>
        </ClientOnly>
      </header>

      <div class="fb-body" :class="viewMode === 'list' ? 'max-w-3xl' : 'max-w-none'">
          <div class="fb-toolbar">
              <UInput
                  v-model="feedbackSearch"
                  id="input-feedback-title"
                  icon="i-heroicons-magnifying-glass"
                  size="lg"
                  :placeholder="$t('feedback.placeholders.search', { count: filteredFeedback.length })"
                  class="flex-1 min-w-48"
                  :ui="{ base: 'rounded-xl' }"
              />

              <div class="flex items-center gap-2">
                <USelectMenu
                    v-model="orderBy"
                    :items="orderByOptions"
                    :search-input="false"
                    :aria-label="$t('feedback.order_by')"
                    icon="i-heroicons-arrows-up-down"
                    size="lg"
                    class="w-36"
                    :ui="{ base: 'rounded-xl' }"
                />

                <UButton
                  color="neutral"
                  variant="outline"
                  size="lg"
                  class="rounded-xl"
                  :icon="orderIsAscending ? 'i-heroicons-bars-arrow-up' : 'i-heroicons-bars-arrow-down'"
                  :aria-label="orderIsAscending ? $t('common.ascending') : $t('common.descending')"
                  @click="orderIsAscending = !orderIsAscending"
                />

                <UButton
                    v-if="isAdmin"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="rounded-xl"
                    :icon="viewMode === 'list' ? 'i-heroicons-view-columns' : 'i-heroicons-list-bullet'"
                    :aria-label="viewMode === 'list' ? $t('feedback.page.kanban_view') : $t('feedback.page.list_view')"
                    @click="viewMode = viewMode === 'list' ? 'kanban' : 'list'"
                />
              </div>
          </div>

          <!-- Status filters, same chips as the FAQ topic rail -->
          <nav class="fb-chips" :aria-label="$t('feedback.status')">
            <button
              v-for="status in feedbackStatusOptions"
              :key="status.value"
              type="button"
              class="fb-chip"
              :class="{ active: filterByStatus.some(s => s.value === status.value) }"
              :aria-pressed="filterByStatus.some(s => s.value === status.value)"
              @click="selectStatus(status)"
            >
              <span class="size-2 rounded-full bg-current" :class="getBadgeColor(status, 'text')" aria-hidden="true" />
              {{ status.label }}
              <span class="fb-chip-count">{{ statusCount[status.value] || 0 }}</span>
            </button>
          </nav>

          <Transition name="slide-up">
              <!-- List View -->
              <TransitionGroup
                  v-if="viewMode === 'list' && filteredFeedback && filteredFeedback.length > 0"
                  tag="div"
                  class="flex flex-col gap-3 relative pb-24"
                  name="slide-up"
              >
                  <FeedbackCard
                      v-for="feedbackItem in filteredFeedback"
                      :key="feedbackItem.id"
                      :item="feedbackItem"
                  />
              </TransitionGroup>

              <!-- Kanban View -->
              <div v-else-if="viewMode === 'kanban' && filteredFeedback && filteredFeedback.length > 0" class="kanban-view pb-10">
                  <div
                      v-for="status in feedbackStatusOptions"
                      :key="status.value"
                      class="flex-shrink-0 w-96 flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] transition"
                      :class="{ 'ring-2 ring-green-400/60': dragOverColumn === status.value }"
                      @drop="onDrop($event, status.value)"
                      @dragover.prevent="onDragOver($event, status.value)"
                      @dragleave="onDragLeave"
                  >
                      <!-- Column Header -->
                      <div class="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
                          <span class="size-2 rounded-full bg-current" :class="getBadgeColor(status, 'text')" aria-hidden="true" />
                          {{ status.label }}
                          <span class="ml-auto text-xs text-neutral-500 tabular-nums">{{ feedbackByStatus[status.value]?.length || 0 }}</span>
                      </div>

                      <!-- Column Content -->
                      <div class="kanban-column flex-1 flex flex-col gap-3 min-h-[200px] px-3 pb-3 max-h-[84vh] overflow-auto">
                          <TransitionGroup name="slide-up">
                              <div
                                  v-for="feedbackItem in feedbackByStatus[status.value]"
                                  :key="feedbackItem.id"
                                  draggable="true"
                                  @dragstart="onDragStart($event, feedbackItem)"
                                  @dragend="onDragEnd"
                                  class="cursor-move"
                              >
                                  <FeedbackCard :item="feedbackItem" />
                              </div>
                          </TransitionGroup>
                      </div>
                  </div>
              </div>

              <div v-else-if="!isLoading" class="fb-empty">
                  <UIcon name="i-heroicons-inbox" class="size-8 text-neutral-500" />
                  <p>{{ $t('feedback.no_feedback') }}</p>
              </div>

              <div v-else class="flex justify-center items-center p-10">
                <UIcon
                    name="i-tabler-loader-2"
                    class="w-6 h-6 animate-spin text-neutral-400"
                />
              </div>
          </Transition>
      </div>

      <FeedbackForm />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useStore } from '~/stores/myStore';
import { storeToRefs } from 'pinia';
import Fuse from 'fuse.js';
import Parse from 'parse';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

import { useRoute, useRouter } from 'vue-router';
const route = useRoute();
const router = useRouter();

// Pinia Store
const store = useStore();

const {
  userId,
  feedback,
  feedbackToDelete,
  showFeedbackToDeleteModal,
  showNewFeedbackModal,
  showFeedbackInfoModal,
  feedbackToShow,
  isAdmin,
  feedbackTypeOptions,
  feedbackStatusOptions
} = storeToRefs(store)

const {
    showAlert,
    getBadgeColor,
    applyFeedbackPost
  } = store;

// The board lives on HelpBites; see composables/useFeedbackApi.ts.
const feedbackApi = useFeedbackApi();
const infoModal = ref(null);

// State
const orderIsAscending = ref(false);
const isLoading = ref(true);
const feedbackSearch = ref('');
const filterByStatus = ref([]);
const filterByType = ref(null);
const filterByUser = ref({ label: t('common.all'), value: 'all' });
const filterByUserOptions = ref([
  { label: t('common.all'), value: 'all' },
  { label: t('feedback.my_issues'), value: 'me' },
]);
const viewMode = ref('list'); // 'list' or 'kanban'
const draggedItem = ref(null);
const dragOverColumn = ref(null);

const orderByOptions = ref([
  { id: 'date', label: t('feedback.date') },
  { id: 'status', label: t('feedback.status') },
  { id: 'type', label: t('feedback.form.type_label') },
  { id: 'votes', label: t('feedback.votes') },
])
const orderBy = ref(orderByOptions.value[0])

useHead({
  title: computed(() => t('feedback.page.title'))
})

// Fetch feedback data. The response also says whether this viewer may
// moderate (their identity token carries role: admin); admins then fetch again
// with hidden posts included.
const fetchFeedback = async () => {
  try {
    let result = await feedbackApi.list({ limit: 500, sort: 'new' });
    isAdmin.value = Boolean(result.viewer?.isAdmin);
    if (isAdmin.value) result = await feedbackApi.list({ limit: 500, sort: 'new', includeHidden: 1 });
    feedback.value = Array.isArray(result.posts) ? result.posts : [];
  } catch (error) {
    console.error("[feedback] Error fetching feedback: ", error);
    feedback.value = [];
    showAlert({ type: 'error', message: t('common.error_try_again') });
  } finally{
    isLoading.value = false;
  }
};

// Open the info modal when the page is opened with ?feedbackId=... Links from
// before the move to HelpBites carry the old Parse id, which the migration kept
// as the post's externalId (`parse:<id>`).
const openFeedbackFromRoute = async () => {
  const wanted = route.query.feedbackId;
  if (!wanted) return;
  let match = feedback.value.find(f => f.id === wanted);
  if (!match) {
    for (const id of [wanted, `parse:${wanted}`]) {
      try {
        match = (await feedbackApi.get(id)).post;
        break;
      } catch {}
    }
  }
  if (!match) {
    // Gone, hidden, or not visible to this user - drop the stale param instead
    // of leaving a link that opens nothing.
    router.replace({ path: route.path, query: {} });
    return;
  }
  applyFeedbackPost(match);
  feedbackToShow.value = feedback.value.find(f => f.id === match.id) || match;
  showFeedbackInfoModal.value = true;
  if (wanted !== match.id) router.replace({ path: route.path, query: { feedbackId: match.id } });
};

// Lifecycle Hooks

onMounted(async () => {
  userId.value = Parse.User.current() ? Parse.User.current().id : '';

  filterByStatus.value = feedbackStatusOptions.value.filter(status => status.value !== 'closed' && status.value !== 'done')

  // Always load the list first: live updates are a nice-to-have and must never
  // gate the initial render.
  await fetchFeedback();
  await openFeedbackFromRoute();

  await nextTick();
  stopLiveUpdates = feedbackApi.stream(onLiveEvent, fetchFeedback);
});

let stopLiveUpdates = () => {};
onUnmounted(() => stopLiveUpdates());

// Live updates from HelpBites. Posts in events carry no viewer fields
// (hasVoted, isMine, ...); applyFeedbackPost keeps ours.
const onLiveEvent = (event) => {
  if (event.type === 'feedback.post.created' || event.type === 'feedback.post.updated') {
    applyFeedbackPost(event.post);
  } else if (event.type === 'feedback.post.deleted') {
    const index = feedback.value.findIndex(f => f.id === event.postId);
    if (index !== -1) feedback.value.splice(index, 1);
    if (feedbackToShow.value?.id === event.postId) showFeedbackInfoModal.value = false;
  } else if (event.type === 'feedback.comment.created' || event.type === 'feedback.comment.deleted') {
    const post = feedback.value.find(f => f.id === event.postId);
    if (post) applyFeedbackPost({ ...post, commentCount: event.commentCount });
    if (event.type === 'feedback.comment.created') infoModal.value?.addLiveComment(event.comment);
    else infoModal.value?.removeComment(event.commentId);
  }
};

// Methods

const selectStatus = (status) => {
  const index = filterByStatus.value.findIndex(s => s.value === status.value);
  if (index === -1) {
    filterByStatus.value.push(status);
  } else {
    filterByStatus.value.splice(index, 1);
  }
};

// Drag and drop methods
const onDragStart = (event, item) => {
  draggedItem.value = item;
  event.dataTransfer.effectAllowed = 'move';
  event.target.style.opacity = '0.5';
};

const onDragEnd = (event) => {
  event.target.style.opacity = '1';
  dragOverColumn.value = null;
};

const onDragOver = (event, statusValue) => {
  event.preventDefault();
  dragOverColumn.value = statusValue;
};

const onDragLeave = (event) => {
  if (event.target.classList.contains('kanban-column')) {
    dragOverColumn.value = null;
  }
};

const onDrop = async (event, newStatus) => {
  event.preventDefault();
  dragOverColumn.value = null;

  if (!draggedItem.value || draggedItem.value.status === newStatus) {
    draggedItem.value = null;
    return;
  }

  const item = draggedItem.value;
  draggedItem.value = null;
  try {
    await store.updateFeedback(item.id, { status: newStatus });
  } catch (error) {
    console.error('Error updating feedback status:', error);
  }
};

const openFeedbackForm = () => {
  if (!userId.value) return showAlert({
    message: t('feedback.page.login_required'),
    type: 'info'
  });
  showNewFeedbackModal.value = true;
};

const deleteFeedback = async () => {
  const idToDelete = feedbackToDelete.value[0];
  if (!idToDelete) return;

  try {
    await feedbackApi.remove(idToDelete);

    // findIndex can return -1, and splice(-1, 1) would drop the last row.
    const index = feedback.value.findIndex(f => f.id === idToDelete);
    if (index !== -1) feedback.value.splice(index, 1);

    feedbackToDelete.value = [];
    showFeedbackToDeleteModal.value = false;
    showAlert({ type: 'success', message: t('feedback.page.deleted') });
  } catch (error) {
    console.log("error: ", error);
    showAlert({ type: 'error', message: t('feedback.page.delete_failed') });
  }
};

// Computed
const filteredFeedback = computed(() => {
  // Copy before filtering: the sort below would otherwise reorder the store's
  // own array from inside a computed and re-trigger it.
  let filtered = Array.isArray(feedback.value) ? [...feedback.value] : [];

  // Apply existing filters
  if (filterByType.value != null) {
    filtered = filtered.filter(item => item.type === filterByType.value.value);
  }

  if (filterByStatus.value != null && filterByStatus.value.length > 0) {
    const statusValues = filterByStatus.value.map(statusObj => statusObj.value);
    filtered = filtered.filter(item => statusValues.includes(item.status));
  }

  if (filterByUser.value != null && filterByUser.value.value !== 'all') {
    filtered = filtered.filter(item => filterByUser.value.value === 'me' ? item.isMine : item.author?.externalId === filterByUser.value.value);
  }

  // Apply search if present
  if (feedbackSearch.value.length > 0) {
    const fuseOptions = {
      shouldSort: true,
      isCaseSensitive: false,
      keys: ["body", "title"]
    };
    const fuse = new Fuse(filtered, fuseOptions);
    filtered = fuse.search(feedbackSearch.value).map(searchResult => searchResult.item);
  }

  // Apply sorting based on orderBy and orderIsAscending
  const sortByField = orderBy.value?.id;
  if (sortByField) {
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortByField) {
        case 'status':
          const statusOrder = feedbackStatusOptions.value.map(option => option.value);
          const statusAIndex = statusOrder.indexOf(a.status);
          const statusBIndex = statusOrder.indexOf(b.status);
          comparison = statusAIndex - statusBIndex;
          break;

        case 'type':
          const typeOrder = feedbackTypeOptions.value.map(option => option.value);
          const typeAIndex = typeOrder.indexOf(a.type);
          const typeBIndex = typeOrder.indexOf(b.type);
          comparison = typeAIndex - typeBIndex;
          break;

        case 'date':
          comparison = new Date(a.createdAt) - new Date(b.createdAt);
          break;

        case 'votes':
          comparison = (a.voteCount || 0) - (b.voteCount || 0);
          break;

        default:
          comparison = (a.title || '').localeCompare(b.title || '');
      }

      return orderIsAscending.value ? comparison : -comparison;
    });
  }

  return filtered;
});

const statusCount = computed(() => {
  const counts = {};
  for (const item of feedback.value || []) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
});

const feedbackByStatus = computed(() => {
  const grouped = {};

  // Initialize all status categories
  feedbackStatusOptions.value.forEach(status => {
    grouped[status.value] = [];
  });

  // Group filtered feedback by status
  filteredFeedback.value.forEach(item => {
    if (grouped[item.status]) {
      grouped[item.status].push(item);
    }
  });

  return grouped;
});

</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.fb-page {
  @apply bg-neutral-800 min-h-screen text-white relative;
  /* main.css colours h1-h6 and p from --text-color; pin the dark value. */
  --text-color: var(--color--gray-10, #efefef);
}

.fb-hero {
  @apply relative z-[1] flex flex-col items-center gap-4 text-center px-4 pt-20 pb-12 md:pt-28 md:pb-16;
}

.fb-title {
  @apply text-5xl md:text-7xl font-black leading-[0.95] tracking-tight mb-2;
}

.fb-body {
  @apply relative z-[1] w-[90%] mx-auto flex flex-col gap-4;
}

.fb-toolbar {
  @apply flex flex-wrap items-center gap-2;
}

.fb-chips {
  @apply flex gap-2 overflow-x-auto pb-2 -mx-2 px-2;
  scrollbar-width: none;
}
.fb-chips::-webkit-scrollbar { display: none; }

.fb-chip {
  @apply flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-700 bg-neutral-800/70 px-3 py-1.5 text-sm font-semibold text-gray-500 transition cursor-pointer;
  @apply hover:border-neutral-500 hover:text-white;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}
.fb-chip.active {
  @apply border-green-400/60 text-white;
  background: linear-gradient(90deg, rgba(134, 239, 172, 0.18), rgba(34, 197, 94, 0.18));
  box-shadow: 0 0 24px rgba(65, 217, 118, 0.18);
}
.fb-chip-count { @apply text-xs font-medium text-gray-500 tabular-nums; }
.fb-chip.active .fb-chip-count { @apply text-green-300; }

.fb-empty {
  @apply flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-700 py-16 text-neutral-400;
}

@media (prefers-reduced-motion: reduce) {
  .fb-chip { transition: none; }
  .text-shadow-green { animation: none; }
}
</style>
