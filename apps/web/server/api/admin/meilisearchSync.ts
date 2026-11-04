import { joinURL } from 'ufo'
import { checkIsAdmin } from '../../utils/sessionCache'

// The admin page's Search index tab → the backend's internal-only
// /v1/sync/meilisearch. GET is the latest run; POST `{ dryRun }` starts one,
// and only an explicit `dryRun: false` writes anything.
export default defineEventHandler(async (event) => {
    if (event.method !== 'GET' && event.method !== 'POST') {
        throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
    }
    const sessionToken = parseCookies(event)['parse.session']
    if (!sessionToken || !(await checkIsAdmin(sessionToken))) {
        throw createError({ statusCode: 403, statusMessage: 'Admins only' })
    }

    const body = event.method === 'POST' ? { dryRun: (await readBody(event))?.dryRun !== false } : undefined
    try {
        return await $fetch(joinURL(backendBaseUrl(), 'v1/sync/meilisearch'), {
            method: event.method,
            headers: { Authorization: internalAuthHeader() },
            body,
        })
    } catch (error: any) {
        throw createError({
            statusCode: error?.statusCode || 502,
            statusMessage: error?.data?.statusMessage || error?.message || 'Backend request failed',
        })
    }
})
