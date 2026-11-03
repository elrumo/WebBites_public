import { defineEventHandler, readBody, createError } from 'h3'
import Parse from 'parse/node.js'
import { invalidateSession } from '../utils/sessionCache.js'

// Initialize Parse
Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

// Define OpenAPI metadata
defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Delete user session',
    description: 'Deletes a Parse session after verifying that the requesting user owns the session',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['sessionId', 'userId'],
            properties: {
              sessionId: {
                type: 'string',
                description: 'Parse session object ID to delete',
                example: 'abc123def456'
              },
              userId: {
                type: 'string',
                description: 'User ID making the request',
                example: 'user123'
              }
            }
          }
        }
      }
    },
    responses: {
      '200': {
        description: 'Session deleted successfully',
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
                  example: 'Session deleted successfully'
                }
              }
            }
          }
        }
      },
      '400': {
        description: 'Bad request - missing required parameters',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 400
                },
                statusMessage: {
                  type: 'string',
                  example: 'Missing sessionId or userId'
                }
              }
            }
          }
        }
      },
      '403': {
        description: 'Forbidden - user does not own this session',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 403
                },
                statusMessage: {
                  type: 'string',
                  example: 'User does not own this session'
                }
              }
            }
          }
        }
      },
      '404': {
        description: 'Session not found',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 404
                },
                statusMessage: {
                  type: 'string',
                  example: 'Session not found'
                }
              }
            }
          }
        }
      },
      '500': {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'number',
                  example: 500
                },
                statusMessage: {
                  type: 'string',
                  example: 'Failed to delete session'
                }
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
    // Handle OPTIONS request for CORS preflight
    if (event.node.req.method === 'OPTIONS') {
      event.node.res.setHeader('Access-Control-Allow-Origin', event.node.req.headers.origin || '*')
      event.node.res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
      event.node.res.setHeader('Access-Control-Allow-Headers', 
        'Content-Type, Authorization, Accept, X-Parse-Application-Id, X-Parse-Session-Token, X-Requested-With')
      event.node.res.setHeader('Access-Control-Allow-Credentials', 'true')
      event.node.res.setHeader('Access-Control-Max-Age', '86400')
      event.node.res.statusCode = 204
      event.node.res.end()
      return
    }
    
    // Get parameters from request body
    const body = await readBody(event)
    const { sessionId, userId } = body
    
    if (!sessionId || !userId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing sessionId or userId'
      })
    }
    
    try {
      // First, find the session by its object ID
      const sessionQuery = new Parse.Query(Parse.Session)
      const session = await sessionQuery.get(sessionId, { useMasterKey: true })
      
      if (!session) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Session not found'
        })
      }
      
      // Get the user pointer from the session
      const userPointer = session.get('user')
      
      // Verify that the requesting user owns this session
      if (userPointer.id !== userId) {
        throw createError({
          statusCode: 403,
          statusMessage: 'User does not own this session'
        })
      }
      
      // Get session token before destroying
      const sessionToken = session.get('sessionToken')

      // Delete the session
      await session.destroy({ useMasterKey: true })

      // Invalidate from cache
      if (sessionToken) {
        invalidateSession(sessionToken)
      }

      console.log(`Session ${sessionId} deleted successfully for user ${userId}`)
      
      // Add CORS headers
      event.node.res.setHeader('Access-Control-Allow-Origin', event.node.req.headers.origin || '*')
      event.node.res.setHeader('Access-Control-Allow-Credentials', 'true')
      
      return {
        success: true,
        message: 'Session deleted successfully'
      }
      
    } catch (error) {
      console.error('Session deletion error:', error)
      
      // If error is already a H3Error (from createError), re-throw it
      if (error.statusCode) {
        throw error
      }
      
      // Handle Parse errors
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Session not found'
        })
      }
      
      // Generic error for other cases
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to delete session'
      })
    }
    
  } catch (error) {
    console.error('Delete session endpoint error:', error)
    
    // If error is already a H3Error (from createError)
    if (error.statusCode) {
      throw error
    }
    
    // Otherwise create a generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete session'
    })
  }
})