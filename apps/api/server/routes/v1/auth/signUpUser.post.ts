import { defineEventHandler, readBody, createError } from 'h3'
import Parse from 'parse/node.js'
import { decodeJwt } from 'jose'
import { handleAppleAuth, AppleAuthError, type AppleAuthData } from '../../../utils/apple-auth'
import { getFreePlanPointer } from '../../../utils/plans'
import { storeAppleRefreshToken } from '../../../utils/appleTokens'
import { selfUrl } from '../../../utils/site'

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const AUTH_HEADER = `Bearer ${process.env.CUSTOM_API_KEY}`

interface SignUpRequestBody {
  username?: string
  password?: string
  email?: string
  appleAuth?: AppleAuthData
}

interface SignUpResponse {
  success: boolean
  newUser: {
    id: string
    createdAt: string
    sessionToken: string
    username?: string
    email?: string
  }
}

interface ErrorResponse {
  statusCode: number
  statusMessage: string
  errorCode?: string
  details?: string
}

defineRouteMeta({
  openAPI: {
    tags: ["Authentication"],
    description: "Register a new user for Webbites",
    requestBody: {
      description: "User registration details",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              username: {
                type: "string",
                description: "User's desired username (required for standard signup)",
                example: "johndoe"
              },
              password: {
                type: "string",
                description: "User's password (required for standard signup)",
                example: "securePassword123"
              },
              email: {
                type: "string",
                format: "email",
                description: "User's email address (required for standard signup)",
                example: "user@example.com"
              },
              appleAuth: {
                type: "object",
                description: "Apple authentication data (alternative to username/password/email)",
                properties: {
                  id_token: {
                    type: "string",
                    description: "JWT token from Apple Sign In",
                    example: "eyJraWQiOiJXNldjT0tC..."
                  },
                  code: {
                    type: "string",
                    description: "Authorization code from Apple (optional)",
                    example: "c1234567890abcdef..."
                  },
                  user: {
                    type: "object",
                    description: "User data from Apple (only sent on first sign-in)",
                    properties: {
                      name: {
                        type: "object",
                        properties: {
                          firstName: { type: "string", example: "John" },
                          lastName: { type: "string", example: "Doe" }
                        }
                      },
                      email: { type: "string", format: "email", example: "user@example.com" }
                    }
                  }
                },
                required: ["id_token"]
              }
            }
          }
        }
      }
    },
    responses: {
      "200": {
        description: "User registered successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                newUser: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description: "User's unique ID"
                    },
                    createdAt: {
                      type: "string",
                      format: "date-time",
                      description: "Account creation timestamp"
                    },
                    sessionToken: {
                      type: "string",
                      description: "Parse session token for authenticated requests"
                    },
                    username: {
                      type: "string",
                      description: "User's username"
                    },
                    email: {
                      type: "string",
                      description: "User's email address"
                    }
                  }
                }
              }
            }
          }
        }
      },
      "400": {
        description: "Missing required fields or validation error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 400 },
                statusMessage: { type: "string", example: "Username, password, and email are required" },
                errorCode: { type: "string", example: "INVALID_TOKEN_FORMAT" }
              }
            }
          }
        }
      },
      "401": {
        description: "Apple authentication failed - invalid or expired token",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 401 },
                statusMessage: { type: "string", example: "Token has expired" },
                errorCode: { type: "string", example: "TOKEN_EXPIRED" }
              }
            }
          }
        }
      },
      "409": {
        description: "Account already exists",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 409 },
                statusMessage: { type: "string", example: "An account already exists for this email address. Please try signing in with email/password instead." },
                errorCode: { type: "string", example: "ACCOUNT_ALREADY_EXISTS" }
              }
            }
          }
        }
      },
      "500": {
        description: "Server error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 500 },
                statusMessage: { type: "string", example: "User registration failed" },
                errorCode: { type: "string", example: "USER_CREATION_FAILED" }
              }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const body: Partial<SignUpRequestBody> = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody

    let newUser: Parse.User
    let sessionToken: string | undefined
    // Undefined for the standard signup path, which is always a new user.
    let isNewUser: boolean | undefined

    // Handle Apple Sign In
    if (body.appleAuth) {
      console.log('[signupUser] Processing Apple authentication')

      try {
        const apple = await handleAppleAuth(body.appleAuth)
        newUser = apple.user
        sessionToken = apple.sessionToken
        isNewUser = apple.isNewUser
        // Kept so account deletion can revoke it. Not awaited: it's a round
        // trip to Apple that never fails the sign-in. The token was verified
        // above, so its `aud` — the client the code belongs to — is trusted.
        void storeAppleRefreshToken(newUser, body.appleAuth.code, String(decodeJwt(body.appleAuth.id_token).aud))
        console.log('[signupUser] Apple auth successful for user:', newUser.id)
      } catch (error: any) {
        console.error('[signupUser] Apple auth failed:', error)

        // Handle AppleAuthError with detailed error information
        if (error instanceof AppleAuthError) {
          throw createError({
            statusCode: error.statusCode,
            statusMessage: error.message,
            data: {
              errorCode: error.code
            }
          })
        }

        // Handle other errors
        throw createError({
          statusCode: 500,
          statusMessage: error.message ?? 'Apple authentication failed',
          data: {
            errorCode: 'APPLE_AUTH_FAILED'
          }
        })
      }
    }
    // Handle standard email/password signup
    else {
      const { username, password, email } = body

      if (!username || !password || !email) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Username, password, and email are required'
        })
      }

      // Looked up rather than hard-coded — utils/plans.ts owns the free plan's id.
      // Null when there is no billing: such installs have no plans at all.
      const currentPlan = await getFreePlanPointer()
      newUser = await Parse.User.signUp(email, password, {
        email,
        username,
        ...(currentPlan ? { currentPlan } : {})
      }, { useMasterKey: true })

      sessionToken = newUser.getSessionToken()

      console.log("[signupUser] Signing up newUser: ", newUser.id)
    }

    // Check if we should run the new user flow
    // For Apple Auth, we skip if the user already exists (isNewUser === false)
    // For standard signup, it's always a new user so isNewUser is undefined
    const shouldRunNewUserFlow = isNewUser !== false

    console.log('[signupUser] User ID:', newUser.id)
    console.log('[signupUser] isNewUser flag:', isNewUser)
    console.log('[signupUser] shouldRunNewUserFlow:', shouldRunNewUserFlow)

    if (shouldRunNewUserFlow) {
      // Trigger new user flow asynchronously (don't await)
      $fetch(`${selfUrl()}newUserFlow`, {
        method: 'post',
        headers: { 'Authorization': AUTH_HEADER },
        body: { userId: newUser.id }
      }).catch((error) => {
        console.error('[signupUser] Failed to trigger newUserFlow:', error)
      })
    } else {
      console.log('[signupUser] Skipping newUserFlow for existing user:', newUser.id)
    }

    const response: SignUpResponse = {
      success: true,
      newUser: {
        id: newUser.id,
        createdAt: newUser.createdAt?.toISOString() ?? new Date().toISOString(),
        sessionToken: sessionToken as string,
        username: newUser.get('username') as string | undefined,
        email: newUser.get('email') as string | undefined
      }
    }

    return response
  } catch (error: any) {
    console.error("error signupUser:", error)

    if (error.statusCode) throw error

    throw createError({
      statusCode: 500,
      statusMessage: error.message ?? 'User registration failed'
    })
  }
})
