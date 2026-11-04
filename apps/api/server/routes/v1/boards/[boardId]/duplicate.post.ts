import crypto from 'crypto';
import { defineEventHandler, readBody, getRouterParam } from 'h3';
import Parse from 'parse/node.js';
import {
  initParseForBoards, requireAuth, getOwnedBoardOrThrow, Boards, BoardBookmarks,
  makeOwnerAcl, sanitizeBoard, buildMembershipKey,
} from '#root/server/utils/boardUtils';
import { syncBoardAutomation } from '#root/server/utils/automations';

/** Memberships copied per batch, so a large board doesn't build one huge save. */
const COPY_BATCH = 200;

defineRouteMeta({
  openAPI: {
    tags: ['Boards'],
    summary: 'Duplicate a collection',
    description:
      'Copies a collection — its name, mode, smart rules, colour, icon and place in the tree. Its items come along by default; its sub-collections do not.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Defaults to “<name> copy”.' },
              includeBookmarks: { type: 'boolean', default: true },
            },
          },
        },
      },
    },
    responses: {
      '201': { description: 'Collection duplicated' },
      '404': { description: 'Board not found' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const body = (await readBody(event).catch(() => ({}))) || {};
  const includeBookmarks = body.includeBookmarks !== false;

  const source = await getOwnedBoardOrThrow(auth.user, boardId);

  const copy = new Boards();
  copy.set(
    'name',
    String(body.name || `${source.get('name')} copy`).trim().substring(0, 100)
  );
  copy.set('description', source.get('description') || '');
  copy.set('mode', source.get('mode'));
  copy.set('owner', auth.user);
  copy.set('bookmarkCount', 0);
  // A copy is never born shared: the original's link would otherwise resolve
  // to two boards, and nobody asked for the copy to be public.
  copy.set('visibility', 'private');
  copy.set('isDeleted', false);
  copy.set('publicSlug', crypto.randomUUID());
  if (source.get('smartRules')) copy.set('smartRules', source.get('smartRules'));
  if (source.get('color')) copy.set('color', source.get('color'));
  if (source.get('icon')) copy.set('icon', source.get('icon'));
  // Same place in the tree as the original, beside it.
  if (source.get('parent')) copy.set('parent', source.get('parent'));
  copy.set('path', source.get('path') || []);
  copy.set('sortIndex', (source.get('sortIndex') ?? 0) + 1);
  copy.setACL(makeOwnerAcl(auth.userId));
  await copy.save(null, { useMasterKey: true });
  await syncBoardAutomation(copy, auth.userId);

  let copied = 0;
  if (includeBookmarks) {
    let skip = 0;
    while (true) {
      const query = new Parse.Query(BoardBookmarks);
      query.equalTo('board', source);
      query.notEqualTo('isDeleted', true);
      query.ascending('createdAt');
      query.limit(COPY_BATCH);
      query.skip(skip);
      const entries = await query.find({ useMasterKey: true });
      if (entries.length === 0) break;

      const clones = entries.map((entry) => {
        const websiteId = entry.get('website')?.id;
        const clone = new BoardBookmarks();
        clone.set('board', copy);
        clone.set('website', entry.get('website'));
        clone.set('owner', auth.user);
        clone.set('source', entry.get('source') || 'manual');
        clone.set('isDeleted', false);
        if (entry.get('aiTopic')) clone.set('aiTopic', entry.get('aiTopic'));
        if (entry.get('aiConfidence') !== undefined) clone.set('aiConfidence', entry.get('aiConfidence'));
        if (websiteId) clone.set('membershipKey', buildMembershipKey(copy.id, websiteId));
        clone.setACL(makeOwnerAcl(auth.userId));
        return clone;
      });

      await Parse.Object.saveAll(clones, { useMasterKey: true });
      copied += clones.length;
      if (entries.length < COPY_BATCH) break;
      skip += COPY_BATCH;
    }

    if (copied > 0) {
      // Set rather than increment: the count is known exactly here, and the
      // copy object in hand then carries it into the response.
      copy.set('bookmarkCount', copied);
      await copy.save(null, { useMasterKey: true });
    }
  }

  event.node.res.statusCode = 201;
  return { success: true, board: sanitizeBoard(copy), copiedBookmarks: copied };
});
