# Boards Feature Architecture

Design document for the Bookmark Boards feature — an organizational layer on top of the existing `websites` class with manual, smart (AI-driven), and mixed modes.

---

## Current Bookmark Model (baseline)

- Bookmarks are stored in Parse class `websites` (`Parse.Object.extend("websites")`).
- Users link to bookmarks via a `savedSites` relation.
- Save flow: `server/routes/v1/content/saveBookmark.ts` → saves website → triggers QStash async pipeline (categorise, summarise, screenshots, etc.)

Boards are layered as a new organizational abstraction over existing `websites` objects.

---

## 1. Parse Schema

### `boards` (new class)

| Field | Type | Description |
|-------|------|-------------|
| `owner` | Pointer<_User> | Board owner (required) |
| `name` | String | Board name (max 100 chars, required) |
| `description` | String | Board description (max 1000 chars) |
| `color` | String | Hex color code |
| `icon` | String | Icon identifier |
| `mode` | String | `manual` / `smart` / `mixed` (required) |
| `smartRules` | Object | Smart filter configuration (see below) |
| `bookmarkCount` | Number | Cached count of active memberships |
| `visibility` | String | `private` / `link` / `email_list` / `email_domain` (default: `private`) |
| `visibilityConfig` | Object | Sharing configuration (see below) |
| `publicSlug` | String | UUID for public URLs (generated on create) |
| `isDeleted` | Boolean | Soft-delete flag (default: `false`) |
| `deletedAt` | String | ISO timestamp of deletion (for auto-purge) |

**`smartRules` schema:**
```json
{
  "topics": ["UI Design", "Typography"],
  "confidenceThreshold": 0.6,
  "autoApply": true,
  "includeExisting": false
}
```

**`visibilityConfig` schema:**
```json
{
  "tokenHash": "sha256-of-raw-share-token",
  "tokenLastRotatedAt": "2026-02-16T...",
  "allowedEmails": ["user@example.com"],
  "allowedDomains": ["company.com"]
}
```

**Recommended indexes:** `owner`, `owner + mode`, `publicSlug` (unique), `isDeleted + deletedAt`

### `boardBookmarks` (new join class)

| Field | Type | Description |
|-------|------|-------------|
| `owner` | Pointer<_User> | Denormalized for fast auth filtering |
| `board` | Pointer<boards> | Board reference |
| `website` | Pointer<websites> | Bookmark reference |
| `source` | String | `manual` or `smart` |
| `aiTopic` | String | Matching topic (when source=smart) |
| `aiConfidence` | Number | AI confidence score (0-1) |
| `membershipKey` | String | `${boardId}:${websiteId}` — deterministic dedup key |
| `isDeleted` | Boolean | Soft-delete flag |
| `deletedAt` | String | ISO timestamp of deletion |

**Why a join class instead of a Parse Relation?**
- Metadata per-membership (source, AI confidence, topic)
- Deterministic `membershipKey` for idempotent upserts
- Soft-delete and reactivation support
- Filter by source (`manual` vs `smart`)

**Recommended indexes:** `owner + board`, `owner + website`, `membershipKey` (unique), `isDeleted + deletedAt`

---

## 2. ACL & Security Model

### Authentication
All board endpoints (except public board access) require a valid Parse session token via `Authorization: Bearer <sessionToken>` header. Authentication is handled by `validateParseToken()` from `server/utils/raycast-auth.js`, which verifies the session and returns the user object.

### ACL
- `boards`: owner read/write only. Created via `makeOwnerAcl(userId)`.
- `boardBookmarks`: owner read/write only.
- `websites`: existing ownership model (unchanged).

### Share Token Security
- Raw share tokens are **never stored**. Only SHA-256 hashes are persisted in `visibilityConfig.tokenHash`.
- Verification uses `crypto.timingSafeEqual` to prevent timing attacks.
- Token rotation immediately invalidates the old token.
- Public access endpoint enforces policy per visibility level.

### Sharing Access Policies
| Visibility | Access Rule |
|------------|-------------|
| `private` | Always 403 on public endpoint |
| `link` | Validate `?token=` query param against stored hash |
| `email_list` | Require authenticated user with email in allowlist |
| `email_domain` | Require authenticated user with matching email domain |

---

## 3. REST API Endpoints

### Board CRUD
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/boards` | Create a board |
| `GET` | `/v1/boards` | List user's boards |
| `GET` | `/v1/boards/{boardId}` | Get board with bookmarks |
| `PATCH` | `/v1/boards/{boardId}` | Update board settings |
| `DELETE` | `/v1/boards/{boardId}` | Soft-delete board |

### Bookmark Membership
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/boards/{boardId}/bookmarks` | Add bookmarks to board |
| `GET` | `/v1/boards/{boardId}/bookmarks` | List bookmarks in board |
| `DELETE` | `/v1/boards/{boardId}/bookmarks/{websiteId}` | Remove bookmark (soft-delete) |
| `GET` | `/v1/boards/bookmark/{bookmarkId}` | Get boards for a bookmark |

### Smart / AI
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/boards/{boardId}/smart/preview` | Preview AI matches (dry run) |
| `POST` | `/v1/boards/{boardId}/smart/apply` | Apply smart rules (create memberships) |
| `POST` | `/v1/boards/smart/suggest` | AI board suggestions + new board ideas |

### Sharing
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/v1/boards/{boardId}/sharing` | Update visibility settings |
| `POST` | `/v1/boards/{boardId}/sharing/rotate-token` | Rotate share token |
| `GET` | `/v1/public/boards/{publicSlug}` | Public board access (no auth for `link`) |

### Internal (QStash Pipeline)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/boards/internal/assignToBoards` | Auto-assign bookmark to boards |

---

## 4. AI Integration (Claude)

All AI features use **Claude** (via `askClaude` from `serverUtils.ts`) with rate-limited queue (`ClaudeRequestQueue`).

### Model
- **claude-haiku-4-5** for all board operations (fast, cost-effective for classification)
- Forced JSON output via tool_use pattern
- 60-second timeout per request

### Auto-Assignment Flow (Save Pipeline)
```
User saves bookmark
  → saveBookmark.ts saves website to Parse
  → QStash queues async operations:
      • getPageContent
      • categoriseSite
      • getAiSummary
      • checkForAdultContent
      • getScreenshots
      • assignToBoards  ← NEW
  → qstash-webhook.post.js routes 'assignToBoards'
      → /v1/boards/internal/assignToBoards
      → Fetches user's smart/mixed boards with autoApply=true
      → If none → no-op
      → If boards exist → Claude classifies bookmark against board topics
      → Creates boardBookmarks for matches above threshold
```

### AI topics with Jev (optional)
`AI_TOPIC_MATCHER=jev` decides `ai_topic` conditions — automations on save and smart-board preview/apply — and the board assignments of `/v1/boards/smart/suggest` with TypeSafe's **Jev** instead of the text model (`server/utils/jevTopics.ts`, `automations.ts`, `suggest.post.ts`). Naming new boards (`suggestNewBoards`) stays on the text model.

- Called through the LiteLLM proxy's TypeSafe pass-through, `POST {LITELLM_API_BASE_URL}/typesafe/v1/systemone`, with `LITELLM_API_KEY` (`askJev` in `aiClients.ts`). The proxy needs LiteLLM ≥ 1.103 and `TYPESAFE_API_KEY` set on it; the backend never holds a TypeSafe key.
- One yes/no question per distinct topic, with the bookmark (title, description, summary, URL, type, tags, first 2,000 characters of page text) as state. The page text matters on save: automations run before the summary is written. In suggest, a board without topics stands for its name. A rule matches when its best topic's probability reaches the rule's threshold; that probability is stored as `aiConfidence`.
- Backfill makes one call per undecided bookmark, 8 at a time.
- `LITELLM_JEV_MODEL` picks the model (default `jev-latest`). Pin a version such as `jev-1.13.0` once thresholds are tuned.
- If a Jev call fails, that match falls back to the text model.
- **Pictures.** Jev is multimodal ([docs](https://docs.typesafe.ai/images), "Dreamer-ready" so the format may change). The tag pick in `categoriseSite`, the `ai_topic` match and the suggest/backfill calls put the bookmark's picture in the state: an image bookmark's own pictures (up to 4), otherwise the page's `siteScreenshot`, else its `OGImage` (`utils/jevImages.ts`). Each is fetched with `safeFetch`, turned upright, resized to ≤1568 px and re-encoded as a baseline JPEG, because Jev rejects anything outside PNG/JPEG, 256–1568 px per side and 78,400 px. Pictures go in the JSON body as base64 `assets`; `askJev` adds the `TypeSafe-Danger-Zone-Images: true` header. LiteLLM's built-in `/typesafe` route drops that header (releases through 1.107.0-dev.2; forwarding is only on `main`), so set `LITELLM_JEV_IMAGES_PATH=/typesafe-images/v1/systemone` and give the proxy a custom pass-through that forwards client headers:

  ```yaml
  general_settings:
    pass_through_endpoints:
      - path: "/typesafe-images/v1/systemone"
        target: "https://api.typesafe.ai/v1/systemone"
        headers:
          Authorization: "Bearer os.environ/TYPESAFE_API_KEY"
        forward_headers: true
  ```

  Image requests use that path; text requests keep the built-in route. If the image request fails, or no picture fits, the same request is retried text-only. `JEV_IMAGES=false` turns pictures off.
- **Uploaded images** used to skip all of the above. `getImageTags` now also picks the user's own tags that fit the picture (`JEV_TAGS`), then queues `runAutomations`, so smart boards and `ai_topic` rules apply to uploads. It queues only on the first tagging pass of a bookmark, so adding images later does not re-fire webhooks.

### Suggestion Flow
- `/v1/boards/smart/suggest` — analyzes user's bookmarks, suggests existing board assignments + new board ideas
- `/v1/boards/{boardId}/smart/preview` — dry-run showing which bookmarks would match
- `/v1/boards/{boardId}/smart/apply` — creates actual memberships for matches

---

## 5. Soft Delete & Auto-Purge

### Strategy
- All deletes are **soft**: set `isDeleted=true` and `deletedAt=now`.
- Soft-deleted records are invisible to all queries (filtered via `notEqualTo('isDeleted', true)`).
- Board deletion cascades: all associated `boardBookmarks` are also soft-deleted.
- Bookmark removal from a board soft-deletes the `boardBookmarks` entry.
- Re-adding a previously removed bookmark **reactivates** the soft-deleted membership.

### Auto-Purge
- A Nitro scheduled task (`boards:purgeDeleted`) runs daily at 3:00 AM.
- Hard-deletes `boardBookmarks` and `boards` where `deletedAt` is > 30 days ago.
- Purges in batches of 100 to avoid memory pressure.
- Defined in `server/tasks/boards/purgeDeleted.ts`.
- Registered in `nitro.config.ts` → `scheduledTasks`.

---

## 6. Data Migration Plan

1. Parse classes `boards` and `boardBookmarks` are auto-created on first use.
2. Add indexes and unique constraints on `membershipKey` and `publicSlug`.
3. No migration needed for existing `websites` class — boards are a layer on top.
4. Optionally backfill a default "Inbox" board for existing users.

---

## 7. Rollout Phases

| Phase | Features | Risk |
|-------|----------|------|
| **1** | Manual boards + CRUD + membership | Low |
| **2** | Smart preview + apply for existing bookmarks | Medium (AI cost) |
| **3** | Save-flow auto-assignment via QStash | Medium (latency) |
| **4** | Sharing (link + token rotation) | Low |
| **5** | Email/domain sharing policies | Low |
| **6** | Board suggestions + new board recommendations | Low |

---

## 8. Files Reference

| File | Purpose |
|------|---------|
| `server/types/board.types.ts` | TypeScript interfaces |
| `server/utils/boardUtils.ts` | Parse queries, ACL, auth, soft-delete, serialization |
| `server/routes/v1/boards/index.post.ts` | Create board |
| `server/routes/v1/boards/index.get.ts` | List boards |
| `server/routes/v1/boards/[boardId].get.ts` | Get board |
| `server/routes/v1/boards/[boardId].patch.ts` | Update board |
| `server/routes/v1/boards/[boardId].delete.ts` | Delete board |
| `server/routes/v1/boards/[boardId]/bookmarks/index.post.ts` | Add bookmarks |
| `server/routes/v1/boards/[boardId]/bookmarks/index.get.ts` | List bookmarks |
| `server/routes/v1/boards/[boardId]/bookmarks/[websiteId].delete.ts` | Remove bookmark |
| `server/routes/v1/boards/[boardId]/smart/preview.post.ts` | Preview matches |
| `server/routes/v1/boards/[boardId]/smart/apply.post.ts` | Apply rules |
| `server/routes/v1/boards/smart/suggest.post.ts` | AI suggestions |
| `server/routes/v1/boards/[boardId]/sharing.patch.ts` | Update sharing |
| `server/routes/v1/boards/[boardId]/sharing/rotate-token.post.ts` | Rotate token |
| `server/routes/v1/boards/bookmark/[bookmarkId].get.ts` | Boards for bookmark |
| `server/routes/v1/boards/internal/assignToBoards.post.ts` | QStash auto-assign |
| `server/routes/v1/public/boards/[publicSlug].get.ts` | Public access |
| `server/tasks/boards/purgeDeleted.ts` | Scheduled purge task |
| `server/routes/qstash-webhook.post.js` | Webhook routing (modified) |
| `server/routes/v1/content/saveBookmark.ts` | Save flow (modified) |
| `nitro.config.ts` | Scheduled task registration (modified) |
