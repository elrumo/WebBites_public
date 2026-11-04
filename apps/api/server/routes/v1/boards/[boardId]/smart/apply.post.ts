import Parse from 'parse/node.js';
import { defineEventHandler, readBody, getRouterParam, createError } from 'h3';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow,
  Websites, addBookmarkToBoard, updateBoardBookmarkCount,
} from '#root/server/utils/boardUtils';
import { matchBookmarksToBoard } from '#root/server/utils/automations';
import { notifyBoardAudience } from '#root/server/utils/boardNotifications';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Apply smart rules to existing bookmarks',
    description: 'Runs the board\'s smart rule — its exact conditions, then AI topics for what they leave open — against existing bookmarks and files the matches.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              websiteIds: { type: 'array', items: { type: 'string' }, description: 'Scope to specific bookmarks (optional)' },
              limit: { type: 'number', default: 100, description: 'Max bookmarks to analyze' },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Smart rules applied' },
      '400': { description: 'Board is not smart/mixed' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const body = await readBody(event) || {};
  const { websiteIds, limit = 100 } = body;

  const board = await getOwnedBoardOrThrow(auth.user, boardId);
  const mode = board.get('mode');
  if (mode !== 'smart' && mode !== 'mixed') {
    throw createError({ statusCode: 400, statusMessage: 'Board must be smart or mixed mode' });
  }

  // Fetch bookmarks to analyze
  const query = new Parse.Query(Websites);
  query.equalTo('user', auth.user);
  if (websiteIds && websiteIds.length > 0) {
    query.containedIn('objectId', websiteIds);
  }
  query.select('siteTitle', 'siteDescription', 'url', 'tags', 'type', 'aiSummary', 'siteBody', 'siteScreenshot', 'OGImage', 'file', 'images');
  query.descending('createdAt');
  query.limit(Math.min(limit, 300));
  const bookmarks = await query.find({ useMasterKey: true });

  const matches = await matchBookmarksToBoard(board, bookmarks);

  let created = 0;
  let skipped = 0;
  const createdIds: string[] = [];
  for (const match of matches) {
    // A bookmark the user took off this board by hand stays off.
    const status = await addBookmarkToBoard(board, match.id, auth.userId, {
      source: 'smart', reactivate: false, aiTopic: match.topic, aiConfidence: match.confidence,
    });
    if (status === 'created') { created++; createdIds.push(match.id); }
    else skipped++;
  }

  if (created > 0) {
    await updateBoardBookmarkCount(boardId, created);
    await notifyBoardAudience(board, auth.userId, 'item_added', { count: created, websiteIds: createdIds });
  }

  return { success: true, created, skipped, analyzed: bookmarks.length, matched: matches.length };
});
