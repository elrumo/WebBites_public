# RSS Reader Feature Architecture

Design document for the RSS reader — a feed subscription layer alongside bookmarks, sharing the existing Readability extraction, AI summary and text-to-speech infrastructure.

---

## Design in one paragraph

Feeds and their articles are **shared** across the whole install: one row per canonical feed URL, one row per article, polled and enriched once no matter how many people subscribe. What is per-user is the *subscription* (which feeds you read, what you called them, whether you pay for full-text extraction) and the *read state*. Read state is a hybrid of explicit marks and cutoffs, which is what makes mark-all-read one write instead of one per article. The server computes `isRead` on every row it returns, so the native app and the web app receive a boolean and never reason about cutoffs at all.

Both clients talk to `/v1/rss/*` and nothing else. There is no Parse-direct read path and no LiveQuery in v1, so `parse-compose` needs no changes.

---

## 1. Parse Schema

Classes are auto-created on first write. Every write goes through the master key; clients never write these classes directly.

### `rssFeeds` (new class, shared — public read)

| Field | Type | Description |
|-------|------|-------------|
| `feedUrl` | String | Canonical, normalised feed URL (unique) |
| `siteUrl` | String | The human-facing site the feed belongs to |
| `title` | String | Publisher's feed title |
| `feedDescription` | String | Publisher's description |
| `iconUrl` | String | Feed icon, or a favicon fallback |
| `language` | String | Feed language, when declared |
| `etag` | String | Last `ETag`, replayed as `If-None-Match` |
| `lastModified` | String | Last `Last-Modified`, replayed as `If-Modified-Since` |
| `lastFetchedAt` | Date | Last successful poll |
| `nextFetchAt` | Date | When this feed is next due |
| `fetchIntervalMinutes` | Number | Adaptive cadence, clamped 15m–24h |
| `lastItemAt` | Date | Publication date of the newest item seen |
| `subscriberCount` | Number | Active subscriptions; feeds at 0 are not polled |
| `extractionWanted` | Boolean | Denormalised: ≥1 subscriber has extraction on |
| `failureCount` | Number | Consecutive failed polls |
| `lastError` | String | Last failure message (truncated to 500 chars) |
| `status` | String | `active` / `dead` |

**ACL:** public read, no public write.

**Recommended indexes:** `feedUrl` (unique), `nextFetchAt`, `status + subscriberCount + nextFetchAt`

### `rssItems` (new class, shared — public read)

| Field | Type | Description |
|-------|------|-------------|
| `feed` | Pointer\<rssFeeds\> | Owning feed |
| `dedupKey` | String | `${feedId}:${sha256(guid \|\| link)}` — deterministic upsert key (unique) |
| `guid` | String | The feed's own identity for the item |
| `link` | String | Article URL |
| `title` | String | Article title |
| `author` | String | Byline |
| `publishedAt` | Date | Publication date; falls back to first-seen |
| `rssContentHtml` | String | Body as the feed shipped it, sanitised (~64KB cap) |
| `rssContentText` | String | Plain-text mirror (8000 cap, matching `websites.siteBody`) |
| `imageUrl` | String | Item artwork |
| `extractedFile` | File | Full-text article HTML (mirrors `websites.siteBodyFile`) |
| `extractedFileUrl` | String | Its URL, so clients need no file fetch to know it exists |
| `extractedText` | String | Full-text plain text (8000 cap) |
| `extractionStatus` | String | `none` / `pending` / `done` / `failed` |
| `aiSummary` | Object | Same shape as `websites.aiSummary` |
| `articleAudio` | File | Generated MP3 |
| `articleAudioUrl` | String | Its URL |

**ACL:** public read, no public write. Access control for item routes is "do you have an active subscription to this feed", not an ACL.

**Retention:** newest 300 items or 120 days per feed, whichever bites first.

**Recommended indexes:** `dedupKey` (unique), `feed + publishedAt` (descending)

### `rssSubscriptions` (new class, per-user)

| Field | Type | Description |
|-------|------|-------------|
| `user` | Pointer\<_User\> | Subscriber |
| `feed` | Pointer\<rssFeeds\> | Subscribed feed |
| `subscriptionKey` | String | `${userId}:${feedId}` (unique) |
| `customTitle` | String | User's own name for the feed |
| `extractionEnabled` | Boolean | Automatic full-text extraction (**paid**) |
| `sortOrder` | Number | Sidebar position |
| `unreadCount` | Number | Materialised counter |
| `subscribedAt` | Date | Anything older counts as read |
| `lastMarkAllReadAt` | Date | Anything at or before this counts as read |
| `isDeleted` | Boolean | Soft-delete flag |
| `deletedAt` | Date | For the 30-day purge |

**ACL:** owner read/write, via `makeOwnerAcl` (shared with boards).

**Recommended indexes:** `subscriptionKey` (unique), `user + isDeleted`, `feed + isDeleted`

### `rssReadMarks` (new class, per-user)

| Field | Type | Description |
|-------|------|-------------|
| `user` | Pointer\<_User\> | Reader |
| `item` | Pointer\<rssItems\> | Article read |
| `feed` | Pointer\<rssFeeds\> | Denormalised, so mark-all-read can purge by feed |
| `markKey` | String | `${userId}:${itemId}` (unique) |
| `readAt` | Date | When it was read |

**ACL:** owner read/write.

**Recommended indexes:** `markKey` (unique), `user + feed`

> **Ops note:** Parse auto-creates classes but not the unique and compound indexes above. Create them in Mongo by hand after the first deploy. `dedupKey`, `subscriptionKey` and `markKey` in particular are load-bearing — each one is what makes a concurrent write idempotent instead of a duplicate row.

---

## 2. Read state

An item is read when **any** of these is true:

1. an `rssReadMarks` row exists for `(user, item)`;
2. `item.publishedAt <= subscription.lastMarkAllReadAt`;
3. `item.publishedAt < subscription.subscribedAt`.

Rules 2 and 3 are why the marks table stays small: mark-all-read moves one date and zeroes one counter rather than writing a row per article, and a new subscription does not arrive with a thousand unread articles. Only articles read individually *since* the last mark-all-read need a row, and that set is purged the next time the user marks all read.

The predicate lives in one function (`isItemRead` in `rssUtils.ts`) and is unit-tested; nothing else is allowed to re-derive it.

**Counters.** `rssSubscriptions.unreadCount` is materialised — incremented by the poller, decremented on read — because computing it per request would mean a scan per feed on every sidebar render. Counters drift: six server instances and any number of devices are moving them. Rather than making the read path more expensive to prevent drift, `rss:maintenance` recomputes every counter nightly, and serialisation clamps negatives to zero so a drifted counter never renders as a negative badge.

---

## 3. REST API Endpoints

All routes authenticate with `validateApiKeyFromEvent` — a bearer API key — which covers the native app's `BackendBClient` and the web app's cookie proxy with no change to either. All carry `defineRouteMeta` OpenAPI specs and render at `/_docs/scalar`.

### Subscriptions
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/rss/subscriptions` | Subscribe by feed URL, site URL or bare hostname |
| `GET` | `/v1/rss/subscriptions` | List active subscriptions + `totalUnread` |
| `PATCH` | `/v1/rss/subscriptions/{subscriptionId}` | Rename, reorder, toggle extraction (**plan-gated**) |
| `DELETE` | `/v1/rss/subscriptions/{subscriptionId}` | Unsubscribe (soft-delete) |

### Articles
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/rss/items` | List rows; `subscriptionId?`, `unreadOnly?`, `limit≤100`, `cursor` |
| `GET` | `/v1/rss/items/{itemId}` | Full article detail |
| `POST` | `/v1/rss/items/{itemId}/read` | Mark read (idempotent) |
| `POST` | `/v1/rss/items/{itemId}/unread` | Mark unread |
| `POST` | `/v1/rss/markAllRead` | Mark one feed or all feeds read |

### Enrichment
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/rss/items/{itemId}/summary` | Generate or return a cached AI summary |
| `POST` | `/v1/rss/items/{itemId}/audio` | Signed TTS endpoint, or a cached MP3 URL |

### Discovery & portability
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/rss/discover?query=` | Resolve a URL, or search the shared feed catalogue |
| `POST` | `/v1/rss/opml/import` | Import an OPML subscription list |
| `GET` | `/v1/rss/opml/export` | Export subscriptions as OPML 2.0 |

**List vs detail.** `GET /v1/rss/items` returns no article bodies. A page of fifty rows carrying 64KB of HTML each would be a 3MB response for a list view that shows two lines per row. Bodies arrive with `GET /v1/rss/items/{itemId}` when an article opens.

**Pagination.** Cursor-based on `(publishedAt, objectId)` — the tie-break matters because feeds routinely publish a batch of items sharing one timestamp, and a cursor on the timestamp alone would either skip or repeat them. The cursor tracks the last row *scanned*, not the last row returned, so an unread-only page that filters most of its candidates out still makes forward progress.

---

## 4. Polling & extraction pipeline

```
rss:pollFeeds (cron */10)
  └─ Redis lock  ──────────────────── mandatory: prod runs 6 Nitro instances
       └─ select feeds where nextFetchAt <= now
                        and subscriberCount > 0
                        and status != 'dead'
            └─ QStash batch: rss-feed-poll-requests (one message per feed)
                 └─ conditional GET (ETag / If-Modified-Since, browser headers)
                      ├─ 304 → schedule next fetch, done
                      ├─ error → failureCount++, exponential backoff, maybe 'dead'
                      └─ 200 → parseFeed() → upsert by dedupKey
                           ├─ increment unreadCount on active subscriptions
                           ├─ adapt fetchIntervalMinutes
                           └─ if feed.extractionWanted:
                                QStash: rss-item-extract-requests  (≤20 items/poll)
                                  └─ getUnifiedPageContent({url, returnContent:true})
                                       └─ store extractedFile / extractedText
                                            └─ auto AI summary → rssItems.aiSummary
```

**The Redis lock is not optional.** Nitro's scheduler is per-process and production runs six instances, so every cron entry fires six times. `SET rss:poll:lock NX EX 540` means one instance does the round. Without it, each tick would enqueue six copies of every feed — and behind each of those, six page fetches and six OpenAI calls. If Redis is unavailable the task *skips* rather than running unlocked: six duplicate polls cost real money at the extraction stage.

**Adaptive cadence.** A feed that published on the last poll halves its interval; a quiet one multiplies by 1.5. Both clamped to 15m–24h. Failures back off exponentially, and twelve consecutive failures demote a feed to `dead`, which takes it out of the schedule entirely.

**The 20-items-per-poll extraction cap** exists for a feed's *first* poll with extraction on, which can import a whole page of back catalogue at once. Newest items are extracted first, because those are the ones a reader is most likely to open. Steady-state polls rarely see more than a handful of new items, so the cap never binds. When it does bind it is logged, never silent.

**Runs are logged** to the Parse `TaskExecution` class, the same place `syncService` logs, so RSS rounds show up in the existing task dashboard.

---

## 5. Paid extraction gate

`extractionEnabled: true` on a subscription requires the `rssAutoExtract` plan feature. The Plus tier grants it (`PLAN_FEATURES` in `utils/plans.ts`). A `plans.rssAutoExtractEnabled` column, when present, overrides the tier for that row. Without the feature, the PATCH answers **403** with:

```json
{ "success": false, "message": "…", "error": "…", "errorType": "UsageError", "quotaKind": "rssAutoExtract" }
```

That is deliberately the shape `streamAudio` returns when the audio quota is exhausted, because both clients already route `errorType: "UsageError"` into their upgrade flow.

Two details this depends on:

- **`errorType` sits at the top level**, not inside h3's `data` envelope. Both clients test `json.errorType === 'UsageError'`, and `createError({ data })` would bury it a level down where neither looks — so these routes pair `setResponseStatus(event, 403)` with a plain returned body instead of throwing.
- **`quotaKind` is additive.** `streamAudio` omits it and clients fall back to the audio quota, which is what `UsageError` has always meant. It exists so the extraction gate can say what the user actually hit rather than borrowing the audio wording.

Only the *transition to on* is gated — a user whose plan lapsed can always turn extraction back off.

On-demand summaries and on-demand TTS are **not** gated; they stay available to everyone under the existing quotas.

> **Ops note:** nothing to set. The tier decides. Only add `rssAutoExtractEnabled` to a `plans` row to override the tier for that row.

---

## 6. Audio: sharing `streamAudio` with bookmarks

`streamAudio.ts` was written for bookmarks and writes its finished MP3 to `websites.articleAudio`. The audio token payload now carries `targetType`, which decides where the MP3 lands:

| `targetType` | Written to |
|--------------|-----------|
| `website` (**default**) | `websites.articleAudio` |
| `rssItem` | `rssItems.articleAudio` + `articleAudioUrl` |

**The default matters.** Tokens stay valid for ten minutes, so tokens minted before a deploy are still being redeemed after it. `targetType` absent must mean `website`, or in-flight bookmark playback breaks across every deploy.

Token minting now lives in `buildAudioStreamEndpoint` (`server/utils/audio-auth.ts`) and both routes call it, so the two cannot drift on token shape, expiry or text compression — the reader on the other end is one handler that has to understand both.

Because audio is cached on the shared `rssItems` row, the *second* listener of an article gets `cached: true` and spends no quota. The cache is checked **before** the quota check, deliberately: replaying audio that already exists should never cost a generation.

---

## 7. Feed parsing

`server/utils/rssParser.ts` is pure — strings in, plain objects out, no Parse, no network, no filesystem — which is what makes it testable against fixtures. It normalises three formats users neither know nor care about:

| Format | Root | Items |
|--------|------|-------|
| RSS 2.0 | `<rss><channel>` | `<item>` |
| Atom 1.0 | `<feed>` | `<entry>` |
| RDF / RSS 1.0 | `<rdf:RDF><channel>` | `<item>` as a channel *sibling* |

`fast-xml-parser` with `removeNSPrefix` handles the namespace zoo (`content:encoded` → `encoded`, `dc:creator` → `creator`). The same module parses and writes OPML.

Details that took a fixture to get right, all covered by `rssParser.test.ts`:

- `content:encoded` beats `<description>` — the latter is usually a teaser.
- Atom `<link rel="self">` points at the XML; readers need `rel="alternate"`.
- `<guid isPermaLink="true">` doubles as the item link on many feeds.
- Plain-text fields (item title and author, feed title and description) get **one** full HTML decode at ingest, `plain()` in the parser: numeric, hex and HTML5 named references. The XML parser only resolves the five XML entities and never looks inside CDATA, so `Fortune&#8217;s` used to reach clients escaped. `rssContentText` gets the same decoder through `htmlToText`, and `rssContentHtml` is left alone. A decoded title can contain a literal `<script>`, so every client must render these fields as text, never as HTML. `guid`, and so `dedupKey`, is hashed from the raw value, so this change did not re-key any stored item. Rows written before the change were fixed once by `scripts/decode-rss-entities.ts`. It skips rows marked `entitiesDecoded`, which the ingest code sets, because a second decode turns `&amp;lt;` into `<`.
- Dates far in the future pin an item to the top of every list forever; anything past tomorrow is treated as unusable.
- An item with no usable date is dated *now* rather than null, because both clients sort on `publishedAt`.
- Item artwork falls back to the first `<img>` in the body — most WordPress feeds ship no media element but open the post with a photo.

Unparseable feeds are logged and backed off via `failureCount`; they never fail a whole polling round.

---

## 8. Soft delete & retention

| What | Policy |
|------|--------|
| `rssSubscriptions` | Soft-deleted on unsubscribe; hard-deleted after 30 days |
| `rssItems` | Newest 300 or 120 days per feed, whichever bites first |
| `rssReadMarks` | Purged per feed on mark-all-read; the cutoff makes them redundant |

Resubscribing within the 30-day window **revives** the existing row rather than creating a duplicate — the same pattern boards use, and what the unique `subscriptionKey` requires. A revived subscription resets `subscribedAt`, so a user does not come back to a wall of unread articles from the months they were away.

Items are shared, so unsubscribing never deletes an article another subscriber may still be reading. Retention in `rss:maintenance` is the only thing that deletes items. Read marks pointing at purged items are harmless — the lookup is keyed by item id and simply never matches again.

---

## 9. Files Reference

| File | Role |
|------|------|
| `server/utils/rssParser.ts` | Pure feed + OPML parsing, URL normalisation, autodiscovery |
| `server/utils/rssParser.test.ts` | Fixture tests — `npm run test:rssParser` |
| `server/utils/rssUtils.ts` | Parse queries, ACLs, read state, counters, serialisers, Redis lock |
| `server/utils/rssUtils.test.ts` | Read-state and helper tests — `npm run test:rssUtils` |
| `server/utils/rssService.ts` | Fetching, discovery, subscribe, poll, extraction, OPML import |
| `server/types/rss.types.ts` | Wire types — the shapes both clients decode |
| `server/routes/v1/rss/**` | The twelve REST endpoints |
| `server/tasks/rss/pollFeeds.ts` | `rss:pollFeeds`, every 10 minutes |
| `server/tasks/rss/maintenance.ts` | `rss:maintenance`, daily at 04:00 |
| `server/routes/qstash-webhook.post.js` | Dispatches the three `rss-*` message types |
| `server/utils/audio-auth.ts` | Shared audio token minting (`targetType`) |

---

## 10. Deployment checklist

1. Deploy. Parse creates the four classes on first write.
2. Create the Mongo indexes listed in §1 by hand, especially the four unique ones. Parse's schema API cannot create unique indexes. `createIndex` fails if duplicates already exist; fix those first.
   ```js
   db.rssFeeds.createIndex({ feedUrl: 1 }, { unique: true })
   db.rssItems.createIndex({ dedupKey: 1 }, { unique: true })
   db.rssSubscriptions.createIndex({ subscriptionKey: 1 }, { unique: true })
   db.rssReadMarks.createIndex({ markKey: 1 }, { unique: true })
   ```
3. Once only: `bun run scripts/decode-rss-entities.ts`, then run it again with `--apply` (see §7).
4. Confirm `VITE_WEBBITES_AUTH_REDIS_HOST` is reachable from every instance; without Redis the poller skips every round rather than running six times.
5. Watch `TaskExecution` for `rss:pollFeeds` — one row per tick, not six.

---

## Not in v1

- **LiveQuery push for unread badges.** Would need `rssSubscriptions` added to the allowlist in `parse-compose/src/config.js`. v1 refreshes on foreground and after writes.
- **An external feed directory.** Name search covers the organically grown shared catalogue — every feed any WebBites user reads — plus live URL autodiscovery. An obscure blog will not be found by name until someone subscribes to it by address, which is why the "subscribe to this address" affordance stays visible next to empty results.
- **"Save article to WebBites"**, bridging an RSS item into a bookmark.
