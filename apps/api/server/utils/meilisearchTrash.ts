/**
 * The trash, as far as Meilisearch is concerned.
 *
 * A deleted bookmark keeps its search document and gains `isDeleted: true`
 * rather than leaving the index. Removing the document was simpler, but it made
 * the trash a write-only place: the deleted section could not search, a restore
 * had to rebuild the document from Parse, and any re-index that landed after
 * the delete (an afterSave still in flight, a sync job) silently put the
 * bookmark back in the grid because nothing in the index said it was gone.
 *
 * Everything here is idempotent: deleting twice, or marking a document the
 * index has never seen, is not an error.
 */

import { MeiliSearch } from 'meilisearch';
import { MEILISEARCH_CONFIG } from '#root/server/config/meilisearchConfig';

/** Every search but the deleted section's carries this. */
export const NOT_DELETED_FILTER = '(isDeleted = false OR isDeleted NOT EXISTS)';

/** The deleted section, and nothing else, carries this. */
export const DELETED_ONLY_FILTER = 'isDeleted = true';

/**
 * Hidden bookmarks: the same trick as the trash, for bites the user wants kept
 * but out of sight.
 *
 * `hiddenFrom` is `"library"` (out of the library, still in its boards) or
 * `"everywhere"` (out of the boards too). Absent is the overwhelmingly common
 * case, so the "not hidden" filter has to match a missing attribute as well as
 * the empty string the document mapper writes.
 *
 * `IS EMPTY`, not `= ""`: Meilisearch's equality never matches an empty string,
 * so `hiddenFrom = ""` matched nothing at all. Documents written before the
 * column existed have no `hiddenFrom` and passed on `NOT EXISTS`, which is why
 * the library looked fine — but every *newly indexed* bookmark carries
 * `hiddenFrom: ""` from the document mapper, matched neither clause, and
 * vanished from search, the grid and every type, tag and colour listing built
 * on it.
 */
export const NOT_HIDDEN_FILTER = '(hiddenFrom IS EMPTY OR hiddenFrom NOT EXISTS)';

/** The Private section, and nothing else, carries this. */
export const HIDDEN_ONLY_FILTER = '(hiddenFrom = "library" OR hiddenFrom = "everywhere")';

/**
 * Which slice of a user's bookmarks a search may see.
 *
 * One object rather than three positional booleans threaded through five
 * signatures — these always travel together, and a caller that transposed two
 * of them would silently serve the trash to the library.
 */
export interface SearchScope {
  /** The deleted section: trashed bookmarks only. */
  deletedOnly: boolean;
  /** The Private section: hidden bookmarks only. */
  hiddenOnly: boolean;
  /** Whether the index will accept a filter on these flags yet. */
  flagsFilterable: boolean;
}

/** Whether a search document is hidden at either level. */
export function isHiddenDocument(hit: any): boolean {
  return hit?.hiddenFrom === 'library' || hit?.hiddenFrom === 'everywhere';
}

/**
 * The safety net for the window where the flags are in the documents but not
 * yet in the index's filterable attributes (a fresh deploy, an index still
 * applying the settings update): filtering on them would be an error there, so
 * the hits are filtered in memory instead. A no-op once the index has caught
 * up, since the filter has already excluded them.
 *
 * In that window a page can come back short — the index filled it with live
 * bookmarks and this drops them — which is the right way round: the library
 * never shows a deleted or hidden bite, and the trash (which reads Parse, not
 * the index) is unaffected.
 *
 * The trash wins over hidden, deliberately. Deleting a bookmark that is hidden
 * has to leave it somewhere the user can restore it from, and applying both
 * conditions independently left it in neither list — the Private section
 * dropped it for being trashed, and the deleted section dropped it for being
 * hidden. Every bookmark belongs to exactly one of the three sections.
 */
export function dropOutOfScopeHits(hits: any[], scope: SearchScope): any[] {
  if (!Array.isArray(hits)) return hits;
  return hits.filter((hit) => {
    const trashed = hit?.isDeleted === true;
    if (scope.deletedOnly) return trashed;
    if (trashed) return false;
    return scope.hiddenOnly ? isHiddenDocument(hit) : !isHiddenDocument(hit);
  });
}

export interface MeiliTarget {
  client: MeiliSearch;
  label: 'primary' | 'alt';
}

function sanitize(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/^['"]|['"]$/g, '');
  return trimmed || undefined;
}

/**
 * Both instances the save path writes to.
 *
 * `saveWebsiteToSearchIndices` indexes into the primary *and* the alt host, so
 * a delete that only marked the primary would leave the alt index serving a
 * bookmark the user threw away.
 */
export function meilisearchTargets(): MeiliTarget[] {
  const host = sanitize(process.env.MEILISEARCH_HOST) || 'http://localhost:7700';
  const apiKey = sanitize(process.env.MEILISEARCH_API_KEY) || 'masterKey';
  const altHost = sanitize(process.env.MEILISEARCH_HOST_ALT);
  const altApiKey = sanitize(process.env.MEILISEARCH_API_KEY_ALT) || apiKey;

  const list: MeiliTarget[] = [{ client: new MeiliSearch({ host, apiKey }), label: 'primary' }];
  if (altHost && altHost !== host) {
    list.push({ client: new MeiliSearch({ host: altHost, apiKey: altApiKey }), label: 'alt' });
  }
  return list;
}

/**
 * Mark documents as trashed.
 *
 * A partial update, not a re-index: the rest of the document (title, tags,
 * embeddings) is left exactly as it was, so a restore is one flag away.
 */
export async function markDeletedInMeilisearch(ids: string[], deletedAt: string): Promise<void> {
  if (!ids || ids.length === 0) return;

  const documents = ids.map((id) => ({ id, objectId: id, isDeleted: true, deletedAt }));

  await Promise.all(meilisearchTargets().map(async ({ client, label }) => {
    try {
      await client.index(MEILISEARCH_CONFIG.INDEX_NAME).updateDocuments(documents, { primaryKey: 'id' });
    } catch (error) {
      // Never fail the delete over the index: Parse is the record, and the
      // search-relevant re-index is retried by the sync job.
      console.error(`[meilisearchTrash] Could not mark deleted on ${label}:`, error);
    }
  }));
}

/**
 * Mark documents hidden, or unhide them with an empty `hiddenFrom`.
 *
 * A partial update for the same reason the trash uses one: a re-index would
 * rebuild the text and the embeddings of a document whose text did not change.
 * It also has to be quick — until this lands the bookmark is still searchable,
 * and this is a privacy control.
 *
 * Unlike the trash's writers this one *reports* failure rather than only
 * logging it. A delete that misses the index is caught by the next re-index,
 * because `isDeleted` is a search-relevant key; `hiddenFrom` deliberately is
 * not (see the visibility route), so nothing would come along behind it and a
 * bookmark the user hid would stay searchable for good. The caller falls back
 * to a full re-index on `false`.
 */
export async function markHiddenInMeilisearch(ids: string[], hiddenFrom: string): Promise<boolean> {
  if (!ids || ids.length === 0) return true;

  const documents = ids.map((id) => ({ id, objectId: id, hiddenFrom }));

  const results = await Promise.all(meilisearchTargets().map(async ({ client, label }) => {
    try {
      await client.index(MEILISEARCH_CONFIG.INDEX_NAME).updateDocuments(documents, { primaryKey: 'id' });
      return true;
    } catch (error) {
      console.error(`[meilisearchTrash] Could not mark hidden on ${label}:`, error);
      return false;
    }
  }));

  return results.every(Boolean);
}

/** Undo of the above, for a restore. */
export async function markRestoredInMeilisearch(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;

  const documents = ids.map((id) => ({ id, objectId: id, isDeleted: false, deletedAt: '' }));

  await Promise.all(meilisearchTargets().map(async ({ client, label }) => {
    try {
      await client.index(MEILISEARCH_CONFIG.INDEX_NAME).updateDocuments(documents, { primaryKey: 'id' });
    } catch (error) {
      console.error(`[meilisearchTrash] Could not mark restored on ${label}:`, error);
    }
  }));
}

/**
 * Drop everything one user ever indexed.
 *
 * Account deletion, where listing the ids first would mean paging through a
 * whole library to build a list Meilisearch can filter for itself. `userId` is
 * a filterable attribute (see `meilisearchConfig`), which is what makes this a
 * single call per target.
 */
export async function removeUserFromMeilisearch(userId: string): Promise<void> {
  if (!userId) return;

  await Promise.all(meilisearchTargets().map(async ({ client, label }) => {
    try {
      await client.index(MEILISEARCH_CONFIG.INDEX_NAME).deleteDocuments({ filter: `userId = ${userId}` });
    } catch (error) {
      console.error(`[meilisearchTrash] Could not delete the documents of user ${userId} on ${label}:`, error);
    }
  }));
}

/** Drop documents for good — the purge, once the retention window is up. */
export async function removeFromMeilisearch(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;

  await Promise.all(meilisearchTargets().map(async ({ client, label }) => {
    try {
      await client.index(MEILISEARCH_CONFIG.INDEX_NAME).deleteDocuments(ids);
    } catch (error) {
      console.error(`[meilisearchTrash] Could not delete documents on ${label}:`, error);
    }
  }));
}

/**
 * Whether the flags the mandatory filters use — `isDeleted`, `hiddenFrom` —
 * can be filtered on yet.
 *
 * Filtering on an attribute Meilisearch has not been told is filterable is an
 * error, not an empty result — so the search route asks here before adding the
 * trash and hidden filters, and post-filters the hits while the answer is still
 * no.
 *
 * The first call reads the index settings (one round trip, then memoised). If
 * anything is missing it enqueues the settings update and returns `false`
 * straight away rather than waiting: applying it re-indexes the filter store,
 * which is not instant on a large index, and a search request must not sit
 * behind that. A later call picks the result up.
 *
 * The check is against the *whole* configured list rather than one attribute.
 * It used to ask only about `isDeleted`, which meant that once the trash had
 * landed this returned `true` for good and any attribute added to the config
 * afterwards was never enqueued — so its filter would have been quietly
 * dropped forever.
 */
const PROBE_RETRY_MS = 60_000;

let filterable = false;
let probeInFlight: Promise<boolean> | null = null;
let nextProbeAt = 0;

export function areFlagsFilterable(): Promise<boolean> {
  if (filterable) return Promise.resolve(true);
  if (probeInFlight) return probeInFlight;
  if (Date.now() < nextProbeAt) return Promise.resolve(false);

  probeInFlight = probeFlagsFilterable()
    .then((ready) => {
      filterable = ready;
      if (!ready) nextProbeAt = Date.now() + PROBE_RETRY_MS;
      return ready;
    })
    .catch((error) => {
      console.error('[meilisearchTrash] Could not read index settings:', error);
      nextProbeAt = Date.now() + PROBE_RETRY_MS;
      return false;
    })
    .finally(() => { probeInFlight = null; });

  return probeInFlight;
}

async function probeFlagsFilterable(): Promise<boolean> {
  const [primary] = meilisearchTargets();
  const index = primary.client.index(MEILISEARCH_CONFIG.INDEX_NAME);

  const current = await index.getFilterableAttributes();
  const missing = MEILISEARCH_CONFIG.filterableAttributes.filter(
    (attribute) => !(current || []).includes(attribute)
  );
  if (Array.isArray(current) && missing.length === 0) return true;

  const merged = [...new Set([...(current || []), ...MEILISEARCH_CONFIG.filterableAttributes])];
  await index.updateFilterableAttributes(merged);
  console.log('[meilisearchTrash] Enqueued filterable-attributes update for:', missing.join(', '));

  return false;
}
