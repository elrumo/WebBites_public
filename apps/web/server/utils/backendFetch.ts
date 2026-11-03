import { log } from './useDevLog'

/**
 * Server-side utility for making authenticated requests to the backend
 * This should be used in server API routes (server/api/*.ts)
 *
 * Automatically includes API key from cookies in Authorization header
 */

interface BackendFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: any
  headers?: Record<string, string>
  query?: Record<string, any>
}

export async function backendFetch<T = any>(
  event: any,
  endpoint: string,
  options: BackendFetchOptions = {}
): Promise<T> {
  // Get API key from cookie, with fallback to parse session
  const wbApiKey = getCookie(event, 'wb_api_key')
  const parseSession = getCookie(event, 'parse.session')

  // Use API key if available, otherwise fall back to parse session
  const authToken = wbApiKey || parseSession

  if (!authToken) {
    throw createError({
      statusCode: 401,
      message: 'Not authenticated. Please login.'
    })
  }

  // Clean endpoint - remove leading slashes and v1/ prefix if present
  const cleanEndpoint = endpoint.replace(/^\/+/, '')
  // const cleanEndpoint = endpoint.replace(/^\/+/, '').replace(/^v1\//, '')

  // Construct full backend URL
  const backendUrl = backendBaseUrl() || undefined
  console.log('backendUrl:', backendUrl)
  if (!backendUrl) {
    throw createError({
      statusCode: 500,
      message: 'Backend URL not configured'
    })
  }


  // Ensure backendUrl ends with slash
  const baseUrl = backendUrl.endsWith('/') ? backendUrl : `${backendUrl}/`
  let fullUrl = `${baseUrl}${cleanEndpoint}`

  log('[Backend Fetch] authToken:', authToken)
  log('[Backend Fetch] using:', wbApiKey ? 'API key' : 'Parse session')
  log('[Backend Fetch] cleanEndpoint:', cleanEndpoint)
  log('[Backend Fetch] Endpoint:', fullUrl)

  const requestOptions = {
    method: options.method || 'GET',
    body: options.body,
    query: options.query,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      ...options.headers
    }
  }
  
  try {
    // Make request to backend with API key
    const response = await $fetch<T>(fullUrl, requestOptions)

    log(`[Backend Fetch] ${requestOptions.method} ${fullUrl}`)

    return response
  } catch (error: any) {
    console.error(`[Backend Fetch] Error: ${error.message}`)

    // If 401 and using API key, clear it and try to regenerate
    if ((error.statusCode === 401 || error.status === 401) && wbApiKey) {
      log('⚠️ [Backend Fetch] API key invalid (401), clearing cookie...')
      deleteCookie(event, 'wb_api_key')

      // If we have a parse session, try to generate a new API key
      if (parseSession) {
        log('🔄 [Backend Fetch] Attempting to regenerate API key...')
        try {
          // Try to generate a new API key (with timeout to prevent hanging)
          const newKeyResponse = await Promise.race([
            $fetch('/api/auth/generateKey', {
              method: 'POST',
              headers: {
                'Cookie': `parse.session=${parseSession}`
              }
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Key generation timeout')), 5000)
            )
          ]) as any

          if (newKeyResponse?.success && newKeyResponse?.key) {
            log('✅ [Backend Fetch] New API key generated, retrying request...')

            // Retry the request with new API key
            const retryResponse = await $fetch<T>(fullUrl, {
              ...requestOptions,
              headers: {
                ...requestOptions.headers,
                'Authorization': `Bearer ${newKeyResponse.key}`
              }
            })

            return retryResponse
          }
        } catch (regenError) {
          console.error('⚠️ [Backend Fetch] Failed to regenerate API key:', regenError)
        }
      }
    }

    const upstreamStatus = error.statusCode || error.status || 500
    if (upstreamStatus === 529) {
      console.error(`[Backend Fetch] ⚠️ Upstream returned 529 (overloaded) for ${requestOptions.method} ${fullUrl} — body=${JSON.stringify(error.data)?.slice(0, 500)}`)
    }

    // Re-throw with more context. Map 529 -> 503 so it doesn't propagate as a
    // bare "overloaded" status to monitors/clients that don't expect it.
    throw createError({
      statusCode: upstreamStatus === 529 ? 503 : upstreamStatus,
      message: error.data?.message || error.message || 'Backend request failed'
    })
  }
}

/**
 * Make authenticated request to backend without needing the event object
 * Useful for background jobs or scheduled tasks
 *
 * @param apiKey - The API key to use for authentication
 * @param endpoint - API endpoint
 * @param options - Fetch options
 */
export async function backendFetchWithKey<T = any>(
  apiKey: string,
  endpoint: string,
  options: BackendFetchOptions = {}
): Promise<T> {
  // Clean endpoint
  const cleanEndpoint = endpoint.replace(/^\/+/, '').replace(/^v1\//, '')

  // Construct full backend URL
  const backendUrl = backendBaseUrl() || undefined
  if (!backendUrl) {
    throw new Error('Backend URL not configured')
  }

  const baseUrl = backendUrl.endsWith('/') ? backendUrl : `${backendUrl}/`
  const fullUrl = `${baseUrl}v1/${cleanEndpoint}`

  log(`[Backend Fetch] ${options.method || 'GET'} ${fullUrl}`)

  try {
    const response = await $fetch<T>(fullUrl, {
      method: options.method || 'GET',
      body: options.body,
      query: options.query,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...options.headers
      }
    })

    return response
  } catch (error: any) {
    console.error(`[Backend Fetch] Error: ${error.message}`)
    const upstreamStatus = error.statusCode || error.status || 500
    if (upstreamStatus === 529) {
      console.error(`[Backend Fetch] ⚠️ Upstream returned 529 (overloaded) for ${options.method || 'GET'} ${fullUrl} — body=${JSON.stringify(error.data)?.slice(0, 500)}`)
      throw createError({
        statusCode: 503,
        message: error.data?.message || error.message || 'Backend overloaded'
      })
    }
    throw error
  }
}
