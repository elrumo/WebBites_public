import { getRedisClient, ensureRedisConnected } from './redis'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { H3Event, getHeader } from 'h3'

/**
 * API keys (`wb_live_…`), stored as SHA-256 hashes.
 *
 * Keys used to be stored as they are: as Redis key names (`api_key:<key>`),
 * as members of the per-user index, and as usage field names, and
 * `GET /v1/keys/list` returned every one of them in full to any credential on
 * the account. Anyone who could read Redis, or any one key, held them all.
 *
 *   api_key_hash:<sha256>       → userId
 *   api_key_meta:h:<sha256>     → { userId, name, createdAt, display, kind }
 *   user_api_key_hashes:<user>  → set of <sha256>
 *
 * The full key exists only in the response that creates it. Lists show
 * `display` (`wb_live_AbCd…wxyz`), which revoke also accepts.
 *
 * Old plaintext entries (`api_key:<key>`, `api_key_meta:<key>`,
 * `user_api_keys:<user>`) still validate, and are moved to the hashed layout
 * the first time they are used or listed.
 *
 * `kind: 'session'` marks the keys the web app mints at sign-in. They expire
 * (SESSION_KEY_TTL_SECONDS) and are pruned among themselves, so signing in
 * often never pushes out a developer's own keys.
 */

interface CachedApiKey {
  userId: string
  expiresAt: number
}

export type ApiKeyKind = 'developer' | 'session' | 'device'

export interface ApiKeyInfo {
  /** The masked key, for display; revoke accepts it. */
  key: string
  /** The key's hash: a stable id. */
  id: string
  name?: string
  createdAt?: string
  kind?: ApiKeyKind
}

// In-memory cache, keyed by the key's hash. Revoking a key clears the entry
// only on the instance that handled the revoke, so this is how long a revoked
// key can keep working on the others.
const apiKeyCache = new Map<string, CachedApiKey>()
const CACHE_TTL = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 50_000

/** How long a key minted at web sign-in lasts (the cookie that holds it lasts as long). */
export const SESSION_KEY_TTL_SECONDS = 60 * 60 * 24 * 365
/** Sign-in keys kept per user; older ones are revoked when a new one is minted. */
export const MAX_SESSION_KEYS = 5

setInterval(() => {
  const now = Date.now()
  for (const [hash, value] of apiKeyCache.entries()) {
    if (value.expiresAt < now) apiKeyCache.delete(hash)
  }
}, 10 * 60 * 1000).unref?.()

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

/** `wb_live_AbCd…wxyz`: enough to recognise a key, not enough to use it. */
export function displayApiKey(apiKey: string): string {
  return apiKey.length > 20 ? `${apiKey.slice(0, 12)}…${apiKey.slice(-4)}` : '…'
}

const hashKeyName = (hash: string) => `api_key_hash:${hash}`
const metaKeyName = (hash: string) => `api_key_meta:h:${hash}`
const userSetName = (userId: string) => `user_api_key_hashes:${userId}`
const legacyKeyName = (apiKey: string) => `api_key:${apiKey}`
const legacyMetaName = (apiKey: string) => `api_key_meta:${apiKey}`
const legacyUserSetName = (userId: string) => `user_api_keys:${userId}`

function asRecord(value: unknown): Record<string, string> {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, string>
  if (Array.isArray(value)) return Object.fromEntries(value as any)
  return value as Record<string, string>
}

function asStrings(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value ? Array.from(value as Set<string | Buffer>) : []
  return items.map((item) => (typeof item === 'string' ? item : (item as Buffer).toString()))
}

function remember(hash: string, userId: string) {
  if (apiKeyCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = apiKeyCache.keys().next().value
    if (oldest !== undefined) apiKeyCache.delete(oldest)
  }
  apiKeyCache.set(hash, { userId, expiresAt: Date.now() + CACHE_TTL })
}

/** Generate a secure random API key: `wb_live_` and 32 characters. */
export function generateApiKey(): string {
  return `wb_live_${randomBytes(24).toString('base64url')}`
}

async function storeKey(
  userId: string,
  apiKey: string,
  meta: { name?: string; createdAt?: string; kind?: ApiKeyKind },
  ttlSeconds?: number
) {
  const redis = getRedisClient()
  await ensureRedisConnected()
  const hash = hashApiKey(apiKey)
  const fields: Record<string, string> = {
    userId,
    createdAt: meta.createdAt || new Date().toISOString(),
    display: displayApiKey(apiKey),
    kind: meta.kind || 'developer',
  }
  if (meta.name) fields.name = meta.name

  if (ttlSeconds) await redis.set(hashKeyName(hash), userId, { EX: ttlSeconds })
  else await redis.set(hashKeyName(hash), userId)
  await redis.hSet(metaKeyName(hash), fields)
  if (ttlSeconds) await redis.expire(metaKeyName(hash), ttlSeconds)
  await redis.sAdd(userSetName(userId), hash)
  return hash
}

/** Create a key. The full key is in the result and nowhere else, ever. */
export async function createApiKey(
  userId: string,
  name?: string,
  options: { kind?: ApiKeyKind; ttlSeconds?: number } = {}
): Promise<{ key: string; userId: string; name?: string }> {
  const apiKey = generateApiKey()
  const hash = await storeKey(userId, apiKey, { name, kind: options.kind }, options.ttlSeconds)
  remember(hash, userId)
  return { key: apiKey, userId, name }
}

/** Moves one plaintext key to the hashed layout. */
async function migrateLegacyKey(apiKey: string, userId: string) {
  const redis = getRedisClient()
  await ensureRedisConnected()
  const meta = asRecord(await redis.hGetAll(legacyMetaName(apiKey)).catch(() => null))
  await storeKey(userId, apiKey, { name: meta.name, createdAt: meta.createdAt })
  await redis.del(legacyKeyName(apiKey))
  await redis.del(legacyMetaName(apiKey))
  await redis.sRem(legacyUserSetName(userId), apiKey)
}

export async function validateApiKeyFromEvent(event: H3Event): Promise<string | null> {
  const apiKey = await getApiKeyFromEvent(event)
  if (!apiKey) return null
  return validateApiKey(apiKey)
}

export async function getApiKeyFromEvent(event: H3Event): Promise<string | null> {
  const apiKey = getHeader(event, 'Authorization')?.replace('Bearer ', '')
  return apiKey || null
}

/** Constant-time string compare that doesn't leak the length by throwing. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * True only for the internal key (CUSTOM_API_KEY), raw or as `Bearer <key>`.
 *
 * There used to be a second accepted credential here: a hardcoded `Basic ...`
 * literal kept "for legacy support". It was removed because it could not be
 * rotated — it shipped inside the browser extensions, and buildAudioStreamEndpoint
 * put the same username/password into every audio token, which any signed-in
 * user can base64-decode. Callers that used it (the website BFF routes, the
 * extensions) send `Bearer $CUSTOM_API_KEY` instead.
 */
export function validateInternalApiKey(event: H3Event): boolean {
  const authHeader = getHeader(event, 'Authorization')
  if (!authHeader) return false
  if (!process.env.CUSTOM_API_KEY) return false

  const apiKey = authHeader.replace('Bearer ', '')
  return secretsMatch(apiKey, process.env.CUSTOM_API_KEY)
}

/** The user an API key belongs to, or null. */
export async function validateApiKey(apiKey: string): Promise<string | null> {
  if (typeof apiKey !== 'string' || !apiKey) return null
  if (process.env.CUSTOM_API_KEY && secretsMatch(apiKey, process.env.CUSTOM_API_KEY)) return 'custom'
  // MCP OAuth tokens (`wbo_…`) are issued for /mcp alone and never work as an
  // API key, whatever Redis holds. Their own check is in utils/oauthStore.ts.
  if (apiKey.startsWith('wbo_')) return null

  const hash = hashApiKey(apiKey)
  const cached = apiKeyCache.get(hash)
  if (cached && cached.expiresAt > Date.now()) return cached.userId

  const redis = getRedisClient()
  await ensureRedisConnected()

  let userId = (await redis.get(hashKeyName(hash))) as string | null
  if (!userId) {
    userId = (await redis.get(legacyKeyName(apiKey))) as string | null
    if (userId) {
      await migrateLegacyKey(apiKey, userId).catch((error: any) =>
        console.warn('[api-keys] could not migrate a legacy key:', error?.message)
      )
    }
  }

  if (userId) remember(hash, userId)
  return userId
}

export function invalidateApiKeyCache(apiKey: string): void {
  apiKeyCache.delete(hashApiKey(apiKey))
}

async function revokeHash(userId: string, hash: string): Promise<boolean> {
  const redis = getRedisClient()
  await ensureRedisConnected()
  const owner = await redis.get(hashKeyName(hash))
  const removed = await redis.sRem(userSetName(userId), hash)
  if (owner && owner !== userId) return false
  await redis.del(hashKeyName(hash))
  await redis.del(metaKeyName(hash))
  apiKeyCache.delete(hash)
  return Boolean(owner) || Number(removed) > 0
}

/** Revoke a key, given the key itself. */
export async function revokeApiKey(apiKey: string): Promise<boolean> {
  const redis = getRedisClient()
  await ensureRedisConnected()
  const hash = hashApiKey(apiKey)
  let userId = (await redis.get(hashKeyName(hash))) as string | null
  if (!userId) {
    userId = (await redis.get(legacyKeyName(apiKey))) as string | null
    if (!userId) return false
    await migrateLegacyKey(apiKey, userId)
  }
  return revokeHash(userId, hash)
}

/**
 * Revoke one of `userId`'s keys, named by what a client has: the full key,
 * the masked form from the list, or its id. False when it isn't theirs.
 */
export async function revokeUserApiKey(userId: string, handle: string): Promise<boolean> {
  if (typeof handle !== 'string' || !handle) return false
  const keys = await listUserApiKeys(userId)
  const hashOfHandle = hashApiKey(handle)
  const match = keys.find((k) => k.id === hashOfHandle || k.id === handle || k.key === handle)
  return match ? revokeHash(userId, match.id) : false
}

/** Every key a user holds, masked. Moves any plaintext ones to the hashed layout first. */
export async function listUserApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const redis = getRedisClient()
  await ensureRedisConnected()

  for (const legacy of asStrings(await redis.sMembers(legacyUserSetName(userId)))) {
    const owner = await redis.get(legacyKeyName(legacy))
    if (owner === userId) await migrateLegacyKey(legacy, userId)
    else await redis.sRem(legacyUserSetName(userId), legacy)
  }

  const hashes = asStrings(await redis.sMembers(userSetName(userId)))
  const keys: ApiKeyInfo[] = []
  for (const hash of hashes) {
    const meta = asRecord(await redis.hGetAll(metaKeyName(hash)))
    if (!meta.userId) {
      // Expired (sign-in keys have a TTL) or half-written: drop it from the index.
      await redis.sRem(userSetName(userId), hash)
      continue
    }
    keys.push({
      key: meta.display || '…',
      id: hash,
      name: meta.name,
      createdAt: meta.createdAt,
      kind: (meta.kind as ApiKeyKind) || 'developer',
    })
  }
  return keys
}

/** Revoke every key a user holds (account deletion). */
export async function revokeAllApiKeys(userId: string): Promise<number> {
  const keys = await listUserApiKeys(userId)
  for (const { id } of keys) await revokeHash(userId, id)
  const redis = getRedisClient()
  await redis.del(userSetName(userId))
  await redis.del(legacyUserSetName(userId))
  return keys.length
}

const byAge = (a: ApiKeyInfo, b: ApiKeyInfo) =>
  new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()

/**
 * Make room for one more key: revoke the oldest until fewer than `maxKeys`
 * remain. Sign-in keys are not counted or touched, so a developer's own keys
 * are never pushed out by the web app signing in.
 */
export async function cleanupOldApiKeys(userId: string, maxKeys: number): Promise<number> {
  const keys = (await listUserApiKeys(userId)).filter((k) => k.kind !== 'session')
  const excess = keys.length - maxKeys + 1
  if (excess <= 0) return 0
  const doomed = keys.sort(byAge).slice(0, excess)
  for (const k of doomed) await revokeHash(userId, k.id)
  return doomed.length
}

/** Keep at most `keep - 1` sign-in keys, so the one about to be minted makes `keep`. */
export async function pruneSessionKeys(userId: string, keep = MAX_SESSION_KEYS): Promise<number> {
  const keys = (await listUserApiKeys(userId)).filter((k) => k.kind === 'session').sort(byAge)
  const excess = keys.length - keep + 1
  if (excess <= 0) return 0
  for (const k of keys.slice(0, excess)) await revokeHash(userId, k.id)
  return excess
}
