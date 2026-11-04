<template>
    <!-- `dark` because the landing page is dark whatever the OS prefers, and
         @nuxtjs/color-mode otherwise stamps `light` on <html> for a light-mode
         machine — which is what left the plan buttons gray-900-on-dark and the
         cookie card white. Nuxt UI's dark variant is `:where(.dark, .dark *)`,
         so one class here flips every U* component and `dark:` utility below
         it, the same way the hero's own `dark` wrappers already do. -->
    <div class="landing-page-wrapper dark">
        <LandingPage/>
        <CookieCard/>
    </div>
</template>

<script setup>
import Parse from 'parse';
import { useStore } from '~/stores/myStore'
import { onMounted } from 'vue'

definePageMeta({
    middleware: 'auth'
})

const store = useStore()
const router = useRouter()

const { currentUser } = storeToRefs(store)

const isLoggedInAuth = useState('auth:status', () => false)

onMounted(async () => {
    if (Parse.User?.current?.()){
        // currentUser.value = Parse.User.current()
        // console.log('[index] currentUser.value: ', currentUser.value);
        // store.isLoggedIn = true;     
    }
})
</script>

<style>
</style>
