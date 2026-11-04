export default defineEventHandler({
  onRequest: [],
  onBeforeResponse: [],
  openAPI: {
    tags: ['Tags'],
    summary: 'Get user tag statistics',
    description: 'Retrieves detailed statistics about all tags for a user, including counts and occurrence IDs.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['userId'],
            properties: {
              userId: {
                type: 'string',
                description: 'Parse User objectId'
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
                totalTags: {
                  type: 'number',
                  description: 'Total number of unique tags'
                },
                totalOccurrences: {
                  type: 'number',
                  description: 'Sum of all tag counts'
                },
                tags: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      tagName: { type: 'string' },
                      count: { type: 'number' },
                      objectId: { type: 'string' }
                    }
                  },
                  description: 'Array of tags with their statistics'
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Bad request - missing userId',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: { type: 'string' }
              }
            }
          }
        }
      }
    }
  },
  handler: async (event) => {
    try {
      const body = await readBody(event);
      const { userId } = body;

      if (!userId) {
        return {
          success: false,
          error: 'userId parameter is required'
        };
      }

      const Parse = useParse();
      const TagOccurrence = Parse.Object.extend('TagOccurrences');

      const query = new Parse.Query(TagOccurrence);
      query.equalTo('user', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      });
      query.descending('count');
      query.limit(1000);

      const tagOccurrences = await query.find({ useMasterKey: true });

      const stats = tagOccurrences.map(to => ({
        tagName: to.get('tagName'),
        count: to.get('count'),
        objectId: to.id
      }));

      return {
        success: true,
        totalTags: stats.length,
        totalOccurrences: stats.reduce((sum, tag) => sum + tag.count, 0),
        tags: stats
      };
    } catch (error) {
      console.error('Error getting tag stats:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

/**
 * Helper to initialize Parse connection
 */
function useParse() {
  const config = useRuntimeConfig();
  const Parse = require('parse/node');

  if (!Parse.applicationId) {
    Parse.initialize(
      config.public.parseAppId,
      config.public.parseJsKey,
      useRuntimeConfig().parseMasterKey
    );
    Parse.serverURL = parseBaseUrl();
  }

  return Parse;
}
