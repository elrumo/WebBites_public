import Parse from 'parse/node.js'
import { importPKCS8, SignJWT } from 'jose'

/**
 * Sign in with Apple token revocation (App Review 5.1.1(v): an app offering
 * Sign in with Apple revokes the user's tokens when the account is deleted).
 *
 * Apple only revokes a token it issued, so the authorization code every
 * sign-in already sends is exchanged for a refresh token straight away (codes
 * last five minutes and work once) and parked in `AppleToken`, master-key
 * only. Account deletion revokes and removes those rows.
 *
 * Needs APPLE_SIWA_TEAM_ID, APPLE_SIWA_KEY_ID and APPLE_SIWA_PRIVATE_KEY (a
 * Sign in with Apple .p8 key on the primary App ID, io.webbites.app — the web
 * Services ID is grouped under it, so one key signs for both). Without them
 * every step is skipped and sign-in works as before.
 *
 * ponytail: accounts that signed in with Apple before this shipped have no
 * stored token and nothing to revoke — Apple drops the link after a while on
 * its own. Re-auth-at-delete is the upgrade if review ever insists.
 */

const APPLE = 'https://appleid.apple.com'
const CLASS_NAME = 'AppleToken'

function siwaKeyConfigured(): boolean {
  return Boolean(process.env.APPLE_SIWA_TEAM_ID && process.env.APPLE_SIWA_KEY_ID && process.env.APPLE_SIWA_PRIVATE_KEY)
}

/** The ES256 client secret Apple's token endpoints take instead of a password. */
export async function appleClientSecret(clientId: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  // Dokploy env vars often carry the .p8 on one line with literal "\n".
  const pem = String(process.env.APPLE_SIWA_PRIVATE_KEY).replace(/\\n/g, '\n')
  const key = await importPKCS8(pem, 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_SIWA_KEY_ID })
    .setIssuer(process.env.APPLE_SIWA_TEAM_ID as string)
    .setSubject(clientId)
    .setAudience(APPLE)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key)
}

async function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(APPLE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(10_000),
  })
}

/**
 * Exchanges a sign-in's authorization code and keeps the refresh token.
 * `clientId` is the identity token's `aud` — the code was issued to the same
 * client. Never throws: a failure here must not fail the sign-in.
 */
export async function storeAppleRefreshToken(user: Parse.User, code: string | undefined, clientId: string): Promise<void> {
  if (!code || !siwaKeyConfigured()) return
  try {
    const response = await postForm('/auth/token', {
      client_id: clientId,
      client_secret: await appleClientSecret(clientId),
      code,
      grant_type: 'authorization_code',
    })
    const json: any = await response.json().catch(() => ({}))
    if (!response.ok || !json.refresh_token) {
      console.error(`[appleTokens] Code exchange failed for ${user.id}: HTTP ${response.status} ${json.error ?? ''}`)
      return
    }

    const query = new Parse.Query(CLASS_NAME)
    query.equalTo('user', user)
    query.equalTo('clientId', clientId)
    const row = (await query.first({ useMasterKey: true })) ?? new Parse.Object(CLASS_NAME)
    row.set('user', user)
    row.set('clientId', clientId)
    row.set('refreshToken', json.refresh_token)
    row.setACL(new Parse.ACL())
    await row.save(null, { useMasterKey: true })
  } catch (error) {
    console.error(`[appleTokens] Could not store the Apple refresh token for ${user.id}:`, error)
  }
}

/**
 * Revokes every stored token for a user and removes the rows. Returns how many
 * were revoked. A token Apple refuses is still removed: the account is going
 * either way, and a stale row would only fail again.
 */
export async function revokeAppleTokens(user: Parse.Object): Promise<number> {
  const query = new Parse.Query(CLASS_NAME)
  query.equalTo('user', user)
  query.limit(100)
  const rows = await query.find({ useMasterKey: true })
  if (!rows.length) return 0

  let revoked = 0
  if (siwaKeyConfigured()) {
    for (const row of rows) {
      const clientId = row.get('clientId')
      const response = await postForm('/auth/revoke', {
        client_id: clientId,
        client_secret: await appleClientSecret(clientId),
        token: row.get('refreshToken'),
        token_type_hint: 'refresh_token',
      }).catch((error) => {
        console.error(`[appleTokens] Revoke request failed for ${user.id}:`, error)
        return null
      })
      if (response?.ok) revoked++
      else if (response) console.error(`[appleTokens] Apple refused a revoke for ${user.id}: HTTP ${response.status}`)
    }
  }
  await Parse.Object.destroyAll(rows, { useMasterKey: true })
  return revoked
}
