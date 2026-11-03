import { getRedisClient, ensureRedisConnected } from './redis'

/**
 * Request metrics for the public developer API (/v1/api/*), shown on the
 * website's admin page.
 *
 * One Redis hash per UTC hour, `api_metrics:YYYYMMDDHH`, shared by every
 * replica:
 *   req:<METHOD route>:<2xx|4xx|5xx>  request count
 *   ms:<METHOD route>                 summed duration (avg = ms / requests)
 *   user:<userId>                     request count per caller
 *
 * `route` is the matched pattern (`/v1/api/bookmarks/:id`), never the raw URL,
 * so the field count stays bounded.
 */

// ponytail: 90 days of hourly buckets in Redis; roll up into Parse if longer history is wanted.
export const RETENTION_HOURS = 90 * 24
const PREFIX = 'api_metrics:'

export function hourKey(d: Date): string {
  return PREFIX + d.toISOString().slice(0, 13).replace(/[-T]/g, '')
}

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`
}

export function recordApiMetric(route: string, status: number, ms: number, userId?: string) {
  const key = hourKey(new Date())
  const multi = getRedisClient().multi()
    .hIncrBy(key, `req:${route}:${statusClass(status)}`, 1)
    .hIncrBy(key, `ms:${route}`, Math.round(ms))
  if (userId) multi.hIncrBy(key, `user:${userId}`, 1)
  multi.expire(key, RETENTION_HOURS * 3600)
  return ensureRedisConnected().then(() => multi.exec())
}

type Hash = Record<string, string>

export interface ApiMetrics {
  series: { hour: string, requests: number, errors: number, avgMs: number }[]
  routes: { route: string, requests: number, errors: number, avgMs: number }[]
  users: { userId: string, requests: number }[]
}

/** Folds hourly hashes (oldest first) into the admin payload. Pure, so it's testable. */
export function aggregate(hours: { hour: string, hash: Hash }[]): ApiMetrics {
  const routes = new Map<string, { requests: number, errors: number, ms: number }>()
  const users = new Map<string, number>()
  const series = hours.map(({ hour, hash }) => {
    let requests = 0, errors = 0, ms = 0
    for (const [field, raw] of Object.entries(hash)) {
      const n = Number(raw) || 0
      if (field.startsWith('user:')) {
        const id = field.slice(5)
        users.set(id, (users.get(id) || 0) + n)
        continue
      }
      // Routes contain ':' (`:id` params), so split from the ends.
      const kind = field.slice(0, field.indexOf(':'))
      const rest = field.slice(kind.length + 1)
      const route = kind === 'req' ? rest.slice(0, rest.lastIndexOf(':')) : rest
      const r = routes.get(route) || { requests: 0, errors: 0, ms: 0 }
      if (kind === 'req') {
        const isError = !rest.endsWith(':2xx') && !rest.endsWith(':3xx')
        r.requests += n; requests += n
        if (isError) { r.errors += n; errors += n }
      } else if (kind === 'ms') {
        r.ms += n; ms += n
      }
      routes.set(route, r)
    }
    return { hour, requests, errors, avgMs: requests ? Math.round(ms / requests) : 0 }
  })

  return {
    series,
    routes: [...routes].map(([route, r]) => ({
      route, requests: r.requests, errors: r.errors, avgMs: r.requests ? Math.round(r.ms / r.requests) : 0,
    })).sort((a, b) => b.requests - a.requests),
    users: [...users].map(([userId, requests]) => ({ userId, requests }))
      .sort((a, b) => b.requests - a.requests).slice(0, 20),
  }
}

export async function readApiMetrics(hoursBack: number): Promise<ApiMetrics> {
  const n = Math.min(Math.max(1, Math.floor(hoursBack) || 24), RETENTION_HOURS)
  const now = Date.now()
  const hours = Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * 3600_000))

  await ensureRedisConnected()
  const multi = getRedisClient().multi()
  for (const d of hours) multi.hGetAll(hourKey(d))
  const hashes = (await multi.exec()) as unknown as Hash[]

  return aggregate(hours.map((d, i) => ({ hour: d.toISOString().slice(0, 13) + ':00:00Z', hash: hashes[i] || {} })))
}
