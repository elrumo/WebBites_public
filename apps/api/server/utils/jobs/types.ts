/**
 * Background job queue.
 *
 * WebBites hands work (saving a bookmark, enrichment, RSS polling, backups,
 * usage counters...) to a queue that calls back into `processJob`. Two drivers
 * implement the queue:
 *
 *   qstash  Upstash QStash delivers each message to POST /qstash-webhook.
 *           This is what WebBites.io runs, and the default.
 *   redis   BullMQ on Redis, with the workers inside this process. This is what
 *           the self-hosted edition uses; nothing leaves the Docker network.
 *
 * Pick one with QUEUE_DRIVER=redis|qstash (default redis).
 */

export interface EnqueueOptions {
    /** `message` is an array: each element is its own job. */
    isBatch?: boolean;
    /**
     * Flow-control key, usually `getPartitionedQueue('<base>')`. Decides the
     * rate and parallelism limits. Defaults to `message.type`.
     */
    queueName?: string | null;
}

/** What `enqueue` hands back. QStash returns `{ messageId }` (an array for batches). */
export type EnqueueResult = { messageId: string } | Array<{ messageId: string }>;

export interface JobQueue {
    enqueue(message: any | any[], options?: EnqueueOptions): Promise<EnqueueResult>;
}

export type QueueDriverName = 'qstash' | 'redis';

/**
 * Resolved on every call so tests can flip it. Redis (BullMQ) is the default: it needs nothing but
 * the Redis every install already runs. `QUEUE_DRIVER=qstash` is for a deployment that delivers
 * jobs through Upstash QStash instead (the hosted service does).
 */
export function queueDriverName(): QueueDriverName {
    return process.env.QUEUE_DRIVER === 'qstash' ? 'qstash' : 'redis';
}

/**
 * Job types whose handler is awaited and can fail the delivery. QStash redelivers
 * those on a 500 today, so the Redis driver retries them too. Every other type
 * runs fire-and-forget (the webhook answers 200 straight away), which is why it
 * gets a single attempt.
 */
export const RETRYABLE_JOB_TYPES = new Set([
    'update-usage',
    'remove-bookmark-from-queue',
    'remove-bookmarks-from-queue',
]);
