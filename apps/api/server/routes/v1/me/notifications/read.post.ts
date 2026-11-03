import { defineEventHandler, readBody, createError } from 'h3';
import { requireUserId } from '#root/server/utils/requireUser';
import { initParseForBoards } from '#root/server/utils/boardUtils';
import { markNotificationsRead } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Mark notifications read',
    description: 'Pass `ids` to mark some, or `all: true` to mark everything. Returns what is still unread.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } } },
        },
      },
    },
    responses: { '200': { description: '`{ success, unreadCount }`' }, '401': { description: 'Not signed in' } },
  },
});

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  initParseForBoards();
  const body = (await readBody(event)) ?? {};
  if (body.all !== true && !Array.isArray(body.ids)) {
    throw createError({ statusCode: 400, statusMessage: 'Pass ids or all: true' });
  }
  const unreadCount = await markNotificationsRead(userId, body.all === true ? 'all' : body.ids.map(String));
  return { success: true, unreadCount };
});
