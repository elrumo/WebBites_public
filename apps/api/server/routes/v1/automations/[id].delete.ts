import { defineEventHandler, getRouterParam } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { getAutomation, deleteAutomation } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Automations'],
    summary: 'Delete an automation',
    description: 'Deleting a smart board\'s automation turns the board back into a manual one; its bookmarks stay.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  await deleteAutomation(await getAutomation(auth.userId, getRouterParam(event, 'id')!));
  event.node.res.statusCode = 204;
  return null;
});
