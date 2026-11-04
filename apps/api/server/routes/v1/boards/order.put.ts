import { defineEventHandler, readBody, createError } from 'h3';
import { initParseForBoards, requireAuth, reorderBoards, sanitizeBoard } from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Reorder boards and folders, moving them between folders',
    description: 'Puts `orderedIds` under `parentId` (null for the top level) in exactly that order. Anything listed that sits elsewhere is moved there. Send the full list of the destination\'s children.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['orderedIds'],
            properties: {
              parentId: { type: 'string', nullable: true },
              orderedIds: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'The affected boards, with their new parentId, path and sortIndex' },
      '400': { description: 'Invalid move — a board as a parent, a cycle, or past the depth cap' },
      '404': { description: 'A board or the parent was not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const body = await readBody(event);
  const orderedIds = body?.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.length > 500 || orderedIds.some((id) => typeof id !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'orderedIds must be an array of board ids' });
  }
  const boards = await reorderBoards(auth.user, body.parentId || null, orderedIds);
  return { success: true, boards: boards.map((board) => sanitizeBoard(board)) };
});
