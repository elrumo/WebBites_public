<template>
  <div
      :class="{
          'feedback-comment': true,
          // TODO: Add a something to let users know when it's an official answer coming from me
          'feedback-comment-admin': !!comment.author?.isTeam,
          'feedback-comment-current-user': !!comment.isMine
      }"
  >
      <UModal
          v-model:open="showDeleteCommentModal"
          @close="showDeleteCommentModal = false"
          class="auth"
      >
  <template #content>
        <div class="p-4">
          <h5 class="mt-1 font-semibold pb-1">
              {{ $t('feedback.delete_comment.title') }}
          </h5>

          <p class="pb-6 opacity-80">
              {{ $t('feedback.delete_comment.confirmation') }}
          </p>

          <div class="flex flex-row w-full justify-end">
              <UButton
                  variant="ghost"
                  @click="showDeleteCommentModal = false"
              >
                  {{ $t('common.cancel') }}
              </UButton>

              <UButton
                  @click="deleteComment"
                  variant="solid"
                  color="error"
              >
                  {{ $t('common.delete') }}
              </UButton>
          </div>
        </div>
      
  </template>
</UModal>

      <UButton
          v-if="comment.canDelete"
          variant="ghost"
          class="feedback-comment-delete square"
          @click="showDeleteCommentModal = true"
      >
          <Icon name="octicon:x-16" />
      </UButton>

      <div class="flex flex-row gap-1">
          <small>
              {{ comment.createdAt ? getDate(comment.createdAt, { showYear: true }) : '' }}
          </small>
          <small v-if="isAdmin && (comment.author?.name || comment.author?.email)" class="opacity-50">
              -
              {{ comment.author?.name || comment.author?.email }}
          </small>
      </div>

      <div class="feedback-comment-text tiptap-comment-content" v-html="safeHtml(comment.body)"></div>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()

const props = defineProps({
  comment: {
    type: Object,
    required: true
  }
})
const emit = defineEmits(['deleted'])

// Store setup
const store = useStore()
const { isAdmin } = storeToRefs(store)
const { showAlert, getDate, applyFeedbackPost } = store
const feedbackApi = useFeedbackApi()

// Reactive state
const showDeleteCommentModal = ref(false)

// Methods
const deleteComment = async () => {
  try {
    const { post } = await feedbackApi.removeComment(props.comment.postId, props.comment.id)
    applyFeedbackPost(post)
    emit('deleted', props.comment.id)
    showAlert({ message: t('feedback_comment.deleted'), type: 'success' })
  } catch (error) {
    console.error("error: ", error)
    showAlert({ title: t('feedback_comment.delete_failed'), message: error.message, type: 'error' })
  } finally {
    showDeleteCommentModal.value = false
  }
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";
/* Flat selectors: nested inside `.tiptap-comment-content { }` the :deep()
   compiled to `.tiptap-comment-content [data-v] p` and matched nothing. */
.tiptap-comment-content :deep(p) { @apply mb-2; }
.tiptap-comment-content :deep(p:last-child) { @apply mb-0; }
.tiptap-comment-content :deep(strong) { @apply font-bold; }
.tiptap-comment-content :deep(em) { @apply italic; }
.tiptap-comment-content :deep(s) { @apply line-through; }
.tiptap-comment-content :deep(a) { @apply text-green-500 underline cursor-pointer hover:text-green-600; }
.tiptap-comment-content :deep(ul) { @apply list-disc pl-5 mb-2; }
.tiptap-comment-content :deep(ol) { @apply list-decimal pl-5 mb-2; }
.tiptap-comment-content :deep(li) { @apply mb-1; }
.tiptap-comment-content :deep(code) { @apply bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono; }
.tiptap-comment-content :deep(pre) { @apply bg-gray-100 dark:bg-gray-800 p-3 rounded mb-2 overflow-x-auto; }
.tiptap-comment-content :deep(pre code) { @apply bg-transparent p-0; }
.tiptap-comment-content :deep(blockquote) { @apply border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic mb-2; }
.tiptap-comment-content :deep(h1) { @apply text-2xl font-bold mb-2; }
.tiptap-comment-content :deep(h2) { @apply text-xl font-bold mb-2; }
.tiptap-comment-content :deep(h3) { @apply text-lg font-bold mb-2; }
</style>
