/**
 * Self-hosted installs have no marketing site: the landing page, pricing, FAQ and the
 * WebBites.io terms and privacy policy describe the hosted service, not this server.
 * Visitors go straight to the app (and from there to sign in).
 *
 * SELF_HOSTED defaults to on; the hosted service builds with it off.
 */
const HOSTED_ONLY_PAGES = new Set(['/', '/faq', '/tos', '/privacy', '/help', '/support', '/changes', '/feedback'])

export default defineNuxtRouteMiddleware((to) => {
  if (!useRuntimeConfig().public.selfHosted) return

  const path = to.path.replace(/\/+$/, '') || '/'
  if (!HOSTED_ONLY_PAGES.has(path)) return

  // Signed-out visitors land on /login; the auth middleware sends signed-in ones on to /app.
  const signedIn = Boolean(useCookie('parse.session').value)
  return navigateTo(signedIn ? '/app' : '/login', { replace: true })
})
