import Parse from 'parse/node.js';

Parse.initialize(
  process.env.VITE_PARSE_ID,
  process.env.VITE_PARSE_JS_KEY,
  process.env.VITE_PARSE_MASTER_KEY
);
Parse.serverURL = process.env.VITE_PARSE_URL;

interface RequestBody {
  url: string;
}

interface PageData {
  id: string;
  url: string;
  tags?: string[];
  createdAt: Date;
  customId?: string;
  siteNotes?: string;
  siteColors?: string[];
  siteDescription?: string;
  siteTitle?: string;
}

interface SuccessResponse {
  success: true;
  isSaved: boolean;
  pageData?: PageData;
}

interface ErrorResponse {
  success: false;
  message: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

defineRouteMeta({
  openAPI: {
    tags: ['Websites'],
    summary: 'Check if page is saved',
    description: 'Check if a URL is saved for the authenticated user',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['url'],
            properties: {
              url: {
                type: 'string',
                description: 'The URL to check',
                example: 'https://example.com',
              },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    isSaved: { type: 'boolean', example: true },
                    pageData: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        url: { type: 'string' },
                        tags: { type: 'array', items: { type: 'string' } },
                        createdAt: { type: 'string', format: 'date-time' },
                        customId: { type: 'string' },
                        siteNotes: { type: 'string' },
                        siteColors: { type: 'array', items: { type: 'string' } },
                        siteDescription: { type: 'string' },
                        siteTitle: { type: 'string' },
                      },
                    },
                  },
                },
                {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    isSaved: { type: 'boolean', example: false },
                  },
                },
                {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string' },
                  },
                },
              ],
            },
          },
        },
      },
      400: {
        description: 'Bad request - URL is required',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: false },
                message: { type: 'string', example: 'URL is required' },
              },
            },
          },
        },
      },
      401: {
        description: 'Unauthorized - Invalid or missing token',
      },
      500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: false },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
});

export default defineEventHandler<Promise<ApiResponse>>(async (event) => {
  try {
    const body = await readBody<RequestBody>(event);
    console.log('[isPagedSaved] body', body);
    
    const { url } = body;
    if (!url) {
      return { success: false, message: 'URL is required' };
    }

    const parseUser = await validateParseToken(event);
    const user = parseUser.user;

    // Check if website exists for this user and URL
    const websiteQuery = new Parse.Query('websites');
    websiteQuery.equalTo('url', url);
    websiteQuery.equalTo('user', user);
    websiteQuery.notEqualTo('isDeleted', true);
    websiteQuery.descending('createdAt');

    const website = await websiteQuery.first({ useMasterKey: true });

    if (website) {
      // Return the website object if found
      return {
        success: true,
        isSaved: true,
        pageData: {
          id: website.id,
          url: website.get('url'),
          tags: website.get('tags'),
          createdAt: website.get('createdAt'),
          customId: website.get('customId'),
          siteNotes: website.get('siteNotes'),
          siteColors: website.get('siteColors'),
          siteDescription: website.get('siteDescription'),
          siteTitle: website.get('siteTitle'),
        },
      };
    } else {
      // Return false if no matching website found
      return {
        success: true,
        isSaved: false,
      };
    }
  } catch (error) {
    console.error('Error checking if page is saved:', error);
    return {
      success: false,
      message: 'An error occurred while checking if the page is saved',
    };
  }
});

