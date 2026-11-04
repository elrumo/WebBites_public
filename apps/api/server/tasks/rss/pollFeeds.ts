/**
 * Scheduled task: fan out a polling round across every feed that is due.
 *
 * Runs every ten minutes. The task itself does no fetching — it selects due
 * feeds and hands each to QStash, which spreads the work across instances and
 * gives per-feed retries for free. A feed nobody subscribes to is not polled,
 * and neither is one demoted to `dead`.
 *
 * The Redis lock is not optional. Production runs six Nitro instances and
 * Nitro's scheduler is per-process, so without it every tick would enqueue six
 * copies of every feed — and behind each of those, six full-text extractions
 * and six OpenAI summaries.
 */

import Parse from 'parse/node.js';
import { initParseForRss, withRedisLock, saveRssTaskExecution, RSS_FEEDS } from '#root/server/utils/rssUtils';
import { RSS_POLL_MESSAGE } from '#root/server/utils/rssService';
import { sendToQstash, getPartitionedQueue } from '#root/server/utils/serverUtils';

/** Held a little longer than the 10-minute cadence so a slow round is not lapped. */
const LOCK_TTL_SECONDS = 540;
const LOCK_KEY = 'rss:poll:lock';

/** Enough headroom for a large catalogue without unbounded enqueueing. */
const MAX_FEEDS_PER_ROUND = 2000;

export default defineTask({
    meta: {
        name: 'rss:pollFeeds',
        description: 'Queue a fetch for every subscribed feed whose next poll is due',
    },
    async run() {
        const startedAt = Date.now();
        initParseForRss();

        const result = await withRedisLock(LOCK_KEY, LOCK_TTL_SECONDS, async () => {
            const feeds = await findDueFeeds();

            if (feeds.length === 0) {
                return { queued: 0, message: 'No feeds due' };
            }

            await sendToQstash(
                feeds.map((feed) => ({ type: RSS_POLL_MESSAGE, data: { feedId: feed.id } })),
                { isBatch: true, queueName: getPartitionedQueue('rssFeedPoll') }
            );

            console.log(`[rss:pollFeeds] Queued ${feeds.length} feed(s)`);
            return { queued: feeds.length };
        });

        if ('skipped' in result) {
            console.log(`[rss:pollFeeds] Skipped: ${result.reason}`);
        }

        await saveRssTaskExecution('rss:pollFeeds', result, Date.now() - startedAt);
        return { result };
    },
});

async function findDueFeeds(): Promise<Parse.Object[]> {
    const query = new Parse.Query(Parse.Object.extend(RSS_FEEDS));
    query.lessThanOrEqualTo('nextFetchAt', new Date());
    query.greaterThan('subscriberCount', 0);
    query.notEqualTo('status', 'dead');
    query.ascending('nextFetchAt');
    query.select('objectId');
    query.limit(MAX_FEEDS_PER_ROUND);

    const feeds = await query.find({ useMasterKey: true });

    if (feeds.length === MAX_FEEDS_PER_ROUND) {
        console.log(`[rss:pollFeeds] Hit the ${MAX_FEEDS_PER_ROUND}-feed round cap; the remainder rolls into the next tick`);
    }

    return feeds;
}
