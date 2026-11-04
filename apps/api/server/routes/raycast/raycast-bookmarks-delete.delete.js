import { defineEventHandler, getRouterParam, createError } from 'h3'
import Parse from 'parse/node.js'
import { batchDeleteFromParse } from '#root/server/routes/batchDelete.post.js'
import { requireRaycastAuth } from '../../utils/raycast-auth.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

defineRouteMeta({
  openAPI: {
    tags: ["Raycast Bookmarks"],
    description: "Delete a specific bookmark by ID",
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
        name: "id",
        in: "path",
        description: "The ID of the bookmark to delete",
        required: true,
        schema: {
          type: "string",
          example: "abc123def456"
        }
      }
    ],
    responses: {
      "200": {
        description: "Bookmark deleted successfully",
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
                  example: "Bookmark deleted successfully"
                },
                deletedId: {
                  type: "string",
                  description: "ID of the deleted bookmark"
                }
              }
            }
          }
        }
      },
      "400": {
        description: "Missing bookmark ID",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 400 },
                statusMessage: { type: "string", example: "Bookmark ID is required" }
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
      "404": {
        description: "Bookmark not found",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 404 },
                statusMessage: { type: "string", example: "Bookmark not found" }
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
                statusMessage: { type: "string", example: "Failed to delete bookmark" }
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
    const bookmarkId = getRouterParam(event, 'id')

    if (!bookmarkId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bookmark ID is required'
      })
    }

    const user = raycastUser.user

    const bookmarkQuery = new Parse.Query('websites')
    bookmarkQuery.equalTo('objectId', bookmarkId)
    bookmarkQuery.equalTo('user', user)
    bookmarkQuery.notEqualTo('isDeleted', true)
    
    const bookmark = await bookmarkQuery.first({ useMasterKey: true })

    if (!bookmark) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Bookmark not found'
      })
    }

    // Soft delete, same as the web client: the row is restorable from the trash
    // for 30 days. The savedSites relation is left intact — the list queries
    // filter on isDeleted — so a restore doesn't have to rebuild it.
    await batchDeleteFromParse([bookmark.id], undefined, user.id)

    return {
      success: true,
      message: 'Bookmark deleted successfully',
      deletedId: bookmarkId
    }

  } catch (error) {
    console.error('Raycast delete bookmark error:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete bookmark'
    })
  }
})