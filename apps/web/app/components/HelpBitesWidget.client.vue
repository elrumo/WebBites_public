<template>
  <span hidden aria-hidden="true" />
</template>

<script setup lang="ts">
// Mounts the HelpBites chat widget for signed-in users. The token is minted by
// our own Nuxt server (`GET /api/support/token`), so the user never signs up
// for anything: the chat trusts this app to say who they are.
import { useStore } from '~/stores/myStore'

const props = defineProps<{
  /** What the user is looking at, attached to conversations they start. */
  context?: { type: string, id: string, label: string, url?: string, thumbnailUrl?: string } | null
}>()

const config = useRuntimeConfig()
const store = useStore()
const route = useRoute()
const { log } = useDevLog()

const host = String(config.public.helpbitesApiUrl || '').replace(/\/+$/, '')
const projectKey = String(config.public.helpbitesPublicKey || '')

// The app has its own in-page help affordance (📨 → /help), so the floating
// launcher would only clutter it — keep it to the marketing pages. Nothing
// floats over the AI-assistant consent page's Approve button either.
const HIDE_LAUNCHER_ON = ['/app', '/oauth/authorize']

let loaded = false

// Parse.User.current() is synchronous (localStorage); sending its session token
// covers the brief window before app.vue writes the parse.session cookie.
function sessionHeader(): Record<string, string> {
  const token = (window as any).Parse?.User?.current?.()?.getSessionToken?.()
  return token ? { 'x-parse-session-token': token } : {}
}

function push(command: unknown[]) {
  const hb = (window as any).HelpBites
  if (Array.isArray(hb) || (hb && typeof hb.push === 'function')) hb.push(command)
}

function applyRouteVisibility() {
  if (!loaded) return
  push([HIDE_LAUNCHER_ON.includes(route.path) ? 'hide' : 'show'])
}

function mount() {
  if (loaded) return
  if (!host || !projectKey || !store.userId) {
    log('[helpbites] not mounting —', { host, projectKey, userId: store.userId })
    return
  }
  loaded = true
  ;(window as any).HelpBites = (window as any).HelpBites || []
  push(['init', {
    getToken: () => $fetch<{ token: string }>('/api/support/token', { headers: sessionHeader() }).then(r => r.token),
    context: props.context || null
  }])
  applyRouteVisibility()
  const script = document.createElement('script')
  script.src = `${host}/widget.js`
  script.defer = true
  script.dataset.project = projectKey
  script.onload = () => log('[helpbites] widget.js loaded')
  script.onerror = () => log('[helpbites] widget.js FAILED to load from', script.src)
  document.head.appendChild(script)
  log('[helpbites] injecting widget.js for user', store.userId)
}

watch(() => store.userId, () => mount(), { immediate: true })
watch(() => route.path, () => applyRouteVisibility())
watch(() => props.context, (context) => { if (loaded) push(['setContext', context || null]) }, { deep: true })
</script>
