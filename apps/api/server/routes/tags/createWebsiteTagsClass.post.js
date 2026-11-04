import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags', 'Schema'],
    summary: 'Create WebsiteTags junction table',
    description: 'Creates the WebsiteTags class to link websites with tags in a many-to-many relationship.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                message: { type: 'string' }
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

    // Check if WebsiteTags class already exists
    try {
      const WebsiteTags = Parse.Object.extend('WebsiteTags');
      const query = new Parse.Query(WebsiteTags);
      query.limit(1);
      await query.find({ useMasterKey: true });

      return {
        success: false,
        error: 'WebsiteTags class already exists',
        message: 'The WebsiteTags junction table is already created'
      };
    } catch (queryError) {
      console.log('WebsiteTags class does not exist yet, proceeding with creation');
    }

    // Create the WebsiteTags class by creating a sample object
    const WebsiteTags = Parse.Object.extend('WebsiteTags');
    const sampleLink = new WebsiteTags();

    // Get the sample JavaScript tag we created earlier
    const Tags = Parse.Object.extend('Tags');
    const tagQuery = new Parse.Query(Tags);
    tagQuery.equalTo('nameNormalized', 'javascript');
    const jsTag = await tagQuery.first({ useMasterKey: true });

    if (!jsTag) {
      throw new Error('Sample tag not found. Please create Tags class first.');
    }

    // Get a sample website
    const Website = Parse.Object.extend('websites');
    const websiteQuery = new Parse.Query(Website);
    websiteQuery.limit(1);
    const sampleWebsite = await websiteQuery.first({ useMasterKey: true });

    if (!sampleWebsite) {
      throw new Error('No websites found. Cannot create sample WebsiteTags entry.');
    }

    // Get the user from the website
    const user = sampleWebsite.get('user');

    sampleLink.set('website', sampleWebsite);
    sampleLink.set('tag', jsTag);
    sampleLink.set('user', user);
    sampleLink.set('addedAt', new Date());

    // Save the sample link
    const savedLink = await sampleLink.save(null, { useMasterKey: true });

    // Delete the sample link immediately
    await savedLink.destroy({ useMasterKey: true });

    return {
      success: true,
      message: 'WebsiteTags junction table created successfully',
      className: 'WebsiteTags',
      fields: {
        website: 'Pointer<websites> - The website',
        tag: 'Pointer<Tags> - The tag',
        user: 'Pointer<_User> - The user who owns this relationship',
        addedAt: 'Date - When the tag was added to the website'
      },
      recommendedIndexes: [
        'user + tag (compound, ascending) - For user-specific tag queries',
        'website + tag (compound, ascending) - For website-specific tag queries',
        'user + website (compound, ascending) - For finding all tags on a user\'s website',
        'tag (ascending) - For finding all websites with a specific tag'
      ],
      nextSteps: [
        '1. Go to Parse Dashboard > WebsiteTags class',
        '2. Add compound index on (user, tag)',
        '3. Add compound index on (website, tag)',
        '4. Add compound index on (user, website)',
        '5. Add index on tag field',
        '6. Run migration to populate WebsiteTags from existing data'
      ]
    };
  } catch (error) {
    console.error('Error creating WebsiteTags class:', error);

    return {
      success: false,
      error: error.message || String(error),
      code: error.code
    };
  }
});
