import { createHash } from 'node:crypto'

/**
 * Decides who a request is rate limited as, and which requests are not rate
 * limited at all.
 *
 * Kept separate from `middleware/api-rate-limit.ts` so the two decisions that
 * actually bite in production — the exemption list and the client IP behind the
 * load balancer — can be tested without Redis or an H3 event.
 */

/**
 * Paths that carry no per-user cost and must stay reachable even while a caller
 * is being throttled: the OpenAPI document and its two UIs, the health check
 * nginx polls, and the favicon browsers request alongside them.
 */
const EXEMPT_PATHS = [
  '/_docs',
  '/_nitro',
  '/_openapi',
  '/health',
  '/favicon.ico',
]

/**
 * True when the request must skip rate limiting entirely.
 *
 * Preflights are exempt because a browser sends one per cross-origin request:
 * counting them halves every caller's real allowance, and a throttled OPTIONS
 * surfaces in the browser as a CORS failure rather than a 429.
 */
export function isRateLimitExempt(path: string, method?: string): boolean {
  if ((method || '').toUpperCase() === 'OPTIONS') return true

  const normalised = (path || '/').split('?')[0]
  return EXEMPT_PATHS.some(prefix => normalised === prefix || normalised.startsWith(`${prefix}/`))
}

/**
 * The client's own address, read from the proxy headers nginx sets.
 *
 * Every production request arrives through the load balancer, so the socket
 * address is the proxy's for all of them — bucketing on it puts the entire
 * internet in one bucket, which is how a docs page ends up 429ing. The
 * left-most `X-Forwarded-For` entry is the original client.
 */
export function resolveClientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress?: string | null
): string {
  const header = (name: string): string => {
    const value = headers[name] ?? headers[name.toLowerCase()]
    return (Array.isArray(value) ? value[0] : value) || ''
  }

  const forwarded = header('x-forwarded-for').split(',')[0]
  const candidate = forwarded.trim() || header('x-real-ip').trim() || (socketAddress || '').trim()

  return normaliseIp(candidate) || 'unknown'
}

/** Strips the `[...]` and `:port` decorations proxies and sockets add. */
function normaliseIp(value: string): string {
  const bracketed = value.match(/^\[(.+)\](?::\d+)?$/)
  if (bracketed) return bracketed[1]

  // `1.2.3.4:5678` — only IPv4 carries a port here; a bare IPv6 address has
  // colons of its own and must be left alone.
  const withPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (withPort) return withPort[1]

  // `::ffff:1.2.3.4` — an IPv4 client on a dual-stack socket.
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped) return mapped[1]

  return value
}

/**
 * The Redis bucket a request counts against: its bearer token when it has one,
 * its client IP otherwise. The prefix keeps a key that happens to look like an
 * address from sharing a bucket with that address.
 *
 * The token is hashed: whatever a client sends as a bearer token — an API
 * key, an OAuth access token — must not end up readable in Redis key names.
 */
export function rateLimitIdentifier(apiKey: string | undefined | null, clientIp: string): string {
  const key = (apiKey || '').trim()
  return key ? `key:${createHash('sha256').update(key).digest('hex').slice(0, 32)}` : `ip:${clientIp || 'unknown'}`
}

/** The bearer token on the request, if it carries one. */
export function bearerToken(authorization: string | undefined | null): string | undefined {
  const match = (authorization || '').match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() || undefined : undefined
}
