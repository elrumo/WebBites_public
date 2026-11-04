// Nitro backend server server/routes/qstash-webhook.post.js
//
// The QStash driver's delivery endpoint: verifies the Upstash signature and runs
// the job. The handlers themselves live in server/utils/jobs/processJob.js so the
// Redis driver's workers run exactly the same code.
import { captureException } from '#root/server/utils/sentry.js';
import { Receiver } from '@upstash/qstash'
import { processJob } from '../utils/jobs/processJob.js';
import { queueDriverName } from '../utils/jobs/types.ts';

const receiver = new Receiver({
  currentSigningKey: process.env.VITE_QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.VITE_QSTASH_NEXT_SIGNING_KEY,
})

const urlDestination = `${process.env.VITE_BACKEND_URL}qstash-webhook`;

export default defineEventHandler(async (event) => {
  // Only the QStash driver delivers here. With QUEUE_DRIVER=redis the jobs never
  // leave the process, so this route has nothing to do.
  if (queueDriverName() !== 'qstash') {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }

  // Get the raw body as string for signature verification
  const rawBodyString = await readRawBody(event, 'utf8')
  const signature = getHeader(event, 'upstash-signature')

  try {
    await checkValidity(rawBodyString, signature)
    
    // Parse the body only after successful verification
    let body;
    try {
      body = JSON.parse(rawBodyString)
    } catch (parseError) {
      console.error('Failed to parse QStash webhook body:', parseError.message);
      throw createError({
        statusCode: 400,
        message: 'Invalid JSON body'
      })
    }

    // Fire-and-forget job types start and return, to answer inside QStash's timeout.
    return await processJob(body, { awaitBackground: false })
  } catch (error) {
    console.error('Error processing message:', error);
    captureException(error);
    throw createError({
      statusCode: 500,
      message: 'Error processing message'
    })
  }
})

const checkValidity = async (rawBodyString, signature) => {
  
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  if (!signature) {
    console.error('QStash signature verification failed: Missing signature header');
    throw createError({
      statusCode: 401,
      message: 'Missing signature'
    })
  }

  try {
    // Verify the webhook using the raw body string
    const isValid = await receiver.verify({
      signature,
      body: rawBodyString,
      url: urlDestination
    })

    if (!isValid) {
      console.error('QStash signature verification failed: Invalid signature', {
        signaturePrefix: signature?.substring(0, 10) + '...',
        bodyPrefix: rawBodyString?.substring(0, 50) + '...',
        urlDestination
      });
      throw createError({
        statusCode: 401,
        message: 'Invalid signature'
      })
  }
  } catch (error) {
    console.error('QStash signature verification error:', error.message);
    if (error.statusCode === 401) {
      throw error; // Re-throw our custom errors
    }
    // For other errors (like network issues), throw a generic error
    throw createError({
      statusCode: 401,
      message: 'Signature verification failed'
    })
  }
}
