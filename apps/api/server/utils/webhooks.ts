import { createHmac, randomBytes, randomUUID } from 'crypto'
import Parse from 'parse/node.js'
import { createError } from 'h3'
import { initParseForBoards, makeOwnerAcl } from './boardUtils'
import { assertPublicHttpsUrl } from './automationRules'

/**
 * Developer webhooks: a `apiWebhooks` row per endpoint, signed deliveries.
 *
 * Delivery is fire-and-forget from the save trigger. Each POST carries
 * `X-WebBites-Event`, `X-WebBites-Delivery` and `X-WebBites-Signature`
 * (`sha256=<hex HMAC of the raw body with the endpoint's secret>`).
 */
export const WEBHOOKS_CLASS = 'apiWebhooks'
export const WEBHOOK_EVENTS = ['bookmark.saved'] as const
export type WebhookEvent = typeof WEBHOOK_EVENTS[number]

const MAX_PER_USER = 10
// ponytail: an endpoint that fails this many times in a row is switched off;
// add a retry queue (QStash) if deliveries need guarantees.
const DISABLE_AFTER_FAILURES = 20
const TIMEOUT_MS = 10_000

export function serializeWebhook(row: Parse.Object, { withSecret = false } = {}) {
  return {
    id: row.id,
    url: row.get('url'),
    events: row.get('events') || [],
    description: row.get('description') ?? null,
    active: row.get('active') !== false,
    failureCount: row.get('failureCount') || 0,
    lastStatus: row.get('lastStatus') ?? null,
    lastDeliveredAt: row.get('lastDeliveredAt') ?? null,
    createdAt: row.get('createdAt'),
    ...(withSecret ? { secret: row.get('secret') } : {}),
  }
}

function userPointer(userId: string) {
  return { __type: 'Pointer', className: '_User', objectId: userId }
}

export async function listWebhooks(userId: string) {
  initParseForBoards()
  const query = new Parse.Query(WEBHOOKS_CLASS)
  query.equalTo('user', userPointer(userId))
  query.descending('createdAt')
  query.limit(MAX_PER_USER)
  return query.find({ useMasterKey: true })
}

export async function createWebhook(userId: string, input: { url?: string; events?: string[]; description?: string }) {
  initParseForBoards()
  let target: URL
  try {
    target = assertPublicHttpsUrl(input.url)
  } catch (error: any) {
    throw createError({ statusCode: 400, statusMessage: error.message })
  }
  const events = (input.events?.length ? input.events : [...WEBHOOK_EVENTS]).filter((e): e is WebhookEvent =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e)
  )
  if (!events.length) throw createError({ statusCode: 400, statusMessage: `events must be one of ${WEBHOOK_EVENTS.join(', ')}` })

  if ((await listWebhooks(userId)).length >= MAX_PER_USER) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_PER_USER} webhooks per account` })
  }

  const row = new Parse.Object(WEBHOOKS_CLASS)
  row.set('user', userPointer(userId))
  row.set('url', target.toString())
  row.set('events', events)
  row.set('description', input.description ? String(input.description).slice(0, 200) : null)
  row.set('secret', `whsec_${randomBytes(24).toString('base64url')}`)
  row.set('active', true)
  row.set('failureCount', 0)
  row.setACL(makeOwnerAcl(userId))
  return row.save(null, { useMasterKey: true })
}

export async function getWebhook(userId: string, id: string) {
  initParseForBoards()
  const query = new Parse.Query(WEBHOOKS_CLASS)
  query.equalTo('user', userPointer(userId))
  const row = await query.get(id, { useMasterKey: true }).catch(() => null)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  return row
}

export async function deleteWebhook(userId: string, id: string) {
  const row = await getWebhook(userId, id)
  await row.destroy({ useMasterKey: true })
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** POSTs one event to one endpoint and records the outcome on the row. */
export async function deliver(row: Parse.Object, event: WebhookEvent, data: unknown): Promise<{ ok: boolean; status: number | null }> {
  const body = JSON.stringify({ id: randomUUID(), event, createdAt: new Date().toISOString(), data })
  let status: number | null = null
  try {
    const response = await fetch(row.get('url'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WebBites-Webhooks/1.0',
        'X-WebBites-Event': event,
        'X-WebBites-Delivery': randomUUID(),
        'X-WebBites-Signature': signPayload(row.get('secret'), body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    status = response.status
  } catch {
    status = null
  }
  const ok = status !== null && status >= 200 && status < 300
  const failures = ok ? 0 : (row.get('failureCount') || 0) + 1
  row.set('failureCount', failures)
  row.set('lastStatus', status)
  row.set('lastDeliveredAt', new Date())
  if (failures >= DISABLE_AFTER_FAILURES) row.set('active', false)
  await row.save(null, { useMasterKey: true }).catch(() => {})
  return { ok, status }
}

/** Fans one event out to every active endpoint the user has subscribed to it. */
export async function dispatchWebhooks(userId: string, event: WebhookEvent, data: unknown): Promise<void> {
  try {
    const rows = (await listWebhooks(userId)).filter(
      (row) => row.get('active') !== false && (row.get('events') || []).includes(event)
    )
    await Promise.all(rows.map((row) => deliver(row, event, data)))
  } catch (error: any) {
    console.error('[webhooks] dispatch failed:', error?.message)
  }
}
