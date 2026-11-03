<template>
  <!-- Floating support bubble for signed-OUT visitors. Signed-in users get the
       real HelpBites widget (mounted globally in app.vue); the support page
       only renders this when there is no session, so the two never overlap. -->
  <div>
    <Transition name="wb-anon-pop">
      <section
        v-if="open"
        class="fixed bottom-[84px] right-5 z-[2147483000] flex flex-col w-[min(400px,calc(100vw-40px))] h-[min(640px,calc(100vh-110px))] rounded-[18px] overflow-hidden bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-[0_12px_40px_rgba(0,0,0,.22)] border border-stone-200 dark:border-stone-800"
        :aria-label="$t('help_pages.chat.iframe_title')"
      >
        <header class="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-200 dark:border-stone-800">
          <div class="min-w-0">
            <p class="text-sm font-semibold leading-tight">{{ $t('help_pages.chat.title') }}</p>
            <p class="text-[11px] text-stone-500 dark:text-stone-400 truncate">
              {{ email ? $t('support_chat.replying_to', { email }) : $t('support_chat.real_person') }}
            </p>
          </div>
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            class="rounded-full"
            :aria-label="$t('common.close')"
            @click="open = false"
          />
        </header>

        <!-- Email gate: nothing is collected until they choose to continue. -->
        <div v-if="!email" class="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          <p class="text-sm text-stone-600 dark:text-stone-300">
            {{ $t('support_chat.gate_intro') }}
          </p>
          <UButton block color="primary" :label="$t('help_pages.chat.sign_in')" class="rounded-full" @click="signIn" />

          <div class="flex items-center gap-3 text-[11px] uppercase tracking-wide text-stone-400">
            <span class="h-px flex-1 bg-stone-200 dark:bg-stone-800" /> {{ $t('common.or') }} <span class="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>

          <form class="flex flex-col gap-2" @submit.prevent="startGuest">
            <label class="text-xs font-medium text-stone-600 dark:text-stone-300" for="wb-anon-email">{{ $t('support_chat.your_email') }}</label>
            <UInput
              id="wb-anon-email"
              v-model="emailInput"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              size="lg"
            />
            <p v-if="emailError" class="text-xs text-red-500">{{ emailError }}</p>
            <UButton type="submit" block color="neutral" variant="soft" :label="$t('support_chat.continue_as_guest')" class="rounded-full" />
            <p class="text-[11px] text-stone-400">{{ $t('support_chat.email_note') }}</p>
          </form>
        </div>

        <!-- Guest thread: persisted locally so it survives a refresh. -->
        <template v-else>
          <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-2">
            <p class="text-xs text-stone-400 text-center">{{ $t('support_chat.we_reply_to', { email }) }}</p>
            <div
              v-for="(m, i) in messages"
              :key="i"
              class="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words"
            >
              {{ m.body }}
            </div>
            <p v-if="!messages.length" class="text-sm text-stone-500 dark:text-stone-400 text-center mt-6">
              {{ $t('support_chat.tell_us') }}
            </p>
          </div>

          <form class="shrink-0 border-t border-stone-200 dark:border-stone-800 p-2 flex items-end gap-2" @submit.prevent="send">
            <UTextarea
              v-model="draft"
              :rows="1"
              autoresize
              :maxrows="5"
              :placeholder="$t('support_chat.your_message')"
              class="flex-1"
              @keydown.enter.exact.prevent="send"
            />
            <UButton
              type="submit"
              icon="i-heroicons-paper-airplane"
              color="primary"
              square
              class="rounded-full"
              :disabled="!draft.trim()"
              :aria-label="$t('support_chat.send')"
            />
          </form>
        </template>
      </section>
    </Transition>

    <!-- Launcher, positioned to match the real widget's bubble. -->
    <button
      type="button"
      class="fixed bottom-5 right-5 z-[2147483000] size-[52px] rounded-full bg-primary-600 text-white shadow-[0_6px_20px_rgba(0,0,0,.18)] flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
      :aria-label="open ? $t('support_chat.close_chat') : $t('support_chat.open_chat')"
      @click="open = !open"
    >
      <UIcon :name="open ? 'i-heroicons-x-mark' : 'i-heroicons-chat-bubble-oval-left'" class="size-6" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { LEGAL } from '~/utils/legal'
import { useStore } from '~/stores/myStore'

// ponytail: guest messages are kept locally and delivered best-effort via a
// mailto: to the support address — HelpBites has no anonymous endpoint.
// Upgrade path: a host-signed "anon:<id>" identity token + a real conversation.
const STORAGE_KEY = 'wb_support_anon'
const { t } = useI18n()
const store = useStore()

const open = ref(false)
const email = ref('')
const emailInput = ref('')
const emailError = ref('')
const draft = ref('')
const messages = ref<{ body: string, at: number }[]>([])
const scrollEl = ref<HTMLElement | null>(null)

// ---- persistence (best-effort; storage can throw in private windows) ----
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    email.value = typeof data.email === 'string' ? data.email : ''
    messages.value = Array.isArray(data.messages) ? data.messages : []
  } catch {}
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ email: email.value, messages: messages.value }))
  } catch {}
}
onMounted(load)
watch([email, messages], persist, { deep: true })

// ---- actions ----
function signIn() {
  open.value = false
  store.showAuthModal = true
}

function startGuest() {
  const value = emailInput.value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    emailError.value = t('support_chat.invalid_email')
    return
  }
  emailError.value = ''
  email.value = value
}

async function send() {
  const body = draft.value.trim()
  if (!body) return
  messages.value.push({ body, at: Date.now() })
  draft.value = ''
  await nextTick()
  scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight })
  // Best-effort delivery. The message is already saved locally above, so it
  // survives even if the visitor has no mail client.
  const subject = `WebBites support — ${email.value}`
  const lines = messages.value.map(m => m.body).join('\n\n')
  const mail = `mailto:${LEGAL.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${lines}\n\n— sent from ${email.value}`)}`
  window.open(mail, '_blank')
}
</script>

<style scoped>
.wb-anon-pop-enter-active,
.wb-anon-pop-leave-active {
  transition: transform .28s cubic-bezier(.16, 1.02, .3, 1), opacity .2s ease;
  transform-origin: bottom right;
}
.wb-anon-pop-enter-from,
.wb-anon-pop-leave-to {
  opacity: 0;
  transform: scale(.88) translateY(14px);
}
</style>
