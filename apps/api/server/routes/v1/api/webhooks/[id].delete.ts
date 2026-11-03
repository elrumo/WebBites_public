import { defineEventHandler, getRouterParam } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { deleteWebhook } from '#root/server/utils/webhooks'

defineRouteMeta({
  openAPI: { tags: ['Developer API'], summary: 'Delete a webhook', responses: { 200: { description: '`{ success: true }`' } } },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  await deleteWebhook(userId, String(getRouterParam(event, 'id')))
  return { success: true }
})
