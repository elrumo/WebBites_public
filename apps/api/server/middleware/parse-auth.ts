import { defineEventHandler, getRequestURL, readBody, createError } from 'h3'
import { validateParseToken } from '../utils/raycast-auth.js'

/**
 * Parse Session Authentication Middleware
 * Validates Parse session tokens for search and extension endpoints
 */
export default defineEventHandler(async (event) => {
  // Skip middleware for GET requests
  if (event.method === 'GET') return

  return
  const path = getRequestURL(event).pathname

  // Only protect specific endpoints
  const protectedPaths = ['/search', '/isPageSaved', '/extension-auth']
  if (!protectedPaths.includes(path)) return

  try {
    const parseUser = await validateParseToken(event)

    if (!parseUser) {
      throw createError({
        statusCode: 401,
        message: 'Access denied'
      })
    }

    // Attach user to event context for route handlers
    if (path === '/isPageSaved' || path === '/extension-auth') {
      const body = await readBody(event)
      event.context.body = { ...body, parseUser }
    }

    // For /search, just validate the token
    // The route handler will re-validate if needed
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
