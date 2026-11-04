import { defineEventHandler } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { listGrants } from '#root/server/utils/oauthStore'

/** GET /v1/oauth/grants — the assistants connected to the user's library over MCP. */
defineRouteMeta({
  openAPI: { tags: ['MCP'], summary: 'Connected assistants (OAuth grants)', responses: { 200: { description: '{ grants: [...] }' } } },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const grants = await listGrants(userId)
  return {
    grants: grants.map((grant) => ({
      id: grant.id,
      clientName: grant.clientName,
      clientId: grant.clientId,
      verified: grant.registration === 'cimd',
      scopes: grant.scopes,
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
    })),
  }
})
