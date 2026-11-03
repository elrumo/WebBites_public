import { defineEventHandler, getQuery } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getSubscriptionOrThrow,
    listItems,
    listReadLater,
    MAX_ITEMS_PER_PAGE,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'List articles',
        description:
            'Returns article rows newest first, across every subscription or within one. Read state is computed server-side — the `isRead` flag already accounts for explicit read marks, the last mark-all-read, and when the user subscribed — so clients never reason about cutoffs. Rows carry no article body; fetch one article to read it. `readLater=true` returns the Read later shelf instead, ordered by when each article was shelved rather than when it was published.',
        parameters: [
            {
                name: 'subscriptionId',
                in: 'query',
                required: false,
                description: 'Restrict to one subscription. Omit for every subscribed feed.',
                schema: { type: 'string' },
            },
            {
                name: 'unreadOnly',
                in: 'query',
                required: false,
                schema: { type: 'boolean', default: false },
            },
            {
                name: 'readLater',
                in: 'query',
                required: false,
                description:
                    'Return the Read later shelf, newest-shelved first. Ignores `subscriptionId` and `unreadOnly`.',
                schema: { type: 'boolean', default: false },
            },
            {
                name: 'limit',
                in: 'query',
                required: false,
                schema: { type: 'number', default: 50, maximum: MAX_ITEMS_PER_PAGE },
            },
            {
                name: 'cursor',
                in: 'query',
                required: false,
                description: 'Opaque cursor from a previous response\'s `nextCursor`.',
                schema: { type: 'string' },
            },
        ],
        responses: {
            200: {
                description: 'Articles listed',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                items: { type: 'array', items: { type: 'object' } },
                                nextCursor: {
                                    type: 'string',
                                    nullable: true,
                                    description: 'Null when the list is exhausted.',
                                },
                            },
                        },
                    },
                },
            },
            401: { description: 'Unauthorized' },
            404: { description: 'Subscription not found' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const query = getQuery(event);
    const limit = parseInt(query.limit as string) || 50;

    if (query.readLater === 'true' || query.readLater === true) {
        const shelf = await listReadLater({
            userId,
            limit,
            cursor: (query.cursor as string) || null,
        });
        return { success: true, items: shelf.items, nextCursor: shelf.nextCursor };
    }

    const subscriptionId = query.subscriptionId as string | undefined;

    const subscription = subscriptionId
        ? await getSubscriptionOrThrow(userId, subscriptionId)
        : null;

    const { items, nextCursor } = await listItems({
        userId,
        subscription,
        unreadOnly: query.unreadOnly === 'true' || query.unreadOnly === true,
        limit,
        cursor: (query.cursor as string) || null,
    });

    return { success: true, items, nextCursor };
});
