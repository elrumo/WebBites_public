import { getCookie } from 'h3'
import { validateApiKey, listUserApiKeys, hashApiKey, revokeApiKey } from '../../../utils/api-keys'
defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Logout and clear API key cookie',
    description: 'Clears the HTTP-only API key cookie, effectively logging out the user from the web application',
    responses: {
      200: {
        description: 'Logged out successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  example: true
                },
                message: {
                  type: 'string',
                  example: 'Logged out successfully'
                }
              }
            }
          }
        }
      }
    }
  }
})

/**
 * Logout Endpoint
 *
 * Clears the API key cookie. The API key itself remains valid in Redis
 * and can still be used with the Authorization header (e.g., from extensions).
 *
 * To fully revoke an API key, use DELETE /v1/keys/revoke
 */
export default defineEventHandler(async (event) => {
  // Revoke the key the cookie holds when it is one minted at sign-in: deleting
  // the cookie alone left a working key behind on the server for good.
  const cookieKey = getCookie(event, 'wb_api_key')
  if (cookieKey) {
    try {
      const userId = await validateApiKey(cookieKey)
      if (userId && userId !== 'custom') {
        const keys = await listUserApiKeys(userId)
        const mine = keys.find((k) => k.id === hashApiKey(cookieKey))
        if (mine?.kind === 'session') await revokeApiKey(cookieKey)
      }
    } catch (error: any) {
      console.warn('[logout] could not revoke the sign-in key:', error?.message)
    }
  }

  // Clear the API key cookie
  deleteCookie(event, 'wb_api_key')

  return {
    success: true,
    message: 'Logged out successfully'
  }
})
