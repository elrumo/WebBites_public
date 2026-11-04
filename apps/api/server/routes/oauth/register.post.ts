import { defineEventHandler, getRequestIP, readRawBody } from 'h3'
import { TOKEN_PREFIX, hashOAuthToken, randomToken, validateRegistration, type ClientRecord } from '#root/server/utils/oauthRules'
import { allowRegistration, saveClient } from '#root/server/utils/oauthStore'
import { oauthError, oauthJson } from '#root/server/utils/oauthHttp'
import { resolveClientIp } from '#root/server/utils/rateLimitTarget'

/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591). Deprecated in
 * MCP in favour of Client ID Metadata Documents, which we also accept, but
 * still how most MCP clients introduce themselves. Anyone may register; what
 * a registration buys is a client_id the consent page labels "unverified".
 */
defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'Register an OAuth client (RFC 7591)',
    responses: { 201: { description: 'The registered client' }, 400: { description: 'invalid_redirect_uri / invalid_client_metadata' }, 429: { description: 'Too many registrations from this address' } },
  },
})

export default defineEventHandler(async (event) => {
  const ip = resolveClientIp(event.node.req.headers, getRequestIP(event))
  if (!(await allowRegistration(ip))) {
    return oauthError(event, 429, 'too_many_requests', 'Too many client registrations from this address; try again later', { 'Retry-After': '3600' })
  }

  let body: unknown
  try {
    body = JSON.parse((await readRawBody(event, 'utf8')) || '')
  } catch {
    return oauthError(event, 400, 'invalid_client_metadata', 'The registration request must be JSON')
  }

  const checked = validateRegistration(body)
  if (checked.ok === false) return oauthError(event, 400, checked.error, checked.description)

  const secret = checked.client.tokenEndpointAuthMethod === 'none' ? null : randomToken(TOKEN_PREFIX.secret)
  const client: ClientRecord = {
    ...checked.client,
    clientId: randomToken(TOKEN_PREFIX.client, 16),
    createdAt: new Date().toISOString(),
    ...(secret ? { secretHash: hashOAuthToken(secret) } : {}),
  }

  try {
    await saveClient(client)
  } catch {
    return oauthError(event, 503, 'temporarily_unavailable', 'Registration is unavailable; try again shortly', { 'Retry-After': '10' })
  }

  return oauthJson(event, 201, {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
  })
})
