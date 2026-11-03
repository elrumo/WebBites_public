/**
 * The side-effecting half of the RSS reader: fetching feeds, discovering them,
 * subscribing, polling, and enriching items with full text, AI summaries and
 * audio.
 *
 * `rssParser` is pure and `rssUtils` only talks to Parse; everything that
 * reaches out to the network lives here, so the routes and the scheduled tasks
 * share one implementation of each operation rather than two that drift.
 */

import Parse from 'parse/node.js';
import { createError } from 'h3';
import { BROWSER_HEADERS } from './contentExtraction';
import { createFileName, sendToQstash, getPartitionedQueue } from './serverUtils';
import { getAiSummary } from '../routes/v1/content/getAiSummary.post';
import { getUnifiedPageContent } from '../routes/v1/content/getPageContent';
import {
    parseFeed,
    parseOpml,
    looksLikeFeedXml,
    discoverFeedLinksInHtml,
    discoverSiteFeedUrls,
    normalizeFeedUrl,
    feedUrlGuesses,
    RSS_CONTENT_TEXT_LIMIT,
    type ParsedFeed,
} from './rssParser';
import {
    RSS_FEEDS,
    RSS_ITEMS,
    findOrCreateFeed,
    findFeedByUrl,
    createOrReviveSubscription,
    adjustSubscriberCount,
    nextSortOrder,
    upsertItems,
    fanOutUnreadIncrement,
    scheduleNextFetch,
    recordFeedFailure,
    recordFeedSuccess,
    readableTextFor,
    MAX_EXTRACTIONS_PER_POLL,
} from './rssUtils';
import type { RssDiscoveryCandidate } from '../types/rss.types';
import { safeFetch } from './safeUrl';

const Feeds = Parse.Object.extend(RSS_FEEDS);
const Items = Parse.Object.extend(RSS_ITEMS);

/** Feeds are small; a slow one is a broken one. */
const FEED_FETCH_TIMEOUT_MS = 15_000;
/** A feed body past this is a mis-served page, not a feed. */
const MAX_FEED_BODY_BYTES = 8 * 1024 * 1024;

/** QStash message types, dispatched by `jobs/processJob.js`. */
export const RSS_POLL_MESSAGE = 'rss-feed-poll-requests';
export const RSS_EXTRACT_MESSAGE = 'rss-item-extract-requests';
export const RSS_SUBSCRIBE_MESSAGE = 'rss-subscribe-requests';

// ─── Fetching ────────────────────────────────────────────────────────────────

export type FeedFetchResult =
    | { status: 'ok'; body: string; etag: string | null; lastModified: string | null; finalUrl: string }
    | { status: 'not-modified' }
    | { status: 'error'; message: string };

/**
 * Fetches feed XML with a conditional GET.
 *
 * Native `fetch` rather than the shared `fetchUrlWithProgressiveTimeout`: this
 * path depends on seeing a bare 304 and on reading `etag` / `last-modified`
 * off the response, and the shared helper throws on non-2xx and hands back a
 * parsed body. Honouring the validators is not a micro-optimisation here —
 * polling a few thousand feeds every ten minutes without them is what gets a
 * user agent blocked.
 */
export async function fetchFeedDocument(
    feedUrl: string,
    validators: { etag?: string | null; lastModified?: string | null } = {}
): Promise<FeedFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

    try {
        const headers: Record<string, string> = {
            ...BROWSER_HEADERS,
            Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
        };
        if (validators.etag) headers['If-None-Match'] = validators.etag;
        if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;

        // safeFetch, not fetch: the feed URL is whatever the user subscribed to,
        // and it had no host check at all. Redirect hops are re-checked too.
        const response = await safeFetch(feedUrl, { headers, signal: controller.signal });

        if (response.status === 304) return { status: 'not-modified' };
        if (!response.ok) return { status: 'error', message: `HTTP ${response.status}` };

        const length = Number(response.headers.get('content-length') || 0);
        if (length > MAX_FEED_BODY_BYTES) {
            return { status: 'error', message: `Feed body too large (${length} bytes)` };
        }

        const body = await response.text();
        if (body.length > MAX_FEED_BODY_BYTES) {
            return { status: 'error', message: 'Feed body too large' };
        }

        return {
            status: 'ok',
            body,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
            finalUrl: response.url || feedUrl,
        };
    } catch (error: any) {
        const message = error?.name === 'AbortError' ? `Timed out after ${FEED_FETCH_TIMEOUT_MS}ms` : String(error?.message || error);
        return { status: 'error', message };
    } finally {
        clearTimeout(timeout);
    }
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export interface ResolvedFeed {
    feedUrl: string;
    parsed: ParsedFeed;
}

/**
 * Turns whatever the user pasted into a real feed.
 *
 * People paste the site, not the feed — `example.com`, not
 * `example.com/feed.xml`. Resolve in this order, cheapest first:
 *   1. the URL is already a feed;
 *   2. it is an HTML page advertising one via `<link rel="alternate">`;
 *   3. a known site rule can derive a feed URL;
 *   4. neither, so try conventional paths.
 *
 * Throws a 400 with a message worth showing rather than returning null: every
 * caller of this would otherwise have to invent the same message.
 */
export async function resolveFeedFromUrl(rawUrl: string): Promise<ResolvedFeed> {
    const candidateUrl = withScheme(rawUrl);

    const direct = await fetchFeedDocument(candidateUrl);
    if (direct.status === 'ok') {
        if (looksLikeFeedXml(direct.body)) {
            return { feedUrl: normalizeFeedUrl(direct.finalUrl), parsed: parseFeed(direct.body, direct.finalUrl) };
        }

        for (const link of discoverFeedLinksInHtml(direct.body, direct.finalUrl)) {
            const resolved = await tryFeedUrl(link.url);
            if (resolved) return resolved;
        }
    }

    for (const url of discoverSiteFeedUrls(candidateUrl)) {
        const resolved = await tryFeedUrl(url);
        if (resolved) return resolved;
    }

    for (const guess of feedUrlGuesses(direct.status === 'ok' ? direct.finalUrl : candidateUrl)) {
        const resolved = await tryFeedUrl(guess);
        if (resolved) return resolved;
    }

    throw createError({
        statusCode: 400,
        statusMessage:
            direct.status === 'error'
                ? `Could not reach ${candidateUrl}: ${direct.message}`
                : `No feed found at ${candidateUrl}`,
    });
}

async function tryFeedUrl(url: string): Promise<ResolvedFeed | null> {
    const response = await fetchFeedDocument(url);
    if (response.status !== 'ok' || !looksLikeFeedXml(response.body)) return null;
    try {
        return { feedUrl: normalizeFeedUrl(response.finalUrl), parsed: parseFeed(response.body, response.finalUrl) };
    } catch {
        return null;
    }
}

/** `example.com` is a URL to a person and a parse error to `new URL`. */
function withScheme(raw: string): string {
    const trimmed = String(raw || '').trim();
    if (!trimmed) throw createError({ statusCode: 400, statusMessage: 'url is required' });
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^feed:\/\//i.test(trimmed)) return trimmed.replace(/^feed:\/\//i, 'https://');
    return `https://${trimmed}`;
}

/** Anything with a dot and no spaces is worth trying as a URL. */
export function looksLikeUrl(query: string): boolean {
    const value = query.trim();
    if (!value || /\s/.test(value)) return false;
    return /^https?:\/\//i.test(value) || /^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(value);
}

/**
 * Feed search: a URL is resolved live, a name is looked up in the shared
 * catalogue.
 *
 * The catalogue is every feed any WebBites user has ever subscribed to. It is
 * organically grown rather than curated, so a search for an obscure blog will
 * come back empty — which is exactly why the URL path exists alongside it, and
 * why the client keeps a "subscribe to this address" affordance visible.
 */
export async function discoverFeeds(query: string, userId: string): Promise<RssDiscoveryCandidate[]> {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    const candidates: RssDiscoveryCandidate[] = [];

    if (looksLikeUrl(trimmed)) {
        try {
            const { feedUrl, parsed } = await resolveFeedFromUrl(trimmed);
            candidates.push({
                feedUrl,
                title: parsed.title,
                siteUrl: parsed.siteUrl,
                description: parsed.description,
                iconUrl: parsed.iconUrl,
                source: 'autodiscovery',
                alreadySubscribed: false,
            });
        } catch {
            // Not reachable as a feed — fall through to the catalogue search,
            // which still matches a domain typed as a name.
        }
    }

    const catalogue = await searchFeedCatalogue(trimmed);
    for (const feed of catalogue) {
        if (candidates.some((candidate) => candidate.feedUrl === feed.get('feedUrl'))) continue;
        candidates.push({
            feedUrl: feed.get('feedUrl'),
            title: feed.get('title') || feed.get('feedUrl'),
            siteUrl: feed.get('siteUrl') || null,
            description: feed.get('feedDescription') || null,
            iconUrl: feed.get('iconUrl') || null,
            source: 'catalogue',
            alreadySubscribed: false,
            subscriberCount: feed.get('subscriberCount') || 0,
        });
    }

    return await annotateSubscribed(candidates, userId);
}

async function searchFeedCatalogue(term: string): Promise<Parse.Object[]> {
    const byTitle = new Parse.Query(Feeds);
    byTitle.matches('title', escapeRegex(term), 'i');

    const bySite = new Parse.Query(Feeds);
    bySite.matches('siteUrl', escapeRegex(term), 'i');

    const byUrl = new Parse.Query(Feeds);
    byUrl.matches('feedUrl', escapeRegex(term), 'i');

    const query = Parse.Query.or(byTitle, bySite, byUrl);
    query.notEqualTo('status', 'dead');
    query.descending('subscriberCount');
    query.limit(20);
    return await query.find({ useMasterKey: true });
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Marks the candidates the user already reads, so the client can say so. */
async function annotateSubscribed(
    candidates: RssDiscoveryCandidate[],
    userId: string
): Promise<RssDiscoveryCandidate[]> {
    if (candidates.length === 0) return candidates;

    const feedQuery = new Parse.Query(Feeds);
    feedQuery.containedIn('feedUrl', candidates.map((candidate) => candidate.feedUrl));
    feedQuery.limit(candidates.length);
    const feeds = await feedQuery.find({ useMasterKey: true });
    if (feeds.length === 0) return candidates;

    const subscriptionQuery = new Parse.Query(Parse.Object.extend('rssSubscriptions'));
    subscriptionQuery.equalTo('user', Parse.User.createWithoutData(userId));
    subscriptionQuery.containedIn('feed', feeds);
    subscriptionQuery.notEqualTo('isDeleted', true);
    subscriptionQuery.limit(feeds.length);
    const subscribed = new Set(
        (await subscriptionQuery.find({ useMasterKey: true })).map((subscription) => subscription.get('feed')?.id)
    );

    const urlByFeedId = new Map(feeds.map((feed) => [feed.id, feed.get('feedUrl')]));
    const subscribedUrls = new Set([...subscribed].map((id) => urlByFeedId.get(id)).filter(Boolean));

    return candidates.map((candidate) => ({
        ...candidate,
        alreadySubscribed: subscribedUrls.has(candidate.feedUrl),
    }));
}

// ─── Subscribing ─────────────────────────────────────────────────────────────

export interface SubscribeResult {
    subscription: Parse.Object;
    feed: Parse.Object;
    /** False when the user was already subscribed — the route answers 200 either way. */
    created: boolean;
}

/**
 * Subscribes a user to whatever `url` resolves to.
 *
 * The first poll runs inline rather than being queued. A feed that shows up
 * empty for ten minutes after you add it reads as broken, and the fetch has
 * already happened during discovery — this is one parse and one batch of
 * writes on top of work already done.
 */
export async function subscribeToUrl(userId: string, url: string): Promise<SubscribeResult> {
    const { feedUrl, parsed } = await resolveFeedFromUrl(url);
    const feed = await findOrCreateFeed(feedUrl, parsed);

    const isFirstEverPoll = !feed.get('lastFetchedAt');
    if (isFirstEverPoll) {
        await ingestParsedFeed(feed, parsed, { fanOutUnread: false });
    }

    const sortOrder = await nextSortOrder(userId);
    const { subscription, activated } = await createOrReviveSubscription(userId, feed, sortOrder);

    if (activated) await adjustSubscriberCount(feed, 1);

    await subscription.fetchWithInclude(['feed'], { useMasterKey: true });
    return { subscription, feed, created: activated };
}

// ─── Polling ─────────────────────────────────────────────────────────────────

export interface PollFeedResult {
    feedId: string;
    feedUrl: string;
    status: 'ok' | 'not-modified' | 'error' | 'skipped';
    newItems: number;
    updatedItems: number;
    queuedExtractions: number;
    message?: string;
}

/**
 * Polls one feed and writes its items. Safe to call concurrently for different
 * feeds and idempotent for the same one — items are upserted by `dedupKey`.
 */
export async function pollFeed(feedId: string): Promise<PollFeedResult> {
    const feed = await new Parse.Query(Feeds).get(feedId, { useMasterKey: true }).catch(() => null);
    if (!feed) return { feedId, feedUrl: '', status: 'skipped', newItems: 0, updatedItems: 0, queuedExtractions: 0, message: 'Feed not found' };

    const feedUrl = feed.get('feedUrl');

    const response = await fetchFeedDocument(feedUrl, {
        etag: feed.get('etag'),
        lastModified: feed.get('lastModified'),
    });

    if (response.status === 'not-modified') {
        recordFeedSuccess(feed);
        scheduleNextFetch(feed, false);
        await feed.save(null, { useMasterKey: true });
        return { feedId, feedUrl, status: 'not-modified', newItems: 0, updatedItems: 0, queuedExtractions: 0 };
    }

    if (response.status === 'error') {
        recordFeedFailure(feed, response.message);
        await feed.save(null, { useMasterKey: true });
        return { feedId, feedUrl, status: 'error', newItems: 0, updatedItems: 0, queuedExtractions: 0, message: response.message };
    }

    let parsed: ParsedFeed;
    try {
        parsed = parseFeed(response.body, feedUrl);
    } catch (error: any) {
        recordFeedFailure(feed, error?.message || 'Parse failed');
        await feed.save(null, { useMasterKey: true });
        return { feedId, feedUrl, status: 'error', newItems: 0, updatedItems: 0, queuedExtractions: 0, message: error?.message };
    }

    feed.set('etag', response.etag);
    feed.set('lastModified', response.lastModified);

    const ingested = await ingestParsedFeed(feed, parsed, { fanOutUnread: true });

    return {
        feedId,
        feedUrl,
        status: 'ok',
        newItems: ingested.created,
        updatedItems: ingested.updated,
        queuedExtractions: ingested.queuedExtractions,
    };
}

/**
 * Writes a parsed feed's items and moves the feed's bookkeeping forward.
 *
 * Shared by the inline first poll during subscribe and by the scheduled poll.
 * The two differ in one respect only: the first poll must not fan out unread
 * increments, because the subscription does not exist yet and everything it
 * imports predates `subscribedAt` anyway.
 */
async function ingestParsedFeed(
    feed: Parse.Object,
    parsed: ParsedFeed,
    options: { fanOutUnread: boolean }
): Promise<{ created: number; updated: number; queuedExtractions: number }> {
    const { created, updated, newestPublishedAt } = await upsertItems(feed, parsed.items);

    let queuedExtractions = 0;
    if (created.length && feed.get('extractionWanted')) {
        queuedExtractions = await queueExtractions(created);
    }

    if (options.fanOutUnread && created.length) {
        await fanOutUnreadIncrement(feed, created);
    }

    applyFeedProgress(feed, parsed, newestPublishedAt, created.length > 0);
    await feed.save(null, { useMasterKey: true });

    return { created: created.length, updated, queuedExtractions };
}

function applyFeedProgress(
    feed: Parse.Object,
    parsed: ParsedFeed,
    newestPublishedAt: Date | null,
    foundNewItems: boolean
): void {
    if (parsed.title) feed.set('title', parsed.title);
    if (parsed.siteUrl) feed.set('siteUrl', parsed.siteUrl);
    if (parsed.description) feed.set('feedDescription', parsed.description);
    if (parsed.iconUrl && !feed.get('iconUrl')) feed.set('iconUrl', parsed.iconUrl);
    if (parsed.language) feed.set('language', parsed.language);
    feed.set('entitiesDecoded', true); // see applyItemFields in rssUtils

    const existingLastItem = feed.get('lastItemAt') as Date | undefined;
    if (newestPublishedAt && (!existingLastItem || newestPublishedAt > existingLastItem)) {
        feed.set('lastItemAt', newestPublishedAt);
    }

    recordFeedSuccess(feed);
    scheduleNextFetch(feed, foundNewItems);
}

/**
 * Hands new items to the extraction queue, newest first and capped.
 *
 * Newest first matters when the cap binds: on a feed's first poll with
 * extraction on, the twenty articles a reader is most likely to open are the
 * twenty most recent ones.
 */
async function queueExtractions(items: Parse.Object[]): Promise<number> {
    const ordered = [...items].sort((a, b) => {
        const left = (a.get('publishedAt') as Date)?.getTime() || 0;
        const right = (b.get('publishedAt') as Date)?.getTime() || 0;
        return right - left;
    });

    const selected = ordered.slice(0, MAX_EXTRACTIONS_PER_POLL).filter((item) => item.get('link'));
    if (selected.length === 0) return 0;

    if (ordered.length > selected.length) {
        console.log(`[rss] Extraction capped at ${MAX_EXTRACTIONS_PER_POLL}; ${ordered.length - selected.length} item(s) left on the feed body only`);
    }

    for (const item of selected) {
        item.set('extractionStatus', 'pending');
    }
    await Parse.Object.saveAll(selected, { useMasterKey: true });

    await sendToQstash(
        selected.map((item) => ({ type: RSS_EXTRACT_MESSAGE, data: { itemId: item.id } })),
        { isBatch: true, queueName: getPartitionedQueue('rssItemExtract') }
    );

    return selected.length;
}

// ─── Extraction & enrichment ─────────────────────────────────────────────────

export interface ExtractItemResult {
    itemId: string;
    status: 'done' | 'failed' | 'skipped';
    message?: string;
    summarised: boolean;
}

/**
 * Pulls an item's full text and, on success, summarises it.
 *
 * Both results are written to the shared `rssItems` row rather than to
 * anything per-user: a popular article is fetched from its publisher once and
 * summarised once, no matter how many subscribers open it.
 */
export async function extractItemContent(itemId: string): Promise<ExtractItemResult> {
    const item = await new Parse.Query(Items).get(itemId, { useMasterKey: true }).catch(() => null);
    if (!item) return { itemId, status: 'skipped', message: 'Item not found', summarised: false };

    const link = item.get('link');
    if (!link) {
        item.set('extractionStatus', 'failed');
        await item.save(null, { useMasterKey: true });
        return { itemId, status: 'skipped', message: 'Item has no link', summarised: false };
    }

    if (item.get('extractionStatus') === 'done' && item.get('extractedText')) {
        return { itemId, status: 'done', message: 'Already extracted', summarised: Boolean(item.get('aiSummary')) };
    }

    try {
        const result: any = await getUnifiedPageContent({ url: link, returnContent: true });

        if (result?.error || !result?.siteText) {
            item.set('extractionStatus', 'failed');
            await item.save(null, { useMasterKey: true });
            return { itemId, status: 'failed', message: result?.error || 'No readable content', summarised: false };
        }

        await storeExtraction(item, result.content || '', result.siteText);

        const summarised = await ensureSummary(item, null);
        return { itemId, status: 'done', summarised };
    } catch (error: any) {
        item.set('extractionStatus', 'failed');
        await item.save(null, { useMasterKey: true }).catch(() => { });
        return { itemId, status: 'failed', message: error?.message || 'Extraction threw', summarised: false };
    }
}

/**
 * Persists an extraction. The HTML goes to a Parse.File and the text to a
 * column — the same split `websites` uses for `siteBodyFile` / `siteBody`, so
 * both readers lazily fetch article markup through one familiar pattern.
 */
async function storeExtraction(item: Parse.Object, html: string, textContent: string): Promise<void> {
    if (html) {
        try {
            const fileName = createFileName(item.get('feed')?.id || 'rss', 'article', 'html', 'rssExtraction');
            const file = new Parse.File(fileName, { base64: Buffer.from(html).toString('base64') }, 'text/html');
            await file.save({ useMasterKey: true });
            item.set('extractedFile', file);
            item.set('extractedFileUrl', file.url());
        } catch (error) {
            // Losing the markup must not cost us the text: the reader falls
            // back to the feed body, but summaries and audio still work.
            console.error('[rss] Extracted article file save failed:', error);
        }
    }

    item.set('extractedText', String(textContent).slice(0, RSS_CONTENT_TEXT_LIMIT));
    item.set('extractionStatus', 'done');
    await item.save(null, { useMasterKey: true });
}

/**
 * Generates and caches an item's AI summary if it has none.
 *
 * `userId` is passed through purely for the existing usage accounting inside
 * `askGpt`; it is null on the automatic path, where nobody asked for this
 * particular summary.
 */
export async function ensureSummary(item: Parse.Object, userId: string | null): Promise<boolean> {
    if (item.get('aiSummary')) return true;

    const source = readableTextFor(item);
    if (!source || source.length < 200) return false;

    const summary: any = await getAiSummary({
        savedSite: null,
        fromCache: false,
        siteBody: source,
        userId: userId || undefined,
        shouldSave: false,
    });

    if (!summary || summary.error || !summary.tldr) return false;

    item.set('aiSummary', summary);
    await item.save(null, { useMasterKey: true });
    return true;
}

// ─── OPML ────────────────────────────────────────────────────────────────────

/** Above this, the rest of an import is handed to QStash rather than run inline. */
export const OPML_INLINE_LIMIT = 10;

export interface OpmlImportOutcome {
    subscribed: Parse.Object[];
    queued: number;
    failed: Array<{ xmlUrl: string; reason: string }>;
}

/**
 * Imports an OPML file.
 *
 * The first few feeds are subscribed inline so the user sees their list
 * populate immediately; the tail goes to QStash, because a 200-feed export
 * from another reader means 200 live fetches and no HTTP request should sit
 * open for that.
 */
export async function importOpml(userId: string, xml: string): Promise<OpmlImportOutcome> {
    const entries = parseOpml(xml);
    const subscribed: Parse.Object[] = [];
    const failed: Array<{ xmlUrl: string; reason: string }> = [];

    const inline = entries.slice(0, OPML_INLINE_LIMIT);
    const deferred = entries.slice(OPML_INLINE_LIMIT);

    for (const entry of inline) {
        try {
            const result = await subscribeToUrl(userId, entry.xmlUrl);
            subscribed.push(result.subscription);
        } catch (error: any) {
            failed.push({ xmlUrl: entry.xmlUrl, reason: error?.statusMessage || error?.message || 'Subscribe failed' });
        }
    }

    if (deferred.length) {
        await sendToQstash(
            deferred.map((entry) => ({ type: RSS_SUBSCRIBE_MESSAGE, data: { userId, url: entry.xmlUrl } })),
            { isBatch: true, queueName: getPartitionedQueue('rssSubscribe') }
        );
    }

    return { subscribed, queued: deferred.length, failed };
}

// ─── Retention ───────────────────────────────────────────────────────────────

/**
 * Trims a feed's item history to the retention bounds.
 *
 * Items are shared, so this is the only place they are deleted — a user
 * unsubscribing never removes an article another subscriber may still be
 * reading. Read marks pointing at purged items are harmless: the mark lookup
 * is keyed by item id and simply never matches again.
 */
export async function purgeFeedItems(
    feed: Parse.Object,
    keepCount: number,
    keepDays: number
): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);

    const keepQuery = new Parse.Query(Items);
    keepQuery.equalTo('feed', feed);
    keepQuery.descending('publishedAt');
    keepQuery.limit(1);
    keepQuery.skip(keepCount - 1);
    const [oldestKept] = await keepQuery.find({ useMasterKey: true });

    // Nothing beyond the count bound, so only the age bound can bite.
    const countBoundary = oldestKept ? (oldestKept.get('publishedAt') as Date) : null;
    const boundary = countBoundary && countBoundary > cutoff ? countBoundary : cutoff;

    let purged = 0;
    while (true) {
        const query = new Parse.Query(Items);
        query.equalTo('feed', feed);
        query.lessThan('publishedAt', boundary);
        query.limit(100);
        const rows = await query.find({ useMasterKey: true });
        if (rows.length === 0) break;
        await Parse.Object.destroyAll(rows, { useMasterKey: true });
        purged += rows.length;
        if (rows.length < 100) break;
    }

    return purged;
}
