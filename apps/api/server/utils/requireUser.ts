import { H3Event, createError, getHeader } from 'h3'
import { validateApiKey } from './api-keys'
import { verifySession } from './sessionCache.js'

/**
 * The user behind `Authorization: Bearer <token>`, where the token is either a
 * WebBites API key (`wb_live_…`) or a Parse session token (`r:…`).
 *
 * The web app proxies with whichever cookie it holds and the native app sends
 * its issued key, so account-management routes (keys, webhooks, connected
 * imports) accept both rather than forcing every client onto one.
 */
export async function requireUserId(event: H3Event): Promise<string> {
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Missing Authorization header' })

  if (token.startsWith('r:')) {
    const user = await verifySession(token).catch(() => null)
    if (user) return user.id
  } else {
    const userId = await validateApiKey(token)
    if (userId && userId !== 'custom') return userId
  }
  throw createError({ statusCode: 401, statusMessage: 'Invalid or expired credentials' })
}

/**
 * Which user a route should act on when the body carries a `userId`.
 *
 * Internal callers (the QStash pipeline, the website BFF, parse-compose
 * triggers) legitimately act on behalf of someone else, so for them the body's
 * userId stands. A caller holding only a user credential may act on itself and
 * nothing else, so its body userId is ignored rather than trusted — the legacy
 * root routes used to take it at face value from anyone at all.
 */
export async function resolveActingUserId(event: H3Event, bodyUserId?: unknown): Promise<string> {
  if (event.context.internal) {
    if (typeof bodyUserId === 'string' && bodyUserId.trim()) return bodyUserId.trim()
    throw createError({ statusCode: 400, statusMessage: 'Missing userId' })
  }

  // The api-key middleware has already validated the credential by the time a
  // handler runs, and it accepts the `wb_api_key` cookie as well as a header.
  // Reuse what it resolved rather than insisting on a header of our own.
  const fromMiddleware = event.context.apiKey?.userId
  if (fromMiddleware && fromMiddleware !== 'custom') return fromMiddleware

  return requireUserId(event)
}
