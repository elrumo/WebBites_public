import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Count WebsiteTags links',
    description: 'Returns the total count of WebsiteTag links.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                count: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event) => {
  try {
    // Initialize Parse
    if (!Parse.applicationId) {
      Parse.initialize(
        process.env.VITE_PARSE_ID,
        process.env.VITE_PARSE_JS_KEY,
        process.env.VITE_PARSE_MASTER_KEY
      );
      Parse.serverURL = process.env.VITE_PARSE_URL;
    }

    const WebsiteTags = Parse.Object.extend('WebsiteTags');
    const query = new Parse.Query(WebsiteTags);
    const count = await query.count({ useMasterKey: true });

    return {
      success: true,
      count,
      message: `Found ${count} WebsiteTag links`,
      expected: 192671
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});
