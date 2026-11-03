import { defineEventHandler, getRouterParam, getQuery } from 'h3';
import {
  initParseForBoards, requireAuth, getBoardAccessOrThrow, serializeBoardItems,
  getBoardBookmarkEntries, countBoardBookmarks,
} from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'List bookmarks in a board',
    description: 'Returns bookmarks in a board with membership metadata and pagination.',
    parameters: [
      { name: 'boardId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'number', default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'number', default: 0 } },
    ],
    responses: {
      '200': { description: 'Bookmarks listed' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 500);
  const skip = parseInt(query.skip as string) || 0;

  const [, entries, total] = await Promise.all([
    getBoardAccessOrThrow(auth.user, boardId),
    getBoardBookmarkEntries(boardId, limit, skip),
    countBoardBookmarks(boardId),
  ]);

  const items = await serializeBoardItems(entries, auth.user);

  return { success: true, items, totalBookmarks: total };
});
