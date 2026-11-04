<template>
  <div class="flex flex-col gap-2">
    <UFormField :label="$t('settings.auth.email')">
      <div class="flex flex-row items-center gap-2">
        <UInput
          disabled
          name="email"
          :model-value="currentEmail"
          variant="outline"
          size="sm"
          color="neutral"
          class="w-full"
        />
        <UButton
          v-if="!editing"
          size="sm"
          color="neutral"
          variant="soft"
          class="shrink-0"
          :disabled="loading"
          @click="startEditing"
        >
          {{ status?.pending ? $t('settings.email_change.change_again') : $t('settings.email_change.change') }}
        </UButton>
      </div>
    </UFormField>

    <!-- Waiting on the link. The address above has not changed yet, and this says so. -->
    <TransitionExpand>
      <div v-if="status?.pending && !editing" class="pending-box">
        <UIcon name="i-heroicons-envelope" class="text-lg text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
        <div class="flex flex-col gap-2 min-w-0 flex-1">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-neutral-900 dark:text-white break-all">
              {{ $t('settings.email_change.pending_title', { email: status.pending.email }) }}
            </span>
            <span class="text-xs text-neutral-600 dark:text-neutral-300">
              {{ $t('settings.email_change.pending_body', { email: currentEmail }) }}
            </span>
            <span class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ $t('settings.email_change.expires', { date: formatDate(status.pending.expiresAt) }) }}
            </span>
          </div>
          <div class="flex flex-row flex-wrap gap-2">
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              :loading="busy === 'resend'"
              :disabled="!!busy || resendIn > 0"
              @click="resend"
            >
              {{ resendIn > 0 ? $t('settings.email_change.resend_in', { seconds: resendIn }) : $t('settings.email_change.resend') }}
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="busy === 'cancel'"
              :disabled="!!busy"
              @click="cancelPending"
            >
              {{ $t('settings.email_change.cancel_change') }}
            </UButton>
          </div>
        </div>
      </div>
    </TransitionExpand>

    <!-- The form. Nothing is saved to the account from here: submitting only sends the link. -->
    <TransitionExpand>
      <form v-if="editing" class="edit-box" @submit.prevent="submit">
        <UFormField :label="$t('settings.email_change.new_email')" :error="fieldError === 'email' ? errorText : undefined">
          <UInput
            ref="newEmailInput"
            v-model="newEmail"
            type="email"
            name="new-email"
            autocomplete="email"
            :placeholder="$t('settings.auth.email_placeholder')"
            size="sm"
            color="neutral"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="status?.requiresPassword"
          :label="$t('settings.email_change.current_password')"
          :error="fieldError === 'password' ? errorText : undefined"
        >
          <UInput
            v-model="password"
            type="password"
            name="current-password"
            autocomplete="current-password"
            :placeholder="$t('settings.auth.password_placeholder')"
            size="sm"
            color="neutral"
            class="w-full"
          />
        </UFormField>

        <p v-if="errorText && !fieldError" class="text-xs text-red-600 dark:text-red-400 m-0">{{ errorText }}</p>

        <p class="text-xs text-neutral-500 dark:text-neutral-400 m-0">
          {{ $t('settings.email_change.explainer', { email: currentEmail }) }}
        </p>

        <div class="flex flex-row gap-2 justify-end">
          <UButton size="sm" color="neutral" variant="ghost" :disabled="busy === 'submit'" @click="stopEditing">
            {{ $t('common.cancel') }}
          </UButton>
          <UButton type="submit" size="sm" :loading="busy === 'submit'" :disabled="!canSubmit">
            {{ $t('settings.email_change.send_link') }}
          </UButton>
        </div>
      </form>
    </TransitionExpand>
  </div>
</template>

<script setup lang="ts">
import Parse from 'parse'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useStore } from '~/stores/myStore'

interface PendingEmailChange {
  email: string
  sentAt: string | null
  expiresAt: string
  canResendAt: string | null
}

interface EmailStatus {
  email: string | null
  emailVerified: boolean
  requiresPassword: boolean
  pending: PendingEmailChange | null
}

const { t, locale } = useI18n()
const store = useStore()
const { userInfo, currentUser } = storeToRefs(store)
const { backendFetch } = useBackendFetch()

const status = ref<EmailStatus | null>(null)
const loading = ref(true)
const editing = ref(false)
const busy = ref<'submit' | 'resend' | 'cancel' | null>(null)
const newEmail = ref('')
const password = ref('')
const errorText = ref('')
const fieldError = ref<'email' | 'password' | null>(null)
const newEmailInput = ref()
const now = ref(Date.now())

// What the account actually uses — the pending address is never shown here.
const currentEmail = computed(() => status.value?.email ?? userInfo.value.email ?? '')

const normalized = computed(() => newEmail.value.trim().toLowerCase())
const looksValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.value))
const canSubmit = computed(() =>
  looksValid.value
  && normalized.value !== currentEmail.value.toLowerCase()
  && (!status.value?.requiresPassword || password.value.length > 0)
  && busy.value === null
)

const resendIn = computed(() => {
  const at = status.value?.pending?.canResendAt
  if (!at) return 0
  return Math.max(0, Math.ceil((new Date(at).getTime() - now.value) / 1000))
})

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })

// The backend's error code survives the /api/v1 proxy one or two `data` levels down.
function errorCodeOf(error: any): string | undefined {
  return error?.data?.data?.data?.errorCode ?? error?.data?.data?.errorCode ?? error?.data?.errorCode
}

function messageFor(error: any): { text: string, field: 'email' | 'password' | null } {
  const code = errorCodeOf(error)
  switch (code) {
    case 'INVALID_EMAIL': return { text: t('settings.email_change.errors.invalid_email'), field: 'email' }
    case 'SAME_EMAIL': return { text: t('settings.email_change.errors.same_email'), field: 'email' }
    case 'EMAIL_TAKEN': return { text: t('settings.email_change.errors.email_taken'), field: 'email' }
    case 'PASSWORD_REQUIRED': return { text: t('settings.email_change.errors.password_required'), field: 'password' }
    case 'INCORRECT_PASSWORD': return { text: t('settings.email_change.errors.incorrect_password'), field: 'password' }
    case 'DAILY_LIMIT': return { text: t('settings.email_change.errors.daily_limit'), field: null }
    case 'RESEND_COOLDOWN': return { text: t('settings.email_change.errors.cooldown'), field: null }
    case 'EMAIL_SEND_FAILED': return { text: t('settings.email_change.errors.send_failed'), field: null }
    default: return { text: t('common.error_try_again'), field: null }
  }
}

/**
 * Adopts a status from the backend. When the address moved — the link was
 * opened in another tab or on a phone — the local Parse user and the store
 * still hold the old one, so both are refreshed.
 */
async function apply(next: EmailStatus) {
  const previous = status.value?.email
  status.value = next
  if (previous && next.email && previous !== next.email) {
    try {
      const user = Parse.User.current()
      if (user) {
        await user.fetch()
        currentUser.value = user
        userInfo.value.username = user.get('username') ?? userInfo.value.username
      }
    } catch (error) {
      console.warn('[SettingsEmailChange] Could not refresh the signed-in user:', error)
    }
    userInfo.value.email = next.email
    store.showAlert({ message: t('settings.email_change.changed', { email: next.email }), type: 'success' })
  }
}

async function load() {
  try {
    await apply(await backendFetch<EmailStatus>('me/email'))
  } catch (error) {
    // Settings still shows the address the store has; only the change flow is unavailable.
    console.error('[SettingsEmailChange] Could not load email status:', error)
  } finally {
    loading.value = false
  }
}

function startEditing() {
  editing.value = true
  newEmail.value = ''
  password.value = ''
  errorText.value = ''
  fieldError.value = null
  nextTick(() => newEmailInput.value?.inputRef?.focus?.())
}

function stopEditing() {
  editing.value = false
  password.value = ''
  errorText.value = ''
  fieldError.value = null
}

async function submit() {
  if (!canSubmit.value) return
  busy.value = 'submit'
  errorText.value = ''
  fieldError.value = null
  try {
    const next = await backendFetch<EmailStatus>('me/email', {
      method: 'POST',
      body: { email: normalized.value, password: password.value || undefined },
    })
    await apply(next)
    stopEditing()
    store.showAlert({ message: t('settings.email_change.sent', { email: next.pending?.email ?? normalized.value }), type: 'success' })
  } catch (error) {
    const { text, field } = messageFor(error)
    errorText.value = text
    fieldError.value = field
  } finally {
    busy.value = null
  }
}

async function resend() {
  const pendingEmail = status.value?.pending?.email
  if (!pendingEmail) return
  busy.value = 'resend'
  try {
    await apply(await backendFetch<EmailStatus>('me/email', { method: 'POST', body: { email: pendingEmail } }))
    store.showAlert({ message: t('settings.email_change.sent', { email: pendingEmail }), type: 'success' })
  } catch (error) {
    store.showAlert({ message: messageFor(error).text, type: 'danger' })
  } finally {
    busy.value = null
  }
}

async function cancelPending() {
  busy.value = 'cancel'
  try {
    await apply(await backendFetch<EmailStatus>('me/email', { method: 'DELETE' }))
    store.showAlert({ message: t('settings.email_change.cancelled'), type: 'success' })
  } catch (error) {
    store.showAlert({ message: messageFor(error).text, type: 'danger' })
  } finally {
    busy.value = null
  }
}

// While a change is pending, coming back to the tab is the moment the user
// has most likely just clicked the link — check whether it went through.
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && status.value?.pending) load()
}

let ticker: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  load()
  document.addEventListener('visibilitychange', onVisibilityChange)
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (ticker) clearInterval(ticker)
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.pending-box {
  @apply
    flex flex-row items-start gap-3
    px-3 py-3
    rounded-lg
    bg-primary-50 dark:bg-primary-950/40
    border border-primary-200/70 dark:border-primary-800/50;
}

.edit-box {
  @apply
    flex flex-col gap-3
    px-3 py-3
    rounded-lg
    bg-neutral-50 dark:bg-neutral-900/40
    border border-neutral-200 dark:border-neutral-700/70;
}
</style>
