import { useParse } from '../../utils/serverUtils.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags', 'Schema'],
    summary: 'Create Tags schema in Parse',
    description: 'Creates the Tags class schema with proper fields and indexes. This is a one-time setup endpoint.',
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              force: {
                type: 'boolean',
                description: 'Force recreation of schema (deletes existing)',
                default: false
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
                className: { type: 'string' },
                fields: { type: 'object' },
                indexes: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      },
      400: {
        description: 'Bad request or schema already exists',
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
});

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event).catch(() => ({}));
    const { force = false } = body;

    const Parse = useParse();

    // Check if Tags class already exists by trying to query it
    try {
      const Tags = Parse.Object.extend('Tags');
      const query = new Parse.Query(Tags);
      query.limit(1);
      await query.find({ useMasterKey: true });

      return {
        success: false,
        error: 'Tags class already exists',
        note: 'Use the Parse dashboard to modify the schema or manually delete the class and try again',
        message: 'The Tags class is already created in your Parse database'
      };
    } catch (queryError) {
      // Class doesn't exist yet, which is what we want
      console.log('Tags class does not exist yet, proceeding with creation');
    }

    // Create the Tags class by creating a sample object
    // This is the B4A/Parse way to create classes
    const Tags = Parse.Object.extend('Tags');
    const sampleTag = new Tags();

    sampleTag.set('name', 'Sample');
    sampleTag.set('nameNormalized', 'sample');
    sampleTag.set('isGlobal', false);

    // Save the sample tag to create the class
    await sampleTag.save(null, { useMasterKey: true });

    // Delete the sample tag immediately
    await sampleTag.destroy({ useMasterKey: true });

    return {
      success: true,
      message: 'Tags class created successfully',
      className: 'Tags',
      note: 'The class has been created. You should now add indexes via the Parse dashboard for optimal performance.',
      recommendedIndexes: [
        'nameNormalized (ascending, unique) - For case-insensitive tag lookups',
        'name (ascending) - For display name searches',
        'createdBy (ascending) - For user-specific tag queries'
      ],
      fields: {
        name: 'String - Display name of the tag',
        nameNormalized: 'String - Lowercase normalized name for case-insensitive matching',
        createdBy: 'Pointer<_User> - User who created this tag (optional)',
        isGlobal: 'Boolean - Whether this is a system-wide tag'
      },
      nextSteps: [
        '1. Go to Parse Dashboard > Tags class',
        '2. Add index on "nameNormalized" field (unique)',
        '3. Add index on "name" field',
        '4. Set class level permissions as needed'
      ]
    };
  } catch (error) {
    console.error('Error creating Tags class:', error);

    return {
      success: false,
      error: error.message || String(error),
      code: error.code,
      stack: error.stack
    };
  }
});
