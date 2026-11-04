import { validateParseToken } from '../../../utils/raycast-auth'
import { createApiKey, getApiKeyFromEvent } from '../../../utils/api-keys'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Validate API key and set as HTTP-only cookie',
    description: 'Validates an API key from the Authorization header and sets it as a secure HTTP-only cookie. Use this for web applications.',
    parameters: [
      {
        in: 'header',
        name: 'Authorization',
        required: true,
        description: 'Bearer token containing the API key',
        schema: { type: 'string' },
        example: 'Bearer wb_live_xxxxx'
      }
    ],
    responses: {
      200: {
        description: 'API key validated and set as cookie',
        headers: {
          'Set-Cookie': {
            description: 'HTTP-only cookie containing the API key',
            schema: {
              type: 'string',
              example: 'wb_api_key=wb_live_xxxxx; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/'
            }
          }
        },
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
                  example: 'API key validated and set as cookie'
                },
                userId: {
                  type: 'string',
                  example: 'user123'
                },
                apiKey: {
                  type: 'string',
                  example: 'wb_live_xxxxx'
                }
              }
            }
          }
        }
      },
      403: {
        description: 'Invalid API key',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: { type: 'number', example: 403 },
                message: { type: 'string', example: 'Invalid API key.' }
              }
            }
          }
        }
      }
    }
  }
})

/**
 * Validate the API key from the request headers or cookie
 */
export default defineEventHandler(async (event) => {
  // Validate the session token using existing auth
  const userId = await validateApiKeyFromEvent(event)
  const apiKey = await getApiKeyFromEvent(event)
  
  if (!userId) {
    throw createError({
      statusCode: 403,
      message: 'Invalid API key.'
    })
  }
  // Set as HTTP-only cookie
  setCookie(event, 'wb_api_key', apiKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/'
  })

  // Never log `apiKey`: it is a non-expiring bearer credential for the whole
  // account, and this line runs on every web login.
  log('[AUTH] api key validated:', { userId })

  return {
    success: true,
    message: 'API key generated and set as cookie',
    userId: userId,
    apiKey: apiKey
  }
})
