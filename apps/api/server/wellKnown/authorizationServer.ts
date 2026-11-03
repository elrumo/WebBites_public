import { defineEventHandler, setResponseHeaders } from 'h3'
import { authorizationServerMetadata } from '#root/server/utils/oauthRules'
import { mcpIssuer, websiteUrl } from '#root/server/utils/mcpConfig'

/** RFC 8414 metadata for the WebBites authorization server (MCP sign-in). */
export default defineEventHandler((event) => {
  setResponseHeaders(event, { 'Cache-Control': 'public, max-age=3600' })
  return authorizationServerMetadata(mcpIssuer(), websiteUrl())
})
