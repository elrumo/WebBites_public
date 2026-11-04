<template>
  <AuthModal/>

  <div
    :class="{
        // The landing page is dark whatever the OS prefers; every other page
        // follows the app theme so the bar keeps contrast in light mode.
        'dark': isLandingPage,
        'is-subpage': !isLandingPage,
        'shadow-lg': showShadow,
        'is-scrolled': scrolled
    }"
    class="landing-navbar-wrapper"
  >
    <div
      class="landing-navbar"
      :class="{
        'not-landing-page': !isLandingPage,
      }"
    >
      <RouterLink :to="currentUser ? '/app' : '/'">
        <div
          @click="!currentUser ? startAuthFlow() : ''"
          class="webbites-title flex items-center space-x-4 text-black dark:text-white"
        >
          WebBites
        </div>
      </RouterLink>

      <nav class="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2 dark:text-white">
        <UButton
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          color="neutral"
          variant="ghost"
          class="font-semibold text-neutral-700 dark:text-neutral-200"
        >
          {{ link.label }}
        </UButton>
      </nav>

      <div class="flex items-center space-x-4">
        <UButton
          v-if="!selfHosted"
          color="neutral"
          variant="ghost"
          class="transition hover:scale-125"
          target="_blank"
          to="https://twitter.com/elrumo"
        >
          <UIcon name="i-tabler-brand-x" class="text-black dark:text-white" />
        </UButton>

          <UButton
              v-if="isLoggedIn && currentUser != null"
              to="app"
              color="neutral" variant="solid"
          >
            {{ $t('auth.go_to_app') }}
          </UButton>

          <UButton
              @click="setLoginModal()"
              color="neutral"
              variant="ghost"
              class="font-bold rounded-full"
              v-if="currentUser == null"
              size="sm"
          >
            {{ $t('auth.sign_in') }}
          </UButton>

          <UButton
              @click="setLoginModal()"
              v-if="currentUser == null"
              color="neutral" variant="solid"
              class="font-bold hidden sm:block rounded-full"
              size="sm"
              >
              {{ $t('auth.sign_up') }}
              <!-- {{ $t('auth.notify_me') }} -->
          </UButton>

      </div>
    </div>
  </div>
</template>

<script setup>
import Parse from 'parse';
import { useStore } from '~/stores/myStore'
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'
import { useWindowScroll } from '@vueuse/core'

const props = defineProps({
    isLandingPage: {
        type: Boolean,
        default: true
    },
    showShadow: {
        type: Boolean,
        default: false
    }
})

const { t } = useI18n()
const { y: scrollY } = useWindowScroll()
// Only the landing page morphs into the floating pill once you scroll past the hero's top.
const scrolled = computed(() => props.isLandingPage && scrollY.value > 80)
// A self-hosted install has no marketing site, so only the pages that exist on it are linked.
const selfHosted = useRuntimeConfig().public.selfHosted
const links = computed(() => selfHosted
  ? [{ label: t('navigation.developers'), to: '/developers' }]
  : [
    { label: t('navigation.features'), to: '/#features' },
    { label: t('navigation.pricing'), to: '/#pricing' },
    { label: t('navigation.developers'), to: '/developers' },
    { label: t('navigation.faq'), to: '/faq' },
  ])
const { log } = useDevLog()
const store = useStore()

const { startAuthFlow } = store
const { 
    isLoggedIn, 
    currentUser, 
    showAuthModal,
    // isDark
} = storeToRefs(store)

watch(currentUser, (newVal) => {
  log('[LandingNavBar] currentUser: ', newVal);
  if (newVal === null) {
    // console.log('Before Logged out: ', document.cookie);
    // document.cookie = 'parse.session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    // console.log('After Logged out: ', document.cookie);
  }
})



const setLoginModal = () => {
    showAuthModal.value = !showAuthModal.value
}

onMounted(async () => {
  // if (Parse.User.current()) {    
  //   const currentSession = Parse.User.current();
  //   if (currentSession && currentSession.getSessionToken()) {
  //     console.log('Current session: ', currentSession);
  //     try {
  //       const user = await Parse.User.become(currentSession.getSessionToken());
  //       currentUser.value = user;
  //       currentUser.value = currentSession;
  //       document.cookie = `parse.session=${currentSession.getSessionToken()}; path=/`;
  //     } catch (error) {
  //       console.log('Error setting user: ', error);
  //       // Clear Parse cookies on error
  //       document.cookie = 'parse.session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  //       currentUser.value = null;
  //     }
  //   } else {
  //     currentUser.value = null;
  //   }
  // }
})
</script>

<style scoped>
.auth-wrapper {
  max-width: 32rem;
  margin: 0 auto;
}

.text-primary {
  color: #3B82F6;
}

:deep(.u-input) {
  height: 48px;
  font-size: 1rem;
}

:deep(.u-button) {
  height: 48px;
  font-size: 1rem;
}
</style>
