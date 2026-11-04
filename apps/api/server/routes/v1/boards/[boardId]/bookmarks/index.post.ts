import { defineEventHandler, readBody, getRouterParam, createError } from 'h3';
import {
  initParseForBoards, requireAuth, getBoardAccessOrThrow, addBookmarksToBoardForUser,
} from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Add bookmarks to a board',
    description: 'Adds your own bookmarks to a board you own or can edit. Uses membershipKey for idempotent upserts; reactivates soft-deleted memberships. Ids that are not your own live bookmarks come back with status `not_found`.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['websiteIds'],
            properties: {
              websiteIds: { type: 'array', items: { type: 'string' } },
              source: { type: 'string', enum: ['manual', 'smart'], default: 'manual' },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Bookmarks added' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const body = await readBody(event);
  const { websiteIds, source = 'manual' } = body;

  if (!websiteIds || !Array.isArray(websiteIds) || websiteIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'websiteIds array is required' });
  }

  const { board } = await getBoardAccessOrThrow(auth.user, boardId, 'editor');
  const { results, created } = await addBookmarksToBoardForUser(board, websiteIds, auth.userId, { source });

  return { success: true, results, created, total: results.length };
});
