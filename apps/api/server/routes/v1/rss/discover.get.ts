import { defineEventHandler, getQuery } from 'h3';
import { initParseForRss, requireRssUserId } from '#root/server/utils/rssUtils';
import { discoverFeeds } from '#root/server/utils/rssService';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Find feeds to subscribe to',
        description:
            'Takes a URL or a name. A URL is resolved live — the address itself, its `<link rel="alternate">` tags, known site rules, then conventional feed paths — without subscribing to anything. A name is matched against the shared feed catalogue, which is every feed any WebBites user reads. Candidates already in the caller\'s sidebar are flagged rather than hidden.',
        parameters: [
            {
                name: 'query',
                in: 'query',
                required: true,
                description: 'A feed URL, a site URL, or a search term.',
                schema: { type: 'string', example: 'daring fireball' },
            },
        ],
        responses: {
            200: {
                description: 'Candidates returned. An empty list is a normal answer, not an error.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                candidates: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            feedUrl: { type: 'string' },
                                            title: { type: 'string' },
                                            siteUrl: { type: 'string', nullable: true },
                                            description: { type: 'string', nullable: true },
                                            iconUrl: { type: 'string', nullable: true },
                                            source: { type: 'string', enum: ['autodiscovery', 'direct', 'catalogue', 'guess'] },
                                            alreadySubscribed: { type: 'boolean' },
                                            subscriberCount: { type: 'number' },
                                        },
                                    },
                                },
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

    const query = getQuery(event);
    const term = String(query.query || query.q || '').trim();

    if (!term) return { success: true, candidates: [] };

    return { success: true, candidates: await discoverFeeds(term, userId) };
});
