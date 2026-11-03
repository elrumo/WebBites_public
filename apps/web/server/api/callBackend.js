import { joinURL } from 'ufo'
import { getHeader, parseCookies, readBody, readMultipartFormData } from 'h3'
import { verifySession } from '../utils/sessionCache'

// This proxy attaches the internal backend credential, which lets the backend
// trust whatever userId it's given. So it only forwards known endpoints, and
// for user endpoints it replaces the userId with the caller's session user.
const PUBLIC_ENDPOINTS = new Set(['signupuser'])
const USER_ENDPOINTS = new Set([
  'validateimportaccess',
  'v1/import/cancelimport',
  'saveuserimage',
  'saveuserpdf',
  'saveuseraudio',
])

function normaliseEndpoint(endpoint) {
  return String(endpoint || '').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()
}

function getSessionToken(event, cookies) {
  const header = getHeader(event, 'x-parse-session-token')
  if (header) return header
  const auth = getHeader(event, 'authorization')
  if (auth?.startsWith('Bearer r:')) return auth.substring(7)
  return cookies?.['parse.session'] || null
}

export default defineEventHandler(async (event) => {
  try {
    const cookies = parseCookies(event)
    const contentType = getHeader(event, 'content-type') || ''

    let endpoint
    let data

    if (contentType.includes('multipart/form-data')) {
      const parts = (await readMultipartFormData(event)) || []
      const parsed = multipartToEndpointAndFormData(parts)
      endpoint = parsed.endpoint
      data = parsed.formData
    } else {
      const body = await readBody(event)
      endpoint = body?.endpoint
      data = body?.data
    }

    const key = normaliseEndpoint(endpoint)

    if (USER_ENDPOINTS.has(key)) {
      const sessionToken = getSessionToken(event, cookies)
      const sessionUser = sessionToken ? await verifySession(sessionToken) : null
      if (!sessionUser) {
        return { success: false, error: 'Not authenticated' }
      }

      // Act as the session user whatever userId the client sent
      if (typeof FormData !== 'undefined' && data instanceof FormData) {
        data.set('userId', sessionUser.id)
      } else {
        data = { ...(data || {}), userId: sessionUser.id, sessionToken }
      }
    } else if (!PUBLIC_ENDPOINTS.has(key)) {
      return { success: false, error: 'Endpoint not allowed' }
    }

    return await callBackend(endpoint, data, cookies)
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
})

function multipartToEndpointAndFormData(parts) {
  const formData = new FormData()
  let endpoint = ''

  for (const part of parts) {
    if (!part?.name) continue

    if (part.name === 'endpoint') {
      endpoint = Buffer.isBuffer(part.data) ? part.data.toString('utf8') : String(part.data)
      continue
    }

    if (part.filename) {
      const blob = new Blob([part.data], { type: part.type || 'application/octet-stream' })
      formData.append(part.name, blob, part.filename)
      continue
    }

    const value = Buffer.isBuffer(part.data) ? part.data.toString('utf8') : String(part.data)
    formData.append(part.name, value)
  }

  return { endpoint, formData }
}

async function callBackend(endpoint, data, cookies) {
  try {
    const config = useRuntimeConfig()

    const cookieHeader =
      cookies && Object.keys(cookies).length
        ? Object.entries(cookies)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('; ')
        : ''

    // This proxy has already verified the caller's session and overwritten
    // `data.userId` with the session's own user, so it is safe for it to speak
    // to the backend as an internal caller.
    const headers = {
      Authorization: internalAuthHeader()
    }

    const isFormData = typeof FormData !== 'undefined' && data instanceof FormData
    if (!isFormData) headers['Content-Type'] = 'application/json'
    if (cookieHeader) headers.Cookie = cookieHeader

    const baseUrl = backendBaseUrl()
    const url = joinURL(baseUrl, endpoint || '')

    const response = await $fetch(url, {
      method: 'post',
      headers,
      body: data
    })

    return { success: true, data: response }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
}
