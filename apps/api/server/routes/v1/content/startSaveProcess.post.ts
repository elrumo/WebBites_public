import { defineEventHandler, readBody, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireRaycastAuth } from '../../../utils/raycast-auth.js'
import { sendToQstash, getPartitionedQueue } from '../../../utils/serverUtils.js'

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string

defineRouteMeta({
  openAPI: {
    tags: ["Raycast Bookmarks"],
    description: "Save a new bookmark or text note for the authenticated user",
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
    requestBody: {
      description: "Bookmark or text note data to save",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                format: "uri", 
                description: "The URL to bookmark (required for bookmarks, optional for text notes)",
                example: "https://example.com/article"
              },
              title: {
                type: "string",
                description: "Optional title for the bookmark",
                example: "Awesome Article Title"
              },
              description: {
                type: "string",
                description: "Optional description for the bookmark",
                example: "This is a great article about..."
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Optional tags for the bookmark",
                example: ["javascript", "tutorial", "web-development"]
              },
              siteNotes: {
                type: "string",
                description: "Optional notes about the bookmark",
                example: "Important article for later reference"
              },
              customId: {
                type: "string",
                description: "Optional custom identifier for the bookmark",
                example: "raycast-bookmark-123"
              },
              textNote: {
                type: "string",
                description: "Text note content (when provided without URL, creates a standalone text note)",
                example: "This article has great insights on React performance"
              }
            },
            required: []
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Bookmark queued for processing successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                bookmark: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "Bookmark ID" },
                    url: { type: "string", description: "Bookmark URL" },
                    title: { type: "string", description: "Bookmark title" },
                    description: { type: "string", description: "Bookmark description" },
                    tags: {
                      type: "array",
                      items: { type: "string" },
                      description: "Bookmark tags"
                    },
                    createdAt: { type: "string", format: "date-time", description: "Creation date" },
                    status: { type: "string", description: "Processing status", example: "queued" }
                  }
                },
                message: {
                  type: "string",
                  example: "Bookmark queued for processing"
                },
                queueId: {
                  type: "string", 
                  description: "QStash message ID for tracking",
                  example: "msg_123abc456def"
                }
              }
            }
          }
        }
      },
      "400": {
        description: "Missing required fields",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 400 },
                statusMessage: { type: "string", example: "URL is required" }
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
                statusMessage: { type: "string", example: "Failed to queue bookmark for processing" }
              }
            }
          }
        }
      }
    }
  }
});

interface StartSaveBody {
  url?: string
  title?: string
  description?: string
  tags?: string[]
  siteNotes?: string
  customId?: string
  textNote?: string
}

export default defineEventHandler(async (event) => {
  try {
    const raycastUser = await requireRaycastAuth(event)
    const body = (await readBody(event)) as StartSaveBody
    const {
      url,
      title,
      description,
      tags = [],
      siteNotes,
      customId,
      textNote
    } = body

    // Check if this is a text note (no URL) or a bookmark (requires URL)
    const isTextNote = textNote && !url
    
    if (!isTextNote && !url) {
      throw createError({
        statusCode: 400,
        statusMessage: 'URL is required for bookmarks'
      })
    }

    const user = raycastUser.user

    // Handle text notes differently from bookmarks
    if (isTextNote) {
      try {
        const result = await Parse.Cloud.run('saveNote', {
          userId: raycastUser.userId,
          textNote: textNote
        }, { useMasterKey: true })

        return {
          success: true,
          note: {
            id: result.id || result.objectId,
            textNote: textNote,
            title: title || 'Text Note',
            tags: tags || [],
            createdAt: new Date().toISOString(),
            type: 'textNote'
          },
          message: 'Text note saved successfully'
        }
      } catch (error) {
        console.error('Error saving text note:', error)
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to save text note'
        })
      }
    }

    // Handle bookmarks (existing logic)
    // Check if bookmark already exists
    const checkQuery = new Parse.Query('websites')
    checkQuery.equalTo('url', url)
    checkQuery.equalTo('user', user)
    checkQuery.notEqualTo('isDeleted', true)
    const existingBookmark = await checkQuery.first({ useMasterKey: true })

    if (existingBookmark) {
      return {
        success: true,
        bookmark: {
          id: existingBookmark.id,
          url: existingBookmark.get('url'),
          title: existingBookmark.get('title'),
          description: existingBookmark.get('description'),
          tags: existingBookmark.get('tags') || [],
          createdAt: existingBookmark.get('createdAt')
        },
        message: 'Bookmark already exists'
      }
    }

    // Send to QStash for processing
    const payload = {
      data: {
        url,
        siteTitle: title || "",
        userId: raycastUser.userId,
        type: "website",
        customId: customId || null,
        siteNotes: siteNotes || description || "",
        textNote: textNote || "",
        savedFrom: 'raycast-extension',
        tags: tags || [],
        savedAt: new Date().toISOString()
      },
      userId: raycastUser.userId,
      type: "website-save-requests"
    }

    const qstashResult = await sendToQstash(payload, { queueName: getPartitionedQueue('bookmark-processing') })

    console.log('Saved from raycast:', qstashResult)

    return {
      success: true,
      bookmark: {
        url,
        title: title || url,
        description: description || "",
        tags: tags || [],
        createdAt: new Date().toISOString(),
        status: 'queued'
      },
      message: 'Bookmark queued for processing',
      queueId: (qstashResult as any)?.messageId
    }

  } catch (error) {
    console.error('Raycast save bookmark error:', error)
    
    if ((error as any).statusCode) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to queue bookmark for processing'
    })
  }
})
