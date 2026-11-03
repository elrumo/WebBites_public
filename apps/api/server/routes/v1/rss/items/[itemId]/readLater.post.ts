import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    setReadLater,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Add or remove an article from Read later',
        description:
            'One route for both edges — `saved: false` takes the article off the shelf. Idempotent: the shelf row is keyed by user and article, so a retry or a second device converges on one row. The shelf deliberately survives mark-all-read, which purges read marks.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: false,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            saved: {
                                type: 'boolean',
                                default: true,
                                description: 'False removes the article from the shelf.',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Shelf updated',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                isReadLater: { type: 'boolean' },
                                changed: {
                                    type: 'boolean',
                                    description: 'False when the article was already in that state.',
                                },
                            },
                        },
                    },
                },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Not subscribed to this article\'s feed' },
            404: { description: 'Article not found' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const itemId = getRouterParam(event, 'itemId');
    if (!itemId) throw createError({ statusCode: 400, statusMessage: 'itemId is required' });

    const body = await readBody(event).catch(() => ({}));
    const saved = body?.saved !== false;

    const item = await getItemOrThrow(itemId);
    // Shelving is a subscriber action, same as marking read — this is what
    // stops one user shelving another's private feed's articles.
    await getSubscriptionForItem(userId, item);

    const { changed } = await setReadLater(userId, item, saved);

    return { success: true, isReadLater: saved, changed };
});
