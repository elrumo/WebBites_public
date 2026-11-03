import Parse from 'parse/node';
import { checkIsAdmin } from '../../utils/sessionCache'
import { ensureParseInitialized } from '../../utils/parseRuntime'

export default defineEventHandler(async (event) => {
    ensureParseInitialized()
    try {
        const cookies = parseCookies(event)
        const sessionToken = cookies['parse.session']
        
        if (!sessionToken) throw new Error("No session token provided")
        
        const isAdminUser = await checkIsAdmin(sessionToken)

        console.log('isAdminUser:', isAdminUser)

        if (!isAdminUser) throw new Error("User is not an admin")

        return { isAdmin: isAdminUser }
    } catch (error) {
        console.error("[isAdmin] Error checking admin role: ", error)
        return { isAdmin: false }
    }
})
