import { createError, defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { MEILISEARCH_CONFIG } from '#root/server/config/meilisearchConfig';
import { meilisearchTargets } from '#root/server/utils/meilisearchTrash';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Merge, rename or delete tags across every bookmark',
    description:
      'Rewrites `tags` on each of the caller\'s bookmarks that carries any of `from` '
      + '(case-insensitive): the matches become `into`, or are dropped when `into` is null. '
      + 'Rename is `{ from: [old], into: new }`; delete is `{ from: [...], into: null }`.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              from: { type: 'array', items: { type: 'string' }, description: 'Tags to replace' },
              into: { type: 'string', nullable: true, description: 'Replacement tag, or null to remove' },
            },
            required: ['from'],
          },
        },
      },
    },
    responses: { '200': { description: '{ updated: number of bookmarks rewritten }' } },
  },
});

// "read later" is a feature wearing a tag's clothes on web and native; renaming
// it away would silently break it.
const PROTECTED_TAGS = ['read-later'];
const MAX_ROWS = 5000; // ponytail: sync cap; move to a QStash job if a user tops it

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const body = (await readBody(event)) || {};

  const from: string[] = Array.isArray(body.from)
    ? [...new Set<string>(body.from.map((t: unknown) => String(t ?? '').trim()).filter(Boolean))]
    : [];
  const into: string | null = body.into == null ? null : String(body.into).trim();

  if (!from.length) throw createError({ statusCode: 400, statusMessage: 'from must be a non-empty array of tags' });
  if (into === '') throw createError({ statusCode: 400, statusMessage: 'into must be a tag or null' });
  if (from.some((t) => PROTECTED_TAGS.includes(t.toLowerCase()))) {
    throw createError({ statusCode: 400, statusMessage: `${PROTECTED_TAGS.join(', ')} cannot be renamed or removed` });
  }

  const query = new Parse.Query('websites');
  query.equalTo('user', auth.user);
  query.notEqualTo('isDeleted', true);
  // A regex on an array field matches any element, so one query finds every
  // case variant of every tag in `from`.
  query.matches('tags', `^(${from.map(escapeRegex).join('|')})$`, 'i');
  query.select('tags');
  query.limit(MAX_ROWS);
  const rows = await query.find({ useMasterKey: true });

  const fromLower = new Set(from.map((t) => t.toLowerCase()));
  for (const row of rows) {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const tag of (row.get('tags') as unknown[]) ?? []) {
      const value = fromLower.has(String(tag).toLowerCase()) ? into : String(tag);
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      next.push(value);
    }
    row.set('tags', next);
  }

  for (let i = 0; i < rows.length; i += 100) {
    await Parse.Object.saveAll(rows.slice(i, i + 100), { useMasterKey: true });
  }

  // Partial update so the manager's refetch is right now, not after the
  // afterSave coalescing window; the trigger's own re-index is idempotent.
  // Indexing is a queued task, so wait for it: the caller lists tags next.
  const docs = rows.map((row) => ({ id: row.id, objectId: row.id, tags: row.get('tags') }));
  if (docs.length) {
    await Promise.all(meilisearchTargets().map(async ({ client, label }) => {
      try {
        await client.index(MEILISEARCH_CONFIG.INDEX_NAME)
          .updateDocuments(docs, { primaryKey: 'id' })
          .waitTask({ timeout: 30_000 });
      } catch (error) {
        console.error(`[tags/merge] Could not update ${label}:`, error);
      }
    }));
  }

  return { updated: rows.length };
});
