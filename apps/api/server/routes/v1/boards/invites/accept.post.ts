import { defineEventHandler, readBody } from 'h3';
import { initParseForBoards, requireAuth, sanitizeBoard } from '#root/server/utils/boardUtils';
import { acceptInvite, displayNames } from '#root/server/utils/boardSharing';
import { notifyBoardAudience } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Accept a board invite',
    description: 'Opens the emailed invite link for the signed-in user. The link works once and for whoever holds it; it expires after 30 days (410).',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } },
    },
    responses: {
      '200': { description: 'The board, now in the caller\'s list' },
      '400': { description: 'Malformed token, or the caller owns the board' },
      '410': { description: 'Expired or already used' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const { token } = (await readBody(event)) ?? {};

  const { board, role } = await acceptInvite(auth.user, token);
  const ownerId = board.get('owner')?.id as string;
  await notifyBoardAudience(board, auth.userId, 'member_joined', { recipients: [ownerId] });

  const ownerName = (await displayNames([ownerId])).get(ownerId) ?? 'Someone';
  return { success: true, board: sanitizeBoard(board, { role, shared: true, ownerName }) };
});
