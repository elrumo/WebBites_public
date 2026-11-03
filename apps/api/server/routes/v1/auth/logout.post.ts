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
  // Clear the API key cookie
  deleteCookie(event, 'wb_api_key')

  return {
    success: true,
    message: 'Logged out successfully'
  }
})
