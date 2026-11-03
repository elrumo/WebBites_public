// server/middleware/rate-limit.ts
import { defineEventHandler, getRequestIP } from 'h3'

// Simple in-memory rate limiting
// For production, consider using Redis or another distributed cache
const rateLimits = new Map<string, { count: number, resetTime: number }>()

// Configuration
const WINDOW_MS = 60 * 1000
const MAX_REQUESTS = 30000
const EXTENSION_MAX_REQUESTS = 60000
const SCREENSHOTS_WINDOW_MS = 1000
const SCREENSHOTS_MAX_REQUESTS = 15

export default defineEventHandler((event) => {
  return
  const path = getRequestURL(event).pathname

  // Only apply rate limiting to specific endpoints
  if (path === '/extension-auth' || path === '/search' || path === '/v1/content/getScreenshots') {
    const ip = getRequestIP(event) || 'unknown'
    const isExtensionAuth = path === '/extension-auth'
    const isScreenshots = path === '/v1/content/getScreenshots'
    
    // Get the appropriate limit based on the endpoint
    const limit = isScreenshots ? SCREENSHOTS_MAX_REQUESTS : (isExtensionAuth ? EXTENSION_MAX_REQUESTS : MAX_REQUESTS)
    const windowMs = isScreenshots ? SCREENSHOTS_WINDOW_MS : WINDOW_MS
    
    // Create a unique key for this IP and endpoint
    const key = isScreenshots ? `global:${path}` : `${ip}:${path}`
    const now = Date.now()
    
    // Get current rate limit data for this key
    let limitData = rateLimits.get(key)
    
    // If no data exists or the window has expired, create a new entry
    if (!limitData || now > limitData.resetTime) {
      limitData = { 
        count: 1,
        resetTime: now + windowMs
      }
      rateLimits.set(key, limitData)
      
      // Set rate limit headers
      setHeaders(event, {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(limit - 1),
        'X-RateLimit-Reset': String(Math.ceil(limitData.resetTime / 1000))
      })

      return // Allow the request
    }
    
    // Increment the counter
    limitData.count++

    // Check if the limit has been exceeded
    if (limitData.count > limit) {
      // Update headers
      setHeaders(event, {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(limitData.resetTime / 1000)),
        'Retry-After': String(Math.ceil((limitData.resetTime - now) / 1000))
      })
      
      // Return 429 Too Many Requests
      throw createError({
        statusCode: 429,
        message: 'Too many requests, please try again later.'
      })
    }
    
    // Update headers
    setHeaders(event, {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(limit - limitData.count),
      'X-RateLimit-Reset': String(Math.ceil(limitData.resetTime / 1000))
    })
  }
})
