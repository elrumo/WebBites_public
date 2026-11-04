import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    markItemUnread,
    serializeSubscription,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Mark an article unread',
        description:
            'Deletes the read mark and restores the unread count. An article that is read only because it falls under a mark-all-read cutoff cannot be individually restored — `changed` comes back false, and the client should leave its row alone.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: 'Article marked unread' },
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

    const { changed } = await markItemUnread(userId, item, subscription);

    return { success: true, changed, subscription: serializeSubscription(subscription) };
});
