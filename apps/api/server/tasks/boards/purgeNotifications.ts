/**
 * Scheduled task: drop board notifications that were read more than 90 days
 * ago. Unread ones stay until they are seen.
 */

import { initParseForBoards } from '#root/server/utils/boardUtils';
import { purgeReadNotifications } from '#root/server/utils/boardNotifications';

export default defineTask({
  meta: {
    name: 'boards:purgeNotifications',
    description: 'Delete board notifications read more than 90 days ago',
  },
  async run() {
    initParseForBoards();
    const removed = await purgeReadNotifications(90);
    console.log(`[boards:purgeNotifications] Purged ${removed} notifications`);
    return { result: { notificationsPurged: removed } };
  },
});
