import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
  initParseForBoards, requireAuth, getBoardAccessOrThrow,
  buildMembershipKey, findMembership, updateBoardBookmarkCount,
} from '#root/server/utils/boardUtils';
import { canRemoveBookmark } from '#root/server/utils/boardAccessRules';
import { notifyBoardAudience } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Remove a bookmark from a board',
    description: 'Soft-deletes the board-bookmark membership. The bookmark itself is not deleted. The owner can remove any bookmark; an editor only the ones they added.',
    parameters: [
      { name: 'boardId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'websiteId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '204': { description: 'Membership removed' },
      '400': { description: 'An editor tried to remove a bookmark somebody else added' },
      '404': { description: 'Board or membership not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const websiteId = getRouterParam(event, 'websiteId')!;

  const { board, role } = await getBoardAccessOrThrow(auth.user, boardId, 'editor');

  const key = buildMembershipKey(boardId, websiteId);
  const membership = await findMembership(key);

  if (membership && !membership.get('isDeleted')) {
    if (!canRemoveBookmark(role, membership.get('owner')?.id === auth.userId)) {
      // 400, not 403: both clients read a 403 as a stale API key and retry it.
      throw createError({
        statusCode: 400,
        statusMessage: 'Only the board owner can remove bookmarks that somebody else added',
        data: { errorCode: 'NOT_YOUR_BOOKMARK' },
      });
    }
    membership.set('isDeleted', true);
    membership.set('deletedAt', new Date().toISOString());
    await membership.save(null, { useMasterKey: true });
    await updateBoardBookmarkCount(boardId, -1);
    await notifyBoardAudience(board, auth.userId, 'item_removed', { websiteIds: [websiteId] });
  }

  event.node.res.statusCode = 204;
  return null;
});
