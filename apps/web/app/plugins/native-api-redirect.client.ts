/**
 * Redirects all $fetch('/api/...') calls to the Nuxt server when running
 * inside Electrobun. Without this, those requests would hit the Bun dev
 * server (which only serves the UI) and return 404/500.
 *
 * Set NUXT_PUBLIC_APP_URL in .env to point to the Nuxt server:
 *   Dev:  NUXT_PUBLIC_APP_URL=http://localhost:3004
 *   Prod: not needed (WKWebView loads from the deployed Nuxt server)
 */
export default defineNuxtPlugin({
  name: 'native-api-redirect',
  enforce: 'pre',
  setup() {
    const { isNative } = usePlatform()
    if (!isNative) return

    const appUrl = useRuntimeConfig().public.appUrl as string | undefined
    if (!appUrl) return

    const baseUrl = appUrl.replace(/\/$/, '')

    // Replace the global $fetch with one that reroutes /api/ calls
    globalThis.$fetch = globalThis.$fetch.create({
      onRequest({ request, options }) {
        if (typeof request === 'string' && request.startsWith('/api/')) {
          options.baseURL = baseUrl
        }
      }
    })
  }
})
