import { defineEventHandler, setResponseHeaders } from 'h3'
import { protectedResourceMetadata } from '#root/server/utils/oauthRules'
import { mcpIssuer, websiteUrl } from '#root/server/utils/mcpConfig'

/**
 * The root-level protected resource metadata, for clients that look here
 * before (or instead of) the path-specific `/mcp` document. Tokens requested
 * for this origin are bound to the MCP endpoint all the same.
 */
export default defineEventHandler((event) => {
  setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' })
  return protectedResourceMetadata(mcpIssuer(), mcpIssuer(), websiteUrl())
})
