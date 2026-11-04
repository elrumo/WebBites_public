import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { getGrant, revokeGrant } from '#root/server/utils/oauthStore'

/**
 * DELETE /v1/oauth/grants/:id — disconnect an assistant. Its tokens stop
 * working on the next request: every token check looks the grant up.
 */
defineRouteMeta({
  openAPI: { tags: ['MCP'], summary: 'Disconnect an assistant (revoke an OAuth grant)', responses: { 200: { description: '{ success: true }' }, 404: { description: 'No such grant' } } },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const grant = await getGrant(getRouterParam(event, 'id') || '')
  if (!grant || grant.userId !== userId) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  await revokeGrant(grant.id)
  return { success: true }
})
