export default defineEventHandler(async (event) => {
  try {
    let body = await readBody(event);
    if (typeof body !== 'object') body = JSON.parse(body);

    const performanceStartTime = performance.now()

    let filters = body.filters

    let results = await backendFetch(event, 'v1/search', {
      method: 'POST',
      body: {
        userId: body.userId,
        attributesToRetrieve: ['*'],
        query: body.query,
        useEmbeddings: body.useEmbeddings || false,
        filters: filters || undefined,
        orderBy: body.orderBy || 'newFirst',
        hitsPerPage: body.hitsPerPage || 40,
        page: body.page || 0,
        // The trash is the one place that asks for deleted bookmarks; every
        // other search leaves this off and the backend filters them out.
        deletedOnly: body.deletedOnly || false,
        // Likewise the Private section and hidden bookmarks. This proxy sends a
        // fixed set of fields rather than the caller's body, so a flag missing
        // here is a flag the backend never sees.
        hiddenOnly: body.hiddenOnly || false
      }
    });

    
    if(results.search) {
      results = results.search
      results.results = results.hits || []
    }

    let searchResults = {
      hits: results.results || [],
      searchType: results.searchType || '',
      nbHits: results.totalHits || 0,
      page: results.page || 0,
      hitsPerPage: results.hitsPerPage || 0,
    };

    // Log performance metrics
    // console.log('Search Performance backend:', performance.now() - performanceStartTime, 'ms')

    return { search: searchResults };
  } catch (error) {
    console.error('Error in search.post.js: ', error);
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || 'Search failed'
    });
  }
})