import { defineEventHandler, readBody, getRouterParam } from 'h3';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow, isFolder,
  validateMode, validateVisibility, cleanVisibilityConfig, sanitizeBoard, moveBoard, normalizeSmartRules,
} from '#root/server/utils/boardUtils';
import { syncBoardAutomation, parseBoardRule } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Update a board',
    description: 'Updates board properties. Only the board owner can update it.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              mode: { type: 'string', enum: ['manual', 'smart', 'mixed'] },
              smartRules: { type: 'object' },
              rule: { type: 'object', description: 'Exact conditions for a smart board: { match, conditions }.' },
              visibility: { type: 'string', enum: ['private', 'link', 'email_list', 'email_domain'] },
              visibilityConfig: { type: 'object' },
              color: { type: 'string' },
              icon: { type: 'string' },
              parentId: {
                type: 'string',
                nullable: true,
                description: 'Move into a folder, or null to move to the top level. Only folders can be parents.',
              },
              sortIndex: { type: 'number', description: 'Manual ordering among siblings.' },
              archived: {
                type: 'boolean',
                description: 'Archive or restore. An archived collection keeps its contents and leaves the sidebar.',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Board updated' },
      '400': { description: 'Invalid move — a cycle, or past the depth cap' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const body = await readBody(event);

  const board = await getOwnedBoardOrThrow(auth.user, boardId, { allowFolder: true });
  const folder = isFolder(board);
  // A folder is only a name, colour, icon and place: nothing to smart-file or share.
  if (folder) for (const key of ['mode', 'smartRules', 'rule', 'visibility', 'visibilityConfig']) delete body[key];
  const rule = body.rule ? parseBoardRule(body.rule) : undefined;

  if (body.name !== undefined) board.set('name', String(body.name).trim().substring(0, 100));
  if (body.description !== undefined) board.set('description', String(body.description).trim().substring(0, 1000));
  if (body.mode !== undefined) {
    validateMode(body.mode);
    board.set('mode', body.mode);
  }
  if (body.smartRules !== undefined) {
    if (body.smartRules) board.set('smartRules', normalizeSmartRules(body.smartRules));
    else board.unset('smartRules');
  }
  if (body.visibility !== undefined) {
    validateVisibility(body.visibility, body.visibilityConfig);
    board.set('visibility', body.visibility);
    // Sharing has its own route; here a client may set the lists but never the link token.
    if (body.visibilityConfig) {
      board.set('visibilityConfig', { ...(board.get('visibilityConfig') || {}), ...cleanVisibilityConfig(body.visibilityConfig) });
    }
  }
  if (body.color !== undefined) board.set('color', body.color);
  if (body.icon !== undefined) board.set('icon', body.icon);
  if (body.sortIndex !== undefined) board.set('sortIndex', Number(body.sortIndex) || 0);
  if (body.archived !== undefined) {
    board.set('archivedAt', body.archived ? new Date() : null);
  }

  // The move last, and on its own save: it rewrites the `path` of every
  // descendant too, so it either goes through for the whole subtree or throws
  // before any of the edits above are committed.
  if (body.parentId !== undefined) {
    await moveBoard(auth.user, board, body.parentId || null);
  } else {
    await board.save(null, { useMasterKey: true });
  }
  if (body.mode !== undefined || body.smartRules !== undefined || rule) {
    await syncBoardAutomation(board, auth.userId, rule);
  }

  return { success: true, board: sanitizeBoard(board) };
});
