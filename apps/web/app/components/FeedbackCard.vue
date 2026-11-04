<template>
  <article
      class="fb-card"
      role="button"
      tabindex="0"
      @click="openFeedbackModal"
      @keydown.enter.self="openFeedbackModal"
      @keydown.space.self.prevent="openFeedbackModal"
  >
      <FeedbackUpVote :item="item" />

      <div class="flex flex-col gap-2 min-w-0 flex-1">
          <div class="flex items-start gap-3">
              <h3 class="fb-card-title">
                  {{ item.title }}
              </h3>

              <UIcon v-if="item.hidden" name="i-heroicons-eye-slash" class="w-4 h-4 mt-1 shrink-0 text-neutral-500" :title="$t('feedback_card.hidden_title')" />

              <UButton
                  v-if="item.canDelete && item.isMine"
                  @click="showDeleteModal"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-octicon-trash-16"
                  class="ml-auto -mt-1 -mr-1"
                  :aria-label="$t('common.delete')"
              />
          </div>

          <div
            v-if="item.body"
            class="fb-card-body line-clamp-2"
            v-html="safeHtml(item.body)"
          />

          <div class="fb-card-meta">
              <span
                v-if="item.status"
                class="fb-status"
                :class="[getBadgeColor({ value: item.status }, 'bg'), getBadgeColor({ value: item.status }, 'text')]"
              >
                  <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {{ statusLabel }}
              </span>

              <span v-if="typeOption" class="inline-flex items-center gap-1">
                  <UIcon v-if="typeOption.icon" class="w-3.5 h-3.5" :name="typeOption.icon" />
                  {{ typeLabel }}
              </span>

              <span v-if="item.platform">{{ $t(`feedback.platform.${item.platform}`) }}</span>

              <span>{{ getDate(item.createdAt) }}</span>

              <span
                v-if="item.commentCount"
                class="inline-flex items-center gap-1 ml-auto"
                :title="$t('feedback.comments_count', { count: item.commentCount })"
              >
                  <UIcon name="i-heroicons-chat-bubble-left" class="w-3.5 h-3.5" />
                  {{ item.commentCount }}
              </span>
          </div>
      </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useRouter, useRoute } from 'vue-router'

// Props definition
const props = defineProps({
  item: {
    type: Object,
    required: true
  }
})

const { t, te } = useI18n()

// Router setup
const router = useRouter()
const route = useRoute()

// Store setup
const store = useStore()
const {
  showFeedbackToDeleteModal,
  feedbackToDelete,
  feedbackToShow,
  showFeedbackInfoModal,
} = storeToRefs(store)
const { getDate, feedbackType, getBadgeColor } = store

const typeOption = computed(() => feedbackType(props.item.type))

const typeLabel = computed(() => {
  const key = `feedback_form.types.${String(props.item.type).replaceAll('-', '_')}`
  return te(key) ? t(key) : typeOption.value.label
})

const statusLabel = computed(() => {
  const key = `feedback_card.status.${String(props.item.status).replaceAll('-', '_')}`
  return te(key) ? t(key) : props.item.status.replaceAll('-', ' ')
})

// Methods
const openFeedbackModal = (event) => {
  // The vote and delete buttons sit inside the card.
  if (event.target.closest('button')) return

  feedbackToShow.value = props.item
  showFeedbackInfoModal.value = true
  router.push({
    path: route.path,
    query: { feedbackId: props.item.id }
  })
}

const showDeleteModal = () => {
  feedbackToDelete.value = [props.item.id]
  showFeedbackToDeleteModal.value = true
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

/* Same card as the FAQ bites: lights up green on hover. */
.fb-card {
  @apply flex items-start gap-4 rounded-2xl border border-neutral-700 bg-neutral-800 p-4 md:p-5 shadow-lg cursor-pointer text-left;
  @apply transition-[border-color,box-shadow,transform] duration-300;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}
.fb-card:hover {
  border-color: rgba(65, 217, 118, 0.5);
  box-shadow: 0 0 0 1px rgba(65, 217, 118, 0.15), 0 20px 50px rgba(0, 0, 0, 0.45), 0 0 60px rgba(65, 217, 118, 0.12);
}

.fb-card-title { @apply text-lg font-bold leading-snug text-white line-clamp-2; }

.fb-card-body {
  @apply text-[15px] leading-relaxed text-neutral-400;
}

.fb-card-meta {
  @apply flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs text-neutral-500;
}

.fb-status {
  @apply inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold capitalize;
}

@media (prefers-reduced-motion: reduce) {
  .fb-card { transition: none; }
}
</style>
