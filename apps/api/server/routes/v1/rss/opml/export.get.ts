import { defineEventHandler, setHeader } from 'h3';
import { initParseForRss, requireRssUserId, getActiveSubscriptions } from '#root/server/utils/rssUtils';
import { buildOpml } from '#root/server/utils/rssParser';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Export subscriptions as OPML',
        description:
            'Returns an OPML 2.0 document of the caller\'s active subscriptions, as a download. Custom titles are exported in place of the publisher\'s, so a list re-imported here or into another reader keeps the names the user chose.',
        responses: {
            200: {
                description: 'OPML document',
                content: { 'text/x-opml': { schema: { type: 'string' } } },
            },
            401: { description: 'Unauthorized' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const subscriptions = await getActiveSubscriptions(userId);

    const opml = buildOpml(
        subscriptions.map((subscription) => {
            const feed = subscription.get('feed');
            return {
                title: subscription.get('customTitle') || feed?.get('title') || feed?.get('feedUrl'),
                xmlUrl: feed?.get('feedUrl'),
                htmlUrl: feed?.get('siteUrl') || null,
            };
        })
    );

    setHeader(event, 'Content-Type', 'text/x-opml; charset=utf-8');
    setHeader(event, 'Content-Disposition', 'attachment; filename="webbites-feeds.opml"');
    return opml;
});
