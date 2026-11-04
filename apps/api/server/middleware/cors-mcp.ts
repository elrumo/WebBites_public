import { defineEventHandler, getRequestURL, setResponseHeaders, setResponseStatus } from 'h3'

/**
 * CORS for the MCP endpoint and the OAuth endpoints around it, which browser-
 * based MCP clients call cross-origin. The site-wide `cors: true` route rule
 * allows every header with `*`, which browsers don't extend to
 * `Authorization`, and exposes none — and a client that can't read
 * `WWW-Authenticate` off a 401 can't find our authorization server.
 *
 * None of these routes reads a cookie, so allowing any origin hands nothing
 * ambient to the caller.
 */

const PREFIXES = ['/mcp', '/oauth', '/.well-known']

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  })

  if (event.method === 'OPTIONS') {
    setResponseHeaders(event, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
      'Access-Control-Max-Age': '86400',
    })
    setResponseStatus(event, 204)
    return ''
  }
})
