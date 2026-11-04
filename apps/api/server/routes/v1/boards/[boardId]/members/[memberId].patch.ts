import { defineEventHandler, readBody, getRouterParam, createError } from 'h3';
import { initParseForBoards, requireAuth, getOwnedBoardOrThrow } from '#root/server/utils/boardUtils';
import { isMemberRole } from '#root/server/utils/boardAccessRules';
import { displayNames, getMemberOrThrow, serializeMember } from '#root/server/utils/boardSharing';
import { notifyBoardAudience } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Change a member\'s role',
    description: 'Owner only. Switches a member between `viewer` and `editor`; an active member is told.',
    parameters: [
      { name: 'boardId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['viewer', 'editor'] } } } } },
    },
    responses: { '200': { description: 'Role changed' }, '404': { description: 'Board or member not found' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const memberId = getRouterParam(event, 'memberId')!;
  const { role } = (await readBody(event)) ?? {};
  if (!isMemberRole(role)) throw createError({ statusCode: 400, statusMessage: 'role must be viewer or editor' });

  const board = await getOwnedBoardOrThrow(auth.user, boardId);
  const row = await getMemberOrThrow(board, memberId);

  const changed = row.get('role') !== role;
  row.set('role', role);
  await row.save(null, { useMasterKey: true });

  const userId = row.get('user')?.id as string | undefined;
  if (changed && userId) await notifyBoardAudience(board, auth.userId, 'role_changed', { recipients: [userId] });

  return { success: true, member: serializeMember(row, await displayNames(userId ? [userId] : []), true) };
});
