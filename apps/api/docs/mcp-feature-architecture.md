# MCP Server Architecture

The WebBites MCP server lets AI assistants — claude.ai, Claude Desktop and mobile, Claude Code,
ChatGPT, Cursor, VS Code — search, read and save into a user's library over the
[Model Context Protocol](https://modelcontextprotocol.io). This document covers the cloud server in
this repo: the `/mcp` endpoint, the OAuth 2.1 authorization server connectors sign in through, and
the tools. Libraries without an account live on the Mac and get a local stdio server from the Mac app
instead; that half is documented in `webbites-native/docs/MCP.md`.

---

## Design in one paragraph

`POST https://api.webbites.io/mcp` speaks MCP over Streamable HTTP, statelessly, one JSON response
per request — no SSE, no sessions, nothing kept between requests. It serves the current revision
(2026-07-28: per-request versioning, `server/discover`, mirrored `Mcp-*` headers) and the older
`initialize`-based ones side by side, deciding per request. Every request carries a bearer token:
either a WebBites API key (`wb_live_…`, full access, for clients that take a header) or an OAuth
access token (`wbo_at_…`) from our own authorization server (for connectors, scoped to what the
user approved on a consent page at webbites.io). The eleven tools are thin layers over the same
helpers the app's routes use — search, boards, notes, edits, trash — so an assistant sees exactly
what the app shows, minus the trash and hidden bookmarks. Every tool call counts against the
developer-API allowance of the user's plan.

```
 assistant ──POST /mcp (Bearer)──▶ routes/mcp.ts
                                     │ originAllowed · authenticateMcpRequest (utils/mcpAuth.ts)
                                     ▼
                              utils/mcpProtocol.ts   pure: eras, headers, JSON-RPC, errors
                                     │ McpHandlers
                                     ▼
                              utils/mcpTools.ts      scope check · validate · meter · run
                                     │
        ┌──────────────┬─────────────┼──────────────┬───────────────┬──────────────┐
  bookmarkSearch   tagList      boardUtils      textNotes      bookmarkEdits   SaveBookmark
  (Meilisearch)   (facets)   (boards, members)  (notes)    (edit, trash)    (+ enrichment)
```

---

## 1. The endpoint

| | |
|---|---|
| URL | `POST /mcp` (`server/routes/mcp.ts`) |
| Transport | Streamable HTTP, JSON responses only. `GET`/`DELETE` → `405 Allow: POST`. `Mcp-Session-Id` and `Last-Event-ID` are ignored. |
| Auth | `Authorization: Bearer <wb_live_… or wbo_at_…>`, nothing else (no cookie, no Parse session, no internal key) |
| Origin | A present but malformed or `null` `Origin` → 403 (DNS-rebinding guard). Any real origin is fine: nothing ambient is read. |
| Route access | Listed in `ROOT_PUBLIC` (`utils/apiRouteAccess.ts`) because it authenticates itself — its 401 must carry the `WWW-Authenticate` challenge the shared gate doesn't send |
| CORS | `server/middleware/cors-mcp.ts`: preflight, `Authorization` and the `Mcp-*` headers allowed, `WWW-Authenticate` exposed |

### Protocol versions

`utils/mcpProtocol.ts` is pure (no h3, Parse or Redis) and decides everything from the request:

| Request | Era | Rules |
|---|---|---|
| `params._meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"` | modern | `MCP-Protocol-Version` and `Mcp-Method` headers must equal the body (and `Mcp-Name` the tool name, base64 sentinel decoded) or **400 / -32020**. Unknown version **400 / -32022** with `supported`. Unknown method **404 / -32601**. Results carry `resultType: "complete"`; `tools/list` and `server/discover` carry `ttlMs` and `cacheScope`. |
| `initialize` | legacy | Answered with the client's version if it is 2025-11-25, 2025-06-18 or 2025-03-26, else 2025-11-25. No session is minted. |
| anything else without `_meta` version | legacy | Version from the header, or 2025-03-26 without one. Batches only for 2025-03-26. Unknown method 200 / -32601. |

Notifications (and client responses, which we never ask for) get **202** with no body.

### Errors a model sees vs. errors a client sees

Protocol problems (malformed JSON-RPC, unknown tool, header mismatch) are JSON-RPC errors. Anything
the model can fix — a bad argument, an unknown bookmark id, a spent allowance, a full plan — is a
tool result with `isError: true` and a sentence saying what to do. A crash inside a tool is a tool
error too ("try again"), logged and sent to Sentry.

---

## 2. Tools

The contract is **`docs/mcp-tools.json`**: names, descriptions, input schemas (JSON Schema 2020-12,
`additionalProperties: false`), annotations and output shapes. The Mac app's local server
implements the same file; each repo has a test comparing its catalogue against its copy, so change
both together. `utils/mcpToolCatalogue.ts` serves the contract with output schemas and validates
arguments; `utils/mcpTools.ts` runs them.

| Tool | Writes | Built on |
|---|---|---|
| `search_bookmarks` | | `searchUserBookmarks` (`utils/bookmarkSearch.ts`): hybrid when there's a query and embeddings are configured, keyword otherwise; typed tag/type filters (`utils/searchFilters.ts`); dates checked on the hits |
| `get_bookmark` | | `findVisibleBookmark`, `getBookmarkBoardMemberships`; `include_content` returns `siteBody` clipped to `max_chars` |
| `list_boards` | | `getUserBoards` |
| `list_board_bookmarks` | | `getOwnedBoardOrThrow`, `getBoardBookmarkEntries` (+ `hiddenFrom: library` dropped), `countBoardBookmarks` |
| `list_tags` | | `listUserTags` (`utils/tagList.ts`) |
| `save_bookmark` | ✓ | existing visible bookmark of the URL → `already_saved`; else `SaveBookmark().saveBookmark({ savedFrom: 'mcp' })` + `enqueueEnrichment`, as the developer API does |
| `save_note` | ✓ | `createTextNote` (`utils/textNotes.ts`) with `plainTextToNoteHtml` (escaped) |
| `update_bookmark` | ✓ | `updateBookmarkFields` (`utils/bookmarkEdits.ts`): title, note, tags (replace / add / remove), pin |
| `create_board` | ✓ | `createBoard` (`utils/boardUtils.ts`), manual boards only |
| `add_to_board` | ✓ | `addBookmarksToBoardForUser` (ownership-checked, hidden excluded) |
| `delete_bookmark` | ✓ | `trashBookmarkForUser` → `softDeleteBookmarks` (30-day trash, quota freed) |

### What an assistant can't see

The developer API's rule, for the same reason: a token held by an assistant is a wider audience
than the user's own screen. Every lookup is scoped to the owner and leaves out bookmarks in the
trash and bookmarks hidden at either level (`library` or `everywhere`) — including on boards,
where the app itself keeps library-hidden bookmarks. A hidden or trashed id answers exactly like an
id that doesn't exist.

### Write gating

`tools/list` leaves the six write tools out for a caller without `bookmarks:write`
(`cacheScope: "private"`, as the spec allows lists to vary by authorization). Calling one anyway
gets **403** with
`WWW-Authenticate: Bearer error="insufficient_scope", scope="bookmarks:read bookmarks:write", resource_metadata=…`
so the client can ask the user again (step-up).

### Untrusted text

Titles, notes, descriptions and page text were written by other people. The server's
`instructions` tell the model to treat them as data, not instructions, and to ask before deleting;
`delete_bookmark` is annotated destructive and only moves one bookmark to the trash per call.
Results are kept small and textual — no images, files, colours or HTML.

---

## 3. Authentication on `/mcp`

`utils/mcpAuth.ts`:

| Token | Checked by | Scopes | Metered as |
|---|---|---|---|
| `wb_live_…` | `validateApiKey` | read + write | rate `api_rate:<key>`, usage field `key:<key>` |
| `wbo_at_…` | `validateAccessToken` (`utils/oauthStore.ts`) + audience must be `${MCP_ISSUER}/mcp` | as approved | rate `api_rate:grant:<id>`, usage field `grant:<id>` |
| anything else | — | — | 401 `invalid_token` |

- No or bad token → **401** with
  `WWW-Authenticate: Bearer resource_metadata="https://api.webbites.io/.well-known/oauth-protected-resource/mcp", scope="bookmarks:read bookmarks:write"`
  (plus `error="invalid_token"` for a bad one). That challenge is how a connector finds our OAuth server.
- Redis unreachable → **503** with `Retry-After`, never 401: a 401 sends the client back through
  sign-in, over and over, for nothing.
- `wbo_` tokens never work as API keys on `/v1/*` (`validateApiKey` refuses the prefix).

---

## 4. The OAuth 2.1 authorization server

Issuer: `MCP_ISSUER` (default `https://api.webbites.io`). Always from configuration, never from the
`Host` header — these URLs end up in metadata and token audiences.

### Discovery

| Path | Document |
|---|---|
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728, `resource: https://api.webbites.io/mcp` |
| `/.well-known/oauth-protected-resource` | the same for the origin (clients that look there first) |
| `/.well-known/oauth-authorization-server` | RFC 8414: endpoints, `S256`, `client_id_metadata_document_supported`, `authorization_response_iss_parameter_supported` |

Route scanning skips dot-directories, so these live in `server/wellKnown/` and are registered in
`nitro.config.ts` → `handlers`.

### Clients

- **Client ID Metadata Documents** (preferred by MCP): the `client_id` is an HTTPS URL. We fetch it
  through `safeFetch` (public addresses only), with no redirects, a 5 s timeout and a 5 KB cap; it
  must name its own URL as `client_id`, list valid redirect URIs, and be public
  (`token_endpoint_auth_method: none`). Cached in Redis for its `max-age`, at most 24 h.
  The consent page shows these as verified, with the URL's host.
- **Dynamic Client Registration** (`POST /oauth/register`, RFC 7591; deprecated in MCP, still what
  many clients do): anyone may register, 300 per address per hour (claude.ai and chatgpt.com share
  egress IPs). Clients that don't say otherwise are public; `client_secret_post`/`_basic` get a
  secret, stored hashed. Unused clients expire after 30 days. The consent page labels these
  **unverified**.

Redirect URIs (`checkRedirectUri`): `https` anywhere; `http` only on `localhost`, `127.0.0.1` or
`[::1]`, matched on any port (RFC 8252 §7.3); private-use app schemes (`cursor://…`) except a
denylist (`javascript`, `data`, `file`, …). Never a fragment or userinfo. Matched exactly otherwise.

### The flow

```
client                         api.webbites.io                         webbites.io (browser)
  │ GET /oauth/authorize ─────────▶ resolve client, check redirect_uri,
  │  (PKCE S256, state, resource)    response_type, PKCE, resource
  │                                  → oauth_req:<id> (30 min)
  │                         ◀── 302 ── /oauth/authorize?request=<id> ─────▶ consent page
  │                                                                         │ signs in if needed
  │                                  GET /v1/oauth/requests/:id ◀─────────── │ (client, redirect,
  │                                                                         │  scopes, csrf)
  │                                  POST /v1/oauth/authorize/confirm ◀──── │ Approve / Decline
  │                                   csrf ✓, request taken (single use)    │ + "Allow changes"
  │                                   → oauth_code:<sha> (60 s)             │
  │ ◀────────── redirect_uri?code&state&iss ─────────────────────────────── │
  │ POST /oauth/token (code + verifier) ─▶ PKCE ✓, code taken (GETDEL)
  │                                     → oauth_grant:<id>, access (1 h) + refresh (90 d)
  │ ◀─────────────────────────────────── tokens
```

Before the client and its redirect URI check out, errors go to our own error page
(`webbites.io/oauth/authorize?error=…`), never to the redirect URI — that would be an open
redirect. After, they go back to the client with `state` and `iss` (RFC 9207). `resource` must be
the MCP endpoint, its trailing-slash twin or the origin; tokens are always bound to the endpoint.

The grant is created when the code is exchanged, not when the user approves, so a consent that
never reaches the token endpoint leaves nothing behind in Settings.

### Tokens

| | Lifetime | Notes |
|---|---|---|
| Authorization code | 60 s | single use (`GETDEL`), bound to client, redirect URI, PKCE challenge, resource |
| Access token | 1 h | `wbo_at_…` |
| Refresh token | 90 days | `wbo_rt_…`, rotated on every use. A rotated token presented again within 30 s (a retried refresh whose answer was lost) gets another pair; after that it is a replay and the whole grant is revoked. |

Scopes: `bookmarks:read`, `bookmarks:write` (write implies read). No scope requested → both, and
the consent page decides. Unknown scopes (`openid`, `offline_access`) are dropped, not refused; the
token response says what was granted.

### Revocation

- `POST /oauth/revoke` (RFC 7009): either token ends the whole connection, for the client it was
  issued to; always 200.
- `DELETE /v1/oauth/grants/:id`: the user disconnects an assistant in Settings.
- Account deletion: `revokeAllOAuthGrants` in `routes/v1/triggers/users/beforeDelete.post.ts`.

Every access-token check reads the grant as well, with no in-memory cache, so any of these takes
effect on the very next request on every instance.

### Redis keys

| Key | Holds | Lifetime |
|---|---|---|
| `oauth_client:<client_id>` | a registered (DCR) client | 30 days, renewed on use |
| `oauth_cimd:<sha256(url)>` | a fetched Client ID Metadata Document | ≤ 24 h |
| `oauth_register:<ip>` | registrations from an address this hour | 1 h |
| `oauth_req:<id>` | an authorization request awaiting consent, with its CSRF nonce | 30 min |
| `oauth_code:<sha256(code)>` | an authorization code | 60 s |
| `oauth_at:<sha256(token)>` | an access token | 1 h |
| `oauth_rt:<sha256(token)>` | a refresh token | 90 days; 60 s once rotated |
| `oauth_grant:<id>` | a connection: user, client, scopes, resource, last used | until revoked |
| `oauth_grant_tokens:<id>` | the token keys a grant issued | until revoked |
| `oauth_grant_seen:<id>` | throttles `lastUsedAt` writes to one per 5 min | 5 min |
| `user_oauth_grants:<user_id>` | a user's grant ids | until revoked |

Tokens and codes are only ever stored hashed.

---

## 5. Metering

Every `tools/call` — not discovery, listing or pings — goes through `meterApiCall`
(`utils/publicApi.ts`), the same counter the developer API uses, so a script and an assistant draw
on one allowance:

| Plan | Per minute | Per month |
|---|---|---|
| free | 60 | 1,000 |
| plus | 1,000 | 100,000 |

Over either limit the tool returns an error the model can relay (when to retry, or that the user
can upgrade). `GET /v1/api/usage` reports `usage.byKey` (API keys) and `usage.byGrant` (OAuth
connections). Each call is also recorded in the API metrics as `MCP <tool>`.

The global rate limiter buckets bearer tokens by a SHA-256 prefix, never the raw token.

---

## 6. The consent page and Settings (webbites repo)

- `app/pages/oauth/authorize.vue` — the consent page (`/oauth/**` is `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, `no-store`, `no-referrer`).
- `app/components/SettingsAssistants.vue` — Settings → AI assistants: the server URL, setup per
  client, connected assistants with Disconnect.
- `/developers/docs/mcp` — the public setup guide and tool reference.

---

## 7. Files reference

| File | Role |
|---|---|
| `server/routes/mcp.ts` | the endpoint |
| `server/utils/mcpProtocol.ts` | wire protocol (pure) |
| `server/utils/mcpToolCatalogue.ts` | catalogue, output schemas, argument validation (pure) |
| `server/utils/mcpTools.ts` | tool handlers, scope check, metering |
| `server/utils/mcpFormat.ts` | result shapes from rows and hits (pure) |
| `server/utils/mcpAuth.ts` | bearer token → caller |
| `server/utils/mcpConfig.ts` | issuer, resource and website URLs |
| `server/middleware/cors-mcp.ts` | CORS for `/mcp`, `/oauth`, `/.well-known` |
| `server/utils/oauthRules.ts` | OAuth rules (pure) |
| `server/utils/oauthStore.ts` | OAuth state in Redis |
| `server/utils/oauthClientMetadata.ts` | client resolution, CIMD fetch |
| `server/utils/oauthHttp.ts` | RFC 6749 responses, client authentication |
| `server/routes/oauth/{authorize.get,token.post,register.post,revoke.post}.ts` | authorization server |
| `server/routes/v1/oauth/requests/[id].get.ts`, `authorize/confirm.post.ts` | consent API |
| `server/routes/v1/oauth/grants/index.get.ts`, `[id].delete.ts` | connected assistants |
| `server/wellKnown/*.ts` | discovery documents (registered in `nitro.config.ts`) |
| `server/utils/{bookmarkSearch,searchEmbedding,searchFilters,tagList,textNotes,textNoteHtml,bookmarkEdits,bookmarkEditRules}.ts` (`tagList` builds on `userTags.ts`) | the service layer the tools share with the routes |
| `docs/mcp-tools.json` | the tool contract (shared with webbites-native) |
| `scripts/mcp-smoke.ts` | end-to-end check against a running backend |

---

## 8. Deployment checklist

- [ ] `MCP_ISSUER` set to the public origin of this backend (`https://api.webbites.io`). It must
      match the origin clients reach, or token audiences won't match.
- [ ] `VITE_WEBSITE_URL` set (the consent page and deep links live there).
- [ ] The proxy forwards `/mcp`, `/oauth/*` and `/.well-known/*` to the backend, uncached, with
      the `Authorization`, `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers intact.
- [ ] The website with `/oauth/authorize` is deployed before announcing the connector.
- [ ] `npx @modelcontextprotocol/conformance server --url https://api.webbites.io/mcp` and the MCP
      Inspector against production; add the server as a custom connector in claude.ai.
- [ ] `bun run scripts/mcp-smoke.ts` against staging with a test account's key.

---

## 9. Not in v1

- **SSE and notifications.** Every tool answers in one response; nothing streams, and there are no
  `subscriptions/listen` change notifications.
- **Resources and prompts.** Tools only.
- **Narrowing or widening a connection in Settings.** Scopes are fixed at consent; Settings can only
  disconnect. Reconnecting asks again.
- **One connection per client.** Approving the same client twice makes two connections; both show
  in Settings.
- **Per-client rate buckets on `/oauth/token`.** The global limiter buckets unauthenticated calls by
  IP, and claude.ai and chatgpt.com call from shared ranges.
  `ponytail:` bucket `/oauth/*` by `client_id` if their volume ever meets the limit.
- **Smart boards over MCP.** `create_board` makes manual boards.
- **Jev reranking for `search_bookmarks`.** The app's own search reorders page 0 of a semantic
  search with Jev (`rerankWithJev` in `routes/v1/search/index.post.ts`); MCP search keeps
  Meilisearch's order, which saves an assistant 0.5–1.5 s per search.
- **Search on dates inside Meilisearch.** `createdAt` is indexed as whatever the row serialised to,
  so date filters run on the hits (a dated search reads ahead up to 4× to fill a page).

---

## 10. Tests

```
npm run test:mcpProtocol       # both eras, headers, error codes, batches
npm run test:mcpToolCatalogue  # catalogue vs docs/mcp-tools.json, write gating, validation
npm run test:mcpFormat         # result shapes
npm run test:oauthRules        # PKCE (RFC 7636 vector), redirects, scopes, resource, DCR, CIMD, rotation
npm run test:searchFilters     # filter escaping, dates, cursors
npm run test:bookmarkEdits     # tag edits, caps
npm run test:textNotes         # note HTML escaping
npm run test:apiRouteAccess    # /mcp, /oauth, /.well-known public; near misses internal
npm run test:rateLimitTarget   # hashed token buckets

MCP_SMOKE_URL=http://localhost:3003 WEBBITES_API_KEY=wb_live_… bun run scripts/mcp-smoke.ts
```
