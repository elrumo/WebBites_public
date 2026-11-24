import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { log } from './useDevLog'
import { backendBaseUrl } from './internalUrls'
import { cookieSecure } from './cookies'

/**
 * The backend API key behind the HttpOnly `wb_api_key` cookie.
 *
 * Shared by `POST /api/auth/generateKey` (the browser asks for one) and
 * server/utils/backendFetch.ts (a server route retries after a 401). The raw
 * key only ever travels in the HttpOnly cookie or server-side; it is never put
 * in a response body, where any script on the page could read it.
 */

const API_KEY_COOKIE = 'wb_api_key'

export function setApiKeyCookie(event: H3Event, apiKey: string) {
  setCookie(event, API_KEY_COOKIE, apiKey, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** A lightweight backend call that answers 200 for a live key. */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const result = await withTimeout(
      fetch(`${backendBaseUrl()}v1/auth/validateApiKey`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      3000,
      'Validation timeout'
    )
    log('[apiKeys] validation response status:', result.status)
    return result.ok
  } catch (error) {
    console.error('[apiKeys] Error validating API key:', error instanceof Error ? error.message : error)
    // On error or timeout, assume invalid so a new one is generated.
    return false
  }
}

export interface ApiKeyInfo {
  key: string
  userId?: string
  name?: string
  [field: string]: unknown
}

/** Asks the backend for a new key for the user behind `sessionToken`. */
export async function createApiKey(sessionToken: string): Promise<ApiKeyInfo> {
  const fullUrl = `${backendBaseUrl()}v1/auth/generate-api-key`

  // 8 s leaves headroom under a 10 s serverless limit on a backend cold start.
  const result = await withTimeout(
    fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    }),
    8000,
    'Backend request timeout - backend may be cold starting'
  )

  if (!result.ok) {
    console.error('[apiKeys] generate-api-key failed:', result.status, result.statusText, fullUrl)
    try {
      console.error('[apiKeys] Error body:', (await result.text()).slice(0, 500))
    } catch {
      // nothing to add
    }
    throw new Error(`HTTP error! status: ${result.status}`)
  }

  const data = await result.json()
  if (!data?.apiKeyData?.key) throw new Error('Failed to generate API key')
  return data.apiKeyData
}

/**
 * Makes sure the request carries a working API key: keeps the one in the
 * cookie when the backend still accepts it, otherwise generates a new one and
 * sets the cookie. Returns the key and its metadata for server-side use only.
 */
export async function ensureApiKeyCookie(
  event: H3Event,
  sessionToken: string
): Promise<{ apiKey: string; info: Omit<ApiKeyInfo, 'key'> | null; reused: boolean }> {
  const existing = getCookie(event, API_KEY_COOKIE)
  if (existing) {
    if (await validateApiKey(existing)) {
      setApiKeyCookie(event, existing) // refresh its expiry
      return { apiKey: existing, info: null, reused: true }
    }
    log('[apiKeys] existing API key is invalid or expired, generating a new one')
    deleteCookie(event, API_KEY_COOKIE)
  }

  const { key, ...info } = await createApiKey(sessionToken)
  setApiKeyCookie(event, key)
  return { apiKey: key, info, reused: false }
}
