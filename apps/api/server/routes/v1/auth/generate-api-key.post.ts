import { validateParseToken } from '../../../utils/raycast-auth'
import { createApiKey, listUserApiKeys, cleanupOldApiKeys } from '../../../utils/api-keys'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Generate API key from session token',
    description: 'Exchanges a valid Raycast/session token for a new API key. This is the primary endpoint for users to get their first API key. If the user has 10 or more keys, the oldest keys are automatically deleted to make room for the new one.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Optional name to identify this API key',
                example: 'Chrome Extension'
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'API key generated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  example: true
                },
                apiKeyData: {
                  type: 'object',
                  properties: {
                    key: {
                      type: 'string',
                      example: 'wb_live_xxxxxxxxxxxxxxxxxxxx',
                      description: 'The generated API key. Save this securely - it cannot be retrieved again.'
                    },
                    userId: {
                      type: 'string',
                      example: 'user123'
                    },
                    name: {
                      type: 'string',
                      example: 'Chrome Extension'
                    }
                  }
                }
              }
            }
          }
        }
      },
      401: {
        description: 'Invalid or missing session token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'integer',
                  example: 401
                },
                message: {
                  type: 'string',
                  example: 'Invalid or expired session token'
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
 * Generate API Key from Session Token
 *
 * This endpoint allows authenticated users (via Raycast/session token)
 * to generate API keys without needing an existing API key.
 *
 * Flow:
 * 1. User authenticates with Raycast/session (existing auth system)
 * 2. Calls this endpoint with session token in Authorization header
 * 3. Receives a new API key
 * 4. Uses API key for subsequent requests to /v1/* endpoints
 */
export default defineEventHandler(async (event) => {
  const isDev = process.env.NODE_ENV === 'development'
  const requestId = Math.random().toString(36).substring(7)
  const clientIP = getRequestIP(event)
  const userAgent = getHeader(event, 'user-agent')
  const authHeader = getHeader(event, 'authorization')
  
  console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🔍 Request received from ${clientIP}`)

  if (isDev) {
    // console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🚀 API key generation attempt from ${clientIP}`)
    // console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 📱 User-Agent: ${userAgent}`)
    // console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🔑 Auth header present: ${!!authHeader}`)
  }

  try {
    console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🔍 Validating Parse session token...`)

    // Validate the session token using existing auth
    const user = await validateParseToken(event)

    log(`[AUTH:GENERATE-API-KEY:${requestId}] ✅ Parse session validated for user: ${JSON.stringify({
      userId: user.user.id,
      username: user.user.username || 'N/A',
      email: user.user.email || 'N/A'
    })}`)

    // Get optional name from request body
    const body = await readBody(event).catch(() => ({}))
    const name = body?.name || `sk-${user.user.id}-${new Date().toISOString()}`

    log(`[AUTH:GENERATE-API-KEY:${requestId}] 📝 Request body:`, {
      providedName: body?.name || 'N/A',
      finalName: name
    })

    // Check existing API keys before creating a new one
    if (isDev) {
      console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🔍 Checking for existing API keys...`)
    }

    const existingKeys = await listUserApiKeys(user.user.id)

    if (isDev) {
      console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 📊 User has ${existingKeys.length} existing API key(s)`)
    }

    // Enforce maximum keys limit with automatic cleanup
    const MAX_KEYS_PER_USER = 10
    if (existingKeys.length >= MAX_KEYS_PER_USER) {
      if (isDev) {
        console.log(`[AUTH:GENERATE-API-KEY:${requestId}] ⚠️  User has reached maximum key limit (${MAX_KEYS_PER_USER})`)
        console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🧹 Auto-cleaning oldest keys to make room...`)
      }

      // Automatically delete oldest keys to make room for new one
      const deletedCount = await cleanupOldApiKeys(user.user.id, MAX_KEYS_PER_USER)

      if (isDev) {
        console.log(`[AUTH:GENERATE-API-KEY:${requestId}] ✅ Deleted ${deletedCount} old key(s)`)
      }

      // Refresh the keys list after cleanup
      const updatedKeys = await listUserApiKeys(user.user.id)
      existingKeys.length = 0
      existingKeys.push(...updatedKeys)
    }

    if (isDev) {
      console.log(`[AUTH:GENERATE-API-KEY:${requestId}] ✅ Validation passed. Creating API key with name: "${name}"`)
    }

    // Create new API key for this user
    const apiKeyData = await createApiKey(user.user.id, name)

    if (isDev) {
      console.log(`[AUTH:GENERATE-API-KEY:${requestId}] ✅ API key created successfully:`, {
        keyPrefix: apiKeyData.key.substring(0, 15) + '...',
        userId: apiKeyData.userId,
        name: apiKeyData.name || 'N/A'
      })
      console.log(`[AUTH:GENERATE-API-KEY:${requestId}] 🎉 API key generation successful for user ${user.user.id}`)
    }

    return {
      success: true,
      apiKeyData
    }

  } catch (error: any) {
    if (isDev) {
      console.error(`[AUTH:GENERATE-API-KEY:${requestId}] 💥 API key generation failed:`, {
        error: error.message,
        statusCode: error.statusCode || 500,
        stack: error.stack,
        clientIP,
        userAgent,
        hasAuthHeader: !!authHeader
      })
    } else {
      // In production, log minimal error info
      console.error(`[AUTH:GENERATE-API-KEY] API key generation failed: ${error.message} (IP: ${clientIP})`)
    }

    // Re-throw the error to maintain existing error handling
    throw error
  }
})
