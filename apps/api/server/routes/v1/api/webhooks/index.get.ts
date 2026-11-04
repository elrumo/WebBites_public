import { defineEventHandler } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { listWebhooks, serializeWebhook, WEBHOOK_EVENTS } from '#root/server/utils/webhooks'

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'List your webhooks',
    responses: { 200: { description: '`{ webhooks, events }`' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const rows = await listWebhooks(userId)
  return { webhooks: rows.map((row) => serializeWebhook(row, { withSecret: true })), events: WEBHOOK_EVENTS }
})
