import { verifySession } from '../utils/sessionCache'

// The jobs a client may start. The backend's queue also runs its own pipeline
// steps (`image-processing-requests`, `update-usage`, `page-content-requests`,
// ...), which trust the ids and URLs in the message because only the backend
// was meant to send them. `topic` came straight from the body, so a signed-in
// user could run any of them: fetch an arbitrary URL from inside the network
// and keep the result, write files onto another user's bookmark, or reset
// their own usage counters.
const CLIENT_TOPICS = new Set(['website-save-requests', 'batch-delete', 'image-save-requests'])

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  const data = body.data;
  let topic = body.topic
  let queueName = body.queueName

  if (typeof topic !== 'string' || !CLIENT_TOPICS.has(topic)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown job type' })
  }

  // Authenticate the caller. This route can create ('website-save-requests')
  // and delete ('batch-delete') bookmarks, so it must never trust a raw
  // userId from the request body. Accepts the web app's session cookie or an
  // Authorization: Bearer <parse session token> header (for non-browser clients).
  const authHeader = getHeader(event, 'authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
  const sessionToken = getCookie(event, 'parse.session') || bearerToken

  const sessionUser = await verifySession(sessionToken)
  if (!sessionUser) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  // Always act on behalf of the authenticated user, never the body-provided id.
  const userId = sessionUser.id
  if (body.userId && body.userId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'userId does not match the authenticated user' })
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data.userId && data.userId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'userId does not match the authenticated user' })
  }

  // `data.clientMetadata` is post content the browser extension read out of the
  // page. It is page-controlled, so it gets a size guard here (the queue caps
  // message bodies at about 1MB) and full validation in the backend's
  // sanitizeClientMetadata before anything reads it.
  if (data && typeof data === 'object' && data.clientMetadata) {
    const size = JSON.stringify(data.clientMetadata).length
    if (size > 64 * 1024) {
      console.warn(`[qstash] dropping oversized clientMetadata (${size} bytes) for user ${userId}`)
      delete data.clientMetadata
    }
  }

  console.log('queueName: ', queueName)
  console.log('userId: ', userId)
  // console.log('body: ', body)

  try {
    // The backend owns the queue (QStash on WebBites.io, Redis when self-hosted).
    // This route stays what it was for the browser: authenticate the user, pin
    // the userId, then hand the job over. /v1/jobs/enqueue is internal-only.
    const flowControlKey = getFlowKey(topic)

    console.log('[enqueue] topic: ', topic)
    console.log('[enqueue] flowControlKey: ', flowControlKey)

    const response = await $fetch(`${backendBaseUrl()}v1/jobs/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': internalAuthHeader()
      },
      body: {
        message: {
          data,
          userId,
          type: topic,
        },
        queueName: flowControlKey
      }
    })

    console.log('Job enqueued successfully')
    return { success: true, result: response?.result }
  } catch (error) {
    console.error('Error enqueueing job:', error)
    return { success: false, error: error.message }
  }
})

function getFlowKey(base, userId){
    return `${base}-${Math.floor(Math.random() * 30) + 1}`;
}
