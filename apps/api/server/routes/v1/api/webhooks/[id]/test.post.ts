import { defineEventHandler, getRouterParam } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { getWebhook, deliver, serializeWebhook } from '#root/server/utils/webhooks'
import { siteUrl } from '#root/server/utils/site';

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'Send a test event to a webhook',
    description: 'Delivers a sample `bookmark.saved` payload and reports the status your endpoint answered with.',
    responses: { 200: { description: '`{ ok, status, webhook }`' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const row = await getWebhook(userId, String(getRouterParam(event, 'id')))
  const outcome = await deliver(row, 'bookmark.saved', {
    id: 'test',
    url: siteUrl(),
    title: 'WebBites — test delivery',
    description: 'This is a test event from the WebBites developer page.',
    type: 'website',
    tags: ['test'],
    createdAt: new Date().toISOString(),
    test: true,
  })
  return { ...outcome, webhook: serializeWebhook(row) }
})
