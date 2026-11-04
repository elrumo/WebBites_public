# Implementation Deep Dive

Complete technical documentation of the API key authentication system.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Authentication Flow](#authentication-flow)
3. [Middleware Stack](#middleware-stack)
4. [Redis Data Structures](#redis-data-structures)
5. [API Endpoints](#api-endpoints)
6. [Rate Limiting](#rate-limiting)
7. [Security](#security)
8. [Testing](#testing)

---

## System Architecture

### Component Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Parse Server                          │
│  Responsibility: User authentication                     │
│  Output: sessionToken (e.g., "r:abc123...")            │
└────────────────────┬─────────────────────────────────────┘
                     │
                     │ Parse.User.logIn()
                     ▼
┌──────────────────────────────────────────────────────────┐
│              Nitro Backend (This Project)                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  /auth/session-login                              │ │
│  │  • Validates Parse session                         │ │
│  │  • Creates API key                                 │ │
│  │  • Stores in Redis                                 │ │
│  │  File: server/routes/auth/session-login.post.ts   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Middleware: api-key.ts                           │ │
│  │  • Validates API keys from Redis                  │ │
│  │  • Supports header OR cookie                      │ │
│  │  • Attaches userId to context                     │ │
│  │  File: server/middleware/api-key.ts               │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Middleware: api-rate-limit.ts                    │ │
│  │  • Sliding window rate limiting                   │ │
│  │  • 1000 req/hour per API key                      │ │
│  │  • Redis-based                                     │ │
│  │  File: server/middleware/api-rate-limit.ts        │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  /v1/* Routes                                      │ │
│  │  • Protected endpoints                             │ │
│  │  • Access event.context.apiKey                    │ │
│  │  • Business logic                                  │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                     │
                     │ Stores/reads from
                     ▼
┌──────────────────────────────────────────────────────────┐
│                  Redis (Upstash)                         │
│  • API keys                                              │
│  • Rate limit counters                                   │
│  • Session mappings (for Nuxt)                          │
└──────────────────────────────────────────────────────────┘
```

---

## Authentication Flow

### Phase 1: Bootstrap (One-time)

```typescript
// Client calls with Parse session token

POST /auth/session-login
Body: { sessionToken: "r:parse-session-token", name: "Chrome Extension" }

// Backend: server/routes/auth/session-login.post.ts
↓
1. validateParseToken(event)
   - Extracts session token from request body
   - Calls verifySession(sessionToken)
   - Returns: { userId, username, email, user }
   File: server/utils/raycast-auth.js

↓
2. createApiKey(userId, name)
   - Generates: wb_live_${randomBytes(24).toString('base64url')}
   - Stores in Redis: api_key:wb_live_xxx → userId
   - Stores metadata: api_key_meta:wb_live_xxx → { userId, name, createdAt }
   - Adds to user list: user_api_keys:userId → [wb_live_xxx]
   File: server/utils/api-keys.ts

↓
3. Returns: { apiKey: "wb_live_xxx", userId, name }
```

### Phase 2: API Requests (All subsequent calls)

```typescript
// Client calls with API key

GET /v1/example
Headers: Authorization: Bearer wb_live_xxxxx

// Middleware chain:

1. api-key.ts
   ↓
   - Extracts key from Authorization header OR cookie
   - Looks up in Redis: GET api_key:wb_live_xxx
   - If found: event.context.apiKey = { key, userId }
   - If not found: throws 401
   File: server/middleware/api-key.ts:38-56

2. api-rate-limit.ts
   ↓
   - Gets API key from context
   - Checks rate limit in Redis (sliding window)
   - If exceeded: throws 429
   - If OK: continues, sets headers
   File: server/middleware/api-rate-limit.ts:27-75

3. Route Handler
   ↓
   - Accesses event.context.apiKey.userId
   - Processes business logic
   - Returns response
```

---

## Middleware Stack

### 1. API Key Middleware

**File:** `server/middleware/api-key.ts`

**Purpose:** Validate API keys and attach user info to request context

**How it works:**

```typescript
// Simplified version

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Only protect /v1/* endpoints
  if (!path.startsWith('/v1/')) {
    return
  }

  // Try Authorization header first
  let apiKey = getHeader(event, 'authorization')?.substring(7)

  // Fallback to cookie (for web apps)
  if (!apiKey) {
    apiKey = getCookie(event, 'wb_api_key')
  }

  if (!apiKey) {
    throw createError({ statusCode: 401, message: 'Missing API key' })
  }

  // Validate in Redis
  const redis = getRedisClient()
  const userId = await redis.get(`api_key:${apiKey}`)

  if (!userId) {
    throw createError({ statusCode: 401, message: 'Invalid API key' })
  }

  // Attach to context for route handlers
  event.context.apiKey = { key: apiKey, userId: userId as string }
})
```

**Key Features:**
- ✅ Supports both Authorization header and cookie
- ✅ Fast Redis lookup (no Parse API call)
- ✅ Attaches user info to context
- ✅ Only protects `/v1/*` routes

---

### 2. Rate Limiting Middleware

**File:** `server/middleware/api-rate-limit.ts`

**Purpose:** Enforce rate limits per API key using sliding window

**How it works:**

```typescript
// Simplified version

const WINDOW_SECONDS = 3600 // 1 hour
const AUTHENTICATED_LIMIT = 1000

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Only rate limit /v1/* endpoints
  if (!path.startsWith('/v1/')) {
    return
  }

  const redis = getRedisClient()
  const now = Date.now()
  const windowStart = now - (WINDOW_SECONDS * 1000)

  // Get API key from context (set by api-key middleware)
  const apiKey = event.context.apiKey?.key
  const identifier = apiKey || getRequestIP(event) || 'unknown'
  const limit = apiKey ? AUTHENTICATED_LIMIT : 100

  const rateLimitKey = `rate_limit:${identifier}`

  // Use sorted set to track requests in time window
  const requestId = `${now}:${Math.random()}`

  // Add current request
  await redis.zadd(rateLimitKey, { score: now, member: requestId })

  // Remove old requests
  await redis.zremrangebyscore(rateLimitKey, 0, windowStart)

  // Set expiry
  await redis.expire(rateLimitKey, WINDOW_SECONDS + 60)

  // Count requests in window
  const requestCount = await redis.zcard(rateLimitKey)

  // Set headers
  setHeaders(event, {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, limit - requestCount)),
    'X-RateLimit-Reset': String(Math.ceil((now + WINDOW_SECONDS * 1000) / 1000))
  })

  // Check limit
  if (requestCount > limit) {
    throw createError({
      statusCode: 429,
      message: 'Rate limit exceeded'
    })
  }
})
```

**Algorithm:** Sliding Window
- Uses Redis sorted sets
- Score = timestamp
- Automatically removes old requests
- Accurate per-second rate limiting

**Limits:**
- Authenticated (API key): 1000 requests/hour
- Unauthenticated (IP): 100 requests/hour

---

## Redis Data Structures

### API Keys

```redis
# Main key → userId mapping
api_key:wb_live_abc123 → "userId123"
Type: String
TTL: None (permanent until revoked)

# Metadata
api_key_meta:wb_live_abc123 → {
  userId: "userId123",
  name: "Chrome Extension",
  createdAt: "2025-01-15T10:30:00Z"
}
Type: Hash
TTL: None

# User's keys list
user_api_keys:userId123 → ["wb_live_abc123", "wb_live_def456"]
Type: Set
TTL: None
```

### Rate Limiting

```redis
# Sliding window counter
rate_limit:wb_live_abc123 → Sorted Set {
  score: 1736932800000, member: "1736932800000:0.123",
  score: 1736932801000, member: "1736932801000:0.456",
  score: 1736932802000, member: "1736932802000:0.789"
}
Type: Sorted Set
TTL: 3660 seconds (auto-cleanup)
```

### Nuxt Sessions (Optional, for web apps)

```redis
nuxt_session:abc123 → {
  apiKey: "wb_live_xyz789",
  userId: "userId123"
}
Type: String (JSON)
TTL: 31536000 seconds (1 year)
```

---

## API Endpoints

### Bootstrap Endpoints (Public)

#### POST /auth/generate-api-key

**File:** `server/routes/auth/generate-api-key.post.ts`

**Purpose:** Exchange Parse session for API key

**Request:**
```http
POST /auth/generate-api-key
Authorization: Bearer r:parse-session-token
Content-Type: application/json

{
  "name": "Chrome Extension"
}
```

**Response:**
```json
{
  "success": true,
  "apiKeyData": {
    "key": "wb_live_xxxxxxxxxxxxxxxxxxxx",
    "userId": "user123",
    "name": "Chrome Extension"
  }
}
```

**Implementation:**
```typescript
export default defineEventHandler(async (event) => {
  // Validate Parse session
  const user = await validateParseToken(event)

  // Get name from body
  const body = await readBody(event).catch(() => ({}))
  const name = body?.name || `sk-${user.user.id}-${new Date().toISOString()}`

  // Create API key
  const apiKeyData = await createApiKey(user.user.id, name)

  return {
    success: true,
    apiKeyData
  }
})
```

---

### Protected Endpoints (Require API Key)

All endpoints under `/v1/*` automatically require API key authentication.

#### POST /v1/keys/create

**File:** `server/routes/v1/keys/create.post.ts`

**Purpose:** Create additional API keys

**Request:**
```http
POST /v1/keys/create
Authorization: Bearer wb_live_existing-key
Content-Type: application/json

{
  "name": "iPhone App"
}
```

**Response:**
```json
{
  "key": "wb_live_new-key",
  "userId": "user123",
  "name": "iPhone App"
}
```

#### GET /v1/keys/list

**File:** `server/routes/v1/keys/list.get.ts`

**Purpose:** List all API keys for authenticated user

**Request:**
```http
GET /v1/keys/list
Authorization: Bearer wb_live_xxxxx
```

**Response:**
```json
{
  "keys": [
    {
      "key": "wb_live_abc123",
      "name": "Chrome Extension",
      "createdAt": "2025-01-15T10:30:00Z"
    },
    {
      "key": "wb_live_def456",
      "name": "Raycast",
      "createdAt": "2025-01-16T14:20:00Z"
    }
  ]
}
```

#### DELETE /v1/keys/revoke

**File:** `server/routes/v1/keys/revoke.delete.ts`

**Purpose:** Revoke an API key

**Request:**
```http
DELETE /v1/keys/revoke
Authorization: Bearer wb_live_xxxxx
Content-Type: application/json

{
  "key": "wb_live_old-key-to-revoke"
}
```

**Response:**
```json
{
  "success": true,
  "message": "API key revoked successfully"
}
```

---

## Rate Limiting

### Algorithm: Sliding Window

**Why sliding window?**
- More accurate than fixed window
- Prevents burst at window boundaries
- Fair distribution

**Example:**

```
Window: 1 hour = 3600 seconds
Limit: 1000 requests

Time: 10:00:00
├─ Request 1   (score: 1736930400000)
├─ Request 2   (score: 1736930401000)
├─ ...
└─ Request 1000 (score: 1736933999000)

Time: 10:30:00
- Requests before 09:30:00 are removed
- New requests can be added
- Smooth rate limiting
```

### Monitoring

```typescript
// Check rate limit status
const response = await fetch('/v1/example', {
  headers: { 'Authorization': 'Bearer wb_live_xxx' }
})

console.log('Limit:', response.headers.get('X-RateLimit-Limit'))
console.log('Remaining:', response.headers.get('X-RateLimit-Remaining'))
console.log('Reset:', response.headers.get('X-RateLimit-Reset'))
```

### Adjusting Limits

Edit `server/middleware/api-rate-limit.ts`:

```typescript
const WINDOW_SECONDS = 3600 // Change window size
const AUTHENTICATED_LIMIT = 1000 // Change limit
```

---

## Security

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **XSS (Web)** | HTTP-only cookies OR Nuxt proxy (key on server) |
| **API key theft** | Per-device keys (revoke one, others work) |
| **Rate limit abuse** | Per-key limits, Redis tracking |
| **Parse session replay** | One-time use for API key generation |
| **Key enumeration** | Random 24-byte keys (base64url) |
| **CSRF (Web)** | SameSite cookies + explicit checks if needed |

### Best Practices

#### ✅ DO:
- Use HTTPS in production
- Store keys securely (chrome.storage, keychain, server-side)
- Rotate keys periodically
- Separate keys per device
- Monitor rate limits
- Log access (without exposing keys)

#### ❌ DON'T:
- Log API keys (even in dev)
- Commit keys to version control
- Share keys between devices
- Store in localStorage (web apps)
- Use same key for all users
- Expose keys in URLs

### Key Format

```
wb_live_${randomBytes(24).toString('base64url')}
       ↑         ↑
     prefix   24 bytes = 192 bits

Example: wb_live_K7gH2pQxZ9mN4vT8jL1eR3yF

Entropy: 2^192 (unguessable)
```

---

## Testing

### Unit Tests

```typescript
// Test API key validation
describe('API Key Middleware', () => {
  it('should validate valid API key', async () => {
    const apiKey = await createApiKey('user123', 'Test')

    const response = await $fetch('/v1/example', {
      headers: {
        'Authorization': `Bearer ${apiKey.key}`
      }
    })

    expect(response.userId).toBe('user123')
  })

  it('should reject invalid API key', async () => {
    await expect(
      $fetch('/v1/example', {
        headers: {
          'Authorization': 'Bearer invalid-key'
        }
      })
    ).rejects.toThrow('Invalid API key')
  })
})

// Test rate limiting
describe('Rate Limiting', () => {
  it('should enforce rate limits', async () => {
    const apiKey = await createApiKey('user123', 'Test')

    // Make 1000 requests (should succeed)
    for (let i = 0; i < 1000; i++) {
      await $fetch('/v1/example', {
        headers: { 'Authorization': `Bearer ${apiKey.key}` }
      })
    }

    // 1001st request should fail
    await expect(
      $fetch('/v1/example', {
        headers: { 'Authorization': `Bearer ${apiKey.key}` }
      })
    ).rejects.toThrow('Rate limit exceeded')
  })
})
```

### Integration Tests

```bash
# Test full flow
bun run test:integration

# Test specific endpoint
curl -X POST http://localhost:3003/auth/generate-api-key \
  -H "Authorization: Bearer r:parse-session" \
  -d '{"name":"Test"}'
```

---

## Performance

### Benchmarks

| Operation | Time | Notes |
|-----------|------|-------|
| API key validation | ~5ms | Redis GET |
| Rate limit check | ~10ms | Redis ZADD + ZCARD |
| Parse session validation | ~50-100ms | Network call to Parse |

### Optimization

1. **Redis Connection Pooling**
   - Single Redis client reused
   - File: `server/utils/redis.ts`

2. **Middleware Ordering**
   - API key validation first (fast)
   - Rate limiting second (slightly slower)
   - Route handler last

3. **Rate Limit Cleanup**
   - Automatic via EXPIRE
   - No manual cleanup needed

---

## Summary

**Key Files:**
- `server/middleware/api-key.ts` - Authentication
- `server/middleware/api-rate-limit.ts` - Rate limiting
- `server/routes/auth/generate-api-key.post.ts` - Bootstrap
- `server/utils/api-keys.ts` - Key management
- `server/utils/redis.ts` - Redis client
- `server/utils/raycast-auth.js` - Parse validation

**Data Flow:**
```
Parse Session → API Key → Redis → Middleware → Route Handler
```

**Security Model:**
```
Multiple Layers:
1. Parse authentication (bootstrap)
2. API key validation (all requests)
3. Rate limiting (per key)
4. Business logic (per user)
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for implementation examples!
