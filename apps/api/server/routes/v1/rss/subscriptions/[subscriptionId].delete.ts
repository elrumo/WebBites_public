import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getSubscriptionOrThrow,
    adjustSubscriberCount,
    recomputeExtractionWanted,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Unsubscribe from a feed',
        description:
            'Soft-deletes the subscription and decrements the feed\'s subscriber count. The shared feed and its articles are untouched — other subscribers keep reading them, and resubscribing within 30 days revives this row rather than creating a new one.',
        parameters: [
            { name: 'subscriptionId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: 'Unsubscribed' },
            401: { description: 'Unauthorized' },
            404: { description: 'Subscription not found' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const subscriptionId = getRouterParam(event, 'subscriptionId');
    if (!subscriptionId) throw createError({ statusCode: 400, statusMessage: 'subscriptionId is required' });

    const subscription = await getSubscriptionOrThrow(userId, subscriptionId);
    const feed = subscription.get('feed');

    subscription.set('isDeleted', true);
    subscription.set('deletedAt', new Date());
    subscription.set('unreadCount', 0);
    await subscription.save(null, { useMasterKey: true });

    if (feed) {
        await adjustSubscriberCount(feed, -1);
        // The last subscriber wanting extraction may have just left.
        await recomputeExtractionWanted(feed);
    }

    return { success: true, subscriptionId };
});
