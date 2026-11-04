import { setHeaders } from 'h3'
import { validateParseToken } from '../../../utils/raycast-auth'
import { createApiKey } from '../../../utils/api-keys'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Login with Parse session and set API key cookie',
    description: 'For web apps: validates Parse session, generates API key, and sets it as an HTTP-only cookie. Frontend does NOT need Redis.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['sessionToken'],
            properties: {
              sessionToken: {
                type: 'string',
                description: 'Parse session token from Parse.User.logIn()',
                example: 'r:abc123def456...'
              },
              name: {
                type: 'string',
                description: 'Optional name for the API key',
                example: 'Web Application'
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Login successful, API key set as cookie',
        headers: {
          'Set-Cookie': {
            description: 'HTTP-only cookie containing API key',
            schema: {
              type: 'string',
              example: 'wb_api_key=wb_live_xxx; HttpOnly; Secure; SameSite=Lax'
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
                userId: {
                  type: 'string',
                  example: 'user123'
                },
                message: {
                  type: 'string',
                  example: 'Logged in successfully'
                }
              }
            }
          }
        }
      },
      401: {
        description: 'Invalid Parse session token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: { type: 'integer', example: 401 },
                message: { type: 'string', example: 'Invalid or expired session token' }
              }
            }
          }
        }
      }
    }
  }
})

/**
 * Web App Login Endpoint
 *
 * This endpoint is designed for web applications (Nuxt, Next.js, etc.)
 * that want to use HTTP-only cookies for API key storage.
 *
 * Flow:
 * 1. Frontend: User logs in with Parse.User.logIn() → gets sessionToken
 * 2. Frontend: Calls this endpoint with sessionToken in body
 * 3. Backend: Validates Parse session
 * 4. Backend: Generates API key
 * 5. Backend: Sets API key as HTTP-only cookie
 * 6. Frontend: Cookie automatically sent with all future requests
 *
 * Benefits:
 * - Frontend does NOT need Redis
 * - API key never exposed to JavaScript
 * - All auth logic centralized in Nitro
 * - Frontend is stateless (just sends cookie)
 */
export default defineEventHandler(async (event) => {
  const isDev = process.env.NODE_ENV === 'development'
  const requestId = Math.random().toString(36).substring(7)
  const clientIP = getRequestIP(event)
  const userAgent = getHeader(event, 'user-agent')
  
  if (isDev) {
    // console.log(`[AUTH:SESSION-LOGIN:${requestId}] 🚀 Session login attempt from ${clientIP}`)
    // console.log(`[AUTH:SESSION-LOGIN:${requestId}] 📱 User-Agent: ${userAgent}`)
  }

  
  try {
    const body = await readBody(event)
    const { sessionToken, name } = body

    if (isDev) {
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] 📝 Request body:`, {
        hasSessionToken: !!sessionToken,
        sessionTokenLength: sessionToken?.length || 0,
        sessionTokenPrefix: sessionToken?.substring(0, 10) + '...',
        name: name || 'undefined'
      })
    }

    if (!sessionToken) {
      if (isDev) {
        console.error(`[AUTH:SESSION-LOGIN:${requestId}] ❌ Missing sessionToken in request body`)
      }
      throw createError({
        statusCode: 400,
        message: 'sessionToken is required'
      })
    }

    if (isDev) {
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] 🔍 Validating Parse session token...`)
    }

    // Validate Parse session (temporarily set in header for validateParseToken)
    setHeaders(event, { 'authorization': `Bearer ${sessionToken}` })
    const user = await validateParseToken(event)

    if (isDev) {
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] ✅ Parse session validated for user:`, JSON.stringify({
        userId: user.user.id,
        username: user.user.username || 'N/A',
        email: user.user.email || 'N/A'
      }))
    }

    // Generate or reuse API key
    const keyName = name || 'Web Application'
    
    if (isDev) {
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] 🔑 Generating API key with name: "${keyName}"`)
    }

    const apiKeyData = await createApiKey(user.user.id, keyName)

    if (isDev) {
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] ✅ API key generated:`, {
        keyPrefix: apiKeyData.key.substring(0, 15) + '...',
        userId: apiKeyData.userId,
        name: apiKeyData.name || 'N/A'
      })
    }

    // Set API key as HTTP-only cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.DEV_HTTPS === 'true',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/'
    }

    setCookie(event, 'wb_api_key', apiKeyData.key, cookieOptions)

    if (isDev) {
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] 🍪 Cookie set with options:`, {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        maxAge: cookieOptions.maxAge,
        path: cookieOptions.path
      })
      console.log(`[AUTH:SESSION-LOGIN:${requestId}] 🎉 Login successful for user ${user.user.id}`)
    }

    return {
      success: true,
      userId: user.user.id,
      message: 'Logged in successfully'
    }

  } catch (error: any) {
    if (isDev) {
      console.error(`[AUTH:SESSION-LOGIN:${requestId}] 💥 Login failed:`, {
        error: error.message,
        statusCode: error.statusCode || 500,
        stack: error.stack,
        clientIP,
        userAgent
      })
    } else {
      // In production, log minimal error info
      console.error(`[AUTH:SESSION-LOGIN] Login failed: ${error.message} (IP: ${clientIP})`)
    }

    // Re-throw the error to maintain existing error handling
    throw error
  }
})