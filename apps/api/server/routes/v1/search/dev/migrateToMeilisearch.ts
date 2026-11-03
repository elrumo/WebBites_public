import type { MeiliSearch } from 'meilisearch';
import { MEILISEARCH_CONFIG } from '../../../../config/meilisearchConfig';
import { meilisearchTargets, type MeiliTarget } from '../../../../utils/meilisearchTrash';
import { buildMeilisearchDocument, useParse } from '../../../../utils/serverUtils';
import { configureMeilisearchIndex } from '../../../../utils/meilisearchSetup';

const { INDEX_NAME } = MEILISEARCH_CONFIG;
const PAGE_SIZE = 1000;

defineRouteMeta({
  openAPI: {
    tags: ['Search'],
    summary: 'Upload Parse websites to Meilisearch',
    description:
      'Copies bookmarks from the Parse `websites` class into the Meilisearch index on the primary host, the alt host, or both. ' +
      'By default it upserts every bookmark into the existing index(es) without touching settings. ' +
      'Pass ?recreate=true to delete the index(es), recreate them and apply the shared settings first. ' +
      'Pass ?onlyNew=true to copy only bookmarks updated since the newest document already in the target index(es). ' +
      'Pass ?settings=true to apply the shared index settings to the existing index(es) without recreating them. ' +
      'Params are read from the query string and, on POST, merged with the JSON body. ' +
      'Dev-only: returns 404 unless ENABLE_DEV_ROUTES=true.',
    parameters: [
      { name: 'target', in: 'query', required: false, schema: { type: 'string', enum: ['both', 'primary', 'alt'], default: 'both' }, description: 'Which Meilisearch host(s) to write to.' },
      { name: 'recreate', in: 'query', required: false, schema: { type: 'boolean', default: false }, description: 'Delete, recreate and configure the index(es) before uploading. Ignored when objectId is given.' },
      { name: 'settings', in: 'query', required: false, schema: { type: 'boolean', default: false }, description: 'Apply the shared settings (searchable/filterable/sortable attributes, embedder) to the existing index(es) without deleting them. Implied by recreate=true.' },
      { name: 'onlyNew', in: 'query', required: false, schema: { type: 'boolean', default: false }, description: 'Only copy bookmarks whose updatedAt is at or after the newest updatedAt in the target index(es). Ignored when recreate=true.' },
      { name: 'since', in: 'query', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Explicit cutoff for updatedAt (ISO 8601). Overrides the cutoff onlyNew would derive.' },
      { name: 'userId', in: 'query', required: false, schema: { type: 'string' }, description: 'Only copy bookmarks owned by this Parse user.' },
      { name: 'objectId', in: 'query', required: false, schema: { type: 'string' }, description: 'Only copy this one bookmark. Never recreates the index.' },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1 }, description: 'Stop after this many bookmarks (safety valve for trial runs).' }
    ],
    responses: {
      200: {
        description: 'Upload finished (per-target failures are reported, not thrown)',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                target: { type: 'string', example: 'both' },
                recreate: { type: 'boolean', example: false },
                since: { type: 'string', nullable: true, example: '2026-09-15T12:00:00.000Z' },
                total: { type: 'integer', description: 'Bookmarks read from Parse', example: 4200 },
                targets: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      indexed: { type: 'integer', example: 4200 },
                      failed: { type: 'integer', example: 0 },
                      errors: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      404: { description: 'Dev routes are disabled (ENABLE_DEV_ROUTES is not "true")' },
      500: { description: 'Misconfiguration, or a host is unreachable / Parse failed' }
    }
  }
});

type Tally = { indexed: number; failed: number; errors: string[] };

export default defineEventHandler(async (event) => {
  // Dev-only. This rewrites or deletes the live search index and runs with the
  // Parse master key, and nothing else guards it: the auth middleware returns
  // at its first line, and its /v1/dev internal-key branch would not match this
  // path anyway. NODE_ENV is not the gate because it cannot be trusted here —
  // _prod_.env also sets NODE_ENV=development — so this fails closed on a flag
  // only the local .env carries. 404 rather than 403: a refusal that names the
  // endpoint still tells a scanner it is there.
  if (process.env.ENABLE_DEV_ROUTES !== 'true') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  const params: Record<string, unknown> = {
    ...getQuery(event),
    ...(isMethod(event, 'POST') ? ((await readBody(event)) || {}) : {})
  };
  const flag = (v: unknown) => v === true || String(v) === 'true';
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const target = ['primary', 'alt', 'both'].includes(str(params.target)) ? str(params.target) : 'both';
  const objectId = str(params.objectId);
  const userId = str(params.userId);
  const recreate = flag(params.recreate) && !objectId;
  const applySettings = flag(params.settings) || recreate;
  const onlyNew = flag(params.onlyNew) && !recreate;
  const limit = Number(params.limit) > 0 ? Number(params.limit) : Infinity;

  const targets = meilisearchTargets().filter((t) => target === 'both' || t.label === target);
  if (targets.length === 0) {
    throw createError({ statusCode: 500, message: `Meilisearch target "${target}" is not configured (check MEILISEARCH_HOST / MEILISEARCH_HOST_ALT)` });
  }

  try {
    await Promise.all(targets.map((t) => t.client.health()));
  } catch (error: any) {
    throw createError({ statusCode: 500, message: `Failed to connect to Meilisearch: ${error.message}` });
  }

  // Meilisearch processes tasks in order per instance, so delete → create →
  // settings → addDocuments need no explicit waits between them.
  for (const t of targets) {
    if (recreate) {
      await t.client.deleteIndex(INDEX_NAME).catch(() => {});
      console.log(`[migrateToMeilisearch] ${t.label}: index deleted`);
    }
    await t.client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => {});
    if (applySettings) await configureMeilisearchIndex(t);
  }

  // Cutoff for onlyNew: the newest updatedAt any target already holds. With
  // several targets the oldest of those wins so every target catches up.
  let since: string | undefined = str(params.since) || undefined;
  if (onlyNew && !since) {
    const newest = await Promise.all(targets.map(newestUpdatedAt));
    since = newest.every(Boolean) ? (newest as string[]).sort()[0] : undefined;
  }

  console.log('[migrateToMeilisearch] start', { target: targets.map((t) => t.label), recreate, applySettings, onlyNew, since, userId, objectId, limit });

  const Parse = useParse();
  const query = new Parse.Query('websites');
  query.limit(PAGE_SIZE);
  query.ascending('objectId');
  if (objectId) query.equalTo('objectId', objectId);
  if (userId) query.equalTo('user', Parse.User.createWithoutData(userId));
  if (since) query.greaterThanOrEqualTo('updatedAt', new Date(since));

  const tallies: Record<string, Tally> = Object.fromEntries(targets.map((t) => [t.label, { indexed: 0, failed: 0, errors: [] }]));
  let total = 0;
  let lastId = '';
  let page = 1;

  while (total < limit) {
    // Cursor on objectId instead of skip(): no skip ceiling, no drift while rows change.
    if (lastId) query.greaterThan('objectId', lastId);
    const rows = await query.find({ useMasterKey: true });
    if (rows.length === 0) break;

    const slice = rows.slice(0, limit - total);
    const documents = slice.map((site) => buildMeilisearchDocument(site));
    total += documents.length;
    lastId = rows[rows.length - 1].id;

    await Promise.all(targets.map(async (t) => {
      try {
        await t.client.index(INDEX_NAME).addDocuments(documents, { primaryKey: 'id' });
        tallies[t.label].indexed += documents.length;
      } catch (error: any) {
        tallies[t.label].failed += documents.length;
        tallies[t.label].errors.push(`page ${page}: ${error.message}`);
        console.error(`[migrateToMeilisearch] ${t.label}: page ${page} failed`, error.message);
      }
    }));

    console.log(`[migrateToMeilisearch] page ${page}: ${documents.length} docs (${total} total)`);
    page++;
    if (rows.length < PAGE_SIZE) break;
  }

  console.log('[migrateToMeilisearch] done', { total, tallies });

  return {
    success: Object.values(tallies).some((t) => t.failed === 0),
    target,
    recreate,
    since: since ?? null,
    total,
    targets: tallies
  };
});

async function newestUpdatedAt({ client, label }: MeiliTarget): Promise<string | undefined> {
  const index = client.index(INDEX_NAME);
  const search = () => index.search('', { sort: ['updatedAt:desc'], limit: 1, attributesToRetrieve: ['updatedAt'] });
  let res;
  try {
    res = await search();
  } catch (error: any) {
    if (!/not sortable/i.test(error.message)) throw error;
    // A live index that predates the shared settings: make updatedAt sortable
    // (a settings-only task, documents are untouched) and try once more.
    console.warn(`[migrateToMeilisearch] ${label}: updatedAt not sortable, applying sortable attributes`);
    await index.updateSortableAttributes(MEILISEARCH_CONFIG.sortableAttributes).waitTask({ timeout: 10 * 60_000 });
    res = await search();
  }
  const value = res.hits[0]?.updatedAt;
  return typeof value === 'string' ? value : undefined;
}
