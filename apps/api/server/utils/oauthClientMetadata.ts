import { safeFetch } from './safeUrl'
import { isClientMetadataUrl, validateClientMetadataDocument, type ClientRecord } from './oauthRules'
import { cacheClientMetadata, getCachedClientMetadata, getRegisteredClient } from './oauthStore'

/**
 * Who a `client_id` is. Either an HTTPS URL — a Client ID Metadata Document,
 * which we fetch, check and cache — or an id our registration endpoint issued.
 *
 * The fetch is the one place the authorization server reaches out to a URL a
 * stranger chose, so it goes through `safeFetch` (public addresses only), takes
 * no redirects, gives up after 5 seconds and reads at most 5 KB.
 */

const MAX_DOCUMENT_BYTES = 5 * 1024
const FETCH_TIMEOUT_MS = 5000
const DEFAULT_CACHE_SECONDS = 3600

function cacheSeconds(cacheControl: string | null): number {
  if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) return DEFAULT_CACHE_SECONDS
  const maxAge = cacheControl.match(/max-age=(\d+)/i)
  return maxAge ? Number(maxAge[1]) : DEFAULT_CACHE_SECONDS
}

async function fetchClientMetadata(url: string): Promise<{ ok: true; client: ClientRecord } | { ok: false; reason: string }> {
  let response: Response
  try {
    response = await safeFetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }, 0)
  } catch (error: any) {
    return { ok: false, reason: `the client metadata could not be fetched (${error?.message || 'network error'})` }
  }
  if (response.status !== 200) return { ok: false, reason: `the client metadata URL answered ${response.status}` }
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'the client metadata document is too large' }
  const body = await response.text()
  if (Buffer.byteLength(body) > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'the client metadata document is too large' }

  let doc: unknown
  try { doc = JSON.parse(body) } catch { return { ok: false, reason: 'the client metadata is not valid JSON' } }
  const checked = validateClientMetadataDocument(doc, url)
  if (checked.ok === false) return checked

  const client: ClientRecord = { ...checked.client, createdAt: new Date().toISOString() }
  await cacheClientMetadata(client, cacheSeconds(response.headers.get('cache-control')))
  return { ok: true, client }
}

export async function resolveClient(clientId: unknown): Promise<{ ok: true; client: ClientRecord } | { ok: false; reason: string }> {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 2000) return { ok: false, reason: 'client_id is missing' }
  if (isClientMetadataUrl(clientId)) {
    const cached = await getCachedClientMetadata(clientId)
    return cached ? { ok: true, client: cached } : fetchClientMetadata(clientId)
  }
  const registered = await getRegisteredClient(clientId)
  return registered ? { ok: true, client: registered } : { ok: false, reason: 'unknown client_id; register the client first' }
}
