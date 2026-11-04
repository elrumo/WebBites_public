import { invalidateSession } from '../../utils/sessionCache'

export default defineEventHandler(async (event) => {
  try {
    // Get session token before clearing
    const sessionToken = getCookie(event, 'parse.session')
    
    // Invalidate from cache
    if (sessionToken) {
      invalidateSession(sessionToken)
    }
    
    // Clear API key cookie
    deleteCookie(event, 'wb_api_key')
    
    // Clear Parse session cookie
    deleteCookie(event, 'parse.session')
    
    return { 
      success: true, 
      message: 'Logged out successfully' 
    }
  } catch (error: any) {
    console.error('Logout error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Logout failed'
    })
  }
})