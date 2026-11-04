import { createError, defineEventHandler, readBody } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { getPendingRequest, issueCode, takePendingRequest } from '#root/server/utils/oauthStore'
import { grantedScopes, oauthSecretsMatch, redirectWith } from '#root/server/utils/oauthRules'
import { mcpIssuer } from '#root/server/utils/mcpConfig'

/**
 * POST /v1/oauth/authorize/confirm — the signed-in user's answer on the
 * consent page, after the device-flow confirm route. Approving issues an
 * authorization code for the app; declining sends `access_denied`. Either
 * way the answer is a URL on the app's (already verified) redirect URI, which
 * the page navigates to, and the request is used up.
 *
 * `/v1/oauth` is a user route: the website proxies with the user's own
 * credential. An MCP access token can't get here — `/v1/*` doesn't take them.
 */
defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'Approve or decline a pending MCP sign-in',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['request', 'csrf'],
            properties: {
              request: { type: 'string' },
              csrf: { type: 'string', description: 'The nonce GET /v1/oauth/requests/:id returned' },
              approve: { type: 'boolean', description: 'Only `true` approves' },
              allowWrite: { type: 'boolean', description: 'Grant bookmarks:write when it was requested (default true)' },
            },
          },
        },
      },
    },
    responses: { 200: { description: '{ redirectTo }' }, 400: { description: 'INVALID_REQUEST / INVALID_CSRF' }, 410: { description: 'EXPIRED_REQUEST' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  if (typeof body.request !== 'string' || typeof body.csrf !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'INVALID_REQUEST' })
  }

  const pending = await getPendingRequest(body.request)
  if (!pending) throw createError({ statusCode: 410, statusMessage: 'EXPIRED_REQUEST' })
  if (!oauthSecretsMatch(body.csrf, pending.csrf)) throw createError({ statusCode: 400, statusMessage: 'INVALID_CSRF' })
  // Single use: whoever takes it first answers it.
  if (!(await takePendingRequest(pending.id))) throw createError({ statusCode: 410, statusMessage: 'EXPIRED_REQUEST' })

  const iss = mcpIssuer()
  if (body.approve !== true) {
    return {
      redirectTo: redirectWith(pending.redirectUri, {
        error: 'access_denied', error_description: 'The user declined the request', state: pending.state, iss,
      }),
    }
  }

  const code = await issueCode({
    userId,
    clientId: pending.clientId,
    clientName: pending.clientName,
    registration: pending.registration,
    scopes: grantedScopes(pending.scopes, body.allowWrite !== false),
    resource: pending.resource,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
  })
  return { redirectTo: redirectWith(pending.redirectUri, { code, state: pending.state, iss }) }
})
