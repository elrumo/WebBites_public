import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { getPendingRequest } from '#root/server/utils/oauthStore'
import { getUserWithPlan } from '#root/server/utils/plans'
import { initParseForBoards } from '#root/server/utils/boardUtils'

/**
 * GET /v1/oauth/requests/:id — what the consent page on webbites.io shows:
 * which app is asking, where it will send the user back, what it wants, and
 * whose account would approve it. The `csrf` nonce must come back with the
 * answer (confirm.post.ts).
 */
defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'A pending MCP sign-in request, for the consent page',
    responses: { 200: { description: '{ request, account }' }, 401: { description: 'Not signed in' }, 410: { description: 'EXPIRED_REQUEST' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const pending = await getPendingRequest(getRouterParam(event, 'id') || '')
  if (!pending) throw createError({ statusCode: 410, statusMessage: 'EXPIRED_REQUEST' })

  initParseForBoards()
  const { user } = await getUserWithPlan(userId)

  return {
    request: {
      id: pending.id,
      client: {
        id: pending.clientId,
        name: pending.clientName,
        uri: pending.registration === 'cimd' ? pending.clientId : null,
        verified: pending.registration === 'cimd',
        registration: pending.registration,
      },
      redirect: { kind: pending.redirectKind, display: pending.redirectDisplay },
      scopes: pending.scopes,
      csrf: pending.csrf,
      expiresAt: pending.expiresAt,
    },
    account: { email: user.get('email') ?? null, username: user.get('username') ?? null },
  }
})
