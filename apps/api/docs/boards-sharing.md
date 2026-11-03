# Board sharing, collaboration and notifications

A board is shared three ways. All of it is decided in app code with the master key (`server/utils/boardUtils.ts`, `boardSharing.ts`); the Parse classes have no client permissions.

| Who | How | Can |
|---|---|---|
| Owner | `boards.owner` | everything |
| Editor | `boardMembers` row, `role: editor` | read, add **their own** bookmarks, remove the ones they added |
| Viewer | `boardMembers` row, `role: viewer` | read |
| Anyone with the link | `boards.visibility: 'link'` | read, logged out, via `GET /v1/public/boards/:slug?token=` |

Rules live in `server/utils/boardAccessRules.ts` (`npm run test:boardAccess`).

## Routes

| Route | Who | Notes |
|---|---|---|
| `GET /v1/boards` | any | own boards, then boards shared with you. Adds `role`, `shared`, `ownerName`. A shared board is returned with `parentId: null` |
| `GET /v1/boards/:id` | member+ | adds `role`; each item has `addedBy {id,name}` |
| `POST /v1/boards/:id/bookmarks` | editor+ | the caller's own bookmarks only |
| `DELETE /v1/boards/:id/bookmarks/:websiteId` | editor+ | an editor only removes what they added (400 `NOT_YOUR_BOOKMARK`) |
| `GET /v1/boards/:id/sharing` | member+ | visibility, members. `shareUrl` and members' emails: owner only |
| `PATCH /v1/boards/:id/sharing` | owner | `{visibility: 'private'\|'link'}`; returns `shareUrl` |
| `POST /v1/boards/:id/sharing/rotate-token` | owner | new link, old one stops working |
| `POST /v1/boards/:id/members` | owner | `{invites:[{email, role}]}` |
| `PATCH /v1/boards/:id/members/:memberId` | owner | `{role}` |
| `DELETE /v1/boards/:id/members/:memberId` | owner, or any member with `me` | remove / leave |
| `POST /v1/boards/invites/accept` | any | `{token}` from the invitation email |
| `GET /v1/me/notifications` | any | `{notifications, total, unreadCount}`; `total` is the whole history |
| `POST /v1/me/notifications/read` | any | `{ids}` or `{all:true}` |

Business refusals are 400, not 403: both clients treat a 403 as a stale API key and retry it.

## Invites

An address that already belongs to an account is `active` at once and gets a `board_shared` notification. Any other address gets a `pending` row holding the SHA-256 of a single-use token (30 days) and an email with `/invite/<token>`. Opening the link while signed in calls `invites/accept`. The token, not the account's email, is the proof: sign-up does not verify addresses. Invitation emails are capped at 30 per person per day.

## Link tokens

`link` tokens are derived, not random: `HMAC-SHA256(SHARE_LINK_SECRET || VITE_PARSE_MASTER_KEY, boardId:tokenVersion)`. Only the hash is stored (`visibilityConfig.tokenHash`), so the public route is unchanged, but the owner can be shown the link whenever the dialog opens. Turning the link off or rotating bumps `tokenVersion`. A token issued before this (random, not derivable) reports `needsRotate: true` until the owner rotates it.

## Notifications

`boardNotifications` rows (`type`: `board_shared`, `role_changed`, `board_unshared`, `item_added`, `item_removed`, `member_joined`, `member_left`, `item_edited`). Written by `notifyBoardAudience` (owner + active members, minus the actor; best effort). Item events by the same person on the same board fold into one unread row for 15 minutes (`count`, up to 3 `titles`). Read rows older than 90 days are purged daily (`boards:purgeNotifications`). Clients poll; there is no LiveQuery on the class.

`item_edited` is defined but nothing emits it yet: the apps edit bookmarks straight through Parse, and enrichment saves the same rows, so a hook needs a way to tell a person's edit from a system save.

## Setup

- Parse schema: `boardMembers` and `boardNotifications` are declared in `parse-compose/src/config.js` with empty class-level permissions.
- Optional env: `SHARE_LINK_SECRET` (falls back to the Parse master key), `VITE_WEBSITE_URL` (base of share and invite links, default `https://webbites.io`).
