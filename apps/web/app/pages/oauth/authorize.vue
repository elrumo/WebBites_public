<!-- /oauth/authorize?request=… — where an AI assistant's "Connect" lands.
     The backend's own /oauth/authorize has already checked the client, its
     redirect and PKCE, parked the request and sent the browser here. The
     signed-in user approves or declines it; the backend then answers with where
     the browser goes next (the client's redirect, carrying a code or
     access_denied). When the request itself is bad the backend sends
     ?error=…&error_description=… instead, and this page goes nowhere.
     See webbites-backend docs/mcp-feature-architecture.md. -->
<template>
  <div class="consent-container">
    <div class="absolute top-8 left-1/2 transform -translate-x-1/2 flex flex-row items-center justify-center gap-2">
      <Logo :isImage="true" :isText="true" imageSize="sm" />
    </div>

    <AuthModal v-if="state === 'signin'" :preventClose="true" @auth-success="onSignedIn" />

    <div v-else class="consent-card">
      <Transition name="fade" mode="out-in">
        <!-- Fetching the request -->
        <div v-if="state === 'loading'" key="loading" class="consent-body" aria-busy="true">
          <USkeleton class="w-12 h-12 rounded-full" />
          <USkeleton class="h-5 w-3/4" />
          <USkeleton class="h-4 w-1/2" />
          <USkeleton class="h-28 w-full rounded-lg" />
          <USkeleton class="h-10 w-full rounded-lg" />
        </div>

        <!-- The question -->
        <div v-else-if="state === 'request' || state === 'working'" key="request" class="consent-body">
          <div class="consent-icon bg-neutral-100 dark:bg-neutral-700/60">
            <UIcon name="i-heroicons-sparkles" class="text-2xl text-neutral-600 dark:text-neutral-300" />
          </div>
          <h1 class="consent-title">{{ $t('oauth_consent.title', { client: clientName }) }}</h1>

          <!-- Who is asking. Never the client's own logo: anyone can register
               one, so it would only lend a stranger our credibility. -->
          <UBadge
            v-if="client.verified"
            color="success"
            variant="soft"
            icon="i-heroicons-check-badge"
            :label="clientHost ? $t('oauth_consent.verified_from', { host: clientHost }) : $t('oauth_consent.verified')"
          />
          <template v-else>
            <UBadge color="warning" variant="soft" icon="i-heroicons-exclamation-triangle" :label="$t('oauth_consent.unverified')" />
            <p class="consent-warning">{{ $t('oauth_consent.unverified_body') }}</p>
          </template>

          <!-- What it gets -->
          <div class="consent-section">
            <p class="consent-label">{{ $t('oauth_consent.can_heading') }}</p>
            <div class="consent-scope">
              <UIcon name="i-heroicons-check" class="text-lg text-primary-500 shrink-0" />
              <span>{{ $t('oauth_consent.can_read') }}</span>
            </div>
            <label v-if="canWrite" class="consent-scope cursor-pointer">
              <UIcon name="i-heroicons-pencil-square" class="text-lg shrink-0" :class="allowWrite ? 'text-primary-500' : 'text-neutral-400'" />
              <span class="flex flex-col flex-1 min-w-0">
                <span>{{ $t('oauth_consent.allow_changes') }}</span>
                <span class="consent-hint">{{ $t('oauth_consent.allow_changes_body') }}</span>
              </span>
              <USwitch v-model="allowWrite" :disabled="state === 'working'" :aria-label="$t('oauth_consent.allow_changes')" />
            </label>
            <p class="consent-hint">{{ $t('oauth_consent.cannot') }}</p>
          </div>

          <!-- Where the browser goes afterwards -->
          <div class="consent-section">
            <p class="consent-label">{{ $t('oauth_consent.redirect_heading') }}</p>
            <p class="consent-text">{{ $t(`oauth_consent.redirect_${redirectKind}`, { target: redirect.display }) }}</p>
            <p v-if="redirectKind === 'loopback'" class="consent-warning">{{ $t('oauth_consent.loopback_warning') }}</p>
          </div>

          <p class="consent-hint">{{ $t('oauth_consent.provider_note', { client: clientName }) }}</p>

          <div class="flex flex-col gap-2 w-full mt-1">
            <UButton
              color="primary"
              size="lg"
              block
              :loading="state === 'working' && pendingAnswer === true"
              :disabled="state === 'working' || !armed"
              @click="answer(true)"
            >
              {{ $t('oauth_consent.approve') }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="lg"
              block
              :loading="state === 'working' && pendingAnswer === false"
              :disabled="state === 'working'"
              @click="answer(false)"
            >
              {{ $t('oauth_consent.decline') }}
            </UButton>
          </div>

          <p v-if="accountLabel" class="consent-hint">
            {{ $t('oauth_consent.signed_in_as', { account: accountLabel }) }}
            ·
            <button type="button" class="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-200" :disabled="state === 'working'" @click="switchAccount">
              {{ $t('oauth_consent.switch_account') }}
            </button>
          </p>
          <p class="consent-hint">{{ $t('oauth_consent.revoke_hint') }}</p>
        </div>

        <!-- Answered: on the way back to the client -->
        <div v-else-if="state === 'done' || state === 'declined'" :key="state" class="consent-body">
          <div class="consent-icon" :class="state === 'done' ? 'bg-primary-100 dark:bg-primary-900/50' : 'bg-neutral-100 dark:bg-neutral-700/60'">
            <UIcon
              :name="state === 'done' ? 'i-heroicons-check' : 'i-heroicons-x-mark'"
              class="text-2xl"
              :class="state === 'done' ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-500'"
            />
          </div>
          <h1 class="consent-title">{{ $t(`oauth_consent.${state}_title`) }}</h1>
          <p class="consent-text">{{ $t(`oauth_consent.${state}_body`, { client: clientName }) }}</p>
          <p class="consent-hint">{{ $t('oauth_consent.close_hint', { client: clientName }) }}</p>
          <!-- A custom-scheme redirect (cursor://…) can leave the tab where it
               is if the browser's "open this app?" prompt is dismissed. -->
          <UButton v-if="redirectTo" :to="redirectTo" external color="neutral" variant="soft" size="sm" class="mt-1">
            {{ $t('oauth_consent.continue') }}
          </UButton>
        </div>

        <!-- The request is bad: the backend said so before anything was asked -->
        <div v-else-if="state === 'invalid'" key="invalid" class="consent-body">
          <div class="consent-icon bg-red-50 dark:bg-red-950/40">
            <UIcon name="i-heroicons-no-symbol" class="text-2xl text-red-500" />
          </div>
          <h1 class="consent-title">{{ $t(`oauth_consent.invalid_${invalidKind}_title`) }}</h1>
          <p class="consent-text">{{ $t(`oauth_consent.invalid_${invalidKind}_body`) }}</p>
          <!-- What the backend said, for whoever built the client. Kept small
               and labelled: it comes from the URL, so anyone can write it. -->
          <details v-if="invalidDetails" class="consent-details">
            <summary>{{ $t('oauth_consent.details') }}</summary>
            <code>{{ invalidDetails }}</code>
          </details>
        </div>

        <!-- Didn't work -->
        <div v-else key="error" class="consent-body">
          <div class="consent-icon bg-red-50 dark:bg-red-950/40">
            <UIcon :name="errorKind === 'expired' ? 'i-heroicons-clock' : 'i-heroicons-x-mark'" class="text-2xl text-red-500" />
          </div>
          <h1 class="consent-title">{{ $t(`oauth_consent.${errorKind}_title`) }}</h1>
          <p class="consent-text">{{ $t(`oauth_consent.${errorKind}_body`) }}</p>
          <UButton v-if="errorKind === 'failed' && retry" color="primary" size="lg" block class="mt-2" @click="retry()">
            {{ $t('oauth_consent.try_again') }}
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

useHead({
  title: computed(() => t('oauth_consent.page_title')),
  meta: [{ name: 'robots', content: 'noindex' }],
});

// Sign in with Apple leaves the site; its callback page reads this to come
// back here, ?request= and all, instead of landing on /app. Same key as /cli.
const RETURN_KEY = 'webbites.after_sign_in';

// The backend mints request ids; anything else in the URL is not one.
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

// RFC 6749 error codes (plus our own redirect one) → which explanation to show.
const INVALID_KINDS = {
  invalid_client: 'client',
  unauthorized_client: 'client',
  invalid_redirect_uri: 'redirect',
  invalid_scope: 'scope',
  server_error: 'server',
  temporarily_unavailable: 'server',
};

// The backend never answers with these, but a redirect is followed blindly,
// so refuse anything that would run in this page's origin.
const UNSAFE_REDIRECT = /^\s*(javascript|data|vbscript|blob|file):/i;

const route = useRoute();
const store = useStore();
const { showAuthModal } = storeToRefs(store);
const { backendFetch } = useBackendFetch();

// loading | signin | request | working | done | declined | invalid | error
// Starts at loading: which one applies is only known in the browser.
const state = ref('loading');
const requestId = ref('');
const request = ref(null);
const account = ref(null);
const allowWrite = ref(true);
const pendingAnswer = ref(null);
const redirectTo = ref('');
const errorKind = ref('failed'); // expired | rejected | failed
const invalidKind = ref('request'); // request | client | redirect | scope | server
const invalidDetails = ref('');
const retry = ref(null);

// Approve stays inert for a moment whenever the question comes into view, so a
// click already on its way cannot land on it: the second half of a double-click
// on another site that opened this page under the cursor, say.
const armed = ref(false);
let armTimer = null;
function arm() {
  armed.value = false;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { armed.value = true; }, 600);
}
const rearmWhenVisible = () => {
  if (document.visibilityState === 'visible') arm();
};
watch(state, (next) => {
  if (next === 'request') arm();
});

const client = computed(() => request.value?.client || null);
const clientName = computed(() => client.value?.name || t('oauth_consent.the_app'));
const redirect = computed(() => request.value?.redirect || { kind: 'web', display: '' });
const redirectKind = computed(() => (['web', 'loopback', 'app'].includes(redirect.value.kind) ? redirect.value.kind : 'web'));
const canWrite = computed(() => Boolean(request.value?.scopes?.includes('bookmarks:write')));
const accountLabel = computed(() => account.value?.email || account.value?.username || '');

// A verified client's id is the https URL of its metadata document, so its
// host is who vouches for the name above it.
const clientHost = computed(() => {
  try {
    return new URL(client.value?.id).host;
  } catch {
    return '';
  }
});

const statusOf = (error) => error?.statusCode || error?.status || error?.response?.status || 0;
const codeOf = (error) =>
  error?.data?.statusMessage || error?.data?.data?.statusMessage || error?.statusMessage || '';

function fail(kind, retryWith = null) {
  errorKind.value = kind;
  retry.value = retryWith;
  state.value = 'error';
}

function askToSignIn() {
  sessionStorage.setItem(RETURN_KEY, route.fullPath);
  state.value = 'signin';
  showAuthModal.value = true;
}

function onSignedIn() {
  sessionStorage.removeItem(RETURN_KEY);
  showAuthModal.value = false;
  loadRequest();
}

async function loadRequest() {
  state.value = 'loading';
  try {
    const response = await backendFetch(`oauth/requests/${encodeURIComponent(requestId.value)}`);
    request.value = response.request;
    account.value = response.account || null;
    // Changes are on unless the person turns them off; read comes with any approval.
    allowWrite.value = true;
    state.value = 'request';
  } catch (error) {
    const status = statusOf(error);
    if (status === 401) return askToSignIn();
    if (status === 404 || status === 410 || codeOf(error) === 'EXPIRED_REQUEST') return fail('expired');
    fail('failed', loadRequest);
  }
}

async function answer(approve) {
  pendingAnswer.value = approve;
  state.value = 'working';
  try {
    const response = await backendFetch('oauth/authorize/confirm', {
      method: 'POST',
      body: {
        request: request.value.id,
        csrf: request.value.csrf,
        approve,
        allowWrite: approve && canWrite.value && allowWrite.value,
      },
    });
    const target = typeof response?.redirectTo === 'string' ? response.redirectTo : '';
    if (!target || UNSAFE_REDIRECT.test(target)) return fail('failed');
    redirectTo.value = target;
    state.value = approve ? 'done' : 'declined';
    window.location.assign(target);
  } catch (error) {
    const status = statusOf(error);
    if (status === 401) return askToSignIn();
    if (status === 410 || codeOf(error) === 'EXPIRED_REQUEST') return fail('expired');
    if (status === 400) return fail('rejected');
    fail('failed', () => answer(approve));
  }
}

// Signed into the wrong account: sign out here, without leaving the page, and
// ask again. The request is still parked under its id.
async function switchAccount() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // The Parse sign-out below is what this page relies on.
  }
  try {
    await Parse.User.logOut();
  } catch {
    // Already signed out.
  }
  store.currentUser = null;
  store.userId = '';
  askToSignIn();
}

onMounted(() => {
  document.addEventListener('visibilitychange', rearmWhenVisible);
  window.addEventListener('focus', arm);

  const { error, error_description: description, request: id } = route.query;

  if (typeof error === 'string' && error) {
    invalidKind.value = INVALID_KINDS[error] || 'request';
    const code = /^[a-z_]{1,64}$/.test(error) ? error : '';
    const text = typeof description === 'string' ? description.slice(0, 300) : '';
    invalidDetails.value = [code, text].filter(Boolean).join(': ');
    state.value = 'invalid';
    return;
  }

  requestId.value = typeof id === 'string' ? id.trim() : '';
  if (!REQUEST_ID.test(requestId.value)) {
    invalidKind.value = 'request';
    state.value = 'invalid';
    return;
  }

  if (Parse.User?.current?.()) return loadRequest();
  askToSignIn();
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', rearmWhenVisible);
  window.removeEventListener('focus', arm);
  clearTimeout(armTimer);
});
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.consent-container {
  @apply
    min-h-screen px-4 py-24
    flex flex-col items-center justify-center
    bg-neutral-100 dark:bg-neutral-900;
}

.consent-card {
  @apply
    w-full max-w-md
    bg-white dark:bg-neutral-800
    border border-neutral-200 dark:border-neutral-700
    shadow-lg
    rounded-xl
    p-7;
}

.consent-body {
  @apply flex flex-col items-center text-center gap-3;
}

.consent-icon {
  @apply w-12 h-12 rounded-full flex items-center justify-center mb-1;
}

.consent-title {
  @apply text-lg font-bold text-neutral-900 dark:text-white m-0 break-words;
}

.consent-text {
  @apply text-sm text-neutral-600 dark:text-neutral-300 m-0 break-words;
}

.consent-hint {
  @apply text-xs text-neutral-500 dark:text-neutral-400 m-0;
}

.consent-warning {
  @apply
    w-full m-0 px-3 py-2
    rounded-lg
    bg-amber-50 dark:bg-amber-950/40
    text-sm text-amber-800 dark:text-amber-200;
}

.consent-section {
  @apply
    w-full flex flex-col gap-2 text-left
    px-4 py-3
    rounded-lg
    bg-neutral-100 dark:bg-neutral-700/40;
}

.consent-label {
  @apply text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 m-0;
}

.consent-scope {
  @apply flex flex-row items-center gap-3 text-sm text-neutral-800 dark:text-neutral-100;
}

.consent-details {
  @apply w-full text-left text-xs text-neutral-500 dark:text-neutral-400;
}

.consent-details summary {
  @apply cursor-pointer select-none;
}

.consent-details code {
  @apply block mt-2 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700/60 font-mono break-words whitespace-pre-wrap;
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
