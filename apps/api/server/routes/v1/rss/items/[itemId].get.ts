import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    fetchReadMarks,
    fetchReadLaterMarks,
    isItemRead,
    serializeItemDetail,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Read one article',
        description:
            'Everything a reader pane needs: the body the feed shipped, the extracted full text when it exists, a cached AI summary, and a cached audio URL. Requires an active subscription to the article\'s feed — `rssItems` is a shared catalogue, so the subscription is the access check.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: 'Article returned' },
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

    const [marks, savedForLater] = await Promise.all([
        fetchReadMarks(userId, [item.id]),
        fetchReadLaterMarks(userId, [item.id]),
    ]);
    const read = isItemRead(item.get('publishedAt') || null, subscription, marks, item.id);

    return {
        success: true,
        item: serializeItemDetail(item, subscription, read, savedForLater.has(item.id)),
    };
});
