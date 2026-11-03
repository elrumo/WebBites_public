import { defineEventHandler, getRouterParam } from 'h3';
import { initParseForBoards, requireAuth, getBoardAccessOrThrow, getSharingState } from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Who a board is shared with',
    description: 'How the board is published (`private` or `link`), who has access and with which role. The owner also gets the share link and every member\'s email; everyone else gets names and roles only.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'Sharing state' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;

  const { board, role } = await getBoardAccessOrThrow(auth.user, boardId);
  return { success: true, role, ...(await getSharingState(board, role)) };
});
