import { log } from '../../utils/useDevLog'
import { ensureApiKeyCookie } from '../../utils/apiKeys'

/**
 * Makes sure the browser holds a working backend API key in the HttpOnly
 * `wb_api_key` cookie, generating one if needed.
 *
 * The key itself is not in the response. It used to be (`{ key, ... }`), which
 * undid the HttpOnly flag: any script on the page could read it from this
 * response. Nothing in the app needs the raw value — useAuth only checks that
 * a key exists, and the server-side retry in server/utils/backendFetch.ts calls
 * ensureApiKeyCookie directly.
 */
export default defineEventHandler(async (event) => {
    try {
        const sessionToken = getCookie(event, 'parse.session')

        if (!sessionToken) {
            log('[generateKey] No session cookie found')
            return { error: 'No session token', success: false }
        }

        const { info, reused } = await ensureApiKeyCookie(event, sessionToken)
        log('[generateKey]', reused ? 'existing API key is valid' : 'new API key generated')

        return { ...(info || {}), success: true }
    } catch (error) {
        console.error('Error in generateKey endpoint:', error instanceof Error ? error.message : error)
        return {
            error: error instanceof Error ? error.message : String(error),
            success: false
        }
    }
})
