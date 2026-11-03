import { createError, defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { markHiddenInMeilisearch } from '#root/server/utils/meilisearchTrash';
import { saveWebsiteToSearchIndices } from '#root/server/utils/serverUtils.js';

/**
 * Hide bookmarks, or unhide them.
 *
 * `"library"` keeps the bookmark out of the grid, out of search and out of
 * every type/tag/colour listing, but leaves it in any board it already belongs
 * to. `"everywhere"` takes it out of the boards too — including a board shared
 * by public link. `""` undoes either.
 *
 * A route rather than a client-side Parse save, for two reasons. The client
 * writes reach the index through the `afterSave` trigger, which rebuilds the
 * whole search document including its embeddings — seconds of work, during
 * which a bookmark the user just hid is still turning up in search. And the
 * index write has to be *reported*: see the fallback below.
 */
const VALUES = ['', 'library', 'everywhere'] as const;

defineRouteMeta({
  openAPI: {
    tags: ['Bookmarks'],
    summary: 'Hide or unhide bookmarks',
    description:
      'Sets `hiddenFrom` on the given bookmarks. `library` hides them from the library but '
      + 'not from boards they are already in; `everywhere` hides them from boards as well; '
      + 'an empty string unhides. Hidden bookmarks are listed by the Private section '
      + '(`POST /v1/search` with `hiddenOnly`).',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'string' } },
              hiddenFrom: { type: 'string', enum: ['', 'library', 'everywhere'] },
            },
            required: ['ids', 'hiddenFrom'],
          },
        },
      },
    },
    responses: {
      '200': { description: '{ success, updated, indexed } — `indexed: false` means the search index write is still catching up' },
      '400': { description: 'ids or hiddenFrom missing or invalid' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const { ids, hiddenFrom } = (await readBody(event)) || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'ids is required' });
  }
  if (!VALUES.includes(hiddenFrom)) {
    throw createError({ statusCode: 400, statusMessage: `hiddenFrom must be one of: ${VALUES.map((v) => `"${v}"`).join(', ')}` });
  }

  // Scoped to the caller's own rows. This is a privacy control, so it silently
  // updates only what belongs to them rather than trusting the id list.
  const query = new Parse.Query('websites');
  query.containedIn('objectId', ids);
  query.equalTo('user', auth.user);
  query.notEqualTo('isDeleted', true);
  query.limit(ids.length);
  const rows = await query.find({ useMasterKey: true });

  for (const row of rows) {
    // Unset rather than store `''`: the Parse-side filters elsewhere read
    // "not hidden" as "not one of the two values", and a column left as an
    // empty string is a third state nobody is looking for.
    if (hiddenFrom === '') row.unset('hiddenFrom');
    else row.set('hiddenFrom', hiddenFrom);
  }
  await Parse.Object.saveAll(rows, { useMasterKey: true });

  const updatedIds = rows.map((row) => row.id);

  // Awaited, not fire-and-forget: until this lands the bookmark is still in
  // the index unhidden, and the caller is entitled to know that a 200 means
  // "no longer searchable".
  let indexed = await markHiddenInMeilisearch(updatedIds, hiddenFrom);

  // `hiddenFrom` is deliberately not a search-relevant key, so unlike a delete
  // there is no later re-index coming along to correct a missed partial
  // update — the bookmark would stay searchable for good. On failure, pay for
  // the full re-index that the happy path exists to avoid.
  if (!indexed && updatedIds.length > 0) {
    const results = await Promise.all(
      updatedIds.map((id) =>
        saveWebsiteToSearchIndices(id, 'setBookmarkVisibility')
          .then(() => true)
          .catch((error: any) => {
            console.error('[visibility] Re-index fallback failed for', id, error?.message || error);
            return false;
          })
      )
    );
    indexed = results.every(Boolean);
  }

  return { success: true, updated: updatedIds, indexed };
});
