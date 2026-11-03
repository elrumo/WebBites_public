import { validateParseToken } from '#root/server/utils/raycast-auth.js'
import { defineEventHandler, getRequestURL, readBody, createError } from 'h3'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Validate Parse session token',
    description: 'Validates a Parse session token and returns user information. This endpoint verifies the token and retrieves associated user data.',
    parameters: [
      {
        in: 'header',
        name: 'Authorization',
        required: true,
        description: 'Bearer token containing the Parse session token',
        schema: { type: 'string' },
        example: 'Bearer r:abc123def456...'
      }
    ],
    responses: {
      200: {
        description: 'Session token validated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                userId: {
                  type: 'string',
                  example: 'user123',
                  description: 'User\'s unique ID'
                },
                username: {
                  type: 'string',
                  example: 'johndoe',
                  description: 'User\'s username'
                },
                email: {
                  type: 'string',
                  example: 'user@example.com',
                  description: 'User\'s email address'
                },
                sessionToken: {
                  type: 'string',
                  example: 'r:abc123def456...',
                  description: 'The validated Parse session token'
                },
                user: {
                  type: 'object',
                  description: 'Complete Parse User object'
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
                statusMessage: {
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

export default defineEventHandler(async (event) => {
    // Read request body
    // const body = await readBody(event)

    try {
        const parseUser = await validateParseToken(event)

        return parseUser
    } catch (error) {
        console.error("[validateParseToken.post] Error: ", error)
        return error
    }
})