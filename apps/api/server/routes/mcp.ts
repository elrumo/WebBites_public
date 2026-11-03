import { defineEventHandler, getHeader, readRawBody, setResponseHeaders, setResponseStatus, type H3Event } from 'h3'
import { handleMcpPost } from '#root/server/utils/mcpProtocol'
import { authenticateMcpRequest } from '#root/server/utils/mcpAuth'
import { createMcpHandlers } from '#root/server/utils/mcpTools'

/**
 * The WebBites MCP server: `POST https://api.webbites.io/mcp`.
 *
 * Streamable HTTP, stateless, one JSON response per request — the protocol
 * itself is in `utils/mcpProtocol.ts`, the tools in `utils/mcpTools.ts`, who
 * may call in `utils/mcpAuth.ts`. Listed in ROOT_PUBLIC (`apiRouteAccess.ts`)
 * because it authenticates for itself: a 401 here has to carry the
 * `WWW-Authenticate` challenge that points clients at our OAuth server, which
 * the shared middleware doesn't send. See docs/mcp-feature-architecture.md.
 */

defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'Model Context Protocol endpoint for AI assistants',
    description: 'JSON-RPC over Streamable HTTP (MCP 2026-07-28, plus the initialize-based 2025-11-25, 2025-06-18 and 2025-03-26). '
      + 'Authenticate with `Authorization: Bearer <OAuth access token or wb_live_ API key>`. See /developers/docs/mcp on webbites.io.',
    responses: {
      200: { description: 'JSON-RPC response' },
      202: { description: 'Notification accepted' },
      400: { description: 'Malformed request, header mismatch (-32020) or unsupported protocol version (-32022)' },
      401: { description: 'Missing or invalid token; WWW-Authenticate names the protected resource metadata' },
      403: { description: 'Read-only connection calling a write tool, or a bad Origin' },
      404: { description: 'Unknown method (-32601)' },
      405: { description: 'Only POST is supported' },
    },
  },
})

/**
 * DNS-rebinding protection, as the transport spec requires. There are no
 * ambient credentials here (no cookies are read), so any well-formed origin
 * may call — browser-based MCP clients included — but a malformed or opaque
 * (`null`) Origin is refused.
 */
function originAllowed(event: H3Event): boolean {
  const origin = getHeader(event, 'origin')
  if (origin === undefined) return true
  if (origin === 'null') return false
  try {
    const { protocol } = new URL(origin)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function send(event: H3Event, status: number, headers: Record<string, string>, body?: unknown) {
  setResponseStatus(event, status)
  setResponseHeaders(event, { 'Cache-Control': 'no-store', ...headers })
  if (body === undefined) return null
  setResponseHeaders(event, { 'Content-Type': 'application/json' })
  return JSON.stringify(body)
}

export default defineEventHandler(async (event) => {
  // The 2025 revisions used GET for a server-push stream and DELETE to end a
  // session; neither exists here.
  if (event.method !== 'POST') {
    return send(event, 405, { Allow: 'POST' }, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Only POST is supported' } })
  }
  if (!originAllowed(event)) {
    return send(event, 403, {}, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Origin not allowed' } })
  }

  const auth = await authenticateMcpRequest(event)
  if (auth.ok === false) return send(event, auth.status, auth.headers, auth.body)

  const response = await handleMcpPost(
    { header: (name) => getHeader(event, name), rawBody: await readRawBody(event, 'utf8') },
    createMcpHandlers(auth.caller),
  )
  return send(event, response.status, response.headers, response.body)
})
