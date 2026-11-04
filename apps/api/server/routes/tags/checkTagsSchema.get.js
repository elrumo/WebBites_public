import { useParse } from '../../utils/serverUtils.js';

defineRouteMeta({
  openAPI: {
    tags: ['Tags', 'Schema'],
    summary: 'Check if Tags schema exists',
    description: 'Checks if the Tags class schema exists in Parse and returns its details.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                exists: { type: 'boolean' },
                message: { type: 'string' },
                schema: {
                  type: 'object',
                  description: 'Schema details if exists'
                }
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
    const Parse = useParse();
    const schema = new Parse.Schema('Tags');
    const schemaData = await schema.get({ useMasterKey: true });

    return {
      success: true,
      exists: true,
      message: 'Tags schema exists',
      schema: {
        className: 'Tags',
        fields: schemaData.fields,
        indexes: schemaData.indexes,
        classLevelPermissions: schemaData.classLevelPermissions
      }
    };
  } catch (error) {
    if (error.code === 103 || error.message.includes('does not exist')) {
      return {
        success: true,
        exists: false,
        message: 'Tags schema does not exist yet. Use POST /tags/createTagsSchema to create it.'
      };
    }

    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
});
