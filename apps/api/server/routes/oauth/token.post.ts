import { defineEventHandler } from 'h3'
import { resolveResource, verifyPkceS256 } from '#root/server/utils/oauthRules'
import { createGrant, issueTokens, refreshTokens, takeCode } from '#root/server/utils/oauthStore'
import { authenticateClient, oauthError, oauthJson, readOAuthBody } from '#root/server/utils/oauthHttp'
import { mcpResource } from '#root/server/utils/mcpConfig'

/**
 * POST /oauth/token — trades an authorization code (with its PKCE verifier)
 * or a refresh token for an access token and a new refresh token. Codes are
 * single use; refresh tokens rotate on every use, and replaying a rotated one
 * after the grace window revokes the whole connection (see refreshDecision).
 */
defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'OAuth token endpoint',
    responses: { 200: { description: 'access_token, refresh_token, expires_in, scope' }, 400: { description: 'RFC 6749 error' }, 401: { description: 'invalid_client' } },
  },
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readOAuthBody(event)
    const auth = await authenticateClient(event, body)
    if (auth.ok === false) return oauthError(event, auth.status, auth.error, auth.description, auth.headers)
    const { client } = auth

    if (body.resource !== undefined && resolveResource(body.resource, mcpResource()) === null) {
      return oauthError(event, 400, 'invalid_target', `resource must be ${mcpResource()}`)
    }

    if (body.grant_type === 'authorization_code') {
      if (!body.code) return oauthError(event, 400, 'invalid_request', 'code is required')
      const code = await takeCode(body.code)
      if (!code || code.clientId !== client.clientId) {
        return oauthError(event, 400, 'invalid_grant', 'The authorization code is invalid, expired or already used')
      }
      if (body.redirect_uri !== undefined && body.redirect_uri !== code.redirectUri) {
        return oauthError(event, 400, 'invalid_grant', 'redirect_uri does not match the authorization request')
      }
      if (!verifyPkceS256(body.code_verifier, code.codeChallenge)) {
        return oauthError(event, 400, 'invalid_grant', 'code_verifier does not match the code_challenge')
      }
      const grant = await createGrant({
        userId: code.userId,
        clientId: code.clientId,
        clientName: code.clientName,
        registration: code.registration,
        scopes: code.scopes,
        resource: code.resource,
      })
      return oauthJson(event, 200, await issueTokens(grant))
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError(event, 400, 'invalid_request', 'refresh_token is required')
      const outcome = await refreshTokens(body.refresh_token, client.clientId)
      if (outcome.ok === false) {
        return oauthError(event, 400, 'invalid_grant', outcome.reason === 'replayed'
          ? 'This refresh token was already used; the connection has been revoked for safety. Sign in again.'
          : 'The refresh token is invalid, expired or revoked')
      }
      return oauthJson(event, 200, outcome.tokens)
    }

    return oauthError(event, 400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
  } catch (error) {
    console.error('[OAUTH:TOKEN]', error)
    return oauthError(event, 503, 'temporarily_unavailable', 'WebBites could not issue a token; try again shortly', { 'Retry-After': '10' })
  }
})
