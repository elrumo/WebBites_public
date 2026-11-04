/**
 * SSR endpoint: fetches the first page of bookmarks server-side so the client
 * receives pre-rendered bookmark data without a separate client-side fetch.
 *
 * Calls the existing /api/v1/search proxy internally, which handles auth via cookies.
 */
export default defineEventHandler(async (event) => {
  const parseSession = getCookie(event, 'parse.session')
  const wbApiKey = getCookie(event, 'wb_api_key')

  console.log('[SSR bookmarks] Starting - parseSession:', !!parseSession, 'wbApiKey:', !!wbApiKey)

  if (!parseSession && !wbApiKey) {
    console.log('[SSR bookmarks] No auth cookies, returning null')
    return { bookmarks: null }
  }

  try {
    // Call the existing search proxy which handles auth via cookies
    const result = await $fetch('/api/v1/search', {
      method: 'POST',
      headers: {
        // Forward cookies so the proxy can authenticate
        cookie: getHeader(event, 'cookie') || ''
      },
      body: {
        query: null,
        useEmbeddings: false,
        orderBy: 'newFirst',
        hitsPerPage: 40,
        page: 0
      }
    })

    const hits = (result as any)?.search?.hits || []

    console.log('[SSR bookmarks] Fetched', hits.length, 'bookmarks')

    return {
      bookmarks: {
        hits,
        nbHits: (result as any)?.search?.nbHits || 0,
        page: (result as any)?.search?.page || 0,
        hitsPerPage: (result as any)?.search?.hitsPerPage || 40,
        allLoaded: hits.length < 40
      }
    }
  } catch (error: any) {
    console.error('[SSR bookmarks] Error:', error.message, 'status:', error.statusCode || error.status || 'unknown')
    return { bookmarks: null }
  }
})
