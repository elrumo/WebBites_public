import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    markItemRead,
    serializeSubscription,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Mark an article read',
        description:
            'Idempotent: the read mark is keyed by user and article, so two devices marking the same article at the same moment converge on one row and one decrement of the unread counter. The updated subscription comes back so clients can settle their badge without a refetch.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'Article marked read',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                changed: {
                                    type: 'boolean',
                                    description: 'False when the article already counted as read.',
                                },
                                subscription: { type: 'object' },
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

    const item = await getItemOrThrow(itemId);
    const subscription = await getSubscriptionForItem(userId, item);

    const { changed } = await markItemRead(userId, item, subscription);

    return { success: true, changed, subscription: serializeSubscription(subscription) };
});
