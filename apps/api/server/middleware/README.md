# Middleware Architecture

This directory contains the authentication and security middleware for the application. Each middleware file has a specific responsibility and runs in alphabetical order (Nitro convention).

## Execution Order

Middleware files execute in **alphabetical order** by filename:

1. `api-key.ts` - API key validation for `/v1/*` routes
2. `api-rate-limit.ts` - Rate limiting for API routes
3. `audio-auth.ts` - Token validation for `/streamAudio`
4. `basic-auth.ts` - Basic HTTP auth for remaining protected routes
5. `cors.ts` - CORS headers for cross-origin requests
6. `parse-auth.ts` - Parse session validation for search/extension routes
7. `rate-limit.ts` - General rate limiting
8. `stripe-webhook.ts` - Stripe webhook signature verification

## Middleware Responsibilities

### API Key Authentication (`api-key.ts`)
- **Routes**: `/v1/*`
- **Method**: All
- **Purpose**: Validates API keys from Authorization header or cookies
- **Context**: Attaches `event.context.apiKey` with user info

### API Rate Limiting (`api-rate-limit.ts`)
- **Routes**: All, except `/_docs/*`, `/_nitro/*`, `/_openapi/*`, `/health`, `/favicon.ico` and `OPTIONS` preflights
- **Purpose**: Coarse per-caller abuse backstop, counted in Redis over a fixed window
- **Bucket**: The request's API key when it has one, otherwise the client IP taken from `X-Forwarded-For`/`X-Real-IP` (every production request arrives through nginx, so the socket address is the proxy's)
- **Config**: `RATE_LIMIT_MAX` (default 1200) and `RATE_LIMIT_WINDOW_SECONDS` (default 60)
- **Fails open**: Redis being unavailable allows the request
- **Not the developer API's limit**: `/v1/api/*` is metered per key and per plan tier in `server/utils/publicApi.ts`; this default sits above the highest tier's allowance so it never cuts underneath it
- **Dependencies**: `server/utils/rateLimitTarget.ts` (exemptions and client IP resolution)

### Audio Authentication (`audio-auth.ts`)
- **Routes**: `/streamAudio`
- **Method**: All
- **Purpose**: Validates HMAC-signed tokens for audio streaming
- **Dependencies**: `server/utils/audio-auth.ts`

### Basic Authentication (`basic-auth.ts`)
- **Routes**: All POST routes except those with dedicated middleware
- **Method**: POST only
- **Purpose**: Fallback basic HTTP authentication
- **Skips**: `/v1/*`, `/auth/*`, and routes with dedicated middleware

### CORS (`cors.ts`)
- **Routes**: All
- **Purpose**: Sets appropriate CORS headers based on origin
- **Features**: Chrome extension support, environment-aware

### Parse Session Authentication (`parse-auth.ts`)
- **Routes**: `/search`, `/isPageSaved`, `/extension-auth`
- **Method**: POST only
- **Purpose**: Validates Parse session tokens
- **Context**: Attaches `event.context.body` with user info
- **Dependencies**: `server/utils/raycast-auth.js`

### Rate Limiting (`rate-limit.ts`)
- **Routes**: `/extension-auth`, `/search`
- **Purpose**: In-memory rate limiting for high-traffic endpoints

### Stripe Webhook (`stripe-webhook.ts`)
- **Routes**: `/api/v1/confirmPayment`
- **Method**: POST only
- **Purpose**: Verifies Stripe webhook signatures and forwards to internal handler
- **Dependencies**: `server/utils/stripe-auth.ts`

## Helper Utilities

### `server/utils/audio-auth.ts`
- `verifyAudioToken(token)` - HMAC token verification

### `server/utils/rateLimitTarget.ts`
- `isRateLimitExempt(path, method)` - Docs, health check and preflights skip rate limiting
- `resolveClientIp(headers, socketAddress)` - The caller's own address behind the load balancer
- `rateLimitIdentifier(apiKey, clientIp)` - The Redis bucket a request counts against
- `bearerToken(authorization)` - The bearer token on the request, if any
- Tests: `npm run test:rateLimitTarget`

### `server/utils/extension-auth.ts`
- `verifyExtensionOrigin(origin)` - Chrome extension origin verification

### `server/utils/stripe-auth.ts`
- `verifyStripeWebhook(event)` - Stripe signature verification

### `server/utils/raycast-auth.js`
- `validateParseToken(event)` - Parse session validation
- `requireRaycastAuth(event)` - Parse auth with context attachment

## Design Principles

1. **Single Responsibility**: Each middleware handles one concern
2. **Early Exit**: Middleware returns early if route doesn't match
3. **Error Propagation**: Uses `createError` for consistent error handling
4. **Context Enrichment**: Attaches user data to `event.context` for routes
5. **Reusable Utilities**: Auth logic extracted to utils for testability

## Adding New Middleware

When adding new middleware:

1. Create a focused file with a clear responsibility
2. Use early returns for routes that don't match
3. Extract complex logic to `server/utils/`
4. Consider alphabetical execution order (rename if needed)
5. Update this README with the new middleware
6. Add appropriate error handling

## Testing

To test middleware execution:

```bash
# Start dev server
npm run dev

# Test API key auth
curl -H "Authorization: Bearer your-api-key" http://localhost:3000/v1/example

# Test Parse auth
curl -H "Authorization: Bearer parse-session-token" -X POST http://localhost:3000/search

# Test audio auth
curl http://localhost:3000/streamAudio?token=your-token
```

## Not middleware: API metrics

`server/plugins/api-metrics.ts` times every `/v1/api/*` request in Nitro's `request`/`afterResponse` hooks and counts it into hourly Redis hashes (`server/utils/apiMetrics.ts`). Admins read them at `GET /v1/admin/api-metrics?hours=168`.
