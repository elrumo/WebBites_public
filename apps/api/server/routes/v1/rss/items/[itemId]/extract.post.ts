import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    isAutoExtractAllowed,
    usageErrorBody,
} from '#root/server/utils/rssUtils';
import { extractItemContent } from '#root/server/utils/rssService';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Extract an article\'s full text on demand',
        description:
            'Runs the same publisher fetch the poller runs for feeds with extraction on, synchronously, for one article. The result lands on the shared article row, so re-read it with `GET /v1/rss/items/{itemId}` afterwards. Same plan gate as automatic extraction: 403 `UsageError` with `quotaKind: rssAutoExtract` on free plans.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: { description: '`status` is `done`, `failed` or `skipped`' },
            401: { description: 'Unauthorized' },
            403: { description: 'UsageError — extraction requires an upgraded plan, or not subscribed to this feed' },
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
    await getSubscriptionForItem(userId, item);

    if (!(await isAutoExtractAllowed(userId))) {
        setResponseStatus(event, 403);
        return usageErrorBody('Full-text extraction requires an upgraded plan', 'rssAutoExtract');
    }

    const result = await extractItemContent(item.id);
    return { success: result.status === 'done', ...result };
});
