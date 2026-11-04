// import { performance } from 'perf_hooks';
import Parse from 'parse/node';
import { verifySession } from '../utils/sessionCache'


export default defineEventHandler(async (event) => {
    try {
        let body = await readBody(event)
        let options = body.options;

        // Authenticate the caller and act on the session user — this endpoint
        // previously accepted any body-provided userId with no auth at all.
        const authHeader = getHeader(event, 'authorization')
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
        const sessionToken = getCookie(event, 'parse.session') || bearerToken
        const sessionUser = await verifySession(sessionToken)
        if (!sessionUser) {
            throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
        }
        if (body.userId && body.userId !== sessionUser.id) {
            throw createError({ statusCode: 403, statusMessage: 'userId does not match the authenticated user' })
        }
        const userId = sessionUser.id;
        // forceImport skips the access checks, so a user can't set it on themselves
        const { forceImport, ...safeOptions } = options || {};
        options = safeOptions;

        console.log('body: ', { userId: userId, ...options })

        const response = await $fetch(backendBaseUrl()+'v1/import/importBookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': internalAuthHeader(),
            },
            body: JSON.stringify({ userId: userId, ...options })
        });

        console.log("response: ", response)

        // The backend replies with its result directly (not wrapped in data)
        if (!response?.success) return { success: false, error: response?.error, data: response }

        return { success: true, data: response }
    } catch (error) {
        console.error("Error importing bookmarks: ", error);
        if (error.statusCode === 401 || error.statusCode === 403) throw error;
        return { success: false, error: error.message }
    }
})
