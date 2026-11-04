/**
 * Tests for the read-state rules and the pure helpers around them.
 *
 * Read state is the one piece of RSS logic that is genuinely subtle: an item
 * is read because of an explicit mark, *or* because it falls under a
 * mark-all-read cutoff, *or* because it predates the subscription. Getting any
 * branch wrong shows up as a permanently wrong unread badge rather than as an
 * error, so it is worth pinning down here. These tests build Parse objects in
 * memory — nothing talks to a Parse server. Run with:
 *
 *   npm run test:rssUtils
 */

import Parse from 'parse/node.js';

Parse.initialize('test-app-id', 'test-js-key', 'test-master-key');
Parse.serverURL = 'https://parse.invalid/parse';

import {
    isItemRead,
    readCutoffFor,
    nextInterval,
    recordFeedFailure,
    recordFeedSuccess,
    buildDedupKey,
    buildSubscriptionKey,
    buildMarkKey,
    serializeSubscription,
    serializeItemList,
    readableTextFor,
    MIN_FETCH_INTERVAL_MINUTES,
    MAX_FETCH_INTERVAL_MINUTES,
    MAX_FEED_FAILURES,
    RSS_FEEDS,
    RSS_ITEMS,
    RSS_SUBSCRIPTIONS,
} from './rssUtils';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

const Feeds = Parse.Object.extend(RSS_FEEDS);
const Items = Parse.Object.extend(RSS_ITEMS);
const Subscriptions = Parse.Object.extend(RSS_SUBSCRIPTIONS);

const JAN = new Date('2024-01-01T00:00:00Z');
const FEB = new Date('2024-02-01T00:00:00Z');
const MAR = new Date('2024-03-01T00:00:00Z');
const APR = new Date('2024-04-01T00:00:00Z');

function makeSubscription(fields: Record<string, any> = {}): Parse.Object {
    const subscription = new Subscriptions();
    subscription.set('subscribedAt', FEB);
    for (const [key, value] of Object.entries(fields)) subscription.set(key, value);
    return subscription;
}

// ─── Cutoffs ─────────────────────────────────────────────────────────────────

check('cutoff: subscribedAt alone', readCutoffFor(makeSubscription())?.getTime() === FEB.getTime());
check(
    'cutoff: later markAll wins',
    readCutoffFor(makeSubscription({ lastMarkAllReadAt: MAR }))?.getTime() === MAR.getTime()
);
check(
    'cutoff: earlier markAll loses to subscribedAt',
    readCutoffFor(makeSubscription({ lastMarkAllReadAt: JAN }))?.getTime() === FEB.getTime()
);
check(
    'cutoff: neither set is null',
    readCutoffFor(makeSubscription({ subscribedAt: undefined })) === null
);

// ─── The read predicate ──────────────────────────────────────────────────────

const noMarks = new Set<string>();
const subscription = makeSubscription({ lastMarkAllReadAt: MAR });

check('read: explicit mark wins', isItemRead(APR, subscription, new Set(['item-1']), 'item-1'));
check('read: published after cutoff is unread', !isItemRead(APR, subscription, noMarks, 'item-2'));
check('read: published before cutoff is read', isItemRead(FEB, subscription, noMarks, 'item-3'));
check('read: published exactly at cutoff is read', isItemRead(MAR, subscription, noMarks, 'item-4'));
check(
    'read: predates subscription is read even with no markAll',
    isItemRead(JAN, makeSubscription(), noMarks, 'item-5')
);
check(
    'read: null date with no mark is unread',
    !isItemRead(null, subscription, noMarks, 'item-6')
);
check(
    'read: null date with a mark is read',
    isItemRead(null, subscription, new Set(['item-7']), 'item-7')
);
check(
    'read: fresh subscription with no cutoff at all leaves items unread',
    !isItemRead(APR, makeSubscription({ subscribedAt: undefined }), noMarks, 'item-8')
);

// A mark from *another* item must not leak across.
check('read: unrelated mark does not apply', !isItemRead(APR, subscription, new Set(['other']), 'item-9'));

// ─── Adaptive polling ────────────────────────────────────────────────────────

check('interval: new items halve the wait', nextInterval(60, true) === 30);
check('interval: quiet feeds back off', nextInterval(60, false) === 90);
check('interval: floor respected', nextInterval(MIN_FETCH_INTERVAL_MINUTES, true) === MIN_FETCH_INTERVAL_MINUTES);
check('interval: ceiling respected', nextInterval(MAX_FETCH_INTERVAL_MINUTES, false) === MAX_FETCH_INTERVAL_MINUTES);
check('interval: missing value uses the default', nextInterval(undefined, false) === 90);

// ─── Failure handling ────────────────────────────────────────────────────────

const flaky = new Feeds();
flaky.set('failureCount', 0);
flaky.set('status', 'active');

recordFeedFailure(flaky, 'ECONNRESET');
check('failure: count incremented', flaky.get('failureCount') === 1);
check('failure: error recorded', flaky.get('lastError') === 'ECONNRESET');
check('failure: still active after one', flaky.get('status') === 'active');
check('failure: next fetch pushed out', (flaky.get('nextFetchAt') as Date).getTime() > Date.now());

for (let i = 1; i < MAX_FEED_FAILURES; i++) recordFeedFailure(flaky, 'still down');
check('failure: demoted to dead at the threshold', flaky.get('status') === 'dead');
check(
    'failure: backoff never exceeds the ceiling',
    (flaky.get('nextFetchAt') as Date).getTime() <= Date.now() + MAX_FETCH_INTERVAL_MINUTES * 60_000 + 1000
);

recordFeedSuccess(flaky);
check('success: failures reset', flaky.get('failureCount') === 0);
check('success: revived', flaky.get('status') === 'active');
check('success: error cleared', flaky.get('lastError') === null);

const longError = 'x'.repeat(900);
const noisy = new Feeds();
recordFeedFailure(noisy, longError);
check('failure: long errors are truncated', (noisy.get('lastError') as string).length === 500);

// ─── Keys ────────────────────────────────────────────────────────────────────

const keyA = buildDedupKey('feed1', 'https://example.com/a');
const keyB = buildDedupKey('feed1', 'https://example.com/b');
const keyC = buildDedupKey('feed2', 'https://example.com/a');

check('dedup: stable for the same input', keyA === buildDedupKey('feed1', 'https://example.com/a'));
check('dedup: differs by guid', keyA !== keyB);
check('dedup: scoped by feed', keyA !== keyC);
check('dedup: feed id stays readable as a prefix', keyA.startsWith('feed1:'));
check('dedup: fixed length regardless of guid size', buildDedupKey('f', 'x'.repeat(5000)).length === buildDedupKey('f', 'y').length);

check('keys: subscription key', buildSubscriptionKey('user1', 'feed1') === 'user1:feed1');
check('keys: mark key', buildMarkKey('user1', 'item1') === 'user1:item1');

// ─── Serialization ───────────────────────────────────────────────────────────

const feed = new Feeds();
feed.set('feedUrl', 'https://example.com/feed');
feed.set('title', 'Example Blog');
feed.set('iconUrl', 'https://example.com/icon.png');
feed.set('siteUrl', 'https://example.com/');
feed.id = 'feed-id-1';

const sub = makeSubscription({ feed, unreadCount: 4, sortOrder: 2 });
sub.id = 'sub-id-1';

const serialized = serializeSubscription(sub);
check('serialize: falls back to the feed title', serialized.title === 'Example Blog');
check('serialize: feed metadata folded in', serialized.feed.iconUrl === 'https://example.com/icon.png');
check('serialize: unread count passed through', serialized.unreadCount === 4);
check('serialize: extraction defaults off', serialized.extractionEnabled === false);
check('serialize: subscribedAt is an ISO string', serialized.subscribedAt === FEB.toISOString());
check('serialize: unset markAll is null', serialized.lastMarkAllReadAt === null);

sub.set('customTitle', 'My Feed');
check('serialize: custom title wins', serializeSubscription(sub).title === 'My Feed');

sub.set('unreadCount', -3);
check('serialize: negative drift clamps to zero', serializeSubscription(sub).unreadCount === 0);

const item = new Items();
item.id = 'item-id-1';
item.set('feed', feed);
item.set('title', 'A post');
item.set('publishedAt', APR);
item.set('rssContentText', '  Body   text\n\nwith   whitespace  ');
item.set('link', 'https://example.com/a');

const row = serializeItemList(item, sub, false);
check('serialize: excerpt collapses whitespace', row.excerpt === 'Body text with whitespace');
check('serialize: custom title used as the feed label', row.feedTitle === 'My Feed');
check('serialize: feed id present', row.feedId === 'feed-id-1');
check('serialize: no body on list rows', !('rssContentHtml' in row));
check('serialize: hasExtracted false without a file', row.hasExtracted === false);
check('serialize: hasSummary false without one', row.hasSummary === false);

item.set('extractedFileUrl', 'https://files.example/x.html');
item.set('aiSummary', { tldr: 'Short' });
const enriched = serializeItemList(item, sub, true);
check('serialize: hasExtracted reflects the file', enriched.hasExtracted === true);
check('serialize: hasSummary reflects the summary', enriched.hasSummary === true);
check('serialize: isRead passed through', enriched.isRead === true);

const longBody = new Items();
longBody.set('feed', feed);
longBody.set('rssContentText', 'word '.repeat(400));
check('serialize: excerpt capped', serializeItemList(longBody, sub, false).excerpt.length <= 220);

// ─── Read later ──────────────────────────────────────────────────────────────
//
// Shelving and read state are separate axes — mark-all-read must not empty the
// shelf, and shelving must not mark anything read — so the two flags are
// pinned together here.

check('read later: flag defaults off', serializeItemList(item, sub, false).isReadLater === false);
check('read later: flag passed through', serializeItemList(item, sub, false, true).isReadLater === true);
check(
    'read later: shelving is independent of read state',
    serializeItemList(item, sub, true, true).isRead === true
        && serializeItemList(item, sub, true, true).isReadLater === true
);

// ─── Readable text preference ────────────────────────────────────────────────

const textItem = new Items();
textItem.set('rssContentText', 'feed body');
check('readable: falls back to the feed body', readableTextFor(textItem) === 'feed body');
textItem.set('extractedText', 'full article');
check('readable: extracted text preferred', readableTextFor(textItem) === 'full article');
check('readable: empty item yields empty string', readableTextFor(new Items()) === '');

console.log(`\nrssUtils: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
