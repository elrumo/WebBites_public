import { requireUserId } from '../../../utils/requireUser'
import { createApiKey, listUserApiKeys, cleanupOldApiKeys } from '../../../utils/api-keys'

defineRouteMeta({
  openAPI: {
    tags: ['API Keys'],
    summary: 'Create a new API key',
    description: 'Generates a new API key for the authenticated user. If the user has 10 or more keys, the oldest keys are automatically deleted to make room for the new one.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Optional name to identify this API key',
                example: 'Chrome Extension'
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'API key created successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  example: 'wb_live_xxxxxxxxxxxxxxxxxxxx'
                },
                userId: {
                  type: 'string',
                  example: 'user123'
                },
                name: {
                  type: 'string',
                  example: 'Chrome Extension'
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
  // Session token or API key, so the app and the site can both manage keys.
  const userId = await requireUserId(event)

  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'User ID not found in request context'
    })
  }

  const body = await readBody(event)
  const name = body?.name

  // Check existing API keys before creating a new one
  let existingKeys = await listUserApiKeys(userId)

  // Enforce maximum keys limit with automatic cleanup
  const MAX_KEYS_PER_USER = 10
  if (existingKeys.length >= MAX_KEYS_PER_USER) {
    // Automatically delete oldest keys to make room for new one
    await cleanupOldApiKeys(userId, MAX_KEYS_PER_USER)

    // Refresh the keys list after cleanup
    existingKeys = await listUserApiKeys(userId)
  }

  const apiKey = await createApiKey(userId, name)

  return {
    key: apiKey.key,
    userId: apiKey.userId,
    name: apiKey.name
  }
})
