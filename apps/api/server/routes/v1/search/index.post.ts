import { MeiliSearch } from 'meilisearch';
import { askJev } from '#root/server/utils/aiClients';
import { jevOn, rerankRequest, rerankBy } from '#root/server/utils/jevJudgments';
import { defineEventHandler, readBody, H3Event } from 'h3';
import { validateParseToken } from '../../../utils/raycast-auth';
import Parse from 'parse/node.js';
import { LRUCache } from 'lru-cache';
import { areFlagsFilterable, dropOutOfScopeHits } from '#root/server/utils/meilisearchTrash';
import type { SearchScope } from '#root/server/utils/meilisearchTrash';
import { sanitizeMeilisearchFilters } from '#root/server/utils/meilisearchFilter';
import { performRegularSearch, performEmbeddingSearch } from '#root/server/utils/bookmarkSearch';
import { searchEmbeddingsEnabled } from '#root/server/utils/searchEmbedding';
import { createHash } from 'crypto';

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string);
Parse.serverURL = process.env.VITE_PARSE_URL as string;


// Meilisearch configuration
const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://localhost:7700';
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY || 'masterKey';
// Page 0 of a semantic search is reordered by Jev unless JEV_SEARCH_RERANK=false.
const JEV_RERANK_ENABLED = searchEmbeddingsEnabled() && jevOn('JEV_SEARCH_RERANK');
const JEV_RERANK_TIMEOUT_MS = 1500;
// About the first screen. Measured through the proxy: 20 hits ≈ 0.5s warm,
// 40 ≈ 0.8–1.6s. Hits past it keep Meilisearch's order.
const JEV_RERANK_MAX_HITS = 20;
const MEILISEARCH_INDEX_NAME = 'webbites';

const DEFAULT_ATTRIBUTES = [
  'objectId',
  'url',
  'siteTitle',
  'siteDescription',
  // 'siteBody',
  'tags',
  'keywords',
  'siteAuthor',
  'textNote',
  'notes',
  'user.objectId',
  'siteColors',
  'createdAt',
  'metadata',
  'aiSummary',
  'mediaTypeObject',
  'type',
  'subType',
  'updatedAt',
  // The grid lists from Meilisearch, not Parse, so the multi-image badge has
  // to come from the search document. The array itself stays out of the index.
  'imageCount',
  // The two pictures behind the cover on a stacked card.
  'imageThumbs',
  // An audio bite's card is a waveform, a length and a line of its transcript,
  // and its player starts from `fileUrl` — none of which it has until the full
  // Parse row arrives behind it, which is long after the card is drawn.
  'fileUrl',
  'fileName',
  'audioDuration',
  'audioPeaks',
  'transcriptStatus',
  // An app bookmark's card: store, rating, category and price. The full
  // listing stays out of the index.
  'appCard',
  // Retrieved, not just filtered on: until Meilisearch has been told the
  // attribute is filterable the hits are filtered here instead, and that needs
  // the value in hand. See `dropOutOfScopeHits`.
  'isDeleted',
  // Same, and the card needs it anyway to show that a bookmark is hidden.
  'hiddenFrom'
]

interface SearchBody {
  query?: string;
  acl?: string;
  filters?: string | object | null;
  orderBy?: 'newFirst' | 'oldFirst' | string | null;
  hitsPerPage?: number;
  page?: number;
  useEmbeddings?: boolean;
  limit?: number;
  offset?: number;
  attributesToRetrieve?: string[];
  /** The deleted section: trashed bookmarks *only*. Off everywhere else. */
  deletedOnly?: boolean;
  /** The Private section: hidden bookmarks *only*. Off everywhere else. */
  hiddenOnly?: boolean;
}



const isDev = process.env.NODE_ENV === 'development'

// In-memory cache configuration for search results
const SEARCH_CACHE_TTL_MS = 1000 // 30 seconds for search results with query
const EMPTY_SEARCH_CACHE_TTL_MS = 1000 // 1 seconds for empty searches (more dynamic)
const SEARCH_CACHE_MAX_SIZE = 10000 // Max number of search queries to cache

interface CachedSearchResult {
  results: any
  timestamp: number
}

// LRU cache for search results (Algolia & Meilisearch)
const searchResultCache = new LRUCache<string, CachedSearchResult>({
  max: SEARCH_CACHE_MAX_SIZE,
  ttl: SEARCH_CACHE_TTL_MS,
})


/**
 * Generate cache key from search parameters
 */
function generateCacheKey(userId: string, body: SearchBody): string {
  const params = {
    userId,
    query: body.query || '',
    filters: body.filters,
    orderBy: body.orderBy,
    hitsPerPage: body.hitsPerPage,
    page: body.page,
    useEmbeddings: body.useEmbeddings,
    limit: body.limit,
    offset: body.offset,
    attributesToRetrieve: body.attributesToRetrieve,
    deletedOnly: Boolean(body.deletedOnly),
    hiddenOnly: Boolean(body.hiddenOnly),
  }
  const paramsStr = JSON.stringify(params)
  return createHash('md5').update(paramsStr).digest('hex')
}

// Define OpenAPI documentation for this route
defineRouteMeta({
  openAPI: {
    tags: ["Search"],
    summary: "Unified search endpoint for bookmarks",
    description: "Search bookmarks using Algolia (default) or Meilisearch (when useEmbeddings is true). Supports both regular text search and semantic search with embeddings.",
    requestBody: {
      description: "Search parameters",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query string",
                example: "javascript tutorials"
              },
              acl: {
                type: "string",
                description: "User ID for access control filtering (legacy, auto-detected from auth)"
              },
              useEmbeddings: {
                type: "boolean",
                description: "Use Meilisearch with semantic search (embeddings) when true, otherwise use Algolia",
                default: false,
                example: false
              },
              filters: {
                type: "string",
                description: "Additional filters to apply to the search (format depends on search engine)",
                nullable: true
              },
              orderBy: {
                type: "string",
                description: "Order results by 'newFirst' or 'oldFirst'",
                enum: ["newFirst", "oldFirst"],
                nullable: true
              },
              hitsPerPage: {
                type: "integer",
                description: "Number of results per page",
                default: 40
              },
              page: {
                type: "integer",
                description: "Page number for pagination (0-based)",
                default: 0
              },
              limit: {
                type: "integer",
                description: "Maximum number of results (Meilisearch-style, alternative to hitsPerPage)",
                default: 20
              },
              offset: {
                type: "integer",
                description: "Number of results to skip (Meilisearch-style, alternative to page)",
                default: 0
              },
              attributesToRetrieve: {
                type: "array",
                items: { type: "string" },
                description: "Specific attributes to retrieve (Meilisearch only)"
              },
              deletedOnly: {
                type: "boolean",
                description: "Search the trash instead of the library. Deleted bookmarks are excluded from every other search.",
                default: false,
                example: false
              },
              hiddenOnly: {
                type: "boolean",
                description: "Search the Private section instead of the library. Hidden bookmarks are excluded from every other search.",
                default: false,
                example: false
              }
            }
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Search results",
        content: {
          "application/json": {
            schema: {
              type: "object",
              description: "Response can be either Algolia format (with 'search' property) or Meilisearch format (with 'success' property)"
            }
          }
        }
      },
      "500": {
        description: "Server error during search",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: false },
                error: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    let body: SearchBody | string = await readBody(event);

    // if(isDev) console.log(`[SEARCH:POST] body: ${JSON.stringify(body)}`)

    if (typeof body === 'string') body = JSON.parse(body) as SearchBody;
    
    const authHeader = getHeader(event, 'authorization')

    // log('[SEARCH:POST]_______START_______');
    // log(`[SEARCH:POST] body: ${JSON.stringify(body)}`);
    // log(`[SEARCH:POST] authHeader: ${authHeader}`);
    // log('[SEARCH:POST]_______END_______');

    let userId: string | undefined = undefined;

    if (authHeader && authHeader.startsWith('Bearer r:')) {
      const parseUser = await validateParseToken(event);
      userId = parseUser.userId;
    } else{
        userId = await validateApiKeyFromEvent(event)
    }

    let response;

    response = await handleMeilisearch(body, userId);
    // // Route to Meilisearch if useEmbeddings is specified
    // if (Boolean(body.useEmbeddings)) {
    //   // log(`[SEARCH:POST] useEmbeddings: ${body.useEmbeddings}`)
    //   response = await handleMeilisearch(body, userId);
    // } else{
    // }  
    
    // console.log('[SEARCH:POST] response:', response);
    return response

  } catch (error: any) {
    console.error('Error in search.post: ', error);
    return { success: false, error: error.message };
  }
});

/**
 * Extracts CONTAINS filters and returns cleaned filters + facet filters
 * Algolia doesn't support CONTAINS, so we convert them to facet filters or search query terms
 * Special handling: colorDescription CONTAINS X -> siteColors.colorName facet filter
 */
function extractContainsFilters(filters: string | undefined | null): { cleanedFilters: string, containsTerms: string[], colorFacets: string[] } {
  if (!filters) {
    return { cleanedFilters: '', containsTerms: [], colorFacets: [] };
  }

  const containsTerms: string[] = [];
  const colorFacets: string[] = [];

  // Extract all CONTAINS expressions and their values
  const containsPattern = /([a-zA-Z0-9_.]+)\s+CONTAINS\s+(?:"([^"]*)"|'([^']*)'|([^\s()]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = containsPattern.exec(filters)) !== null) {
    const field = match[1];
    const value = match[2] || match[3] || match[4]; // Get the value from whichever group matched

    if (value) {
      const trimmedValue = value.trim();

      // Special handling for colorDescription - convert to siteColors.colorName facet
      if (field.toLowerCase() === 'colordescription') {
        colorFacets.push(`siteColors.colorName:${trimmedValue}`);
        log(`[ALGOLIA] Converting colorDescription CONTAINS ${trimmedValue} to facet: siteColors.colorName:${trimmedValue}`);
      } else {
        // For other fields, add to search terms
        containsTerms.push(trimmedValue);
      }
    }
  }

  // Remove CONTAINS expressions from the filter string
  let cleanedFilters = filters
    .replace(/\s*AND\s+[a-zA-Z0-9_.]+\s+CONTAINS\s+(?:"[^"]*"|'[^']*'|[^\s()]+)/gi, '')
    .replace(/[a-zA-Z0-9_.]+\s+CONTAINS\s+(?:"[^"]*"|'[^']*'|[^\s()]+)\s*AND\s*/gi, '')
    .replace(/^\s*[a-zA-Z0-9_.]+\s+CONTAINS\s+(?:"[^"]*"|'[^']*'|[^\s()]+)\s*$/gi, '')
    .replace(/\(\s*[a-zA-Z0-9_.]+\s+CONTAINS\s+(?:"[^"]*"|'[^']*'|[^\s()]+)\s*\)/gi, '')
    .trim();

  return { cleanedFilters, containsTerms, colorFacets };
}

/**
 * Handle search using Meilisearch
 */
async function handleMeilisearch(body: SearchBody, userId: string) {
  const startTime = Date.now();
  const hasQuery = body.query && body.query.trim() !== '';
  const cacheKey = generateCacheKey(userId, body);

  // Check cache for both empty and non-empty searches
  const cached = searchResultCache.get(cacheKey);
  
  if (cached) {
    const cacheAge = Date.now() - cached.timestamp;
    const queryType = hasQuery ? 'query' : 'empty';
    log(`[SEARCH:MEILISEARCH] Cache hit (${queryType}) - Age: ${cacheAge}ms, Time: ${Date.now() - startTime}ms`);
    return cached.results;
  }

  // Per-request, not module state: this used to assign to a module-level `let`,
  // so whichever client asked last decided what every other client got back.
  const requestedAttributes = (body.attributesToRetrieve && body.attributesToRetrieve.length > 0)
    ? body.attributesToRetrieve
    : DEFAULT_ATTRIBUTES;

  // The two flags ride along whatever the caller asked for: `dropOutOfScopeHits`
  // needs them, and a caller that listed its own attributes would otherwise get
  // trashed or hidden bookmarks back whenever the index filter isn't available
  // yet.
  const attributesToRetrieve = requestedAttributes.includes('*')
    ? requestedAttributes
    : [...new Set([...requestedAttributes, 'isDeleted', 'hiddenFrom'])];

  // Validate required parameters
  if (body.query !== undefined && typeof body.query !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Query parameter must be a string'
    });
  }

  let query = body.query || " ";
  if (query === "") query = " ";

  let {
    useEmbeddings = false,
    filters = {},
    limit = 20,
    offset = 0,
    hitsPerPage,
    page,
    orderBy,
    deletedOnly = false,
    hiddenOnly = false
  } = body;

  deletedOnly = Boolean(deletedOnly);
  hiddenOnly = Boolean(hiddenOnly);

  if (orderBy === 'newFirst') orderBy = 'createdAt:desc';
  if (orderBy === 'oldFirst') orderBy = 'createdAt:asc';

  // log('[SEARCH:MEILISEARCH] filters before sanitization:', filters);
  filters = sanitizeMeilisearchFilters(filters);
  // log('[SEARCH:MEILISEARCH] filters after sanitization:', filters);

  // Compute effective pagination using hitsPerPage/page if provided (Algolia-style),
  // otherwise fall back to limit/offset (Meilisearch-style)
  let effectiveLimit = limit;
  let effectiveOffset = offset;
  if (hitsPerPage != null || page != null) {
    const hp = (typeof hitsPerPage === 'number' && !isNaN(hitsPerPage)) ? hitsPerPage : 40;
    const pg = (typeof page === 'number' && !isNaN(page)) ? page : 0;
    effectiveLimit = hp;
    effectiveOffset = pg * hp;
  }

  // Validate parameters
  if (effectiveLimit < 1 || effectiveLimit > 1000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Limit/hitsPerPage must be between 1 and 1000'
    });
  }

  if (effectiveOffset < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Offset/page must be non-negative'
    });
  }

  // Initialize Meilisearch client
  const client = new MeiliSearch({
    host: MEILISEARCH_HOST,
    apiKey: MEILISEARCH_API_KEY,
  });

  const index = client.index(MEILISEARCH_INDEX_NAME);

  // Cheap after the first call of the process: a cached answer, or a settings
  // read. A `false` here only costs accuracy in the total-hit count — the hits
  // themselves are filtered either way.
  const scope: SearchScope = {
    deletedOnly,
    hiddenOnly,
    flagsFilterable: await areFlagsFilterable().catch(() => false),
  };

  let searchResults;
  let searchType: 'regular' | 'embedding';

  if (useEmbeddings && query.trim() !== "") {
    // Perform embedding-based search
    if (!searchEmbeddingsEnabled()) {
      throw createError({
        statusCode: 500,
        statusMessage: 'LiteLLM proxy not configured for embedding search'
      });
    }

    searchResults = await performEmbeddingSearch(index, query, userId, filters, effectiveLimit, effectiveOffset, attributesToRetrieve, scope);
    searchType = 'embedding';
  } else {
    // Perform regular text search
    searchResults = await performRegularSearch(index, query, userId, filters, effectiveLimit, effectiveOffset, orderBy as string, attributesToRetrieve, scope);
    searchType = 'regular';
  }

  let hits = dropOutOfScopeHits(searchResults.hits, scope);
  if (JEV_RERANK_ENABLED && searchType === 'embedding' && effectiveOffset === 0 && hits.length > 1
    && hits.some((hit: any) => hit.siteTitle || hit.siteDescription)) {
    hits = await rerankWithJev(query, hits);
  }

  const processingTimeMs = Date.now() - startTime;
  const totalHits = searchResults.estimatedTotalHits || hits.length;
  const currentPage = Math.floor(effectiveOffset / effectiveLimit);
  const nbPages = Math.ceil(totalHits / effectiveLimit);

  const response = {
    success: true,
    results: hits,
    totalHits,
    processingTimeMs,
    searchType,
    page: currentPage,
    hitsPerPage: effectiveLimit,
    nbPages
  };

  // Cache the result with appropriate TTL based on query type
  const cacheTTL = hasQuery ? SEARCH_CACHE_TTL_MS : EMPTY_SEARCH_CACHE_TTL_MS;

  searchResultCache.set(cacheKey, {
    results: response,
    timestamp: Date.now()
  }, { ttl: cacheTTL });

  const queryType = hasQuery ? 'query' : 'empty';
  log(`[SEARCH:MEILISEARCH] Cache miss (${queryType}) - Cached for ${cacheTTL}ms, Time: ${processingTimeMs}ms`);

  return response;
}

/**
 * The head of a semantic search's first page, reordered by how well Jev thinks
 * each hit answers the query. Only reorders, so pagination is unchanged.
 * Meilisearch's order when Jev is slow or down.
 */
async function rerankWithJev(query: string, hits: any[]) {
  const started = Date.now();
  const head = hits.slice(0, JEV_RERANK_MAX_HITS);
  try {
    const response = await askJev(rerankRequest(query, head), 'searchRerank', JEV_RERANK_TIMEOUT_MS);
    log(`[SEARCH:JEV] Reranked ${head.length} hits in ${Date.now() - started}ms`);
    return [...rerankBy(head, response), ...hits.slice(JEV_RERANK_MAX_HITS)];
  } catch (error: any) {
    console.error(`[SEARCH:JEV] Rerank skipped after ${Date.now() - started}ms:`, error?.message);
    return hits;
  }
}

