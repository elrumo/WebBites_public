'use strict';
/**
 * Schema definitions Parse creates (with their class-level permissions and
 * indexes) at startup. Classes only the servers touch have every permission
 * empty, so the master key is the only way in.
 *
 * Moved verbatim from config.js.
 */
module.exports = {
  definitions: [
    {
      // Daily MetricKit histograms from the iOS/macOS apps (MetricKitReporter).
      className: 'AppMetrics',
      fields: {
        platform: { type: 'String' },
        appVersion: { type: 'String' },
        periodStart: { type: 'String' },
        periodEnd: { type: 'String' },
        payload: { type: 'Object' },
      },
      classLevelPermissions: {
        create: { '*': true },
        find: {}, get: {}, count: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // Email changes waiting on the link sent to the new address. Written
      // and read only by webbites-backend (`server/utils/emailChange.ts`)
      // with the master key: no client may see or forge one, so every
      // permission is empty. The token itself is never stored, only its hash.
      className: 'EmailChangeRequest',
      fields: {
        user: { type: 'Pointer', targetClass: '_User' },
        userId: { type: 'String' },
        newEmail: { type: 'String' },
        oldEmail: { type: 'String' },
        tokenHash: { type: 'String' },
        expiresAt: { type: 'Date' },
        sentAt: { type: 'Date' },
        sendCount: { type: 'Number' },
        windowStart: { type: 'Date' },
      },
      indexes: {
        tokenHash_1: { tokenHash: 1 },
        userId_1: { userId: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // Sign in with Apple refresh tokens, kept only so account deletion can
      // revoke them (webbites-backend `server/utils/appleTokens.ts`). A
      // credential, so no client permission at all.
      className: 'AppleToken',
      fields: {
        user: { type: 'Pointer', targetClass: '_User' },
        clientId: { type: 'String' },
        refreshToken: { type: 'String' },
      },
      indexes: {
        user_1: { user: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // The ticks on the admin page's release checklists (the TestFlight
      // tab), one row per item. Read and written only by the web app's
      // admin routes (`server/api/admin/launchChecklist.*`) with the master
      // key, so no client permission at all.
      className: 'LaunchChecklistItem',
      fields: {
        checklist: { type: 'String' },
        itemId: { type: 'String' },
        done: { type: 'Boolean' },
        doneAt: { type: 'Date' },
        doneBy: { type: 'String' },
      },
      indexes: {
        checklist_itemId_1: { checklist: 1, itemId: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // A copy of the embeddings Meilisearch generates, one row per
      // bookmark, so an index rebuilt from Parse doesn't pay OpenAI for them
      // again. Written by webbites-backend's Meilisearch sync
      // (`server/services/meilisearchSync.ts`) with the master key; derived
      // from the user's bookmarks, so no client permission at all.
      // `vector` is base64 float32, `textHash` the text it was made from.
      className: 'SearchEmbedding',
      fields: {
        user: { type: 'Pointer', targetClass: '_User' },
        websiteId: { type: 'String' },
        textHash: { type: 'String' },
        vector: { type: 'String' },
      },
      indexes: {
        user_1: { user: 1 },
        websiteId_1: { websiteId: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // Who a board is shared with, and the invites still waiting on an
      // emailed link. Written and read only by webbites-backend
      // (`server/utils/boardUtils.ts`) with the master key — access to a
      // board is decided there, so no client permission at all. A pending
      // row keeps only the SHA-256 of its token. `membershipKey`
      // (`<boardId>:<email>`) is unique by convention: the backend looks it
      // up before it writes.
      className: 'boardMembers',
      fields: {
        board: { type: 'Pointer', targetClass: 'boards' },
        user: { type: 'Pointer', targetClass: '_User' },
        invitedBy: { type: 'Pointer', targetClass: '_User' },
        email: { type: 'String' },
        role: { type: 'String' },
        status: { type: 'String' },
        tokenHash: { type: 'String' },
        expiresAt: { type: 'Date' },
        membershipKey: { type: 'String' },
      },
      indexes: {
        board_1: { board: 1 },
        user_1: { user: 1 },
        email_1: { email: 1 },
        tokenHash_1: { tokenHash: 1 },
        membershipKey_1: { membershipKey: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // The bell's history: one row per thing that happened on a board the
      // recipient can see. Read through `GET /v1/me/notifications` with the
      // master key, so no client permission at all. Repeated item events by
      // one person coalesce into one row (`count`, `titles`).
      className: 'boardNotifications',
      fields: {
        recipient: { type: 'Pointer', targetClass: '_User' },
        actor: { type: 'Pointer', targetClass: '_User' },
        board: { type: 'Pointer', targetClass: 'boards' },
        type: { type: 'String' },
        boardName: { type: 'String' },
        actorName: { type: 'String' },
        count: { type: 'Number' },
        titles: { type: 'Array' },
        readAt: { type: 'Date' },
        lastEventAt: { type: 'Date' },
      },
      indexes: {
        recipient_lastEventAt: { recipient: 1, lastEventAt: -1 },
        board_1: { board: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // Settings entered on the admin page (apps/api/server/utils/settings). One row per setting
      // name; secrets are stored encrypted (`enc:v1:…`). Master key only. Parse itself reads the
      // collection straight from MongoDB at start-up (src/settings.js).
      className: 'AppSettings',
      fields: {
        key: { type: 'String' },
        value: { type: 'String' },
        secret: { type: 'Boolean' },
        updatedBy: { type: 'String' },
      },
      indexes: {
        key_1: { key: 1 },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
    {
      // Who changed which settings and when (names only, never values).
      className: 'SettingsAudit',
      fields: {
        userId: { type: 'String' },
        email: { type: 'String' },
        keys: { type: 'Array' },
        action: { type: 'String' },
      },
      classLevelPermissions: {
        find: {}, get: {}, count: {}, create: {}, update: {}, delete: {}, addField: {},
      },
    },
  ],
};
