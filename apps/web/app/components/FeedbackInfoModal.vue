<template>
  <UModal
    v-model:open="showFeedbackInfoModal"
    :ui="{ content: 'dark sm:max-w-2xl dark:bg-neutral-800 ring-white/10 text-white' }"
  >
  <template #content>
    <div v-if="feedbackToShow?.id" class="flex flex-col min-h-0">
      <!-- Header: vote, title, meta -->
      <header class="flex items-start gap-4 p-5 sm:p-6 border-b border-white/10">
        <FeedbackUpVote :item="feedbackToShow"/>

        <div class="flex flex-col gap-2 min-w-0 flex-1">
          <h2
              class="text-xl sm:text-2xl font-bold leading-snug rounded-md outline-none focus:bg-white/5 focus:px-2 transition-all"
              :contenteditable="Boolean(feedbackToShow.canEdit)"
              @input="debounce(() => save({ title: $event.target.innerText.trim() }), 600)"
          >
              {{ feedbackToShow.title }}
          </h2>

          <div class="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            <template v-if="!isAdmin">
              <span
                v-if="feedbackToShow.status"
                class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold capitalize"
                :class="[getBadgeColor({ value: feedbackToShow.status }, 'bg'), getBadgeColor({ value: feedbackToShow.status }, 'text')]"
              >
                  <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {{ statusLabel }}
              </span>

              <span v-if="typeOption" class="inline-flex items-center gap-1">
                  <UIcon class="w-3.5 h-3.5" :name="typeOption.icon" />
                  {{ typeLabel }}
              </span>

              <span v-if="feedbackToShow.platform">{{ $t(`feedback.platform.${feedbackToShow.platform}`) }}</span>
            </template>

            <template v-else>
              <USelectMenu
                  v-model="feedbackStatusSelected"
                  :items="feedbackStatusOptions"
                  :search-input="false"
                  :placeholder="$t('common.choose_something')"
                  class="w-36"
                  size="xs"
              >
                  <template #item="{ item }">
                    <span class="size-2 rounded-full bg-current" :class="getBadgeColor(item, 'text')" />
                    <span class="truncate">{{ item.label }}</span>
                  </template>
              </USelectMenu>

              <USelectMenu
                  v-model="feedbackTypeSelected"
                  :items="typeItems"
                  :search-input="false"
                  :placeholder="$t('common.choose_something')"
                  class="w-36"
                  size="xs"
              >
                  <template #item="{ item }">
                    <UIcon class="w-3 h-3" :name="item.icon" />
                    <span class="truncate">{{ item.label }}</span>
                  </template>
              </USelectMenu>

              <USelectMenu
                  v-model="feedbackPlatformSelected"
                  :items="platformItems"
                  :search-input="false"
                  value-key="value"
                  class="w-32"
                  size="xs"
                  @update:model-value="save({ platform: $event })"
              />
            </template>

            <span>{{ getDate(feedbackToShow.createdAt) }}</span>
            <span v-if="isAdmin && feedbackToShow.author">· {{ feedbackToShow.author.name || feedbackToShow.author.email || feedbackToShow.author.externalId }}</span>
          </div>
        </div>

        <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            class="-mt-1 -mr-2"
            :aria-label="$t('common.close')"
            @click="showFeedbackInfoModal = false"
        />
      </header>

      <!-- Body scrolls; the modal grows with it up to the viewport -->
      <div class="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
        <!-- Text description -->
        <div v-if="feedbackToShow.canEdit">
          <TiptapCommentEditor
            ref="feedbackTextEditor"
            v-model="feedbackEditableText"
            :placeholder="$t('feedback.form.comment_label')"
          />
        </div>
        <div v-else-if="feedbackToShow.body" class="tiptap-comment-content text-base leading-relaxed text-neutral-300" v-html="safeHtml(feedbackToShow.body)"></div>

        <!-- Admin only: visibility and changelog -->
        <section v-if="isAdmin" class="rounded-xl border border-white/10 bg-black/20 p-4 flex flex-col gap-4">
          <div class="flex flex-wrap gap-x-6 gap-y-2">
            <UCheckbox
              v-model="toLandingPage"
              label="Show on landing page"
              @update:model-value="save({ featured: Boolean($event) })"
            />
            <UCheckbox
              v-model="hideOnChangeLog"
              label="Hide on changelog"
              @update:model-value="save({ showOnChangelog: !$event })"
            />
            <UCheckbox
              v-model="hideFromView"
              label="Hide from view"
              @update:model-value="save({ hidden: Boolean($event) })"
            />
          </div>

          <div class="grid grid-cols-[1fr_6rem] gap-3">
            <UFormField label="Changelog title">
              <UInput
                v-model="changeLogTitle"
                placeholder="Enter changelog title..."
                @input="debounce(() => save({ changelogTitle: changeLogTitle || null }), 600)"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Icon">
              <UInput
                v-model="feedbackIcon"
                placeholder="Emoji"
                @input="debounce(() => save({ icon: feedbackIcon || null }), 600)"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="Changelog message">
            <UTextarea
              v-model="changeLogMessage"
              placeholder="Enter changelog message..."
              @input="debounce(() => save({ changelogBody: changeLogMessage || null }), 600)"
              autoresize
              color="neutral"
              class="w-full"
            />
          </UFormField>
        </section>

        <!-- Comments -->
        <section class="flex flex-col gap-4">
            <h3 class="text-sm font-semibold uppercase tracking-wider text-neutral-400!">
                {{ $t('feedback.comments.title') }}
                <span class="pl-1 text-neutral-500 tabular-nums">{{ loadingComments ? feedbackToShow.commentCount : comments.length }}</span>
            </h3>

            <div v-if="comments.length" class="flex flex-col gap-3">
                <FeedbackComment
                    v-for="comment in comments"
                    :key="comment.id"
                    :comment="comment"
                    @deleted="removeComment"
                />
            </div>

            <p v-else-if="!loadingComments" class="text-sm text-neutral-500!">
                {{ $t('feedback.comments.no_comments') }}
            </p>

            <div v-if="userId" class="flex flex-col gap-2">
                <TiptapCommentEditor
                    ref="commentEditor"
                    v-model="newCommentText"
                    :placeholder="$t('feedback.comments.placeholder')"
                    @submit="sendComment"
                />

                <UButton
                    @click="sendComment"
                    color="neutral"
                    class="self-end rounded-xl font-bold"
                    :disabled="!newCommentText"
                    :loading="loadingComment"
                >
                    {{ $t('feedback.comments.send') }}
                </UButton>
            </div>
        </section>
      </div>
    </div>
  </template>
</UModal>
</template>

<script setup>
import { ref, watch, computed, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useRouter, useRoute } from 'vue-router';
import { FeedbackSignInError } from '~/composables/useFeedbackApi'

const route = useRoute();
const router = useRouter();
const { t, te } = useI18n();
const store = useStore()
const {
    userId,
    showFeedbackInfoModal,
    feedbackToShow,
    isAdmin,
    feedbackStatusOptions,
    feedbackTypeOptions,
    feedbackPlatformOptions
} = storeToRefs(store)

const {
    showAlert,
    getDate,
    createDebounce,
    getBadgeColor,
    updateFeedback,
    applyFeedbackPost,
    feedbackType
} = store
const feedbackApi = useFeedbackApi()

// Data properties
const debounce = ref(createDebounce())
const feedbackStatusSelected = ref({})
const feedbackTypeSelected = ref({})
const feedbackPlatformSelected = ref('web')
const newCommentText = ref('')
const loadingComment = ref(false)
const loadingComments = ref(false)
const comments = ref([])
const hideOnChangeLog = ref(false)
const hideFromView = ref(false)
const changeLogMessage = ref('')
const changeLogTitle = ref('')
const feedbackIcon = ref('')
const commentEditor = ref(null)
const feedbackTextEditor = ref(null)
const toLandingPage = ref(false)
const feedbackEditableText = ref('')
// True while the fields are filled from a post, so the watchers below do not
// write the values they were just given straight back.
const populating = ref(false)

const typeOption = computed(() => feedbackType(feedbackToShow.value?.type))

// The option lists are plain English constants shared with the store; the
// labels are translated here, at the point they are shown.
const typeItems = computed(() => feedbackTypeOptions.value.map(option => ({
  ...option,
  label: t(`feedback_form.types.${option.value.replaceAll('-', '_')}`),
})))

const platformItems = computed(() => feedbackPlatformOptions.value.map(option => ({
  ...option,
  label: t(`feedback.platform.${option.value}`),
})))

const typeLabel = computed(() => {
  const key = `feedback_form.types.${String(feedbackToShow.value?.type).replaceAll('-', '_')}`
  return te(key) ? t(key) : typeOption.value.label
})

const statusLabel = computed(() => {
  const status = String(feedbackToShow.value?.status ?? '')
  const key = `feedback_card.status.${status.replaceAll('-', '_')}`
  return te(key) ? t(key) : status.replaceAll('-', ' ')
})

function populate(post) {
  populating.value = true
  feedbackStatusSelected.value = feedbackStatusOptions.value.find(option => option.value === post.status) || {}
  feedbackTypeSelected.value = typeItems.value.find(option => option.value === post.type) || {}
  feedbackPlatformSelected.value = post.platform || 'web'
  hideOnChangeLog.value = !post.showOnChangelog
  hideFromView.value = Boolean(post.hidden)
  changeLogMessage.value = post.changelogBody || ''
  changeLogTitle.value = post.changelogTitle || ''
  feedbackIcon.value = post.icon || ''
  toLandingPage.value = Boolean(post.featured)
  feedbackEditableText.value = post.body || ''
  nextTick(() => { populating.value = false })
}

async function save(patch) {
  const id = feedbackToShow.value?.id
  if (!id) return
  try {
    await updateFeedback(id, patch)
  } catch {
    // updateFeedback already told the user.
  }
}

async function loadComments(id) {
  loadingComments.value = true
  comments.value = []
  try {
    const result = await feedbackApi.get(id)
    if (feedbackToShow.value?.id !== result.post.id) return
    applyFeedbackPost(result.post)
    comments.value = result.comments
  } catch (error) {
    console.error('[FeedbackInfoModal] Could not load comments: ', error)
  } finally {
    loadingComments.value = false
  }
}

// Watchers
watch(showFeedbackInfoModal, (open) => {
  if (open && feedbackToShow.value?.id) {
    populate(feedbackToShow.value)
    void loadComments(feedbackToShow.value.id)
    return
  }
  if (!open) {
    comments.value = []
    feedbackTypeSelected.value = {}
    feedbackStatusSelected.value = {}
    router.push({ path: route.path, query: {} })
  }
})

// A live update or another tab may change the open post's flags.
watch(() => feedbackToShow.value?.updatedAt, () => {
  if (showFeedbackInfoModal.value && feedbackToShow.value?.id && !feedbackToShow.value?.canEdit) populate(feedbackToShow.value)
})

watch(feedbackEditableText, (newVal, oldVal) => {
  if (populating.value || newVal === oldVal || !showFeedbackInfoModal.value || !feedbackToShow.value?.canEdit) return
  if (newVal === (feedbackToShow.value.body || '')) return
  debounce.value(() => save({ body: newVal }), 800)
})

watch(feedbackStatusSelected, (val) => {
  if (populating.value || !showFeedbackInfoModal.value || !val?.value || val.value === feedbackToShow.value?.status) return
  save({ status: val.value })
})

watch(feedbackTypeSelected, (val) => {
  if (populating.value || !showFeedbackInfoModal.value || !val?.value || val.value === feedbackToShow.value?.type) return
  save({ type: val.value })
})

// Methods
function removeComment(commentId) {
  comments.value = comments.value.filter(comment => comment.id !== commentId)
}

const sendComment = async () => {
    if (!userId.value || !newCommentText.value || !feedbackToShow.value?.id) return

    loadingComment.value = true

    try {
        const { comment, post } = await feedbackApi.comment(feedbackToShow.value.id, newCommentText.value)
        if (!comments.value.some(c => c.id === comment.id)) comments.value = [...comments.value, comment]
        applyFeedbackPost(post)

        newCommentText.value = ''
        // Clear the TipTap editor
        if (commentEditor.value) {
            commentEditor.value.clear()
        }
    } catch(error) {
        if (error instanceof FeedbackSignInError) return showAlert({ type: 'info', message: t('feedback_info_modal.login_to_comment') })
        console.error("Error in sendComment: ", error)
        showAlert({ type: 'error', message: t('feedback_info_modal.comment_failed') })
    } finally {
        loadingComment.value = false
    }
}

// Live comments from the board stream (see pages/feedback.vue).
defineExpose({
  addLiveComment(comment) {
    if (feedbackToShow.value?.id === comment.postId && !comments.value.some(c => c.id === comment.id)) {
      comments.value = [...comments.value, { isMine: false, canDelete: isAdmin.value, ...comment }]
    }
  },
  removeComment
})

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
