import Parse from 'parse/node.js';
import { defineEventHandler, readBody } from 'h3';
import {
  initParseForBoards, requireAuth, getUserBoards, Websites, sanitizeBoard,
} from '#root/server/utils/boardUtils';
import { askClaude, mapWithConcurrency } from '#root/server/utils/serverUtils.js';
import { useJev, toBookmark, jevTopicScores } from '#root/server/utils/automations';
import { bestTopic } from '#root/server/utils/jevTopics';
import type { BoardSuggestion, SuggestBoardsResponse } from '#root/server/types/board.types';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'AI-powered board suggestions',
    description: 'Uses Claude AI to suggest board assignments for bookmarks and optionally recommend new board ideas.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              bookmarkIds: { type: 'array', items: { type: 'string' }, description: 'Specific bookmarks to analyze (omit for recent 50)' },
              suggestNewBoards: { type: 'boolean', default: false },
              maxSuggestionsPerBookmark: { type: 'number', default: 3 },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Suggestions generated' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const body = await readBody(event) || {};
  const { bookmarkIds, suggestNewBoards = false, maxSuggestionsPerBookmark = 3 } = body;

  const boards = await getUserBoards(auth.user, 100);

  // Fetch bookmarks
  const query = new Parse.Query(Websites);
  query.equalTo('user', auth.user);
  if (bookmarkIds?.length > 0) {
    query.containedIn('objectId', bookmarkIds);
  }
  query.select('siteTitle', 'siteDescription', 'url', 'tags', 'type', 'aiSummary', 'siteBody', 'siteScreenshot', 'OGImage', 'file', 'images');
  query.descending('createdAt');
  query.limit(50);
  const bookmarks = await query.find({ useMasterKey: true });

  if (bookmarks.length === 0) {
    return { success: true, assignments: [], message: 'No bookmarks found' };
  }

  const boardSummaries = boards.map((b) => ({
    id: b.id,
    name: b.get('name'),
    description: b.get('description') || '',
    mode: b.get('mode'),
    topics: b.get('smartRules')?.topics || [],
  }));

  const bookmarkSummaries = bookmarks.map((bm) => ({
    id: bm.id,
    title: bm.get('siteTitle') || bm.get('url'),
    description: bm.get('siteDescription') || '',
    tags: bm.get('tags') || [],
    type: bm.get('type'),
    url: bm.get('url'),
    aiSummary: typeof bm.get('aiSummary') === 'object' ? bm.get('aiSummary')?.tldr || '' : '',
  }));

  // With Jev the assignments are probabilities over the real boards, so no
  // board id can be invented. The text model is still needed to name new boards.
  let assignments: BoardSuggestion[] | null = null;
  if (useJev() && boardSummaries.length) {
    assignments = await jevAssignments(bookmarks.map(toBookmark), boardSummaries, maxSuggestionsPerBookmark)
      .catch((error) => {
        console.error('[suggestBoards] Jev failed, using the text model:', error?.message);
        return null;
      });
    if (assignments && !suggestNewBoards) return { success: true, assignments };
  }

  const wanted = [
    assignments ? '' : `"assignments": [
    { "bookmarkId": "id", "bookmarkTitle": "title", "suggestedBoardIds": ["id1"], "suggestedBoardNames": ["name1"], "confidence": 0.85 }
  ]`,
    suggestNewBoards ? `"newBoardSuggestions": [
    { "name": "Name", "description": "Why this board", "topics": ["t1", "t2"], "matchingBookmarkIds": ["id1"] }
  ]` : '',
  ].filter(Boolean);

  let prompt = `You are a bookmark organization assistant. Analyze bookmarks and suggest which boards they belong to.

EXISTING BOARDS:
${JSON.stringify(boardSummaries, null, 2)}

BOOKMARKS TO CATEGORIZE:
${JSON.stringify(bookmarkSummaries, null, 2)}

${assignments ? '' : `For each bookmark, suggest up to ${maxSuggestionsPerBookmark} existing boards where confidence >= 0.5.`}

Return JSON:
{
  ${wanted.join(',\n  ')}
}

${suggestNewBoards ? 'Also suggest up to 5 new boards that would contain at least 2 bookmarks.' : ''}`;

  const result: any = await askClaude(prompt, {
    name: 'suggestBoards',
    timeout: 60000,
    maxTokens: 4000, // up to 50 bookmarks' assignments plus new-board suggestions
  });

  if (result.result?.error) {
    return { success: false, error: 'Failed to generate suggestions' };
  }

  const response: SuggestBoardsResponse = {
    success: true,
    assignments: assignments ?? result.result?.assignments ?? [],
  };

  if (suggestNewBoards && result.result?.newBoardSuggestions) {
    response.newBoardSuggestions = result.result.newBoardSuggestions;
  }

  return response;
});

type BoardSummary = { id: string; name: string; description: string; topics: string[] };

// A board stands for its topics, or for its name when it has none (manual boards).
const boardTopics = (b: BoardSummary) => (b.topics.length ? b.topics : [b.name]).filter(Boolean);

/** Up to `max` boards per bookmark that Jev puts at P ≥ 0.5, best first. One call per bookmark, 8 at a time. */
async function jevAssignments(bookmarks: ReturnType<typeof toBookmark>[], boards: BoardSummary[], max: number): Promise<BoardSuggestion[]> {
  const topics = boards.flatMap(boardTopics);
  const rows = await mapWithConcurrency(bookmarks, 8, async (bookmark) => {
    const scores = await jevTopicScores(bookmark, topics, 'suggestBoards');
    const picks = boards
      .map((board) => ({ board, hit: bestTopic(boardTopics(board), scores, 0.5) }))
      .filter((pick) => pick.hit)
      .sort((a, b) => b.hit!.confidence - a.hit!.confidence)
      .slice(0, max);
    if (!picks.length) return null;
    return {
      bookmarkId: bookmark.id,
      bookmarkTitle: bookmark.title,
      suggestedBoardIds: picks.map((p) => p.board.id),
      suggestedBoardNames: picks.map((p) => p.board.name),
      confidence: picks[0].hit!.confidence,
    };
  });
  return rows.filter((row): row is BoardSuggestion => row !== null);
}
