import { getRedisClient, ensureRedisConnected } from './redis'
import { randomBytes, timingSafeEqual } from 'crypto'
import { H3Event, getHeader } from 'h3'


// In-memory cache for API key validation
// Reduces Redis lookups from ~800ms (REST) or ~20-50ms (TCP) to <1ms
interface CachedApiKey {
  userId: string
  expiresAt: number
}

const apiKeyCache = new Map<string, CachedApiKey>()
// Revoking a key only clears the cache on the instance that handled the
// revoke, so this is how long a revoked key can keep working on the others.
// It used to be 5 hours under a comment saying 5 minutes.
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const isDev = process.env.NODE_ENV === 'development'

// Cleanup expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of apiKeyCache.entries()) {
    if (value.expiresAt < now) {
      apiKeyCache.delete(key)
    }
  }
}, 10 * 60 * 1000)

/**
 * Generate a secure random API key
 */
export function generateApiKey(): string {
  // Format: wb_live_xxxxxxxxxxxxxxxxxxxx (32 chars after prefix)
  const randomPart = randomBytes(24).toString('base64url')
  return `wb_live_${randomPart}`
}

/**
 * Create a new API key for a user
 */
export async function createApiKey(userId: string, name?: string): Promise<{ key: string, userId: string, name?: string }> {
  const redis = getRedisClient()
  await ensureRedisConnected()

  const apiKey = generateApiKey()

  // Store the API key with the user ID
  await redis.set(`api_key:${apiKey}`, userId)

  // Optionally store metadata about the key
  if (name) {
    await redis.hSet(`api_key_meta:${apiKey}`, {
      userId,
      name,
      createdAt: new Date().toISOString()
    })
  }

  // Add to user's list of API keys (for listing/management)
  await redis.sAdd(`user_api_keys:${userId}`, apiKey)

  // Pre-warm the cache so first use is instant
  apiKeyCache.set(apiKey, {
    userId,
    expiresAt: Date.now() + CACHE_TTL
  })

  return { key: apiKey, userId, name }
}

/**
 * Validate API key from H3 event headers
 */
export async function validateApiKeyFromEvent(event: H3Event): Promise<string | null> {
  const apiKey = await getApiKeyFromEvent(event)
  if (!apiKey) {
    return null
  }

  return validateApiKey(apiKey)
}

/**
 * Extract API key from event headers or cookie
 */ 
export async function getApiKeyFromEvent(event: H3Event): Promise<string | null> {
  const apiKey = getHeader(event, 'Authorization')?.replace('Bearer ', '')
  if (!apiKey) {
    return null
  }

  return apiKey
}

/**
 * Revoke/delete an API key
 */
export async function revokeApiKey(apiKey: string): Promise<boolean> {
  const redis = getRedisClient()
  await ensureRedisConnected()

  // Get userId before deleting
  const userId = await redis.get(`api_key:${apiKey}`)

  if (!userId) {
    return false
  }

  // Delete the key
  await redis.del(`api_key:${apiKey}`)
  await redis.del(`api_key_meta:${apiKey}`)

  // Remove from user's list
  await redis.sRem(`user_api_keys:${userId}`, apiKey)

  // Invalidate cache immediately
  invalidateApiKeyCache(apiKey)

  return true
}

/**
 * Revoke every key a user holds, and the index that lists them.
 *
 * For account deletion: the keys live in Redis rather than Parse, so nothing
 * that deletes the user's rows would ever reach them, and a key left behind
 * still authenticates as a user who no longer exists.
 */
export async function revokeAllApiKeys(userId: string): Promise<number> {
  const redis = getRedisClient()
  await ensureRedisConnected()

  const keys = await listUserApiKeys(userId)
  for (const { key } of keys) {
    await revokeApiKey(key)
  }

  await redis.del(`user_api_keys:${userId}`)
  return keys.length
}

/**
 * List all API keys for a user
 */
export async function listUserApiKeys(userId: string): Promise<Array<{ key: string, name?: string, createdAt?: string }>> {
  const redis = getRedisClient()
  await ensureRedisConnected()

  const apiKeys = await redis.sMembers(`user_api_keys:${userId}`)

  if (!apiKeys || (Array.isArray(apiKeys) && apiKeys.length === 0)) {
    return []
  }

  // Get metadata for each key
  const keysArray = Array.isArray(apiKeys) ? apiKeys : Array.from(apiKeys as Set<string | Buffer>)
  const normalizedKeys = keysArray.map(k => (typeof k === 'string' ? k : (k as Buffer).toString()))

  const keysWithMeta = await Promise.all(
    normalizedKeys.map(async (key) => {
      const meta = await redis.hGetAll(`api_key_meta:${key}`)
      const metaObj = meta instanceof Map
        ? Object.fromEntries(meta)
        : Array.isArray(meta)
          ? Object.fromEntries(meta as any)
          : (meta as Record<string, string>)
      return {
        key,
        name: metaObj?.name,
        createdAt: metaObj?.createdAt
      }
    })
  )

  return keysWithMeta.map(k => ({
    key: k.key,
    name: k.name as string | undefined,
    createdAt: k.createdAt as string | undefined
  }))
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

/**
 * Validate if an API key exists and return the associated userId
 * Uses in-memory cache to reduce Redis lookups
 */
export async function validateApiKey(apiKey: string): Promise<string | null> {
  // if (isDev) console.log('[validateApiKey] apiKey: ', apiKey)
  const startTime = performance.now()

  if (apiKey === process.env.CUSTOM_API_KEY) {
    return 'custom'
  }
  // MCP OAuth tokens (`wbo_…`) are issued for /mcp alone and never work as an
  // API key, whatever Redis holds. Their own check is in utils/oauthStore.ts.
  if (apiKey.startsWith('wbo_')) return null
  // Check cache first
  const cached = apiKeyCache.get(apiKey)
  if (cached && cached.expiresAt > Date.now()) {
    if (isDev) console.log(`[API_KEYS] Cached Time: ${performance.now() - startTime}ms`)
    return cached.userId
  }


  // Cache miss - fetch from Redis
  const redis = getRedisClient()
  await ensureRedisConnected()

  const userId = await redis.get(`api_key:${apiKey}`)

  // Cache the result if valid
  if (userId) {
    apiKeyCache.set(apiKey, {
      userId: userId as string,
      expiresAt: Date.now() + CACHE_TTL
    })
  }
  
  if (isDev) console.log(`[API_KEYS] Cache miss - Time: ${performance.now() - startTime}ms`)

  return userId as string | null
}

/**
 * Invalidate cache for a specific API key
 */
export function invalidateApiKeyCache(apiKey: string): void {
  apiKeyCache.delete(apiKey)
}

/**
 * Clean up old API keys when user reaches the limit
 * Deletes the oldest keys to make room for new ones
 */
export async function cleanupOldApiKeys(userId: string, maxKeys: number): Promise<number> {
  const keys = await listUserApiKeys(userId)

  if (keys.length < maxKeys) {
    return 0 // No cleanup needed
  }

  // Sort by creation date (oldest first)
  const sortedKeys = keys.sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime()
    const dateB = new Date(b.createdAt || 0).getTime()
    return dateA - dateB
  })

  // Calculate how many keys to delete (keep room for 1 new key)
  const keysToDelete = keys.length - maxKeys + 1

  if (keysToDelete <= 0) {
    return 0
  }

  // Delete oldest keys
  const keysToRemove = sortedKeys.slice(0, keysToDelete)

  for (const keyInfo of keysToRemove) {
    await revokeApiKey(keyInfo.key)
  }

  return keysToRemove.length
}
