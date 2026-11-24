import { createError, getHeader, setResponseHeader, type H3Event } from 'h3'

/**
 * A per-IP fixed-window counter, in this process's memory.
 *
 * Deliberately simple: one Map per limiter, keyed by client IP, reset every
 * `windowMs`. It does not coordinate across instances, so with N replicas a
 * client gets up to N × `max` — good enough to stop one machine hammering the
 * auth routes or the paid search relays, not a quota system.
 */

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimiter {
  name: string
  max: number
  windowMs: number
  buckets: Map<string, Bucket>
}

// Bounded: past this many tracked IPs the expired windows are swept, and if
// that frees nothing the oldest entries go (a Map iterates in insertion order).
const MAX_TRACKED_IPS = 10_000

export function createRateLimiter(name: string, max: number, windowMs = 60_000): RateLimiter {
  return { name, max, windowMs, buckets: new Map() }
}

/**
 * The caller's IP: Cloudflare's `cf-connecting-ip`, then the first
 * `x-forwarded-for` entry (the client, as the first proxy saw it), then the
 * socket. Behind Cloudflare and the reverse proxy the socket address is the
 * proxy's, which would put every visitor in one bucket.
 */
export function getClientIp(event: H3Event): string {
  const cf = getHeader(event, 'cf-connecting-ip')?.trim()
  if (cf) return cf.slice(0, 64)

  const forwarded = getHeader(event, 'x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  if (first) return first.slice(0, 64)

  return event.node?.req?.socket?.remoteAddress || 'unknown'
}

function sweep(limiter: RateLimiter, now: number) {
  for (const [ip, bucket] of limiter.buckets) {
    if (bucket.resetAt <= now) limiter.buckets.delete(ip)
  }
  while (limiter.buckets.size >= MAX_TRACKED_IPS) {
    const oldest = limiter.buckets.keys().next().value
    if (oldest === undefined) break
    limiter.buckets.delete(oldest)
  }
}

/**
 * Counts this request against `limiter` and throws 429 once the caller's IP
 * is over `max` for the current window.
 */
export function enforceRateLimit(event: H3Event, limiter: RateLimiter): void {
  const now = Date.now()
  const ip = getClientIp(event)

  let bucket = limiter.buckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && limiter.buckets.size >= MAX_TRACKED_IPS) sweep(limiter, now)
    if (bucket) limiter.buckets.delete(ip)
    bucket = { count: 0, resetAt: now + limiter.windowMs }
    limiter.buckets.set(ip, bucket)
  }

  bucket.count++
  if (bucket.count > limiter.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    setResponseHeader(event, 'Retry-After', String(retryAfter))
    throw createError({ statusCode: 429, statusMessage: 'Too many requests' })
  }
}
