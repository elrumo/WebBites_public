/**
 * Client-side writes of the `parse.session` cookie.
 *
 * The server sets it in server/api/auth/login.post.ts as Secure,
 * SameSite=Strict, one year. A bare `document.cookie = 'parse.session=…; path=/'`
 * replaced that cookie with one that had neither attribute and lasted only for
 * the browser session, so every write from the page goes through here and
 * carries the same attributes. `Secure` only over https, so `nuxt dev` on
 * http://localhost keeps working (a Secure cookie set from http is dropped).
 */

/** Matches `maxAge` in server/api/auth/login.post.ts and signup.post.ts. */
export const SESSION_COOKIE_MAX_AGE = 31536000 // 1 year, in seconds

function sessionCookieAttributes(maxAge: number): string {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  return `; path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`
}

export function writeSessionCookie(sessionToken: string): void {
  if (typeof document === 'undefined' || !sessionToken) return
  // Written as-is, the way the page always wrote it: a session token is
  // `r:` and hex, all valid cookie characters, and the browser extension may
  // read the raw value.
  document.cookie = `parse.session=${sessionToken}${sessionCookieAttributes(SESSION_COOKIE_MAX_AGE)}`
}

export function clearSessionCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `parse.session=${sessionCookieAttributes(0)}`
}
