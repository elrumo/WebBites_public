// Where this server reaches the other WebBites services.
//
// The browser talks to everything through the public address (https://your.domain/...). The web
// container itself should not: going out and back in through the proxy needs DNS and TLS that a
// container often can't do for its own domain, and it is slower. So server code uses these
// helpers, which prefer the in-network addresses (BACKEND_INTERNAL_URL, PARSE_INTERNAL_URL) and
// fall back to the public ones, which is what a split deployment or local dev wants anyway.

const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`)

/** Base URL of the API, always with a trailing slash: `${backendBaseUrl()}v1/...`. */
export function backendBaseUrl(): string {
  const config = useRuntimeConfig()
  const url = String(config.backendInternalUrl || config.public.backendUrl || '')
  return url ? withSlash(url) : ''
}

/** Base URL of Parse Server's /parse mount, no trailing slash (what Parse.serverURL wants). */
export function parseBaseUrl(): string {
  const config = useRuntimeConfig()
  return String(config.parseInternalUrl || config.public.parseServerUrl || '').replace(/\/+$/, '')
}
