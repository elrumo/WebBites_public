import { defineEventHandler, getRouterParam, getQuery } from 'h3';
import {
  initParseForBoards, requireAuth, getBoardAccessOrThrow, serializeBoardItems,
  getBoardBookmarkEntries, countBoardBookmarks, sanitizeBoard,
} from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Get a board with its bookmarks',
    description: 'Returns a board and its bookmarks with pagination, to its owner or anyone it is shared with. `role` is the caller\'s; each item carries `addedBy`.',
    parameters: [
      { name: 'boardId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'number', default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'number', default: 0 } },
    ],
    responses: {
      '200': { description: 'Board with bookmarks' },
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

  // The access check runs alongside the page fetch; its 404 still rejects
  // the whole call before anything is returned.
  const [{ board, role }, entries, total] = await Promise.all([
    getBoardAccessOrThrow(auth.user, boardId),
    getBoardBookmarkEntries(boardId, limit, skip),
    countBoardBookmarks(boardId),
  ]);

  const items = await serializeBoardItems(entries, auth.user);

  return { success: true, board: sanitizeBoard(board, { role }), role, items, totalBookmarks: total };
});
