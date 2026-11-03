import { defineEventHandler, getRouterParam } from 'h3';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow, softDeleteBoard, getDescendantBoards,
} from '#root/server/utils/boardUtils';
import { syncBoardAutomation } from '#root/server/utils/automations';

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Delete a board or folder (soft delete)',
    description: 'Soft-deletes a board or folder, everything nested under it, and all their bookmark associations. Records are permanently purged after 30 days.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '204': { description: 'Board deleted' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;

  const board = await getOwnedBoardOrThrow(auth.user, boardId, { allowFolder: true });

  // Sub-collections go with their parent. Leaving them behind would strand
  // them: their `path` still names a board the sidebar no longer shows, so
  // they would be unreachable rather than promoted.
  const descendants = await getDescendantBoards(auth.user, board.id);
  for (const child of [...descendants, board]) {
    await softDeleteBoard(child);
    await syncBoardAutomation(child, auth.userId); // disables its smart rule
  }

  event.node.res.statusCode = 204;
  return null;
});
