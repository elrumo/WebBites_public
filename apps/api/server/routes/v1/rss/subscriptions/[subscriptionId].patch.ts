import { defineEventHandler, readBody, getRouterParam, createError, setResponseStatus } from 'h3';
import {
    initParseForRss,
    requireRssUserId,
    getSubscriptionOrThrow,
    isAutoExtractAllowed,
    usageErrorBody,
    recomputeExtractionWanted,
    serializeSubscription,
} from '#root/server/utils/rssUtils';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Update a subscription',
        description:
            'Renames a feed, reorders it in the sidebar, or turns automatic full-text extraction on. Enabling extraction is a paid feature: without the plan flag the route answers 403 with `errorType: "UsageError"`, the same shape the audio quota uses, so both clients route it into their existing upgrade flow.',
        parameters: [
            { name: 'subscriptionId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            customTitle: {
                                type: 'string',
                                nullable: true,
                                description: 'A user-facing name for the feed. Null or empty restores the publisher\'s title.',
                            },
                            extractionEnabled: {
                                type: 'boolean',
                                description: 'Fetch each new article\'s full text automatically. Requires a paid plan.',
                            },
                            sortOrder: { type: 'number' },
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'Subscription updated' },
            401: { description: 'Unauthorized' },
            403: { description: 'UsageError — automatic extraction requires an upgraded plan' },
            404: { description: 'Subscription not found' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const subscriptionId = getRouterParam(event, 'subscriptionId');
    if (!subscriptionId) throw createError({ statusCode: 400, statusMessage: 'subscriptionId is required' });

    const body = (await readBody(event)) || {};
    const subscription = await getSubscriptionOrThrow(userId, subscriptionId);

    if ('customTitle' in body) {
        const title = typeof body.customTitle === 'string' ? body.customTitle.trim() : '';
        subscription.set('customTitle', title || null);
    }

    if ('sortOrder' in body && Number.isFinite(Number(body.sortOrder))) {
        subscription.set('sortOrder', Number(body.sortOrder));
    }

    let extractionChanged = false;
    if ('extractionEnabled' in body) {
        const enabled = body.extractionEnabled === true;
        // Only the *transition to on* is gated. A user whose plan lapsed must
        // still be able to turn extraction off.
        if (enabled && subscription.get('extractionEnabled') !== true && !(await isAutoExtractAllowed(userId))) {
            setResponseStatus(event, 403);
            return usageErrorBody('Automatic full-text extraction requires an upgraded plan', 'rssAutoExtract');
        }
        extractionChanged = subscription.get('extractionEnabled') !== enabled;
        subscription.set('extractionEnabled', enabled);
    }

    if (subscription.dirty()) await subscription.save(null, { useMasterKey: true });

    // The feed's denormalised flag is what the poller reads, so it has to be
    // recomputed from the live subscriptions whenever this one's answer moved.
    if (extractionChanged) await recomputeExtractionWanted(subscription.get('feed'));

    return { success: true, subscription: serializeSubscription(subscription) };
});
