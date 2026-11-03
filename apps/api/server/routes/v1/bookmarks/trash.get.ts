import { defineEventHandler, getQuery } from 'h3';
import Parse from 'parse/node.js';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { TRASH_RETENTION_DAYS as RETENTION_DAYS } from '#root/server/utils/bookmarkTrash';

defineRouteMeta({
  openAPI: {
    tags: ['Bookmarks'],
    summary: 'List soft-deleted bookmarks',
    description: `Bookmarks the user deleted. They are permanently purged ${RETENTION_DAYS} days after deletion.`,
    responses: { '200': { description: 'Deleted bookmarks, most recently deleted first' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const { limit = 100 } = getQuery(event);

  const query = new Parse.Query('websites');
  query.equalTo('user', auth.user);
  query.equalTo('isDeleted', true);
  query.descending('deletedAt');
  query.limit(Math.min(Number(limit) || 100, 500));

  const rows = await query.find({ useMasterKey: true });

  return {
    success: true,
    retentionDays: RETENTION_DAYS,
    bookmarks: rows.map((row) => {
      const deletedAt = row.get('deletedAt');
      const screenshot = row.get('siteScreenshot');
      const ogImageFile = row.get('OGImageFile');
      return {
        objectId: row.id,
        url: row.get('url'),
        siteTitle: row.get('siteTitle'),
        siteDescription: row.get('siteDescription'),
        siteLogo: row.get('siteLogo'),
        OGImage: row.get('OGImage') || ogImageFile?.url?.() || screenshot?.url?.() || null,
        type: row.get('type'),
        subType: row.get('subType'),
        textNote: row.get('textNote'),
        tags: row.get('tags') || [],
        favorited: row.get('favorited') || false,
        pinned: row.get('pinned') || false,
        // The grid sorts and dates cards by createdAt, so a restored row needs it.
        createdAt: row.get('createdAt'),
        deletedAt,
        // Precomputed so the UI doesn't have to know the retention window.
        purgesAt: deletedAt
          ? new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * 86400000).toISOString()
          : null,
      };
    }),
  };
});
