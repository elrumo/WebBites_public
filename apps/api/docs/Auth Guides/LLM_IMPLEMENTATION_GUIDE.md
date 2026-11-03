# API Key Authentication - LLM Implementation Guide

This guide is optimized for LLM consumption to implement API key authentication in frontend applications.

---

## Context

**What we have:**
- Parse Server for user authentication (existing)
- Nitro backend with centralized API key system (new)
- Users currently use `Parse.User.logIn()` to authenticate

**What needs to be added:**
- Exchange Parse session for API key or HTTP-only cookie
- Use appropriate auth method for each platform
- All auth logic centralized in Nitro (no Redis needed on frontends)

---

## Core Concepts

### Authentication Flow Options

#### Option A: API Key Flow (Chrome Extensions, Raycast)
```
1. User logs in with Parse (existing - no changes)
   Parse.User.logIn() → sessionToken

2. Exchange Parse session for API key (NEW - add once)
   POST /auth/generate-api-key
   Headers: Authorization: Bearer <sessionToken>
   Response: { success: true, apiKeyData: { key: "wb_live_xxx", ... } }

3. Store API key locally (NEW - add once)
   - Chrome: chrome.storage.local
   - Raycast: User preferences

4. Use API key for all requests (NEW - add to all API calls)
   Headers: Authorization: Bearer <apiKey>
```

#### Option B: Cookie Flow (Web Apps - Nuxt, Next.js, etc.)
```
1. User logs in with Parse (existing - no changes)
   Parse.User.logIn() → sessionToken

2. Exchange Parse session for HTTP-only cookie (NEW - centralized)
   POST /auth/session-login
   Body: { sessionToken, name?: "Web App" }
   Response: Sets wb_api_key cookie automatically

3. No storage needed (NEW - automatic)
   - Cookie sent automatically with all requests
   - No Redis or session management on frontend

4. All requests work automatically (NEW - transparent)
   - Cookie contains API key
   - Nitro handles everything
```

### Key Points
- Parse authentication unchanged - keep existing login flow
- **Two auth patterns**: API keys for extensions, cookies for web apps
- **All auth logic centralized in Nitro** - no Redis needed on frontends
- All requests to `/v1/*` endpoints require authentication
- Choose the right pattern for your platform

---

## Implementation Examples

### Chrome Extension

#### 1. Add API Key Bootstrap to Login

```javascript
// In your existing login handler
import Parse from 'parse'

async function handleLogin(username, password) {
  try {
    // EXISTING: Login to Parse (happens on frontend)
    const user = await Parse.User.logIn(username, password)
    const parseSessionToken = user.getSessionToken()

    // NEW: Exchange session token for API key
    const apiKey = await getApiKey(parseSessionToken)

    // NEW: Store API key
    await chrome.storage.local.set({ apiKey })

    return { success: true }
  } catch (error) {
    console.error('Login failed:', error)
    throw error
  }
}

// NEW: Function to exchange Parse session for API key
async function getApiKey(parseSessionToken) {
  const response = await fetch('http://localhost:3003/auth/session-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      sessionToken: parseSessionToken,
      name: 'Chrome Extension' 
    })
  })

  if (!response.ok) {
    throw new Error('Failed to exchange session for API key')
  }

  const data = await response.json()
  return data.apiKey // "wb_live_xxxxx"
}
```

#### 2. Create API Helper

```javascript
// NEW: Centralized API request helper
async function makeApiRequest(endpoint, options = {}) {
  // Get stored API key
  const { apiKey } = await chrome.storage.local.get('apiKey')

  if (!apiKey) {
    throw new Error('Not authenticated. Please login.')
  }

  const response = await fetch(`http://localhost:3003/v1/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`, // NEW: Use API key
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  if (response.status === 401) {
    // API key invalid - clear and require re-login
    await chrome.storage.local.remove('apiKey')
    throw new Error('Session expired. Please login again.')
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}

// Export for use throughout extension
export { makeApiRequest }
```

#### 3. Update Existing API Calls

```javascript
// BEFORE (if you had direct calls):
const response = await fetch('http://localhost:3003/bookmarks')
const bookmarks = await response.json()

// AFTER:
import { makeApiRequest } from './api.js'
const bookmarks = await makeApiRequest('bookmarks/list')
```

---

### Raycast Extension

#### 1. Add Setup Command

```typescript
// NEW: src/commands/setup.tsx
import { Form, ActionPanel, Action, showToast, Toast } from "@raycast/api"
import Parse from 'parse'
import { useState } from "react"

export default function SetupCommand() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [apiKey, setApiKey] = useState("")

  async function handleSubmit() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Generating API key..."
    })

    try {
      // Login to Parse (happens on frontend)
      const user = await Parse.User.logIn(username, password)
      const sessionToken = user.getSessionToken()

      // Exchange session token for API key
      const response = await fetch('http://localhost:3003/auth/session-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          sessionToken: sessionToken,
          name: 'Raycast Extension' 
        })
      })

      const data = await response.json()
      setApiKey(data.apiKey)

      toast.style = Toast.Style.Success
      toast.title = "Success!"
      toast.message = "Add this key to your preferences"
    } catch (error) {
      toast.style = Toast.Style.Failure
      toast.title = "Failed"
      toast.message = String(error)
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Generate API Key" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="username" title="Username" value={username} onChange={setUsername} />
      <Form.PasswordField id="password" title="Password" value={password} onChange={setPassword} />
      {apiKey && <Form.Description title="Your API Key" text={apiKey} />}
    </Form>
  )
}
```

#### 2. Add to package.json

```json
{
  "preferences": [
    {
      "name": "apiKey",
      "type": "password",
      "required": true,
      "title": "API Key",
      "description": "Run Setup command to generate"
    }
  ]
}
```

#### 3. Create API Helper

```typescript
// NEW: src/utils/api.ts
import { getPreferenceValues } from "@raycast/api"

interface Preferences {
  apiKey: string
}

export async function makeApiRequest(endpoint: string, options?: RequestInit) {
  const { apiKey } = getPreferenceValues<Preferences>()

  if (!apiKey) {
    throw new Error('API key not configured. Run Setup command.')
  }

  const response = await fetch(`http://localhost:3003/v1/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`, // NEW: Use API key
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}
```

#### 4. Update Existing Commands

```typescript
// BEFORE:
const response = await fetch('http://localhost:3003/bookmarks')
const bookmarks = await response.json()

// AFTER:
import { makeApiRequest } from '../utils/api'
const bookmarks = await makeApiRequest('bookmarks/list')
```

---

### Nuxt App (Centralized Cookie Auth)

For Nuxt, use the new centralized session-login approach. **No Redis needed on frontend!**

#### 1. Install Dependencies

```bash
bun add parse
```

#### 2. Login Endpoint

```typescript
// NEW: server/api/auth/login.post.ts
import Parse from 'parse'

export default defineEventHandler(async (event) => {
  const { username, password } = await readBody(event)

  try {
    // Login to Parse (happens on frontend/Nuxt server)
    const user = await Parse.User.logIn(username, password)
    const parseSessionToken = user.getSessionToken()

    // Exchange Parse session for API key cookie (centralized in Nitro)
    const config = useRuntimeConfig()
    const response = await $fetch(`${config.backendUrl}/auth/session-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { 
        sessionToken: parseSessionToken,
        name: 'Nuxt Web App'
      }
    })

    // Forward the cookie from Nitro to client
    const nitroSetCookie = response.headers?.['set-cookie']
    if (nitroSetCookie) {
      setHeader(event, 'set-cookie', nitroSetCookie)
    }

    return { 
      success: true, 
      userId: response.userId,
      message: 'Logged in successfully'
    }
  } catch (error) {
    throw createError({
      statusCode: 401,
      message: 'Login failed'
    })
  }
})
```

#### 3. Proxy Endpoint

```typescript
// NEW: server/api/v1/[...path].ts
import { joinURL } from 'ufo'

export default defineEventHandler(async (event) => {
  // Get API key cookie (set by Nitro)
  const apiKeyCookie = getCookie(event, 'wb_api_key')
  
  if (!apiKeyCookie) {
    throw createError({ 
      statusCode: 401, 
      message: 'Not authenticated. Please login.' 
    })
  }

  // Forward request to Nitro with API key
  const config = useRuntimeConfig()
  const path = event.path.replace('/api/v1', '/v1')

  try {
    return await $fetch(joinURL(config.backendUrl, path), {
      method: event.method,
      headers: {
        'Authorization': `Bearer ${apiKeyCookie}`, // Use API key from cookie
        'Content-Type': 'application/json',
        // Forward other headers if needed
        ...getHeaders(event)
      },
      body: event.method !== 'GET' ? await readBody(event) : undefined,
      query: getQuery(event)
    })
  } catch (error) {
    if (error.status === 401) {
      // API key invalid - clear cookie
      deleteCookie(event, 'wb_api_key')
      throw createError({ 
        statusCode: 401, 
        message: 'Session expired. Please login again.' 
      })
    }
    throw error
  }
})
```

#### 5. Frontend Usage

```vue
<!-- pages/login.vue -->
<script setup lang="ts">
const username = ref('')
const password = ref('')
const loading = ref(false)

async function login() {
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value }
    })
    // Cookie is automatically set by Nitro
    await navigateTo('/dashboard')
  } catch (error) {
    console.error('Login failed:', error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form @submit.prevent="login">
    <input v-model="username" placeholder="Username" />
    <input v-model="password" type="password" placeholder="Password" />
    <button type="submit" :disabled="loading">
      {{ loading ? 'Logging in...' : 'Login' }}
    </button>
  </form>
</template>
```

```vue
<!-- pages/dashboard.vue -->
<script setup lang="ts">
// All requests to /api/v1/* are automatically authenticated via cookie
const { data: bookmarks } = await useFetch('/api/v1/bookmarks/list')
</script>

<template>
  <div>
    <h1>Your Bookmarks</h1>
    <div v-for="bookmark in bookmarks" :key="bookmark.id">
      {{ bookmark.title }}
    </div>
  </div>
</template>
```

#### 4. Environment Variables

```bash
# .env
BACKEND_URL=http://localhost:3003
PARSE_APP_ID=...
PARSE_SERVER_URL=...

# Optional: For HTTPS development
DEV_HTTPS=true  # Enables secure cookies in development
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    backendUrl: process.env.BACKEND_URL
  }
})
```

---

## SSL Development Setup

The auth system works perfectly with HTTPS in development. Here's how to set it up:

### Backend (Nitro) Configuration

The session-login endpoint automatically enables secure cookies when:
- `NODE_ENV=production` (always secure in production)
- `DEV_HTTPS=true` (enables secure cookies in development)

```bash
# .env
DEV_HTTPS=true
```

### Frontend HTTPS Setup

#### Nuxt with HTTPS
```bash
# Install mkcert for local SSL certificates
brew install mkcert
mkcert -install

# Generate certificates for localhost
mkcert localhost 127.0.0.1 ::1

# Start Nuxt with HTTPS
nuxt dev --https --ssl-cert localhost+2.pem --ssl-key localhost+2-key.pem
```

Or configure in `nuxt.config.ts`:
```typescript
export default defineNuxtConfig({
  devServer: {
    https: {
      key: './localhost+2-key.pem',
      cert: './localhost+2.pem'
    }
  },
  runtimeConfig: {
    backendUrl: process.env.BACKEND_URL // https://localhost:3003
  }
})
```

#### Backend HTTPS (if needed)
```bash
# Start Nitro with HTTPS
bun run dev --https --ssl-cert localhost+2.pem --ssl-key localhost+2-key.pem
```

### Complete HTTPS Development Flow

1. **Generate certificates**: `mkcert localhost`
2. **Set environment**: `DEV_HTTPS=true`
3. **Start backend**: `https://localhost:3003`
4. **Start frontend**: `https://localhost:3000`
5. **Update URLs**: Use `https://` in all API calls

### Benefits of HTTPS Development

- ✅ **Secure cookies work properly** (required for production)
- ✅ **Same behavior as production** (no surprises when deploying)
- ✅ **Modern browser features** (some APIs require HTTPS)
- ✅ **Service workers** (require HTTPS)
- ✅ **PWA features** (require HTTPS)

---

## API Reference

### Endpoint: Generate API Key (Extensions)

```http
POST http://localhost:3003/auth/generate-api-key
Authorization: Bearer <parse-session-token>
Content-Type: application/json

{
  "name": "Client Name" // Optional
}
```

**Success Response (200):**
```json
{
  "success": true,
  "apiKeyData": {
    "key": "wb_live_xxxxxxxxxxxxxxxxxxxx",
    "userId": "user123",
    "name": "Client Name"
  }
}
```


### Endpoint: Session Login (Web Apps)

```http
POST http://localhost:3003/auth/session-login
Content-Type: application/json

{
  "sessionToken": "r:abc123def456...",
  "name": "Web Application" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user123",
  "message": "Logged in successfully"
}
```

**Headers:**
```http
Set-Cookie: wb_api_key=wb_live_xxx; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/
```

### Protected Endpoints

All endpoints under `/v1/*` require API key:

```http
GET http://localhost:3003/v1/example
Authorization: Bearer wb_live_xxxxxxxxxxxxxxxxxxxx
```

**Response:**
```json
{
  "message": "Successfully authenticated!",
  "userId": "user123",
  "timestamp": "2025-10-12T..."
}
```

### Rate Limiting

All responses include rate limit headers:
- `X-RateLimit-Limit`: 1000 (requests per hour)
- `X-RateLimit-Remaining`: 999
- `X-RateLimit-Reset`: Unix timestamp

---

## Environment Variables Needed

### Chrome/Raycast
None - just point to backend URL in code

### Nuxt
```bash
BACKEND_URL=http://localhost:3003
PARSE_APP_ID=...
PARSE_SERVER_URL=...
```

---

## Error Handling

### ~~400 Maximum Keys Limit & 409 Duplicate Names~~ - No longer needed
**Note:** These errors no longer occur. The system handles everything automatically:
- **Automatic cleanup**: Oldest keys deleted when limit reached
- **Duplicate names allowed**: Multiple keys can have the same name

```javascript
// Creating keys is now error-free!
const response = await fetch('/auth/generate-api-key', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${sessionToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'Chrome Extension' })
})

// No need to handle 400 or 409 errors - they don't occur
const data = await response.json()
```

### 401 Unauthorized
```javascript
if (response.status === 401) {
  // API key invalid/revoked
  // Clear stored key and require re-login
  await clearApiKey()
  showLoginPrompt()
}
```

### 429 Rate Limited
```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After')
  // Show error: "Rate limited. Try again in {retryAfter} seconds"
}
```

---

## Testing

### Manual Test

```bash
# 1. Get Parse session token (from your app)
PARSE_SESSION="r:abc123..."

# 2. Get API key
curl -X POST http://localhost:3003/auth/generate-api-key \
  -H "Authorization: Bearer $PARSE_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Response: {"success":true,"apiKeyData":{"key":"wb_live_xxx",...}}

# 3. Use API key
API_KEY="wb_live_xxx"
curl http://localhost:3003/v1/example \
  -H "Authorization: Bearer $API_KEY"
```

---

## Best Practices

### Handling Key Limits

#### 1. Check Before Creating (Recommended)
```javascript
// Before generating a new key, check if user already has one
async function ensureApiKey(deviceName) {
  // Try to get existing key from storage
  let apiKey = await getStoredApiKey()

  if (apiKey) {
    // Validate it still works
    const isValid = await testApiKey(apiKey)
    if (isValid) {
      return apiKey
    }
  }

  // No valid key - create new one
  // Note: If user has 10+ keys, oldest ones are automatically deleted
  // Duplicate names are allowed, no error handling needed
  apiKey = await generateApiKey(deviceName)
  await storeApiKey(apiKey)
  return apiKey
}
```

#### 2. Use Descriptive Names
```javascript
// Good names help users identify keys later
const keyName = `${deviceType}-${deviceId || Date.now()}`

// Examples:
// "Chrome Extension - MacBook Pro"
// "Raycast - Work Computer"
// "Mobile App - iPhone 13"
```

#### 3. Key Management UI (Optional)
```javascript
// Provide users a way to view and manage their keys
// Note: Not strictly necessary anymore since automatic cleanup handles old keys,
// but still useful for users who want manual control
async function showKeyManagement() {
  const response = await fetch('/v1/keys/list', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })

  const keys = await response.json()

  // Show list with:
  // - Key name
  // - Created date
  // - Partial key (first 15 chars)
  // - Revoke button

  keys.forEach(key => {
    console.log(`${key.name}: ${key.key.substring(0, 15)}... (${key.createdAt})`)
  })
}
```

## Migration Checklist

For existing apps with Parse authentication:

- [ ] Add API key generation after Parse login
- [ ] Store API key securely (chrome.storage/preferences/Redis)
- [ ] Create API helper function with API key in header
- [ ] Update all API calls to use helper function
- [ ] Handle 401 errors (clear key, require re-login)
- [ ] Test full flow: login → get key → make API call
- [ ] Add rate limit handling (optional)
- [ ] Add key management UI (optional - automatic cleanup handles old keys)

---

## Common Patterns

### Check if API Key Exists

```javascript
async function ensureApiKey() {
  let apiKey = await getStoredApiKey()

  if (!apiKey) {
    const currentUser = Parse.User.current()
    if (currentUser) {
      const sessionToken = currentUser.getSessionToken()
      apiKey = await generateApiKey(sessionToken)
      await storeApiKey(apiKey)
    } else {
      throw new Error('Please login')
    }
  }

  return apiKey
}

// Helper function to exchange Parse session for API key
async function generateApiKey(sessionToken) {
  const response = await fetch('http://localhost:3003/auth/session-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      sessionToken: sessionToken,
      name: 'Frontend App' 
    })
  })

  if (!response.ok) {
    throw new Error('Failed to exchange session for API key')
  }

  const data = await response.json()
  return data.apiKey
}
```

### Retry on 401

```javascript
async function makeApiRequestWithRetry(endpoint, options, retries = 1) {
  try {
    return await makeApiRequest(endpoint, options)
  } catch (error) {
    if (error.status === 401 && retries > 0) {
      // Try to regenerate API key
      await regenerateApiKey()
      return makeApiRequestWithRetry(endpoint, options, retries - 1)
    }
    throw error
  }
}
```

---

## Summary

**What to implement:**

### For Extensions (Chrome, Raycast):
1. ✅ Add API key generation after Parse login (one-time)
2. ✅ Store API key locally (chrome.storage/preferences)
3. ✅ Use API key in Authorization header for all API calls
4. ✅ Handle 401 errors (clear key + re-login)

### For Web Apps (Nuxt, Next.js):
1. ✅ Add session-login call after Parse login (one-time)
2. ✅ Cookie automatically set by Nitro (no storage needed)
3. ✅ Proxy requests to Nitro with cookie
4. ✅ Handle 401 errors (clear cookie + re-login)

**What NOT to change:**
- ❌ Parse login flow stays the same
- ❌ User management stays in Parse
- ❌ No changes to existing Parse authentication

**Key Benefits:**
- ✅ **No Redis needed on frontends** - all auth centralized in Nitro
- ✅ Parse handles user authentication
- ✅ API keys handle API access
- ✅ Better rate limiting and security
- ✅ Choose the right pattern for your platform
