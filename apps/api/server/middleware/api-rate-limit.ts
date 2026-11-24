import { defineEventHandler, setHeaders, createError, getRequestIP, getRequestURL } from 'h3'
import { getRedisClient, ensureRedisConnected } from '../utils/redis'
import { isRateLimitExempt, resolveClientIp, rateLimitCredential, rateLimitIdentifier, bearerToken } from '../utils/rateLimitTarget'
import { validateInternalApiKey } from '../utils/api-keys'

/**
 * Optimized Redis-based Rate Limiting Middleware
 *
 * Implements fixed-window rate limiting using Redis.
 * Limits are per API key (for authenticated requests) or per IP (for public endpoints).
 *
 * This is the coarse abuse backstop that applies to every route. The developer
 * API's real policy is the plan-sized per-key limit in `utils/publicApi.ts`, so
 * the default here sits above the highest tier's allowance rather than cutting
 * underneath it.
 */

const WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60
const LIMIT = Number(process.env.RATE_LIMIT_MAX) || 1200

const RATE_LIMIT_LUA = `
  local key = KEYS[1]
  local windowSeconds = tonumber(ARGV[1])

  local current = redis.call('INCR', key)
  if current == 1 then
    redis.call('EXPIRE', key, windowSeconds)
  end

  local ttl = redis.call('TTL', key)
  return { current, ttl }
`

export default defineEventHandler(async (event) => {
  try {
    // The docs UI, the OpenAPI document and the health check are never worth
    // throttling, and a 429 on them looks like the whole API is down.
    const pathname = getRequestURL(event).pathname
    if (isRateLimitExempt(pathname, event.method)) return

    // Our own services are not rate limited. Every one of them presents the
    // same internal key, so they all landed in a single bucket: the website's
    // server routes for every signed-in visitor, each queued job QStash
    // delivers, and each step of the save pipeline calling the next. An
    // import of a few hundred bookmarks spends that bucket on its own, and
    // from then on jobs and page loads were answered 429 until the window
    // rolled over. The key is checked here rather than read from
    // `event.context.internal`, because public routes (/qstash-webhook) pass
    // the auth gate before it looks at the key.
    if (validateInternalApiKey(event)) return

    const redis = getRedisClient()

    // Try to connect, but don't block if Redis is unavailable
    try {
      await ensureRedisConnected()
    } catch (redisError) {
      console.warn('[RATE-LIMIT] Redis unavailable, allowing request without rate limiting:', redisError.message)
      return // Allow request without rate limiting
    }

    // Use API key if authenticated, otherwise use the client's own address —
    // read from the proxy headers, because every production request reaches
    // this process through the load balancer.
    const credential = rateLimitCredential({
      verified: event.context.verifiedCredential,
      presented: bearerToken(event.node.req.headers.authorization),
      path: pathname,
    })
    const clientIp = resolveClientIp(event.node.req.headers, getRequestIP(event))
    const identifier = rateLimitIdentifier(credential, clientIp)

    const rateLimitKey = `rate_limit:${identifier}`
    const result = await redis.eval(RATE_LIMIT_LUA, {
      keys: [rateLimitKey],
      arguments: [String(WINDOW_SECONDS)],
    })

    const [requestCountRaw, ttlSecondsRaw] = Array.isArray(result) ? result : [result, WINDOW_SECONDS]
    const requestCount = Number(requestCountRaw)
    const ttlSeconds = Math.max(0, Number(ttlSecondsRaw))

    const remaining = Math.max(0, LIMIT - requestCount)
    const resetTime = Math.ceil(Date.now() / 1000 + ttlSeconds)

    // Set rate limit headers
    setHeaders(event, {
      'X-RateLimit-Limit': String(LIMIT),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetTime)
    })

    // Check if limit exceeded
    if (requestCount > LIMIT) {
      setHeaders(event, {
        'Retry-After': String(ttlSeconds || WINDOW_SECONDS)
      })

      throw createError({
        statusCode: 429,
        message: 'Rate limit exceeded. Please try again later.'
      })
    }
  } catch (error: any) {
    if (error?.statusCode === 429) {
      throw error
    }

    console.warn('[RATE-LIMIT] Error during rate limiting, allowing request:', error?.message)
    // Don't block requests if rate limiting fails
    // This ensures Redis issues don't break your API
  }
})
