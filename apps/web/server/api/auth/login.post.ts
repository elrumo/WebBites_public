import { verifySession } from '../../utils/sessionCache'
import { log } from '../../utils/useDevLog'

export default defineEventHandler(async (event) => {
  let { sessionToken, username, password } = await readBody(event)

  sessionToken = sessionToken || ''

  log('[login] sessionToken:', sessionToken ? '\u2713 present' : '\u2717 missing')
  log('[login] username:', username)

  if (!sessionToken && (!username || !password)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Session token or username/password is required'
    })
  }

  try{
    if(username && password){
      // Login with username/password
      const user = await $fetch(`${backendBaseUrl()}v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          username,
          password
        }
      })

      if(!user){
        throw createError({
          statusCode: 401,
          statusMessage: 'Invalid username or password'
        })
      }

      log('[login] user:', (user as any)?.objectId || (user as any)?.id)
      sessionToken = (user as any)?.sessionToken

      return user
    }
  }catch(error){
    throw error
  }

  try {
    // Verify the session token and get user info using cached verification
    const user = await verifySession(sessionToken)
    
    if (!user) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid session token - 1'
      })
    }

    const parseSessionToken = sessionToken

    // Set the Parse session cookie for backward compatibility
    setCookie(event, 'parse.session', parseSessionToken, {
      path: '/',
      maxAge: 31536000, // 1 year
      sameSite: 'strict',
      secure: cookieSecure(),
      httpOnly: false // Parse needs client access
    })

    // API key generation is now handled by middleware/server utils on first API call
    // This prevents login timeouts when backend has cold start issues
    return {
      success: true,
      userId: user.id,
      message: 'Logged in successfully'
    }
  } catch (error: any) {
    console.error('Login error:', error)
    throw createError({
      statusCode: 401,
      statusMessage: error.message || 'Login failed'
    })
  }
})
