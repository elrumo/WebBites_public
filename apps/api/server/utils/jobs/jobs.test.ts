/**
 * Run: npm run test:jobs
 *
 * Optional: JOB_TEST_REDIS_URL=redis://localhost:6379 npm run test:jobs
 * also runs the BullMQ driver against a real Redis.
 *
 * 1. getFlowControlConfig — characterization of the table that moved out of
 *    serverUtils.ts. These values are what WebBites.io runs on today.
 * 2. QStash driver — the message published to QStash is unchanged.
 * 3. API routing — only the internal key may enqueue (see apiRouteAccess.test.ts).
 * 4. Redis driver — needs JOB_TEST_REDIS_URL; uses and FLUSHES that database.
 */
import { getFlowControlConfig } from './flowControl';
import { createQstashDriver } from './qstashDriver';
import { queueDriverName } from './types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`); }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
    // ─── 1. flow control table ───────────────────────────────────────────────────
    console.log('flow control');
    {
        const HIGH = { rate: 15, period: '1m', parallelism: 10, delay: 0 };
        const MEDIUM = { rate: 10, period: '1m', parallelism: 5, delay: 5 };
        const LOW = { rate: 5, period: '1m', parallelism: 3, delay: 10 };

        const cfg = (key: string) => getFlowControlConfig(key);
        const strip = ({ key, ...rest }: ReturnType<typeof getFlowControlConfig>) => rest;

        check('getPageContent is HIGH', same(strip(cfg('getPageContent')), HIGH));
        check('the key keeps its partition suffix', cfg('getPageContent-5').key === 'getPageContent-5');
        check('a partitioned key maps to its base config', same(strip(cfg('getPageContent-5')), HIGH));
        check('getBookmarkContent is HIGH', same(strip(cfg('getBookmarkContent-12')), HIGH));
        check('import variants are LOW and win over the base key', same(strip(cfg('getPageContent-import-3')), LOW));
        check('saveBookmarkFromimport-import is LOW', same(strip(cfg('saveBookmarkFromimport-import-9')), LOW));
        check('bookmark-queue-management-import is MEDIUM', same(strip(cfg('bookmark-queue-management-import-2')), MEDIUM));
        check('getScreenshots is LOW', same(strip(cfg('getScreenshots-4')), LOW));
        check('rssFeedPoll is MEDIUM', same(strip(cfg('rssFeedPoll-1')), MEDIUM));
        check('rssItemExtract is LOW', same(strip(cfg('rssItemExtract-7')), LOW));
        check('rssSubscribe is LOW', same(strip(cfg('rssSubscribe-15')), LOW));
        check('backupRun is its own 10/min, 2 parallel, no delay', same(strip(cfg('backupRun')), { rate: 10, period: '1m', parallelism: 2, delay: 0 }));
        check('batch-delete is immediate 60/60', same(strip(cfg('batch-delete')), { rate: 60, period: '1m', parallelism: 60, delay: 0 }));
        check('updateUsage is MEDIUM', same(strip(cfg('updateUsage-3')), MEDIUM));
        check('web-app bookmark saves keep the limits the web app used (30/min, 40 parallel, no delay)', same(strip(cfg('website-save-requests-17')), { rate: 30, period: '1m', parallelism: 40, delay: 0 }));
        check('Parse usage updates run strictly one at a time, without a delay', same(strip(cfg('updateUsage-sequential')), { rate: 600, period: '1m', parallelism: 1, delay: 0 }));
        check('the backend\'s own partitioned updateUsage keys are unaffected', same(strip(cfg('updateUsage-3')), MEDIUM));
        check('an unknown key falls back to MEDIUM', same(strip(cfg('somethingNew')), MEDIUM));
        check('a key that only starts with a known one uses the longest prefix', same(strip(cfg('getPageContentExtra')), HIGH));
    }

    // ─── 2. QStash driver payload ────────────────────────────────────────────────
    console.log('qstash driver');
    {
        process.env.VITE_BACKEND_URL = 'https://api.example.com/';
        process.env.CUSTOM_API_KEY = 'internal-key';
        const published: any[] = [];
        const batched: any[][] = [];
        const driver = createQstashDriver(() => ({
            publishJSON: async (m) => { published.push(m); return { messageId: 'm1' }; },
            batchJSON: async (ms) => { batched.push(ms); return ms.map((_, i) => ({ messageId: `b${i}` })); },
        }));
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer internal-key' };

        const message = { type: 'website-save-requests', data: { url: 'https://a.com' } };
        const single = await driver.enqueue(message, { queueName: 'getPageContent-5' });
        check('single: result is passed through', same(single, { messageId: 'm1' }));
        check('single: exact payload, HIGH priority has no delay', same(published[0], {
            headers, url: 'https://api.example.com/qstash-webhook', body: message,
            flowControl: { key: 'getPageContent-5', rate: 15, period: '1m', parallelism: 10 },
        }));

        await driver.enqueue(message, { queueName: 'rssItemExtract-2' });
        check('single: LOW priority carries a 10s delay', published[1].delay === 10 && published[1].flowControl.rate === 5 && published[1].flowControl.parallelism === 3);

        await driver.enqueue({ type: 'update-usage' });
        check('no queueName: the message type is the flow key', published[2].flowControl.key === 'update-usage');

        await driver.enqueue({ foo: 1 });
        check('no queueName and no type: the default key', published[3].flowControl.key === 'default');

        const messages = [{ type: 'a', n: 1 }, { type: 'a', n: 2 }];
        const batch = await driver.enqueue(messages, { isBatch: true, queueName: 'rssFeedPoll-1' });
        check('batch: one batchJSON call, one entry per message', batched.length === 1 && batched[0].length === 2);
        check('batch: each entry has its own body and the shared settings', same(batched[0].map(m => m.body), messages)
            && batched[0].every(m => m.url === 'https://api.example.com/qstash-webhook' && m.delay === 5 && m.flowControl.key === 'rssFeedPoll-1'));
        check('batch: result is passed through', Array.isArray(batch) && batch.length === 2);

        let threw = false;
        const failing = createQstashDriver(() => ({ publishJSON: async () => { throw new Error('boom'); }, batchJSON: async () => [] }));
        const originalLog = console.log; console.log = () => {};
        try { await failing.enqueue(message); } catch { threw = true; }
        console.log = originalLog;
        check('a publish failure is rethrown to the caller', threw);

        delete process.env.QUEUE_DRIVER;
        check('the driver defaults to redis', queueDriverName() === 'redis');
        process.env.QUEUE_DRIVER = 'qstash';
        check('QUEUE_DRIVER=qstash selects qstash', queueDriverName() === 'qstash');
        process.env.QUEUE_DRIVER = 'anything-else';
        check('an unknown value falls back to redis, the driver that needs no external service', queueDriverName() === 'redis');
        delete process.env.QUEUE_DRIVER;
    }

    // ─── 4. Redis driver ─────────────────────────────────────────────────────────
    const redisUrl = process.env.JOB_TEST_REDIS_URL;
    if (!redisUrl) {
        console.log('\nredis driver: skipped (set JOB_TEST_REDIS_URL=redis://localhost:6379/15 to run)');
    } else {
        console.log('redis driver');
        process.env.JOB_REDIS_URL = redisUrl;
        process.env.JOB_RETRY_DELAY_MS = '40';
        const { default: IORedis } = await import('ioredis');
        const { createRedisDriver, startJobWorkers, closeJobQueue, baseFlowKey } = await import('./redisDriver');

        const flush = async () => { const r = new IORedis(redisUrl); await r.flushdb(); await r.quit(); };
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const until = async (cond: () => boolean, ms = 8000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await sleep(25); return cond(); };
        const quiet = async <T>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

        check('partition suffixes collapse to one queue', baseFlowKey('getPageContent-7') === 'getPageContent' && baseFlowKey('getPageContent-import-12') === 'getPageContent-import' && baseFlowKey('rssFeedPoll') === 'rssFeedPoll');

        // enqueue + process, and both partitions land in the same queue
        await flush();
        {
            const seen: any[] = [];
            const driver = createRedisDriver();
            await startJobWorkers(async (body) => { seen.push(body); });
            const single = await driver.enqueue({ type: 'x', n: 1 }, { queueName: 'getPageContent-7' }) as { messageId: string };
            const batch = await driver.enqueue([{ type: 'x', n: 2 }, { type: 'x', n: 3 }], { isBatch: true, queueName: 'getPageContent-12' }) as Array<{ messageId: string }>;
            check('single enqueue returns a messageId', typeof single.messageId === 'string' && single.messageId.length > 0);
            check('batch enqueue returns one messageId per message', Array.isArray(batch) && batch.length === 2);
            check('jobs run with their message as the body', await until(() => seen.length === 3));
            check('every message arrived intact', same(seen.map((m) => m.n).sort(), [1, 2, 3]));
            await closeJobQueue();
        }

        // concurrency: backupRun is parallelism 2
        await flush();
        {
            let running = 0, peak = 0, done = 0;
            const driver = createRedisDriver();
            await startJobWorkers(async () => { running++; peak = Math.max(peak, running); await sleep(120); running--; done++; });
            await driver.enqueue(Array.from({ length: 6 }, (_, i) => ({ type: 'backup-run-requests', i })), { isBatch: true, queueName: 'backupRun' });
            check('all jobs finish', await until(() => done === 6));
            check('no more than `parallelism` run at once (backupRun = 2)', peak === 2);
            await closeJobQueue();
        }

        // rate limit: backupRun is 10 per minute
        await flush();
        {
            let done = 0;
            const driver = createRedisDriver();
            await startJobWorkers(async () => { done++; });
            await driver.enqueue(Array.from({ length: 13 }, (_, i) => ({ type: 'backup-run-requests', i })), { isBatch: true, queueName: 'backupRun' });
            await until(() => done >= 10);
            await sleep(1500);
            check('the limiter holds the 11th job back (10 per minute)', done === 10);
            await closeJobQueue();
        }

        // retries: update-usage is retried, other types are not
        await flush();
        {
            const attempts: Record<string, number> = {};
            const driver = createRedisDriver();
            await startJobWorkers(async (body) => {
                attempts[body.type] = (attempts[body.type] || 0) + 1;
                throw new Error('handler failed');
            });
            await quiet(async () => {
                await driver.enqueue({ type: 'update-usage', n: 1 });
                await driver.enqueue({ type: 'remove-bookmark-from-queue', n: 1 });
                await driver.enqueue({ type: 'website-save-requests', n: 1 }, { queueName: 'getPageContent-1' });
                await until(() => attempts['update-usage'] >= 3 && attempts['remove-bookmark-from-queue'] >= 3);
                await sleep(600);
            });
            check('update-usage gets 3 attempts', attempts['update-usage'] === 3);
            check('remove-bookmark-from-queue gets 3 attempts', attempts['remove-bookmark-from-queue'] === 3);
            check('a fire-and-forget type gets exactly 1 attempt', attempts['website-save-requests'] === 1);
            await closeJobQueue();
        }

        // restart recovery: jobs queued while no worker ran are picked up on start
        await flush();
        {
            const driver = createRedisDriver();
            await driver.enqueue({ type: 'x', n: 'left-over-1' }, { queueName: 'bookmark-processing-3' });
            await driver.enqueue({ type: 'x', n: 'left-over-2' }, { queueName: 'rssFeedPoll-9' });
            await closeJobQueue(); // the "process" ends with the jobs still waiting in Redis

            const seen: string[] = [];
            await startJobWorkers(async (body) => { seen.push(body.n); });
            check('jobs left in Redis by a previous run are processed after a restart', await until(() => seen.length === 2));
            await closeJobQueue();
        }

        await flush();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    process.exit(0); // BullMQ connections are closed above; this just guards a stuck handle
}

main().catch((error) => { console.error(error); process.exit(1); });
