import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getFlowControlConfig } from './flowControl';
import { RETRYABLE_JOB_TYPES, type EnqueueOptions, type EnqueueResult, type JobQueue } from './types';

/**
 * Self-hosted queue: BullMQ on Redis.
 *
 * One BullMQ queue per base flow key (`getPageContent-7` and `getPageContent-12`
 * both land in `getPageContent`). WebBites.io shards each key 1..15 ways at
 * random, and QStash limits every shard on its own, so its real throughput is a
 * multiple of the table in flowControl.ts. A single self-hosted install wants the
 * table as written, hence the collapse.
 *
 * Per queue: worker concurrency = parallelism, limiter = rate per period.
 *
 * `delay` from the flow-control table is deliberately not applied. On QStash it
 * only postponed each message by N seconds; it never let one key overtake
 * another, so here it would add latency and buy nothing.
 */

const KEY_PREFIX = 'webbites-jobs';
/** How often a worker process looks for queues that other processes created. */
const DISCOVERY_INTERVAL_MS = 30_000;

export type JobHandler = (body: any) => Promise<unknown>;

interface DriverState {
    queues: Map<string, Queue>;
    workers: Map<string, Worker>;
    handler: JobHandler | null;
    discovery: ReturnType<typeof setInterval> | null;
}

// A plain connection for finding queue names; BullMQ's own clients are not exposed.
let scanner: IORedis | null = null;

// On globalThis so a dev hot-reload doesn't leave a second set of workers running.
const g = globalThis as unknown as { __webbitesJobs?: DriverState };
const state: DriverState = (g.__webbitesJobs ??= { queues: new Map(), workers: new Map(), handler: null, discovery: null });

export function redisUrl(): string {
    const url = process.env.JOB_REDIS_URL || process.env.REDIS_URL || process.env.VITE_WEBBITES_AUTH_REDIS_HOST;
    if (!url) throw new Error('QUEUE_DRIVER=redis needs REDIS_URL (or JOB_REDIS_URL) to be set');
    return url;
}

/** BullMQ wants ioredis options; this keeps the one-URL configuration. */
export function connectionFromUrl(url: string): ConnectionOptions {
    const u = new URL(url);
    const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined;
    return {
        host: u.hostname,
        port: Number(u.port) || 6379,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        db: Number.isFinite(db) ? db : undefined,
        tls: u.protocol === 'rediss:' ? {} : undefined,
        // Required by BullMQ for workers; harmless for queues.
        maxRetriesPerRequest: null,
    };
}

/** `getPageContent-7` -> `getPageContent`. Same rule getFlowControlConfig uses. */
export function baseFlowKey(flowKey: string): string {
    return flowKey.replace(/-\d+$/, '');
}

function getQueue(name: string): Queue {
    let queue = state.queues.get(name);
    if (!queue) {
        queue = new Queue(name, {
            prefix: KEY_PREFIX,
            connection: connectionFromUrl(redisUrl()),
            defaultJobOptions: {
                removeOnComplete: { age: 3600, count: 1000 },
                removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
            },
        });
        // An unhandled 'error' event would crash the process on a Redis blip.
        queue.on('error', (error) => console.error(`[jobs] queue ${name}:`, error.message));
        state.queues.set(name, queue);
    }
    // A process that runs workers picks up queues it created itself.
    if (state.handler) ensureWorker(name);
    return queue;
}

function ensureWorker(name: string): void {
    if (state.workers.has(name) || !state.handler) return;
    const handler = state.handler;
    const config = getFlowControlConfig(name);

    const worker = new Worker(
        name,
        async (job: Job) => handler(job.data),
        {
            prefix: KEY_PREFIX,
            connection: connectionFromUrl(redisUrl()),
            concurrency: config.parallelism,
            limiter: { max: config.rate, duration: 60_000 },
        }
    );
    worker.on('error', (error) => console.error(`[jobs] worker ${name}:`, error.message));
    worker.on('failed', (job, error) => {
        console.error(`[jobs] ${name} job ${job?.id} (${job?.data?.type}) failed on attempt ${job?.attemptsMade}:`, error.message);
    });
    state.workers.set(name, worker);
}

/** Queue names BullMQ has already written to Redis, found through their `meta` keys. */
async function discoverQueueNames(): Promise<string[]> {
    if (!scanner) {
        scanner = new IORedis(redisUrl());
        scanner.on('error', (error) => console.error('[jobs] discovery connection:', error.message));
    }
    const names = new Set<string>();
    let cursor = '0';
    do {
        const [next, keys] = await scanner.scan(cursor, 'MATCH', `${KEY_PREFIX}:*:meta`, 'COUNT', 200);
        cursor = next;
        for (const key of keys) {
            const name = key.slice(KEY_PREFIX.length + 1, -':meta'.length);
            if (name) names.add(name);
        }
    } while (cursor !== '0');
    return [...names];
}

/**
 * Start processing. Call once at boot. Looks for queues left over from a previous
 * run (jobs survive a restart in Redis) and keeps looking, so a separate worker
 * process also learns about queues the API process creates later.
 */
export async function startJobWorkers(handler: JobHandler): Promise<void> {
    state.handler = handler;
    const attach = async () => {
        try {
            for (const name of await discoverQueueNames()) {
                getQueue(name); // creates the queue object and, because a handler is set, its worker
            }
        } catch (error: any) {
            console.error('[jobs] queue discovery failed:', error?.message || error);
        }
    };
    await attach();
    if (!state.discovery) {
        state.discovery = setInterval(attach, DISCOVERY_INTERVAL_MS);
        state.discovery.unref?.();
    }
    console.log(`[jobs] Redis workers running for ${state.workers.size} queue(s)`);
}

/** Stop workers and close connections. In-flight jobs finish first. */
export async function closeJobQueue(): Promise<void> {
    if (state.discovery) clearInterval(state.discovery);
    state.discovery = null;
    await Promise.allSettled([...state.workers.values()].map((w) => w.close()));
    await Promise.allSettled([...state.queues.values()].map((q) => q.close()));
    await scanner?.quit().catch(() => {});
    scanner = null;
    state.workers.clear();
    state.queues.clear();
    state.handler = null;
}

function jobOptions(message: any) {
    return RETRYABLE_JOB_TYPES.has(message?.type)
        ? { attempts: 3, backoff: { type: 'exponential' as const, delay: Number(process.env.JOB_RETRY_DELAY_MS) || 5000 } }
        : { attempts: 1 };
}

export function createRedisDriver(): JobQueue {
    return {
        async enqueue(message: any | any[], { isBatch = false, queueName = null }: EnqueueOptions = {}): Promise<EnqueueResult> {
            const flowKey = queueName || (isBatch ? undefined : message?.type) || 'default';
            const queue = getQueue(baseFlowKey(flowKey));

            if (isBatch) {
                const jobs = await queue.addBulk(
                    (message as any[]).map((msg) => ({
                        name: msg?.type || 'job',
                        data: msg,
                        opts: jobOptions(msg),
                    }))
                );
                return jobs.map((job) => ({ messageId: String(job.id) }));
            }

            const job = await queue.add(message?.type || 'job', message, jobOptions(message));
            return { messageId: String(job.id) };
        },
    };
}
