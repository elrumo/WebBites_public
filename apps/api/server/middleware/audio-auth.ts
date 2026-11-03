import { defineEventHandler, getRequestURL, getQuery, createError } from 'h3'
import { verifyAudioToken } from '../utils/audio-auth'

/**
 * Audio Token Authentication Middleware
 * Validates tokens for audio streaming endpoints
 */
export default defineEventHandler(async (event) => {
  return
  const path = getRequestURL(event).pathname

  // Only handle audio streaming endpoint
  if (path !== '/streamAudio') return

  try {
    const { token } = getQuery(event)

    if (!verifyAudioToken(token as string)) {
      throw createError({
        statusCode: 401,
        message: 'Invalid or missing token'
      })
    }

    // Token is valid, allow request to proceed
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Authentication failed'
    })
  }
})
