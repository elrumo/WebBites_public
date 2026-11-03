import { buildFilter } from './meilisearchFilter'
import { areFlagsFilterable, dropOutOfScopeHits, meilisearchTargets } from './meilisearchTrash'
import type { SearchScope } from './meilisearchTrash'
import { MEILISEARCH_CONFIG } from '../config/meilisearchConfig'
import { embedSearchQuery, searchEmbeddingsEnabled } from './searchEmbedding'
import { typedSearchFilters } from './searchFilters'
import { log } from './bookmarkLogger'

/**
 * Searching one user's bookmarks in Meilisearch.
 *
 * `performRegularSearch` and `performEmbeddingSearch` are `/v1/search`'s own,
 * moved here unchanged so the MCP server runs the same queries; both go
 * through `buildFilter`, the boundary that keeps a search inside one user's
 * library and out of their trash and hidden bookmarks.
 */

/** Meilisearch keyword search. */
export async function performRegularSearch(index: any, query: string, userId: string, filters: any, limit: number, offset: number, orderBy: string, attributesToRetrieve: string[], scope: SearchScope) {
  const searchOptions: any = {
    limit,
    offset,
    attributesToRetrieve,
    showMatchesPosition: true
  };

  if (orderBy) searchOptions.sort = [orderBy];

  searchOptions.filter = buildFilter(userId, filters, scope);

  log('[SEARCH:MEILISEARCH] final search filter:', searchOptions.filter);

  return await index.search(query, searchOptions);
}

/** Meilisearch hybrid search: keywords plus the query's embedding. */
export async function performEmbeddingSearch(index: any, query: string, userId: string, filters: any, limit: number, offset: number, attributesToRetrieve: string[], scope: SearchScope) {
  const queryEmbedding = await embedSearchQuery(query);

  const searchOptions: any = {
    limit,
    offset,
    attributesToRetrieve,
    vector: queryEmbedding,
    hybrid: {
      semanticRatio: 0.7,
      embedder: "openai"
    }
  };

  searchOptions.filter = buildFilter(userId, filters, scope);

  return await index.search(query, searchOptions);
}

export type SearchSort = 'relevance' | 'newest' | 'oldest'

export interface UserSearchOptions {
  query?: string
  tags?: string[]
  type?: string
  sort?: SearchSort
  limit: number
  offset: number
  attributesToRetrieve: string[]
}

/**
 * The library search for callers outside the app (the MCP server): typed
 * filters only, never a filter string, and always the library scope — no trash,
 * no hidden bookmarks. A query sorted by relevance runs hybrid when embeddings
 * are configured, falling back to keywords if the embedding call fails; an
 * explicit newest/oldest sort, or no query at all, runs a keyword search in
 * date order.
 */
export async function searchUserBookmarks(
  userId: string,
  options: UserSearchOptions,
): Promise<{ hits: any[]; estimatedTotalHits: number }> {
  const index = meilisearchTargets()[0].client.index(MEILISEARCH_CONFIG.INDEX_NAME)
  const scope: SearchScope = {
    deletedOnly: false,
    hiddenOnly: false,
    flagsFilterable: await areFlagsFilterable().catch(() => false),
  }
  const filters = typedSearchFilters({ tags: options.tags, type: options.type })
  const attributes = [...new Set([...options.attributesToRetrieve, 'isDeleted', 'hiddenFrom'])]
  const query = options.query?.trim() ?? ''
  const sort = options.sort ?? (query ? 'relevance' : 'newest')

  let results: any = null
  if (query && sort === 'relevance' && searchEmbeddingsEnabled()) {
    try {
      results = await performEmbeddingSearch(index, query, userId, filters, options.limit, options.offset, attributes, scope)
    } catch (error: any) {
      console.warn('[SEARCH:USER] hybrid search failed, using keywords:', error?.message)
    }
  }
  if (!results) {
    const orderBy = sort === 'newest' ? 'createdAt:desc' : sort === 'oldest' ? 'createdAt:asc' : ''
    results = await performRegularSearch(index, query, userId, filters, options.limit, options.offset, orderBy, attributes, scope)
  }

  const hits = dropOutOfScopeHits(results.hits, scope)
  return { hits, estimatedTotalHits: results.estimatedTotalHits ?? hits.length }
}
