import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Delete all tags for a website',
    description: 'Removes all WebsiteTag links for a website. Called when a website is deleted.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['websiteId', 'tags'],
            properties: {
              websiteId: {
                type: 'string',
                description: 'Website objectId'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags to remove'
              },
              userId: {
                type: 'string',
                description: 'User objectId (optional)'
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                deletedCount: { type: 'number' }
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
    const body = await readBody(event);
    const { websiteId, tags = [], userId: providedUserId } = body;

    if (!websiteId) {
      return {
        success: false,
        error: 'websiteId is required'
      };
    }

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
    const Website = Parse.Object.extend('websites');
    const website = Website.createWithoutData(websiteId);

    // Query all WebsiteTag links for this website
    const query = new Parse.Query(WebsiteTags);
    query.equalTo('website', website);

    if (providedUserId) {
      const User = Parse.Object.extend('_User');
      const user = User.createWithoutData(providedUserId);
      query.equalTo('user', user);
    }

    const links = await query.find({ useMasterKey: true });

    if (links.length > 0) {
      await Parse.Object.destroyAll(links, { useMasterKey: true });
    }

    return {
      success: true,
      message: `Deleted ${links.length} tag associations for website ${websiteId}`,
      deletedCount: links.length
    };

  } catch (error) {
    console.error('Error deleting website tags:', error);
    return {
      success: false,
      error: error.message || String(error),
      code: error.code
    };
  }
});
