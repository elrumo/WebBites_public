import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow, deriveShareToken, shareLinkFor,
} from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Rotate share token',
    description: 'Replaces the share link with a new one, immediately invalidating the old one.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'New link' },
      '400': { description: 'Board visibility is not link' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;

  const board = await getOwnedBoardOrThrow(auth.user, boardId);

  if (board.get('visibility') !== 'link') {
    throw createError({ statusCode: 400, statusMessage: 'Token rotation only applies to link visibility' });
  }

  const config = board.get('visibilityConfig') || {};
  const tokenVersion = (config.tokenVersion ?? 0) + 1;
  const { rawToken, tokenHash } = deriveShareToken(board.id, tokenVersion);
  board.set('visibilityConfig', {
    ...config,
    tokenHash,
    tokenVersion,
    tokenLastRotatedAt: new Date().toISOString(),
  });
  await board.save(null, { useMasterKey: true });

  return { success: true, shareToken: rawToken, ...shareLinkFor(board) };
});
