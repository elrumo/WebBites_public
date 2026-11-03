import { defineEventHandler, getRouterParam, createError, setResponseStatus, readBody } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getItemOrThrow,
    getSubscriptionForItem,
    readableTextFor,
    usageErrorBody,
} from '#root/server/utils/rssUtils';
import { hasAudioQuota } from '#root/server/utils/plans';
import { buildAudioStreamEndpoint } from '#root/server/utils/audio-auth';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Get a listen-to-this-article endpoint',
        description:
            'Mirrors the bookmark audio flow: the same monthly quota check, the same signed short-lived streaming endpoint. The finished MP3 is cached on the shared article, so a second listener — anyone subscribed to that feed — gets `cached: true` and spends no quota at all.',
        parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'Endpoint or cached audio URL',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                endpoint: {
                                    type: 'string',
                                    nullable: true,
                                    description: 'Signed streaming URL. Null when cached audio is returned instead.',
                                },
                                audioUrl: {
                                    type: 'string',
                                    nullable: true,
                                    description: 'A previously generated MP3 for this article.',
                                },
                                cached: { type: 'boolean' },
                            },
                        },
                    },
                },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'UsageError — monthly audio limit reached, or not subscribed to this feed' },
            404: { description: 'Article not found' },
            422: { description: 'The article has no text to read aloud' },
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

    // Cache first, and deliberately before the quota check: replaying audio
    // that already exists should never cost a user one of their generations.
    const cachedUrl = item.get('articleAudioUrl') || item.get('articleAudio')?.url?.();
    if (cachedUrl) {
        return { success: true, endpoint: null, audioUrl: cachedUrl, cached: true };
    }

    const text = readableTextFor(item);
    if (!text.trim()) {
        throw createError({ statusCode: 422, statusMessage: 'This article has no text to read aloud' });
    }

    if (!(await hasAudioQuota(userId))) {
        setResponseStatus(event, 403);
        return usageErrorBody('Usage limit reached, please upgrade your plan', 'audio');
    }

    const body = await readBody(event).catch(() => null);
    const endpoint = buildAudioStreamEndpoint({
        text,
        userId,
        // `streamAudio` keys its bookmark cache on `websiteId`; an RSS article
        // has none, and 'none' is the sentinel that path already understands.
        websiteId: 'none',
        url: item.get('link') || null,
        targetType: 'rssItem',
        rssItemId: item.id,
        voice: body?.voice,
        accent: body?.accent,
    });

    return { success: true, endpoint, audioUrl: null, cached: false };
});
