import { defineEventHandler } from 'h3'
import { revokeToken } from '#root/server/utils/oauthStore'
import { authenticateClient, oauthError, oauthJson, readOAuthBody } from '#root/server/utils/oauthHttp'

/**
 * POST /oauth/revoke — RFC 7009. Revoking either token ends the whole
 * connection (it disappears from the user's connected assistants). Answers
 * 200 whether or not the token was valid, as the RFC requires.
 */
defineRouteMeta({
  openAPI: { tags: ['MCP'], summary: 'Revoke an OAuth token (RFC 7009)' },
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readOAuthBody(event)
    const auth = await authenticateClient(event, body)
    if (auth.ok === false) return oauthError(event, auth.status, auth.error, auth.description, auth.headers)
    if (body.token) await revokeToken(body.token, auth.client.clientId)
    return oauthJson(event, 200, {})
  } catch (error) {
    console.error('[OAUTH:REVOKE]', error)
    return oauthError(event, 503, 'temporarily_unavailable', 'Try again shortly', { 'Retry-After': '10' })
  }
})
