# API Key Authentication System

Complete guide for implementing API key authentication with Parse Server integration.

---

## 📚 Documentation Structure

This folder contains three focused guides:

### 1. [GETTING_STARTED.md](GETTING_STARTED.md) ⭐ Start Here!
Quick implementation guide for all client types:
- Chrome Extension
- Raycast Extension
- Nuxt Web App (with proxy)
- Parse Server integration
- Copy-paste examples

### 2. [IMPLEMENTATION.md](IMPLEMENTATION.md)
Deep dive into the implementation:
- How the system works
- Middleware architecture
- Security considerations
- Rate limiting
- Redis data structures
- API key management

### 3. [NUXT_PROXY.md](NUXT_PROXY.md)
Complete Nuxt proxy setup:
- Why use a proxy
- Session management
- Server routes
- Frontend integration
- Environment configuration

---

## 🚀 Quick Start

### Your Current Setup (Parse Server)
```javascript
// Chrome, Raycast, Nuxt all use Parse
const user = await Parse.User.logIn(username, password)
const sessionToken = user.getSessionToken()
```

### Add API Keys (3 Steps)

**1. Exchange Parse session for API key (one-time):**
```javascript
const response = await fetch('http://localhost:3003/auth/session-login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ 
    sessionToken: sessionToken, // Parse session token
    name: 'My App' 
  })
})

const { apiKey } = await response.json()
// apiKey is "wb_live_xxxxx"
```

**2. Store the API key:**
- Chrome: `chrome.storage.local.set({ apiKey })`
- Raycast: User preferences
- Nuxt: Server-side Redis

**3. Use for all requests:**
```javascript
await fetch('http://localhost:3003/v1/bookmarks', {
  headers: {
    'Authorization': `Bearer ${apiKey}` // API key
  }
})
```

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│              Parse Server (Existing Auth)                │
│  • User login/signup                                     │
│  • Session management (sessionToken)                     │
└───────────────────┬──────────────────────────────────────┘
                    │
                    │ Parse.User.logIn()
                    ▼
┌──────────────────────────────────────────────────────────┐
│   Nitro Backend: /auth/generate-api-key                  │
│  • Validates Parse session                               │
│  • Creates API key                                       │
│  • Stores in Redis                                       │
└───────────────────┬──────────────────────────────────────┘
                    │
                    │ Returns API key
                    ▼
┌──────────────────────────────────────────────────────────┐
│                  Client Apps                             │
│  Chrome/Raycast: Store API key directly                 │
│  Nuxt: Server stores API key, browser gets session      │
└───────────────────┬──────────────────────────────────────┘
                    │
                    │ All requests with API key
                    ▼
┌──────────────────────────────────────────────────────────┐
│         Nitro Backend: /v1/* Endpoints                   │
│  • Validate API key (middleware)                         │
│  • Rate limit (1000 req/hour per key)                   │
│  • Process request                                       │
└──────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Concepts

### Parse Session vs API Key

| Aspect | Parse Session | API Key |
|--------|--------------|---------|
| **Format** | `r:abc123...` | `wb_live_xxx...` |
| **Created by** | Parse Server | Nitro backend |
| **Used for** | Bootstrap only | All /v1/* requests |
| **Lifespan** | Session duration | 1 year |
| **Rate limiting** | No | Yes (1000/hour) |
| **Revocable** | Logout required | Individual key revocation |

### Why Both Systems?

1. **Parse Session** = Your existing auth (keep it!)
   - Manages users & passwords
   - Already working everywhere
   - Used once to get API key

2. **API Key** = New API access layer
   - Better rate limiting (per device)
   - Can revoke keys without logout
   - Separate key per device/app
   - Faster validation (Redis)

---

## 📂 Implementation Files

### Backend (Nitro - This Project)
```
server/
├── middleware/
│   ├── api-key.ts              # Validates API keys
│   └── api-rate-limit.ts       # Rate limiting
├── routes/
│   ├── auth/
│   │   ├── generate-api-key.post.ts       # Parse session → API key
│   │   ├── generate-api-key-cookie.post.ts # Optional: direct web
│   │   └── logout.post.ts
│   └── v1/
│       ├── keys/
│       │   ├── create.post.ts  # Create additional keys
│       │   ├── list.get.ts     # List user's keys
│       │   └── revoke.delete.ts # Revoke a key
│       └── [your-endpoints]/
└── utils/
    ├── redis.ts                # Redis client
    ├── api-keys.ts             # Key management
    └── raycast-auth.js         # Parse session validation
```

### Frontend (Nuxt - Separate Project)
```
nuxt-app/
├── server/
│   ├── api/
│   │   ├── auth/
│   │   │   └── login.post.ts   # Parse login → API key → session
│   │   └── v1/
│   │       └── [...path].ts    # Proxy to Nitro
│   └── utils/
│       └── sessions.ts         # Session management
└── pages/
    ├── login.vue
    └── dashboard.vue
```

---

## 🔒 Security Features

### ✅ API Key Authentication
- Keys stored in Redis
- Fast validation (no Parse API call)
- Works with header or cookie

### ✅ Rate Limiting
- 1000 requests/hour per API key
- Sliding window in Redis
- Automatic cleanup

### ✅ Per-Device Keys
- Separate key for each device
- Revoke one without affecting others
- Track usage per key

### ✅ Key Management Limits
- Maximum 10 API keys per user
- **Automatic cleanup**: When limit is reached, oldest keys are automatically deleted to make room for new ones
- Prevents key proliferation while allowing seamless key creation
- Multiple keys can have the same name (useful for multiple devices of same type)

### ✅ Centralized Validation
- Single source of truth (Nitro backend)
- All clients use same auth flow
- Consistent behavior everywhere

---

## 🧪 Testing

```bash
# 1. Start Nitro backend
cd webbites-backend
bun run dev

# 2. Get a Parse session token (from your app)
PARSE_SESSION="r:abc123..."

# 3. Get API key
curl -X POST http://localhost:3003/auth/generate-api-key \
  -H "Authorization: Bearer $PARSE_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Response: {"success":true,"apiKeyData":{"key":"wb_live_xxxxx",...}}

# 4. Use API key
API_KEY="wb_live_xxxxx"
curl http://localhost:3003/v1/example \
  -H "Authorization: Bearer $API_KEY"
```

---

## 🔧 Environment Variables

### Nitro Backend
```bash
# Required
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Optional
NODE_ENV=production
```

### Nuxt App (if using proxy)
```bash
BACKEND_URL=http://localhost:3003
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## 📖 What to Read

1. **New to the system?** → Start with [GETTING_STARTED.md](GETTING_STARTED.md)
2. **Building Nuxt web app?** → Read [NUXT_PROXY.md](NUXT_PROXY.md)
3. **Want deep dive?** → Read [IMPLEMENTATION.md](IMPLEMENTATION.md)

---

## 🆘 Common Issues

### "Invalid API key" error
- Key might be revoked
- Check: `redis-cli GET "api_key:wb_live_xxx"`
- Solution: Regenerate via `/auth/generate-api-key`

### ~~Key Creation Errors (400, 409)~~ - No longer applicable
- **No errors occur during key creation** - the system handles everything automatically:
  - When limit is reached: Oldest keys are automatically deleted
  - Duplicate names: Allowed (multiple devices can have same name like "Chrome Extension")
- Users can always create new keys without any manual intervention

### Rate limit exceeded
- Check headers: `X-RateLimit-Remaining`
- Wait until: `X-RateLimit-Reset` timestamp
- Consider caching on client

### Parse session validation fails
- Ensure Parse Server is running
- Check session token format: `r:...`
- Verify `verifySession()` function works

---

## 💡 Benefits

### Before (Parse Session Only)
```
❌ Parse API called on every request (slow)
❌ No rate limiting per device
❌ Can't revoke access without logout
❌ Same session across all devices
```

### After (Parse + API Keys)
```
✅ Fast Redis validation
✅ 1000 req/hour per API key
✅ Revoke individual keys
✅ Separate key per device
✅ Better monitoring and analytics
```

---

## 🚦 Next Steps

1. ✅ Read [GETTING_STARTED.md](GETTING_STARTED.md)
2. ✅ Implement in one client (Chrome/Raycast)
3. ✅ Test the flow
4. ✅ Add to other clients
5. ✅ Set up Nuxt proxy (for web app)
6. ✅ Monitor rate limits and usage

---

## 📝 Summary

**Keep your Parse authentication, add API keys on top:**

```
Parse Login → Get API Key (once) → Use for All Requests
```

- ✅ Parse Server unchanged
- ✅ Better rate limiting
- ✅ Per-device keys
- ✅ Faster validation
- ✅ Centralized in Nitro
