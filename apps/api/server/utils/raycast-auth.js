import { createError, getHeader } from 'h3'
import { verifySession } from './sessionCache.js'

export async function validateParseToken(event) {
  const authHeader = getHeader(event, 'authorization')

  // const allHeaders = getHeaders(event)
  // console.log('allHeaders', allHeaders)

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Missing or invalid authorization header'
    })
  }

  const sessionToken = authHeader.substring(7)

  try {
    const user = await verifySession(sessionToken)

    if (!user) {
      throw new Error('[RaycastAuth] Session not found')
    }

    return {
      userId: user.id,
      username: user.get('username'),
      email: user.get('email'),
      sessionToken: sessionToken,
      user: user
    }
  } catch (error) {
    console.error('[RaycastAuth] Parse session validation failed:', error.message)
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid or expired session token'
    })
  }
}

export async function requireRaycastAuth(event) {
  const user = await validateParseToken(event)
  event.context.raycastUser = user
  return user
}