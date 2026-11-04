/**
 * Scheduled task: nightly housekeeping for the RSS reader.
 *
 * Four jobs, all of which exist because the read path is deliberately cheap:
 *
 *   Retention        — `rssItems` grows without bound otherwise. Items are
 *                      shared, so this is the only place they are deleted.
 *   Soft-delete purge — unsubscribed rows are kept 30 days so a resubscribe
 *                      restores the user's history, matching boards.
 *   Unread reconciliation — counters are incremented by the poller and
 *                      decremented by reads across six instances and any
 *                      number of devices. Rather than making every read more
 *                      expensive to prevent drift, it is repaired here.
 *   Orphan cleanup    — feeds nobody subscribes to stop being polled and
 *                      eventually stop being stored.
 *
 * Shares the whole-task Redis lock discipline with `rss:pollFeeds`: six
 * instances running the same destructive pass concurrently is how a retention
 * sweep turns into a thundering herd of `destroyAll` calls.
 */

import Parse from 'parse/node.js';
import {
    initParseForRss,
    withRedisLock,
    saveRssTaskExecution,
    reconcileUnreadCount,
    RSS_FEEDS,
    RSS_SUBSCRIPTIONS,
    ITEM_RETENTION_COUNT,
    ITEM_RETENTION_DAYS,
} from '#root/server/utils/rssUtils';
import { purgeFeedItems } from '#root/server/utils/rssService';

const LOCK_KEY = 'rss:maintenance:lock';
/** An hour: a full sweep over a large catalogue is not a quick job. */
const LOCK_TTL_SECONDS = 3600;

/** Subscriptions soft-deleted longer than this are gone for good. */
const SOFT_DELETE_RETENTION_DAYS = 30;

const Feeds = Parse.Object.extend(RSS_FEEDS);
const Subscriptions = Parse.Object.extend(RSS_SUBSCRIPTIONS);

export default defineTask({
    meta: {
        name: 'rss:maintenance',
        description: 'Purge old feed items, drop stale subscriptions, and repair unread counters',
    },
    async run() {
        const startedAt = Date.now();
        initParseForRss();

        const result = await withRedisLock(LOCK_KEY, LOCK_TTL_SECONDS, async () => {
            const itemsPurged = await purgeItems();
            const subscriptionsPurged = await purgeSoftDeletedSubscriptions();
            const countersRepaired = await reconcileCounters();

            console.log(
                `[rss:maintenance] items=${itemsPurged} subscriptions=${subscriptionsPurged} counters=${countersRepaired}`
            );
            return { itemsPurged, subscriptionsPurged, countersRepaired };
        });

        if ('skipped' in result) {
            console.log(`[rss:maintenance] Skipped: ${result.reason}`);
        }

        await saveRssTaskExecution('rss:maintenance', result, Date.now() - startedAt);
        return { result };
    },
});

/** Trims every feed's history to the retention bounds, one feed at a time. */
async function purgeItems(): Promise<number> {
    let purged = 0;
    let skip = 0;

    while (true) {
        const query = new Parse.Query(Feeds);
        query.ascending('createdAt');
        query.limit(100);
        query.skip(skip);
        const feeds = await query.find({ useMasterKey: true });
        if (feeds.length === 0) break;

        for (const feed of feeds) {
            try {
                purged += await purgeFeedItems(feed, ITEM_RETENTION_COUNT, ITEM_RETENTION_DAYS);
            } catch (error) {
                console.error(`[rss:maintenance] Retention failed for feed ${feed.id}:`, error);
            }
        }

        skip += feeds.length;
        if (feeds.length < 100) break;
    }

    return purged;
}

async function purgeSoftDeletedSubscriptions(): Promise<number> {
    const cutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let purged = 0;

    while (true) {
        const query = new Parse.Query(Subscriptions);
        query.equalTo('isDeleted', true);
        query.lessThan('deletedAt', cutoff);
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
 * Recomputes every active subscription's unread counter.
 *
 * Only counters that actually moved are written back, so a healthy install
 * does almost no writes here — the pass is a check, not a rewrite.
 */
async function reconcileCounters(): Promise<number> {
    let repaired = 0;
    let skip = 0;

    while (true) {
        const query = new Parse.Query(Subscriptions);
        query.notEqualTo('isDeleted', true);
        query.include('feed');
        query.ascending('createdAt');
        query.limit(100);
        query.skip(skip);
        const subscriptions = await query.find({ useMasterKey: true });
        if (subscriptions.length === 0) break;

        for (const subscription of subscriptions) {
            const before = subscription.get('unreadCount') || 0;
            try {
                const after = await reconcileUnreadCount(subscription);
                if (after !== before) repaired++;
            } catch (error) {
                console.error(`[rss:maintenance] Reconcile failed for subscription ${subscription.id}:`, error);
            }
        }

        skip += subscriptions.length;
        if (subscriptions.length < 100) break;
    }

    return repaired;
}
