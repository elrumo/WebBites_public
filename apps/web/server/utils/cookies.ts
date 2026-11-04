/**
 * Whether the session cookies get the `Secure` flag.
 *
 * Always, except on a plain-http install reached by something other than localhost (a home server
 * on a LAN address, say): browsers drop `Secure` cookies there, so nobody could stay signed in.
 * HTTPS is the supported way to run WebBites; this only keeps the http case usable.
 */
export function cookieSecure(): boolean {
  if (import.meta.dev) return false
  const appUrl = String(useRuntimeConfig().public.appUrl || '')
  return !/^http:\/\/(?!localhost(?::|\/|$)|127\.0\.0\.1(?::|\/|$)|\[::1\])/i.test(appUrl)
}
