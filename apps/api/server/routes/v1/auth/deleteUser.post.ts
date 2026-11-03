import { defineEventHandler, readBody, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireUserId } from '#root/server/utils/requireUser'

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string

interface DeleteUserRequestBody {
  userId: string
}

interface DeleteUserResponse {
  success: boolean
  message: string
}

defineRouteMeta({
  openAPI: {
    tags: ["Authentication"],
    description: "Delete the caller's own account (Bearer session token or API key). With the internal key, deletes the user named in the body instead.",
    requestBody: {
      description: "User ID to delete — read only with the internal key",
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              userId: {
                type: "string",
                description: "Parse User ID to delete",
                example: "abc123def456"
              }
            }
          }
        }
      }
    },
    responses: {
      "200": {
        description: "User deleted successfully",
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
                  example: "User account deleted successfully"
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
                statusMessage: { type: "string", example: "User ID is required" }
              }
            }
          }
        }
      },
      "404": {
        description: "User not found",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 404 },
                statusMessage: { type: "string", example: "User not found" }
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
                statusMessage: { type: "string", example: "Failed to delete user account" }
              }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  // The internal key names the user in the body. Anyone else deletes only
  // themselves, identified by their own session token or API key — the native
  // apps' in-app "Delete account" (App Store guideline 5.1.1(v)).
  const userId = validateInternalApiKey(event)
    ? (await readBody(event) as Partial<DeleteUserRequestBody>)?.userId
    : await requireUserId(event)

  try {
    if (!userId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'User ID is required'
      })
    }

    console.log('[deleteUser] Attempting to delete user:', userId)

    try {
      // Query for the user using master key
      const userQuery = new Parse.Query(Parse.User)
      const user = await userQuery.get(userId, { useMasterKey: true })

      if (!user) {
        throw createError({
          statusCode: 404,
          statusMessage: 'User not found'
        })
      }

      // Delete the user using master key
      await user.destroy({ useMasterKey: true })

      console.log('[deleteUser] Successfully deleted user:', userId)

      const response: DeleteUserResponse = {
        success: true,
        message: 'User account deleted successfully'
      }

      return response

    } catch (parseError: any) {
      console.error('[deleteUser] Parse error:', parseError)

      if (parseError.code === 101) {
        throw createError({
          statusCode: 404,
          statusMessage: 'User not found'
        })
      }

      throw parseError
    }

  } catch (error: any) {
    console.error('[deleteUser] Error:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: error.message ?? 'Failed to delete user account'
    })
  }
})
