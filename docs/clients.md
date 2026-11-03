# Browser extension and native apps

The server side is ready: every endpoint the clients use is on your domain (`/v1/*`, `/extension-auth`,
`/verify-extension-token`, `/oauth/*`, `/mcp`, and Parse under `/parse`).

The official **browser extension** and the **iOS and macOS apps** are separate projects and, at the
time of writing, are built against WebBites.io. To use them with your server they need a setting for the
server address (the base URL for the API, and for Parse: your domain and `https://your.domain/parse`).
That change belongs in those projects; until it exists you can use the web app (it installs as a PWA) and
the public API / MCP server directly.

For your own tools: create a developer API key in the app (the Developers page, /developers) and call
`https://your.domain/v1/api/...`; the OpenAPI reference is at `https://your.domain/_docs/scalar`.
MCP clients connect to `https://your.domain/mcp`.
