import { getHeader, readRawBody, setResponseHeaders, setResponseStatus, type H3Event } from 'h3'
import { hashOAuthToken, oauthSecretsMatch, type ClientRecord } from './oauthRules'
import { resolveClient } from './oauthClientMetadata'

/**
 * HTTP plumbing shared by the `/oauth/*` endpoints: RFC 6749 bodies and
 * headers (never Nitro's error envelope, which OAuth clients can't read),
 * form parsing, and client authentication at the token endpoint.
 */

export function oauthJson(event: H3Event, status: number, body: unknown, headers: Record<string, string> = {}) {
  setResponseStatus(event, status)
  setResponseHeaders(event, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache', ...headers })
  return JSON.stringify(body)
}

export function oauthError(event: H3Event, status: number, error: string, description: string, headers: Record<string, string> = {}) {
  return oauthJson(event, status, { error, error_description: description }, headers)
}

/** The request body as flat strings: form-encoded per RFC 6749, JSON tolerated. */
export async function readOAuthBody(event: H3Event): Promise<Record<string, string>> {
  const raw = (await readRawBody(event, 'utf8')) || ''
  const type = (getHeader(event, 'content-type') || '').toLowerCase()
  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      }
    } catch { /* fall through to an empty body */ }
    return {}
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

export type ClientAuth =
  | { ok: true; client: ClientRecord }
  | { ok: false; status: number; error: string; description: string; headers?: Record<string, string> }

/**
 * Identifies and authenticates the client at the token and revocation
 * endpoints: HTTP Basic or `client_secret` in the body for confidential
 * clients, the bare `client_id` for public ones.
 */
export async function authenticateClient(event: H3Event, body: Record<string, string>): Promise<ClientAuth> {
  let clientId = body.client_id
  let secret = body.client_secret
  let usedBasic = false

  const basic = (getHeader(event, 'authorization') || '').match(/^Basic\s+(.+)$/i)
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon < 0) return { ok: false, status: 401, error: 'invalid_client', description: 'Malformed Basic credentials', headers: { 'WWW-Authenticate': 'Basic realm="webbites"' } }
    clientId = decodeURIComponent(decoded.slice(0, colon))
    secret = decodeURIComponent(decoded.slice(colon + 1))
    usedBasic = true
  }

  const fail = (description: string): ClientAuth => ({
    ok: false,
    status: 401,
    error: 'invalid_client',
    description,
    headers: usedBasic ? { 'WWW-Authenticate': 'Basic realm="webbites"' } : undefined,
  })

  const resolved = await resolveClient(clientId)
  if (resolved.ok === false) return fail(resolved.reason)
  const { client } = resolved

  if (client.tokenEndpointAuthMethod !== 'none') {
    if (!secret || !client.secretHash || !oauthSecretsMatch(hashOAuthToken(secret), client.secretHash)) {
      return fail('Client authentication failed')
    }
  }
  return { ok: true, client }
}
