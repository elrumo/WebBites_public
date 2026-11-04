/**
 * Which credential a /v1/* path needs. Pure, so it can be tested without h3.
 * Consumed by server/middleware/api-key.ts.
 */

const PUBLIC = [
  '/v1/auth',
  '/v1/search/saveToSearchIndex',
  '/v1/public',
  '/v1/audio/streamAudio',
]

/**
 * Routes a deployment adds that authenticate themselves (a payment provider's webhook, say).
 * Call once at startup, from a Nitro plugin. Takes /v1/ prefixes only.
 */
export function registerPublicPrefixes(...prefixes: string[]): void {
  for (const prefix of prefixes) {
    if (!prefix.startsWith('/v1/') || prefix === '/v1/') throw new Error(`Not a /v1/ prefix: ${prefix}`)
    if (!PUBLIC.includes(prefix)) PUBLIC.push(prefix)
  }
}

const INTERNAL_ONLY = [
  '/v1/dev',
  '/v1/sync',
  '/v1/triggers',
  '/v1/search/dev',
  '/v1/content',
  '/v1/import',
  '/v1/example',
  '/v1/jobs',
]

// Carve-outs from INTERNAL_ONLY that clients call with their own credentials.
const USER_CALLABLE = [
  '/v1/content/getPageContent',
  '/v1/content/getAiSummary',
  '/v1/content/saveNote',
  '/v1/content/startSaveProcess',
  '/v1/content/enrichBookmark',
  '/v1/import/connect',
]

/**
 * Root (non-/v1) routes predate the /v1 gate. The default for them is
 * 'internal', so a legacy route can never sit wide open merely because nobody
 * remembered to list it — which is how /batchDelete, /removeDuplicates,
 * /setACL, /sendEmail and /saveUser* ended up reachable with no credential at
 * all while trusting a userId from the request body.
 *
 * Only the two lists below are reachable without the internal key. Anything
 * added under server/routes/ from now on needs a deliberate entry here.
 */

// No credential required. Each either exposes nothing, or authenticates itself:
// /qstash-webhook verifies the Upstash signature, and the three session routes
// verify the very token they are handed (they are the login/logout exchange, so
// they cannot require an already-authenticated caller).
// NB: never put '' in here — `under` would then match every path via its
// `startsWith(p + '/')` branch. The index route is handled on its own below.
const ROOT_PUBLIC = [
  '/health',
  '/test',
  '/keepAwake',
  '/cors-preflight',
  '/qstash-webhook',
  '/extension-auth',
  '/verify-extension-token',
  '/deleteSession',
  // The MCP server and its OAuth authorization server. /mcp checks its own
  // bearer token and must answer a missing one with a WWW-Authenticate
  // challenge, which this gate doesn't send; /oauth/* is the sign-in flow
  // itself (client authentication, PKCE, single-use codes); /.well-known/*
  // is public metadata. See docs/mcp-feature-architecture.md.
  '/mcp',
  '/oauth',
  '/.well-known',
]

// Clients call these directly with their own credential, and each handler
// already derives the acting user from that credential rather than the body.
const ROOT_USER = [
  '/isPageSaved',
  '/raycast',
  '/raycast-user',
  '/saveUserImage',
  '/saveUserPdf',
  '/saveUserAudio',
]

// Match on a normalised path so `/V1//content/x/` can't slip past a prefix.
export const norm = (p: string) => p.toLowerCase()
const under = (path: string, prefixes: string[]) =>
  prefixes.some(p => { p = norm(p); return path === p || path.startsWith(p + '/') })

// OAuth providers redirect the browser here; the handler checks `state`.
const isOAuthCallback = (path: string) =>
  /^\/v1\/(backups|import)\/connect\/[^/]+\/callback$/.test(path)

export type RouteAccess = 'none' | 'public' | 'internal' | 'user'

/** `path` must already be normalised by normalisePath. */
export function routeAccess(path: string): RouteAccess {
  if (!path.startsWith('/v1/')) {
    if (path === '' || under(path, ROOT_PUBLIC)) return 'public' // '' is `/`
    if (under(path, ROOT_USER)) return 'user'
    return 'internal'
  }
  if (under(path, PUBLIC) || isOAuthCallback(path)) return 'public'
  if (under(path, INTERNAL_ONLY) && !under(path, USER_CALLABLE)) return 'internal'
  return 'user'
}

/** Lowercase, decode, collapse `//`, drop trailing `/`. Throws on bad encoding. */
export function normalisePath(pathname: string): string {
  return norm(decodeURIComponent(pathname)).replace(/\/{2,}/g, '/').replace(/\/$/, '')
}
