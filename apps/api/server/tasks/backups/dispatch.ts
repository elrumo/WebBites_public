/**
 * Scheduled task: queue every user backup that is due.
 *
 * Runs hourly. "Due" is one test — `enabled` and `nextRunAt` has passed —
 * which covers both a scheduled run and a run in progress whose lease lapsed
 * (its instance died or it was deployed over mid-part). The work itself
 * happens in `runBackupChunk`, one QStash message per zip part.
 *
 * The Redis lock is not optional: six Nitro instances each fire this cron.
 */

import { withRedisLock, saveRssTaskExecution } from '#root/server/utils/rssUtils';
import { findDueBackups, startBackupRuns } from '#root/server/utils/backups';

const LOCK_TTL_SECONDS = 50 * 60;
const LOCK_KEY = 'backups:dispatch:lock';
/** QStash batches cap at 100 messages; the remainder rolls into the next tick. */
const MAX_PER_TICK = 100;

export default defineTask({
  meta: {
    name: 'backups:dispatch',
    description: 'Queue every user backup whose next run is due',
  },
  async run() {
    const startedAt = Date.now();

    const result = await withRedisLock(LOCK_KEY, LOCK_TTL_SECONDS, async () => {
      const due = await findDueBackups(MAX_PER_TICK);
      await startBackupRuns(due);
      if (due.length) console.log(`[backups:dispatch] Queued ${due.length} backup(s)`);
      return { queued: due.length };
    });

    if ('skipped' in result) console.log(`[backups:dispatch] Skipped: ${result.reason}`);
    await saveRssTaskExecution('backups:dispatch', result, Date.now() - startedAt);
    return { result };
  },
});
