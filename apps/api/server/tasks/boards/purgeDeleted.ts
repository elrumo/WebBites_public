/**
 * Scheduled task: Purge soft-deleted board records older than 30 days.
 *
 * This task hard-deletes boards and boardBookmarks that have been
 * soft-deleted for more than 30 days. Run via Nitro scheduled tasks
 * or invoke manually via the dev endpoint.
 */

import { initParseForBoards, purgeDeletedRecords } from '#root/server/utils/boardUtils';

export default defineTask({
  meta: {
    name: 'boards:purgeDeleted',
    description: 'Hard-delete boards and memberships soft-deleted more than 30 days ago',
  },
  async run() {
    initParseForBoards();
    console.log('[boards:purgeDeleted] Starting purge of soft-deleted records...');

    const result = await purgeDeletedRecords(30);

    console.log(`[boards:purgeDeleted] Purged ${result.boards} boards and ${result.memberships} memberships`);

    return {
      result: {
        boardsPurged: result.boards,
        membershipsPurged: result.memberships,
      },
    };
  },
});
