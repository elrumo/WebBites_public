/**
 * Everything the /developers pages know about the public API.
 *
 * The landing page, the docs sections and the playground all read from here so
 * a new endpoint or a changed limit is a one-line edit rather than three.
 */

// Where the API lives is a property of the installation, so these are filled in at startup by
// app/plugins/dev-api-origin.ts from the configured backend address (live bindings: importers
// see the updated value).
export let API_BASE_URL = '/v1/api'
export let OPENAPI_URL = '/_docs/scalar'
export let MCP_URL = '/mcp'
export let MCP_RESOURCE_METADATA_URL = '/.well-known/oauth-protected-resource/mcp'

export function setApiOrigin(origin) {
  const base = String(origin || '').replace(/\/+$/, '')
  API_BASE_URL = `${base}/v1/api`
  OPENAPI_URL = `${base}/_docs/scalar`
  MCP_URL = `${base}/mcp`
  MCP_RESOURCE_METADATA_URL = `${base}/.well-known/oauth-protected-resource/mcp`
}

// Mirrors `API_LIMITS` in the backend's `server/utils/publicApi.ts`.
export const RATE_LIMITS = [
  { plan: 'free', perMinute: 60, perMonth: 1000 },
  { plan: 'plus', perMinute: 1000, perMonth: 100000 },
]

export const RATE_LIMIT_HEADERS = [
  { name: 'X-RateLimit-Limit', description: 'Requests allowed in the current window.' },
  { name: 'X-RateLimit-Remaining', description: 'How many you have left in it.' },
  { name: 'X-RateLimit-Reset', description: 'When the window rolls over, as a unix timestamp.' },
  { name: 'Retry-After', description: 'Seconds to wait. Only sent with a 429.' },
]

export const WEBHOOK_EVENTS = ['bookmark.saved']

/**
 * `group` drives the grouping in the endpoint reference; everything else is
 * shared by the reference, the curl samples and the playground.
 */
export const ENDPOINTS = [
  {
    id: 'listBookmarks', method: 'GET', path: '/bookmarks', label: 'GET /bookmarks', group: 'Bookmarks',
    description: 'List your bookmarks, newest first. Page with `nextBefore`.',
    params: [
      { name: 'limit', in: 'query', description: 'max rows (default 50)' },
      { name: 'before', in: 'query', description: 'cursor from a previous nextBefore' },
      { name: 'tag', in: 'query', description: 'only bookmarks with this tag' },
      { name: 'type', in: 'query', description: 'website, article, image, textNote…' },
      { name: 'q', in: 'query', description: 'full-text search' },
    ],
    example: `{
  "bookmarks": [
    { "id": "abc123", "url": "https://example.com", "title": "Example", "type": "website", "tags": ["docs"], "createdAt": "2026-01-02T10:00:00.000Z" }
  ],
  "nextBefore": "2026-01-02T10:00:00.000Z"
}`,
  },
  {
    id: 'getBookmark', method: 'GET', path: '/bookmarks/:id', label: 'GET /bookmarks/:id', group: 'Bookmarks',
    description: 'One bookmark with its summary, tags, note, screenshot and metadata.',
    params: [{ name: 'id', in: 'path', required: true, description: 'bookmark id' }],
    example: `{ "id": "abc123", "url": "https://example.com", "title": "Example", "description": "…", "type": "website", "tags": ["docs"], "note": "", "summary": "…", "image": "https://…", "screenshot": "https://…", "favicon": "https://…", "createdAt": "…" }`,
  },
  {
    id: 'createBookmark', method: 'POST', path: '/bookmarks', label: 'POST /bookmarks', group: 'Bookmarks',
    description: 'Save a URL. Screenshot, summary and auto-tags are generated in the background; a webhook fires when it is done.',
    params: [
      { name: 'url', in: 'body', required: true, description: 'the page to save' },
      { name: 'tags', in: 'body', description: 'comma separated' },
      { name: 'note', in: 'body', description: 'free-text note' },
    ],
    example: `{ "id": "abc123", "url": "https://example.com", "status": "processing" }`,
  },
  {
    id: 'usage', method: 'GET', path: '/usage', label: 'GET /usage', group: 'Account',
    description: 'Your plan, its limits and what you have used this month, per key.',
    params: [],
    example: `{ "tier": "plus", "limits": { "perMinute": 300, "perMonth": 20000 }, "usage": { "month": 412, "total": 9031, "byKey": { "wb_live_…": 412 } } }`,
  },
  {
    id: 'listWebhooks', method: 'GET', path: '/webhooks', label: 'GET /webhooks', group: 'Webhooks',
    description: 'Your webhooks and the events they can subscribe to.',
    params: [],
    example: `{ "webhooks": [ { "id": "wh_1", "url": "https://example.com/hook", "events": ["bookmark.saved"], "description": "", "active": true, "failureCount": 0, "lastStatus": 200, "lastDeliveredAt": "…", "secret": "whsec_…" } ], "events": ["bookmark.saved"] }`,
  },
  {
    id: 'createWebhook', method: 'POST', path: '/webhooks', label: 'POST /webhooks', group: 'Webhooks',
    description: 'Register a webhook. The response includes the signing secret.',
    params: [
      { name: 'url', in: 'body', required: true, description: 'https endpoint to POST to' },
      { name: 'events', in: 'body', description: 'comma separated, default bookmark.saved' },
      { name: 'description', in: 'body', description: 'a label for you' },
    ],
    example: `{ "id": "wh_1", "url": "https://example.com/hook", "events": ["bookmark.saved"], "active": true, "secret": "whsec_…" }`,
  },
  {
    id: 'deleteWebhook', method: 'DELETE', path: '/webhooks/:id', label: 'DELETE /webhooks/:id', group: 'Webhooks',
    description: 'Remove a webhook.',
    params: [{ name: 'id', in: 'path', required: true, description: 'webhook id' }],
    example: `{ "ok": true }`,
  },
  {
    id: 'testWebhook', method: 'POST', path: '/webhooks/:id/test', label: 'POST /webhooks/:id/test', group: 'Webhooks',
    description: 'Send a sample delivery and report the status your endpoint answered with.',
    params: [{ name: 'id', in: 'path', required: true, description: 'webhook id' }],
    example: `{ "ok": true, "status": 200 }`,
  },
]

export const ENDPOINT_GROUPS = ['Bookmarks', 'Account', 'Webhooks']

export const WEBHOOK_PAYLOAD = `{
  "id": "dlv_…",
  "event": "bookmark.saved",
  "createdAt": "2026-01-02T10:00:00.000Z",
  "data": {
    "id": "abc123", "url": "https://example.com", "title": "Example", "description": "…",
    "type": "website", "tags": ["docs"], "note": "", "summary": "…",
    "image": "https://…", "screenshot": "https://…", "favicon": "https://…",
    "createdAt": "2026-01-02T10:00:00.000Z"
  }
}`

export const WEBHOOK_HEADERS = [
  { name: 'X-WebBites-Event', description: 'The event name, e.g. bookmark.saved.' },
  { name: 'X-WebBites-Delivery', description: 'Unique delivery id. Use it to de-duplicate retries.' },
  { name: 'X-WebBites-Signature', description: 'sha256=<hex HMAC-SHA256(secret, raw body)>.' },
]

export const SIGNATURE_SNIPPET = `import crypto from 'node:crypto'

// rawBody must be the untouched request body (a Buffer or string), not re-serialised JSON.
function verify(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return expected.length === signatureHeader.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
}`

/** The fields every bookmark comes back with, for the reference tables. */
export const BOOKMARK_FIELDS = [
  { name: 'id', type: 'string', description: 'Stable id. Use it with GET /bookmarks/:id.' },
  { name: 'url', type: 'string', description: 'The page you saved.' },
  { name: 'title', type: 'string', description: 'Page title, or the one you edited in the app.' },
  { name: 'description', type: 'string', description: 'Meta description pulled from the page.' },
  { name: 'type', type: 'string', description: 'website, article, image, textNote and friends.' },
  { name: 'tags', type: 'string[]', description: 'Yours plus the ones generated for you.' },
  { name: 'note', type: 'string', description: 'Your own note on the bookmark.' },
  { name: 'summary', type: 'string', description: 'Generated summary of the page. Empty while it is still processing.' },
  { name: 'image', type: 'string', description: 'Preview image URL.' },
  { name: 'screenshot', type: 'string', description: 'Full page screenshot URL.' },
  { name: 'favicon', type: 'string', description: 'Site icon URL.' },
  { name: 'createdAt', type: 'string', description: 'ISO 8601 timestamp. Also the pagination cursor.' },
]

export const ERROR_STATUSES = [
  { status: '400', title: 'Bad request', description: 'A parameter is missing or malformed — most often a POST /bookmarks without a url.' },
  { status: '401', title: 'Unauthorized', description: 'No Authorization header, or the key has been revoked. Check the header reads Bearer wb_live_….' },
  { status: '403', title: 'Forbidden', description: 'The key is valid but the resource belongs to another account.' },
  { status: '404', title: 'Not found', description: 'No bookmark or webhook with that id on your account.' },
  { status: '429', title: 'Too many requests', description: 'You hit the per-minute or per-month limit. Wait for Retry-After and try again.' },
  { status: '5xx', title: 'Server error', description: 'Our side. Retry with backoff — the request was not necessarily discarded.' },
]

/** Substitute path params and split the rest into query / body. */
export const buildRequest = (ep, values = {}) => {
  let path = ep.path
  const query = {}
  const body = {}
  for (const p of ep.params) {
    const v = values[p.name]
    if (p.in === 'path') path = path.replace(`:${p.name}`, encodeURIComponent(v || `{${p.name}}`))
    else if (v) {
      const parsed = (p.name === 'tags' || p.name === 'events') ? v.split(',').map(s => s.trim()).filter(Boolean) : v
      ;(p.in === 'query' ? query : body)[p.name] = parsed
    }
  }
  const qs = new URLSearchParams(query).toString()
  return { path: path + (qs ? `?${qs}` : ''), body: Object.keys(body).length ? body : null }
}

/** A copy-pasteable curl for an endpoint, with placeholder values filled in. */
export const curlFor = (ep) => {
  const sample = {}
  for (const p of ep.params) {
    if (p.in === 'path') sample[p.name] = 'abc123'
    else if (p.required) sample[p.name] = 'https://example.com'
  }
  const { path, body } = buildRequest(ep, sample)
  let cmd = `curl ${ep.method !== 'GET' ? `-X ${ep.method} ` : ''}${API_BASE_URL}${path} \\\n  -H "Authorization: Bearer $WEBBITES_KEY"`
  if (body) cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`
  return cmd
}

export const methodColor = (method) =>
  method === 'GET' ? 'success' : method === 'DELETE' ? 'error' : 'primary'

/* ── MCP: the server AI assistants connect to ─────────────────────────────── */

// The MCP endpoint (Streamable HTTP), see MCP_URL above. Signs in with OAuth, or takes an
// API key as a bearer token from clients that let you set headers.

// What an OAuth connection can be granted. Read is always part of an approval;
// write is the "Allow changes" switch on the consent page.
export const MCP_SCOPES = [
  { name: 'bookmarks:read', description: 'Search and read bookmarks, boards and tags.' },
  { name: 'bookmarks:write', description: 'Save links and notes, edit bookmarks, create and fill boards, and move bookmarks to the trash.' },
]

/**
 * The tools both MCP servers expose — the cloud one at MCP_URL and the Mac
 * app's local one — copied from the tool contract, `docs/mcp-tools.json` in
 * webbites-backend and webbites-native. Names, titles, descriptions,
 * annotations and arguments are as the contract has them; only the argument
 * notes are shortened for the docs table. When a tool changes there, change it
 * here too.
 */
export const MCP_TOOLS = [
  {
    name: 'search_bookmarks',
    title: 'Search bookmarks',
    write: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Search the user\'s WebBites library (links, notes, images, PDFs, audio). With no query it lists the most recent bookmarks. Results are summaries; call get_bookmark for the full record.',
    args: [
      { name: 'query', type: 'string', description: 'Words to look for in titles, descriptions, notes, page text and tags. The cloud library also matches by meaning.' },
      { name: 'tags', type: 'string[]', description: 'Only bookmarks carrying every one of these tags.' },
      { name: 'type', type: 'string', description: 'Only bookmarks of this kind: website, textNote, drawing, image, movie, game, music, pdf or audio.' },
      { name: 'saved_after', type: 'date-time', description: 'Only bookmarks saved at or after this time (ISO 8601).' },
      { name: 'saved_before', type: 'date-time', description: 'Only bookmarks saved before this time (ISO 8601).' },
      { name: 'sort', type: 'string', description: 'relevance, newest or oldest. Defaults to relevance with a query, newest without.' },
      { name: 'limit', type: 'integer', description: '1–50, default 20.' },
      { name: 'cursor', type: 'string', description: 'next_cursor from the previous page.' },
    ],
  },
  {
    name: 'get_bookmark',
    title: 'Get a bookmark',
    write: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Fetch one bookmark by id: its notes, tags, AI summary, the boards it is in and, with include_content, the saved page text.',
    args: [
      { name: 'id', type: 'string', required: true, description: 'The bookmark\'s id.' },
      { name: 'include_content', type: 'boolean', description: 'Also return the page\'s saved reader text, when there is one. Default false.' },
      { name: 'max_chars', type: 'integer', description: 'Cap on the returned page text: 500–20,000, default 8,000.' },
    ],
  },
  {
    name: 'list_boards',
    title: 'List boards',
    write: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List the user\'s boards (collections), including nested ones, with how many bookmarks each holds.',
    args: [],
  },
  {
    name: 'list_board_bookmarks',
    title: 'List a board\'s bookmarks',
    write: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List the bookmarks in one board, newest first.',
    args: [
      { name: 'board_id', type: 'string', required: true, description: 'The board\'s id.' },
      { name: 'limit', type: 'integer', description: '1–50, default 20.' },
      { name: 'cursor', type: 'string', description: 'next_cursor from the previous page.' },
    ],
  },
  {
    name: 'list_tags',
    title: 'List tags',
    write: false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List the tags in use, most used first, with counts. With a query, only tags containing it.',
    args: [
      { name: 'query', type: 'string', description: 'Only tags containing this.' },
      { name: 'limit', type: 'integer', description: '1–200, default 50.' },
    ],
  },
  {
    name: 'save_bookmark',
    title: 'Save a link',
    write: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: 'Save a web page to the library. WebBites fetches the page and fills in its title, image and summary in the background. Saving a URL that is already saved returns the existing bookmark.',
    args: [
      { name: 'url', type: 'string', required: true, description: 'An http(s) URL.' },
      { name: 'tags', type: 'string[]', description: 'Tags to add, up to 20.' },
      { name: 'note', type: 'string', description: 'A note to keep with the bookmark.' },
      { name: 'board_id', type: 'string', description: 'Also add it to this board.' },
    ],
  },
  {
    name: 'save_note',
    title: 'Save a note',
    write: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Save a plain-text note to the library as a note bite.',
    args: [
      { name: 'text', type: 'string', required: true, description: 'The note, up to 50,000 characters.' },
      { name: 'title', type: 'string', description: 'A title for it.' },
      { name: 'tags', type: 'string[]', description: 'Tags to add, up to 20.' },
    ],
  },
  {
    name: 'update_bookmark',
    title: 'Edit a bookmark',
    write: true,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Change a bookmark\'s title, note, tags or pin. Only the fields given change. tags replaces every tag; add_tags and remove_tags edit the existing list. An empty note clears it.',
    args: [
      { name: 'id', type: 'string', required: true, description: 'The bookmark\'s id.' },
      { name: 'title', type: 'string', description: 'A new title.' },
      { name: 'note', type: 'string', description: 'A new note. An empty one clears it.' },
      { name: 'tags', type: 'string[]', description: 'Replaces every tag.' },
      { name: 'add_tags', type: 'string[]', description: 'Tags to add to the existing ones.' },
      { name: 'remove_tags', type: 'string[]', description: 'Tags to take off.' },
      { name: 'pinned', type: 'boolean', description: 'Pin or unpin it.' },
    ],
  },
  {
    name: 'create_board',
    title: 'Create a board',
    write: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Create a board (collection), optionally inside another board.',
    args: [
      { name: 'name', type: 'string', required: true, description: 'The board\'s name.' },
      { name: 'description', type: 'string', description: 'What it is for.' },
      { name: 'parent_id', type: 'string', description: 'Nest it inside this board.' },
    ],
  },
  {
    name: 'add_to_board',
    title: 'Add to a board',
    write: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Add bookmarks to a board. Bookmarks already in it are left as they are.',
    args: [
      { name: 'bookmark_ids', type: 'string[]', required: true, description: '1–50 bookmark ids.' },
      { name: 'board_id', type: 'string', required: true, description: 'The board to add them to.' },
    ],
  },
  {
    name: 'delete_bookmark',
    title: 'Move a bookmark to the trash',
    write: true,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Move one bookmark to the trash. The user can restore it from the trash in WebBites for 30 days. Confirm with the user before calling this.',
    args: [
      { name: 'id', type: 'string', required: true, description: 'The bookmark\'s id. One per call.' },
    ],
  },
]
