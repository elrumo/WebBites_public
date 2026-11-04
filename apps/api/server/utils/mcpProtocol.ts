/**
 * The MCP wire protocol for `POST /mcp`: JSON-RPC over Streamable HTTP,
 * stateless, JSON responses only (no SSE). Pure — no h3, Parse or Redis — so
 * every rule here is tested on its own (`npm run test:mcpProtocol`); the route
 * (`routes/mcp.ts`) authenticates and hands the body over, and the tools come
 * in through `McpHandlers`.
 *
 * Dual-era, as the 2026-07-28 revision's backward-compatibility section
 * allows:
 *
 * - Modern (2026-07-28): no handshake. Every request carries its protocol
 *   version in `params._meta`, mirrored into the `MCP-Protocol-Version`,
 *   `Mcp-Method` and `Mcp-Name` headers, which must match the body (-32020).
 *   An unknown version is -32022, an unknown method a 404 with -32601, and
 *   every result says `resultType: "complete"`. `server/discover` is mandatory.
 * - Legacy (2025-11-25, 2025-06-18, 2025-03-26): an `initialize` handshake,
 *   answered without minting a session (sessions were always optional), then
 *   requests with no `_meta` version. A request that omits the version header
 *   is taken as 2025-03-26, the only revision that allowed JSON-RPC batches.
 *
 * Which era a request belongs to is read from the request itself, so the two
 * are served side by side on the one endpoint with no state between requests.
 */

export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS]

/** The version a legacy request without an `MCP-Protocol-Version` header speaks. */
const HEADERLESS_LEGACY_VERSION = '2025-03-26'

export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const

const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

/** How long a client may cache `tools/list` and `server/discover`. */
export const TOOLS_TTL_MS = 5 * 60 * 1000
export const DISCOVER_TTL_MS = 60 * 60 * 1000

export type Era = 'modern' | 'legacy'

export interface McpServerInfo {
  name: string
  title: string
  version: string
  websiteUrl?: string
  icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>
}

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface ToolResult {
  content: Array<Record<string, unknown>>
  structuredContent?: unknown
  isError?: boolean
}

export type ToolCallOutcome =
  | { kind: 'result'; result: ToolResult }
  /** The credential can't make this call; the client may step up (403 + WWW-Authenticate). */
  | { kind: 'forbidden'; headers: Record<string, string>; message: string }
  | { kind: 'unknown_tool' }

export interface McpRequestContext {
  era: Era
  protocolVersion: string
}

/** What the endpoint serves, already narrowed to the authenticated caller. */
export interface McpHandlers {
  serverInfo: McpServerInfo
  instructions: string
  listTools(): McpTool[]
  callTool(name: string, args: Record<string, unknown>, context: McpRequestContext): Promise<ToolCallOutcome>
}

export interface McpHttpRequest {
  /** Case-insensitive header lookup. */
  header(name: string): string | undefined
  rawBody: string | undefined
}

export interface McpHttpResponse {
  status: number
  headers: Record<string, string>
  /** JSON to send, or undefined for an empty body (202). */
  body?: unknown
}

type JsonRpcId = string | number | null

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
  result?: unknown
  error?: unknown
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } }
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): McpHttpResponse {
  return { status, headers: body === undefined ? headers : { ...JSON_HEADERS, ...headers }, body }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validId(id: unknown): id is string | number {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))
}

/**
 * A mirrored header value as the body would hold it: `=?base64?…?=` decoded,
 * anything else as sent. Null when the value is malformed — control
 * characters, or a sentinel that isn't valid base64 — which is itself a
 * header-validation failure.
 */
export function decodeMirroredHeader(value: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(value)) return null
  const sentinel = value.match(/^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/)
  if (!sentinel) return value.startsWith('=?base64?') ? null : value
  try {
    return Buffer.from(sentinel[1], 'base64').toString('utf8')
  } catch {
    return null
  }
}

/** The body field `Mcp-Name` mirrors, for the methods that carry one. */
function mirroredName(method: string, params: Record<string, unknown>): string | undefined {
  if (method === 'tools/call' || method === 'prompts/get') return typeof params.name === 'string' ? params.name : undefined
  if (method === 'resources/read') return typeof params.uri === 'string' ? params.uri : undefined
  return undefined
}

function legacyInitializeResult(handlers: McpHandlers, requested: unknown) {
  const protocolVersion = typeof requested === 'string' && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LEGACY_PROTOCOL_VERSIONS[0]
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: handlers.serverInfo,
    instructions: handlers.instructions,
  }
}

function discoverResult(handlers: McpHandlers) {
  return {
    resultType: 'complete',
    supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    capabilities: { tools: {} },
    _meta: { [META_SERVER_INFO]: handlers.serverInfo },
    instructions: handlers.instructions,
    ttlMs: DISCOVER_TTL_MS,
    cacheScope: 'public',
  }
}

/**
 * One JSON-RPC request, already known to be a request (it has an id and a
 * method). Returns the HTTP response for it on its own; batches use only the
 * body.
 */
async function handleRequest(
  message: JsonRpcMessage & { id: string | number; method: string },
  request: McpHttpRequest,
  handlers: McpHandlers,
  { inBatch = false }: { inBatch?: boolean } = {},
): Promise<McpHttpResponse> {
  const { id, method } = message
  if (message.params !== undefined && !isObject(message.params)) {
    return respond(200, rpcError(id, RPC_ERROR.INVALID_PARAMS, 'params must be an object'))
  }
  const params = (message.params ?? {}) as Record<string, unknown>
  const meta = isObject(params._meta) ? params._meta : undefined
  const metaVersion = meta?.[META_VERSION]

  // ─── Legacy handshake ───
  if (method === 'initialize') {
    return respond(200, rpcResult(id, legacyInitializeResult(handlers, params.protocolVersion)))
  }

  const headerVersion = request.header('mcp-protocol-version')?.trim()

  // ─── Modern: the version rides in _meta ───
  if (typeof metaVersion === 'string' && !inBatch) {
    if (!(MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(metaVersion)) {
      return respond(400, rpcError(id, RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        requested: metaVersion,
      }))
    }
    if (headerVersion !== metaVersion) {
      return respond(400, rpcError(id, RPC_ERROR.HEADER_MISMATCH,
        headerVersion
          ? `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match _meta '${metaVersion}'`
          : 'Header mismatch: MCP-Protocol-Version header is required'))
    }
    const headerMethod = request.header('mcp-method')
    if (headerMethod !== method) {
      return respond(400, rpcError(id, RPC_ERROR.HEADER_MISMATCH,
        headerMethod === undefined
          ? 'Header mismatch: Mcp-Method header is required'
          : `Header mismatch: Mcp-Method '${headerMethod}' does not match body method '${method}'`))
    }
    const bodyName = mirroredName(method, params)
    if (bodyName !== undefined) {
      const rawName = request.header('mcp-name')
      const headerName = rawName === undefined ? undefined : decodeMirroredHeader(rawName)
      if (headerName !== bodyName) {
        return respond(400, rpcError(id, RPC_ERROR.HEADER_MISMATCH,
          rawName === undefined
            ? 'Header mismatch: Mcp-Name header is required'
            : `Header mismatch: Mcp-Name does not match body value '${bodyName}'`))
      }
    }
    return dispatch(id, method, params, handlers, { era: 'modern', protocolVersion: metaVersion })
  }

  // ─── Legacy: no _meta version ───
  const version = headerVersion || HEADERLESS_LEGACY_VERSION
  if (!(LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    // A modern version in the header but none in the body is a malformed
    // modern request rather than a legacy one.
    if ((MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
      return respond(400, rpcError(id, RPC_ERROR.HEADER_MISMATCH,
        `Header mismatch: _meta['${META_VERSION}'] is required with MCP-Protocol-Version ${version}`))
    }
    return respond(400, rpcError(id, RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      requested: version,
    }))
  }
  return dispatch(id, method, params, handlers, { era: 'legacy', protocolVersion: version })
}

async function dispatch(
  id: string | number,
  method: string,
  params: Record<string, unknown>,
  handlers: McpHandlers,
  context: McpRequestContext,
): Promise<McpHttpResponse> {
  const modern = context.era === 'modern'
  const complete = (result: Record<string, unknown>) => (modern ? { resultType: 'complete', ...result } : result)

  switch (method) {
    case 'server/discover':
      if (!modern) break
      return respond(200, rpcResult(id, discoverResult(handlers)))

    case 'ping':
      return respond(200, rpcResult(id, complete({})))

    case 'tools/list': {
      const tools = handlers.listTools()
      return respond(200, rpcResult(id, modern
        ? { resultType: 'complete', tools, ttlMs: TOOLS_TTL_MS, cacheScope: 'private' }
        : { tools }))
    }

    case 'tools/call': {
      const { name } = params
      if (typeof name !== 'string' || !name) {
        return respond(200, rpcError(id, RPC_ERROR.INVALID_PARAMS, 'tools/call needs a tool name'))
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        return respond(200, rpcError(id, RPC_ERROR.INVALID_PARAMS, 'tools/call arguments must be an object'))
      }
      const outcome = await handlers.callTool(name, (params.arguments ?? {}) as Record<string, unknown>, context)
      if (outcome.kind === 'unknown_tool') {
        return respond(200, rpcError(id, RPC_ERROR.INVALID_PARAMS, `Unknown tool: ${name}`))
      }
      if (outcome.kind === 'forbidden') {
        return respond(403, rpcError(id, RPC_ERROR.INVALID_REQUEST, outcome.message), outcome.headers)
      }
      return respond(200, rpcResult(id, complete({ ...outcome.result, isError: outcome.result.isError === true })))
    }
  }

  // A modern server answers an unknown method with 404 (so a client can tell
  // it from a legacy one); a legacy one answered 200 with the error.
  return respond(modern ? 404 : 200, rpcError(id, RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`))
}

/**
 * Classifies one parsed message: a request gets a response, a notification or
 * a client's response to us (we never send requests, so there are none to
 * answer) is accepted with 202 and no body.
 */
async function handleMessage(
  message: unknown,
  request: McpHttpRequest,
  handlers: McpHandlers,
  options: { inBatch?: boolean } = {},
): Promise<McpHttpResponse> {
  if (!isObject(message) || message.jsonrpc !== '2.0') {
    return respond(400, rpcError(null, RPC_ERROR.INVALID_REQUEST, 'Not a JSON-RPC 2.0 message'))
  }
  const hasMethod = typeof message.method === 'string' && message.method.length > 0
  if (!hasMethod) {
    if ('result' in message || 'error' in message) return respond(202)
    return respond(400, rpcError(validId(message.id) ? message.id : null, RPC_ERROR.INVALID_REQUEST, 'Missing method'))
  }
  if (!('id' in message) || message.id === undefined) return respond(202) // notification
  if (!validId(message.id)) {
    return respond(400, rpcError(null, RPC_ERROR.INVALID_REQUEST, 'id must be a string or a number'))
  }
  try {
    return await handleRequest(message as unknown as JsonRpcMessage & { id: string | number; method: string }, request, handlers, options)
  } catch (error: any) {
    console.error('[MCP] request failed:', error)
    return respond(200, rpcError(message.id, RPC_ERROR.INTERNAL_ERROR, 'Internal error'))
  }
}

/** The whole `POST /mcp` exchange after authentication. */
export async function handleMcpPost(request: McpHttpRequest, handlers: McpHandlers): Promise<McpHttpResponse> {
  let parsed: unknown
  try {
    parsed = JSON.parse(request.rawBody ?? '')
  } catch {
    return respond(400, rpcError(null, RPC_ERROR.PARSE_ERROR, 'Parse error'))
  }

  if (Array.isArray(parsed)) {
    const headerVersion = request.header('mcp-protocol-version')?.trim()
    if (headerVersion && headerVersion !== HEADERLESS_LEGACY_VERSION) {
      return respond(400, rpcError(null, RPC_ERROR.INVALID_REQUEST, `JSON-RPC batches are not supported in protocol version ${headerVersion}`))
    }
    if (parsed.length === 0) return respond(400, rpcError(null, RPC_ERROR.INVALID_REQUEST, 'Empty batch'))
    const replies: unknown[] = []
    for (const message of parsed) {
      const reply = await handleMessage(message, request, handlers, { inBatch: true })
      if (reply.body !== undefined) replies.push(reply.body)
    }
    return replies.length ? respond(200, replies) : respond(202)
  }

  return handleMessage(parsed, request, handlers)
}
