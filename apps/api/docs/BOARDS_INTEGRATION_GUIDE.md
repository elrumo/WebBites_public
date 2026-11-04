# Boards Feature — Frontend Integration Guide

This guide covers everything a frontend developer needs to integrate the Bookmark Boards feature. All endpoints follow RESTful conventions with proper HTTP verbs and path parameters.

---

## Authentication

All board endpoints (except public board access) require a **Bearer token** via the `Authorization` header. The token is the user's Parse session token.

```
Authorization: Bearer <sessionToken>
```

The backend validates this against Parse Server and extracts the authenticated user context. Requests without a valid token receive a `401 Unauthorized` response.

---

## Base URL

```
{API_BASE}/v1/boards
```

Public access endpoint:
```
{API_BASE}/v1/public/boards/{publicSlug}
```

---

## Board Modes

| Mode | Behavior |
|------|----------|
| `manual` | User manually adds/removes bookmarks |
| `smart` | AI auto-assigns bookmarks based on topics (requires `smartRules`) |
| `mixed` | Both manual and AI-driven assignment |

---

## Endpoints

### 1. Create Board

```
POST /v1/boards
```

**Request body:**
```json
{
  "name": "Design Inspiration",
  "description": "UI and UX design references",
  "mode": "smart",
  "smartRules": {
    "topics": ["UI Design", "Typography", "Color Theory"],
    "confidenceThreshold": 0.6,
    "autoApply": true,
    "includeExisting": false
  },
  "color": "#6366f1",
  "icon": "palette"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Max 100 characters |
| `mode` | string | Yes | `manual`, `smart`, or `mixed` |
| `description` | string | No | Max 1000 characters |
| `smartRules` | object | When mode is `smart`/`mixed` | See Smart Rules below |
| `color` | string | No | Hex color code |
| `icon` | string | No | Icon identifier |

**Response (201):**
```json
{
  "success": true,
  "board": {
    "id": "abc123",
    "name": "Design Inspiration",
    "description": "UI and UX design references",
    "mode": "smart",
    "smartRules": { "topics": ["UI Design", "Typography", "Color Theory"], "confidenceThreshold": 0.6, "autoApply": true, "includeExisting": false },
    "color": "#6366f1",
    "icon": "palette",
    "bookmarkCount": 0,
    "visibility": "private",
    "publicSlug": "550e8400-e29b-41d4-a716-446655440000",
    "isDeleted": false,
    "createdAt": "2026-02-17T10:00:00.000Z",
    "updatedAt": "2026-02-17T10:00:00.000Z"
  }
}
```

### Smart Rules Object

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `topics` | string[] | — | Required. Topics the AI matches against |
| `confidenceThreshold` | number | `0.6` | Minimum AI confidence (0-1) for auto-assignment |
| `autoApply` | boolean | `true` | Whether to auto-assign new bookmarks via the save pipeline |
| `includeExisting` | boolean | `false` | Whether to scan existing bookmarks on creation |

---

### 2. List User Boards

```
GET /v1/boards?limit=200
```

| Query Param | Type | Default | Max |
|-------------|------|---------|-----|
| `limit` | number | 200 | 500 |

**Response (200):**
```json
{
  "success": true,
  "boards": [
    {
      "id": "abc123",
      "name": "Design Inspiration",
      "description": "...",
      "mode": "smart",
      "smartRules": { "topics": [...], "confidenceThreshold": 0.6, "autoApply": true },
      "color": "#6366f1",
      "icon": "palette",
      "bookmarkCount": 12,
      "visibility": "private",
      "publicSlug": "...",
      "isDeleted": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1
}
```

Boards are sorted by most recently updated. Soft-deleted boards are automatically excluded.

---

### 3. Get Board with Bookmarks

```
GET /v1/boards/{boardId}?limit=50&skip=0
```

| Query Param | Type | Default | Max |
|-------------|------|---------|-----|
| `limit` | number | 50 | 500 |
| `skip` | number | 0 | — |

**Response (200):**
```json
{
  "success": true,
  "board": { "id": "abc123", "name": "Design Inspiration", "..." },
  "items": [
    {
      "membershipId": "mem456",
      "source": "smart",
      "aiTopic": "UI Design",
      "aiConfidence": 0.92,
      "addedAt": "2026-02-17T10:05:00.000Z",
      "website": {
        "id": "site789",
        "url": "https://example.com/article",
        "siteTitle": "Modern UI Patterns",
        "siteDescription": "A guide to modern interface design",
        "OGImage": "https://...",
        "type": "article",
        "subType": "blog",
        "tags": ["design", "ui"]
      }
    }
  ],
  "totalBookmarks": 12
}
```

Use `totalBookmarks` and `skip`/`limit` for pagination.

---

### 4. Update Board

```
PATCH /v1/boards/{boardId}
```

Send only the fields you want to update (partial update):

```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "mode": "mixed",
  "smartRules": { "topics": ["New Topic"], "confidenceThreshold": 0.7, "autoApply": true },
  "color": "#f43f5e",
  "icon": "star"
}
```

**Response (200):**
```json
{
  "success": true,
  "board": { "..." }
}
```

---

### 5. Delete Board (Soft Delete)

```
DELETE /v1/boards/{boardId}
```

**Response: `204 No Content`** (empty body)

- The board and all its bookmark associations are soft-deleted.
- Soft-deleted records are automatically purged after **30 days**.
- The board will no longer appear in list responses.

---

### 6. Add Bookmarks to Board

```
POST /v1/boards/{boardId}/bookmarks
```

**Request body:**
```json
{
  "websiteIds": ["site1", "site2", "site3"],
  "source": "manual"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `websiteIds` | string[] | Yes | Array of website/bookmark IDs |
| `source` | string | No | `manual` (default) or `smart` |

**Response (200):**
```json
{
  "success": true,
  "results": [
    { "websiteId": "site1", "status": "created" },
    { "websiteId": "site2", "status": "reactivated" },
    { "websiteId": "site3", "status": "already_exists" }
  ],
  "created": 2,
  "total": 3
}
```

| Status | Meaning |
|--------|---------|
| `created` | New membership created |
| `reactivated` | Previously soft-deleted membership restored |
| `already_exists` | Bookmark was already in the board |
| `failed` | Error adding this bookmark |

---

### 7. List Bookmarks in Board

```
GET /v1/boards/{boardId}/bookmarks?limit=50&skip=0
```

**Response (200):**
```json
{
  "success": true,
  "items": [
    {
      "membershipId": "mem456",
      "source": "manual",
      "aiTopic": null,
      "aiConfidence": null,
      "addedAt": "2026-02-17T10:05:00.000Z",
      "website": {
        "id": "site789",
        "url": "https://example.com",
        "siteTitle": "Example Site",
        "siteDescription": "...",
        "OGImage": "...",
        "type": "article",
        "tags": ["tech"]
      }
    }
  ],
  "totalBookmarks": 25
}
```

---

### 8. Remove Bookmark from Board

```
DELETE /v1/boards/{boardId}/bookmarks/{websiteId}
```

**Response: `204 No Content`** (empty body)

- Only the board membership is soft-deleted. The bookmark itself is **not** deleted.
- Re-adding the same bookmark later will reactivate the membership.

---

### 9. Get Boards for a Bookmark

```
GET /v1/boards/bookmark/{bookmarkId}
```

Returns all boards that a specific bookmark belongs to.

**Response (200):**
```json
{
  "success": true,
  "boards": [
    {
      "id": "abc123",
      "name": "Design Inspiration",
      "description": "...",
      "mode": "smart",
      "bookmarkCount": 12,
      "visibility": "private",
      "source": "smart",
      "aiTopic": "UI Design",
      "addedAt": "2026-02-17T10:05:00.000Z",
      "..."
    }
  ]
}
```

Use this to show board membership badges/tags on individual bookmark views.

---

## Smart / AI Endpoints

### 10. Preview Smart Matches (Dry Run)

```
POST /v1/boards/{boardId}/smart/preview
```

No request body needed. Uses the board's configured `smartRules`.

**Response (200):**
```json
{
  "success": true,
  "suggestions": [
    {
      "websiteId": "site789",
      "confidence": 0.85,
      "reason": "Article covers UI design patterns matching the board's topic"
    }
  ],
  "analyzed": 100
}
```

- Only boards with mode `smart` or `mixed` support this endpoint.
- Shows what the AI would match **without** creating any memberships.
- Use this to let users review before applying.

---

### 11. Apply Smart Rules

```
POST /v1/boards/{boardId}/smart/apply
```

**Request body (optional):**
```json
{
  "websiteIds": ["site1", "site2"],
  "limit": 100
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `websiteIds` | string[] | — | Scope to specific bookmarks (optional, defaults to all) |
| `limit` | number | 100 | Max bookmarks to analyze (max 300) |

**Response (200):**
```json
{
  "success": true,
  "created": 5,
  "skipped": 2,
  "analyzed": 50,
  "matched": 7
}
```

- Creates actual memberships with `source: "smart"`, `aiTopic`, and `aiConfidence` metadata.
- Skips bookmarks already in the board.
- Reactivates previously soft-deleted memberships.

---

### 12. AI Board Suggestions

```
POST /v1/boards/smart/suggest
```

**Request body:**
```json
{
  "bookmarkIds": ["site1", "site2"],
  "suggestNewBoards": true,
  "maxSuggestionsPerBookmark": 3
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `bookmarkIds` | string[] | — | Specific bookmarks to analyze (defaults to recent 50) |
| `suggestNewBoards` | boolean | `false` | Whether to suggest entirely new boards |
| `maxSuggestionsPerBookmark` | number | 3 | Max board suggestions per bookmark |

**Response (200):**
```json
{
  "success": true,
  "assignments": [
    {
      "bookmarkId": "site1",
      "bookmarkTitle": "Modern UI Patterns",
      "suggestedBoardIds": ["abc123"],
      "suggestedBoardNames": ["Design Inspiration"],
      "confidence": 0.85
    }
  ],
  "newBoardSuggestions": [
    {
      "name": "Frontend Development",
      "description": "Resources about modern frontend frameworks and tools",
      "topics": ["React", "CSS", "JavaScript"],
      "matchingBookmarkIds": ["site1", "site3"]
    }
  ]
}
```

`newBoardSuggestions` is only present when `suggestNewBoards: true`.

**Frontend workflow:**
1. Call `/smart/suggest` to get AI recommendations
2. Display suggestions to the user for review
3. User approves/rejects each suggestion
4. For approved assignments: call `POST /v1/boards/{boardId}/bookmarks`
5. For approved new boards: call `POST /v1/boards` to create, then add bookmarks

---

## Sharing Endpoints

### 13. Update Sharing Settings

```
PATCH /v1/boards/{boardId}/sharing
```

**Request body:**
```json
{
  "visibility": "link"
}
```

Visibility options:

| Visibility | Config Required | Description |
|------------|----------------|-------------|
| `private` | — | Board is not shared (default) |
| `link` | — | Anyone with the share token can view |
| `email_list` | `visibilityConfig.allowedEmails` | Only specific emails can view |
| `email_domain` | `visibilityConfig.allowedDomains` | Only users from specific domains can view |

**Example — email restricted:**
```json
{
  "visibility": "email_list",
  "visibilityConfig": {
    "allowedEmails": ["alice@example.com", "bob@example.com"]
  }
}
```

**Example — domain restricted:**
```json
{
  "visibility": "email_domain",
  "visibilityConfig": {
    "allowedDomains": ["company.com", "partner.org"]
  }
}
```

**Response (200) — first time enabling `link` visibility:**
```json
{
  "success": true,
  "board": { "..." },
  "shareToken": "raw-token-only-shown-once",
  "shareUrl": "https://app.webbites.io/board/550e8400-e29b-41d4-a716-446655440000?token=raw-token-only-shown-once"
}
```

**Important:** The `shareToken` and `shareUrl` are **only returned the first time** a token is generated. The raw token is never stored on the server (only a SHA-256 hash). Display a "Copy link" UI immediately and warn the user they won't be able to retrieve it again.

If the board already has a token and you're just changing other settings, the response won't include `shareToken`.

---

### 14. Rotate Share Token

```
POST /v1/boards/{boardId}/sharing/rotate-token
```

No request body needed. Only works when visibility is `link`.

**Response (200):**
```json
{
  "success": true,
  "shareToken": "new-raw-token",
  "shareUrl": "https://app.webbites.io/board/{publicSlug}?token=new-raw-token"
}
```

- Immediately invalidates the previous token.
- Anyone with the old link will lose access.
- Show the new token/URL to the user immediately.

---

### 15. Access Shared Board (Public)

```
GET /v1/public/boards/{publicSlug}?token={shareToken}&limit=50&skip=0
```

**No auth header required** for `link` visibility. For `email_list`/`email_domain`, the viewer must include their Bearer token.

**Response (200):**
```json
{
  "board": {
    "id": "abc123",
    "name": "Design Inspiration",
    "description": "...",
    "bookmarkCount": 12,
    "visibility": "link",
    "..."
  },
  "items": [
    {
      "source": "smart",
      "aiTopic": "UI Design",
      "addedAt": "...",
      "website": {
        "id": "site789",
        "url": "https://example.com",
        "siteTitle": "Modern UI Patterns",
        "siteDescription": "...",
        "OGImage": "...",
        "type": "article",
        "tags": ["design"]
      }
    }
  ],
  "totalBookmarks": 12
}
```

**Error responses:**

| Status | When |
|--------|------|
| `403` | Board is private |
| `403` | Invalid or missing share token (link visibility) |
| `401` | Auth required for email_list/email_domain but no token provided |
| `403` | Email not in allowlist / domain not allowed |
| `404` | Board not found or slug invalid |

---

## Error Handling

All errors follow a consistent format:

```json
{
  "statusCode": 400,
  "statusMessage": "name is required"
}
```

| Status Code | Meaning |
|-------------|---------|
| `400` | Invalid request (missing fields, bad mode, etc.) |
| `401` | Missing or invalid session token |
| `403` | Access denied (not owner, sharing policy violation) |
| `404` | Board or resource not found |

---

## Soft Delete Behavior

- **Boards:** Deleted via `DELETE /v1/boards/{boardId}`. The board and all its memberships are soft-deleted.
- **Memberships:** Deleted via `DELETE /v1/boards/{boardId}/bookmarks/{websiteId}`. Only the membership is soft-deleted; the bookmark itself is unaffected.
- **Reactivation:** Re-adding a previously removed bookmark will reactivate the existing membership record.
- **Auto-purge:** Records that remain soft-deleted for 30 days are permanently hard-deleted by a daily scheduled task (runs at 3:00 AM).
- **No undo endpoint:** To "restore" a deleted board within the 30-day window, a future admin/recovery endpoint could be added.

---

## Automatic Board Assignment (Save Pipeline)

When a user saves a new bookmark, the backend automatically:

1. Saves the bookmark to Parse
2. Queues async tasks via QStash (summarize, categorize, screenshots, etc.)
3. **New: `assignToBoards`** — Fetches the user's smart/mixed boards with `autoApply: true`, runs Claude AI classification, and auto-assigns the bookmark to matching boards

This happens entirely in the background. No frontend action is needed. The UI should:
- Show a brief loading/pending state on board counts after saving a bookmark
- Refresh board data after a short delay (2-5 seconds) or use a polling/websocket mechanism
- Display AI-assigned bookmarks with a visual indicator (e.g., a sparkle icon for `source: "smart"`)

---

## Frontend Implementation Patterns

### Board List Page

```typescript
// Fetch all user boards
const response = await fetch('/v1/boards', {
  headers: { 'Authorization': `Bearer ${sessionToken}` }
});
const { boards } = await response.json();
```

### Board Detail Page

```typescript
// Fetch board with paginated bookmarks
const response = await fetch(`/v1/boards/${boardId}?limit=50&skip=0`, {
  headers: { 'Authorization': `Bearer ${sessionToken}` }
});
const { board, items, totalBookmarks } = await response.json();
```

### Adding Bookmarks to Board

```typescript
// Add selected bookmarks
const response = await fetch(`/v1/boards/${boardId}/bookmarks`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${sessionToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    websiteIds: selectedBookmarkIds,
    source: 'manual'
  })
});
const { results, created } = await response.json();
// results array contains per-item status for UI feedback
```

### Sharing Flow

```typescript
// 1. Enable link sharing
const response = await fetch(`/v1/boards/${boardId}/sharing`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${sessionToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ visibility: 'link' })
});
const data = await response.json();

if (data.shareToken) {
  // First time — display the share URL and prompt user to copy
  showCopyDialog(data.shareUrl);
}

// 2. Rotate token (invalidates old links)
const rotateResponse = await fetch(`/v1/boards/${boardId}/sharing/rotate-token`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${sessionToken}` }
});
const { shareUrl } = await rotateResponse.json();
showCopyDialog(shareUrl);
```

### Smart Board Workflow

```typescript
// 1. Preview what AI would match
const preview = await fetch(`/v1/boards/${boardId}/smart/preview`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${sessionToken}` }
});
const { suggestions } = await preview.json();
// Show suggestions to user for review

// 2. Apply smart rules (after user confirms)
const apply = await fetch(`/v1/boards/${boardId}/smart/apply`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${sessionToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ limit: 200 })
});
const { created, analyzed, matched } = await apply.json();
// Show summary: "Analyzed 200 bookmarks, matched 15, added 12 new"
```

### Viewing Shared Board (Unauthenticated)

```typescript
// Access via public slug + token
const response = await fetch(
  `/v1/public/boards/${publicSlug}?token=${shareToken}&limit=50`
);
const { board, items, totalBookmarks } = await response.json();
```

### Bookmark Detail — Show Board Badges

```typescript
// Get all boards a bookmark belongs to
const response = await fetch(`/v1/boards/bookmark/${bookmarkId}`, {
  headers: { 'Authorization': `Bearer ${sessionToken}` }
});
const { boards } = await response.json();
// Render board badges/tags on the bookmark card
```

---

## Endpoint Reference (Quick Summary)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/boards` | Yes | Create board |
| `GET` | `/v1/boards` | Yes | List boards |
| `GET` | `/v1/boards/{boardId}` | Yes | Get board + bookmarks |
| `PATCH` | `/v1/boards/{boardId}` | Yes | Update board |
| `DELETE` | `/v1/boards/{boardId}` | Yes | Soft-delete board |
| `POST` | `/v1/boards/{boardId}/bookmarks` | Yes | Add bookmarks |
| `GET` | `/v1/boards/{boardId}/bookmarks` | Yes | List bookmarks |
| `DELETE` | `/v1/boards/{boardId}/bookmarks/{websiteId}` | Yes | Remove bookmark |
| `GET` | `/v1/boards/bookmark/{bookmarkId}` | Yes | Boards for bookmark |
| `POST` | `/v1/boards/{boardId}/smart/preview` | Yes | Preview AI matches |
| `POST` | `/v1/boards/{boardId}/smart/apply` | Yes | Apply smart rules |
| `POST` | `/v1/boards/smart/suggest` | Yes | AI suggestions |
| `PATCH` | `/v1/boards/{boardId}/sharing` | Yes | Update sharing |
| `POST` | `/v1/boards/{boardId}/sharing/rotate-token` | Yes | Rotate token |
| `GET` | `/v1/public/boards/{publicSlug}` | Varies | Public board access |
