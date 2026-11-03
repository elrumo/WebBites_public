import { checkIsAdmin, verifySession } from '../../utils/sessionCache'

/**
 * Identity token for HelpBites: the chat widget and the feedback board.
 *
 * The chat and the board run on a separate service (support-bites) that trusts
 * this app to say who the signed-in user is: we sign a short-lived HS256 JWT
 * with the shared project secret, the client sends it as a bearer, and the user
 * never creates a second account. Admins also get `role: 'admin'`, which lets
 * them moderate the feedback board. Minted here — the Nuxt server already knows
 * the user from their Parse session — rather than round-tripping to the Parse
 * backend.
 */

export default defineEventHandler(async (event) => {
  // sessionHeader() on the client sends the token; the cookie is the fallback.
  const sessionToken = getHeader(event, 'x-parse-session-token') || getCookie(event, 'parse.session') || ''
  const user = sessionToken ? await verifySession(sessionToken) : null
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })

  const isAdmin = await checkIsAdmin(sessionToken)
  return mintHelpbitesToken({
    sub: user.id,
    name: user.get('name') || user.get('username') || '',
    email: user.get('email') || '',
    ...(isAdmin ? { role: 'admin' as const } : {})
  })
})
