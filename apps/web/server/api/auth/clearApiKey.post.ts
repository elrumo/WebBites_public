export default defineEventHandler(async (event) => {
    try {
        // Clear the API key cookie
        setCookie(event, 'wb_api_key', '', {
            maxAge: 0,
            path: '/',
            httpOnly: true
        })

        console.log('🔑 API key cookie cleared')

        return { success: true }
    } catch (error) {
        console.error('Error clearing API key:', error)
        return {
            error: error instanceof Error ? error.message : String(error),
            success: false
        }
    }
})
