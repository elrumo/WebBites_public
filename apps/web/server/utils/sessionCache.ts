import Parse from 'parse/node';
import { ensureParseInitialized } from './parseRuntime'

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
  if (!sessionToken) {
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
