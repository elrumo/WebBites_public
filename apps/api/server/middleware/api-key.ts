import { defineEventHandler, getHeader, createError, getCookie, getRequestURL, getRequestIP } from 'h3'
import { validateParseToken } from '../utils/raycast-auth.js'
import { validateApiKey, validateInternalApiKey } from '../utils/api-keys'
import { routeAccess, normalisePath } from '../utils/apiRouteAccess'

/**
 * Authentication gate for every /v1/* route.
 *
 * - PUBLIC routes pass untouched (they authenticate themselves: Stripe/Apple
 *   signatures, OAuth `state`, signed audio tokens, or are genuinely public).
 * - The internal key (CUSTOM_API_KEY, raw or Bearer, or the legacy Basic
 *   credential — see validateInternalApiKey) passes everywhere. That is what
 *   callBackendEndpoint (QStash pipeline) and parse-compose triggers send.
 * - INTERNAL_ONLY routes take raw savedSiteId/userId and trust them, so a user
 *   credential is not enough: they need the internal key.
 * - Everything else needs a user: Parse session (Bearer r:...), API key
 *   (Bearer wb_live_...) or the wb_api_key cookie.
 */

export default defineEventHandler(async (event) => {
  if (event.method === 'OPTIONS') return

  let path: string
  try {
    path = normalisePath(getRequestURL(event).pathname)
  } catch {
    throw createError({ statusCode: 400, message: 'Malformed path' })
  }

  const access = routeAccess(path)
  if (access === 'none' || access === 'public') return

  if (validateInternalApiKey(event)) {
    event.context.internal = true
    return
  }

  if (access === 'internal') {
    throw createError({ statusCode: 401, message: 'Internal route: missing or invalid internal API key' })
  }

  const authHeader = getHeader(event, 'authorization')

  if (authHeader?.startsWith('Bearer r:')) {
    // Throws 401 itself on a bad/expired session.
    await validateParseToken(event)
    return
  }

  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : getCookie(event, 'wb_api_key')
  if (!apiKey) throw createError({ statusCode: 401, message: 'Missing API key.' })

  let userId: string | null
  try {
    userId = await validateApiKey(apiKey)
  } catch (error: any) {
    console.error(`[AUTH:MIDDLEWARE] API key validation error: ${error.message} (IP: ${getRequestIP(event)}, Path: ${path})`)
    throw createError({ statusCode: 500, message: 'Failed to validate API key' })
  }

  if (!userId) {
    console.error(`[AUTH:MIDDLEWARE] Invalid API key attempt from ${getRequestIP(event)}`)
    throw createError({ statusCode: 401, message: 'Invalid API key' })
  }

  event.context.apiKey = { key: apiKey, userId }
})
