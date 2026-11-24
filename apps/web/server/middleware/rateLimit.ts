import { getMethod, getRequestURL } from 'h3'
import { createRateLimiter, enforceRateLimit, type RateLimiter } from '../utils/rateLimit'

/**
 * Per-IP limits for the anonymous routes that are worth hammering: the auth
 * endpoints (password guessing, account creation, waitlist writes with the
 * master key) and the TMDB/IGDB relays, which spend this app's third-party
 * quota on anyone's behalf.
 *
 * Fixed one-minute windows, in memory (see server/utils/rateLimit.ts).
 */

// Credential checks and account creation. A person signs in a handful of times
// a minute at most; the native app exchanges its session once per launch.
// `passwordReset` is here because it takes a reset token, which can be guessed.
// 60, not lower: mobile carriers put many users behind one address, and the
// native app exchanges its session through /api/auth/login on every launch.
const strictAuth = createRateLimiter('auth-strict', 60)
const STRICT_AUTH_PATHS = new Set(['/api/auth/login', '/api/auth/signup', '/api/auth/passwordreset'])

// Every other /api/auth/* route: isAdmin, logout, generateKey (called again on
// any 401), verifyEmailChange, clearApiKey.
const otherAuth = createRateLimiter('auth', 120)

// findEmail / isEmailOnWaitlist / saveToWaitlist / signup. One sign-in or
// waitlist flow is three or four calls.
const authFlow = createRateLimiter('authFlow', 30)

// Search-as-you-type: the web composer sends one request per keystroke.
const mediaSearch: Record<string, RateLimiter> = {
  '/api/searchmovie': createRateLimiter('searchMovie', 120),
  '/api/searchgame': createRateLimiter('searchGame', 120),
}

function limiterFor(path: string): RateLimiter | null {
  if (STRICT_AUTH_PATHS.has(path)) return strictAuth
  if (path.startsWith('/api/auth/')) return otherAuth
  if (path === '/api/authflow') return authFlow
  return mediaSearch[path] || null
}

export default defineEventHandler((event) => {
  const method = getMethod(event)
  if (method === 'OPTIONS' || method === 'HEAD') return

  // Normalised so `/api/Auth/login/` or `//api/auth/login` count against the
  // same bucket as the route they resolve to.
  const path = getRequestURL(event).pathname
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
  if (!path.startsWith('/api/')) return

  const limiter = limiterFor(path)
  if (limiter) enforceRateLimit(event, limiter)
})
