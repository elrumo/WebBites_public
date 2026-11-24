import { createError, getHeader, getMethod, getRequestURL } from 'h3'

/**
 * Cross-site request check for the state-changing API routes.
 *
 * The session lives in a cookie (`parse.session`, `wb_api_key`), so any page
 * on the web could otherwise make a signed-in visitor's browser POST to
 * /api/*. Browsers attach an `Origin` header to every cross-origin POST/PUT/
 * PATCH/DELETE (fetch, XHR and form submits alike) and pages cannot forge it,
 * so: when one is present it has to be this app, or one of our browser
 * extensions.
 *
 * A request without `Origin` passes. The native apps (URLSession), the
 * changelog scripts and other server-to-server callers send none, and a
 * browser always does on the cross-site requests this is about.
 *
 * Not covered, on purpose:
 * - `/auth/apple/callback` (server/routes) is Apple's cross-site form POST from
 *   appleid.apple.com. It is outside /api/, so it never reaches this check.
 * - There are no third-party webhooks under /api/ today. If one is added
 *   (Stripe, QStash, ...), put its path in EXEMPT_PATHS and verify its
 *   signature in the route instead.
 */

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Exact paths (lower case, no trailing slash) that third parties call.
const EXEMPT_PATHS = new Set<string>([])

// Browser extensions: Chrome/Edge/Brave, Firefox, Safari. `views://` is the
// Electrobun desktop shell's own scheme (electrobun/index.ts); no web page can
// carry any of these origins.
const EXTENSION_SCHEMES = new Set(['chrome-extension:', 'moz-extension:', 'safari-web-extension:', 'views:'])

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

function allowedHosts(event: any): Set<string> {
  const hosts = new Set<string>()

  // The host the browser addressed. `x-forwarded-host` is what the reverse
  // proxy saw; a cross-site page cannot set it (it is not a CORS-safelisted
  // header, so the browser would preflight and stop there).
  for (const header of ['host', 'x-forwarded-host']) {
    const value = getHeader(event, header)?.split(',')[0]?.trim().toLowerCase()
    if (value) hosts.add(value)
  }

  // The configured public URL, for deployments where the proxy rewrites Host.
  const config = useRuntimeConfig()
  for (const url of [config.appUrl, config.public?.appUrl]) {
    const host = hostOf(url as string | undefined)
    if (host) hosts.add(host)
  }

  return hosts
}

export default defineEventHandler((event) => {
  if (!STATE_CHANGING.has(getMethod(event))) return

  const path = getRequestURL(event).pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase()
  if (!path.startsWith('/api/') || EXEMPT_PATHS.has(path)) return

  const origin = getHeader(event, 'origin')
  if (origin === undefined || origin === '') return

  let parsed: URL | null = null
  try {
    parsed = new URL(origin)
  } catch {
    // `Origin: null` (sandboxed frames, file://, opaque redirects) lands here.
    parsed = null
  }

  if (parsed) {
    if (EXTENSION_SCHEMES.has(parsed.protocol)) return
    if (allowedHosts(event).has(parsed.host.toLowerCase())) return
    // Local development: the Electrobun shell and `nuxt dev` can sit on
    // different localhost ports.
    if (import.meta.dev && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return
  }

  throw createError({ statusCode: 403, statusMessage: 'Cross-site request refused' })
})
