<template>
  <div>
    <LandingNavBar :isLandingPage="false" />

    <div class="max-w-screen-lg mx-auto px-4 pb-10">
      <header class="flex flex-col items-center gap-2 py-8 text-center">
        <h1 class="font-semibold text-3xl">{{ $t('help_pages.chat.title') }}</h1>
        <p class="opacity-70 max-w-lg">{{ $t('help_pages.chat.subtitle') }}</p>
      </header>

      <!-- Signed in: the HelpBites chat, full width. The identity token is
           minted by our backend and handed to the iframe over postMessage, the
           same handshake the floating widget's loader uses — never in the URL. -->
      <div
        v-if="isLoggedIn"
        class="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm h-[calc(100dvh-220px)] min-h-[460px] bg-white dark:bg-stone-900"
      >
        <iframe
          v-if="embedSrc"
          ref="frame"
          :src="embedSrc"
          :title="$t('help_pages.chat.iframe_title')"
          allow="clipboard-write"
          class="w-full h-full border-0"
        />
        <div v-else class="h-full flex items-center justify-center text-sm opacity-60 px-6 text-center">
          <i18n-t keypath="help_pages.chat.not_configured" tag="span">
            <template #email>
              <a :href="`mailto:${LEGAL.email}`" class="underline ml-1">{{ LEGAL.email }}</a>
            </template>
          </i18n-t>
        </div>
      </div>

      <!-- Signed out: no identity token to give the chat, so offer the door in. -->
      <div v-else class="max-w-md mx-auto text-center flex flex-col items-center gap-4 py-10">
        <p class="opacity-80">{{ $t('help_pages.chat.sign_in_prompt') }}</p>
        <UButton size="lg" color="primary" :label="$t('help_pages.chat.sign_in')" class="rounded-full" @click="store.showAuthModal = true" />
        <i18n-t keypath="help_pages.chat.prefer_email" tag="p" class="text-sm opacity-60">
          <template #email>
            <a :href="`mailto:${LEGAL.email}`" class="underline">{{ LEGAL.email }}</a>
          </template>
        </i18n-t>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LEGAL } from '~/utils/legal'
import { useStore } from '~/stores/myStore'
import { storeToRefs } from 'pinia'

const { t } = useI18n()

useHead({ title: () => `WebBites - ${t('help_pages.chat.title')}` })

const config = useRuntimeConfig()
const store = useStore()
const { isLoggedIn } = storeToRefs(store)

const host = String(config.public.helpbitesApiUrl || '').replace(/\/+$/, '')
const projectKey = String(config.public.helpbitesPublicKey || '')
const frame = ref<HTMLIFrameElement | null>(null)

function sessionHeader(): Record<string, string> {
  const token = (window as any).Parse?.User?.current?.()?.getSessionToken?.()
  return token ? { 'x-parse-session-token': token } : {}
}

const embedSrc = computed(() => {
  if (!host || !projectKey) return ''
  const dark = import.meta.client && document.documentElement.classList.contains('dark')
  return `${host}/embed?pk=${encodeURIComponent(projectKey)}&inline=1${dark ? '&theme=dark' : ''}`
})

function sendToken() {
  const win = frame.value?.contentWindow
  if (!win || !host) return
  $fetch<{ token: string }>('/api/support/token', { headers: sessionHeader() })
    .then(r => win.postMessage({ source: 'help-bites-host', type: 'token', token: r.token }, host))
    .catch(() => {})
}

// The embed asks for a token on load (`ready`) and again when one expires
// (`token-needed`); mint a fresh one each time.
function onMessage(event: MessageEvent) {
  if (event.origin !== host) return
  const data = event.data
  if (data?.source !== 'help-bites') return
  if (data.type === 'ready' || data.type === 'token-needed') sendToken()
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>
