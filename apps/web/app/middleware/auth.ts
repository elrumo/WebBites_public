import { useRuntimeConfig } from '#app'
import { setCookie } from 'h3'

export default defineNuxtRouteMiddleware(async (to, from) => {

  // Only run on server side to prevent duplicate execution
  if (import.meta.client) return
  
  // Skip middleware for API routes
  if (to.path.startsWith('/api/')) return

  // Note: On initial SSR, 'from' equals 'to'; do not skip here.

  // Get the event object for accessing request details
  const event = useRequestEvent()

  // console.log('🔒 [SERVER] AUTH MIDDLEWARE TRIGGERED for route:', to.path)
  // console.log('🔒 [SERVER] From route:', from?.path || 'initial')

  // Access authentication cookies
  const parseSession = useCookie('parse.session')
  const wbApiKey = useCookie('wb_api_key')

  // console.log('🔒 [SERVER] Cookies check - Parse session:', !!parseSession.value, 'WB API key:', !!wbApiKey.value)

  // SKIP API key generation in middleware to prevent timeouts
  // API key will be generated on-demand when the first API call is made
  // This prevents middleware from blocking page loads when backend has cold starts
  if (import.meta.dev) {
    console.log('🔒 [SERVER] wbApiKey.value:', wbApiKey.value)
  }
  
  if (parseSession.value && !wbApiKey.value && event) {
    if (import.meta.dev) {
      console.log('⚠️ [SERVER] API key missing - will be generated on first API call')
    }
  }

  // Determine if user has any form of authentication
  const hasAuthentication = !!(parseSession.value || wbApiKey.value)

  // OPTIMIZATION: Trust the presence of cookies and skip expensive Parse session verification
  // to prevent middleware timeouts. Session validation will happen on actual API calls.
  const isLoggedIn = hasAuthentication

  // Set the auth status and userId in the state
  useState('auth:status').value = isLoggedIn
  useState('auth:userId').value = null // Will be populated by client-side auth check

  // console.log('🔒 [SERVER] Final auth status - isLoggedIn:', isLoggedIn)

  // Route protection logic
  const protectedRoutes = ['/app', '/admin']
  const isProtectedRoute = protectedRoutes.some(route => to.path.startsWith(route))
  const isAuthRoute = to.path === '/login'

  // console.log('🔒 [SERVER] Route analysis - isProtected:', isProtectedRoute, 'isAuthRoute:', isAuthRoute)

  // NEW: If the URL param does not have source=extension and a parse cookie exists, redirect to /app
  const sourceParam = (to as any)?.query?.source

  if (isAuthRoute && sourceParam !== 'extension' && parseSession.value) {
    // console.log('🔒 [SERVER] REDIRECTING: Parse session exists and not extension flow')
    return navigateTo('/app')
  }

  // If user is not authenticated and trying to access protected routes
  if (!isLoggedIn && isProtectedRoute) {
    // console.log('🔒 [SERVER] REDIRECTING: User not logged in, trying to access protected route')
    return navigateTo('/')
  }

  console.log('🔒 [SERVER] isLoggedIn:', isLoggedIn, 'to.path:', to.path)
  if(isLoggedIn && to.path === '/') {
    return navigateTo('/app')
  }

  // If user is authenticated and trying to access auth pages, redirect to app
  // if (isLoggedIn && isAuthRoute) {
  //   // console.log('🔒 [SERVER] REDIRECTING: User logged in, trying to access auth page')
  //   return navigateTo('/app')
  // }

  // console.log('🔒 [SERVER] MIDDLEWARE COMPLETE: No redirect needed')
})
