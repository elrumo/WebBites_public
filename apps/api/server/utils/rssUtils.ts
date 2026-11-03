/**
 * Shared plumbing for the RSS reader.
 *
 * Four Parse classes back the feature and the split between them is the whole
 * design:
 *
 *   rssFeeds         shared, one row per canonical feed URL. Polled once no
 *                    matter how many people subscribe.
 *   rssItems         shared, one row per article. Extraction, AI summary and
 *                    TTS are stored here, so they are computed once and
 *                    amortised across every subscriber.
 *   rssSubscriptions per user. Owns the read cutoffs, the unread counter and
 *                    the per-feed extraction preference.
 *   rssReadMarks     per user, per item. Only for items read *after* the last
 *                    mark-all-read, which is what keeps this table bounded.
 *   rssReadLater     per user, per item. The "Read later" shelf: same row
 *                    shape as a read mark, but nothing ever purges it in
 *                    bulk — the whole point is that it survives
 *                    mark-all-read.
 *
 * Read state is a hybrid of marks and cutoffs — see `isItemRead`. Computing it
 * server-side in `listItems` is what lets both clients stay trivial: they get
 * an `isRead` boolean per row and never reason about cutoffs at all.
 */

import Parse from 'parse/node.js';
import crypto from 'crypto';
import { createError, type H3Event } from 'h3';
import { validateApiKeyFromEvent } from './api-keys';
import { makeOwnerAcl } from './boardUtils';
import { getRedisClient, ensureRedisConnected } from './redis';
import { normalizeFeedUrl, RSS_CONTENT_TEXT_LIMIT, type ParsedFeed, type ParsedFeedItem } from './rssParser';
import { getUserWithPlan, hasPlanFeature } from './plans';
import type {
    RssFeedResponse,
    RssSubscriptionResponse,
    RssItemListResponse,
    RssItemDetailResponse,
    RssExtractionStatus,
} from '../types/rss.types';

export const RSS_FEEDS = 'rssFeeds';
export const RSS_ITEMS = 'rssItems';
export const RSS_SUBSCRIPTIONS = 'rssSubscriptions';
export const RSS_READ_MARKS = 'rssReadMarks';
export const RSS_READ_LATER = 'rssReadLater';

const Feeds = Parse.Object.extend(RSS_FEEDS);
const Items = Parse.Object.extend(RSS_ITEMS);
const Subscriptions = Parse.Object.extend(RSS_SUBSCRIPTIONS);
const ReadMarks = Parse.Object.extend(RSS_READ_MARKS);
const ReadLater = Parse.Object.extend(RSS_READ_LATER);

/** Poll cadence bounds. Below 15m we are rude; above a day we look broken. */
export const MIN_FETCH_INTERVAL_MINUTES = 15;
export const MAX_FETCH_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_FETCH_INTERVAL_MINUTES = 60;

/** A feed this many consecutive failures deep stops being scheduled. */
export const MAX_FEED_FAILURES = 12;

/** Retention: whichever bound a feed hits first. */
export const ITEM_RETENTION_COUNT = 300;
export const ITEM_RETENTION_DAYS = 120;

/**
 * How many items one poll may hand to the extraction queue for a single feed.
 *
 * The cap exists for the first poll of a feed, which imports up to a whole
 * page of back catalogue at once. Without it, subscribing to twenty feeds with
 * extraction on would fire several hundred Siterelic fetches and OpenAI
 * summaries inside a minute. Later polls rarely see more than a handful of new
 * items, so the cap never binds in steady state.
 */
export const MAX_EXTRACTIONS_PER_POLL = 20;

let parseInitialized = false;

export function initParseForRss() {
    if (parseInitialized) return;
    Parse.initialize(
        process.env.VITE_PARSE_ID as string,
        process.env.VITE_PARSE_JS_KEY as string,
        process.env.VITE_PARSE_MASTER_KEY as string
    );
    Parse.serverURL = process.env.VITE_PARSE_URL as string;
    parseInitialized = true;
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Every `/v1/rss` route authenticates the same way the audio and content
 * routes do: a bearer API key. That covers the native app's `BackendBClient`
 * and the web app's cookie proxy without either needing a new credential.
 */
export async function requireRssUserId(event: H3Event): Promise<string> {
    const userId = await validateApiKeyFromEvent(event);
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    return userId;
}

export function userPointer(userId: string): Parse.Object {
    return Parse.User.createWithoutData(userId) as Parse.Object;
}

export function feedPointer(feedId: string) {
    return { __type: 'Pointer', className: RSS_FEEDS, objectId: feedId } as any;
}

export function itemPointer(itemId: string) {
    return { __type: 'Pointer', className: RSS_ITEMS, objectId: itemId } as any;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/**
 * Per-feed item identity. Hashing keeps the key a fixed length regardless of
 * how long a publisher's guids are, and scoping it by feed means two feeds
 * syndicating the same article stay two items — which is what a per-feed
 * unread count needs.
 */
export function buildDedupKey(feedId: string, guidOrLink: string): string {
    const digest = crypto.createHash('sha256').update(guidOrLink).digest('hex');
    return `${feedId}:${digest}`;
}

export function buildSubscriptionKey(userId: string, feedId: string): string {
    return `${userId}:${feedId}`;
}

/**
 * Read marks are keyed rather than queried-then-created so that two devices
 * marking the same article read at the same moment converge on one row
 * instead of racing to create two.
 */
export function buildMarkKey(userId: string, itemId: string): string {
    return `${userId}:${itemId}`;
}

// ─── Plan gate ───────────────────────────────────────────────────────────────

/**
 * Per-feed full-text extraction is a paid feature.
 *
 * The entitlement itself lives in `utils/plans.ts`. This used to read a
 * `rssAutoExtractEnabled` column straight off the plan row — a column that was
 * never added to the `plans` schema, so the gate refused paying users too.
 */
export async function isAutoExtractAllowed(userId: string): Promise<boolean> {
    const { plan } = await getUserWithPlan(userId);
    return hasPlanFeature(plan, 'rssAutoExtract');
}

/**
 * The exact body `streamAudio` returns when the audio quota is spent.
 *
 * `errorType` has to sit at the *top level*, not inside h3's `data` envelope:
 * both clients test `json.errorType === 'UsageError'` to decide whether to show
 * an upgrade prompt instead of a generic failure, and `createError` would bury
 * it a level down where neither looks. Routes pair this with
 * `setResponseStatus(event, 403)`.
 */
export function usageErrorBody(message: string, quotaKind: 'audio' | 'rssAutoExtract' | 'backups') {
    // `quotaKind` is additive: `streamAudio` omits it and clients fall back to
    // the audio quota, which is what it has always meant. It exists so the RSS
    // extraction gate can say what the user actually ran into rather than
    // borrowing the audio wording.
    return { success: false, message, error: message, errorType: 'UsageError', quotaKind };
}

// ─── Feeds ───────────────────────────────────────────────────────────────────

export async function findFeedByUrl(feedUrl: string): Promise<Parse.Object | null> {
    const query = new Parse.Query(Feeds);
    query.equalTo('feedUrl', feedUrl);
    return (await query.first({ useMasterKey: true })) || null;
}

/**
 * Find-or-create the shared row for a feed URL.
 *
 * Two users subscribing simultaneously can both miss the lookup and both
 * insert. The unique index on `feedUrl` turns the loser's save into an error,
 * so the duplicate-key case re-reads instead of propagating — the row the
 * winner created is the right answer either way.
 */
export async function findOrCreateFeed(feedUrl: string, meta: ParsedFeed | null): Promise<Parse.Object> {
    const normalized = normalizeFeedUrl(feedUrl);

    const existing = await findFeedByUrl(normalized);
    if (existing) {
        if (meta) applyFeedMetadata(existing, meta);
        if (existing.dirty()) await existing.save(null, { useMasterKey: true });
        return existing;
    }

    const feed = new Feeds();
    feed.set('feedUrl', normalized);
    feed.set('subscriberCount', 0);
    feed.set('extractionWanted', false);
    feed.set('failureCount', 0);
    feed.set('status', 'active');
    feed.set('fetchIntervalMinutes', DEFAULT_FETCH_INTERVAL_MINUTES);
    feed.set('nextFetchAt', new Date());
    if (meta) applyFeedMetadata(feed, meta);

    // Shared catalogue: readable by everyone, writable only with the master key.
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);
    feed.setACL(acl);

    try {
        await feed.save(null, { useMasterKey: true });
        return feed;
    } catch (error: any) {
        const raced = await findFeedByUrl(normalized);
        if (raced) return raced;
        throw error;
    }
}

export function applyFeedMetadata(feed: Parse.Object, meta: ParsedFeed): void {
    if (meta.title) feed.set('title', meta.title);
    if (meta.siteUrl) feed.set('siteUrl', meta.siteUrl);
    if (meta.description) feed.set('feedDescription', meta.description);
    if (meta.iconUrl) feed.set('iconUrl', meta.iconUrl);
    if (meta.language) feed.set('language', meta.language);
    feed.set('entitiesDecoded', true); // see applyItemFields
}

/**
 * Adjusts the denormalised subscriber count. `increment` rather than a read
 * and a write, because subscribes to a popular feed genuinely do collide.
 */
export async function adjustSubscriberCount(feed: Parse.Object, delta: number): Promise<void> {
    feed.increment('subscriberCount', delta);
    await feed.save(null, { useMasterKey: true });
}

/**
 * Recomputes `rssFeeds.extractionWanted` from the live subscriptions.
 *
 * The flag is denormalised onto the feed so the poller can decide whether to
 * queue extraction without querying subscriptions per feed. It is recomputed
 * from scratch — rather than toggled — because a decrement path that drifts
 * would silently either stop extracting for a paying user or keep spending on
 * a feed nobody wants extracted.
 */
export async function recomputeExtractionWanted(feed: Parse.Object): Promise<boolean> {
    const query = new Parse.Query(Subscriptions);
    query.equalTo('feed', feed);
    query.equalTo('extractionEnabled', true);
    query.notEqualTo('isDeleted', true);
    const wanted = (await query.count({ useMasterKey: true })) > 0;

    if (feed.get('extractionWanted') !== wanted) {
        feed.set('extractionWanted', wanted);
        await feed.save(null, { useMasterKey: true });
    }
    return wanted;
}

/**
 * Adaptive polling. A feed that published on the last poll earns a faster
 * cadence; a quiet one slides towards daily. Every branch is clamped, so a
 * long-dead feed cannot escape the 24h ceiling and a firehose cannot drop
 * below 15 minutes.
 */
export function nextInterval(currentMinutes: number | undefined, foundNewItems: boolean): number {
    const current = currentMinutes || DEFAULT_FETCH_INTERVAL_MINUTES;
    const next = foundNewItems ? Math.round(current / 2) : Math.round(current * 1.5);
    return Math.min(MAX_FETCH_INTERVAL_MINUTES, Math.max(MIN_FETCH_INTERVAL_MINUTES, next));
}

export function scheduleNextFetch(feed: Parse.Object, foundNewItems: boolean): void {
    const interval = nextInterval(feed.get('fetchIntervalMinutes'), foundNewItems);
    feed.set('fetchIntervalMinutes', interval);
    feed.set('nextFetchAt', new Date(Date.now() + interval * 60_000));
}

/**
 * Records a failed poll. Backoff is exponential in the failure count so a site
 * that is down for a day is not hammered every ten minutes, and a feed that
 * never comes back eventually stops being scheduled at all.
 */
export function recordFeedFailure(feed: Parse.Object, message: string): void {
    const failures = (feed.get('failureCount') || 0) + 1;
    feed.set('failureCount', failures);
    feed.set('lastError', String(message).slice(0, 500));

    if (failures >= MAX_FEED_FAILURES) {
        feed.set('status', 'dead');
    }

    const backoff = Math.min(MAX_FETCH_INTERVAL_MINUTES, MIN_FETCH_INTERVAL_MINUTES * 2 ** Math.min(failures, 7));
    feed.set('nextFetchAt', new Date(Date.now() + backoff * 60_000));
}

export function recordFeedSuccess(feed: Parse.Object): void {
    feed.set('failureCount', 0);
    feed.set('lastError', null);
    feed.set('status', 'active');
    feed.set('lastFetchedAt', new Date());
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export async function getActiveSubscriptions(userId: string): Promise<Parse.Object[]> {
    const query = new Parse.Query(Subscriptions);
    query.equalTo('user', userPointer(userId));
    query.notEqualTo('isDeleted', true);
    query.include('feed');
    query.ascending('sortOrder').addAscending('createdAt');
    query.limit(1000);
    return await query.find({ useMasterKey: true });
}

export async function getSubscriptionOrThrow(userId: string, subscriptionId: string): Promise<Parse.Object> {
    const query = new Parse.Query(Subscriptions);
    query.equalTo('user', userPointer(userId));
    query.notEqualTo('isDeleted', true);
    query.include('feed');
    try {
        return await query.get(subscriptionId, { useMasterKey: true });
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'Subscription not found' });
    }
}

/**
 * Creates a subscription, or revives the soft-deleted one that is already
 * holding the unique `subscriptionKey`. Resubscribing after unsubscribing is
 * common enough — and the boards feature already establishes the pattern —
 * that it has to be a reactivation rather than a duplicate-key error.
 *
 * Returns the subscription and whether it is newly active, so the caller knows
 * whether to bump `subscriberCount`.
 */
export async function createOrReviveSubscription(
    userId: string,
    feed: Parse.Object,
    sortOrder: number
): Promise<{ subscription: Parse.Object; activated: boolean }> {
    const subscriptionKey = buildSubscriptionKey(userId, feed.id);

    const existingQuery = new Parse.Query(Subscriptions);
    existingQuery.equalTo('subscriptionKey', subscriptionKey);
    const existing = await existingQuery.first({ useMasterKey: true });

    if (existing) {
        const wasDeleted = existing.get('isDeleted') === true;
        if (wasDeleted) {
            existing.set('isDeleted', false);
            existing.set('deletedAt', null);
            // A revived subscription starts clean: everything published while
            // the user was away is treated as already seen, matching what
            // `subscribedAt` does for a brand-new subscription.
            existing.set('subscribedAt', new Date());
            existing.set('unreadCount', 0);
            await existing.save(null, { useMasterKey: true });
        }
        return { subscription: existing, activated: wasDeleted };
    }

    const subscription = new Subscriptions();
    subscription.set('user', userPointer(userId));
    subscription.set('feed', feed);
    subscription.set('subscriptionKey', subscriptionKey);
    subscription.set('extractionEnabled', false);
    subscription.set('sortOrder', sortOrder);
    subscription.set('unreadCount', 0);
    subscription.set('subscribedAt', new Date());
    subscription.set('isDeleted', false);
    subscription.setACL(makeOwnerAcl(userId));

    try {
        await subscription.save(null, { useMasterKey: true });
        return { subscription, activated: true };
    } catch (error: any) {
        const raced = await existingQuery.first({ useMasterKey: true });
        if (raced) return { subscription: raced, activated: false };
        throw error;
    }
}

export async function nextSortOrder(userId: string): Promise<number> {
    const query = new Parse.Query(Subscriptions);
    query.equalTo('user', userPointer(userId));
    query.notEqualTo('isDeleted', true);
    query.descending('sortOrder');
    query.limit(1);
    const [last] = await query.find({ useMasterKey: true });
    return last ? (last.get('sortOrder') || 0) + 1 : 0;
}

// ─── Read state ──────────────────────────────────────────────────────────────

/**
 * The read predicate, in one place.
 *
 * An item counts as read when any of three things is true:
 *   1. the user has an explicit mark for it;
 *   2. it was published at or before the last mark-all-read on that
 *      subscription — which is what makes mark-all-read O(1) instead of one
 *      write per item;
 *   3. it was published before the user subscribed — nobody wants a thousand
 *      unread articles the moment they add a feed.
 */
export function isItemRead(
    publishedAt: Date | null,
    subscription: Parse.Object,
    markedItemIds: Set<string>,
    itemId: string
): boolean {
    if (markedItemIds.has(itemId)) return true;
    if (!publishedAt) return false;

    const cutoff = readCutoffFor(subscription);
    return cutoff ? publishedAt.getTime() <= cutoff.getTime() : false;
}

/**
 * The instant before which everything on a subscription is implicitly read.
 * The later of "when you subscribed" and "when you last marked all read".
 */
export function readCutoffFor(subscription: Parse.Object): Date | null {
    const markAll = subscription.get('lastMarkAllReadAt') as Date | undefined;
    const subscribed = subscription.get('subscribedAt') as Date | undefined;
    if (markAll && subscribed) return markAll > subscribed ? markAll : subscribed;
    return markAll || subscribed || null;
}

/**
 * Loads the user's read marks for a specific set of items. Scoped by item id
 * rather than fetched wholesale: the marks table is bounded but a heavy user
 * can still accumulate thousands between mark-all-reads.
 */
export async function fetchReadMarks(userId: string, itemIds: string[]): Promise<Set<string>> {
    return fetchMarkedItemIds(ReadMarks, userId, itemIds);
}

/**
 * The same lookup against the read-later shelf. Both tables are keyed by the
 * identical `userId:itemId` string, so one helper answers both.
 */
export async function fetchReadLaterMarks(userId: string, itemIds: string[]): Promise<Set<string>> {
    return fetchMarkedItemIds(ReadLater, userId, itemIds);
}

async function fetchMarkedItemIds(
    markClass: new () => Parse.Object,
    userId: string,
    itemIds: string[]
): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();

    const marked = new Set<string>();
    const CHUNK = 100;

    for (let i = 0; i < itemIds.length; i += CHUNK) {
        const chunk = itemIds.slice(i, i + CHUNK);
        const query = new Parse.Query(markClass);
        query.containedIn('markKey', chunk.map((id) => buildMarkKey(userId, id)));
        query.select('markKey');
        query.limit(CHUNK);
        const rows = await query.find({ useMasterKey: true });
        for (const row of rows) {
            const key = row.get('markKey') as string;
            marked.add(key.slice(userId.length + 1));
        }
    }

    return marked;
}

// ─── Item listing ────────────────────────────────────────────────────────────

/** Hard ceiling on rows per request, whatever the client asks for. */
export const MAX_ITEMS_PER_PAGE = 100;

/**
 * How many candidate pages `listItems` will scan while filtering for unread.
 *
 * Unread is a computed predicate, not a column, so an unread-only page is
 * "scan newest items, keep the ones that pass". Nearly always the first scan
 * fills the page. The bound exists for the pathological case — a user who has
 * read everything in a very busy feed — where it stops one request from
 * walking a whole feed's history. When the bound is hit the response still
 * carries a cursor pointing at the last row *scanned*, so the client simply
 * asks again and makes forward progress.
 */
const MAX_CANDIDATE_SCANS = 5;

export interface ListItemsOptions {
    userId: string;
    /** A single subscription, or every active one when omitted. */
    subscription?: Parse.Object | null;
    unreadOnly: boolean;
    limit: number;
    cursor?: string | null;
}

export interface ListItemsResult {
    items: RssItemListResponse[];
    nextCursor: string | null;
}

export async function listItems(options: ListItemsOptions): Promise<ListItemsResult> {
    const { userId, unreadOnly, cursor } = options;
    const limit = Math.min(Math.max(options.limit || 50, 1), MAX_ITEMS_PER_PAGE);

    const subscriptions = options.subscription
        ? [options.subscription]
        : await getActiveSubscriptions(userId);

    if (subscriptions.length === 0) return { items: [], nextCursor: null };

    // Subscription lookup by feed id — every row needs its owner's cutoffs.
    const byFeedId = new Map<string, Parse.Object>();
    for (const subscription of subscriptions) {
        const feed = subscription.get('feed');
        if (feed?.id) byFeedId.set(feed.id, subscription);
    }
    const feedIds = [...byFeedId.keys()];
    if (feedIds.length === 0) return { items: [], nextCursor: null };

    /**
     * The least restrictive cutoff across the selected feeds. Rows older than
     * this are read for *every* feed in the set, so they can be excluded in
     * the database rather than filtered in memory.
     */
    const cutoffs = subscriptions.map(readCutoffFor).filter(Boolean) as Date[];
    const globalCutoff =
        unreadOnly && cutoffs.length === subscriptions.length && cutoffs.length > 0
            ? new Date(Math.min(...cutoffs.map((d) => d.getTime())))
            : null;

    const collected: RssItemListResponse[] = [];
    let scanCursor = cursor || null;
    let lastScanned: string | null = null;
    let exhausted = false;

    for (let scan = 0; scan < MAX_CANDIDATE_SCANS && collected.length < limit; scan++) {
        const query = buildItemQuery(feedIds, globalCutoff, scanCursor);
        query.limit(unreadOnly ? MAX_ITEMS_PER_PAGE : limit);
        const rows = await query.find({ useMasterKey: true });

        if (rows.length === 0) {
            exhausted = true;
            break;
        }

        const rowIds = rows.map((row) => row.id);
        const [marks, savedForLater] = await Promise.all([
            fetchReadMarks(userId, rowIds),
            fetchReadLaterMarks(userId, rowIds),
        ]);

        for (const row of rows) {
            lastScanned = encodeCursor(row);
            const subscription = byFeedId.get(row.get('feed')?.id);
            if (!subscription) continue;

            const read = isItemRead(row.get('publishedAt') || null, subscription, marks, row.id);
            if (unreadOnly && read) continue;

            collected.push(serializeItemList(row, subscription, read, savedForLater.has(row.id)));
            if (collected.length >= limit) break;
        }

        scanCursor = lastScanned;
        if (rows.length < (unreadOnly ? MAX_ITEMS_PER_PAGE : limit)) {
            exhausted = true;
            break;
        }
    }

    // The cursor tracks the last row *scanned*, not the last row returned:
    // when a scan filters rows out, the client must not re-examine them, and
    // when the scan bound is hit it must still be able to continue.
    return {
        items: collected,
        nextCursor: exhausted && collected.length < limit ? null : lastScanned,
    };
}

/**
 * The candidate query. Ordering is `publishedAt` descending with `objectId` as
 * the tie-break, because feeds routinely publish a batch of items sharing one
 * timestamp and a cursor on the timestamp alone would either skip or repeat
 * them.
 */
function buildItemQuery(feedIds: string[], since: Date | null, cursor: string | null): Parse.Query {
    const base = () => {
        const query = new Parse.Query(Items);
        query.containedIn('feed', feedIds.map(feedPointer));
        if (since) query.greaterThan('publishedAt', since);
        return query;
    };

    let query: Parse.Query;

    const decoded = cursor ? decodeCursor(cursor) : null;
    if (decoded) {
        const older = base();
        older.lessThan('publishedAt', decoded.at);

        const sameInstant = base();
        sameInstant.equalTo('publishedAt', decoded.at);
        sameInstant.lessThan('objectId', decoded.objectId);

        query = Parse.Query.or(older, sameInstant);
    } else {
        query = base();
    }

    query.include('feed');
    query.descending('publishedAt').addDescending('objectId');
    return query;
}

/**
 * `<sort field millis>:<objectId>`, base64url'd. The field differs by listing
 * — articles sort on `publishedAt`, the read-later shelf on `savedAt` — but
 * the tie-break and the encoding are the same, so one pair of helpers serves
 * both. Cursors are opaque to clients either way.
 */
function encodeCursor(row: Parse.Object, field = 'publishedAt'): string {
    const at = (row.get(field) as Date | undefined) || row.createdAt;
    return Buffer.from(`${at.getTime()}:${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; objectId: string } | null {
    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return null;
        const millis = Number(decoded.slice(0, separator));
        const objectId = decoded.slice(separator + 1);
        if (!Number.isFinite(millis) || !objectId) return null;
        return { at: new Date(millis), objectId };
    } catch {
        return null;
    }
}

// ─── Read later ──────────────────────────────────────────────────────────────

/**
 * Puts an article on — or takes it off — the user's read-later shelf.
 *
 * Deliberately a separate table from `rssReadMarks` rather than a flag on it,
 * even though the row shape is identical: mark-all-read *purges* read marks in
 * bulk, and a shelf that empties itself when you tidy your unread count is not
 * a shelf. Idempotent on both edges, so two devices toggling at once converge.
 */
export async function setReadLater(
    userId: string,
    item: Parse.Object,
    saved: boolean
): Promise<{ changed: boolean }> {
    const markKey = buildMarkKey(userId, item.id);

    const query = new Parse.Query(ReadLater);
    query.equalTo('markKey', markKey);
    const existing = await query.first({ useMasterKey: true });

    if (!saved) {
        if (!existing) return { changed: false };
        await existing.destroy({ useMasterKey: true });
        return { changed: true };
    }

    if (existing) return { changed: false };

    const row = new ReadLater();
    row.set('user', userPointer(userId));
    row.set('item', itemPointer(item.id));
    row.set('feed', item.get('feed'));
    row.set('markKey', markKey);
    row.set('savedAt', new Date());
    row.setACL(makeOwnerAcl(userId));

    try {
        await row.save(null, { useMasterKey: true });
    } catch {
        // Lost a race against another device writing the same row.
        return { changed: false };
    }

    return { changed: true };
}

/**
 * The shelf, most recently saved first.
 *
 * Ordered by when it was *shelved*, not when it was published: the shelf is a
 * queue the reader built, and a three-week-old post saved this morning belongs
 * at the top of it. That is why this cannot be a scope inside `listItems`,
 * which pages on `publishedAt`.
 *
 * Read state still comes from the subscription, so a shelved article that has
 * since been read shows as read rather than silently leaving the shelf.
 */
export async function listReadLater(options: {
    userId: string;
    limit: number;
    cursor?: string | null;
}): Promise<ListItemsResult> {
    const { userId } = options;
    const limit = Math.min(Math.max(options.limit || 50, 1), MAX_ITEMS_PER_PAGE);

    const base = () => {
        const query = new Parse.Query(ReadLater);
        query.equalTo('user', userPointer(userId));
        return query;
    };

    const decoded = options.cursor ? decodeCursor(options.cursor) : null;
    let query: Parse.Query;
    if (decoded) {
        const older = base();
        older.lessThan('savedAt', decoded.at);

        const sameInstant = base();
        sameInstant.equalTo('savedAt', decoded.at);
        sameInstant.lessThan('objectId', decoded.objectId);

        query = Parse.Query.or(older, sameInstant);
    } else {
        query = base();
    }

    query.include('item');
    query.include('item.feed');
    query.descending('savedAt').addDescending('objectId');
    query.limit(limit);

    const rows = await query.find({ useMasterKey: true });
    if (rows.length === 0) return { items: [], nextCursor: null };

    const subscriptions = await getActiveSubscriptions(userId);
    const byFeedId = new Map<string, Parse.Object>();
    for (const subscription of subscriptions) {
        const feed = subscription.get('feed');
        if (feed?.id) byFeedId.set(feed.id, subscription);
    }

    const items = rows.map((row) => row.get('item')).filter(Boolean) as Parse.Object[];
    // Two ways a shelf row stops being showable, both filtered here:
    //
    //   * retention deleted the article out from under it — an unfetched
    //     pointer with no `feed` is how that shows up;
    //   * the user unsubscribed from its feed, and `/v1/rss/items/:id`
    //     answers 403 without a subscription, so the row would open onto an
    //     error. Unsubscribing already drops a feed's articles from every
    //     other list; the shelf follows the same rule.
    //
    // ponytail: both are filters, not repairs — the orphaned rows stay in the
    // table. Sweep them in `maintenance` if the shelf ever grows enough for
    // the dead weight to cost a page.
    const live = items.filter((item) => byFeedId.has(item.get('feed')?.id));
    const marks = await fetchReadMarks(userId, live.map((item) => item.id));

    const collected: RssItemListResponse[] = [];
    for (const item of live) {
        const subscription = byFeedId.get(item.get('feed')?.id)!;
        const read = isItemRead(item.get('publishedAt') || null, subscription, marks, item.id);
        collected.push(serializeItemList(item, subscription, read, true));
    }

    return {
        items: collected,
        // Tracks the last row *scanned*, so a page thinned by deleted items
        // still advances — the same contract `listItems` uses.
        nextCursor: rows.length < limit ? null : encodeCursor(rows[rows.length - 1], 'savedAt'),
    };
}

export async function getItemOrThrow(itemId: string): Promise<Parse.Object> {
    const query = new Parse.Query(Items);
    query.include('feed');
    try {
        return await query.get(itemId, { useMasterKey: true });
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'Article not found' });
    }
}

/**
 * Resolves the caller's subscription for an item's feed, or 403.
 *
 * `rssItems` is public-read by design — it is a shared catalogue — so item
 * routes cannot rely on ACLs to answer "may this user see this". Requiring an
 * active subscription is that check.
 */
export async function getSubscriptionForItem(userId: string, item: Parse.Object): Promise<Parse.Object> {
    const feed = item.get('feed');
    if (!feed?.id) throw createError({ statusCode: 404, statusMessage: 'Article not found' });

    const query = new Parse.Query(Subscriptions);
    query.equalTo('subscriptionKey', buildSubscriptionKey(userId, feed.id));
    query.notEqualTo('isDeleted', true);
    query.include('feed');
    const subscription = await query.first({ useMasterKey: true });

    if (!subscription) {
        throw createError({ statusCode: 403, statusMessage: 'Not subscribed to this feed' });
    }
    return subscription;
}

// ─── Marking read ────────────────────────────────────────────────────────────

/**
 * Marks one item read. Idempotent: the `markKey` lookup means a second call
 * from another device is a no-op rather than a second row and a second
 * decrement of the unread counter.
 */
export async function markItemRead(
    userId: string,
    item: Parse.Object,
    subscription: Parse.Object
): Promise<{ changed: boolean }> {
    const markKey = buildMarkKey(userId, item.id);

    const query = new Parse.Query(ReadMarks);
    query.equalTo('markKey', markKey);
    const existing = await query.first({ useMasterKey: true });
    if (existing) return { changed: false };

    // Already implicitly read via a cutoff — no row needed, no counter change.
    const publishedAt = item.get('publishedAt') as Date | undefined;
    const cutoff = readCutoffFor(subscription);
    if (publishedAt && cutoff && publishedAt.getTime() <= cutoff.getTime()) {
        return { changed: false };
    }

    const mark = new ReadMarks();
    mark.set('user', userPointer(userId));
    mark.set('item', itemPointer(item.id));
    mark.set('feed', item.get('feed'));
    mark.set('markKey', markKey);
    mark.set('readAt', new Date());
    mark.setACL(makeOwnerAcl(userId));

    try {
        await mark.save(null, { useMasterKey: true });
    } catch {
        // Lost a race against another device — the other write is the same
        // write, so there is nothing to repair and nothing to decrement.
        return { changed: false };
    }

    await adjustUnreadCount(subscription, -1);
    return { changed: true };
}

export async function markItemUnread(
    userId: string,
    item: Parse.Object,
    subscription: Parse.Object
): Promise<{ changed: boolean }> {
    const query = new Parse.Query(ReadMarks);
    query.equalTo('markKey', buildMarkKey(userId, item.id));
    const existing = await query.first({ useMasterKey: true });

    if (!existing) return { changed: false };

    await existing.destroy({ useMasterKey: true });
    await adjustUnreadCount(subscription, 1);
    return { changed: true };
}

/**
 * Mark-all-read is a cutoff move plus a counter reset — one write per
 * subscription regardless of how many articles it covers. The now-redundant
 * marks below the new cutoff are deleted so the table stays bounded, but that
 * cleanup does not affect correctness: the cutoff alone already answers.
 */
export async function markAllRead(userId: string, subscriptions: Parse.Object[]): Promise<number> {
    const now = new Date();

    for (const subscription of subscriptions) {
        subscription.set('lastMarkAllReadAt', now);
        subscription.set('unreadCount', 0);
    }
    if (subscriptions.length) await Parse.Object.saveAll(subscriptions, { useMasterKey: true });

    let purged = 0;
    for (const subscription of subscriptions) {
        purged += await purgeReadMarks(userId, subscription.get('feed'));
    }
    return purged;
}

async function purgeReadMarks(userId: string, feed: Parse.Object | undefined): Promise<number> {
    if (!feed?.id) return 0;

    let purged = 0;
    while (true) {
        const query = new Parse.Query(ReadMarks);
        query.equalTo('user', userPointer(userId));
        query.equalTo('feed', feedPointer(feed.id));
        query.limit(100);
        const rows = await query.find({ useMasterKey: true });
        if (rows.length === 0) break;
        await Parse.Object.destroyAll(rows, { useMasterKey: true });
        purged += rows.length;
        if (rows.length < 100) break;
    }
    return purged;
}

/**
 * Moves a materialised unread counter. Clamped at zero on read so a drifted
 * counter never renders as a negative badge; the nightly reconciliation is
 * what actually repairs the drift.
 */
export async function adjustUnreadCount(subscription: Parse.Object, delta: number): Promise<void> {
    subscription.increment('unreadCount', delta);
    await subscription.save(null, { useMasterKey: true });
}

/**
 * Recomputes one subscription's unread counter from first principles.
 *
 * Counters are incremented by the poller and decremented by reads across six
 * server instances and any number of devices; over months they drift. Rather
 * than making every read path more expensive to prevent drift, the nightly
 * maintenance task repairs it here.
 */
export async function reconcileUnreadCount(subscription: Parse.Object): Promise<number> {
    const feed = subscription.get('feed');
    if (!feed?.id) return 0;

    const cutoff = readCutoffFor(subscription);

    const query = new Parse.Query(Items);
    query.equalTo('feed', feedPointer(feed.id));
    if (cutoff) query.greaterThan('publishedAt', cutoff);
    query.select('objectId');
    query.limit(1000);
    const candidates = await query.find({ useMasterKey: true });

    const marks = await fetchReadMarks(subscription.get('user')?.id, candidates.map((row) => row.id));
    const unread = candidates.filter((row) => !marks.has(row.id)).length;

    if (subscription.get('unreadCount') !== unread) {
        subscription.set('unreadCount', unread);
        await subscription.save(null, { useMasterKey: true });
    }
    return unread;
}

// ─── Item upsert ─────────────────────────────────────────────────────────────

export interface UpsertResult {
    created: Parse.Object[];
    updated: number;
    newestPublishedAt: Date | null;
}

/**
 * Writes a poll's parsed items into `rssItems`.
 *
 * Existing items are only refreshed when the feed actually changed the body —
 * a lot of publishers re-emit an unchanged item on every fetch, and blindly
 * saving would churn `updatedAt` on hundreds of shared rows per poll. New
 * items are returned so the caller can queue extraction for exactly those.
 */
export async function upsertItems(feed: Parse.Object, parsed: ParsedFeedItem[]): Promise<UpsertResult> {
    if (parsed.length === 0) return { created: [], updated: 0, newestPublishedAt: null };

    const keyed = new Map<string, ParsedFeedItem>();
    for (const item of parsed) {
        keyed.set(buildDedupKey(feed.id, item.guid || item.link || item.title), item);
    }

    const existingByKey = new Map<string, Parse.Object>();
    const keys = [...keyed.keys()];
    for (let i = 0; i < keys.length; i += 100) {
        const query = new Parse.Query(Items);
        query.containedIn('dedupKey', keys.slice(i, i + 100));
        query.limit(100);
        for (const row of await query.find({ useMasterKey: true })) {
            existingByKey.set(row.get('dedupKey'), row);
        }
    }

    const sharedAcl = new Parse.ACL();
    sharedAcl.setPublicReadAccess(true);
    sharedAcl.setPublicWriteAccess(false);

    const toSave: Parse.Object[] = [];
    const created: Parse.Object[] = [];
    let updated = 0;
    let newest: Date | null = null;

    for (const [dedupKey, parsedItem] of keyed) {
        // An item with no usable date is dated "now" rather than left null:
        // both clients sort on `publishedAt`, and a null would bury a brand
        // new article at the bottom of every list forever.
        const publishedAt = parsedItem.publishedAt || new Date();
        if (!newest || publishedAt > newest) newest = publishedAt;

        const existing = existingByKey.get(dedupKey);
        if (existing) {
            if (existing.get('rssContentHtml') !== parsedItem.contentHtml || existing.get('title') !== parsedItem.title) {
                applyItemFields(existing, parsedItem, publishedAt);
                toSave.push(existing);
                updated++;
            }
            continue;
        }

        const item = new Items();
        item.set('feed', feed);
        item.set('dedupKey', dedupKey);
        item.set('guid', parsedItem.guid);
        item.set('extractionStatus', 'none' as RssExtractionStatus);
        item.setACL(sharedAcl);
        applyItemFields(item, parsedItem, publishedAt);
        toSave.push(item);
        created.push(item);
    }

    if (toSave.length) {
        try {
            await Parse.Object.saveAll(toSave, { useMasterKey: true });
        } catch (error: any) {
            // A duplicate `dedupKey` means another instance polled the same
            // feed in the same window. Saving one at a time lets the rows that
            // are genuinely new through instead of losing the whole batch.
            return await saveIndividually(toSave, created, updated, newest);
        }
    }

    return { created, updated, newestPublishedAt: newest };
}

async function saveIndividually(
    toSave: Parse.Object[],
    created: Parse.Object[],
    updated: number,
    newest: Date | null
): Promise<UpsertResult> {
    const saved: Parse.Object[] = [];
    for (const object of toSave) {
        try {
            await object.save(null, { useMasterKey: true });
            if (created.includes(object)) saved.push(object);
        } catch {
            // Already written by another instance — nothing to do.
        }
    }
    return { created: saved, updated, newestPublishedAt: newest };
}

function applyItemFields(item: Parse.Object, parsed: ParsedFeedItem, publishedAt: Date): void {
    item.set('title', parsed.title);
    item.set('link', parsed.link);
    item.set('author', parsed.author);
    item.set('publishedAt', publishedAt);
    item.set('rssContentHtml', parsed.contentHtml);
    item.set('rssContentText', parsed.contentText.slice(0, RSS_CONTENT_TEXT_LIMIT));
    item.set('imageUrl', parsed.imageUrl);
    // Text above came through `plain()`/`htmlToText`; the one-off backfill
    // skips marked rows so it can never decode them a second time.
    item.set('entitiesDecoded', true);
}

/**
 * Bumps the unread counter on every active subscription to a feed after new
 * items land. Runs once per poll rather than once per subscriber-item pair.
 */
export async function fanOutUnreadIncrement(feed: Parse.Object, newItems: Parse.Object[]): Promise<number> {
    if (newItems.length === 0) return 0;

    let touched = 0;
    let skip = 0;

    while (true) {
        const query = new Parse.Query(Subscriptions);
        query.equalTo('feed', feed);
        query.notEqualTo('isDeleted', true);
        query.limit(200);
        query.skip(skip);
        const subscriptions = await query.find({ useMasterKey: true });
        if (subscriptions.length === 0) break;

        for (const subscription of subscriptions) {
            // Only count what this subscriber could actually consider unread:
            // items older than their cutoff are read by definition.
            const cutoff = readCutoffFor(subscription);
            const countable = cutoff
                ? newItems.filter((item) => (item.get('publishedAt') as Date).getTime() > cutoff.getTime()).length
                : newItems.length;
            if (countable > 0) subscription.increment('unreadCount', countable);
        }

        const dirty = subscriptions.filter((subscription) => subscription.dirty());
        if (dirty.length) await Parse.Object.saveAll(dirty, { useMasterKey: true });
        touched += dirty.length;

        skip += subscriptions.length;
        if (subscriptions.length < 200) break;
    }

    return touched;
}

// ─── Serialization ───────────────────────────────────────────────────────────

export function serializeFeed(feed: Parse.Object): RssFeedResponse {
    return {
        id: feed.id,
        feedUrl: feed.get('feedUrl'),
        siteUrl: feed.get('siteUrl') || null,
        title: feed.get('title') || feed.get('feedUrl'),
        description: feed.get('feedDescription') || null,
        iconUrl: feed.get('iconUrl') || null,
        language: feed.get('language') || null,
        status: feed.get('status') || 'active',
        lastFetchedAt: toIso(feed.get('lastFetchedAt')),
        lastItemAt: toIso(feed.get('lastItemAt')),
    };
}

export function serializeSubscription(subscription: Parse.Object): RssSubscriptionResponse {
    const feed = subscription.get('feed');
    const feedResponse = serializeFeed(feed);

    return {
        id: subscription.id,
        feed: feedResponse,
        title: subscription.get('customTitle') || feedResponse.title,
        customTitle: subscription.get('customTitle') || null,
        extractionEnabled: subscription.get('extractionEnabled') === true,
        sortOrder: subscription.get('sortOrder') ?? 0,
        // Clamped: a drifted counter should read as zero, never as a negative
        // badge, until the nightly reconciliation repairs it.
        unreadCount: Math.max(0, subscription.get('unreadCount') || 0),
        subscribedAt: toIso(subscription.get('subscribedAt')),
        lastMarkAllReadAt: toIso(subscription.get('lastMarkAllReadAt')),
    };
}

export function serializeItemList(
    item: Parse.Object,
    subscription: Parse.Object,
    isRead: boolean,
    isReadLater = false
): RssItemListResponse {
    const feed = item.get('feed');
    const feedTitle = subscription.get('customTitle') || feed?.get?.('title') || '';

    return {
        id: item.id,
        feedId: feed?.id || '',
        feedTitle,
        feedIconUrl: feed?.get?.('iconUrl') || null,
        title: item.get('title') || 'Untitled',
        link: item.get('link') || null,
        author: item.get('author') || null,
        publishedAt: toIso(item.get('publishedAt')),
        imageUrl: item.get('imageUrl') || null,
        excerpt: buildExcerpt(item),
        isRead,
        isReadLater,
        hasExtracted: Boolean(item.get('extractedFileUrl')),
        hasSummary: Boolean(item.get('aiSummary')),
        hasAudio: Boolean(item.get('articleAudioUrl')),
    };
}

export function serializeItemDetail(
    item: Parse.Object,
    subscription: Parse.Object,
    isRead: boolean,
    isReadLater = false
): RssItemDetailResponse {
    return {
        ...serializeItemList(item, subscription, isRead, isReadLater),
        rssContentHtml: item.get('rssContentHtml') || '',
        rssContentText: item.get('rssContentText') || '',
        extractedFileUrl: item.get('extractedFileUrl') || null,
        extractedText: item.get('extractedText') || null,
        extractionStatus: (item.get('extractionStatus') || 'none') as RssExtractionStatus,
        aiSummary: item.get('aiSummary') || null,
        articleAudioUrl: item.get('articleAudioUrl') || item.get('articleAudio')?.url?.() || null,
    };
}

/** Two lines of text for the list row — never markup. */
function buildExcerpt(item: Parse.Object): string {
    const source = (item.get('rssContentText') || item.get('extractedText') || '') as string;
    return source.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function toIso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

/** The text an AI summary or a TTS read-through should work from. */
export function readableTextFor(item: Parse.Object): string {
    return (item.get('extractedText') || item.get('rssContentText') || '') as string;
}

// ─── Redis lock ──────────────────────────────────────────────────────────────

/**
 * Runs `work` on exactly one instance.
 *
 * Production runs six Nitro instances behind a load balancer and Nitro's
 * scheduler is per-process, so every cron entry fires six times. Without this
 * lock each poll would fan out six copies of every feed fetch — and six copies
 * of every extraction and AI summary behind them.
 *
 * `SET NX EX` rather than a fancier algorithm: the TTL is the whole safety
 * story. If a holder dies mid-run the lock expires and the next tick picks the
 * work up, which is exactly the behaviour wanted for an idempotent poll.
 */
export async function withRedisLock<T>(
    key: string,
    ttlSeconds: number,
    work: () => Promise<T>
): Promise<T | { skipped: true; reason: string }> {
    let redis;
    try {
        redis = getRedisClient();
        await ensureRedisConnected();
    } catch (error: any) {
        // Refusing to run is the safe failure: six duplicate polls cost real
        // money at the extraction and summary stages.
        return { skipped: true, reason: `Redis unavailable: ${error?.message || 'unknown'}` };
    }

    const acquired = await redis.set(key, `${process.pid}:${Date.now()}`, { NX: true, EX: ttlSeconds });
    if (acquired !== 'OK') {
        return { skipped: true, reason: 'Another instance holds the lock' };
    }

    try {
        return await work();
    } finally {
        await redis.del(key).catch(() => { });
    }
}

// ─── Task logging ────────────────────────────────────────────────────────────

/** TaskExecution logging, so RSS runs show up alongside other background tasks. */
export async function saveRssTaskExecution(taskName: string, result: any, executionTimeMs: number): Promise<void> {
    try {
        const TaskExecution = Parse.Object.extend('TaskExecution');
        const execution = new TaskExecution();
        execution.set('taskName', taskName);
        execution.set('result', result?.skipped ? 'skipped' : result?.error ? 'error' : 'success');
        execution.set('message', result?.reason || result?.error || '');
        execution.set('executionTimeMs', executionTimeMs);
        execution.set('executionDate', new Date());
        execution.set('payload', result);
        execution.set('triggerSource', 'scheduled');
        await execution.save(null, { useMasterKey: true });
    } catch (error) {
        console.error(`[${taskName}] Failed to log TaskExecution:`, error);
    }
}
