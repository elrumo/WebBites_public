import { defineEventHandler, readBody, createError } from 'h3';
import { initParseForRss, requireRssUserId, serializeSubscription } from '#root/server/utils/rssUtils';
import { subscribeToUrl } from '#root/server/utils/rssService';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Subscribe to a feed',
        description:
            'Accepts a feed URL or a plain site URL. A site URL is resolved through advertised links, known site rules, and conventional feed paths. The first poll runs inline, so the response is followed immediately by readable articles.',
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
                                description: 'A feed URL, a site URL, or a bare hostname.',
                                example: 'https://overreacted.io',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Subscribed, or already subscribed',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                subscription: { type: 'object' },
                                created: {
                                    type: 'boolean',
                                    description: 'False when the user was already subscribed to this feed.',
                                },
                            },
                        },
                    },
                },
            },
            400: { description: 'No feed could be found at the supplied address' },
            401: { description: 'Unauthorized' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const body = await readBody(event);
    const url = body?.url;
    if (!url || typeof url !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'url is required' });
    }

    const { subscription, created } = await subscribeToUrl(userId, url);

    return { success: true, subscription: serializeSubscription(subscription), created };
});
