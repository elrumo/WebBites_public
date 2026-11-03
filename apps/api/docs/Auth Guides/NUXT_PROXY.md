# Nuxt Proxy Setup

Complete guide for implementing API key authentication in a Nuxt application using a server proxy.

---

## Why Use a Proxy?

### Architecture Comparison

**Without Proxy (Direct):**
```
Browser → Nitro Backend
  ↓          ↓
Cookie   Validates API key
(has     in every request
API key)
```

**With Proxy (Recommended):**
```
Browser → Nuxt Server → Nitro Backend
  ↓          ↓             ↓
Cookie   Translates     Validates
(session  session→key   API key
only)
```

### Benefits of Proxy

| Aspect | Direct | Proxied |
|--------|--------|---------|
| API key location | Browser cookie | Server only |
| Browser receives | API key | Session ID |
| Backend URL | Exposed | Hidden |
| CORS | Required | Not needed |
| Security | Good | Excellent |
| Key rotation | Affects users | Transparent |

**Bottom line:** With a proxy, the API key never leaves the server!

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                             │
│  Has: Session cookie (nuxt_session=abc123)              │
│  Does NOT have: API key                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Requests to /api/v1/*
                     │ Cookie: nuxt_session=abc123
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Nuxt Server                             │
│                                                          │
│  1. Get session from cookie                             │
│     sessionId = "abc123"                                │
│                                                          │
│  2. Look up API key in Redis                            │
│     redis.get("nuxt_session:abc123")                    │
│     Returns: { apiKey: "wb_live_xxx", userId: "..." }  │
│                                                          │
│  3. Forward to Nitro with API key                       │
│     fetch("nitro:3003/v1/*", {                          │
│       headers: {                                        │
│         Authorization: "Bearer wb_live_xxx"              │
│       }                                                 │
│     })                                                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Authorization: Bearer wb_live_xxx
                     ▼
┌─────────────────────────────────────────────────────────┐
│               Nitro Backend                              │
│  • Validates API key                                    │
│  • Rate limits                                          │
│  • Processes request                                    │
└─────────────────────────────────────────────────────────┘
```

**Key Point:** Nuxt proxy is "dumb" - it just translates session → API key. All auth logic stays in Nitro!

---

## Implementation

### Prerequisites

```bash
# In your Nuxt project
bun add @upstash/redis parse
```

### Step 1: Session Management Utility

Create `nuxt-app/server/utils/sessions.ts`:

```typescript
import { Redis } from '@upstash/redis'

let redis: Redis | null = null

function getRedis() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN

    if (!url || !token) {
      throw new Error('Redis credentials not configured')
    }

    redis = new Redis({ url, token })
  }
  return redis
}

/**
 * Store API key for a Nuxt session
 */
export async function storeSession(
  sessionId: string,
  apiKey: string,
  userId: string
) {
  const redis = getRedis()

  await redis.set(
    `nuxt_session:${sessionId}`,
    JSON.stringify({ apiKey, userId }),
    { ex: 60 * 60 * 24 * 365 } // 1 year
  )
}

/**
 * Get API key from Nuxt session
 */
export async function getSession(sessionId: string) {
  const redis = getRedis()
  const data = await redis.get(`nuxt_session:${sessionId}`)

  if (!data) {
    return null
  }

  return JSON.parse(data as string) as {
    apiKey: string
    userId: string
  }
}

/**
 * Delete session
 */
export async function deleteSession(sessionId: string) {
  const redis = getRedis()
  await redis.del(`nuxt_session:${sessionId}`)
}
```

---

### Step 2: Login Endpoint

Create `nuxt-app/server/api/auth/login.post.ts`:

```typescript
import Parse from 'parse'
import { randomBytes } from 'crypto'
import { storeSession } from '~/server/utils/sessions'

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID!,
  process.env.PARSE_JAVASCRIPT_KEY
)
Parse.serverURL = process.env.PARSE_SERVER_URL!

export default defineEventHandler(async (event) => {
  const { username, password } = await readBody(event)

  try {
    // 1. Login to Parse Server (existing auth)
    const user = await Parse.User.logIn(username, password)
    const parseSessionToken = user.getSessionToken()
    const userId = user.id

    // 2. Exchange Parse session for API key from Nitro backend
    const config = useRuntimeConfig()
    const response = await $fetch(`${config.backendUrl}/auth/session-login`, {
      method: 'POST',
      body: {
        sessionToken: parseSessionToken,
        name: 'Nuxt Web App'
      }
    })

    const apiKey = response.apiKeyData.key

    // 3. Create Nuxt session ID
    const sessionId = randomBytes(32).toString('hex')

    // 4. Store API key server-side (Nuxt's only job)
    await storeSession(sessionId, apiKey, userId)

    // 5. Set session cookie for browser (NOT the API key!)
    setCookie(event, 'nuxt_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/'
    })

    return {
      success: true,
      userId
    }
  } catch (error: any) {
    throw createError({
      statusCode: 401,
      message: error.message || 'Login failed'
    })
  }
})
```

---

### Step 3: Logout Endpoint

Create `nuxt-app/server/api/auth/logout.post.ts`:

```typescript
import { deleteSession } from '~/server/utils/sessions'

export default defineEventHandler(async (event) => {
  const sessionId = getCookie(event, 'nuxt_session')

  if (sessionId) {
    // Delete session from Redis
    await deleteSession(sessionId)

    // Clear cookie
    deleteCookie(event, 'nuxt_session')
  }

  return {
    success: true,
    message: 'Logged out successfully'
  }
})
```

---

### Step 4: Universal Proxy

Create `nuxt-app/server/api/v1/[...path].ts`:

```typescript
import { joinURL } from 'ufo'
import { getSession } from '~/server/utils/sessions'

/**
 * Universal proxy for all /api/v1/* requests
 *
 * This is a "dumb" proxy - it just:
 * 1. Gets session from cookie
 * 2. Looks up API key in Redis
 * 3. Forwards to Nitro with API key header
 *
 * All auth logic (validation, rate limiting, etc.) happens in Nitro!
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // 1. Get session from cookie
  const sessionId = getCookie(event, 'nuxt_session')

  if (!sessionId) {
    throw createError({
      statusCode: 401,
      message: 'Not authenticated. Please login.'
    })
  }

  // 2. Look up API key in Redis
  const session = await getSession(sessionId)

  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Session expired. Please login again.'
    })
  }

  // 3. Build target URL
  const path = event.path.replace('/api/v1', '/v1')
  const targetUrl = joinURL(config.backendUrl, path)

  // 4. Forward request to Nitro with API key header
  // Nitro backend handles all validation, rate limiting, etc.
  try {
    return await $fetch(targetUrl, {
      method: event.method,
      headers: {
        'Authorization': `Bearer ${session.apiKey}`, // ⭐ Only thing we add
        'Content-Type': getHeader(event, 'content-type') || 'application/json'
      },
      body: event.method !== 'GET' ? await readBody(event) : undefined,
      query: getQuery(event),
      // Forward response headers from backend
      onResponse({ response }) {
        // Copy rate limit headers, etc.
        const headersToForward = [
          'x-ratelimit-limit',
          'x-ratelimit-remaining',
          'x-ratelimit-reset'
        ]

        headersToForward.forEach(header => {
          const value = response.headers.get(header)
          if (value) {
            setResponseHeader(event, header, value)
          }
        })
      }
    })
  } catch (error: any) {
    // Forward errors from Nitro backend
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.data?.message || error.message || 'Backend request failed'
    })
  }
})
```

---

### Step 5: Configuration

#### Environment Variables

Create `nuxt-app/.env`:

```bash
# Nitro backend URL
BACKEND_URL=http://localhost:3003

# Production
# BACKEND_URL=https://api-internal.webbites.com

# Redis for session storage
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Parse Server config
PARSE_APP_ID=your-app-id
PARSE_JAVASCRIPT_KEY=your-js-key
PARSE_SERVER_URL=http://localhost:1337/parse

# Production Parse
# PARSE_SERVER_URL=https://parse.webbites.com/parse
```

#### Nuxt Config

Update `nuxt-app/nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    // Private (server-only)
    backendUrl: process.env.BACKEND_URL || 'http://localhost:3003',
    parseAppId: process.env.PARSE_APP_ID,
    parseJavascriptKey: process.env.PARSE_JAVASCRIPT_KEY,
    parseServerUrl: process.env.PARSE_SERVER_URL,

    // Public (client-side)
    public: {
      // Don't expose backend URL to browser!
    }
  }
})
```

---

### Step 6: Frontend Usage

#### Login Page

Create `pages/login.vue`:

```vue
<script setup lang="ts">
const router = useRouter()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  loading.value = true
  error.value = ''

  try {
    // Call Nuxt server (NOT Nitro backend directly)
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value
      }
    })

    // Session cookie is set automatically
    router.push('/dashboard')
  } catch (e: any) {
    error.value = e.data?.message || 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <h1>Login</h1>

    <form @submit.prevent="handleLogin">
      <div>
        <label for="username">Username</label>
        <input
          id="username"
          v-model="username"
          type="text"
          required
        />
      </div>

      <div>
        <label for="password">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          required
        />
      </div>

      <button type="submit" :disabled="loading">
        {{ loading ? 'Logging in...' : 'Login' }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>
```

#### Dashboard Page

Create `pages/dashboard.vue`:

```vue
<script setup lang="ts">
// Cookie is sent automatically, API key added by proxy
// All requests to /api/v1/* are proxied to Nitro backend

const { data: bookmarks, refresh } = await useFetch('/api/v1/bookmarks/list')

async function createBookmark() {
  await $fetch('/api/v1/bookmarks/create', {
    method: 'POST',
    body: {
      url: 'https://example.com',
      title: 'Example'
    }
  })

  // Refresh list
  await refresh()
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  navigateTo('/login')
}
</script>

<template>
  <div class="dashboard">
    <header>
      <h1>Dashboard</h1>
      <button @click="logout">Logout</button>
    </header>

    <div class="bookmarks">
      <h2>Your Bookmarks</h2>

      <button @click="createBookmark">Add Example Bookmark</button>

      <div v-if="bookmarks">
        <div
          v-for="bookmark in bookmarks"
          :key="bookmark.id"
          class="bookmark"
        >
          <h3>{{ bookmark.title }}</h3>
          <p>{{ bookmark.url }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
```

#### Composable (Optional)

Create `composables/useApi.ts`:

```typescript
/**
 * API helper composable
 * Automatically uses proxy, no API key management needed!
 */
export const useApi = () => {
  async function apiRequest<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    try {
      return await $fetch<T>(`/api/v1/${endpoint}`, options)
    } catch (error: any) {
      if (error.statusCode === 401) {
        // Session expired, redirect to login
        navigateTo('/login')
      }
      throw error
    }
  }

  return {
    apiRequest
  }
}

// Usage in components:
// const { apiRequest } = useApi()
// const bookmarks = await apiRequest('bookmarks/list')
```

---

### Step 7: Auth Middleware

Create `middleware/auth.ts`:

```typescript
export default defineNuxtRouteMiddleware(async (to, from) => {
  // Skip auth check for public pages
  if (to.path === '/login') {
    return
  }

  // Check if user is authenticated
  try {
    await $fetch('/api/v1/user/me')
  } catch (error) {
    // Not authenticated, redirect to login
    return navigateTo('/login')
  }
})
```

Use in pages:

```vue
<script setup lang="ts">
definePageMeta({
  middleware: 'auth'
})
</script>
```

---

## Redis Data Structure

```redis
# Nuxt sessions (separate from Nitro API keys)
nuxt_session:abc123 → {
  "apiKey": "wb_live_xyz789",
  "userId": "user123"
}
Type: String (JSON)
TTL: 31536000 seconds (1 year)

# Note: Nitro backend still has its own API key storage
# api_key:wb_live_xyz789 → "user123"
# These are separate systems that work together!
```

---

## Security Considerations

### What the Browser Has

**With Proxy:**
```
Browser cookie: nuxt_session=abc123
├─ HttpOnly: Yes ✅
├─ Secure: Yes (prod) ✅
├─ SameSite: Lax ✅
└─ Contains: Just a session ID (not the API key!)
```

**Without Proxy (for comparison):**
```
Browser cookie: wb_api_key=wb_live_xxx
├─ HttpOnly: Yes ✅
├─ Secure: Yes ✅
├─ SameSite: Lax ✅
└─ Contains: Actual API key ⚠️
```

### Attack Scenarios

| Attack | Without Proxy | With Proxy |
|--------|--------------|------------|
| XSS steal API key | ✅ Protected (HttpOnly) | ✅✅ Extra layer (key on server) |
| CSRF | ✅ Protected (SameSite) | ✅ Protected (SameSite) |
| Cookie theft | ⚠️ Attacker gets API key | ✅ Attacker only gets session ID |
| Server compromise | ❌ Keys in browser | ⚠️ Keys on Nuxt server |

**Bottom line:** Proxy adds an extra security layer.

---

## Key Rotation

### Transparent to Users

With the proxy, you can rotate API keys without affecting users:

```typescript
// nuxt-app/server/api/admin/rotate-key.post.ts

export default defineEventHandler(async (event) => {
  const { userId } = await readBody(event)

  // Get all sessions for this user
  const sessions = await getAllUserSessions(userId)

  for (const sessionId of sessions) {
    const session = await getSession(sessionId)

    if (session) {
      // Create new API key via Nitro
      const newKey = await createNewApiKey(userId)

      // Revoke old key
      await revokeApiKey(session.apiKey)

      // Update session with new key
      await storeSession(sessionId, newKey, userId)
    }
  }

  // Users continue working without interruption!
  return { success: true }
})
```

---

## Testing

### Test the Flow

```bash
# 1. Start Nitro backend
cd webbites-backend
bun run dev

# 2. Start Nuxt app
cd nuxt-app
bun run dev

# 3. Test login (via Nuxt)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"password"}' \
  -c cookies.txt

# Response sets cookie: nuxt_session=abc123

# 4. Test API request (via Nuxt proxy)
curl http://localhost:3000/api/v1/example \
  -b cookies.txt

# Response: {"message":"Successfully authenticated!","userId":"..."}

# 5. Verify Nuxt added API key
# Check Nuxt server logs - should show:
# "Forwarding to Nitro with API key: wb_live_xxx"
```

---

## Troubleshooting

### Session not found

**Problem:** `Session expired. Please login again.`

**Solutions:**
- Check Redis connection in Nuxt server
- Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Check if session exists: `redis-cli GET "nuxt_session:abc123"`

### Cannot connect to Nitro backend

**Problem:** `Backend request failed`

**Solutions:**
- Verify `BACKEND_URL` in Nuxt config
- Check Nitro backend is running
- Test Nitro directly: `curl http://localhost:3003/v1/example -H "Authorization: Bearer wb_live_xxx"`

### CORS errors

**Problem:** Browser blocks requests

**Solutions:**
- ✅ You shouldn't have CORS issues with proxy!
- Browser requests go to same origin (Nuxt server)
- Nuxt server talks to Nitro backend (server-to-server, no CORS)

---

## Summary

### Nuxt Proxy Responsibilities

✅ **Does:**
- Session management (cookie ↔ API key mapping)
- Stores API keys server-side (Redis)
- Adds `Authorization: Bearer` header
- Forwards requests to Nitro
- Forwards response headers back

❌ **Does NOT:**
- Validate API keys (Nitro does this)
- Check permissions (Nitro does this)
- Enforce rate limits (Nitro does this)
- Business logic (Nitro does this)

### Key Files

```
nuxt-app/
├── server/
│   ├── utils/
│   │   └── sessions.ts           # Session management
│   └── api/
│       ├── auth/
│       │   ├── login.post.ts     # Parse login → API key
│       │   └── logout.post.ts    # Clear session
│       └── v1/
│           └── [...path].ts      # Universal proxy
└── pages/
    ├── login.vue                 # Login UI
    └── dashboard.vue             # Protected page
```

### Benefits

- ✅ API key never in browser
- ✅ Better security
- ✅ Transparent key rotation
- ✅ No CORS issues
- ✅ Hidden backend URL
- ✅ All auth logic centralized in Nitro

See [GETTING_STARTED.md](GETTING_STARTED.md) for quickstart examples!
