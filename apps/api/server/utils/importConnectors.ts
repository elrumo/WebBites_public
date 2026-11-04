import { createError } from 'h3'
import { getRedisClient, ensureRedisConnected } from './redis'

/**
 * Pulling a user's bookmarks straight out of the services they already use.
 *
 * Each connector answers the same shape the file importers produce, so the
 * clients drop the result into their existing review-then-import flow and
 * the quota, dedupe and progress code is shared. Pocket is listed so the UI
 * can say why it is missing: its API was shut down in 2025.
 */
export interface ImportedBookmark {
  url: string
  title?: string
  tags?: string[]
  addedAt?: string
}

export type ConnectorAuth = 'oauth' | 'token' | 'unavailable'

export interface Connector {
  id: string
  name: string
  auth: ConnectorAuth
  /** Where the user finds the token, for the form's helper text. */
  hint?: string
  /** For `unavailable`: what to tell the user instead. */
  note?: string
}

export const CONNECTORS: Connector[] = [
  { id: 'raindrop', name: 'Raindrop.io', auth: 'oauth' },
  { id: 'pinboard', name: 'Pinboard', auth: 'token', hint: 'Settings › Password › API token (looks like user:ABC123)' },
  { id: 'readwise', name: 'Readwise Reader', auth: 'token', hint: 'readwise.io/access_token' },
  { id: 'instapaper', name: 'Instapaper', auth: 'unavailable', note: 'Instapaper has no public list API — export a file from Settings › Export instead.' },
  { id: 'pocket', name: 'Pocket', auth: 'unavailable', note: 'Pocket shut down in 2025 and its API is gone. If you kept the CSV export, import that file.' },
]

export function connector(id: string): Connector {
  const found = CONNECTORS.find((c) => c.id === id)
  if (!found) throw createError({ statusCode: 404, statusMessage: `Unknown service "${id}"` })
  if (found.auth === 'unavailable') throw createError({ statusCode: 410, statusMessage: found.note })
  const configured = found.id !== 'raindrop' || (process.env.RAINDROP_CLIENT_ID && process.env.RAINDROP_CLIENT_SECRET)
  if (!configured) throw createError({ statusCode: 503, statusMessage: `${found.name} is not configured on this server` })
  return found
}

function bad(service: string, status: number): never {
  throw createError({
    statusCode: status === 401 || status === 403 ? 401 : 502,
    statusMessage: status === 401 || status === 403 ? `${service} rejected that token` : `${service} answered ${status}`,
  })
}

function clean(items: ImportedBookmark[]): ImportedBookmark[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    try {
      const url = new URL(item.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    } catch {
      return false
    }
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

// ─── Raindrop.io (OAuth 2) ───────────────────────────────────────────────────

export const RAINDROP_REDIRECT = () => `${process.env.VITE_BACKEND_URL}v1/import/connect/raindrop/callback`

export function raindropAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.RAINDROP_CLIENT_ID as string,
    redirect_uri: RAINDROP_REDIRECT(),
    state,
  })
  return `https://raindrop.io/oauth/authorize?${params}`
}

export async function raindropExchangeCode(code: string): Promise<string> {
  const response = await fetch('https://raindrop.io/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.RAINDROP_CLIENT_ID,
      client_secret: process.env.RAINDROP_CLIENT_SECRET,
      redirect_uri: RAINDROP_REDIRECT(),
    }),
  })
  const json: any = await response.json().catch(() => ({}))
  if (!response.ok || !json.access_token) bad('Raindrop', response.status || 502)
  return json.access_token as string
}

export async function fetchRaindrop(accessToken: string): Promise<ImportedBookmark[]> {
  const items: ImportedBookmark[] = []
  for (let page = 0; page < 200; page++) {
    const response = await fetch(`https://api.raindrop.io/rest/v1/raindrops/0?perpage=50&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) bad('Raindrop', response.status)
    const json: any = await response.json()
    const batch: any[] = json.items || []
    for (const item of batch) {
      if (item.link) items.push({ url: item.link, title: item.title, tags: item.tags || [], addedAt: item.created })
    }
    if (batch.length < 50) break
  }
  return clean(items)
}

// ─── Pinboard (API token) ────────────────────────────────────────────────────

export async function fetchPinboard(token: string): Promise<ImportedBookmark[]> {
  const response = await fetch(`https://api.pinboard.in/v1/posts/all?format=json&auth_token=${encodeURIComponent(token.trim())}`)
  if (!response.ok) bad('Pinboard', response.status)
  const json: any[] = await response.json()
  return clean(
    (json || []).map((post) => ({
      url: post.href,
      title: post.description,
      tags: String(post.tags || '').split(' ').filter(Boolean),
      addedAt: post.time,
    }))
  )
}

// ─── Readwise Reader (access token) ──────────────────────────────────────────

export async function fetchReadwise(token: string): Promise<ImportedBookmark[]> {
  const items: ImportedBookmark[] = []
  let cursor: string | null = null
  for (let page = 0; page < 200; page++) {
    const params = new URLSearchParams()
    if (cursor) params.set('pageCursor', cursor)
    const response = await fetch(`https://readwise.io/api/v3/list/?${params}`, {
      headers: { Authorization: `Token ${token.trim()}` },
    })
    if (!response.ok) bad('Readwise', response.status)
    const json: any = await response.json()
    for (const doc of json.results || []) {
      if (doc.category === 'highlight' || doc.category === 'note') continue
      const url = doc.source_url || doc.url
      if (url) items.push({ url, title: doc.title, tags: Object.keys(doc.tags || {}), addedAt: doc.saved_at })
    }
    cursor = json.nextPageCursor || null
    if (!cursor) break
  }
  return clean(items)
}

// ─── Short-lived state and tokens for the OAuth round trip ───────────────────

const STATE_TTL = 10 * 60
const TOKEN_TTL = 60 * 60

export async function rememberOAuthState(state: string, value: { userId: string; client: string }) {
  const redis = getRedisClient()
  await ensureRedisConnected()
  await redis.set(`import_connect_state:${state}`, JSON.stringify(value), { EX: STATE_TTL })
}

export async function takeOAuthState(state: string): Promise<{ userId: string; client: string } | null> {
  const redis = getRedisClient()
  await ensureRedisConnected()
  const raw = await redis.getDel(`import_connect_state:${state}`)
  return raw ? JSON.parse(String(raw)) : null
}

export async function storeConnectorToken(service: string, userId: string, token: string) {
  const redis = getRedisClient()
  await ensureRedisConnected()
  await redis.set(`import_connect:${service}:${userId}`, token, { EX: TOKEN_TTL })
}

export async function takeConnectorToken(service: string, userId: string): Promise<string | null> {
  const redis = getRedisClient()
  await ensureRedisConnected()
  const token = await redis.getDel(`import_connect:${service}:${userId}`)
  return token ? String(token) : null
}
