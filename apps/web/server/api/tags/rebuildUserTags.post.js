export default defineEventHandler({
  onRequest: [],
  onBeforeResponse: [],
  openAPI: {
    tags: ['Tags'],
    summary: 'Rebuild user tags',
    description: 'Rebuilds all tag occurrences for a user from scratch. Useful for fixing data inconsistencies or initial migration.',
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
                message: { type: 'string' },
                totalWebsites: {
                  type: 'number',
                  description: 'Total number of websites processed'
                },
                totalTags: {
                  type: 'number',
                  description: 'Total number of unique tags found'
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of all tag names'
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
    const Website = Parse.Object.extend('websites');

    // Delete all existing TagOccurrences for this user
    const deleteQuery = new Parse.Query(TagOccurrence);
    deleteQuery.equalTo('user', {
      __type: 'Pointer',
      className: '_User',
      objectId: userId
    });
    const toDelete = await deleteQuery.find({ useMasterKey: true });
    await Parse.Object.destroyAll(toDelete, { useMasterKey: true });

    console.log(`Deleted ${toDelete.length} existing TagOccurrences for user ${userId}`);

    // Get all websites for this user
    const websiteQuery = new Parse.Query(Website);
    websiteQuery.equalTo('user', {
      __type: 'Pointer',
      className: '_User',
      objectId: userId
    });
    websiteQuery.select('tags');
    websiteQuery.limit(10000); // Adjust if users have more websites

    const websites = await websiteQuery.find({ useMasterKey: true });
    console.log(`Found ${websites.length} websites for user ${userId}`);

    // Aggregate all tags
    const tagCounts = {};
    const tagWebsites = {}; // Track which websites have each tag

    for (const website of websites) {
      const tags = website.get('tags') || [];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        if (!tagWebsites[tag]) {
          tagWebsites[tag] = [];
        }
        tagWebsites[tag].push(website.id);
      }
    }

    // Create new TagOccurrences
    const newTagOccurrences = [];
    for (const [tagName, count] of Object.entries(tagCounts)) {
      const tagOccurrence = new TagOccurrence();
      tagOccurrence.set('user', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId
      });
      tagOccurrence.set('tagName', tagName);
      tagOccurrence.set('count', count);

      // Set ACL
      const acl = new Parse.ACL();
      acl.setReadAccess(userId, true);
      acl.setWriteAccess(userId, true);
      tagOccurrence.setACL(acl);

      newTagOccurrences.push(tagOccurrence);
    }

    // Save all new TagOccurrences
    await Parse.Object.saveAll(newTagOccurrences, { useMasterKey: true });

    // Add website relations (must be done after initial save)
    for (const tagOccurrence of newTagOccurrences) {
      const tagName = tagOccurrence.get('tagName');
      const websiteIds = tagWebsites[tagName];

      const websitesRelation = tagOccurrence.relation('websites');
      for (const websiteId of websiteIds) {
        websitesRelation.add(new Website({ id: websiteId }));
      }
    }

    await Parse.Object.saveAll(newTagOccurrences, { useMasterKey: true });

    console.log(`Created ${newTagOccurrences.length} TagOccurrences for user ${userId}`);

    return {
      success: true,
      message: 'Tag occurrences rebuilt successfully',
      totalWebsites: websites.length,
      totalTags: newTagOccurrences.length,
      tags: Object.keys(tagCounts)
    };
  } catch (error) {
    console.error('Error rebuilding user tags:', error);
    return {
      success: false,
      error: error.message
    };
  }
}});

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
