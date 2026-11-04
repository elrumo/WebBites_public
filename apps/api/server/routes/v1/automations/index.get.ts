import { defineEventHandler } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { listAutomations, serializeAutomation } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Automations'],
    summary: 'List automations',
    description: 'Every automation the user has, including the ones behind smart boards (`boardId` set).',
    responses: { '200': { description: 'Automations' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const rows = await listAutomations(auth.userId);
  return { success: true, automations: rows.map(serializeAutomation) };
});
