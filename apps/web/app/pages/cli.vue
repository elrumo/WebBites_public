<!-- /cli?code=XXXX-XXXX — where `webbites login` sends the browser. The
     signed-in user checks the code matches their terminal and approves it;
     the backend then hands the CLI an API key (see webbites-backend
     server/utils/deviceAuthRules.ts). -->
<template>
  <div class="cli-container">
    <div class="absolute top-8 left-1/2 transform -translate-x-1/2 flex flex-row items-center justify-center gap-2">
      <Logo :isImage="true" :isText="true" imageSize="sm" />
    </div>

    <AuthModal v-if="state === 'signin'" :preventClose="true" @auth-success="showRequest" />

    <div v-else-if="state !== 'loading'" class="cli-card">
      <Transition name="fade" mode="out-in">
        <!-- The question -->
        <div v-if="state === 'confirm' || state === 'working'" key="confirm" class="cli-body">
          <div class="cli-icon bg-neutral-100 dark:bg-neutral-700/60">
            <UIcon name="i-heroicons-command-line" class="text-2xl text-neutral-600 dark:text-neutral-300" />
          </div>
          <h1 class="cli-title">{{ $t('cli_login.title') }}</h1>
          <p class="cli-text">{{ $t('cli_login.body') }}</p>
          <p class="cli-code">{{ code }}</p>
          <p v-if="email" class="cli-hint">{{ $t('cli_login.signed_in_as', { email }) }}</p>
          <div class="flex flex-col gap-2 w-full mt-2">
            <UButton color="primary" size="lg" block :loading="state === 'working'" @click="answer(true)">
              {{ $t('cli_login.approve') }}
            </UButton>
            <UButton color="neutral" variant="ghost" size="lg" block :disabled="state === 'working'" @click="answer(false)">
              {{ $t('cli_login.decline') }}
            </UButton>
          </div>
        </div>

        <!-- Answered -->
        <div v-else-if="state === 'approved' || state === 'declined'" :key="state" class="cli-body">
          <div class="cli-icon" :class="state === 'approved' ? 'bg-primary-100 dark:bg-primary-900/50' : 'bg-neutral-100 dark:bg-neutral-700/60'">
            <UIcon
              :name="state === 'approved' ? 'i-heroicons-check' : 'i-heroicons-x-mark'"
              class="text-2xl"
              :class="state === 'approved' ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-500'"
            />
          </div>
          <h1 class="cli-title">{{ $t(`cli_login.${state}_title`) }}</h1>
          <p class="cli-text">{{ $t(`cli_login.${state}_body`) }}</p>
        </div>

        <!-- Didn't work -->
        <div v-else key="error" class="cli-body">
          <div class="cli-icon bg-red-50 dark:bg-red-950/40">
            <UIcon :name="errorCode === 'EXPIRED' ? 'i-heroicons-clock' : 'i-heroicons-x-mark'" class="text-2xl text-red-500" />
          </div>
          <h1 class="cli-title">{{ $t(`cli_login.${errorKey}_title`) }}</h1>
          <p class="cli-text">{{ $t(`cli_login.${errorKey}_body`) }}</p>
          <UButton v-if="errorCode === 'FAILED'" color="primary" size="lg" block class="mt-2" @click="answer(lastAnswer)">
            {{ $t('cli_login.try_again') }}
          </UButton>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import Parse from 'parse';
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';

const { t } = useI18n();
useHead({ title: computed(() => t('cli_login.page_title')) });

// Sign in with Apple leaves the site; its callback page reads this to come
// back here, code and all, instead of landing on /app.
const RETURN_KEY = 'webbites.after_sign_in';

const route = useRoute();
const { showAuthModal } = storeToRefs(useStore());
const { backendFetch } = useBackendFetch();

// loading | signin | confirm | working | approved | declined | error
// Starts blank: which one applies is only known in the browser.
const state = ref('loading');
const code = ref('');
const email = ref('');
const errorCode = ref('');
const lastAnswer = ref(true);

const errorKey = computed(() => ({ EXPIRED: 'expired', INVALID: 'invalid' })[errorCode.value] || 'failed');

function showRequest() {
  sessionStorage.removeItem(RETURN_KEY);
  showAuthModal.value = false;
  email.value = Parse.User.current()?.get('email') || '';
  state.value = 'confirm';
}

async function answer(approve) {
  lastAnswer.value = approve;
  state.value = 'working';
  try {
    await backendFetch('auth/device/confirm', { method: 'POST', body: { userCode: code.value, approve } });
    state.value = approve ? 'approved' : 'declined';
    // The code only works once, so a reload must not offer it again.
    window.history.replaceState({}, '', '/cli');
  } catch (error) {
    errorCode.value = { 410: 'EXPIRED', 400: 'INVALID' }[error?.statusCode] || 'FAILED';
    state.value = 'error';
  }
}

onMounted(() => {
  code.value = typeof route.query.code === 'string' ? route.query.code.trim().toUpperCase() : '';
  if (!/^[A-Z]{4}-[A-Z]{4}$/.test(code.value)) {
    errorCode.value = 'INVALID';
    state.value = 'error';
    return;
  }
  if (Parse.User?.current?.()) return showRequest();
  sessionStorage.setItem(RETURN_KEY, route.fullPath);
  state.value = 'signin';
  showAuthModal.value = true;
});
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.cli-container {
  @apply
    min-h-screen px-4
    flex flex-col items-center justify-center
    bg-neutral-100 dark:bg-neutral-900;
}

.cli-card {
  @apply
    w-full max-w-sm
    bg-white dark:bg-neutral-800
    border border-neutral-200 dark:border-neutral-700
    shadow-lg
    rounded-xl
    p-7;
}

.cli-body {
  @apply flex flex-col items-center text-center gap-3;
}

.cli-icon {
  @apply w-12 h-12 rounded-full flex items-center justify-center mb-1;
}

.cli-title {
  @apply text-lg font-bold text-neutral-900 dark:text-white m-0;
}

.cli-text {
  @apply text-sm text-neutral-600 dark:text-neutral-300 m-0;
}

.cli-code {
  @apply
    w-full px-3 py-3 m-0
    rounded-lg
    bg-neutral-100 dark:bg-neutral-700/60
    font-mono text-2xl font-semibold tracking-[0.2em] text-neutral-900 dark:text-white;
}

.cli-hint {
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
