import { fileURLToPath } from 'url';

const wellKnown = (file: string) => fileURLToPath(new URL(`./server/wellKnown/${file}`, import.meta.url));

// Development: Allow self-signed certificates for local Parse Server
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

//https://nitro.unjs.io/config
export default defineNitroConfig({
  compatibilityDate: '2025-11-20',
  srcDir: "server",
  preset: 'bun',

  // Build optimizations
  minify: true, // Enable minification for smaller output
  sourceMap: true, // Enable source maps for Sentry error tracking

  // Externalize tesseract.js and its core to avoid bundling WASM files
  externals: {
    inline: [
      // External dependencies that should be bundled
    ]
  },

  experimental:{
    openAPI: true,
    tasks: true,
    wasm: true
  },
  
  scheduledTasks: {
    // Run smart sync daily at 2:00 AM (detects and fixes sync issues)
    // '0 2 * * *': ['analytics:smartSync']
    // Purge soft-deleted board records older than 30 days, daily at 3:00 AM
    '0 3 * * *': ['boards:purgeDeleted', 'bookmarks:purgeDeleted', 'boards:purgeNotifications'],
    // Queue a fetch for every RSS feed whose next poll is due
    '*/10 * * * *': ['rss:pollFeeds'],
    // RSS retention, soft-delete purge and unread counter reconciliation
    '0 4 * * *': ['rss:maintenance'],
    // Queue every user backup that is due (and resume stalled ones)
    '20 * * * *': ['backups:dispatch']
  },
  
  openAPI: {
    route: "/_docs/openapi.json",
    ui: {
      scalar: {
        theme: 'purple',
        route: "/_docs/scalar"
      },
      swagger: {
        route: "/_docs/swagger"
      }
    }
  },

  routeRules: {
    '/v1/search/saveToSearchIndex': {
      cors: true,
      cache: false
    },
    '/**': { cors: true }
  },
  
  alias: {
    '#root': fileURLToPath(new URL('./', import.meta.url)),
  },

  // OAuth discovery documents for the MCP server. Registered by hand because
  // route scanning skips dot-directories, so routes/.well-known/ would never
  // be served. See docs/mcp-feature-architecture.md.
  handlers: [
    { route: '/.well-known/oauth-protected-resource/mcp', method: 'get', handler: wellKnown('protectedResourceMcp.ts') },
    { route: '/.well-known/oauth-protected-resource', method: 'get', handler: wellKnown('protectedResource.ts') },
    { route: '/.well-known/oauth-authorization-server', method: 'get', handler: wellKnown('authorizationServer.ts') },
  ],
});
