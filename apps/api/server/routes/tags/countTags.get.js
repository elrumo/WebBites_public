import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Count total tags in Tags class',
    description: 'Returns the total count of tags in the Tags class.',
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

    const Tags = Parse.Object.extend('Tags');
    const query = new Parse.Query(Tags);
    const count = await query.count({ useMasterKey: true });

    return {
      success: true,
      count,
      message: `Found ${count} tags in Tags class`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});
