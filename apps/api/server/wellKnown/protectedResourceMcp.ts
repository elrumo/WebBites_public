import { defineEventHandler, setResponseHeaders } from 'h3'
import { protectedResourceMetadata } from '#root/server/utils/oauthRules'
import { mcpIssuer, mcpResource, websiteUrl } from '#root/server/utils/mcpConfig'

/**
 * RFC 9728 protected resource metadata for the MCP endpoint — where a client
 * lands from the WWW-Authenticate challenge on a 401 from `/mcp`, and learns
 * which authorization server to sign in with.
 */
export default defineEventHandler((event) => {
  setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' })
  return protectedResourceMetadata(mcpResource(), mcpIssuer(), websiteUrl())
})
