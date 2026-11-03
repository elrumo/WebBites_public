<template>
  <UModal
    v-model:open="showNewFeedbackModal"
    :ui="{ content: 'dark sm:max-w-xl dark:bg-neutral-800 ring-white/10 text-white' }"
  >
  <template #content>
    <div class="p-5 sm:p-6 flex flex-col gap-3 min-h-0 overflow-y-auto">
      <h4 class="mt-0 font-bold">
        {{ $t('feedback.form.title') }}
      </h4>

      <div class="space-y-4">
        <div class="w-full">
          <label for="input-feedback-title" class="block mb-2">
            {{ $t('feedback.form.title_label') }}
          </label>
          <UInput
            v-model="feedbackTitle"
            id="input-feedback-title"
            :placeholder="$t('feedback.form.title_label')"
            class="w-full"
          />
        </div>

        <div>
          <label for="input-feedback-type" class="block mb-2">
            {{ $t('feedback.form.type_label') }}
          </label>
          <USelectMenu
            id="input-feedback-type"
            v-model="feedbackType"
            :items="typeItems"
            :placeholder="$t('feedback_form.select_type')"
            class="w-full"
          >
              <template #item="{ item }">
                <UIcon class="w-3 h-3" :name="item.icon" />
                <span class="truncate">
                  {{ item.label }}
                </span>
              </template>
          </USelectMenu>
        </div>

        <div>
          <label for="input-feedback-platform" class="block mb-2">
            {{ $t('feedback.form.platform_label') }}
          </label>
          <USelectMenu
            id="input-feedback-platform"
            v-model="feedbackPlatform"
            :items="platformItems"
            value-key="value"
            class="w-full"
          />
        </div>

        <div v-if="isAdmin">
          <label for="input-feedback-status" class="block mb-2">
            Status
          </label>
          <USelectMenu
            id="input-feedback-status"
            v-model="feedbackStatus"
            :items="feedbackStatusOptions"
            placeholder="Select status"
            class="w-full"
          >
            <template #item="{ item }">
              <UBadge
                variant="soft"
                class="w-fit capitalize truncate"
                :class="[getBadgeColor(item, 'bg'), getBadgeColor(item, 'text')]"
                size="xs"
              >
                {{ item.label }}
              </UBadge>
            </template>
          </USelectMenu>
        </div>
      </div>

      <div class="mt-4">
        <label for="input-feedback" class="block mb-2">
          {{ $t('feedback.form.comment_label') }} <small class="opacity-70 pl-1.5">{{ $t('feedback_form.markdown_supported') }}</small>
        </label>

        <TiptapCommentEditor
          ref="feedbackEditor"
          v-model="feedbackText"
          :placeholder="$t('feedback.form.comment_label')"
        />

        <div v-if="isAdmin" class="flex flex-col gap-4 mt-4">
          <div class="flex flex-row gap-4 w-full justify-between">
            <label class="text-sm block mb-2">
              Show on landing page
            </label>
            <USwitch v-model="toLandingPage" size="md" />
          </div>

          <div class="flex flex-row gap-4 w-full justify-between">
            <label class="text-sm block mb-2">
              {{ $t('feedback.form.changelog_label') }}
            </label>
            <USwitch v-model="toChangelog" size="md" />
          </div>

          <div class="flex flex-row gap-4 w-full justify-between">
            <label class="text-sm block mb-2">
              {{ $t('feedback.form.hide_from_everyone_label') }}
            </label>
            <USwitch v-model="hideFromView" size="md" />
          </div>

          <div class="w-full flex flex-row gap-2 justify-between">
            <div class="w-full">
              <label for="input-changelog-title" class="text-sm block mb-2">
                Changelog Title
              </label>
              <UInput
                id="input-changelog-title"
                v-model="changeLogTitle"
                placeholder="Enter changelog title..."
              />
            </div>

            <div class="w-fit">
              <label class="text-sm text-gray-500 mb-2 block">
                Icon
              </label>
              <UInput
                v-model="feedbackIcon"
                placeholder="Emoji"
                class="w-fit"
                size="sm"
              />
            </div>
          </div>

          <div class="w-full">
            <label for="input-changelog-message" class="text-sm block mb-2">
              Changelog Message
            </label>
            <UTextarea
              id="input-changelog-message"
              v-model="changeLogMessage"
              color="neutral"
              placeholder="Enter changelog message..."
            />
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-4 pb-5 px-5">
      <UButton
        variant="ghost"
        @click="showNewFeedbackModal = false"
      >
        {{ $t('common.cancel') }}
      </UButton>

      <UButton
        :disabled="!isFormValid || loading"
        :loading="loading"
        variant="solid"
        color="neutral"
        @click="sendFeedback"
      >
        {{ $t('feedback.form.submit_button') }}
      </UButton>
    </div>
  
  </template>
</UModal>
</template>

<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { FeedbackSignInError } from '~/composables/useFeedbackApi'

const { t } = useI18n()
const store = useStore()
const { showNewFeedbackModal, feedbackTypeOptions, feedbackStatusOptions, feedbackPlatformOptions, isAdmin } = storeToRefs(store)
const {
  showAlert,
  getBadgeColor,
  applyFeedbackPost
} = store
const feedbackApi = useFeedbackApi()

const feedbackText = ref('')
const feedbackIcon = ref('')
const feedbackTitle = ref('')
const feedbackType = ref(null)
const feedbackPlatform = ref('web')
const feedbackStatus = ref(null)
const loading = ref(false)
const toChangelog = ref(false)
const toLandingPage = ref(false)
const hideFromView = ref(false)
const changeLogMessage = ref('')
const changeLogTitle = ref('')
const feedbackEditor = ref(null)

const typeItems = computed(() => feedbackTypeOptions.value.map(option => ({
  ...option,
  label: t(`feedback_form.types.${option.value.replaceAll('-', '_')}`),
})))

const platformItems = computed(() => feedbackPlatformOptions.value.map(option => ({
  ...option,
  label: t(`feedback.platform.${option.value}`),
})))

const isFormValid = computed(() => feedbackTitle.value && feedbackType.value)

async function sendFeedback() {
    if (loading.value || !isFormValid.value) return

    loading.value = true

    try {
        // Admin-only fields are honoured only for tokens carrying role: admin;
        // HelpBites drops them for everyone else.
        const body = {
            title: feedbackTitle.value.trim(),
            body: feedbackText.value,
            type: feedbackType.value?.value,
            platform: feedbackPlatform.value,
            ...(isAdmin.value ? {
                status: feedbackStatus.value?.value || (toChangelog.value ? 'done' : 'pending'),
                showOnChangelog: toChangelog.value,
                featured: toLandingPage.value,
                hidden: hideFromView.value,
                changelogTitle: changeLogTitle.value || null,
                changelogBody: changeLogMessage.value || null,
                icon: feedbackIcon.value || null,
            } : {}),
        }

        const { post } = await feedbackApi.create(body)
        // The live stream may deliver the same post a moment later; this merges.
        applyFeedbackPost(post)

        feedbackText.value = ''
        feedbackTitle.value = ''
        feedbackType.value = null
        feedbackPlatform.value = 'web'
        feedbackStatus.value = null
        feedbackIcon.value = ''
        changeLogMessage.value = ''
        changeLogTitle.value = ''
        toChangelog.value = false
        toLandingPage.value = false
        hideFromView.value = false

        // Clear the TipTap editor
        if (feedbackEditor.value) {
            feedbackEditor.value.clear()
        }

        showNewFeedbackModal.value = false

        showAlert({
            type: 'success',
            message: t('feedback_form.sent')
        })
    } catch (error) {
        if (error instanceof FeedbackSignInError) {
            return showAlert({ type: 'info', message: t('feedback_form.login_to_submit') })
        }
        console.error("[FeedbackForm] Could not send feedback: ", error)
        showAlert({
            type:'error',
            message: error?.message || t('feedback_form.send_failed')
        })
    } finally {
        loading.value = false
    }
}
</script>
