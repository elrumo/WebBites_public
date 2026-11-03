import { requireUserId } from '../../../utils/requireUser'
import { listUserApiKeys } from '../../../utils/api-keys'

defineRouteMeta({
  openAPI: {
    tags: ['API Keys'],
    summary: 'List all API keys for the authenticated user',
    description: 'Returns a list of all API keys belonging to the authenticated user',
    responses: {
      200: {
        description: 'List of API keys',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                keys: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      key: {
                        type: 'string',
                        example: 'wb_live_xxxxxxxxxxxxxxxxxxxx'
                      },
                      name: {
                        type: 'string',
                        example: 'Chrome Extension'
                      },
                      createdAt: {
                        type: 'string',
                        format: 'date-time',
                        example: '2024-01-15T10:30:00Z'
                      }
                    }
                  }
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
  const userId = await requireUserId(event)

  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'User ID not found in request context'
    })
  }

  const keys = await listUserApiKeys(userId)

  return { keys }
})
