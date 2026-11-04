import { defineEventHandler, readBody, getRouterParam } from 'h3';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow, validateVisibility,
  deriveShareToken, cleanVisibilityConfig, shareLinkFor, sanitizeBoard,
} from '#root/server/utils/boardUtils';
import { boardsWithMembers } from '#root/server/utils/boardSharing';

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Update board sharing settings',
    description: 'Publishes a board as a view-only link (`link`) or takes it back to `private`. People invited by email keep their access either way (see /members). Turning the link off and on again gives a new link. `email_list` and `email_domain` are still accepted for boards shared that way before.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['visibility'],
            properties: {
              visibility: { type: 'string', enum: ['private', 'link', 'email_list', 'email_domain'] },
              visibilityConfig: {
                type: 'object',
                properties: {
                  allowedEmails: { type: 'array', items: { type: 'string' } },
                  allowedDomains: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Sharing updated. `shareUrl` is the link while visibility is `link`.' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const body = await readBody(event);
  const { visibility, visibilityConfig = {} } = body;

  validateVisibility(visibility, visibilityConfig);

  const board = await getOwnedBoardOrThrow(auth.user, boardId);
  const previous = board.get('visibilityConfig') || {};
  const wasLink = board.get('visibility') === 'link';
  // The link is derived from this counter. Taking it down bumps it, so the
  // link that was shared before does not come back when the board is shared again.
  const tokenVersion = (previous.tokenVersion ?? 0) + (wasLink && visibility !== 'link' ? 1 : 0);

  board.set('visibility', visibility);
  if (visibility === 'link') {
    board.set('visibilityConfig', {
      ...cleanVisibilityConfig(visibilityConfig),
      tokenHash: deriveShareToken(board.id, tokenVersion).tokenHash,
      tokenVersion,
      tokenLastRotatedAt: previous.tokenLastRotatedAt ?? new Date().toISOString(),
    });
  } else if (visibility === 'email_list' || visibility === 'email_domain') {
    board.set('visibilityConfig', { ...cleanVisibilityConfig(visibilityConfig), tokenVersion });
  } else {
    board.set('visibilityConfig', { tokenVersion });
  }
  await board.save(null, { useMasterKey: true });

  const shared = visibility === 'link' || (await boardsWithMembers([board.id])).has(board.id);
  return {
    success: true,
    board: sanitizeBoard(board, { role: 'owner', shared }),
    ...shareLinkFor(board),
  };
});
