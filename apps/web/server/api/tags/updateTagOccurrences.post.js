export default defineEventHandler({
  onRequest: [],
  onBeforeResponse: [],
  openAPI: {
    tags: ['Tags'],
    summary: 'Update tag occurrences',
    description: 'Backend endpoint for managing tag occurrences. Called by Parse triggers to keep tag counts synchronized.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['action', 'userId'],
            properties: {
              action: {
                type: 'string',
                enum: ['save', 'delete'],
                description: 'Action to perform: save (update) or delete'
              },
              userId: {
                type: 'string',
                description: 'Parse User objectId'
              },
              websiteId: {
                type: 'string',
                description: 'Parse Website objectId'
              },
              oldTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Previous tags (for save action only)'
              },
              newTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'New tags (for save action only)'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags to remove (for delete action only)'
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
                },
                tagsProcessed: { type: 'number' }
              }
            }
          }
        }
      },
      400: {
        description: 'Bad request - missing required fields',
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
      const { action, userId, websiteId, oldTags, newTags, tags } = body;

      // Validate required fields
      if (!action || !userId) {
        return {
          success: false,
          error: 'Missing required fields: action and userId are required'
        };
      }

      if (action === 'save') {
        return await handleSaveAction(userId, websiteId, oldTags || [], newTags || []);
      } else if (action === 'delete') {
        return await handleDeleteAction(userId, websiteId, tags || []);
      } else {
        return {
          success: false,
          error: `Unknown action: ${action}`
        };
      }
    } catch (error) {
      console.error('Error in updateTagOccurrences:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

/**
 * Handle website save action - update tag counts based on changes
 */
async function handleSaveAction(userId, websiteId, oldTags, newTags) {
  const Parse = useParse();
  const TagOccurrence = Parse.Object.extend('TagOccurrences');

  try {
    // Calculate which tags were added and removed
    const addedTags = newTags.filter(tag => !oldTags.includes(tag));
    const removedTags = oldTags.filter(tag => !newTags.includes(tag));

    console.log(`Processing tag changes for website ${websiteId}:`, {
      added: addedTags,
      removed: removedTags
    });

    // Process removed tags (decrement counts)
    for (const tagName of removedTags) {
      await decrementTagCount(userId, tagName, websiteId, Parse);
    }

    // Process added tags (increment counts)
    for (const tagName of addedTags) {
      await incrementTagCount(userId, tagName, websiteId, Parse);
    }

    return {
      success: true,
      message: 'Tag occurrences updated successfully',
      changes: {
        added: addedTags.length,
        removed: removedTags.length
      }
    };
  } catch (error) {
    console.error('Error in handleSaveAction:', error);
    throw error;
  }
}

/**
 * Handle website delete action - decrement all tag counts
 */
async function handleDeleteAction(userId, websiteId, tags) {
  const Parse = useParse();

  try {
    console.log(`Processing tag removal for deleted website ${websiteId}:`, tags);

    // Decrement count for each tag
    for (const tagName of tags) {
      await decrementTagCount(userId, tagName, websiteId, Parse);
    }

    return {
      success: true,
      message: 'Tag occurrences updated for deleted website',
      tagsProcessed: tags.length
    };
  } catch (error) {
    console.error('Error in handleDeleteAction:', error);
    throw error;
  }
}

/**
 * Increment count for a tag (or create new TagOccurrence if doesn't exist)
 */
async function incrementTagCount(userId, tagName, websiteId, Parse) {
  const TagOccurrence = Parse.Object.extend('TagOccurrences');
  const Website = Parse.Object.extend('websites');

  // Find existing TagOccurrence for this user and tag
  const query = new Parse.Query(TagOccurrence);
  query.equalTo('user', {
    __type: 'Pointer',
    className: '_User',
    objectId: userId
  });
  query.equalTo('tagName', tagName);

  const tagOccurrence = await query.first({ useMasterKey: true });

  if (tagOccurrence) {
    // Increment existing count
    tagOccurrence.increment('count', 1);

    // Add website to the relation
    const websitesRelation = tagOccurrence.relation('websites');
    const websitePointer = new Website({ id: websiteId });
    websitesRelation.add(websitePointer);

    await tagOccurrence.save(null, { useMasterKey: true });
    console.log(`Incremented count for tag "${tagName}" to ${tagOccurrence.get('count')}`);
  } else {
    // Create new TagOccurrence
    const newTagOccurrence = new TagOccurrence();
    newTagOccurrence.set('user', {
      __type: 'Pointer',
      className: '_User',
      objectId: userId
    });
    newTagOccurrence.set('tagName', tagName);
    newTagOccurrence.set('count', 1);

    // Set ACL to only allow the user to read/write
    const acl = new Parse.ACL();
    acl.setReadAccess(userId, true);
    acl.setWriteAccess(userId, true);
    newTagOccurrence.setACL(acl);

    await newTagOccurrence.save(null, { useMasterKey: true });

    // Add website to the relation
    const websitesRelation = newTagOccurrence.relation('websites');
    const websitePointer = new Website({ id: websiteId });
    websitesRelation.add(websitePointer);

    await newTagOccurrence.save(null, { useMasterKey: true });
    console.log(`Created new TagOccurrence for tag "${tagName}"`);
  }
}

/**
 * Decrement count for a tag (delete TagOccurrence if count reaches 0)
 */
async function decrementTagCount(userId, tagName, websiteId, Parse) {
  const TagOccurrence = Parse.Object.extend('TagOccurrences');
  const Website = Parse.Object.extend('websites');

  // Find existing TagOccurrence for this user and tag
  const query = new Parse.Query(TagOccurrence);
  query.equalTo('user', {
    __type: 'Pointer',
    className: '_User',
    objectId: userId
  });
  query.equalTo('tagName', tagName);

  const tagOccurrence = await query.first({ useMasterKey: true });

  if (tagOccurrence) {
    const currentCount = tagOccurrence.get('count') || 0;

    // Remove website from the relation
    const websitesRelation = tagOccurrence.relation('websites');
    const websitePointer = new Website({ id: websiteId });
    websitesRelation.remove(websitePointer);

    if (currentCount <= 1) {
      // Delete the TagOccurrence if this was the last occurrence
      await tagOccurrence.destroy({ useMasterKey: true });
      console.log(`Deleted TagOccurrence for tag "${tagName}" (count reached 0)`);
    } else {
      // Decrement the count
      tagOccurrence.increment('count', -1);
      await tagOccurrence.save(null, { useMasterKey: true });
      console.log(`Decremented count for tag "${tagName}" to ${tagOccurrence.get('count')}`);
    }
  } else {
    console.warn(`TagOccurrence not found for tag "${tagName}" and user ${userId}`);
  }
}

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
