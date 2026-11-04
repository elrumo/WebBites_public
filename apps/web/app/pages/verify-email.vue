<template>
  <div class="verify-container">
    <div class="absolute top-8 left-1/2 transform -translate-x-1/2 flex flex-row items-center justify-center gap-2">
      <Logo :isImage="true" :isText="true" imageSize="sm" />
    </div>

    <div class="verify-card">
      <Transition name="fade" mode="out-in">
        <!-- Working -->
        <div v-if="state === 'verifying'" key="verifying" class="verify-body">
          <div class="verify-icon bg-neutral-100 dark:bg-neutral-700/60">
            <UIcon name="i-heroicons-arrow-path" class="text-2xl text-neutral-500 animate-spin" />
          </div>
          <h1 class="verify-title">{{ $t('verify_email.verifying_title') }}</h1>
          <p class="verify-text">{{ $t('verify_email.verifying_body') }}</p>
        </div>

        <!-- Done -->
        <div v-else-if="state === 'success'" key="success" class="verify-body">
          <div class="verify-icon bg-primary-100 dark:bg-primary-900/50">
            <UIcon name="i-heroicons-check" class="text-2xl text-primary-600 dark:text-primary-400" />
          </div>
          <h1 class="verify-title">{{ $t('verify_email.success_title') }}</h1>
          <p class="verify-text">
            {{ $t('verify_email.success_body') }}
          </p>
          <p class="verify-email">{{ email }}</p>
          <p class="verify-hint">{{ $t('verify_email.success_hint') }}</p>
          <UButton color="primary" size="lg" block class="mt-2" @click="openApp">
            {{ isSignedIn ? $t('verify_email.open_app') : $t('verify_email.sign_in') }}
          </UButton>
        </div>

        <!-- Didn't work -->
        <div v-else key="error" class="verify-body">
          <div class="verify-icon bg-red-50 dark:bg-red-950/40">
            <UIcon :name="errorIcon" class="text-2xl text-red-500" />
          </div>
          <h1 class="verify-title">{{ errorTitle }}</h1>
          <p class="verify-text">{{ errorBody }}</p>
          <div class="flex flex-col gap-2 w-full mt-2">
            <UButton v-if="canRetry" color="primary" size="lg" block @click="verify">
              {{ $t('verify_email.try_again') }}
            </UButton>
            <UButton :color="canRetry ? 'neutral' : 'primary'" :variant="canRetry ? 'ghost' : 'solid'" size="lg" block @click="openSettings">
              {{ isSignedIn ? $t('verify_email.open_settings') : $t('verify_email.go_home') }}
            </UButton>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import Parse from 'parse';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const route = useRoute();

useHead({ title: computed(() => t('verify_email.page_title')) });

const state = ref('verifying');
const email = ref('');
const errorCode = ref('');
const isSignedIn = ref(false);

let token = '';

const errorIcon = computed(() => (errorCode.value === 'EXPIRED_TOKEN' ? 'i-heroicons-clock' : 'i-heroicons-x-mark'));

// A failed Stripe or network call leaves the token unused; those are worth
// retrying. A used, expired or unknown link never becomes valid again.
const canRetry = computed(() => ['BILLING_UNAVAILABLE', 'NETWORK', ''].includes(errorCode.value));

const errorTitle = computed(() => {
  switch (errorCode.value) {
    case 'EXPIRED_TOKEN': return t('verify_email.expired_title');
    case 'EMAIL_TAKEN': return t('verify_email.taken_title');
    case 'INVALID_TOKEN': return t('verify_email.invalid_title');
    default: return t('verify_email.failed_title');
  }
});

const errorBody = computed(() => {
  switch (errorCode.value) {
    case 'EXPIRED_TOKEN': return t('verify_email.expired_body');
    case 'EMAIL_TAKEN': return t('verify_email.taken_body');
    case 'INVALID_TOKEN': return t('verify_email.invalid_body');
    default: return t('verify_email.failed_body');
  }
});

async function verify() {
  state.value = 'verifying';
  errorCode.value = '';
  try {
    const response = await $fetch('/api/auth/verifyEmailChange', { method: 'POST', body: { token } });
    email.value = response.email;
    state.value = 'success';

    // The link only works once, so a reload must not try it again.
    window.history.replaceState({}, '', '/verify-email');

    // Signed in on this browser: the cached Parse user still holds the old address.
    const user = Parse.User?.current?.();
    if (user) await user.fetch().catch(() => {});
  } catch (error) {
    errorCode.value = error?.data?.data?.errorCode || (error?.statusCode ? '' : 'NETWORK');
    state.value = 'error';
  }
}

function openApp() {
  navigateTo(isSignedIn.value ? '/app' : '/?login=true');
}

function openSettings() {
  navigateTo(isSignedIn.value ? '/app?settings=true' : '/');
}

onMounted(() => {
  isSignedIn.value = !!Parse.User?.current?.();
  token = typeof route.query.token === 'string' ? route.query.token : '';
  if (!token) {
    errorCode.value = 'INVALID_TOKEN';
    state.value = 'error';
    return;
  }
  verify();
});
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.verify-container {
  @apply
    min-h-screen px-4
    flex flex-col items-center justify-center
    bg-neutral-100 dark:bg-neutral-900;
}

.verify-card {
  @apply
    w-full max-w-sm
    bg-white dark:bg-neutral-800
    border border-neutral-200 dark:border-neutral-700
    shadow-lg
    rounded-xl
    p-7;
}

.verify-body {
  @apply flex flex-col items-center text-center gap-3;
}

.verify-icon {
  @apply w-12 h-12 rounded-full flex items-center justify-center mb-1;
}

.verify-title {
  @apply text-lg font-bold text-neutral-900 dark:text-white m-0;
}

.verify-text {
  @apply text-sm text-neutral-600 dark:text-neutral-300 m-0;
}

.verify-email {
  @apply
    w-full px-3 py-2 m-0
    rounded-lg
    bg-neutral-100 dark:bg-neutral-700/60
    text-sm font-medium text-neutral-900 dark:text-white
    break-all;
}

.verify-hint {
  @apply text-xs text-neutral-500 dark:text-neutral-400 m-0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-leave-to {
  opacity: 0;
}
</style>
