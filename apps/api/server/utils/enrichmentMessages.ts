/**
 * The QStash messages that enrich a freshly saved website row.
 *
 * Pure: no I/O, so the shape can be unit-tested. The senders live in
 * `server/utils/jobs/processJob.js` (`enqueueEnrichment`, `enqueueAiStages`).
 *
 * Two hops:
 *   1. `immediate` — screenshots (slowest, independent of everything) and, unless
 *      the device already sent a page body, content extraction.
 *   2. `ai` — categorise / summarise / boards. These read `siteBody`, so the
 *      getPageContent worker enqueues them when extraction has finished (or
 *      given up), instead of after a guessed delay.
 */

export interface EnrichmentInput {
    url: string;
    userId: string;
    importing?: boolean;
    fromCache?: boolean;
    deviceEnrichment?: { siteBody?: unknown; aiSummary?: unknown } | null;
}

/** What one hop needs to know to enqueue the next. Travels inside message `data`. */
export interface EnrichmentContext {
    savedSiteId: string;
    url: string;
    userId: string;
    importing: boolean;
    fromCache: boolean;
    hasDeviceSummary: boolean;
}

export interface QstashMessage {
    body: { type: 'page-content-requests'; subType: string; data: Record<string, unknown> };
}

const TYPE = 'page-content-requests' as const;

export function enrichmentContext(savedSiteId: string, input: EnrichmentInput): EnrichmentContext {
    const importing = Boolean(input.importing);
    return {
        savedSiteId,
        url: input.url,
        userId: input.userId,
        importing,
        // A regular save always reuses a cached screenshot / summary; the
        // client's fromCache flag only matters for an import.
        fromCache: importing ? (input.fromCache ?? true) : true,
        hasDeviceSummary: Boolean(input.deviceEnrichment?.aiSummary),
    };
}

export function queueBase(ctx: Pick<EnrichmentContext, 'importing'>, base: 'getPageContent' | 'getBookmarkContent'): string {
    return ctx.importing ? `${base}-import` : base;
}

/** First hop. `pageContent` is null when the device already sent the page body. */
export function immediateMessages(ctx: EnrichmentContext, hasDeviceBody: boolean): { screenshots: QstashMessage; pageContent: QstashMessage | null } {
    return {
        screenshots: { body: { type: TYPE, subType: 'getScreenshots', data: { ...ctx } } },
        pageContent: hasDeviceBody ? null : { body: { type: TYPE, subType: 'getPageContent', data: { ...ctx, preferRendered: false } } },
    };
}

/** Second hop, sent by whoever finished getPageContent (or straight away when it was skipped). */
export function aiMessages(ctx: EnrichmentContext): QstashMessage[] {
    const { savedSiteId, url, userId, importing, fromCache, hasDeviceSummary } = ctx;
    const websiteData = { url, userId, savedSiteId, fromCache, importing };
    return [
        { body: { type: TYPE, subType: 'categoriseSite', data: { savedSiteId, websiteData } } },
        ...(hasDeviceSummary ? [] : [{ body: { type: TYPE, subType: 'getAiSummary', data: { websiteData } } }]),
    ];
}

/**
 * Third hop, sent once categoriseSite is done so `tag` conditions and AI
 * topic matching see the AI tags. Smart boards run here too.
 */
export function automationMessage(savedSiteId: string, userId: string): QstashMessage {
    return { body: { type: TYPE, subType: 'runAutomations', data: { savedSiteId, userId } } };
}

/** True when a `getPageContent` message carries enough context to enqueue the AI hop. */
export function isEnrichmentContext(data: unknown): data is EnrichmentContext {
    const d = data as Record<string, unknown> | null;
    return Boolean(d && typeof d.savedSiteId === 'string' && typeof d.userId === 'string' && typeof d.url === 'string' && 'hasDeviceSummary' in d);
}
