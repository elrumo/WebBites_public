import { defineEventHandler, getRouterParam, createError } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    readableTextFor,
} from '#root/server/utils/rssUtils';
import { ensureSummary } from '#root/server/utils/rssService';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Summarise an article',
        description:
            'Generates the same `{tldr, pointsThatBestDescribeThePage}` summary bookmarks get, from the extracted full text when the feed has extraction on and from the feed body otherwise. The result is cached on the shared article, so a second reader of the same piece pays nothing and gets the answer instantly. On-demand summaries are available on every plan.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'Summary returned, generated or cached',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                aiSummary: { type: 'object', nullable: true },
                                fromCache: { type: 'boolean' },
                            },
                        },
                    },
                },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Not subscribed to this article\'s feed' },
            404: { description: 'Article not found' },
            422: { description: 'The article has too little text to summarise' },
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

    if (item.get('aiSummary')) {
        return { success: true, aiSummary: item.get('aiSummary'), fromCache: true };
    }

    if (readableTextFor(item).length < 200) {
        throw createError({
            statusCode: 422,
            statusMessage: 'This article has too little text to summarise',
        });
    }

    const generated = await ensureSummary(item, userId);
    if (!generated) {
        throw createError({ statusCode: 502, statusMessage: 'Could not generate a summary for this article' });
    }

    return { success: true, aiSummary: item.get('aiSummary'), fromCache: false };
});
