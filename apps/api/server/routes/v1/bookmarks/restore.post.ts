import { createError, defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import {
  initParseForBoards, requireAuth, restoreBoardMembershipsForWebsites,
} from '#root/server/utils/boardUtils';
import { markRestoredInMeilisearch } from '#root/server/utils/meilisearchTrash';
import { saveWebsiteToSearchIndices } from '#root/server/utils/serverUtils.js';
import { incrementPendingBookmarkCount } from '#root/server/utils/distributedBookmarkCounter';

defineRouteMeta({
  openAPI: {
    tags: ['Bookmarks'],
    summary: 'Restore soft-deleted bookmarks',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { ids: { type: 'array', items: { type: 'string' } } },
            required: ['ids'],
          },
        },
      },
    },
    responses: { '200': { description: 'Bookmarks restored' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const { ids } = (await readBody(event)) || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'ids is required' });
  }

  const query = new Parse.Query('websites');
  query.containedIn('objectId', ids);
  query.equalTo('user', auth.user);
  query.equalTo('isDeleted', true);
  const rows = await query.find({ useMasterKey: true });

  for (const row of rows) {
    row.unset('isDeleted');
    row.unset('deletedAt');
    // Mirrors the delete: the quota goes back up here, and the flag keeps a
    // later hard delete honest.
    row.set('bookmarkCounted', true);
  }
  await Parse.Object.saveAll(rows, { useMasterKey: true });

  if (rows.length > 0) {
    await incrementPendingBookmarkCount(auth.userId, rows.length, new Date());
  }

  const restoredIds = rows.map((row) => row.id);

  // Clearing the flag on the existing documents comes first and is cheap: the
  // bite is back in the grid on the next search whether or not the full
  // re-index below (Algolia, embeddings) has landed yet.
  await markRestoredInMeilisearch(restoredIds);

  await restoreBoardMembershipsForWebsites(restoredIds).catch((error: any) =>
    console.error('[restore] Board membership restore failed:', error?.message || error)
  );

  // Back into Algolia + Meilisearch — that is what puts them back in the grid.
  await Promise.all(
    rows.map((row) =>
      saveWebsiteToSearchIndices(row.id, 'restoreBookmark').catch((error: any) =>
        console.error('[restore] Re-index failed for', row.id, error?.message || error)
      )
    )
  );

  return { success: true, restored: restoredIds };
});
