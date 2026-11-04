import { verifySession } from '../utils/sessionCache'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  const data = body.data;
  let topic = body.topic
  let queueName = body.queueName

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
