import { getRedisClient, ensureRedisConnected } from './redis'
import {
  ACCESS_TOKEN_TTL_SECONDS, AUTH_CODE_TTL_SECONDS, CLIENT_TTL_SECONDS, PENDING_REQUEST_TTL_SECONDS,
  REFRESH_GRACE_SECONDS, REFRESH_TOKEN_TTL_SECONDS, TOKEN_PREFIX,
  hashOAuthToken, randomToken, refreshDecision,
  type ClientRecord, type RefreshRecord,
} from './oauthRules'

/**
 * The OAuth authorization server's state, in Redis. The rules are in
 * `oauthRules.ts`; this is storage.
 *
 * | key                              | holds                                   | lifetime                    |
 * |----------------------------------|-----------------------------------------|-----------------------------|
 * | oauth_client:<client_id>         | a registered (DCR) client               | 30 days, renewed on use     |
 * | oauth_cimd:<sha256(url)>         | a fetched Client ID Metadata Document   | ≤ 24 h                      |
 * | oauth_req:<id>                   | an authorization request awaiting consent | 30 min                    |
 * | oauth_code:<sha256(code)>        | an authorization code                   | 60 s, single use (GETDEL)   |
 * | oauth_at:<sha256(token)>         | an access token                         | 1 h                         |
 * | oauth_rt:<sha256(token)>         | a refresh token                         | 90 days; 60 s once rotated  |
 * | oauth_grant:<id>                 | one approval: user, client, scopes      | until revoked               |
 * | oauth_grant_tokens:<id>          | the token keys a grant issued           | until revoked               |
 * | user_oauth_grants:<user_id>      | a user's grant ids                      | until revoked               |
 *
 * Tokens and codes are stored only as hashes. Every token check also checks
 * that its grant still exists, with nothing cached in memory, so revoking a
 * connection in Settings takes effect on the very next request, everywhere.
 */

async function redis() {
  const client = getRedisClient()
  await ensureRedisConnected()
  return client
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await (await redis()).get(key)
  if (!raw) return null
  try { return JSON.parse(String(raw)) as T } catch { return null }
}

async function setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const client = await redis()
  if (ttlSeconds) await client.set(key, JSON.stringify(value), { EX: ttlSeconds })
  else await client.set(key, JSON.stringify(value))
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export async function saveClient(client: ClientRecord): Promise<void> {
  await setJson(`oauth_client:${client.clientId}`, client, CLIENT_TTL_SECONDS)
}

/** A registered client, its lifetime renewed: only clients nobody uses expire. */
export async function getRegisteredClient(clientId: string): Promise<ClientRecord | null> {
  if (!clientId.startsWith(TOKEN_PREFIX.client)) return null
  const key = `oauth_client:${clientId}`
  const client = await getJson<ClientRecord>(key)
  if (client) await (await redis()).expire(key, CLIENT_TTL_SECONDS)
  return client
}

export async function getCachedClientMetadata(url: string): Promise<ClientRecord | null> {
  return getJson<ClientRecord>(`oauth_cimd:${hashOAuthToken(url)}`)
}

export async function cacheClientMetadata(client: ClientRecord, ttlSeconds: number): Promise<void> {
  await setJson(`oauth_cimd:${hashOAuthToken(client.clientId)}`, client, Math.max(60, Math.min(ttlSeconds, 24 * 3600)))
}

/** Generous, per address: claude.ai and chatgpt.com register from shared egress IPs. */
export async function allowRegistration(ip: string, limitPerHour = 300): Promise<boolean> {
  try {
    const client = await redis()
    const key = `oauth_register:${ip}`
    const count = Number(await client.incr(key))
    if (count === 1) await client.expire(key, 3600)
    return count <= limitPerHour
  } catch {
    return true
  }
}

// ─── Authorization requests ──────────────────────────────────────────────────

export interface PendingRequest {
  id: string
  clientId: string
  clientName: string
  registration: 'cimd' | 'dcr'
  redirectUri: string
  redirectKind: 'web' | 'loopback' | 'app'
  redirectDisplay: string
  state?: string
  codeChallenge: string
  scopes: string[]
  resource: string
  csrf: string
  expiresAt: string
}

export async function savePendingRequest(request: Omit<PendingRequest, 'id' | 'csrf' | 'expiresAt'>): Promise<PendingRequest> {
  const pending: PendingRequest = {
    ...request,
    id: randomToken(TOKEN_PREFIX.request, 24),
    csrf: randomToken('', 24),
    expiresAt: new Date(Date.now() + PENDING_REQUEST_TTL_SECONDS * 1000).toISOString(),
  }
  await setJson(`oauth_req:${pending.id}`, pending, PENDING_REQUEST_TTL_SECONDS)
  return pending
}

export async function getPendingRequest(id: string): Promise<PendingRequest | null> {
  if (!id.startsWith(TOKEN_PREFIX.request)) return null
  return getJson<PendingRequest>(`oauth_req:${id}`)
}

/** Single use: answering a request (either way) removes it. */
export async function takePendingRequest(id: string): Promise<PendingRequest | null> {
  if (!id.startsWith(TOKEN_PREFIX.request)) return null
  const raw = await (await redis()).getDel(`oauth_req:${id}`)
  if (!raw) return null
  try { return JSON.parse(String(raw)) as PendingRequest } catch { return null }
}

// ─── Authorization codes ─────────────────────────────────────────────────────

/**
 * Everything the approval decided, carried by the code. The grant itself is
 * only created when the code is exchanged, so a consent that never reaches
 * the token endpoint leaves no connection behind in Settings.
 */
export interface CodeRecord {
  userId: string
  clientId: string
  clientName: string
  registration: 'cimd' | 'dcr'
  scopes: string[]
  resource: string
  redirectUri: string
  codeChallenge: string
}

export async function issueCode(record: CodeRecord): Promise<string> {
  const code = randomToken(TOKEN_PREFIX.code)
  await setJson(`oauth_code:${hashOAuthToken(code)}`, record, AUTH_CODE_TTL_SECONDS)
  return code
}

/** Single use: a code that has been exchanged, or guessed at, is gone. */
export async function takeCode(code: string): Promise<CodeRecord | null> {
  if (!code.startsWith(TOKEN_PREFIX.code)) return null
  const raw = await (await redis()).getDel(`oauth_code:${hashOAuthToken(code)}`)
  if (!raw) return null
  try { return JSON.parse(String(raw)) as CodeRecord } catch { return null }
}

// ─── Grants ──────────────────────────────────────────────────────────────────

export interface GrantRecord {
  id: string
  userId: string
  clientId: string
  clientName: string
  registration: 'cimd' | 'dcr'
  scopes: string[]
  resource: string
  createdAt: string
  lastUsedAt: string | null
}

export async function createGrant(grant: Omit<GrantRecord, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<GrantRecord> {
  const record: GrantRecord = { ...grant, id: randomToken(TOKEN_PREFIX.grant, 16), createdAt: new Date().toISOString(), lastUsedAt: null }
  await setJson(`oauth_grant:${record.id}`, record)
  await (await redis()).sAdd(`user_oauth_grants:${record.userId}`, record.id)
  return record
}

export async function getGrant(id: string): Promise<GrantRecord | null> {
  return getJson<GrantRecord>(`oauth_grant:${id}`)
}

/** At most one write per grant every 5 minutes, however busy the connection. */
async function touchGrant(grant: GrantRecord): Promise<void> {
  const client = await redis()
  const fresh = await client.set(`oauth_grant_seen:${grant.id}`, '1', { EX: 300, NX: true })
  if (!fresh) return
  const current = await getGrant(grant.id)
  if (current) await setJson(`oauth_grant:${grant.id}`, { ...current, lastUsedAt: new Date().toISOString() })
}

/** Deletes a grant and every token it issued. True when there was one. */
export async function revokeGrant(id: string): Promise<boolean> {
  const client = await redis()
  const grant = await getGrant(id)
  const tokenKeys = (await client.sMembers(`oauth_grant_tokens:${id}`)) as unknown as string[]
  const keys = [...(Array.isArray(tokenKeys) ? tokenKeys : []), `oauth_grant_tokens:${id}`, `oauth_grant:${id}`, `oauth_grant_seen:${id}`]
  await client.del(keys)
  if (grant) await client.sRem(`user_oauth_grants:${grant.userId}`, id)
  return grant !== null
}

/** The user's connected assistants, newest first; ids whose grant is gone are tidied away. */
export async function listGrants(userId: string): Promise<GrantRecord[]> {
  const client = await redis()
  const ids = (await client.sMembers(`user_oauth_grants:${userId}`)) as unknown as string[]
  const grants: GrantRecord[] = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const grant = await getGrant(id)
    if (grant && grant.userId === userId) grants.push(grant)
    else await client.sRem(`user_oauth_grants:${userId}`, id)
  }
  return grants.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** For account deletion, next to revokeAllApiKeys. */
export async function revokeAllOAuthGrants(userId: string): Promise<number> {
  const client = await redis()
  const ids = (await client.sMembers(`user_oauth_grants:${userId}`)) as unknown as string[]
  for (const id of Array.isArray(ids) ? ids : []) await revokeGrant(id)
  await client.del(`user_oauth_grants:${userId}`)
  return Array.isArray(ids) ? ids.length : 0
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

export interface AccessRecord {
  grantId: string
  userId: string
  clientId: string
  scopes: string[]
  resource: string
}

export interface TokenSet {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

export async function issueTokens(grant: GrantRecord): Promise<TokenSet> {
  const client = await redis()
  const accessToken = randomToken(TOKEN_PREFIX.access)
  const refreshToken = randomToken(TOKEN_PREFIX.refresh)
  const accessKey = `oauth_at:${hashOAuthToken(accessToken)}`
  const refreshKey = `oauth_rt:${hashOAuthToken(refreshToken)}`

  const access: AccessRecord = { grantId: grant.id, userId: grant.userId, clientId: grant.clientId, scopes: grant.scopes, resource: grant.resource }
  const refresh: RefreshRecord = { grantId: grant.id, clientId: grant.clientId, status: 'active' }
  await setJson(accessKey, access, ACCESS_TOKEN_TTL_SECONDS)
  await setJson(refreshKey, refresh, REFRESH_TOKEN_TTL_SECONDS)
  await client.sAdd(`oauth_grant_tokens:${grant.id}`, [accessKey, refreshKey])

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: grant.scopes.join(' '),
  }
}

/**
 * The access token's record, if it is ours, current, and its grant hasn't been
 * revoked. Throws when Redis can't be reached, so the caller can answer 503
 * rather than send the client back through sign-in.
 */
export async function validateAccessToken(token: string): Promise<(AccessRecord & { grant: GrantRecord }) | null> {
  if (!token.startsWith(TOKEN_PREFIX.access)) return null
  const access = await getJson<AccessRecord>(`oauth_at:${hashOAuthToken(token)}`)
  if (!access) return null
  const grant = await getGrant(access.grantId)
  if (!grant) return null
  void touchGrant(grant).catch(() => {})
  return { ...access, grant }
}

export type RefreshOutcome =
  | { ok: true; tokens: TokenSet }
  | { ok: false; reason: 'invalid' | 'client_mismatch' | 'replayed' }

/** Swaps a refresh token for a new pair (see refreshDecision for retries and replays). */
export async function refreshTokens(refreshToken: string, clientId: string): Promise<RefreshOutcome> {
  if (!refreshToken.startsWith(TOKEN_PREFIX.refresh)) return { ok: false, reason: 'invalid' }
  const key = `oauth_rt:${hashOAuthToken(refreshToken)}`
  const record = await getJson<RefreshRecord>(key)
  if (!record) return { ok: false, reason: 'invalid' }
  if (record.clientId !== clientId) return { ok: false, reason: 'client_mismatch' }

  const decision = refreshDecision(record, Date.now())
  if (decision === 'revoke_grant') {
    await revokeGrant(record.grantId)
    return { ok: false, reason: 'replayed' }
  }
  const grant = await getGrant(record.grantId)
  if (!grant) return { ok: false, reason: 'invalid' }

  if (decision === 'rotate') {
    // Kept a minute (past the grace window) so a replay is recognised as one.
    await setJson(key, { ...record, status: 'rotated', rotatedAt: Date.now() }, REFRESH_GRACE_SECONDS * 2)
  }
  return { ok: true, tokens: await issueTokens(grant) }
}

/**
 * RFC 7009: revoking either token of a connection ends the connection — but
 * only for the client it was issued to; anyone else's request is a no-op
 * (and still answered 200, so it reveals nothing).
 */
export async function revokeToken(token: string, clientId: string): Promise<void> {
  const prefix = token.startsWith(TOKEN_PREFIX.access) ? 'oauth_at' : token.startsWith(TOKEN_PREFIX.refresh) ? 'oauth_rt' : null
  if (!prefix) return
  const record = await getJson<{ grantId: string; clientId: string }>(`${prefix}:${hashOAuthToken(token)}`)
  if (record?.grantId && record.clientId === clientId) await revokeGrant(record.grantId)
}
