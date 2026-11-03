import { defineEventHandler, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireRaycastAuth } from '../utils/raycast-auth.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

defineRouteMeta({
  openAPI: {
    tags: ["Raycast User"],
    description: "Get authenticated user's profile information and statistics",
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
        description: "User information retrieved successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                user: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description: "User's unique ID"
                    },
                    username: {
                      type: "string",
                      description: "User's username"
                    },
                    email: {
                      type: "string",
                      description: "User's email address"
                    },
                    bookmarkCount: {
                      type: "integer",
                      description: "Total number of bookmarks saved"
                    },
                    usage: {
                      type: "object",
                      description: "User's usage statistics",
                      properties: {
                        currentMonth: {
                          type: "object",
                          properties: {
                            month: { type: "string", example: "8/2025" },
                            bookmarksTotal: { type: "integer", example: 150 },
                            bookmarksThisMonth: { type: "integer", example: 25 },
                            filesUploaded: { type: "integer", example: 5 },
                            audiosGenerated: { type: "integer", example: 3 }
                          }
                        },
                        pastMonths: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              month: { type: "string" },
                              bookmarksTotal: { type: "integer" },
                              bookmarksThisMonth: { type: "integer" },
                              filesUploaded: { type: "integer" },
                              audiosGenerated: { type: "integer" }
                            }
                          }
                        }
                      }
                    },
                    isPremium: {
                      type: "boolean",
                      description: "Whether the user has premium features"
                    },
                    createdAt: {
                      type: "string",
                      format: "date-time",
                      description: "Account creation date"
                    }
                  }
                }
              }
            }
          }
        }
      },
      "401": {
        description: "Authentication failed",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 401 },
                statusMessage: { type: "string", example: "Invalid or expired session token" }
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
                statusMessage: { type: "string", example: "Failed to retrieve user information" }
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

    const user = raycastUser.user

    const savedSitesRelation = user.relation('savedSites')
    const bookmarkCount = await savedSitesRelation.query().count({ useMasterKey: true })

    const usage = user.get('usage') || {}
    const userOptions = user.get('userOptions')

    return {
      success: true,
      user: {
        id: user.id,
        username: user.get('username'),
        email: user.get('email'),
        bookmarkCount,
        usage,
        isPremium: userOptions?.isPremium || false,
        createdAt: user.get('createdAt')
      }
    }

  } catch (error) {
    console.error('Raycast get user error:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to retrieve user information'
    })
  }
})