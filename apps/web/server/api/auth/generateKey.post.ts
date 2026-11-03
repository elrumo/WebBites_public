import { log } from '../../utils/useDevLog'


export default defineEventHandler(async (event) => {
    try {
        const sessionToken = getCookie(event, 'parse.session')
        if (process.dev) log('sessionToken:', sessionToken)

        if (!sessionToken) {
            log('No session cookie found')
            return { error: 'No session token', success: false }
        }

        // Check if API key already exists
        const existingApiKey = getCookie(event, 'wb_api_key')
        log('🔍 Checking for existing API key cookie:', existingApiKey ? '✓ Found' : '✗ Not found')

        if (existingApiKey) {
            // Quick validation: try a lightweight backend call to verify the key
            log('🔍 Validating existing API key...')
            const isValid = await validateApiKey(existingApiKey, event)

            if (isValid) {
                log('✅ API key is valid, returning existing key')
                // setCookie(event, 'wb_api_key', apiKeyData.key, cookieOptions)
                return { key: existingApiKey, success: true }
            } else {
                log('⚠️ Existing API key is invalid or expired, generating new one...')
                deleteCookie(event, 'wb_api_key')
            }
        }

        // Generate new API key
        log('🔑 Generating new API key...')
        const apiKeyData = await generateApiKey(sessionToken)

        if (!apiKeyData || !apiKeyData.key) {
            throw new Error('Failed to generate API key')
        }

        setApiKeyCookie(event, apiKeyData.key)

        // Verify the cookie was set
        const verifySet = getCookie(event, 'wb_api_key')
        log('🔍 Verification - Cookie immediately after setting:', verifySet ? '✓ Present' : '✗ Missing')

        return { ...apiKeyData, success: true }

    } catch (error) {
        console.error('Error in generateKey endpoint:', error)
        return {
            error: error instanceof Error ? error.message : String(error),
            success: false
        }
    }
})

async function validateApiKey(apiKey: string, event?: any): Promise<boolean> {
    try {
        // Make a lightweight request to validate the API key
        // Using a simple endpoint that should return quickly
        const timeoutMs = 3000 // 3 seconds timeout for validation

        // Use runtime config for server-side instead of import.meta.env
        const config = useRuntimeConfig()
        const backendUrl = backendBaseUrl()

        const fetchWithTimeout = Promise.race([
            fetch(`${backendUrl}v1/auth/validateApiKey`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            }),
            new Promise<Response>((_, reject) =>
                setTimeout(() => reject(new Error('Validation timeout')), timeoutMs)
            )
        ])

        const result = await fetchWithTimeout;

        console.log('[generateKey] 🔍 Validation response status:', result.status)
        const ok = result.ok
        if (ok && event) {
            setApiKeyCookie(event, apiKey)
        }
        return ok
    } catch (error) {
        console.error('[generateKey] Error validating API key:', error)
        // On error or timeout, assume invalid to trigger regeneration
        return false
    }
}

function setApiKeyCookie(event: any, apiKey: string) {
    const cookieOptions = {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: 'lax' as const,
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/'
    }
    setCookie(event, 'wb_api_key', apiKey, cookieOptions)
}

async function generateApiKey(sessionToken: string) {
    try {
        // Add timeout to prevent Vercel function timeout on backend cold starts
        const timeoutMs = 8000 // 8 seconds (leave 2s buffer for Vercel's 10s timeout)

        // Use runtime config for server-side instead of import.meta.env
        const config = useRuntimeConfig()
        const backendUrl = backendBaseUrl()
        const fullUrl = `${backendUrl}v1/auth/generate-api-key`

        console.log('[generateKey] 🌐 Backend URL:', backendUrl)
        console.log('[generateKey] 📍 Full URL:', fullUrl)
        // Length only. A Parse session token is a bearer credential for the
        // whole account, so no part of it belongs in the logs.
        console.log('[generateKey] 🔑 sessionToken length:', sessionToken?.length || 0)

        const fetchWithTimeout = Promise.race([
            fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                }
            }),
            new Promise<Response>((_, reject) =>
                setTimeout(() => reject(new Error('Backend request timeout - backend may be cold starting')), timeoutMs)
            )
        ])

        const result = await fetchWithTimeout

        if (!result.ok) {
            console.error('[generateKey] ❌ Request failed')
            console.error('[generateKey] 📍 URL:', fullUrl)
            console.error('[generateKey] 📊 Status:', result.status, result.statusText)
            console.error('[generateKey] 📋 Response headers:', Object.fromEntries(result.headers.entries()))

            // Try to read error body
            try {
                const errorText = await result.text()
                console.error('[generateKey] 📄 Error body:', errorText)
            } catch (e) {
                console.error('[generateKey] Could not read error body')
            }

            throw new Error(`HTTP error! status: ${result.status}`)
        }

        const data = await result.json()
        log('data', data.apiKeyData)

        return data.apiKeyData
    } catch (error) {
        console.error('Error generating API key:', error)
        throw error
    }
}
