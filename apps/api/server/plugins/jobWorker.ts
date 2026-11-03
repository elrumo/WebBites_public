import { queueDriverName } from '../utils/jobs/types';
import { settingsReady } from '../utils/settings';

/**
 * Starts the background job workers when the queue is Redis (QUEUE_DRIVER=redis,
 * the self-hosted setup). With QStash the platform delivers jobs to
 * /qstash-webhook instead and this does nothing.
 *
 * JOB_WORKER=false keeps a process enqueue-only, for running the workers in
 * their own container later.
 */
export default defineNitroPlugin(async (nitroApp) => {
  await settingsReady();
  if (queueDriverName() !== 'redis' || process.env.JOB_WORKER === 'false') return;

  const { startJobWorkers, closeJobQueue } = await import('../utils/jobs/redisDriver');
  const { processJob } = await import('../utils/jobs/processJob.js');

  await startJobWorkers((body) => processJob(body, { awaitBackground: true }));
  nitroApp.hooks.hook('close', closeJobQueue);
});
