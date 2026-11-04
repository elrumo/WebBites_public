import { requireUserId } from '../../../utils/requireUser'
import { listUserApiKeys } from '../../../utils/api-keys'
defineRouteMeta({
  openAPI: {
    tags: ['API Keys'],
    summary: 'Revoke an API key',
    description: 'Permanently revokes an API key',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['key'],
            properties: {
              key: {
                type: 'string',
                description: 'The API key to revoke',
                example: 'wb_live_xxxxxxxxxxxxxxxxxxxx'
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'API key revoked successfully',
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
                  example: 'API key revoked successfully'
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

  const body = await readBody(event)
  const keyToRevoke = body?.key

  if (!keyToRevoke) {
    throw createError({
      statusCode: 400,
      message: 'API key is required'
    })
  }

  // Only the owner may revoke a key; otherwise any session could revoke any key.
  const owned = (await listUserApiKeys(userId)).some(k => k.key === keyToRevoke)
  const revoked = owned && await revokeApiKey(keyToRevoke)

  if (!revoked) {
    throw createError({
      statusCode: 404,
      message: 'API key not found'
    })
  }

  return {
    success: true,
    message: 'API key revoked successfully'
  }
})
