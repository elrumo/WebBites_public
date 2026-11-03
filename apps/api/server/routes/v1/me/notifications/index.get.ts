import { defineEventHandler, getQuery } from 'h3';
import { requireUserId } from '#root/server/utils/requireUser';
import { initParseForBoards } from '#root/server/utils/boardUtils';
import { listNotifications } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'List your notifications',
    description: 'Newest first. `total` counts the whole history (the bell is hidden while it is 0), `unreadCount` the ones not yet read. Types: board_shared, role_changed, board_unshared, item_added, item_edited, item_removed, member_joined, member_left.',
    parameters: [
      { name: 'limit', in: 'query', schema: { type: 'number', default: 30 } },
      { name: 'skip', in: 'query', schema: { type: 'number', default: 0 } },
    ],
    responses: { '200': { description: '`{ success, notifications, total, unreadCount }`' }, '401': { description: 'Not signed in' } },
  },
});

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  initParseForBoards();
  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 30, 100);
  const skip = parseInt(query.skip as string) || 0;
  return { success: true, ...(await listNotifications(userId, limit, skip)) };
});
