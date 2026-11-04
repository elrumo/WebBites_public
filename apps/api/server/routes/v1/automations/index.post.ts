import { defineEventHandler, readBody } from 'h3';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { createAutomation, parseAutomationBody, serializeAutomation } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Automations'],
    summary: 'Create an automation',
    description: 'Whenever a bookmark is added, if `conditions` match (`all` or `any`), run `actions`. Condition fields: url, domain, title, type, tag, ai_topic. Actions: add_tag, add_to_board, read_later, webhook.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'actions'],
            properties: {
              name: { type: 'string', example: 'Save Amazon finds to my wishlist' },
              enabled: { type: 'boolean', default: true },
              match: { type: 'string', enum: ['all', 'any'], default: 'all' },
              conditions: { type: 'array', items: { type: 'object' }, example: [{ field: 'domain', op: 'is', value: 'amazon.com' }] },
              actions: { type: 'array', items: { type: 'object' }, example: [{ type: 'add_tag', tag: 'Shopping' }] },
            },
          },
        },
      },
    },
    responses: { '201': { description: 'Created' }, '400': { description: 'Invalid rule' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const input = parseAutomationBody(await readBody(event));
  const row = await createAutomation(auth.userId, input);
  event.node.res.statusCode = 201;
  return { success: true, automation: serializeAutomation(row) };
});
