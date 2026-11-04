<template>
  <UApp>
    <div>
      <div 
          v-if="isNativeApp"
          style="-webkit-app-region: drag;"
          class="w-[100%] h-6 fixed top-0 left-0 z-[99999]"
      />

      <AlertNotification />
      <NuxtPage/>
      <HelpBitesWidget />
    </div>
  </UApp>
</template>


<script setup>
import { useStore } from '~/stores/myStore';
import { usePlatform } from '~/composables/usePlatform';
import AlertNotification from '~/components/AlertNotification.vue';
import Parse from 'parse';
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';

const { isNative: isNativePlatform, isElectrobun } = usePlatform();
const isNativeApp = computed(() => isNativePlatform);

const config = useRuntimeConfig();

// Safari's own Smart App Banner replaces the hand-rolled one we used to render.
// It needs the numeric App Store id, so without `appleAppId` configured we emit
// no tag at all rather than a banner that points nowhere. `app-argument` carries
// the current URL so the native app can open on the same page.
const smartBannerRoute = useRoute();
const smartBannerMeta = computed(() => {
  const appleAppId = config.public.appleAppId;
  if (!appleAppId) return [];

  const base = (config.public.appUrl || useRequestURL().origin).replace(/\/$/, '');

  return [{
    name: 'apple-itunes-app',
    content: `app-id=${appleAppId}, app-argument=${base}${smartBannerRoute.fullPath}`,
  }];
});

useHead({ meta: smartBannerMeta });

if (import.meta.client) {
  Parse.initialize(config.public.parseAppId, config.public.parseJsKey);

  // Adjust Parse Server URL for native apps (Electrobun)
  if (isNativeApp.value) {
    // Try to use the configured absolute URL, fallback to localhost
    let serverUrl = config.public.parseServerUrl;
    if (serverUrl && serverUrl.startsWith('/')) {
      const baseUrl = config.public.backendUrl || 'http://localhost:3000';
      // Remove trailing slash from baseUrl if present to avoid double slash
      const cleanBase = baseUrl.replace(/\/$/, '');
      serverUrl = `${cleanBase}${serverUrl}`;
    }
    Parse.serverURL = serverUrl;
  } else {
    Parse.serverURL = config.public.parseServerUrl;
  }

  if (config.public.parseLiveServerUrl) {
    Parse.liveQueryServerURL = config.public.parseLiveServerUrl;
  }

  // Keep Parse.User.current safe even if a bundle shape changes or Parse is
  // only partially initialized during client boot.
  if (!Parse.User) {
    Parse.User = { current: () => null }
  } else if (typeof Parse.User.current !== 'function') {
    Parse.User.current = () => null
  }

  // Make Parse available globally on the window object
  if (typeof window !== 'undefined') window.Parse = Parse;
}

const router = useRouter()
const store = useStore();

const { isLoggedIn, currentUser } = storeToRefs(store)


// Fetch plans client-side only to avoid hydration issues. `fetchPlans` loads
// the catalogue from the backend's `GET /v1/plans` and owns its own error
// handling, so the pricing page renders empty rather than breaking the app.
onMounted(async () => {
  await store.fetchPlans();
});

onBeforeMount(async () => {
  checkLoginStatus();
})

const listenForRefresh = () => {
  if(import.meta.dev){
        let cmdDown = false;
        log('listenForRefresh')
        window.addEventListener('keydown', (e) => {
          if (e.key === 'Meta') cmdDown = true;
          if (cmdDown && e.key === 'r') {
            e.preventDefault();
            window.location.reload();
          }
        });
        window.addEventListener('keyup', (e) => {
          if (e.key === 'Meta') cmdDown = false;
        });
  }
}

async function checkLoginStatus() {
  try{
    const activeCurrentUser = import.meta.client ? (window.Parse?.User?.current?.() ?? Parse?.User?.current?.() ?? null) : null;
    const sessionToken = activeCurrentUser?.getSessionToken?.() || useCookie('parse.session').value || null;
    log('[app] user 1: ', activeCurrentUser);

    if (activeCurrentUser || sessionToken) { 
      log('[app] user already logged in: ');
      
      console.log('[app] Parse.User.current(): ', activeCurrentUser);
      console.log('[app] sessionToken: ', sessionToken);

      if (!sessionToken && activeCurrentUser) {
        currentUser.value = activeCurrentUser?.attributes ?? activeCurrentUser ?? null;
        store.userId = activeCurrentUser?.id ?? '';
        isLoggedIn.value = true;
      } else {
        try {
          const user = await Parse.User.become(sessionToken);
          log('[app] currentUser.value: ', currentUser.value)
          currentUser.value = user?.attributes ?? user ?? null;
          store.userId = user?.id ?? '';
          document.cookie = `parse.session=${sessionToken}; path=/`;
          isLoggedIn.value = true;
        } catch (error) {
          console.error('[app] Error setting user: ', error);
          document.cookie = 'parse.session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
          currentUser.value = null;
          store.userId = '';
          isLoggedIn.value = false;

          try {
            await Parse.User.logOut();
          } catch (err) {
            console.error('[app] Error logging out user: ', err);
            // Find and log the localStorage item whose key contains 'Parse'
          }
        }
      }
    }
  } catch(error) {
    console.error('Error checking login status: ', error);
  }
}
</script>

<style lang="scss">
    // @import '@/styles/main.scss';
</style>
