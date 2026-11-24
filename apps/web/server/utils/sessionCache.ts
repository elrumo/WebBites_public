import Parse from 'parse/node';
import { createError, getCookie } from 'h3'
import { ensureParseInitialized } from './parseRuntime'

// What a Parse session token looks like: `r:` and 32 hex characters. Looser
// than that on purpose, but a string of that shape and nothing else.
const SESSION_TOKEN_PATTERN = /^r:[A-Za-z0-9]{8,128}$/

// In-memory session cache
const sessionCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 5 minutes in milliseconds
const MAX_CACHE_SIZE = 1000; // Prevent unbounded memory growth

// Manual cleanup function - called when cache operations happen
function cleanupExpiredEntries() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [token, data] of sessionCache.entries()) {
    if (now > data.expiresAt) {
      sessionCache.delete(token);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} expired session cache entries`);
  }
}

/**
 * Verify a session token and return the associated user
 * Uses in-memory caching to reduce database queries
 * @param {string} sessionToken - The session token to verify
 * @returns {Promise<Object|null>} The Parse User object or null if invalid
 */
export async function verifySession(sessionToken: string): Promise<Parse.User | null> {
  // `/api/auth/login` hands this the `sessionToken` field of a JSON body, and
  // Parse's `equalTo` takes an object as a query constraint. Sent as
  // `{"$regex": "^r:ab"}` it matched whichever session began that way, under
  // the master key, and the 200-or-401 answer let anyone read a live session
  // token out a character at a time. A token is a string of a known shape.
  if (typeof sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(sessionToken)) {
    return null;
  }

  // Perform manual cleanup occasionally (every 10th call)
  if (Math.random() < 0.1) {
    cleanupExpiredEntries();
  }

  // Check cache first
  const cached = sessionCache.get(sessionToken);
  if (cached && Date.now() < cached.expiresAt) {
    // The token itself is not logged: this runs on every authenticated request.
    console.log('Cache hit for session token');
    return cached.user;
  }

  // Make sure the server SDK has the master key even if another module
  // initialized Parse earlier with only public keys.
  ensureParseInitialized()

  try {
    const query = new Parse.Query('_Session');
    query.equalTo('sessionToken', sessionToken);
    query.include('user');
    const session = await query.first({ useMasterKey: true });

    if (!session) {
      return null;
    }

    const user = session.get('user');
    if (!user) {
      return null;
    }

    // Parse rejects an expired session but keeps the row, and this lookup uses
    // the master key, so an expired token kept working here.
    const sessionExpiry = session.get('expiresAt');
    if (sessionExpiry instanceof Date && sessionExpiry.getTime() <= Date.now()) {
      return null;
    }

    // Cache the user data
    // Limit cache size to prevent memory issues
    if (sessionCache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entry (first entry in the Map)
      const firstKey = sessionCache.keys().next().value;
      sessionCache.delete(firstKey);
    }

    sessionCache.set(sessionToken, {
      user: user,
      expiresAt: Date.now() + CACHE_TTL
    });

    return user;
  } catch (error) {
    console.error('Error validating session token:', error);
    return null;
  }
}

/**
 * Throws 403 unless the request's `parse.session` cookie belongs to an admin.
 * For server routes that read or write other people's data with the master
 * key: who is asking is decided here, from the session, never from an id in
 * the request body.
 */
export async function requireAdmin(event: any): Promise<void> {
  const sessionToken = getCookie(event, 'parse.session')
  if (!sessionToken || !(await checkIsAdmin(sessionToken))) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }
}

export async function checkIsAdmin(parseSessionToken: string): Promise<boolean> {
  try {
    const user = await verifySession(parseSessionToken)
    if (!user) return false

    // console.log('[sessionCache - checkIsAdmin] user:', JSON.stringify(user))

    let role = user.get('role') as Parse.Object | undefined
    // console.log('role:', role)
    if (!role) return false

    if (!role.get('name')) {
      role = await role.fetch({ useMasterKey: true })
    }

    const roleName = role.get('name') as string | undefined
    console.log('roleName:', roleName)
    if (!roleName) return false

    return roleName === 'admin'
  } catch (error) {
    console.error('[checkIsAdmin] Error checking admin role: ', error)
    return false
  }
}

/**
 * Invalidate a specific session from the cache
 * Useful when logging out a user
 * @param {string} sessionToken - The session token to invalidate
 */
export function invalidateSession(sessionToken: string) {
  sessionCache.delete(sessionToken);
}

/**
 * Clear all cached sessions
 * Useful for debugging or emergency cache flush
 */
export function clearAllSessions() {
  sessionCache.clear();
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats including size and TTL
 */
export function getCacheStats(): { size: number; maxSize: number; ttl: number; entries: number } {
  return {
    size: sessionCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttl: CACHE_TTL,
    entries: sessionCache.size
  };
}
