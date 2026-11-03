import { createQstashDriver } from './qstashDriver';
import { queueDriverName, type EnqueueOptions, type EnqueueResult, type JobQueue } from './types';

let qstash: JobQueue | null = null;
let redis: JobQueue | null = null;

/**
 * The queue selected by QUEUE_DRIVER. The Redis driver (and with it BullMQ and
 * ioredis) is only loaded when it is chosen, so WebBites.io never touches it.
 */
export async function getJobQueue(): Promise<JobQueue> {
    if (queueDriverName() === 'redis') {
        if (!redis) {
            const { createRedisDriver } = await import('./redisDriver');
            redis = createRedisDriver();
        }
        return redis;
    }
    return (qstash ??= createQstashDriver());
}

export async function enqueueJob(message: any | any[], options?: EnqueueOptions): Promise<EnqueueResult> {
    return (await getJobQueue()).enqueue(message, options);
}
