import { createHash } from 'crypto'
import { LRUCache } from 'lru-cache'
import { createError } from 'h3'
import { getOpenAI } from './aiClients'
import { log } from './bookmarkLogger'
import { aiConfigured } from './aiClients'

/**
 * Query embeddings for hybrid search, through the LiteLLM proxy.
 *
 * Moved out of `routes/v1/search/index.post.ts` so the MCP server's
 * `search_bookmarks` embeds a query exactly as the app's search does, and both
 * share one cache: an embedding is the slow, paid part of a search.
 */

const EMBEDDING_CACHE_TTL_MS = 300000 // 5 minutes for embeddings (more stable)
const EMBEDDING_CACHE_MAX_SIZE = 500 // Max number of embeddings to cache

interface CachedEmbedding {
  embedding: number[]
  timestamp: number
}

// Separate from the search-result cache: embeddings are expensive, so they are kept longer.
const embeddingCache = new LRUCache<string, CachedEmbedding>({
  max: EMBEDDING_CACHE_MAX_SIZE,
  ttl: EMBEDDING_CACHE_TTL_MS,
})

/** Whether hybrid search is available at all on this deployment. */
export function searchEmbeddingsEnabled(): boolean {
  return aiConfigured()
}

function embeddingCacheKey(query: string): string {
  return createHash('md5').update(query.trim().toLowerCase()).digest('hex')
}

/** The query's embedding, from the cache when it was asked for in the last 5 minutes. */
export async function embedSearchQuery(query: string): Promise<number[]> {
  const startTime = Date.now()
  const key = embeddingCacheKey(query)

  const cached = embeddingCache.get(key)
  if (cached) {
    log(`[SEARCH:EMBEDDING] Cache hit - Age: ${Date.now() - cached.timestamp}ms, Time: ${Date.now() - startTime}ms`)
    return cached.embedding
  }

  try {
    const embeddingResponse = await getOpenAI('searchEmbedding').embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const embedding = embeddingResponse.data[0].embedding
    embeddingCache.set(key, { embedding, timestamp: Date.now() })
    log(`[SEARCH:EMBEDDING] Cache miss - Generated new embedding, Time: ${Date.now() - startTime}ms`)
    return embedding
  } catch (error: any) {
    console.error('Embedding generation error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Embedding generation failed: ${error.message}`,
    })
  }
}
