<template>
  <Transition name="slide-up">
    <div v-if="showBanner" class="cookie-card-wrapper">
      <div class="cookie-card">
        <div class="cookie-content">
          <div class="flex flex-row items-center justify-between">
            <h3 class="cookie-title">
              {{ $t('cookies.cookie_consent') }}
            </h3>
            
            <div class="cookie-actions">
              <UButton
                variant="ghost"
                size="2xs"
                class="opacity-60 !py-1 !text-white"
                @click="decline"
              >
                {{ $t('common.decline') }}
                
              </UButton>

              <UButton
                color="primary"
                size="xs"
                class="font-bold rounded-lg !py-1"
                @click="accept"
              >
                {{ $t('common.accept') }}
              </UButton>
            </div>
          </div>

          <p class="cookie-description">
            {{ $t('cookies.description') }}
          </p>
        </div>

      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, onMounted } from 'vue'
const { log } = useDevLog()
const showBanner = ref(false)

onMounted(() => {
  try {
    // Initialize MS Clarity first (it will run in no-consent mode by default)
    initializeMSClarity()

    // Check for resetConsent param
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('resetConset')) {
      localStorage.removeItem('cookie-consent')
    }

    // Check if user has already made a choice
    const consent = localStorage.getItem('cookie-consent')

    if (!consent) {
      // Show banner after a short delay for better UX
      setTimeout(() => {
        showBanner.value = true
      }, 1000)
    } else if (consent === 'accepted') {
      // If previously accepted, grant consent using Consent API v2
      grantConsent()
    } else if (consent === 'declined') {
      // If previously declined, ensure consent is revoked
      revokeConsent()
    }
  } catch (error) {
    console.error('[CookieCard] Error in onMounted:', error);
  }
})

const accept = () => {
  localStorage.setItem('cookie-consent', 'accepted')
  showBanner.value = false
  grantConsent()
}

const decline = () => {
  localStorage.setItem('cookie-consent', 'declined')
  showBanner.value = false
  revokeConsent()
}

const initializeMSClarity = () => {
  if (typeof window === 'undefined') return
  if (window.__clarityScriptLoaded) return
  if (!window.location.host.includes('localhost')) {
    if (document.querySelector('script[src*="clarity.ms/tag"]') || window.clarity) {
      window.__clarityScriptLoaded = true
      return
    }
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "k48f0xotd8");
    window.__clarityScriptLoaded = true
    log('🔄 MS Clarity script loading...')
  } else {
    log('🏠 Localhost detected - MS Clarity not loaded')
  }
}

const waitForClarity = (callback, maxAttempts = 20, attempt = 1) => {
  // Wait for Clarity to be available with exponential backoff
  if (typeof window !== 'undefined' && window.clarity) {
    log(`✅ MS Clarity loaded after ${attempt} attempt(s)`)
    callback()
  } else if (attempt < maxAttempts) {
    const delay = Math.min(100 * Math.pow(1.5, attempt - 1), 2000) // Exponential backoff, max 2s
    setTimeout(() => {
      waitForClarity(callback, maxAttempts, attempt + 1)
    }, delay)
  } else {
    // console.error('❌ MS Clarity failed to load after', maxAttempts, 'attempts')
    // console.error('   Possible reasons:')
    // console.error('   - Ad blocker is blocking Clarity')
    // console.error('   - Network issues')
    // console.error('   - Script blocked by browser settings')
  }
}

const grantConsent = () => {
  // Use MS Clarity Consent API v2 to grant consent
  waitForClarity(() => {
    window.clarity('consentv2', {
      ad_Storage: "granted",
      analytics_Storage: "granted"
    });
    log('✅ MS Clarity consent granted')
    verifyClarity()
  })
}

const revokeConsent = () => {
  // Use MS Clarity Consent API to revoke consent and clear cookies
  waitForClarity(() => {
    window.clarity('consent', false);
    log('❌ MS Clarity consent revoked and cookies cleared')
    verifyClarity()
  })
}

const verifyClarity = () => {
  try {
    // Verification function to check if Clarity is working
    setTimeout(() => {
      // Check 1: Is clarity object available?
      log('1. Clarity object exists:', !!window.clarity)
  
      // Check 2: Check for Clarity cookies
      const cookies = document.cookie.split(';').map(c => c.trim())
      const clarityCookies = cookies.filter(c => c.startsWith('_clck=') || c.startsWith('_clsk='))
    log('2. Clarity cookies found:', clarityCookies.length > 0 ? '✅ Yes' : '⚠️ No (running in no-consent mode)')
    if (clarityCookies.length > 0) {
      log('   Cookies:', clarityCookies)
    }

    // Check 3: Check for Clarity script in DOM
    const clarityScript = document.querySelector('script[src*="clarity.ms"]')
   log('3. Clarity script loaded:', clarityScript ? '✅ Yes' : '❌ No')

    // Check 4: Try to get session ID (if available)
    if (window.clarity) {
      try {
        window.clarity('identify', 'test-verification')
        log('4. Clarity API responding:', '✅ Yes')
      } catch (e) {
        log('4. Clarity API responding:', '❌ Error:', e.message)
      }
    }

    // Check 5: Check localStorage for consent
    const consent = localStorage.getItem('cookie-consent')
    log('5. Consent status in localStorage:', consent || 'not set')

    log('\n📊 To verify tracking in MS Clarity dashboard:')
    log('   1. Visit https://clarity.microsoft.com/')
    log('   2. Go to your project')
    log('   3. Check "Recordings" - you should see new sessions appearing')
    log('   4. Check "Heatmaps" - data should be collecting')

    console.groupEnd()
  }, 1000)
  } catch (error) {
    console.error('Error in verifyClarity:', error);
  }
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";
.cookie-card-wrapper {
  @apply fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6 w-fit;
  @apply flex justify-center items-end pointer-events-none;
}

.cookie-card {
  @apply 
    flex flex-col
    items-start
    gap-6 
    bg-neutral-900/95 backdrop-blur-lg rounded-2xl shadow-2xl
    border border-neutral-700 
    p-5
    max-w-md w-full 
    pointer-events-auto
  ;
}

.cookie-content {
  @apply flex-1;
}

.cookie-title {
  @apply text-lg md:text-lg font-bold text-white mb-1;
}

.cookie-description {
  @apply text-neutral-300 text-sm leading-relaxed;
}

.cookie-actions {
  @apply flex gap-3 flex-shrink-0 w-auto -mt-2;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease-out;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
