import { joinURL } from 'ufo'
import { checkIsAdmin } from '../../utils/sessionCache'

// The admin page's Search index tab → the backend's internal-only
// /v1/sync/meilisearch. GET is the latest run; POST `{ dryRun, oneWay?, user?, resume? }`
// starts one (only an explicit `dryRun: false` writes anything); DELETE stops it.
export default defineEventHandler(async (event) => {
    if (!['GET', 'POST', 'DELETE'].includes(event.method)) {
        throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
    }
    const sessionToken = parseCookies(event)['parse.session']
    if (!sessionToken || !(await checkIsAdmin(sessionToken))) {
        throw createError({ statusCode: 403, statusMessage: 'Admins only' })
    }

    let body
    if (event.method === 'POST') {
        const input = await readBody(event)
        body = {
            dryRun: input?.dryRun !== false,
            ...(typeof input?.user === 'string' && input.user.trim() ? { user: input.user.trim() } : {}),
            ...(input?.resume === true ? { resume: true } : {}),
            ...(input?.oneWay === true ? { oneWay: true } : {}),
        }
    }
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
