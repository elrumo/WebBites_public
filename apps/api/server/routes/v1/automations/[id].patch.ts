import { defineEventHandler, readBody, getRouterParam } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import {
  getAutomation, updateAutomation, parseAutomationBody, serializeAutomation,
} from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Automations'],
    summary: 'Update an automation',
    description: 'Send the whole automation, or just `{ enabled }` to toggle it. Editing a smart board\'s automation updates the board\'s smart rules too.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'Updated' }, '400': { description: 'Invalid rule' }, '404': { description: 'Not found' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const row = await getAutomation(auth.userId, getRouterParam(event, 'id')!);
  const body = (await readBody(event)) || {};
  // Partial updates are merged onto the stored rule, then validated whole.
  const merged = { ...serializeAutomation(row), ...body };
  const input = parseAutomationBody(merged);
  await updateAutomation(auth.userId, row, input);
  return { success: true, automation: serializeAutomation(row) };
});
