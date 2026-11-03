import { defineEventHandler, readBody, readRawBody, getHeader, createError } from 'h3';
import { initParseForRss, requireRssUserId, serializeSubscription } from '#root/server/utils/rssUtils';
import { importOpml, OPML_INLINE_LIMIT } from '#root/server/utils/rssService';

defineRouteMeta({
    openAPI: {
        tags: ['RSS'],
        summary: 'Import an OPML subscription list',
        description:
            `Accepts an OPML file as a raw body or as \`{ "opml": "…" }\`. The first ${OPML_INLINE_LIMIT} feeds are subscribed inline so the sidebar fills straight away; the rest are queued, because a large export from another reader means hundreds of live fetches. Feeds that cannot be resolved are reported individually rather than failing the import.`,
        requestBody: {
            required: true,
            content: {
                'text/x-opml': { schema: { type: 'string' } },
                'application/xml': { schema: { type: 'string' } },
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['opml'],
                        properties: { opml: { type: 'string', description: 'The OPML document.' } },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Import processed',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                subscribed: { type: 'array', items: { type: 'object' } },
                                queued: { type: 'number' },
                                failed: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: { xmlUrl: { type: 'string' }, reason: { type: 'string' } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            400: { description: 'The body is not parseable OPML' },
            401: { description: 'Unauthorized' },
        },
    },
});

export default defineEventHandler(async (event) => {
    initParseForRss();
    const userId = await requireRssUserId(event);

    const xml = await readOpmlBody(event);
    if (!xml) throw createError({ statusCode: 400, statusMessage: 'An OPML document is required' });

    let result;
    try {
        result = await importOpml(userId, xml);
    } catch (error: any) {
        throw createError({ statusCode: 400, statusMessage: error?.message || 'Could not parse the OPML document' });
    }

    return {
        success: true,
        subscribed: result.subscribed.map(serializeSubscription),
        queued: result.queued,
        failed: result.failed,
    };
});

/**
 * Readers export OPML as a file, so the native app posts the bytes directly
 * while the web app — where a file input hands over a string — posts JSON.
 * Both are accepted rather than forcing one client to re-wrap its payload.
 */
async function readOpmlBody(event: any): Promise<string | null> {
    const contentType = getHeader(event, 'content-type') || '';

    if (contentType.includes('application/json')) {
        const body = await readBody(event);
        const xml = typeof body === 'string' ? body : body?.opml;
        return typeof xml === 'string' && xml.trim() ? xml : null;
    }

    const raw = await readRawBody(event, 'utf8');
    return raw && raw.trim() ? raw : null;
}
