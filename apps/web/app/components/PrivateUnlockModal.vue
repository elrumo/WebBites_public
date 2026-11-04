<template>
  <UModal
    v-model:open="showPrivateUnlockModal"
    :title="$t('bookmarks.hide.unlock_title')"
    :description="$t('bookmarks.hide.unlock_description')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #body>
      <form class="flex flex-col gap-3" @submit.prevent="unlock">
        <UInput
          ref="passwordInput"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :placeholder="$t('bookmarks.hide.unlock_placeholder')"
          size="lg"
          :disabled="checking"
        />

        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

        <!-- Signing in with Apple leaves the account without a password, so
             the only honest way back in is to set one. -->
        <button
          v-if="offerReset"
          type="button"
          class="text-left text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300"
          :disabled="resetSent"
          @click="sendReset"
        >
          {{ resetSent ? $t('bookmarks.hide.unlock_reset_sent') : $t('bookmarks.hide.unlock_reset') }}
        </button>

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            :disabled="checking"
            @click="showPrivateUnlockModal = false"
          >
            {{ $t('common.cancel') }}
          </UButton>
          <UButton type="submit" :loading="checking" :disabled="!password">
            {{ $t('bookmarks.hide.unlock_confirm') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import Parse from 'parse'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const store = useStore()
const { showPrivateUnlockModal, privateUnlocked } = storeToRefs(store)

const password = ref('')
const error = ref('')
const checking = ref(false)
const offerReset = ref(false)
const resetSent = ref(false)

// Nothing typed here should outlive the dialog.
watch(showPrivateUnlockModal, (open) => {
  if (open) return
  password.value = ''
  error.value = ''
  offerReset.value = false
  resetSent.value = false
})

/**
 * `verifyPassword` checks the password without minting a session, so the
 * current one survives — unlike a `logIn`, which would swap the session token
 * out from under everything already using it.
 */
const unlock = async () => {
  if (!password.value || checking.value) return
  checking.value = true
  error.value = ''

  try {
    const user = Parse.User.current()
    await Parse.User.verifyPassword(user.getUsername(), password.value)
    privateUnlocked.value = true
    showPrivateUnlockModal.value = false
    await store.enterPrivateScope()
  } catch (err) {
    error.value = t('bookmarks.hide.unlock_wrong')
    // An account created through Sign in with Apple has no password to verify
    // against, so every attempt fails and the message alone is a dead end.
    offerReset.value = true
  } finally {
    checking.value = false
  }
}

const sendReset = async () => {
  try {
    await Parse.User.requestPasswordReset(Parse.User.current().getEmail())
    resetSent.value = true
  } catch (err) {
    error.value = t('bookmarks.hide.unlock_reset_error')
  }
}
</script>
