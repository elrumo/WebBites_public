import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Sync website tags',
    description: 'Syncs tags for a website to the normalized Tags and WebsiteTags system. Called by Parse triggers.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['websiteId', 'newTags'],
            properties: {
              websiteId: {
                type: 'string',
                description: 'Website objectId'
              },
              oldTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Previous tags (empty array for new websites)',
                default: []
              },
              newTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'New tags'
              },
              userId: {
                type: 'string',
                description: 'User objectId (optional, will be fetched from website if not provided)'
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
                changes: {
                  type: 'object',
                  properties: {
                    added: { type: 'number' },
                    removed: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
});

/**
 * Find or create a tag
 */
async function findOrCreateTag(tagName) {
  const Tags = Parse.Object.extend('Tags');
  const normalizedName = tagName.toLowerCase().trim();

  // Try to find existing tag
  const query = new Parse.Query(Tags);
  query.equalTo('nameNormalized', normalizedName);
  let tag = await query.first({ useMasterKey: true });

  // Create if doesn't exist
  if (!tag) {
    tag = new Tags();
    tag.set('name', tagName.trim());
    tag.set('nameNormalized', normalizedName);
    tag.set('isGlobal', true);

    try {
      await tag.save(null, { useMasterKey: true });
    } catch (error) {
      // If duplicate key error (race condition), try to fetch again
      if (error.code === 137) {
        tag = await query.first({ useMasterKey: true });
        if (!tag) {
          throw new Error(`Failed to create or find tag: ${tagName}`);
        }
      } else {
        throw error;
      }
    }
  }

  return tag;
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { websiteId, oldTags = [], newTags = [], userId: providedUserId } = body;

    if (!websiteId) {
      return {
        success: false,
        error: 'websiteId is required'
      };
    }

    if (!newTags || !Array.isArray(newTags)) {
      return {
        success: false,
        error: 'newTags must be an array'
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

    // Get website and user
    const Website = Parse.Object.extend('websites');
    const website = Website.createWithoutData(websiteId);

    let userId = providedUserId;
    if (!userId) {
      // Fetch website to get user
      const websiteQuery = new Parse.Query(Website);
      const fetchedWebsite = await websiteQuery.get(websiteId, { useMasterKey: true });
      const user = fetchedWebsite.get('user');

      if (!user) {
        return {
          success: false,
          error: 'Website has no user'
        };
      }

      userId = user.id;
    }

    const User = Parse.Object.extend('_User');
    const user = User.createWithoutData(userId);

    // Calculate differences
    const addedTags = newTags.filter(tag => !oldTags.includes(tag));
    const removedTags = oldTags.filter(tag => !newTags.includes(tag));

    const WebsiteTags = Parse.Object.extend('WebsiteTags');

    // Remove old WebsiteTags
    for (const tagName of removedTags) {
      if (!tagName || typeof tagName !== 'string' || tagName.trim() === '') continue;

      try {
        const tag = await findOrCreateTag(tagName);

        // Find and delete the WebsiteTag link
        const linkQuery = new Parse.Query(WebsiteTags);
        linkQuery.equalTo('website', website);
        linkQuery.equalTo('tag', tag);
        linkQuery.equalTo('user', user);

        const link = await linkQuery.first({ useMasterKey: true });
        if (link) {
          await link.destroy({ useMasterKey: true });
        }
      } catch (error) {
        console.error(`Error removing tag "${tagName}":`, error.message);
        // Continue with other tags
      }
    }

    // Add new WebsiteTags
    for (const tagName of addedTags) {
      if (!tagName || typeof tagName !== 'string' || tagName.trim() === '') continue;

      try {
        const tag = await findOrCreateTag(tagName);

        // Check if link already exists (avoid duplicates)
        const linkQuery = new Parse.Query(WebsiteTags);
        linkQuery.equalTo('website', website);
        linkQuery.equalTo('tag', tag);
        linkQuery.equalTo('user', user);

        const existingLink = await linkQuery.first({ useMasterKey: true });

        if (!existingLink) {
          const link = new WebsiteTags();
          link.set('website', website);
          link.set('tag', tag);
          link.set('user', user);
          link.set('addedAt', new Date());

          // Set ACL to match user
          const acl = new Parse.ACL(user);
          link.setACL(acl);

          await link.save(null, { useMasterKey: true });
        }
      } catch (error) {
        console.error(`Error adding tag "${tagName}":`, error.message);
        // Continue with other tags
      }
    }

    return {
      success: true,
      message: 'Tags synced successfully',
      changes: {
        added: addedTags.length,
        removed: removedTags.length
      }
    };

  } catch (error) {
    console.error('Error syncing website tags:', error);
    return {
      success: false,
      error: error.message || String(error),
      code: error.code
    };
  }
});
