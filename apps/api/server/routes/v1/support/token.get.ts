/**
 * Identity token for HelpBites (the help chat).
 *
 * The chat runs on a separate service; it trusts this app to say who the user
 * is. We sign a short-lived HS256 JWT with the project secret, the widget sends
 * it as a bearer, and the user never creates a second account. See
 * helpbites/docs/CONNECTING.md.
 */

import { createHmac } from 'node:crypto'
import { defineEventHandler, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireUserId } from '#root/server/utils/requireUser'

defineRouteMeta({
  openAPI: {
    tags: ['Support'],
    summary: 'Identity token for the help chat',
    description: 'Short-lived token the HelpBites widget uses to identify the signed-in user. Bearer: Parse session or API key.',
    responses: { 200: { description: '{ token, expiresAt }' }, 401: { description: 'Not signed in' }, 503: { description: 'Help chat not configured' } }
  }
})

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const publicKey = process.env.HELPBITES_PUBLIC_KEY
  const secret = process.env.HELPBITES_PRIVATE_KEY
  if (!publicKey || !secret) throw createError({ statusCode: 503, statusMessage: 'Help chat is not configured' })

  if (!Parse.applicationId) {
    Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
    Parse.serverURL = process.env.VITE_PARSE_URL as string
  }
  const user = await new Parse.Query(Parse.User).select('name', 'username', 'email').get(userId, { useMasterKey: true })

  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: publicKey, sub: userId, name: user.get('name') || user.get('username') || '', email: user.get('email') || '', iat: now, exp })
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')

  return { token: `${head}.${body}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() }
})
