import { incrementPendingBookmarkCount } from '#root/server/utils/distributedBookmarkCounter';
import { countedByUser } from '#root/server/utils/bookmarkTrash';
import { markDeletedInMeilisearch } from '#root/server/utils/meilisearchTrash';
import { softDeleteBoardMembershipsForWebsites } from '#root/server/utils/boardUtils';
import Parse from 'parse/node.js'


Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = import.meta.env.VITE_PARSE_URL;

// Define OpenAPI documentation for this route
defineRouteMeta({
  openAPI: {
    tags: ["Bookmarks"],
    description: "Batch delete bookmarks from Parse and Meilisearch",
    requestBody: {
      description: "Bookmark IDs and user information for batch deletion",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              ids: {
                type: "array",
                description: "Array of bookmark IDs to delete",
                items: {
                  type: "string"
                }
              },
              userId: {
                type: "string",
                description: "ID of the user who owns the bookmarks"
              },
              customId: {
                type: "string",
                description: "Custom ID to identify bookmarks when IDs array is not provided"
              }
            }
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Bookmarks successfully deleted",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                }
              }
            }
          }
        }
      },
      "500": {
        description: "Server error during deletion process",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: {
                  type: "integer",
                  example: 500
                },
                statusMessage: {
                  type: "string",
                  example: "error batchDelete: Error message"
                }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event) => {
    try {
        let body = await readBody(event)
        const {ids, userId, customId} = body;
        console.log("ids to delete: ", ids);
        // Scoped to `userId`: this route is internal-only, but the ids come
        // straight from the request, so without the owner filter one caller's
        // list of objectIds could delete rows belonging to anybody.
        await batchDeleteFromParse(ids, customId, userId)
        // updateUsage({typeOfUsage: 'bookmarks', user: userId, subOrAdd: 'sub', number: ids.length});
        return {success: true}
    } catch(error){
        console.error('[batchDelete] Error batchDelete: ', error);
        throw createError({
            statusCode: 500,
            statusMessage: `[batchDelete] Error: ${error.message}`,
        })
    }
})

/**
 * Exported so every delete path (web, raycast) soft-deletes the same way.
 *
 * `ownerId` scopes the delete to one user's rows. Every caller should pass it:
 * the queries here run with the master key, so without it a list of objectIds
 * deletes whatever it names, whoever owns it.
 */
export async function batchDeleteFromParse(ids, customId, ownerId) {
  try {

    if(ids == undefined || ids.length == 0 || ids[0] == null){
        console.log('[batchDelete] No ids to delete');
        ids = await getIdsFromCustomId(customId, ownerId)
    }

    if(ids == undefined || ids.length == 0 || ids[0] == null){
        console.log('[batchDelete] No ids to delete');
        throw new Error('[batchDelete] No ids to delete');
    }

    const query = new Parse.Query('websites');
    query.containedIn('objectId', ids);
    query.notEqualTo('isDeleted', true);
    if (ownerId) query.equalTo('user', userPointer(ownerId));
    const objects = await query.find({ useMasterKey: true });

    await softDeleteBookmarks(objects);
  } catch (error) {
    console.log('[batchDelete] Error deleting objects:', error);
    throw error;
  }
}

/**
 * Soft delete: the row stays in Parse for 30 days (bookmarks:purgeDeleted
 * hard-deletes it) so the user can restore it from the trash.
 *
 * Three places have to agree that the bookmark is gone, or it comes back:
 * Parse (`isDeleted`), Meilisearch (the document is *marked*, not removed, so
 * the deleted section can still search it and a late re-index cannot resurrect
 * it).
 *
 * Exported so every path that retires a bookmark (batch delete, raycast, merge)
 * frees the quota the same way. Two writers here would drift the counter.
 *
 * Takes already-loaded, already-filtered Parse objects — the caller owns the
 * query, because merge needs to scope it by owner and type.
 */
export async function softDeleteBookmarks(objects) {
  if (!objects || objects.length === 0) return;

  const now = new Date().toISOString();
  // Tally before overwriting bookmarkCounted below.
  const counted = countedByUser(objects);
  for (const object of objects) {
    object.set('isDeleted', true);
    object.set('deletedAt', now);
    // The quota is freed now, not at purge time. Clearing bookmarkCounted also
    // makes the cloud afterDelete trigger skip its decrement when the purge
    // finally destroys the row, so the counter never goes down twice.
    object.set('bookmarkCounted', false);
  }
  await Parse.Object.saveAll(objects, { useMasterKey: true });

  const ids = objects.map((object) => object.id);
  await Promise.all([
    markDeletedInMeilisearch(ids, now),
    // A board lists its memberships, not the search index, so a deleted
    // bookmark stayed on its boards until the membership went with it.
    softDeleteBoardMembershipsForWebsites(ids)
      .catch((error) => console.error('[batchDelete] Board membership cleanup failed:', error)),
    decrementCounters(counted)
  ]);
}

// One decrement per user for however many of their bookmarks were in the batch.
async function decrementCounters(perUser) {
  await Promise.all([...perUser].map(([userId, count]) =>
    incrementPendingBookmarkCount(userId, -count, new Date())
      .catch((error) => console.error('[batchDelete] Counter decrement failed for', userId, error))
  ));
}

/** A `_User` pointer, for scoping a master-key query to one owner. */
function userPointer(userId) {
  const user = new Parse.User();
  user.id = userId;
  return user;
}

async function getIdsFromCustomId(customId, ownerId) {
  if(!customId){
    console.log('[batchDelete] No customId provided');
    return;
  }

  const query = new Parse.Query('websites');
  query.equalTo('customId', customId);
  query.notEqualTo('isDeleted', true);
  if (ownerId) query.equalTo('user', userPointer(ownerId));
  const customIdObject = await query.first({ useMasterKey: true });
  if (!customIdObject) {
      console.log('[batchDelete] No customIdObject found');
      return;
  }
  const ids = [customIdObject.id];
  console.log('[batchDelete] customId: ', customId);
  return ids; // Return the ids array here
}

