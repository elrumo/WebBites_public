import { defineEventHandler, readBody } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getActiveSubscriptions,
    getSubscriptionOrThrow,
    markAllRead,
    serializeSubscription,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Mark everything read',
        description:
            'Moves the read cutoff on one subscription, or on all of them, and zeroes their unread counters. This is one write per subscription regardless of how many articles it covers — the cutoff is what makes an article read, not a row per article.',
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            subscriptionId: {
                                type: 'string',
                                description: 'Restrict to one subscription. Omit to mark every feed read.',
                            },
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'Marked read' },
            401: { description: 'Unauthorized' },
            404: { description: 'Subscription not found' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const body = (await readBody(event).catch(() => ({}))) || {};
    const subscriptionId = body?.subscriptionId;

    const subscriptions = subscriptionId
        ? [await getSubscriptionOrThrow(userId, subscriptionId)]
        : await getActiveSubscriptions(userId);

    const purgedMarks = await markAllRead(userId, subscriptions);

    return {
        success: true,
        subscriptions: subscriptions.map(serializeSubscription),
        // Reported for observability: it is the number of now-redundant read
        // marks the cutoff let us delete, not a count of articles affected.
        purgedMarks,
    };
});
