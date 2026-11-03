export default defineEventHandler(async (event) => {
  // Apple sends the authorization response as form POST
  const body = await readBody(event)

  const { code, id_token, state, user } = body

  // `body` holds Apple's `code` and `id_token`, both of which are credentials,
  // so only the shape of the callback is logged.
  console.log('Apple callback received:', {
    hasCode: Boolean(code),
    hasIdToken: Boolean(id_token),
    hasState: Boolean(state),
    hasUser: Boolean(user),
  })

  // Build the redirect URL with the data as query parameters
  // so the Vue page can process it
  const params = new URLSearchParams()

  if (code) params.append('code', code)
  if (id_token) params.append('id_token', id_token)
  if (state) params.append('state', state)
  if (user) params.append('user', user)

  // Redirect to the client-side page with the data
  return sendRedirect(event, `/auth/apple/callback?${params.toString()}`, 302)
})
