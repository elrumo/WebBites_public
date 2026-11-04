# Nuxt Web App - Simplified Implementation

This guide shows how to add API key authentication to a Nuxt app **WITHOUT needing Redis on the frontend**.

---

## Architecture (Simplified!)

```
┌─────────────────────────────────────────────────────┐
│                   Browser                            │
│  Has: API key cookie (wb_api_key)                   │
│  Does NOT have: Redis, manual key management        │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ Cookie automatically sent
                   ▼
┌─────────────────────────────────────────────────────┐
│              Nitro Backend (Centralized)             │
│                                                      │
│  • Validates Parse session                          │
│  • Generates API key                                │
│  • Stores in Redis (its own Redis)                 │
│  • Sets cookie with API key                         │
│  • Validates API key from cookie                    │
│                                                      │
│  Frontend does NOT need Redis!                      │
└─────────────────────────────────────────────────────┘
```

**Key Point:** Nitro handles EVERYTHING. Frontend just manages Parse login and sends cookies.

---

## Why This is Better

### ❌ Old Way (Nuxt Proxy with Redis)
```
Nuxt Frontend needs:
- @upstash/redis package
- UPSTASH_REDIS_REST_URL env var
- UPSTASH_REDIS_REST_TOKEN env var
- Session management code
- Redis client setup
```

### ✅ New Way (Direct Cookie)
```
Nuxt Frontend needs:
- Nothing! Just Parse SDK (already have it)
- Call Nitro endpoint
- Cookie automatically handled
```

---

## Implementation

### Option A: Direct API Calls (Recommended)

This is the simplest approach - frontend makes direct API calls to Nitro.

#### 1. Login Page

```vue
<!-- pages/login.vue -->
<script setup lang="ts">
import Parse from 'parse'

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  loading.value = true
  error.value = ''

  try {
    // 1. Login to Parse (existing)
    const user = await Parse.User.logIn(username.value, password.value)
    const sessionToken = user.getSessionToken()

    // 2. Send session to Nitro, get API key cookie back
    await $fetch('http://localhost:3003/auth/session-login', {
      method: 'POST',
      credentials: 'include', // Important: include cookies
      body: {
        sessionToken,
        name: 'Nuxt Web App'
      }
    })

    // 3. Done! Cookie is set, redirect to dashboard
    navigateTo('/dashboard')
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
      <input v-model="username" placeholder="Username" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit" :disabled="loading">
        {{ loading ? 'Logging in...' : 'Login' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>
```

#### 2. API Composable

```typescript
// composables/useApi.ts

export const useApi = () => {
  const config = useRuntimeConfig()
  const baseURL = config.public.apiBase || 'http://localhost:3003'

  async function apiRequest<T>(endpoint: string, options?: any): Promise<T> {
    try {
      return await $fetch<T>(`${baseURL}/v1/${endpoint}`, {
        ...options,
        credentials: 'include' // Important: send cookie
      })
    } catch (error: any) {
      if (error.statusCode === 401) {
        // Cookie invalid/expired, redirect to login
        navigateTo('/login')
      }
      throw error
    }
  }

  return { apiRequest }
}
```

#### 3. Use in Pages

```vue
<!-- pages/dashboard.vue -->
<script setup lang="ts">
const { apiRequest } = useApi()

// Cookie sent automatically
const { data: bookmarks, refresh } = await useAsyncData(
  'bookmarks',
  () => apiRequest('bookmarks/list')
)

async function createBookmark() {
  await apiRequest('bookmarks/create', {
    method: 'POST',
    body: { url: 'https://example.com', title: 'Example' }
  })
  refresh()
}
</script>

<template>
  <div>
    <h1>Bookmarks</h1>
    <button @click="createBookmark">Add Bookmark</button>
    <div v-for="bookmark in bookmarks" :key="bookmark.id">
      {{ bookmark.title }}
    </div>
  </div>
</template>
```

#### 4. Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3003'
    }
  }
})
```

```bash
# .env
NUXT_PUBLIC_API_BASE=http://localhost:3003

# Production
# NUXT_PUBLIC_API_BASE=https://api.webbites.com
```

That's it! **No Redis needed on frontend.**

---

### Option B: Nuxt Proxy (If you want same-origin)

If you want all requests to go to same origin (e.g., `/api/*` instead of different domain), you can add a simple Nuxt proxy that **just forwards** - no Redis needed!

#### 1. Login Endpoint

```typescript
// server/api/auth/login.post.ts
import Parse from 'parse'

export default defineEventHandler(async (event) => {
  const { username, password } = await readBody(event)

  // Login to Parse
  const user = await Parse.User.logIn(username, password)
  const sessionToken = user.getSessionToken()

  // Forward to Nitro to get API key cookie
  const config = useRuntimeConfig()
  const response = await $fetch(`${config.backendUrl}/auth/session-login`, {
    method: 'POST',
    body: { sessionToken, name: 'Nuxt Web App' }
  })

  // Get cookie from Nitro response and set it on Nuxt response
  const apiKeyCookie = response.headers?.get?.('set-cookie')
  if (apiKeyCookie) {
    setHeader(event, 'set-cookie', apiKeyCookie)
  }

  return response
})
```

#### 2. Proxy Endpoint

```typescript
// server/api/v1/[...path].ts
import { joinURL } from 'ufo'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // Get cookie from browser request
  const apiKeyCookie = getCookie(event, 'wb_api_key')

  // Forward to Nitro with cookie
  const path = event.path.replace('/api/v1', '/v1')

  return await $fetch(joinURL(config.backendUrl, path), {
    method: event.method,
    headers: {
      // Forward the cookie as-is
      cookie: `wb_api_key=${apiKeyCookie}`
    },
    body: event.method !== 'GET' ? await readBody(event) : undefined,
    query: getQuery(event)
  })
})
```

#### 3. Frontend Usage

```vue
<!-- Same as Option A, but use /api/ instead of http://localhost:3003 -->
<script setup lang="ts">
// Login
await $fetch('/api/auth/login', {
  method: 'POST',
  body: { username, password }
})

// API calls
const { data } = await useFetch('/api/v1/bookmarks/list')
</script>
```

**Still no Redis needed!** Cookie is managed by Nitro.

---

## CORS Configuration (for Option A - Direct)

If frontend and backend are on different domains:

### Nitro Backend

```typescript
// server/middleware/cors.ts
export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin')

  // Allow your Nuxt app
  const allowedOrigins = [
    'http://localhost:3000',
    'https://app.webbites.com'
  ]

  if (origin && allowedOrigins.includes(origin)) {
    setHeaders(event, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Credentials': 'true' // Important for cookies!
    })
  }

  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
```

---

## Environment Variables

### Nitro Backend (This Project)
```bash
# Already configured!
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

### Nuxt Frontend
```bash
# Option A (Direct):
NUXT_PUBLIC_API_BASE=http://localhost:3003

# Option B (Proxy):
BACKEND_URL=http://localhost:3003  # Server-side only

# Production:
# NUXT_PUBLIC_API_BASE=https://api.webbites.com
# BACKEND_URL=https://api-internal.webbites.com
```

**No Redis credentials needed on frontend!**

---

## How It Works

### Login Flow

```
1. User enters credentials
   ↓
2. Frontend: Parse.User.logIn() → sessionToken
   ↓
3. Frontend: POST /auth/session-login { sessionToken }
   ↓
4. Nitro:
   - Validates sessionToken with Parse
   - Generates API key
   - Stores in Redis (its own)
   - Sets cookie: wb_api_key=wb_live_xxx
   ↓
5. Browser: Stores cookie automatically
   ↓
6. Frontend: All future requests include cookie automatically
```

### API Request Flow

```
1. Frontend: useFetch('/v1/bookmarks')
   ↓
2. Browser: Automatically adds cookie header
   ↓
3. Nitro middleware (api-key.ts):
   - Reads cookie: getCookie(event, 'wb_api_key')
   - Validates in Redis
   - Allows request
   ↓
4. Response sent back
```

---

## Logout

```vue
<script setup lang="ts">
async function logout() {
  // Call Nitro to clear cookie
  await $fetch('http://localhost:3003/auth/logout', {
    method: 'POST',
    credentials: 'include'
  })

  navigateTo('/login')
}
</script>
```

Nitro endpoint already exists: `server/routes/auth/logout.post.ts`

---

## Comparison: All Three Options

| Aspect | Direct (Option A) | Proxy (Option B) | Old Proxy with Redis |
|--------|------------------|------------------|---------------------|
| **Redis on Frontend** | ❌ No | ❌ No | ✅ Yes (bad!) |
| **Frontend Complexity** | ⭐ Simple | ⭐⭐ Medium | ⭐⭐⭐ Complex |
| **CORS** | Required | Not needed | Not needed |
| **Backend URL** | Exposed | Hidden | Hidden |
| **Dependencies** | Parse only | Parse only | Parse + Redis |
| **Recommended** | ✅ Yes | ✅ Yes | ❌ No |

---

## Migration from Old Proxy

If you already implemented the Redis-based proxy:

1. ✅ Remove `@upstash/redis` from Nuxt dependencies
2. ✅ Delete `server/utils/sessions.ts`
3. ✅ Replace login endpoint with simple forward to Nitro
4. ✅ Simplify proxy to just forward cookies
5. ✅ Remove Redis env vars from Nuxt

---

## Testing

```bash
# 1. Start Nitro backend
cd webbites-backend
bun run dev

# 2. Start Nuxt app
cd nuxt-app
bun run dev

# 3. Test login
curl -X POST http://localhost:3003/auth/session-login \
  -H "Content-Type: application/json" \
  -d '{"sessionToken":"r:your-parse-token","name":"Test"}' \
  -c cookies.txt

# Should set cookie: wb_api_key=wb_live_xxx

# 4. Test API call with cookie
curl http://localhost:3003/v1/example \
  -b cookies.txt

# Should return: {"message":"Successfully authenticated!",...}
```

---

## Security

### What the Browser Has

```
Cookie: wb_api_key=wb_live_xxx
├─ HttpOnly: Yes ✅ (not accessible via JavaScript)
├─ Secure: Yes ✅ (HTTPS only in production)
├─ SameSite: Lax ✅ (CSRF protection)
└─ Contains: API key
```

### Why This is Secure

1. ✅ API key in HttpOnly cookie (XSS protection)
2. ✅ SameSite attribute (CSRF protection)
3. ✅ Cookie automatically managed by browser
4. ✅ No manual key management in frontend code
5. ✅ All Redis logic centralized in Nitro

---

## Summary

### What You Need to Do

**Nitro Backend:**
- ✅ Already done! Endpoint exists: `/auth/session-login`

**Nuxt Frontend:**
```typescript
// 1. Login
const user = await Parse.User.logIn(username, password)
await $fetch('http://localhost:3003/auth/session-login', {
  method: 'POST',
  credentials: 'include',
  body: { sessionToken: user.getSessionToken() }
})

// 2. Make API calls (cookie sent automatically)
const data = await $fetch('http://localhost:3003/v1/bookmarks', {
  credentials: 'include'
})
```

### Key Benefits

- ✅ **No Redis on frontend** - All centralized in Nitro
- ✅ **Simpler frontend** - Just Parse SDK + API calls
- ✅ **Better security** - HttpOnly cookies
- ✅ **Less duplication** - One Redis, one auth system
- ✅ **Easier maintenance** - All logic in one place

**This is the recommended approach for web apps!**
