import { defineEventHandler, getQuery, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireRaycastAuth } from '../../utils/raycast-auth.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

defineRouteMeta({
  openAPI: {
    tags: ["Raycast Bookmarks"],
    description: "Retrieve user's bookmarks with optional search and pagination",
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
      },
      {
        name: "limit",
        in: "query",
        description: "Number of bookmarks to return (max 100)",
        required: false,
        schema: {
          type: "integer",
          default: 50,
          minimum: 1,
          maximum: 100
        }
      },
      {
        name: "skip",
        in: "query",
        description: "Number of bookmarks to skip (for pagination)",
        required: false,
        schema: {
          type: "integer",
          default: 0,
          minimum: 0
        }
      },
      {
        name: "search",
        in: "query",
        description: "Search query to filter bookmarks by title",
        required: false,
        schema: {
          type: "string",
          example: "javascript"
        }
      }
    ],
    responses: {
      "200": {
        description: "Bookmarks retrieved successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                bookmarks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", description: "Bookmark ID" },
                      title: { type: "string", description: "Page title" },
                      url: { type: "string", description: "Bookmark URL" },
                      description: { type: "string", description: "Page description" },
                      favicon: { type: "string", description: "Favicon URL" },
                      createdAt: { type: "string", format: "date-time", description: "Creation date" },
                      tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Associated tags"
                      }
                    }
                  }
                },
                count: {
                  type: "integer",
                  description: "Number of bookmarks returned"
                },
                hasMore: {
                  type: "boolean",
                  description: "Whether there are more bookmarks available"
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
                statusMessage: { type: "string", example: "Failed to retrieve bookmarks" }
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
    const { limit = 50, skip = 0, search = '' } = getQuery(event)

    const user = raycastUser.user

    const savedSitesRelation = user.relation('savedSites')
    const query = savedSitesRelation.query()
    query.notEqualTo('isDeleted', true)

    if (search) {
      query.matches('title', search, 'i')
    }

    query.descending('createdAt')
    query.limit(parseInt(limit))
    query.skip(parseInt(skip))

    const bookmarks = await query.find({ useMasterKey: true })

    const results = bookmarks.map(bookmark => ({
      id: bookmark.id,
      title: bookmark.get('title') || 'Untitled',
      url: bookmark.get('url'),
      description: bookmark.get('description'),
      favicon: bookmark.get('favicon'),
      createdAt: bookmark.get('createdAt'),
      tags: bookmark.get('tags') || []
    }))

    return {
      success: true,
      bookmarks: results,
      count: results.length,
      hasMore: results.length === parseInt(limit)
    }

  } catch (error) {
    console.error('Raycast get bookmarks error:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to retrieve bookmarks'
    })
  }
})