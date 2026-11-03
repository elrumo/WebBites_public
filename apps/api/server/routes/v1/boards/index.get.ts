import { defineEventHandler, getQuery } from 'h3';
import { initParseForBoards, requireAuth, getBoardsForUser } from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'List user boards',
    description: 'Returns all non-deleted, non-archived boards for the authenticated user, sorted by most recently updated, followed by the boards shared with them. Each board carries its parentId, ancestor path and sortIndex, so the client can build the tree without a second call; `role` (owner, editor, viewer), `shared` and, for a shared-with-you board, `ownerName` say how it is shared.',
    parameters: [
      { name: 'limit', in: 'query', schema: { type: 'number', default: 200 } },
      {
        name: 'includeArchived',
        in: 'query',
        schema: { type: 'boolean', default: false },
        description: 'Archived collections are left out unless this is set.',
      },
    ],
    responses: {
      '200': { description: 'Boards listed successfully' },
      '401': { description: 'Unauthorized' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 200, 500);
  const includeArchived = query.includeArchived === 'true' || query.includeArchived === true;

  const boards = await getBoardsForUser(auth.user, limit, { includeArchived });
  return { success: true, boards, total: boards.length };
});
