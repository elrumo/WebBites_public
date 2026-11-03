import Parse from 'parse'

/**
 * Authentication composable for WebBites
 * Provides easy access to auth functions throughout the app
 */
import { getCookie } from 'h3'
const { log } = useDevLog()

export const useAuth = () => {
  const getCurrentParseUser = () => {
    if (typeof window === 'undefined') return null
    return window.Parse?.User?.current?.() ?? null
  }

  /**
   * Check if user is currently authenticated
   */
  const isAuthenticated = computed(() => {
    if (process.server) return false

    return !!getCurrentParseUser()
  })

  /**
   * Get current user information
   */
  const currentUser = computed(() => {
    if (process.server) return null

    return getCurrentParseUser()
  })

  // API URL redirection for native apps is handled globally by
  // plugins/native-api-redirect.client.ts — just pass the path through.
  const getApiUrl = (path: string) => path

  /**
   * Login with username/email and password
   */
  const login = async (username: string, password: string) => {
    try {
      // First, login with Parse on the frontend
      if (typeof window === 'undefined' || !window.Parse) {
        throw new Error('Parse is not available')
      }

      // Perform Parse login on frontend
      const parseUser = await window.Parse.User.logIn(username, password)
      
      if (!parseUser) {
        throw new Error('Parse login failed')
      }

      // Get the session token from the current user
      const currentUser = window.Parse?.User?.current?.()
      const sessionToken = currentUser?.getSessionToken()

      if (!sessionToken) throw new Error('No session token available')

      // Send session token to backend for API key exchange
      const apiUrl = getApiUrl('/api/auth/login')
      const response = await $fetch(apiUrl, {
        method: 'POST',
        body: { sessionToken }
      })

      if ((response as any)?.success) {
        return {
          success: true,
          userId: (response as any).userId,
          sessionToken: sessionToken,
          backendAuth: (response as any).backendAuth || false,
          message: (response as any).message
        }
      }
    } catch (error: any) {
      console.error('Login error:', error)
      
      // If Parse login succeeded but backend failed, we should logout from Parse
      if (typeof window !== 'undefined' && window.Parse) {
        const currentUser = window.Parse?.User?.current?.()
        if (currentUser && error.message?.includes('Backend')) {
          // Keep Parse session but indicate backend auth failed
          console.warn('Parse login succeeded but backend authentication failed')
          return {
            success: true,
            userId: currentUser.id,
            backendAuth: false,
            message: 'Parse-only login (backend unavailable)'
          }
        }
      }
      
      throw new Error(error.data?.message || error.message || 'Login failed')
    }
  }

  /**
   * Logout current user
   */
  const logout = async () => {
    try {
      const apiUrl = getApiUrl('/api/auth/logout')
      await $fetch(apiUrl, { method: 'POST' })
      
      // Clear Parse session client-side
      if (typeof window !== 'undefined' && window.Parse) {
        try {
          await window.Parse.User.logOut()
        } catch (err) {
          console.error('[useAuth] Error logging out user 1:', err)
          try {
            await window.Parse.User.logOut()
          } catch (err) {
            console.error('[useAuth] Error logging out user 2:', err)
          }
        }
      }
      
      // Redirect to home page
      await navigateTo('/')
      
      return { success: true }
    } catch (error: any) {
      console.error('Logout error:', error)
      // Fallback: clear Parse session cookie manually (wb_api_key is httpOnly and cleared server-side)
      if (process.client) {
        document.cookie = 'parse.session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;'
      }
      throw error
    }
  }

  /**
   * Make authenticated API request to v1 endpoints
   */
  const apiRequest = async <T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      body?: any
      query?: Record<string, any>
    } = {}
  ): Promise<T> => {
    try {
      const apiUrl = getApiUrl(`/api/v1/${endpoint}`)
      return await $fetch<T>(apiUrl, {
        method: options.method || 'GET',
        body: options.body,
        query: options.query
      })
    } catch (error: any) {
      // Error handling is done by the global error handler plugin
      throw error
    }
  }

  /**
   * Check if user has valid session and refresh if needed
   */
  const checkSession = async () => {
    if (!isAuthenticated.value) {
      return false
    }

    try {
      // Try to make a simple authenticated request to verify session
      await apiRequest('example') // This will trigger 401 if session is invalid
      return true
    } catch (error: any) {
      if (error.status === 401 || error.statusCode === 401) {
        return false
      }
      // Other errors don't necessarily mean auth is invalid
      return true
    }
  }

  /**
   * Check authentication status by verifying session token
   * This function works on both client and server side
   */
  const checkAuth = async () => {
    try {
      // On server side, we can access cookies directly
      if (process.server) {
        const event = useRequestEvent()
        if (!event) {
          console.log('No request event available')
          return { isLoggedIn: false }
        }
        const sessionToken = getCookie(event, 'parse.session')
        
        if (process.dev) console.log('sessionToken:', sessionToken)

        if (!sessionToken) {
          console.log('No session cookie found')
          return { isLoggedIn: false }
        }

        // Import the session verification utility
        const { verifySession } = await import('../../server/utils/sessionCache')
        const user = await verifySession(sessionToken)
        
        if (process.dev) console.log('user', user)

        if (!user) {
          // Invalid session - let the middleware handle cookie cleanup
          return { isLoggedIn: false }
        }

        return {
          isLoggedIn: true,
          user: {
            id: user.id,
            sessionId: sessionToken,
            userId: user.id,
            email: user.get('email'),
            username: user.get('username')
          }
        }
      } else {
        // On client side, use the existing Parse logic
        if (typeof window !== 'undefined' && window.Parse) {
          const currentUser = window.Parse?.User?.current?.()
          if (currentUser) {
            return {
              isLoggedIn: true,
              user: {
                id: currentUser.id,
                sessionId: currentUser.getSessionToken?.() ?? null,
                userId: currentUser.id,
                email: currentUser.get('email'),
                username: currentUser.get('username')
              }
            }
          }
        }
        return { isLoggedIn: false }
      }
    } catch (error: any) {
       // Log error but let middleware handle cookie cleanup
       console.error('Auth check error:', error)
       return { isLoggedIn: false, error: error.message }
     }
  }

  const generateApiKey = async (): Promise<string | null> => {
    try {
      // Call the generate key endpoint - it will check if key exists and return it,
      // or generate a new one. The cookie is set server-side as httpOnly.
      // log('[useAuth] 🔑 Generating API key...')
      const apiUrl = getApiUrl('/api/auth/generateKey')
      const response = await $fetch(apiUrl, {
        method: 'POST'
      })

      // Handle the response format
      const res = response as any
      if (res?.success && res?.key) {
        // log('[useAuth] 🔑 API key generated and saved by server')
        // Note: The cookie is set server-side as httpOnly, so we cannot read it client-side
        // but it will be automatically sent with requests
        return res.key
      } else {
        console.warn('[useAuth] Failed to generate API key:', response)
        return null
      }
    } catch (error) {
      console.error('[useAuth] Error generating API key:', error)
      return null
    }
  }

  /**
   * Ensure API key exists, generate if needed
   * Note: API key is stored in httpOnly cookie on server, so we can't read it directly.
   * We always call the server endpoint which checks if the cookie exists or generates a new one.
   */
  const ensureApiKey = async (): Promise<string | null> => {
    try {
      // Check if we have a valid Parse session
      const parseSession = useCookie('parse.session')

      // log('[useAuth] parseSession:', parseSession.value)

      if (!parseSession.value) {
        console.log('No Parse session available for API key generation')
        return null
      }

      // Call the generate key endpoint - it will check if key exists in the httpOnly cookie
      // and return it, or generate a new one. We cannot check the cookie client-side because
      // it's httpOnly for security.
      // log('[useAuth] 🔑 Checking/generating API key...')

      // Note: We cannot read wb_api_key cookie client-side because it's httpOnly.
      // The server endpoint will check if a valid key exists and either return it or generate a new one.
      const apiKey = await generateApiKey()

      // log('[useAuth] 🔑 API key:', apiKey)

      if (apiKey) {
        return apiKey
      } else {
        throw new Error('Failed to generate API key')
      }
    } catch (error) {
      console.error('Error ensuring API key:', error)
      return null
    }
  }

  /**
   * Validate API key with backend
   * @param apiKey - The API key to validate
   */
  const validateApiKey = async (apiKey: string): Promise<boolean> => {
    try {
      // Make a lightweight request to validate the API key
      // Using a simple endpoint that should return quickly
      const timeoutMs = 3000 // 3 seconds timeout for validation

      const fetchWithTimeout = Promise.race([
        fetch(`${useRuntimeConfig().public.backendUrl}v1/auth/validateApiKey`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        }),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Validation timeout')), timeoutMs)
        )
      ])

      const result = await fetchWithTimeout

      // If we get 200, key is valid. If 401/403, key is invalid
      return result.ok
    } catch (error) {
      console.error('[useAuth] Error validating API key:', error)
      // On error or timeout, assume invalid to trigger regeneration
      return false
    }
  }

  /**
   * Make authenticated API request with automatic API key generation
   * Note: The API key is stored as an httpOnly cookie and automatically sent with requests.
   * The server-side proxy (/api/v1/[...path].ts) reads the cookie and forwards it to the backend.
   */
  const makeAuthenticatedRequest = async <T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      body?: any
      headers?: Record<string, string>
      query?: Record<string, any>
    } = {}
  ): Promise<T> => {
    try {
      // Remove the leading /api/v1 if the endpoint already includes it
      const cleanEndpoint = endpoint.replace(/^\/api\/v1\//, '')
      const apiUrl = getApiUrl(`/api/v1/${cleanEndpoint}`)

      // Make the request - the wb_api_key cookie is automatically sent with the request
      // and the server-side proxy will handle authentication
      const response = await $fetch<T>(apiUrl, {
        method: options.method || 'GET',
        body: options.body,
        query: options.query,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      })

      return response
    } catch (error: any) {
      // If we get a 401 and don't have a session, redirect to login
      if (error.statusCode === 401 || error.statusCode === 403) {
        console.log('🔑 API key missing or invalid, attempting to generate...')

        // Try to generate an API key (this will only work if user has a valid Parse session)
        const apiKey = await ensureApiKey()

        if (apiKey) {
          // Wait a bit to ensure the cookie is properly set by the browser
          await new Promise(resolve => setTimeout(resolve, 100))

          // Retry the request - the cookie should now be set
          const cleanEndpoint = endpoint.replace(/^\/api\/v1\//, '')
          const apiUrl = getApiUrl(`/api/v1/${cleanEndpoint}`)
          return await $fetch<T>(apiUrl, {
            method: options.method || 'GET',
            body: options.body,
            query: options.query,
            headers: {
              'Content-Type': 'application/json',
              ...options.headers
            }
          })
        } else {
          // No valid session, cannot generate API key
          console.error('Cannot generate API key without valid Parse session')
          throw error
        }
      }

      // Other errors - just throw them
      throw error
    }
  }

  return {
    isAuthenticated: readonly(isAuthenticated),
    currentUser: readonly(currentUser),
    login,
    logout,
    apiRequest,
    checkSession,
    checkAuth,
    ensureApiKey,
    validateApiKey,
    makeAuthenticatedRequest
  }
}
