import { defineEventHandler, readBody, createError } from 'h3';
import { enqueueJob } from '#root/server/utils/jobs/index';

defineRouteMeta({
  openAPI: {
    tags: ['Jobs'],
    summary: 'Enqueue a background job',
    description: 'Internal. Puts a message on the background job queue (QStash or Redis, per QUEUE_DRIVER). Used by the web app and Parse cloud code, which no longer talk to the queue directly. Needs the internal API key.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { description: 'The job message (an object with a `type`), or an array of them when isBatch is true.' },
              isBatch: { type: 'boolean', default: false },
              queueName: { type: 'string', description: 'Flow-control key, usually a partitioned queue name such as getPageContent-7.' },
            },
          },
        },
      },
    },
  },
});

// A batch is one request; keep it bounded.
const MAX_BATCH = 100;

export default defineEventHandler(async (event) => {
  const { message, isBatch = false, queueName = null } = (await readBody(event)) ?? {};

  if (message === undefined || message === null || typeof message !== 'object') {
    throw createError({ statusCode: 400, statusMessage: '`message` must be an object or, with isBatch, an array of objects' });
  }
  if (isBatch) {
    if (!Array.isArray(message) || message.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'isBatch needs a non-empty array' });
    }
    if (message.length > MAX_BATCH) {
      throw createError({ statusCode: 400, statusMessage: `A batch is limited to ${MAX_BATCH} messages` });
    }
  } else if (Array.isArray(message)) {
    throw createError({ statusCode: 400, statusMessage: 'An array needs isBatch: true' });
  }
  if (queueName !== null && (typeof queueName !== 'string' || queueName.length > 100)) {
    throw createError({ statusCode: 400, statusMessage: '`queueName` must be a short string' });
  }

  const result = await enqueueJob(message, { isBatch: Boolean(isBatch), queueName });
  return { success: true, result };
});
