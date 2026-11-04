# Getting Started: API Key Authentication

Quick implementation guide for all client types with Parse Server integration.

---

## Prerequisites

- ✅ Parse Server running (existing)
- ✅ Nitro backend running (`bun run dev`)
- ✅ Redis on Upstash configured
- ✅ Environment variables set

---

## The Flow (All Clients)

```
1. User logs in to Parse Server
   ↓
2. Get Parse session token
   ↓
3. Exchange for API key (one-time)
   ↓
4. Store API key
   ↓
5. Use API key for all /v1/* requests
```

---

## Implementation by Client Type

### 🟦 Chrome Extension

#### Step 1: Add API Key Bootstrap on Login

```javascript
// background.js or wherever you handle auth

import Parse from 'parse'

async function handleLogin(username, password) {
  try {
    // 1. Login to Parse (existing code - no changes!)
    const user = await Parse.User.logIn(username, password)
    const parseSessionToken = user.getSessionToken()

    // 2. NEW: Get API key from Nitro backend
    const apiKey = await generateApiKey(parseSessionToken)

    // 3. Store API key in chrome.storage
    await chrome.storage.local.set({ apiKey })

    console.log('Login successful, API key stored')
    return { success: true, userId: user.id }
  } catch (error) {
    console.error('Login failed:', error)
    throw error
  }
}

async function generateApiKey(parseSessionToken) {
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

#### Step 2: Create API Request Helper

```javascript
// api.js - centralized API helper

async function makeApiRequest(endpoint, options = {}) {
  // Get stored API key
  const { apiKey } = await chrome.storage.local.get('apiKey')

  if (!apiKey) {
    throw new Error('Not authenticated. Please login again.')
  }

  const response = await fetch(`http://localhost:3003/v1/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`, // ⭐ Using API key
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  if (response.status === 401) {
    // API key invalid/revoked - need to re-login
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

#### Step 3: Use in Your Extension

```javascript
// popup.js, background.js, etc.

import { makeApiRequest } from './api.js'

// Get bookmarks
async function getBookmarks() {
  const data = await makeApiRequest('bookmarks/list')
  return data.bookmarks
}

// Create bookmark
async function createBookmark(url, title) {
  return await makeApiRequest('bookmarks/create', {
    method: 'POST',
    body: JSON.stringify({ url, title })
  })
}

// Delete bookmark
async function deleteBookmark(id) {
  return await makeApiRequest(`bookmarks/${id}`, {
    method: 'DELETE'
  })
}
```

---

### 🟨 Raycast Extension

#### Step 1: Setup Command to Generate API Key

```typescript
// src/commands/setup.tsx

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
      // 1. Login to Parse
      const user = await Parse.User.logIn(username, password)
      const sessionToken = user.getSessionToken()

      // 2. Exchange session for API key
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
      toast.title = "API Key Generated!"
      toast.message = "Copy it and add to your Raycast preferences"
    } catch (error) {
      toast.style = Toast.Style.Failure
      toast.title = "Failed to generate API key"
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
      <Form.TextField
        id="username"
        title="Username"
        value={username}
        onChange={setUsername}
      />
      <Form.PasswordField
        id="password"
        title="Password"
        value={password}
        onChange={setPassword}
      />
      {apiKey && (
        <Form.Description
          title="Your API Key"
          text={`${apiKey}\n\nAdd this to your Raycast preferences!`}
        />
      )}
    </Form>
  )
}
```

#### Step 2: Add Preferences

```json
// package.json

{
  "preferences": [
    {
      "name": "apiKey",
      "type": "password",
      "required": true,
      "title": "API Key",
      "description": "Your Webbites API key (run Setup command to generate)"
    }
  ]
}
```

#### Step 3: Create API Helper

```typescript
// src/utils/api.ts

import { getPreferenceValues } from "@raycast/api"

interface Preferences {
  apiKey: string
}

export async function makeApiRequest(endpoint: string, options?: RequestInit) {
  const { apiKey } = getPreferenceValues<Preferences>()

  if (!apiKey) {
    throw new Error('API key not configured. Run the Setup command first.')
  }

  const response = await fetch(`http://localhost:3003/v1/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`, // ⭐ Using API key
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

#### Step 4: Use in Commands

```typescript
// src/commands/bookmarks.tsx

import { List } from "@raycast/api"
import { useEffect, useState } from "react"
import { makeApiRequest } from "../utils/api"

export default function BookmarksCommand() {
  const [bookmarks, setBookmarks] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchBookmarks() {
      try {
        const data = await makeApiRequest('bookmarks/list')
        setBookmarks(data.bookmarks)
      } catch (error) {
        console.error(error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchBookmarks()
  }, [])

  return (
    <List isLoading={isLoading}>
      {bookmarks.map((bookmark) => (
        <List.Item key={bookmark.id} title={bookmark.title} />
      ))}
    </List>
  )
}
```

---

### 🟩 Nuxt App (with Proxy)

This is more involved. See [NUXT_PROXY.md](NUXT_PROXY.md) for full details. Here's the overview:

#### Step 1: Install Dependencies

```bash
cd nuxt-app
bun add @upstash/redis parse
```

#### Step 2: Session Management Utility

```typescript
// nuxt-app/server/utils/sessions.ts

import { Redis } from '@upstash/redis'

let redis: Redis | null = null

function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!
    })
  }
  return redis
}

export async function storeSession(sessionId: string, apiKey: string, userId: string) {
  await getRedis().set(`nuxt_session:${sessionId}`, JSON.stringify({ apiKey, userId }), {
    ex: 60 * 60 * 24 * 365 // 1 year
  })
}

export async function getSession(sessionId: string) {
  const data = await getRedis().get(`nuxt_session:${sessionId}`)
  return data ? JSON.parse(data as string) : null
}

export async function deleteSession(sessionId: string) {
  await getRedis().del(`nuxt_session:${sessionId}`)
}
```

#### Step 3: Login Endpoint

```typescript
// nuxt-app/server/api/auth/login.post.ts

import Parse from 'parse'
import { randomBytes } from 'crypto'
import { storeSession } from '~/server/utils/sessions'

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID!)
Parse.serverURL = process.env.PARSE_SERVER_URL!

export default defineEventHandler(async (event) => {
  const { username, password } = await readBody(event)

  // 1. Login to Parse
  const user = await Parse.User.logIn(username, password)
  const parseSessionToken = user.getSessionToken()

  // 2. Exchange Parse session for API key from Nitro
  const config = useRuntimeConfig()
  const response = await $fetch(`${config.backendUrl}/auth/session-login`, {
    method: 'POST',
    body: {
      sessionToken: parseSessionToken,
      name: 'Nuxt Web App'
    }
  })

  const apiKey = response.apiKey

  // 3. Create session
  const sessionId = randomBytes(32).toString('hex')
  await storeSession(sessionId, apiKey, user.id)

  // 4. Set cookie
  setCookie(event, 'nuxt_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  })

  return { success: true, userId: user.id }
})
```

#### Step 4: Proxy Endpoint

```typescript
// nuxt-app/server/api/v1/[...path].ts

import { joinURL } from 'ufo'
import { getSession } from '~/server/utils/sessions'

export default defineEventHandler(async (event) => {
  // 1. Get session
  const sessionId = getCookie(event, 'nuxt_session')
  if (!sessionId) {
    throw createError({ statusCode: 401, message: 'Not authenticated' })
  }

  // 2. Get API key from session
  const session = await getSession(sessionId)
  if (!session) {
    throw createError({ statusCode: 401, message: 'Session expired' })
  }

  // 3. Forward to Nitro with API key
  const config = useRuntimeConfig()
  const path = event.path.replace('/api/v1', '/v1')

  return await $fetch(joinURL(config.backendUrl, path), {
    method: event.method,
    headers: {
      'Authorization': `Bearer ${session.apiKey}`, // ⭐ API key from session
      'Content-Type': 'application/json'
    },
    body: event.method !== 'GET' ? await readBody(event) : undefined,
    query: getQuery(event)
  })
})
```

#### Step 5: Use in Pages

```vue
<!-- pages/login.vue -->
<script setup lang="ts">
const username = ref('')
const password = ref('')

async function login() {
  await $fetch('/api/auth/login', {
    method: 'POST',
    body: { username: username.value, password: password.value }
  })

  navigateTo('/dashboard')
}
</script>

<template>
  <form @submit.prevent="login">
    <input v-model="username" placeholder="Username" />
    <input v-model="password" type="password" placeholder="Password" />
    <button type="submit">Login</button>
  </form>
</template>
```

```vue
<!-- pages/dashboard.vue -->
<script setup lang="ts">
// API key automatically added by proxy
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

See [NUXT_PROXY.md](NUXT_PROXY.md) for complete implementation.

---

## Environment Setup

### Nitro Backend (This Project)

```bash
# .env
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

### Nuxt App (Separate Project)

```bash
# .env
BACKEND_URL=http://localhost:3003

# Redis for sessions
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Parse config
PARSE_APP_ID=your-app-id
PARSE_SERVER_URL=http://localhost:1337/parse
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    backendUrl: process.env.BACKEND_URL,
    parseAppId: process.env.PARSE_APP_ID,
    parseServerUrl: process.env.PARSE_SERVER_URL
  }
})
```

---

## Testing

### Test the Full Flow

```bash
# 1. Start Nitro backend
cd webbites-backend
bun run dev

# 2. In another terminal, test with curl

# Get a Parse session token first (from your app)
PARSE_SESSION="r:your-parse-session-token"

# Exchange for API key
curl -X POST http://localhost:3003/auth/generate-api-key \
  -H "Authorization: Bearer $PARSE_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Client"}'

# Response: {"success":true,"apiKeyData":{"key":"wb_live_xxxxx",...}}

# Use the API key
API_KEY="wb_live_xxxxx"
curl http://localhost:3003/v1/example \
  -H "Authorization: Bearer $API_KEY"

# Should return: {"message":"Successfully authenticated!","userId":"..."}
```

---

## Handling Errors

### API Key Invalid/Revoked (401)

```javascript
// Check for 401 and prompt re-login
async function makeApiRequest(endpoint, options) {
  const response = await fetch(`http://localhost:3003/v1/${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    ...options
  })

  if (response.status === 401) {
    // API key invalid - need to re-authenticate
    await clearStoredApiKey()
    throw new Error('Please login again')
  }

  return response.json()
}
```

### ~~API Key Creation Errors (400, 409)~~ - No longer needed

**Note:** No errors occur during API key creation. The system handles everything automatically:
- **Automatic cleanup**: When you reach 10 keys, oldest ones are deleted automatically
- **Duplicate names allowed**: You can have multiple keys with the same name (e.g., multiple "Chrome Extension" keys)

```javascript
// Creating API key - no error handling needed!
const response = await fetch('http://localhost:3003/auth/generate-api-key', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${parseSessionToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'Chrome Extension' })
})

const data = await response.json()
// Always succeeds - automatic cleanup and duplicate names allowed
```

### Rate Limit Exceeded (429)

```javascript
// Check rate limit headers
const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } })

const remaining = response.headers.get('X-RateLimit-Remaining')
const reset = response.headers.get('X-RateLimit-Reset')

if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After')
  throw new Error(`Rate limited. Try again in ${retryAfter} seconds`)
}
```

---

## Migration for Existing Users

If you already have users with stored Parse sessions:

```javascript
// Check if user needs to generate API key
async function ensureApiKey() {
  let apiKey = await getStoredApiKey()

  if (!apiKey) {
    // User is logged in to Parse but doesn't have API key
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

// Use before making API requests
const apiKey = await ensureApiKey()
```

---

## Next Steps

1. ✅ Implement in your first client (Chrome/Raycast)
2. ✅ Test the complete flow
3. ✅ Roll out to other clients
4. ✅ Set up Nuxt proxy (for web app)
5. ✅ Monitor usage and rate limits

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for deeper technical details!
