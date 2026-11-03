import { MEILISEARCH_CONFIG } from '#root/server/config/meilisearchConfig';
import { NOT_DELETED_FILTER, NOT_HIDDEN_FILTER, areFlagsFilterable, meilisearchTargets } from '#root/server/utils/meilisearchTrash';

/**
 * Where a user's tags live: the search index, scoped like every search to the
 * user's own bookmarks minus the trash and the hidden ones. A hidden bite
 * contributing would put a tag in the list that leads to an empty filter, and
 * name the thing the user hid.
 */
export async function userTagScope(userId: string) {
  const filter = [`user.objectId = "${userId}"`];
  if (await areFlagsFilterable().catch(() => false)) {
    filter.push(NOT_DELETED_FILTER);
    filter.push(NOT_HIDDEN_FILTER);
  }
  return { filter, index: meilisearchTargets()[0].client.index(MEILISEARCH_CONFIG.INDEX_NAME) };
}

/** The user's tags with bookmark counts: a facet distribution, so case variants collapse into one row. */
export async function userTagCounts(userId: string): Promise<Array<{ name: string; count: number }>> {
  const { filter, index } = await userTagScope(userId);
  // ponytail: one facet query per call; Meilisearch answers in ms for one
  // user's documents — cache in Redis if it ever shows up in traces.
  const distribution = await index.search('', { filter, facets: ['tags'], limit: 0 });
  return Object.entries(distribution.facetDistribution?.tags ?? {}).map(([name, count]) => ({ name, count: Number(count) }));
}
