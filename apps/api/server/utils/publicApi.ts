import { H3Event, createError, getHeader, setHeaders } from 'h3'
import Parse from 'parse/node.js'
import { validateApiKey } from './api-keys'
import { getRedisClient, ensureRedisConnected } from './redis'
import { getUserWithPlan, getPlanTier } from './plans'
import { initParseForBoards } from './boardUtils'
import type { PlanTier } from '../types/plan.types'

/**
 * The developer API (`/v1/api/*`): API-key auth, a per-key rate limit and a
 * per-account monthly meter, both sized by plan tier.
 */
// `plus` is the only paid tier and it includes everything, so it gets the top
// allowance — grandfathered Bite and Feast subscribers included, since their
// retired price ids resolve to `plus` too.
export const API_LIMITS: Record<PlanTier, { perMinute: number; perMonth: number }> = {
  free: { perMinute: 60, perMonth: 1_000 },
  plus: { perMinute: 1_000, perMonth: 100_000 },
}

const WINDOW_SECONDS = 60

// ponytail: fixed window, same shape as middleware/api-rate-limit.ts; move to
// a sliding window if bursts at the boundary ever matter.
const RATE_LIMIT_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
  return { current, redis.call('TTL', KEYS[1]) }
`

export interface ApiCaller {
  userId: string
  user: Parse.Object
  plan: Parse.Object
  tier: PlanTier
  apiKey: string
}

export function usageMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7)
}

export function usageKey(userId: string, month = usageMonth()): string {
  return `api_usage:${userId}:${month}`
}

/** The outcome of counting one call against a plan's allowance. */
export type MeterOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: 'rate' | 'monthly'; message: string; retryAfter?: number; headers: Record<string, string> }

/**
 * Counts one call against the per-minute window of `rateBucket` and the
 * account's monthly allowance, recording it under `usageField` (`key:<key>`
 * for an API key, `grant:<id>` for an OAuth connection) so the usage page can
 * say which credential spent it. Redis being down fails open — a metering
 * outage should not take the API with it.
 *
 * Shared by the developer API (`requireApiCaller`) and the MCP server, so an
 * assistant's tool calls and a script's requests draw on one allowance.
 */
export async function meterApiCall({ userId, tier, rateBucket, usageField }: {
  userId: string
  tier: PlanTier
  rateBucket: string
  usageField: string
}): Promise<MeterOutcome> {
  const limits = API_LIMITS[tier]
  try {
    const redis = getRedisClient()
    await ensureRedisConnected()

    const [countRaw, ttlRaw] = (await redis.eval(RATE_LIMIT_LUA, {
      keys: [rateBucket],
      arguments: [String(WINDOW_SECONDS)],
    })) as [number, number]
    const count = Number(countRaw)
    const ttl = Math.max(0, Number(ttlRaw))

    const month = usageKey(userId)
    const monthly = Number(await redis.hIncrBy(month, 'total', 1))
    await redis.hIncrBy(month, usageField, 1)
    await redis.expire(month, 40 * 86400)

    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(limits.perMinute),
      'X-RateLimit-Remaining': String(Math.max(0, limits.perMinute - count)),
      'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + ttl)),
      'X-Usage-Limit': String(limits.perMonth),
      'X-Usage-Remaining': String(Math.max(0, limits.perMonth - monthly)),
    }

    if (count > limits.perMinute) {
      const retryAfter = ttl || WINDOW_SECONDS
      headers['Retry-After'] = String(retryAfter)
      return { ok: false, reason: 'rate', message: `Rate limit of ${limits.perMinute} requests per minute exceeded`, retryAfter, headers }
    }
    if (monthly > limits.perMonth) {
      return { ok: false, reason: 'monthly', message: `Monthly API allowance of ${limits.perMonth} requests spent — upgrade your plan for more`, headers }
    }
    return { ok: true, headers }
  } catch (error: any) {
    console.warn('[publicApi] metering unavailable, allowing request:', error?.message)
    return { ok: true, headers: {} }
  }
}

/**
 * Authenticates a developer-API request, counts it, and rejects it once the
 * caller's plan allowance is spent.
 */
export async function requireApiCaller(event: H3Event): Promise<ApiCaller> {
  initParseForBoards()
  const apiKey = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!apiKey) throw createError({ statusCode: 401, statusMessage: 'Missing Authorization: Bearer <api key>' })

  const userId = await validateApiKey(apiKey)
  if (!userId || userId === 'custom') throw createError({ statusCode: 401, statusMessage: 'Invalid API key' })

  const { user, plan } = await getUserWithPlan(userId)
  const tier = getPlanTier(plan)

  const outcome = await meterApiCall({ userId, tier, rateBucket: `api_rate:${apiKey}`, usageField: `key:${apiKey}` })
  setHeaders(event, outcome.headers)
  if (outcome.ok === false) {
    throw createError({
      statusCode: 429,
      statusMessage: outcome.message,
      data: outcome.reason === 'monthly' ? { errorType: 'UsageError', quotaKind: 'api' } : undefined,
    })
  }

  return { userId, user, plan, tier, apiKey }
}

/**
 * This month's request counts as the usage endpoint reports them: per API key,
 * and per OAuth connection (`byGrant`, the MCP server's assistants).
 */
export async function readUsage(userId: string): Promise<{
  month: string
  total: number
  byKey: Record<string, number>
  byGrant: Record<string, number>
}> {
  const month = usageMonth()
  const empty = { month, total: 0, byKey: {} as Record<string, number>, byGrant: {} as Record<string, number> }
  try {
    const redis = getRedisClient()
    await ensureRedisConnected()
    const raw = await redis.hGetAll(usageKey(userId, month))
    const entries = (raw instanceof Map ? Object.fromEntries(raw) : raw) as unknown as Record<string, string>
    const byKey: Record<string, number> = {}
    const byGrant: Record<string, number> = {}
    for (const [field, value] of Object.entries(entries || {})) {
      if (field.startsWith('key:')) byKey[field.slice(4)] = Number(value)
      else if (field.startsWith('grant:')) byGrant[field.slice(6)] = Number(value)
    }
    return { month, total: Number(entries?.total || 0), byKey, byGrant }
  } catch {
    return empty
  }
}

/** The public shape of a `websites` row. Nothing internal, nothing that leaks another user. */
export function serializeBookmark(row: Parse.Object) {
  const file = (name: string) => row.get(name)?.url?.() ?? null
  return {
    id: row.id,
    url: row.get('url') ?? null,
    title: row.get('siteTitle') ?? null,
    description: row.get('siteDescription') ?? null,
    type: row.get('type') ?? 'website',
    tags: row.get('tags') || [],
    note: row.get('siteNotes') ?? null,
    textNote: row.get('textNote') ?? null,
    summary: row.get('aiSummary') ?? null,
    image: row.get('OGImage') || file('OGImageFile') || file('siteScreenshot') || null,
    screenshot: file('fullPageScreenshot') || file('siteScreenshot') || null,
    favicon: row.get('siteLogo') ?? null,
    author: row.get('siteAuthor') ?? null,
    publisher: row.get('sitePublisher') ?? null,
    favorited: row.get('favorited') || false,
    pinned: row.get('pinned') || false,
    savedFrom: row.get('savedFrom') ?? null,
    createdAt: row.get('createdAt'),
    updatedAt: row.get('updatedAt'),
  }
}
