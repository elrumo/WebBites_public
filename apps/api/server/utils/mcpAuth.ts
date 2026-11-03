import { getHeader, type H3Event } from 'h3'
import { validateApiKey } from './api-keys'
import { getUserWithPlan, getPlanTier } from './plans'
import { initParseForBoards } from './boardUtils'
import { ALL_SCOPES } from './mcpToolCatalogue'
import { mcpResource, mcpResourceMetadataUrl } from './mcpConfig'
import { validateAccessToken } from './oauthStore'
import type { McpCaller } from './mcpTools'

/**
 * Who is calling `/mcp`. Two credentials, both `Authorization: Bearer`:
 *
 * - a WebBites API key (`wb_live_…`), for clients that take a header — full
 *   read and write, like the developer API it comes from;
 * - an OAuth access token (`wbo_at_…`) from our authorization server, for
 *   connectors (claude.ai, ChatGPT…) — scoped to what the user approved.
 *
 * Nothing else is accepted: not the `wb_api_key` cookie (no ambient
 * credentials on an endpoint any origin can call), not Parse sessions, not the
 * internal key. Per the MCP spec a resource server takes only tokens issued
 * for it.
 */

export type McpAuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; status: number; headers: Record<string, string>; body: Record<string, unknown> }

/** The challenge a 401 carries, which is how a client discovers our OAuth server. */
export function unauthorizedChallenge(error?: { code: string; description: string }): string {
  const parts = [`Bearer resource_metadata="${mcpResourceMetadataUrl()}"`, `scope="${ALL_SCOPES.join(' ')}"`]
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description}"`)
  return parts.join(', ')
}

function unauthorized(error?: { code: string; description: string }): McpAuthResult {
  return {
    ok: false,
    status: 401,
    headers: { 'WWW-Authenticate': unauthorizedChallenge(error) },
    body: { error: error?.code ?? 'unauthorized', error_description: error?.description ?? 'Sign in to WebBites to use this server.' },
  }
}

const INVALID_TOKEN = { code: 'invalid_token', description: 'The access token is invalid, expired or revoked' }

/**
 * A credential store being down is not the caller's fault: answering 401 would
 * send the client back through sign-in, over and over, for nothing.
 */
function unavailable(): McpAuthResult {
  return {
    ok: false,
    status: 503,
    headers: { 'Retry-After': '10' },
    body: { error: 'temporarily_unavailable', error_description: 'WebBites could not check your credentials. Try again shortly.' },
  }
}

async function callerFor(userId: string, scopes: Iterable<string>, rateBucket: string, usageField: string): Promise<McpCaller | null> {
  initParseForBoards()
  try {
    const { user, plan } = await getUserWithPlan(userId)
    return { userId, user, tier: getPlanTier(plan), scopes: new Set(scopes), rateBucket, usageField }
  } catch (error: any) {
    // A token that outlived its user (account deleted) is just an invalid token.
    if (error?.statusCode === 400) return null
    throw error
  }
}

export async function authenticateMcpRequest(event: H3Event): Promise<McpAuthResult> {
  const match = (getHeader(event, 'authorization') || '').match(/^Bearer\s+(\S+)\s*$/i)
  if (!match) return unauthorized()
  const token = match[1]

  if (token.startsWith('wb_live_')) {
    let userId: string | null
    try {
      userId = await validateApiKey(token)
    } catch {
      return unavailable()
    }
    if (!userId || userId === 'custom') return unauthorized(INVALID_TOKEN)
    const caller = await callerFor(userId, ALL_SCOPES, `api_rate:${token}`, `key:${token}`)
    return caller ? { ok: true, caller } : unauthorized(INVALID_TOKEN)
  }

  if (token.startsWith('wbo_at_')) {
    let access: Awaited<ReturnType<typeof validateAccessToken>>
    try {
      access = await validateAccessToken(token)
    } catch {
      return unavailable()
    }
    // Audience check (RFC 8707): only tokens issued for this endpoint.
    if (!access || access.resource !== mcpResource()) return unauthorized(INVALID_TOKEN)
    const caller = await callerFor(access.userId, access.scopes, `api_rate:grant:${access.grantId}`, `grant:${access.grantId}`)
    return caller ? { ok: true, caller } : unauthorized(INVALID_TOKEN)
  }

  return unauthorized(INVALID_TOKEN)
}
