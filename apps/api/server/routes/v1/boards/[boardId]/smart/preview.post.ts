import Parse from 'parse/node.js';
import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow, Websites,
} from '#root/server/utils/boardUtils';
import { matchBookmarksToBoard } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Preview smart rule matches',
    description: 'Shows which bookmarks would match the board\'s smart rules without actually assigning them. Uses Claude AI.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'Preview of matching bookmarks' },
      '400': { description: 'Board is not smart/mixed' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;

  const board = await getOwnedBoardOrThrow(auth.user, boardId);
  const mode = board.get('mode');
  if (mode !== 'smart' && mode !== 'mixed') {
    throw createError({ statusCode: 400, statusMessage: 'Board must be smart or mixed mode' });
  }

  const query = new Parse.Query(Websites);
  query.equalTo('user', auth.user);
  query.select('siteTitle', 'siteDescription', 'url', 'tags', 'type', 'aiSummary', 'siteBody', 'siteScreenshot', 'OGImage', 'file', 'images');
  query.descending('createdAt');
  query.limit(100);
  const bookmarks = await query.find({ useMasterKey: true });

  const matches = await matchBookmarksToBoard(board, bookmarks);
  return {
    success: true,
    suggestions: matches.map((m) => ({
      websiteId: m.id,
      confidence: m.confidence ?? 1,
      reason: m.topic || 'Matches the board\'s conditions',
    })),
    analyzed: bookmarks.length,
  };
});
