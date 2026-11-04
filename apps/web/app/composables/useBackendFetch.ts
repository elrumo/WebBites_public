/**
 * Custom fetch wrapper for authenticated backend requests
 * Automatically adds API key to all requests to the backend
 *
 * @example
 * ```typescript
 * const { backendFetch } = useBackendFetch()
 *
 * // Simple GET request
 * const data = await backendFetch('users/profile')
 *
 * // POST request with body
 * const result = await backendFetch('search', {
 *   method: 'POST',
 *   body: { query: 'test', filters: [] }
 * })
 *
 * // Request without auth (public endpoint)
 * const public = await backendFetch('public/data', { skipAuth: true })
 * ```
 */

// Track if we're currently generating an API key to prevent race conditions
let isGeneratingKey = false
let keyGenerationPromise: Promise<string | null> | null = null

export const useBackendFetch = () => {
  // Boards routes authenticate with the Parse session, but app.vue only writes the
  // `parse.session` cookie after `become()` resolves — the sidebar mounts first and
  // lost that race. Parse.User.current() is synchronous (localStorage), so send it.
  const sessionHeader = (): Record<string, string> => {
    const token = import.meta.client ? (window as any).Parse?.User?.current?.()?.getSessionToken?.() : null
    return token ? { 'x-parse-session-token': token } : {}
  }

  /**
   * Make authenticated request to backend
   * Automatically includes API key from cookie via proxy
   *
   * @param endpoint - API endpoint (e.g., 'search', 'users/profile')
   * @param options - Fetch options
   * @returns Promise with response data
   */
  const backendFetch = async <T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      body?: any
      headers?: Record<string, string>
      query?: Record<string, any>
      skipAuth?: boolean // Allow bypassing auth for public endpoints
    } = {}
  ): Promise<T> => {
    try {
      // Clean the endpoint - remove leading slashes and v1/ prefix if present
      const cleanEndpoint = endpoint.replace(/^\/+/, '').replace(/^v1\//, '')

      // Make the request through our proxy endpoint
      // The wb_api_key cookie is automatically sent with the request
      // and the server-side proxy (/api/v1/[...path].ts) handles authentication
      
      // Always relative: the `native-api-redirect` plugin rewrites `/api/...`
      // onto the Nuxt server for Electrobun. Pointing these at `backendUrl`
      // instead produced `https://api.webbites.io//api/v1/boards`, which the
      // backend does not serve (its routes are `/v1/*`, not `/api/v1/*`).
      const requestUrl = `/api/v1/${cleanEndpoint}`

      const response = await $fetch<T>(requestUrl, {
        method: options.method || 'GET',
        body: options.body,
        query: options.query,
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
          ...sessionHeader(),
          ...options.headers
        }
      })

      return response
    } catch (error: any) {
      // Handle 401 errors - try to generate API key if missing
      if (error.statusCode === 401 || error.statusCode === 403) {
        console.log('🔑 Request failed with 401/403, attempting to generate API key...')

        try {
          // Check if another request is already generating the key
          if (isGeneratingKey && keyGenerationPromise) {
            console.log('🔑 Another request is already generating the key, waiting...')
            await keyGenerationPromise
          } else {
            // Mark that we're generating a key and store the promise
            isGeneratingKey = true
            keyGenerationPromise = (async () => {
              try {
                const { ensureApiKey } = useAuth()
                const apiKey = await ensureApiKey()

                if (apiKey) {
                  // Wait a bit to ensure the cookie is properly set by the browser
                  // This is crucial because Set-Cookie headers need time to be processed
                  await new Promise(resolve => setTimeout(resolve, 100))
                  return apiKey
                }
                return null
              } finally {
                // Reset the generation state
                isGeneratingKey = false
                keyGenerationPromise = null
              }
            })()

            await keyGenerationPromise
          }

          // Now retry the request with the cookie that should be set
          const cleanEndpoint = endpoint.replace(/^\/+/, '').replace(/^v1\//, '')
          const retryUrl = `/api/v1/${cleanEndpoint}`

          return await $fetch<T>(retryUrl, {
            method: options.method || 'GET',
            body: options.body,
            query: options.query,
            headers: {
              'Content-Type': 'application/json',
              'bypass-tunnel-reminder': 'true',
              ...sessionHeader(),
              ...options.headers
            }
          })
        } catch (retryError) {
          console.error('Failed to retry request after key generation:', retryError)
          throw retryError
        }
      }

      throw error
    }
  }

  return {
    backendFetch
  }
}
