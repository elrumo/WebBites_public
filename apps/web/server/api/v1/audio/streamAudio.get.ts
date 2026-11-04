export default defineEventHandler(async (event) => {
  // Expect the upstream endpoint as a query param
  const query = getQuery(event)
  const endpoint = typeof query.endpoint === 'string' ? query.endpoint : ''

  if (!endpoint) {
    throw createError({ statusCode: 400, message: 'Missing endpoint query parameter' })
  }

  // `endpoint` is only ever the stream URL the backend's getAudio just minted,
  // so it is pinned to the backend's own origin and path.
  //
  // Unpinned, this was an open proxy that attached the viewer's credential:
  // following a link to /api/v1/audio/streamAudio?endpoint=<anywhere> made the
  // server send that user's `wb_api_key` to a host of the attacker's choosing
  // (the cookie is SameSite=Lax, and this is a top-level GET), and the reply was
  // streamed back with the upstream Content-Type — so HTML came back from the
  // webbites.io origin, where the app's session lives in localStorage.
  const backendUrl = useRuntimeConfig().public.backendUrl as string
  let target: URL
  try {
    const base = new URL(backendUrl)
    target = new URL(endpoint, base)
    if (target.origin !== base.origin || !target.pathname.endsWith('/v1/audio/streamAudio')) {
      throw new Error('off-origin')
    }
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid endpoint' })
  }

  // Use API key from cookie (same as other server routes)
  const apiKey = getCookie(event, 'wb_api_key')
  if (!apiKey) {
    throw createError({ statusCode: 401, message: 'Not authenticated. Please login.' })
  }

  try {
    // Call upstream audio stream with auth and accept header
    // `target` was checked against the public address; the request itself goes by the in-network one.
    const upstreamUrl = new URL(`${target.pathname}${target.search}`, backendBaseUrl() || backendUrl)
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'audio/mpeg'
      }
    })

    if (!upstream.ok) {
      let errorData: any
      try { errorData = await upstream.json() } catch {}
      throw createError({
        statusCode: upstream.status,
        statusMessage: errorData?.message || errorData?.error || upstream.statusText || 'Audio stream request failed',
        message: errorData?.message || errorData?.error || upstream.statusText || 'Audio stream request failed',
        data: errorData
      })
    }

    // Audio only. Passing the upstream Content-Type through unchecked is what
    // let a response render as a document on our own origin.
    const upstreamType = upstream.headers.get('Content-Type') || ''
    setHeader(event, 'Content-Type', upstreamType.startsWith('audio/') ? upstreamType : 'audio/mpeg')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')

    const contentLength = upstream.headers.get('Content-Length')
    if (contentLength) setHeader(event, 'Content-Length', Number(contentLength))

    const contentDisposition = upstream.headers.get('Content-Disposition')
    if (contentDisposition) setHeader(event, 'Content-Disposition', contentDisposition)

    const cacheControl = upstream.headers.get('Cache-Control')
    if (cacheControl) setHeader(event, 'Cache-Control', cacheControl)

    // Stream the upstream body directly to the client
    return sendStream(event, upstream.body as any)
  } catch (error: any) {
    console.error('streamAudio proxy error:', error)
    // Keep `data` so the client can still see `errorType` (e.g. UsageError,
    // which drives the upgrade prompt rather than a generic failure).
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || error.message || 'Failed to stream audio',
      message: error.message || 'Failed to stream audio',
      data: error.data
    })
  }
})