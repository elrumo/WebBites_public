import Parse from 'parse/node.js'
import { createHash } from 'node:crypto'
import { captureException } from '#root/server/utils/sentry.js'
import { getRedisClient, ensureRedisConnected, isRedisAvailable } from './redis.ts'

// L1 Cache: In-memory session cache (per replica, fastest)
const sessionCache = new Map()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour in milliseconds
const MAX_CACHE_SIZE = 1000 // Prevent unbounded memory growth

// L2 Cache: Redis session cache (shared across replicas)
const REDIS_CACHE_TTL = 60 * 60 // 1 hour in seconds (Redis uses seconds)

// What a Parse session token looks like (`r:` and 32 hex characters). The
// pattern is looser than that on purpose, but it is a string and nothing else.
const SESSION_TOKEN_PATTERN = /^r:[A-Za-z0-9]{8,128}$/

/**
 * The Redis key for a session. A hash of the token, not the token: the key
 * names used to be the live session tokens themselves, so anything that could
 * list keys (a dump, a replica, MONITOR, a misdirected `KEYS session:*`) held
 * every signed-in user's session.
 */
function redisSessionKey(sessionToken) {
  return `session:v3:${createHash('sha256').update(sessionToken).digest('hex')}`
}

// Cleanup old cache entries periodically
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [token, data] of sessionCache.entries()) {
    if (now > data.expiresAt) {
      sessionCache.delete(token)
    }
  }
}, CACHE_TTL) // Run cleanup every CACHE_TTL milliseconds

// Prevent the interval from keeping the process alive
if (cleanupInterval.unref) {
  cleanupInterval.unref()
}

/**
 * Verify a session token and return the associated user
 * Uses 3-tier caching strategy:
 * 1. L1: In-memory cache (fastest, per-replica)
 * 2. L2: Redis cache (shared across replicas)
 * 3. L3: Parse Server database (slowest, source of truth)
 *
 * @param {string} sessionToken - The session token to verify
 * @returns {Promise<Object|null>} The Parse User object or null if invalid
 */
export async function verifySession(sessionToken) {
  // A token is a string of a known shape. Several routes hand this function a
  // value straight out of a JSON body, and Parse's `equalTo` takes an object
  // as a query constraint: `{"$regex": "^r:0"}` matched whichever session
  // began that way, under the master key, which made any such route a
  // yes/no oracle for reading other people's session tokens a character at a
  // time.
  if (typeof sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(sessionToken)) {
    return null
  }

  // L1: Check in-memory cache first (fastest)
  const cached = sessionCache.get(sessionToken)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.user
  }

  // L2: Check Redis cache (shared across replicas)
  try {
    if (isRedisAvailable()) {
      const redis = getRedisClient()
      await ensureRedisConnected()

      const redisKey = redisSessionKey(sessionToken)
      const cachedData = await redis.get(redisKey)

      if (cachedData) {
        // fromJSON decodes pointers/dates and marks nothing dirty. Rebuilding
        // with user.set() made every field dirty, so any save that referenced
        // the user (board.set('owner', user)) cascaded a write of `currentPlan`
        // as a plain Object and Parse rejected it with a schema mismatch.
        const user = Parse.Object.fromJSON({ ...JSON.parse(cachedData), className: '_User' })

        // Store in L1 cache for even faster subsequent access
        if (sessionCache.size >= MAX_CACHE_SIZE) {
          const firstKey = sessionCache.keys().next().value
          sessionCache.delete(firstKey)
        }
        sessionCache.set(sessionToken, {
          user: user,
          expiresAt: Date.now() + CACHE_TTL
        })

        return user
      }
    }
  } catch (redisError) {
    // Log Redis error but continue to Parse Server
    console.warn('[SessionCache] Redis lookup failed, falling back to Parse:', redisError.message)
  }

  // L3: Query Parse Server (source of truth)
  // Initialize Parse if needed
  if (!Parse.applicationId || !Parse.serverURL) {
    Parse.initialize(
      process.env.VITE_PARSE_ID,
      process.env.VITE_PARSE_JS_KEY,
      process.env.VITE_PARSE_MASTER_KEY
    )
    Parse.serverURL = process.env.VITE_PARSE_URL
  }

  try {
    const query = new Parse.Query('_Session')
    query.equalTo('sessionToken', sessionToken)
    query.include('user')
    const session = await query.first({ useMasterKey: true })

    if (!session) {
      return null
    }

    const user = session.get('user')
    if (!user) return null

    // Parse rejects an expired session but leaves the row in place, and this
    // lookup uses the master key, so without this check a token Parse itself
    // had stopped honouring kept working here indefinitely.
    const expiresAt = session.get('expiresAt')
    if (expiresAt instanceof Date && expiresAt.getTime() <= Date.now()) return null

    // Store in L1 cache (in-memory)
    if (sessionCache.size >= MAX_CACHE_SIZE) {
      const firstKey = sessionCache.keys().next().value
      sessionCache.delete(firstKey)
    }
    sessionCache.set(sessionToken, {
      user: user,
      expiresAt: Date.now() + CACHE_TTL
    })

    // Store in L2 cache (Redis) - fire and forget, don't block response
    try {
      if (isRedisAvailable()) {
        const redis = getRedisClient()
        await ensureRedisConnected()

        // Never cached past the session's own expiry.
        const secondsLeft = expiresAt instanceof Date
          ? Math.floor((expiresAt.getTime() - Date.now()) / 1000)
          : REDIS_CACHE_TTL
        const ttl = Math.max(1, Math.min(REDIS_CACHE_TTL, secondsLeft))
        await redis.setEx(redisSessionKey(sessionToken), ttl, JSON.stringify(user.toJSON()))
      }
    } catch (redisError) {
      // Don't fail the request if Redis caching fails
      console.warn('[SessionCache] Failed to cache in Redis:', redisError.message)
    }

    return user
  } catch (error) {
    console.error('Error validating session token:', error)
    captureException(error, {
      tags: {
        component: 'sessionCache',
        operation: 'verifySession'
      },
      contexts: {
        session: {
          hasToken: !!sessionToken,
          tokenPrefix: sessionToken ? sessionToken.substring(0, 10) + '...' : null
        }
      }
    })
    return null
  }
}

/**
 * Invalidate a specific session from both L1 and L2 caches
 * Useful when logging out a user
 * @param {string} sessionToken - The session token to invalidate
 */
export async function invalidateSession(sessionToken) {
  if (typeof sessionToken !== 'string' || !sessionToken) return

  // Remove from L1 cache (in-memory)
  sessionCache.delete(sessionToken)

  // Remove from L2 cache (Redis)
  try {
    if (isRedisAvailable()) {
      const redis = getRedisClient()
      await ensureRedisConnected()
      await redis.del(redisSessionKey(sessionToken))
    }
  } catch (error) {
    console.warn('[SessionCache] Failed to invalidate session in Redis:', error.message)
  }
}

/**
 * Clear all cached sessions from both L1 and L2 caches
 * Useful for debugging or emergency cache flush
 */
export async function clearAllSessions() {
  // Clear L1 cache (in-memory)
  sessionCache.clear()

  // Clear L2 cache (Redis) - remove all session keys
  try {
    if (isRedisAvailable()) {
      const redis = getRedisClient()
      await ensureRedisConnected()

      // Find all session keys and delete them
      const keys = await redis.keys('session:*')
      if (keys.length > 0) {
        await redis.del(keys)
      }
    }
  } catch (error) {
    console.warn('[SessionCache] Failed to clear all sessions from Redis:', error.message)
  }
}

/**
 * Get cache statistics for both L1 and L2 caches
 * @returns {Promise<Object>} Cache stats including size and TTL
 */
export async function getCacheStats() {
  const stats = {
    l1: {
      size: sessionCache.size,
      maxSize: MAX_CACHE_SIZE,
      ttl: CACHE_TTL,
      entries: sessionCache.size
    },
    l2: {
      available: false,
      entries: 0
    }
  }

  // Get Redis stats if available
  try {
    if (isRedisAvailable()) {
      const redis = getRedisClient()
      await ensureRedisConnected()

      const keys = await redis.keys('session:*')
      stats.l2.available = true
      stats.l2.entries = keys.length
      stats.l2.ttl = REDIS_CACHE_TTL
    }
  } catch (error) {
    console.warn('[SessionCache] Failed to get Redis stats:', error.message)
  }

  return stats
}
