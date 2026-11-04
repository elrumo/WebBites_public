import { defineEventHandler, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireRaycastAuth } from '../../utils/raycast-auth.js'
import { invalidateSession } from '../../utils/sessionCache.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

defineRouteMeta({
  openAPI: {
    tags: ["Raycast Authentication"],
    description: "Logout user from Raycast extension and invalidate session token",
    parameters: [
      {
        name: "authorization",
        in: "header",
        description: "Bearer token (Parse session token)",
        required: true,
        schema: {
          type: "string",
          example: "Bearer r:abc123def456..."
        }
      }
    ],
    responses: {
      "200": {
        description: "Logout successful",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                message: {
                  type: "string",
                  example: "Logged out successfully"
                }
              }
            }
          }
        }
      },
      "401": {
        description: "Invalid or expired token (but still returns success)",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                message: {
                  type: "string",
                  example: "Logged out successfully"
                }
              }
            }
          }
        }
      },
      "500": {
        description: "Server error during logout",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 500 },
                statusMessage: { type: "string", example: "Logout failed" }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event) => {
  try {
    const raycastUser = await requireRaycastAuth(event)
    
    // Invalidate Parse session by destroying it
    const sessionQuery = new Parse.Query(Parse.Session)
    sessionQuery.equalTo('sessionToken', raycastUser.sessionToken)
    const session = await sessionQuery.first({ useMasterKey: true })
    
    if (session) {
      await session.destroy({ useMasterKey: true })
      invalidateSession(raycastUser.sessionToken)
      console.log(`Session destroyed for user ${raycastUser.userId}`)
    }

    return {
      success: true,
      message: 'Logged out successfully'
    }
    
  } catch (error) {
    console.log('Raycast logout error:', error.message)
    
    // Even if token is invalid/expired, return success 
    // (user is effectively logged out already)
    if (error.statusCode === 401) {
      return { 
        success: true, 
        message: 'Logged out successfully' 
      }
    }
    
    // Only throw for unexpected server errors
    throw createError({
      statusCode: 500,
      statusMessage: 'Logout failed'
    })
  }
})