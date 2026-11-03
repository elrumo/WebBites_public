defineRouteMeta({
  openAPI: {
    tags: ['Example'],
    summary: 'Example protected endpoint',
    description: 'This endpoint demonstrates API key authentication and rate limiting',
    responses: {
      200: {
        description: 'Success response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  example: 'Successfully authenticated!'
                },
                userId: {
                  type: 'string',
                  example: 'user123'
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
  // The middleware has already validated the API key
  // and attached user info to the context
  const userId = event.context.apiKey?.userId

  return {
    message: 'Successfully authenticated!',
    userId,
    timestamp: new Date().toISOString()
  }
})
