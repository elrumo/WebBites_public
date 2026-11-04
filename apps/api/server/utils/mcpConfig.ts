import { siteUrl } from '#root/server/utils/site';
/**
 * Where the MCP server and its authorization server live. Read from the
 * environment, never from the request's Host header: these URLs end up in
 * OAuth metadata and token audiences, and a forged Host must not move them.
 */

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/** The OAuth issuer, and the origin the MCP endpoint is served from. */
export function mcpIssuer(): string {
  return trimSlash(process.env.MCP_ISSUER || process.env.VITE_BACKEND_URL || 'http://localhost:3003')
}

/** The MCP server's canonical URI: the `resource` tokens are issued for (RFC 8707). */
export function mcpResource(): string {
  return `${mcpIssuer()}/mcp`
}

/** The protected resource metadata document for `/mcp` (RFC 9728). */
export function mcpResourceMetadataUrl(): string {
  return `${mcpIssuer()}/.well-known/oauth-protected-resource/mcp`
}

/** The website, where the consent page and the bookmark deep links live. */
export function websiteUrl(): string {
  return siteUrl()
}

export const MCP_SERVER_NAME = 'webbites'
export const MCP_SERVER_TITLE = 'WebBites'
export const MCP_SERVER_VERSION = '1.0.0'
