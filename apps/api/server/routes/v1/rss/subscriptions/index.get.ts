import { defineEventHandler } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getActiveSubscriptions,
    serializeSubscription,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'List feed subscriptions',
        description:
            'Returns the authenticated user\'s active subscriptions in sidebar order, each with its shared feed metadata and its materialised unread count.',
        parameters: [
            {
                name: 'authorization',
                in: 'header',
                required: true,
                description: 'Bearer API key.',
                schema: { type: 'string', example: 'Bearer wb_live_abc123' },
            },
        ],
        responses: {
            200: {
                description: 'Subscriptions listed',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                subscriptions: { type: 'array', items: { type: 'object' } },
                                totalUnread: { type: 'number', description: 'Sum of every subscription\'s unread count.' },
                            },
                        },
                    },
                },
            },
            401: { description: 'Unauthorized' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const subscriptions = (await getActiveSubscriptions(userId)).map(serializeSubscription);

    return {
        success: true,
        subscriptions,
        // Sent alongside the list so the sidebar's "Unread" badge never needs a
        // second request, and can never disagree with the per-feed badges.
        totalUnread: subscriptions.reduce((total, subscription) => total + subscription.unreadCount, 0),
    };
});
