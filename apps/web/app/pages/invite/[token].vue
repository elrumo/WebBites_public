<template>
  <div class="flex min-h-screen items-center justify-center bg-default px-4 text-default">
    <div class="flex w-full max-w-sm flex-col items-center gap-4 text-center">
      <Logo :is-image="true" :is-text="true" image-size="sm" />

      <template v-if="!valid">
        <UIcon name="i-tabler-link-off" class="h-10 w-10 text-muted" />
        <h1 class="text-xl font-semibold">{{ $t('boards.invite.incomplete_title') }}</h1>
        <p class="text-sm text-muted">{{ $t('boards.invite.incomplete_text') }}</p>
        <UButton to="/" variant="soft" color="neutral" :label="$t('boards.go_home')" />
      </template>

      <template v-else-if="signedOut">
        <UIcon name="i-tabler-users-plus" class="h-10 w-10 text-muted" />
        <h1 class="text-xl font-semibold">{{ $t('boards.invite.invited_title') }}</h1>
        <p class="text-sm text-muted">
          {{ $t('boards.invite.sign_in_text') }}
        </p>
        <UButton to="/login" block :label="$t('boards.invite.sign_in_cta')" />
      </template>

      <template v-else>
        <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-muted" />
        <p class="text-sm text-muted">{{ $t('boards.invite.joining') }}</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Parse from 'parse'

// The link in the invitation email. It only parks the token: whoever signs in
// next is the account that joins, and the store accepts it once their boards
// load (`acceptPendingInvite`). That keeps one code path for "already signed
// in", "signs in now" and "signs up now".
definePageMeta({ pageTransition: false })

useHead({ meta: [{ name: 'robots', content: 'noindex' }, { name: 'referrer', content: 'no-referrer' }] })

const token = String(useRoute().params.token || '')
const valid = /^[A-Za-z0-9._~-]{16,300}$/.test(token)
const signedOut = ref(false)

onMounted(async () => {
  if (!valid) return
  try {
    localStorage.setItem('pendingInviteToken', token)
  } catch {
    // Storage blocked: the link still works from the signed-in app once opened again.
  }
  if ((window.Parse ?? Parse).User.current() || useCookie('parse.session').value) {
    await navigateTo('/app', { replace: true })
  } else {
    signedOut.value = true
  }
})
</script>
