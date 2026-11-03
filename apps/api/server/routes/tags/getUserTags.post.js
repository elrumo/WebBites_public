import { useParse } from '../../utils/serverUtils.js';

defineRouteMeta({
    openAPI: {
    tags: ['Tags'],
    summary: 'Get user tags',
    description: 'Retrieves all tags for a user in a simple format. Returns both detailed objects and a simple array of tag names. Perfect for dropdowns, filters, and autocomplete.',
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
                tags: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      count: { type: 'number' }
                    }
                  },
                  description: 'Array of tags with their counts, sorted by most used'
                },
                tagNames: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Simple array of tag names only'
                },
                total: {
                  type: 'number',
                  description: 'Total number of tags'
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
  }
})

export default defineEventHandler(async (event) => {
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
      query.descending('count'); // Most used tags first
      query.select('tagName', 'count');
      query.limit(1000);

      const tagOccurrences = await query.find({ useMasterKey: true });

      // Return array of tag objects with name and count
      const tags = tagOccurrences.map(to => ({
        name: to.get('tagName'),
        count: to.get('count')
      }));

      // Also provide just the names for convenience
      const tagNames = tags.map(t => t.name);

      return {
        success: true,
        tags: tags,           // Array of { name, count }
        tagNames: tagNames,   // Array of strings (just tag names)
        total: tags.length
      };
    } catch (error) {
      console.error('Error getting user tags:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
);