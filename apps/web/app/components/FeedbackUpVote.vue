<template>
    <button
        type="button"
        class="fb-vote"
        :class="{ voted: item.hasVoted }"
        :disabled="votingClosed"
        :aria-pressed="Boolean(item.hasVoted)"
        :aria-label="`${t('feedback.votes')}: ${item.voteCount || 0}`"
        @click="upVote"
    >
        <UIcon name="octicon:chevron-up-12" class="w-3 h-3" />
        <span class="tabular-nums">{{ item.voteCount || 0 }}</span>
    </button>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from '~/stores/myStore'
import { useI18n } from 'vue-i18n';
import { FeedbackSignInError } from '~/composables/useFeedbackApi'
const { t } = useI18n();

const props = defineProps({
    item: {
        type: Object,
        required: true
    }
})

const store = useStore()
const { showAlert, applyFeedbackPost } = store
const feedbackApi = useFeedbackApi()

// HelpBites closes voting once a post is done or closed.
const votingClosed = computed(() => props.item.statusCategory === 'done' || props.item.statusCategory === 'closed')

const upVote = async () => {
  if (votingClosed.value) return

  // Optimistic toggle, rolled back below if the request fails.
  const before = { hasVoted: Boolean(props.item.hasVoted), voteCount: props.item.voteCount || 0 }
  const want = !before.hasVoted
  applyFeedbackPost({ ...props.item, hasVoted: want, voteCount: Math.max(0, before.voteCount + (want ? 1 : -1)) })

  try {
    const { post } = await feedbackApi.vote(props.item.id, want)
    applyFeedbackPost(post)
  } catch (error) {
    applyFeedbackPost({ ...props.item, ...before })
    if (error instanceof FeedbackSignInError) return showAlert({ message: t('feedback_up_vote.login_to_vote'), type: 'info' })
    console.error('[FeedbackUpVote] Could not register vote: ', error)
    showAlert({ message: t('common.error_try_again'), type: 'error' })
  }
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.fb-vote {
  @apply inline-flex flex-row items-center justify-center gap-0.5 shrink-0 min-w-10 h-7 px-1.5 rounded-lg border border-neutral-700 bg-neutral-900/60 text-xs leading-none font-bold text-neutral-300 transition cursor-pointer;
  @apply hover:border-green-400/50 hover:text-white;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
  @apply disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-neutral-700 disabled:hover:text-neutral-300;
}
.fb-vote.voted {
  @apply border-green-400/60 text-green-300;
  background: linear-gradient(180deg, rgba(134, 239, 172, 0.16), rgba(34, 197, 94, 0.08));
  box-shadow: 0 0 20px rgba(65, 217, 118, 0.18);
}
</style>
