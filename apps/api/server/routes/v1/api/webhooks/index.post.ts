import { defineEventHandler, readBody } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { createWebhook, serializeWebhook } from '#root/server/utils/webhooks'

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'Create a webhook',
    description: 'Returns the endpoint with its signing secret. Verify deliveries with `X-WebBites-Signature: sha256=<HMAC-SHA256(secret, raw body)>`.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', example: 'https://example.com/hooks/webbites' },
              events: { type: 'array', items: { type: 'string', enum: ['bookmark.saved'] } },
              description: { type: 'string' },
            },
          },
        },
      },
    },
    responses: { 200: { description: 'The webhook, including `secret`' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const row = await createWebhook(userId, (await readBody(event)) || {})
  return serializeWebhook(row, { withSecret: true })
})
