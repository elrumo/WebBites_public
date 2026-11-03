import Parse from 'parse/node.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags', 'Schema'],
    summary: 'Create a sample tag to initialize Tags class',
    description: 'Creates a sample tag object to initialize the Tags class in Parse. The tag will be deleted after creation.',
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

    // Create the Tags class by creating a sample object
    const Tags = Parse.Object.extend('Tags');
    const sampleTag = new Tags();

    sampleTag.set('name', 'JavaScript');
    sampleTag.set('nameNormalized', 'javascript');
    sampleTag.set('isGlobal', true);

    // Save the sample tag
    const savedTag = await sampleTag.save(null, { useMasterKey: true });

    return {
      success: true,
      message: 'Tags class created successfully with a sample tag',
      tagId: savedTag.id,
      note: 'You can now add indexes via the Parse Dashboard: nameNormalized (unique), name, createdBy'
    };
  } catch (error) {
    console.error('Error creating sample tag:', error);

    return {
      success: false,
      error: error.message || String(error),
      code: error.code
    };
  }
});
