/**
 * Scheduled task: hard-delete bookmarks soft-deleted more than 30 days ago.
 *
 * destroyAll fires the cloud afterDelete trigger, which skips its counter
 * decrement because batchDelete already set bookmarkCounted=false. The
 * Meilisearch document goes with the row — this is the only path that removes
 * it, everywhere else a deleted bookmark keeps a document marked isDeleted.
 */

import Parse from 'parse/node.js';
import { initParseForBoards } from '#root/server/utils/boardUtils';
import { purgeCutoff } from '#root/server/utils/bookmarkTrash';
import { removeFromMeilisearch } from '#root/server/utils/meilisearchTrash';

export default defineTask({
  meta: {
    name: 'bookmarks:purgeDeleted',
    description: 'Hard-delete bookmarks soft-deleted more than 30 days ago',
  },
  async run() {
    initParseForBoards();
    const cutoff = purgeCutoff();

    let purged = 0;
    while (true) {
      const query = new Parse.Query('websites');
      query.equalTo('isDeleted', true);
      query.lessThan('deletedAt', cutoff);
      query.limit(100);
      const rows = await query.find({ useMasterKey: true });
      if (rows.length === 0) break;

      // The search document outlives the soft delete on purpose (it is what
      // the deleted section reads and what a restore flips back), so the purge
      // is the one place that has to take it out of the index for good.
      await removeFromMeilisearch(rows.map((row) => row.id));

      await Parse.Object.destroyAll(rows, { useMasterKey: true });
      purged += rows.length;
    }

    console.log(`[bookmarks:purgeDeleted] Purged ${purged} bookmarks`);
    return { result: { purged } };
  },
});
