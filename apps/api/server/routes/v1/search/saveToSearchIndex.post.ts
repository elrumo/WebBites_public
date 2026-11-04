import { captureException } from '#root/server/utils/sentry.js';
import { defineEventHandler, readBody, createError, H3Event } from 'h3';
import { saveWebsiteToSearchIndices } from '../../../utils/serverUtils.js';

// Define OpenAPI documentation for this route
defineRouteMeta({
    openAPI: {
        tags: ['Search'],
        description: 'Save website data to both Algolia and Meilisearch search indices',
        requestBody: {
            description: 'Website data to save to search indices',
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            websiteId: {
                                type: 'string',
                                description: 'Parse object ID of the website to save'
                            }
                        },
                        required: ['websiteId']
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'Successfully saved to both search indices',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                algolia: { type: 'object' },
                                meilisearch: { type: 'object' }
                            }
                        }
                    }
                }
            },
            400: {
                description: 'Bad request - missing websiteId'
            },
            404: {
                description: 'Website not found'
            },
            500: {
                description: 'Internal server error'
            }
        }
    }
});

export default defineEventHandler(async (event: H3Event) => {
    try {
        const body: { websiteId?: string } = await readBody(event);
        const { websiteId } = body;

        if (!websiteId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'websiteId is required'
            });
        }

        // Call the utility function to save to search indices
        const result = await saveWebsiteToSearchIndices(websiteId, 'saveToSearchIndex');
        return result;

    } catch (error: any) {
        console.error('[SAVE TO SEARCH INDEX] Error in saveToSearchIndex:', error?.message || String(error));
        captureException(error);

        // Handle website not found error
        if ((error as Error).message?.includes('Website not found')) {
            throw createError({
                statusCode: 404,
                statusMessage: 'Website not found'
            });
        }

        throw createError({
            statusCode: (error as any).statusCode || 500,
            statusMessage: (error as any).statusMessage || 'Internal server error'
        });
    }
});
