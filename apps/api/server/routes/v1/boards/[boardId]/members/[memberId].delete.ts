import { defineEventHandler, getRouterParam, createError } from 'h3';
import { initParseForBoards, requireAuth, getBoardAccessOrThrow } from '#root/server/utils/boardUtils';
import { canManageBoard } from '#root/server/utils/boardAccessRules';
import { getActiveMembership, getMemberOrThrow } from '#root/server/utils/boardSharing';
import { notifyBoardAudience } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Remove a member, or leave a board',
    description: 'The owner removes a member (or cancels a pending invite) by id. Any member leaves a board shared with them with `memberId` = `me`. Bookmarks they added stay on the board; the owner can take them off.',
    parameters: [
      { name: 'boardId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'memberId', in: 'path', required: true, schema: { type: 'string', description: 'A member id, or `me`' } },
    ],
    responses: { '204': { description: 'Removed' }, '404': { description: 'Board or member not found' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const memberId = getRouterParam(event, 'memberId')!;

  const { board, role } = await getBoardAccessOrThrow(auth.user, boardId);
  const ownerId = board.get('owner')?.id as string;

  if (memberId === 'me') {
    if (role === 'owner') throw createError({ statusCode: 400, statusMessage: 'You own this board; delete it instead of leaving it' });
    const own = await getActiveMembership(board.id, auth.userId);
    await own?.destroy({ useMasterKey: true });
    await notifyBoardAudience(board, auth.userId, 'member_left', { recipients: [ownerId] });
  } else {
    // 400, not 403: both clients read a 403 as a stale API key and retry it.
    if (!canManageBoard(role)) throw createError({ statusCode: 400, statusMessage: 'Only the board owner can remove people' });
    const row = await getMemberOrThrow(board, memberId);
    const userId = row.get('user')?.id as string | undefined;
    await row.destroy({ useMasterKey: true });
    if (userId) await notifyBoardAudience(board, auth.userId, 'board_unshared', { recipients: [userId] });
  }

  event.node.res.statusCode = 204;
  return null;
});
