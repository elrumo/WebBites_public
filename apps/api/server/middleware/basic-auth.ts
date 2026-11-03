import { defineEventHandler, getRequestURL } from 'h3'
import { createBasicAuthMiddleware } from 'h3-basic-auth'
import { validateInternalApiKey } from '../utils/api-keys'


// The Basic credential this middleware once used is retired: it shipped in the
// browser extensions and in every audio token, so it could not be rotated.
// validateInternalApiKey now accepts only CUSTOM_API_KEY.

const isDev = process.env.NODE_ENV === 'development'

/**
 * Basic Authentication Middleware
 * Applies basic auth to protected routes
 *
 * Note: Specific auth requirements are handled by dedicated middleware:
 * - API key auth: server/middleware/api-key.ts
 * - Parse session auth: server/middleware/parse-auth.ts
 * - Stripe webhooks: server/middleware/stripe-webhook.ts
 * - Audio streaming: server/middleware/audio-auth.ts
 */
export default defineEventHandler(async (event) => {
  return
  // Skip middleware for GET requests
  if (event.method === 'GET') return  
  
  const path = getRequestURL(event).pathname

  // if (isDev) console.log('[Basic Auth] path: ', path)

  // Skip /v1/ routes (handled by api-key middleware)
  if (path.startsWith('/v1/')) return

  // Skip /auth routes
  if (path.startsWith('/auth')) return

  // Skip routes with dedicated middleware
  const skipPaths = [
    '/search',
    '/v1/search',
    '/isPageSaved',
    '/extension-auth',
    '/confirmPayment',
    '/v1/audio/streamAudio'
  ]

  if (skipPaths.includes(path)) return

  try {
    const isInternal = validateInternalApiKey(event)
    // console.log('isInternal: ', isInternal)
    if (isInternal) return
    else throw createError({
      statusCode: 403,
      message: 'Authentication failed'
    })

    // Apply basic auth for all other protected routes
    // const auth = createBasicAuthMiddleware(BASIC_AUTH_CONFIG)
    // return auth(event)
  } catch (error) {
    // Re-throw createError errors, wrap others
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Authentication failed'
    })
  }
})