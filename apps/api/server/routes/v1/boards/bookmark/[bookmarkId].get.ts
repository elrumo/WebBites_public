import { defineEventHandler, getRouterParam } from 'h3';
import {
  initParseForBoards, requireAuth, getBookmarkBoardMemberships, sanitizeBoard,
} from '#root/server/utils/boardUtils';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Get boards for a bookmark',
    description: 'Returns all boards that a specific bookmark belongs to.',
    parameters: [{ name: 'bookmarkId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'Boards for bookmark' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const bookmarkId = getRouterParam(event, 'bookmarkId')!;

  const memberships = await getBookmarkBoardMemberships(bookmarkId, auth.userId);

  const boards = memberships.map((m) => {
    const board = m.get('board');
    return {
      ...sanitizeBoard(board),
      source: m.get('source'),
      aiTopic: m.get('aiTopic') || null,
      addedAt: m.createdAt,
    };
  });

  return { success: true, boards };
});
