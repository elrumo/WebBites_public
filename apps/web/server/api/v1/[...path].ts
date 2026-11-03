import { joinURL } from 'ufo'

// Endpoints that authenticate via Parse session token instead of API key
const PARSE_SESSION_PATHS = ['boards', 'public/boards', 'bookmarks', 'tags', 'automations', 'backups']

/**
 * Headers worth passing through to the backend.
 *
 * This list is deliberately an allow-list. Forwarding the incoming request
 * headers wholesale sent the browser's `host: webbites.io` along to
 * api.webbites.io, and the reverse proxy in front of the backend routes by
 * Host — so every proxied call landed on the *website* container and came back
 * `404 Page not found: /v1/boards`. `content-length`, `connection` and
 * `accept-encoding` are equally unsafe to copy onto a re-encoded request body.
 */
const FORWARDED_HEADERS = ['accept-language', 'user-agent', 'x-request-id', 'bypass-tunnel-reminder']

export default defineEventHandler(async (event) => {
  const apiKeyCookie = getCookie(event, 'wb_api_key')
  const parseSessionCookie = getHeader(event, 'x-parse-session-token') || getCookie(event, 'parse.session')

  // Get the path from the URL
  const path = getRouterParam(event, 'path') || ''

  // `public/*` is what a logged-out visitor's shared-board page reads. The
  // backend serves it without credentials, so none are sent: a stale cookie
  // would only turn a readable page into a 401. GET only, and no `..` that
  // could climb out of `public/` once the URL is resolved.
  if (path.startsWith('public/') && getMethod(event) === 'GET' && !path.split('/').includes('..')) {
    try {
      return await $fetch(joinURL(backendBaseUrl(), 'v1', path), {
        headers: { 'Content-Type': 'application/json' },
        query: getQuery(event)
      })
    } catch (error: any) {
      throw createError({
        statusCode: error.status || error.statusCode || 500,
        statusMessage: error.data?.message || error.data?.statusMessage || error.message || 'Internal server error',
        data: error.data
      })
    }
  }

  if (!apiKeyCookie && !parseSessionCookie) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated. Please login.'
    })
  }

  // Pick the right token: Parse session for boards, API key for everything else
  const usesParseSession = PARSE_SESSION_PATHS.some(p => path === p || path.startsWith(`${p}/`))
  const primaryToken = usesParseSession
    ? (parseSessionCookie || apiKeyCookie)
    : (apiKeyCookie || parseSessionCookie)
  const fallbackToken = usesParseSession
    ? apiKeyCookie
    : parseSessionCookie

  // Forward request to backend
  const config = useRuntimeConfig()
  const backendPath = joinURL(backendBaseUrl(), 'v1', path)

  const incoming = getHeaders(event)
  const passThrough: Record<string, string> = {}
  for (const name of FORWARDED_HEADERS) {
    const value = incoming[name]
    if (value) passThrough[name] = value
  }

  const method = getMethod(event)
  const query = getQuery(event)
  const body = method !== 'GET' && method !== 'HEAD' ? await readBody(event) : undefined

  const requestWith = (token: string) => $fetch(backendPath, {
    method,
    headers: {
      ...passThrough,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body,
    query
  })

  try {
    return await requestWith(primaryToken as string)
  } catch (error: any) {
    // If the primary token failed with 401 and we have a fallback, retry with it
    if ((error.status === 401 || error.statusCode === 401) && fallbackToken && fallbackToken !== primaryToken) {
      try {
        return await requestWith(fallbackToken)
      } catch (retryError: any) {
        console.error(`Proxy error (fallback also failed) ${method} ${backendPath}:`, retryError.status || retryError.statusCode, retryError.message)
      }
    }

    console.error(`Proxy error ${method} ${backendPath}:`, error.status || error.statusCode, error.message)

    if (error.status === 401 || error.statusCode === 401) {
      deleteCookie(event, 'wb_api_key')
      throw createError({
        statusCode: 401,
        statusMessage: 'Session expired. Please login again.'
      })
    }

    // Forward the upstream body, not just the status. The backend answers a
    // spent quota or a plan gate with `{errorType: 'UsageError', quotaKind}`,
    // and the client decides which upgrade prompt to show from those fields —
    // dropping them here turns every one of them into a generic failure.
    throw createError({
      statusCode: error.status || error.statusCode || 500,
      statusMessage: error.data?.message
        || error.data?.statusMessage
        || (typeof error.data?.error === 'string' ? error.data.error : undefined)
        || error.message
        || 'Internal server error',
      data: error.data
    })
  }
})
