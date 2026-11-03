import { defineEventHandler, getQuery, sendRedirect, setResponseHeaders } from 'h3'
import {
  checkRedirectUri, isValidCodeChallenge, redirectUriMatches, redirectWith, requestedScopes, resolveResource,
} from '#root/server/utils/oauthRules'
import { resolveClient } from '#root/server/utils/oauthClientMetadata'
import { savePendingRequest } from '#root/server/utils/oauthStore'
import { mcpIssuer, mcpResource, websiteUrl } from '#root/server/utils/mcpConfig'

/**
 * GET /oauth/authorize — the start of the sign-in an MCP client sends the
 * browser to. Everything is validated here, before any page is shown; the
 * request is then parked in Redis and the browser goes to the consent page on
 * webbites.io (`app/pages/oauth/authorize.vue`), which reads it by id.
 *
 * Until the client and its redirect URI check out, errors go to our own error
 * page and never to the redirect URI: sending a browser to an unverified URI
 * is the open redirect OAuth forbids. After that, errors go back to the
 * client with `state` and `iss`.
 */
defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'OAuth authorization endpoint (authorization code + PKCE S256)',
    responses: { 302: { description: 'To the consent page on webbites.io, or back to the client with an error' } },
  },
})

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  const query = getQuery(event)
  const issuer = mcpIssuer()
  const consentPage = `${websiteUrl()}/oauth/authorize`
  const ownError = (error: string, description: string) =>
    sendRedirect(event, `${consentPage}?${new URLSearchParams({ error, error_description: description })}`, 302)

  let resolved
  try {
    resolved = await resolveClient(str(query.client_id))
  } catch {
    return ownError('temporarily_unavailable', 'WebBites could not start the sign-in. Try again in a moment.')
  }
  if (resolved.ok === false) return ownError('invalid_client', `This app could not be identified: ${resolved.reason}.`)
  const { client } = resolved

  const requestedRedirect = str(query.redirect_uri) ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined)
  if (!requestedRedirect || !redirectUriMatches(client.redirectUris, requestedRedirect)) {
    return ownError('invalid_redirect_uri', 'This app asked to return somewhere it did not register, so the sign-in was stopped.')
  }
  const redirect = checkRedirectUri(requestedRedirect)
  if (redirect.ok === false) return ownError('invalid_redirect_uri', redirect.reason)

  const state = str(query.state)
  const back = (error: string, description: string) =>
    sendRedirect(event, redirectWith(requestedRedirect, { error, error_description: description, state, iss: issuer }), 302)

  if (query.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported')
  if (query.code_challenge_method !== 'S256' || !isValidCodeChallenge(query.code_challenge)) {
    return back('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256')
  }
  const resource = resolveResource(query.resource, mcpResource())
  if (!resource) return back('invalid_target', `resource must be ${mcpResource()}`)

  try {
    const pending = await savePendingRequest({
      clientId: client.clientId,
      clientName: client.clientName,
      registration: client.registration,
      redirectUri: requestedRedirect,
      redirectKind: redirect.kind,
      redirectDisplay: redirect.display,
      state,
      codeChallenge: query.code_challenge as string,
      scopes: requestedScopes(query.scope),
      resource,
    })
    return sendRedirect(event, `${consentPage}?request=${encodeURIComponent(pending.id)}`, 302)
  } catch {
    return back('temporarily_unavailable', 'WebBites could not start the sign-in. Try again in a moment.')
  }
})
