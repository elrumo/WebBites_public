import { defineEventHandler, readBody, createError } from 'h3';
import {
  initParseForBoards, requireAuth, createBoard, validateMode, sanitizeBoard,
} from '#root/server/utils/boardUtils';
import { syncBoardAutomation, parseBoardRule } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Create a new board',
    description: 'Creates a board for organizing bookmarks. Modes: manual (user-curated), smart (AI auto-assigns), or mixed. Requires Bearer token auth.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', maxLength: 100, example: 'Design Inspiration' },
              kind: { type: 'string', enum: ['board', 'folder'], default: 'board', description: 'A folder only groups boards and other folders; `mode` is not needed for one.' },
              description: { type: 'string', maxLength: 1000 },
              mode: { type: 'string', enum: ['manual', 'smart', 'mixed'] },
              smartRules: {
                type: 'object',
                properties: {
                  topics: { type: 'array', items: { type: 'string' } },
                  confidenceThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.6 },
                  autoApply: { type: 'boolean', default: true },
                  includeExisting: { type: 'boolean', default: false },
                },
              },
              rule: {
                type: 'object',
                description: 'Exact conditions a smart board also matches on (alongside or instead of AI topics).',
                properties: {
                  match: { type: 'string', enum: ['all', 'any'], default: 'all' },
                  conditions: { type: 'array', items: { type: 'object' }, example: [{ field: 'domain', op: 'is', value: 'dribbble.com' }] },
                },
              },
              color: { type: 'string', example: '#6366f1' },
              icon: { type: 'string', example: 'palette' },
              parentId: { type: 'string', description: 'Put this under a folder. Only folders can be parents.' },
              sortIndex: { type: 'number', description: 'Manual ordering among siblings.' },
            },
          },
        },
      },
    },
    responses: {
      '201': { description: 'Board created successfully' },
      '400': { description: 'Invalid request parameters' },
      '401': { description: 'Unauthorized' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const body = await readBody(event);

  const { name, mode, description, smartRules, color, icon, parentId, sortIndex } = body;
  const kind = body.kind === 'folder' ? 'folder' : 'board';
  const rule = kind === 'board' && body.rule ? parseBoardRule(body.rule) : undefined;

  if (!name || !String(name).trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }

  if (kind === 'folder') {
    const folder = await createBoard(auth.user, auth.userId, { name, kind, color, icon, parentId, sortIndex });
    event.node.res.statusCode = 201;
    return { success: true, board: sanitizeBoard(folder) };
  }
  validateMode(mode);

  if ((mode === 'smart' || mode === 'mixed') && !smartRules?.topics?.length && !rule?.conditions.length) {
    throw createError({ statusCode: 400, statusMessage: 'Smart and mixed boards need AI topics or at least one condition' });
  }

  const board = await createBoard(auth.user, auth.userId, {
    name, description, mode, smartRules, color, icon, parentId, sortIndex,
  });
  // Smart boards file new bookmarks through an automation.
  await syncBoardAutomation(board, auth.userId, rule);

  event.node.res.statusCode = 201;
  return { success: true, board: sanitizeBoard(board) };
});
