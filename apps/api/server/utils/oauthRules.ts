import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { SCOPE_READ, SCOPE_WRITE, ALL_SCOPES } from './mcpToolCatalogue'

/**
 * The rules of the WebBites OAuth 2.1 authorization server, the one MCP
 * clients (claude.ai, ChatGPT, Cursor…) sign in through. Pure — no Redis, no
 * h3 — so each rule is tested on its own (`npm run test:oauthRules`);
 * `oauthStore.ts` keeps the state and the `/oauth/*` routes speak HTTP.
 *
 * What it implements, per the MCP authorization spec: authorization code with
 * PKCE (S256 only), refresh tokens, RFC 8707 resource indicators, RFC 9207
 * `iss`, and two ways for a client to identify itself — Client ID Metadata
 * Documents (an HTTPS URL as client_id, the preferred way) and Dynamic Client
 * Registration (RFC 7591, deprecated in MCP but still what many clients do).
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
export const AUTH_CODE_TTL_SECONDS = 60
/** Long enough to sign up, or to go round Sign in with Apple, mid-consent. */
export const PENDING_REQUEST_TTL_SECONDS = 30 * 60
/** A rotated refresh token still works this long, so a retried refresh doesn't lose the grant. */
export const REFRESH_GRACE_SECONDS = 30
/** A registered client nobody has used for this long is forgotten. */
export const CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60

export const TOKEN_PREFIX = {
  access: 'wbo_at_',
  refresh: 'wbo_rt_',
  code: 'wbo_ac_',
  client: 'wbo_client_',
  secret: 'wbo_cs_',
  request: 'wbo_rq_',
  grant: 'wbo_gr_',
} as const

/** 256 bits of randomness behind a recognisable prefix. */
export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`
}

/** Tokens are only ever stored as this, so a Redis dump hands out nothing usable. */
export function hashOAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function oauthSecretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// ─── PKCE (RFC 7636) ─────────────────────────────────────────────────────────

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && CHALLENGE.test(challenge)
}

export function verifyPkceS256(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false
  const computed = createHash('sha256').update(verifier).digest('base64url')
  return oauthSecretsMatch(computed, challenge)
}

// ─── Scopes ──────────────────────────────────────────────────────────────────

/**
 * The scopes a request may be granted. Scopes we don't define (`openid`,
 * `offline_access`, a client's guesses) are dropped rather than refused: the
 * token response says what was granted. No scope at all means everything we
 * offer — the consent page still lets the user withhold write access — and
 * write implies read, since nothing can be changed that can't be found.
 */
export function requestedScopes(raw: unknown): string[] {
  const words = typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : []
  if (!words.length) return [...ALL_SCOPES]
  const known = new Set(words.filter((word) => (ALL_SCOPES as readonly string[]).includes(word)))
  if (known.has(SCOPE_WRITE)) known.add(SCOPE_READ)
  if (!known.size) known.add(SCOPE_READ)
  return ALL_SCOPES.filter((scope) => known.has(scope))
}

/** What the user approved: read always, write only if requested and allowed. */
export function grantedScopes(requested: string[], allowWrite: boolean): string[] {
  return allowWrite && requested.includes(SCOPE_WRITE) ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ]
}

// ─── Redirect URIs ───────────────────────────────────────────────────────────

export type RedirectKind = 'web' | 'loopback' | 'app'

/** Schemes that can't be a native app's callback, or that run code. */
const DENIED_SCHEMES = new Set([
  'javascript', 'data', 'file', 'vbscript', 'about', 'blob', 'ftp', 'ws', 'wss', 'mailto', 'tel', 'sms',
  'view-source', 'intent', 'filesystem', 'chrome', 'chrome-extension', 'moz-extension', 'resource',
])

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Whether a redirect URI is acceptable, and how to describe it on the consent
 * page. HTTPS anywhere; plain HTTP only on the loopback interface (a CLI or
 * desktop client listening on this computer, RFC 8252 §7.3); otherwise a
 * private-use scheme a native app registered (`cursor://…`, RFC 8252 §7.1).
 * Never a fragment, never userinfo.
 */
export function checkRedirectUri(uri: unknown): { ok: true; kind: RedirectKind; display: string } | { ok: false; reason: string } {
  if (typeof uri !== 'string' || !uri || uri.length > 2000) return { ok: false, reason: 'redirect_uri is missing or too long' }
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return { ok: false, reason: 'redirect_uri is not an absolute URI' }
  }
  if (uri.includes('#')) return { ok: false, reason: 'redirect_uri must not contain a fragment' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'redirect_uri must not contain credentials' }

  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (scheme === 'https') {
    if (!parsed.hostname) return { ok: false, reason: 'redirect_uri needs a host' }
    return { ok: true, kind: 'web', display: parsed.hostname }
  }
  if (scheme === 'http') {
    if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return { ok: false, reason: 'http redirect URIs are only allowed on localhost' }
    }
    return { ok: true, kind: 'loopback', display: 'an app on this computer' }
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme) || DENIED_SCHEMES.has(scheme)) {
    return { ok: false, reason: `redirect_uri scheme "${scheme}" is not allowed` }
  }
  return { ok: true, kind: 'app', display: scheme }
}

/**
 * Whether `requested` is one of a client's registered redirect URIs: exactly,
 * except that a loopback URI matches whatever port the client is listening on
 * this time (RFC 8252 §7.3).
 */
export function redirectUriMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  let wanted: URL
  try { wanted = new URL(requested) } catch { return false }
  if (wanted.protocol !== 'http:' || !LOOPBACK_HOSTS.has(wanted.hostname.toLowerCase())) return false
  return registered.some((uri) => {
    try {
      const known = new URL(uri)
      return known.protocol === 'http:'
        && known.hostname.toLowerCase() === wanted.hostname.toLowerCase()
        && known.pathname === wanted.pathname
        && known.search === wanted.search
    } catch {
      return false
    }
  })
}

// ─── Resource indicators (RFC 8707) ──────────────────────────────────────────

/** Lowercased scheme and host, no trailing slash, no fragment; null when unusable. */
export function normaliseResource(resource: unknown): string | null {
  if (typeof resource !== 'string' || !resource) return null
  try {
    const url = new URL(resource)
    if (url.hash) return null
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`
  } catch {
    return null
  }
}

/**
 * The resource a token will be for. Clients must send `resource`; we accept
 * the MCP endpoint (with or without a trailing slash) or its origin, and bind
 * every token to the endpoint. Absent → the endpoint, for older clients.
 */
export function resolveResource(resource: unknown, mcpResource: string): string | null {
  if (resource === undefined || resource === null || resource === '') return mcpResource
  const normalised = normaliseResource(resource)
  const endpoint = normaliseResource(mcpResource)!
  const origin = normaliseResource(new URL(mcpResource).origin)!
  return normalised === endpoint || normalised === origin ? mcpResource : null
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export type TokenAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic'
const AUTH_METHODS: TokenAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic']

export interface ClientRecord {
  clientId: string
  clientName: string
  redirectUris: string[]
  tokenEndpointAuthMethod: TokenAuthMethod
  /** sha256 of the client secret, for confidential DCR clients. */
  secretHash?: string
  /** 'cimd': the client_id is an HTTPS URL whose document we fetched. 'dcr': self-registered. */
  registration: 'cimd' | 'dcr'
  clientUri?: string | null
  createdAt: string
}

/** Printable, single-line, short: a client name ends up on the consent page. */
export function cleanClientName(raw: unknown): string {
  const name = typeof raw === 'string'
    // eslint-disable-next-line no-control-regex
    ? raw.replace(/[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
    : ''
  return name || 'Unnamed app'
}

function cleanHttpsUri(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function checkRedirectList(raw: unknown): { ok: true; uris: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: 'redirect_uris must be a non-empty array' }
  if (raw.length > 10) return { ok: false, reason: 'at most 10 redirect_uris' }
  for (const uri of raw) {
    const check = checkRedirectUri(uri)
    if (check.ok === false) return { ok: false, reason: check.reason }
  }
  return { ok: true, uris: [...new Set(raw as string[])] }
}

/**
 * A Dynamic Client Registration request (RFC 7591), validated. Clients that
 * don't say how they authenticate are registered as public (`none`): PKCE is
 * mandatory for everyone, so a secret adds little, and a client that never
 * asked for one would not send it.
 */
export function validateRegistration(body: unknown):
  | { ok: true; client: Omit<ClientRecord, 'clientId' | 'createdAt' | 'secretHash'> }
  | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'invalid_client_metadata', description: 'The registration request must be a JSON object' }
  }
  const metadata = body as Record<string, unknown>
  const redirects = checkRedirectList(metadata.redirect_uris)
  if (redirects.ok === false) return { ok: false, error: 'invalid_redirect_uri', description: redirects.reason }

  const method = (metadata.token_endpoint_auth_method ?? 'none') as TokenAuthMethod
  if (!AUTH_METHODS.includes(method)) {
    return { ok: false, error: 'invalid_client_metadata', description: `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(', ')}` }
  }
  const grantTypes = metadata.grant_types ?? ['authorization_code', 'refresh_token']
  if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')
    || grantTypes.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')) {
    return { ok: false, error: 'invalid_client_metadata', description: 'grant_types may only be authorization_code and refresh_token' }
  }
  const responseTypes = metadata.response_types ?? ['code']
  if (!Array.isArray(responseTypes) || responseTypes.some((type) => type !== 'code')) {
    return { ok: false, error: 'invalid_client_metadata', description: 'response_types may only be code' }
  }

  return {
    ok: true,
    client: {
      clientName: cleanClientName(metadata.client_name),
      redirectUris: redirects.uris,
      tokenEndpointAuthMethod: method,
      registration: 'dcr',
      clientUri: cleanHttpsUri(metadata.client_uri),
    },
  }
}

/** Whether a client_id is a Client ID Metadata Document URL: HTTPS, with a path. */
export function isClientMetadataUrl(clientId: unknown): clientId is string {
  if (typeof clientId !== 'string' || !clientId.startsWith('https://')) return false
  try {
    const url = new URL(clientId)
    return url.protocol === 'https:' && url.pathname.length > 1 && !url.hash && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * A fetched Client ID Metadata Document, validated: it must name itself (its
 * `client_id` is exactly the URL it came from), list valid redirect URIs, and
 * be a public client — we don't do private_key_jwt.
 */
export function validateClientMetadataDocument(doc: unknown, url: string):
  | { ok: true; client: Omit<ClientRecord, 'createdAt'> }
  | { ok: false; reason: string } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ok: false, reason: 'the client metadata is not a JSON object' }
  const metadata = doc as Record<string, unknown>
  if (metadata.client_id !== url) return { ok: false, reason: 'the client metadata does not name its own URL as client_id' }
  const redirects = checkRedirectList(metadata.redirect_uris)
  if (redirects.ok === false) return { ok: false, reason: redirects.reason }
  const method = metadata.token_endpoint_auth_method ?? 'none'
  if (method !== 'none') return { ok: false, reason: 'only public clients (token_endpoint_auth_method "none") are supported' }
  return {
    ok: true,
    client: {
      clientId: url,
      clientName: cleanClientName(metadata.client_name ?? new URL(url).hostname),
      redirectUris: redirects.uris,
      tokenEndpointAuthMethod: 'none',
      registration: 'cimd',
      clientUri: cleanHttpsUri(metadata.client_uri),
    },
  }
}

// ─── Metadata documents ──────────────────────────────────────────────────────

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(issuer: string, websiteUrl: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...ALL_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${websiteUrl}/developers/docs/mcp`,
  }
}

/** RFC 9728 protected resource metadata for `resource`. */
export function protectedResourceMetadata(resource: string, issuer: string, websiteUrl: string) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'WebBites',
    resource_documentation: `${websiteUrl}/developers/docs/mcp`,
  }
}

// ─── Refresh rotation ────────────────────────────────────────────────────────

export interface RefreshRecord {
  grantId: string
  clientId: string
  status: 'active' | 'rotated'
  rotatedAt?: number
}

/**
 * What presenting a refresh token means: an active one rotates; a rotated one
 * within the grace window is a retry of a refresh whose answer was lost, and
 * rotates again; a rotated one after that is a stolen token being replayed,
 * and the whole grant goes.
 */
export function refreshDecision(record: RefreshRecord, now: number): 'rotate' | 'retry' | 'revoke_grant' {
  if (record.status === 'active') return 'rotate'
  if (record.rotatedAt !== undefined && now - record.rotatedAt <= REFRESH_GRACE_SECONDS * 1000) return 'retry'
  return 'revoke_grant'
}

/** Appends OAuth response parameters to a redirect URI, keeping its own query. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}
