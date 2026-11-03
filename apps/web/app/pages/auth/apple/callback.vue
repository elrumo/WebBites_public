<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin mx-auto mb-4" />
      <p class="text-lg">{{ $t('shell.apple_callback.completing') }}</p>
    </div>
  </div>
</template>

<script setup>
import Parse from 'parse'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useStore()

onMounted(async () => {
  try {
    // Get the form POST data from the route query
    // Note: Nuxt will parse the POST body and make it available in route.query
    const { code, id_token, state, user } = route.query

    // Verify state for CSRF protection
    const savedState = sessionStorage.getItem('apple_auth_state')
    if (state !== savedState) {
      throw new Error(t('shell.apple_callback.invalid_state'))
    }

    // Clean up the state
    sessionStorage.removeItem('apple_auth_state')

    if (!id_token) {
      throw new Error(t('shell.apple_callback.no_id_token'))
    }

    console.log('Apple callback received:', { code, id_token, user })

    // Send to signup endpoint which will forward to backend
    const authResponse = await $fetch('/api/auth/signup', {
      method: 'POST',
      body: {
        appleAuth: {
          id_token,
          code,
          user
        }
      }
    })

    if (!authResponse.success) {
      const errorCode = authResponse.errorCode
      const statusCode = authResponse.statusCode

      // Handle specific error cases
      let errorMessage = authResponse.message || t('shell.apple_callback.auth_failed')

      switch (errorCode) {
        case 'ACCOUNT_ALREADY_EXISTS':
          errorMessage = t('shell.apple_callback.account_exists')
          break
        case 'TOKEN_EXPIRED':
          errorMessage = t('shell.apple_callback.token_expired')
          break
        case 'INVALID_TOKEN_FORMAT':
          errorMessage = t('shell.apple_callback.invalid_token')
          break
        case 'USER_CREATION_FAILED':
          errorMessage = t('shell.apple_callback.user_creation_failed')
          break
        default:
          // Use the message from the backend if available
          errorMessage = authResponse.message || t('shell.apple_callback.sign_in_failed')
      }

      throw new Error(errorMessage)
    }

    console.log('Apple authentication successful:', authResponse)

    // Use the session token to establish the Parse session client-side
    const parseUser = await Parse.User.become(authResponse.sessionToken)

    console.log('Parse user session established:', parseUser)

    // Track the event
    try {
      useTrackEvent('appleSignInCompleted', {
        props: {
          userId: parseUser.id,
          isNewUser: authResponse.isNewUser
        }
      })
    } catch (error) {
      console.log('Error tracking Apple sign in:', error)
    }

    // Back to the page that started the sign-in when it asked for that (the
    // CLI's /cli approval page, or an AI assistant's /oauth/authorize consent
    // page), otherwise into the app. Only those two: anything else in storage
    // would make this an open redirect.
    const returnTo = sessionStorage.getItem('webbites.after_sign_in')
    sessionStorage.removeItem('webbites.after_sign_in')
    const returnsHere = ['/cli?', '/oauth/authorize?'].some(prefix => returnTo?.startsWith(prefix))
    router.push(returnsHere ? returnTo : { name: 'app' })

  } catch (error) {
    console.error('Apple sign in error:', error)

    store.showAlert({
      message: error.message || t('shell.apple_callback.sign_in_failed'),
      type: 'error'
    })

    // Redirect back to home after error
    setTimeout(() => {
      router.push({ name: 'index' })
    }, 2000)
  }
})
</script>
