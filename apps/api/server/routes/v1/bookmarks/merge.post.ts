import { createError, defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { saveWebsiteToSearchIndices } from '#root/server/utils/serverUtils.js';
import { softDeleteBookmarks } from '#root/server/routes/batchDelete.post.js';
import { buildMergedImages, unionTags, MAX_IMAGES } from '#root/server/utils/bookmarkImages';

defineRouteMeta({
  openAPI: {
    tags: ['Bookmarks'],
    summary: 'Merge several image bookmarks into one multi-image bookmark',
    description:
      'Combines the images of the given image bookmarks into the target (the first id '
      + 'by default), each image keeping the metadata of the bookmark it came from. The '
      + 'other bookmarks are soft-deleted to the 30-day trash, so a merge is undoable '
      + 'via /v1/bookmarks/restore.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'string' }, description: 'Bookmarks to merge, in the order the images should appear' },
              targetId: { type: 'string', description: 'Which bookmark survives. Defaults to ids[0].' },
            },
            required: ['ids'],
          },
        },
      },
    },
    responses: { '200': { description: 'Bookmarks merged' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const { ids, targetId } = (await readBody(event)) || {};

  if (!Array.isArray(ids) || ids.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'ids must contain at least two bookmarks' });
  }
  if (targetId && !ids.includes(targetId)) {
    throw createError({ statusCode: 400, statusMessage: 'targetId must be one of ids' });
  }

  // Ownership and type are trust boundaries, not conveniences: this endpoint
  // soft-deletes rows, so anything the caller does not own, or that is not an
  // image bookmark, must never make it into the batch.
  const query = new Parse.Query('websites');
  query.containedIn('objectId', ids);
  query.equalTo('user', auth.user);
  query.equalTo('type', 'image');
  query.notEqualTo('isDeleted', true);
  query.limit(MAX_IMAGES * 2);
  const rows = await query.find({ useMasterKey: true });

  if (rows.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Need at least two of your own image bookmarks to merge',
    });
  }

  // Order the images the way the caller listed them, not the way Parse
  // returned them — the first image becomes the cover, so this is user-visible.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((id: string) => byId.get(id)).filter(Boolean) as Parse.Object[];

  const target = byId.get(targetId) || ordered[0];
  const sources = ordered.filter((row) => row.id !== target.id);

  // The target leads, so its own picture stays the cover.
  const images = buildMergedImages([target, ...sources]);
  if (images.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'None of those bookmarks has an image' });
  }

  target.set('images', images);
  target.set('tags', unionTags(target.get('tags'), images));
  // The cloud beforeSave trigger keeps OGImage on images[0], but this endpoint
  // holds the master key and must not depend on a trigger it cannot see fail.
  target.set('OGImage', images[0].url);
  await target.save(null, { useMasterKey: true });

  // Reuses the one soft-delete writer, so the quota, the trash window and the
  // search-index removal all behave exactly as a normal delete.
  await softDeleteBookmarks(sources);

  await saveWebsiteToSearchIndices(target.id, 'mergeBookmarks').catch((error: any) =>
    console.error('[merge] Re-index failed for', target.id, error?.message || error)
  );

  return {
    success: true,
    targetId: target.id,
    imageCount: images.length,
    merged: sources.map((row) => row.id),
  };
});
