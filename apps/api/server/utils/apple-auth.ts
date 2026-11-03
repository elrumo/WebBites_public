import { randomBytes } from 'node:crypto'
import Parse from 'parse/node.js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getFreePlanPointer } from './plans'

export interface AppleAuthData {
  id_token: string
  code?: string
  user?: string | {
    name?: {
      firstName?: string
      lastName?: string
    }
    email?: string
  }
}

export class AppleAuthError extends Error {
  code: string
  statusCode: number

  constructor(message: string, code: string, statusCode: number = 401) {
    super(message)
    this.name = 'AppleAuthError'
    this.code = code
    this.statusCode = statusCode
  }
}

interface AppleJWTPayload {
  sub: string // Unique Apple user ID
  email?: string
  email_verified?: boolean
  is_private_email?: boolean
  iss: string
  aud: string
  exp: number
  iat: number
}

const APPLE_ISSUER = 'https://appleid.apple.com'

/**
 * Apple's public signing keys. `createRemoteJWKSet` fetches them on first use
 * and caches them, re-fetching only when a token names a `kid` it has not seen —
 * which is what Apple's key rotation looks like from here.
 */
const APPLE_JWKS = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`))

/**
 * Every client id an identity token may be issued to: the web Services ID and
 * the native bundle id, since iOS mints tokens with `aud` set to the bundle id.
 *
 * Defaults to both rather than to the web id alone — a missing env var must not
 * silently kill "Continue with Apple" on the phone again.
 */
export function appleAudiences(): string[] {
  return (process.env.APPLE_CLIENT_IDS || 'io.webbites.web,io.webbites.app')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * Verify an Apple identity token and return its claims.
 *
 * The signature is checked against Apple's published keys. It used to be
 * base64-decoded and trusted, which meant a forged payload carrying the right
 * `iss`/`aud`/`exp` signed you in as any Apple user.
 */
export async function verifyAppleToken(id_token: string): Promise<AppleJWTPayload> {
  if (!id_token || id_token.split('.').length !== 3) {
    throw new AppleAuthError('Invalid JWT token format', 'INVALID_TOKEN_FORMAT', 400)
  }

  try {
    const { payload } = await jwtVerify(id_token, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: appleAudiences(),
    })
    return payload as unknown as AppleJWTPayload
  } catch (error: any) {
    // jose reports the specific failure in `code`; map the three a client can
    // act on and treat everything else as an unverifiable token.
    switch (error?.code) {
      case 'ERR_JWT_EXPIRED':
        throw new AppleAuthError('Token has expired', 'TOKEN_EXPIRED', 401)
      case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
        throw new AppleAuthError(
          error.claim === 'iss' ? 'Invalid token issuer' : 'Invalid token audience',
          error.claim === 'iss' ? 'INVALID_ISSUER' : 'INVALID_AUDIENCE',
          401
        )
      default:
        console.error('[appleAuth] Identity token verification failed:', error)
        throw new AppleAuthError('Could not verify the Apple identity token', 'INVALID_TOKEN', 401)
    }
  }
}

type AppleUserProfile = Exclude<AppleAuthData['user'], string | undefined>

/**
 * The `user` object Apple sends on the *first* authorization only.
 *
 * The native client posts it as an object; Apple's `form_post` flow on the web
 * hands it over as a JSON string, which used to fall straight through the
 * `typeof user === 'object'` checks below and silently drop the person's name.
 */
export function appleUserProfile(user: AppleAuthData['user']): AppleUserProfile | undefined {
  if (!user) return undefined
  if (typeof user !== 'string') return user
  try {
    return JSON.parse(user)
  } catch {
    return undefined
  }
}

/**
 * Extracts a username from Apple auth data
 * @param user The user object from Apple (only sent on first sign-in)
 * @param email The email from the JWT payload
 * @param appleUserId The Apple user ID
 * @returns A suitable username
 */
export function extractUsername(
  rawUser: AppleAuthData['user'],
  email?: string,
  appleUserId?: string
): string {
  const user = appleUserProfile(rawUser)

  // If user object exists with name
  if (user?.name) {
    const { firstName, lastName } = user.name
    if (firstName && lastName) {
      return `${firstName} ${lastName}`
    }
    if (firstName) {
      return firstName
    }
  }

  // If user object exists with email
  if (user?.email) {
    return user.email.split('@')[0]
  }

  // Fallback to email
  if (email) {
    return email.split('@')[0]
  }

  // Final fallback to Apple ID
  if (appleUserId) {
    return `apple_user_${appleUserId.substring(0, 8)}`
  }

  return 'apple_user'
}

export interface AppleAuthResult {
  user: Parse.User
  /**
   * The minted Parse session token. Returned rather than stashed on the user,
   * because `user.getSessionToken()` reads the `sessionToken` *attribute* and a
   * master-key save never sets one — which is why the route used to answer an
   * Apple sign-in with no token at all.
   */
  sessionToken: string
  isNewUser: boolean
}

/**
 * Handles Apple authentication - finds or creates a user
 * @param appleAuth The Apple authentication data
 * @returns The Parse user, a session token for it, and whether it was just created
 */
export async function handleAppleAuth(appleAuth: AppleAuthData): Promise<AppleAuthResult> {
  // Verify the identity token against Apple's public keys
  const payload = await verifyAppleToken(appleAuth.id_token)

  const appleUserId = payload.sub
  // Only the signed claim, never the client-supplied `user.email`: this email
  // links the Apple ID onto an existing account below, so trusting the body
  // would let anyone with any Apple ID sign in as any email. Apple sends
  // `email_verified` as a boolean or the string "true".
  const email = String(payload.email_verified) === 'true' ? payload.email : undefined

  console.log('[handleAppleAuth] Apple user ID:', appleUserId)
  console.log('[handleAppleAuth] Email:', email)

  // Query for existing user with this Apple ID
  const userQuery = new Parse.Query(Parse.User)
  userQuery.equalTo('authData.apple.id', appleUserId)

  let user: Parse.User | undefined

  try {
    user = await userQuery.first({ useMasterKey: true })
  } catch (error) {
    console.error('[handleAppleAuth] Error querying for user:', error)
  }

  if (user) {
    // Existing user with Apple auth - update the token
    console.log('[handleAppleAuth] Found existing user with Apple auth:', user.id)

    // Update the auth token
    user.set('authData', {
      apple: {
        id: appleUserId,
        token: appleAuth.id_token
      }
    })

    await user.save(null, { useMasterKey: true })

    return { user, sessionToken: await createSessionToken(user), isNewUser: false }
  }

  // An account already holds this email, but it has no Apple ID on it.
  //
  // This used to link Apple onto that account and hand back a session for it,
  // on the strength of the email alone. Anyone can register any address here —
  // signup is open and Parse is not configured to verify addresses — so someone
  // could create an account under a victim's email in advance, wait for the
  // victim to "Continue with Apple", and end up sharing the account with them,
  // keeping password access to everything the victim went on to save.
  //
  // Apple proving the *email* is not proof that the person owns the *account*
  // that happens to carry it. So linking now needs one of the two:
  //   - the existing account's address was verified (emailVerified), or
  //   - the user signs in to it with their password first, which is what the
  //     409 below asks them to do.
  if (email) {
    let existingUserByEmail: Parse.User | undefined
    try {
      const emailQuery = new Parse.Query(Parse.User)
      emailQuery.equalTo('email', email)
      existingUserByEmail = await emailQuery.first({ useMasterKey: true })
    } catch (error) {
      console.error('[handleAppleAuth] Error querying for user by email:', error)
    }

    if (existingUserByEmail) {
      if (existingUserByEmail.get('emailVerified') !== true) {
        console.log('[handleAppleAuth] Refusing to link Apple to an unverified account:', existingUserByEmail.id)
        throw new AppleAuthError(
          'An account already exists for this email address. Please sign in with your email and password to link Sign in with Apple.',
          'ACCOUNT_ALREADY_EXISTS',
          409
        )
      }

      console.log('[handleAppleAuth] Found existing verified user by email, linking Apple auth:', existingUserByEmail.id)

      const existingAuthData = existingUserByEmail.get('authData') || {}
      existingUserByEmail.set('authData', {
        ...existingAuthData,
        apple: {
          id: appleUserId,
          token: appleAuth.id_token
        }
      })

      await existingUserByEmail.save(null, { useMasterKey: true })

      return {
        user: existingUserByEmail,
        sessionToken: await createSessionToken(existingUserByEmail),
        isNewUser: false,
      }
    }
  }

  // New user - create account
  console.log('[handleAppleAuth] Creating new user for Apple ID:', appleUserId)

  const username = extractUsername(appleAuth.user, email, appleUserId)

  const newUser = new Parse.User()
  newUser.set('username', username)
  newUser.set('email', email)

  // Set auth data for Apple Sign In
  newUser.set('authData', {
    apple: {
      id: appleUserId,
      token: appleAuth.id_token
    }
  })

  // Set default plan. Looked up rather than hard-coded so the free plan's
  // objectId lives in exactly one place — see utils/plans.ts.
  const freePlan = await getFreePlanPointer()
  if (freePlan) newUser.set('currentPlan', freePlan)

  try {
    // Save the user
    await newUser.save(null, { useMasterKey: true })

    console.log('[handleAppleAuth] Created new user:', newUser.id)

    return { user: newUser, sessionToken: await createSessionToken(newUser), isNewUser: true }
  } catch (error: any) {
    // If we get a duplicate error (code 203), it might be a race condition or duplicate email/username
    if (error.code === 203) {
      console.error('[handleAppleAuth] Account already exists error:', error.message)
      throw new AppleAuthError(
        'An account already exists for this email address. Please try signing in with email/password instead.',
        'ACCOUNT_ALREADY_EXISTS',
        409
      )
    }

    // Re-throw AppleAuthError instances
    if (error instanceof AppleAuthError) {
      throw error
    }

    // Wrap other errors
    throw new AppleAuthError(
      error.message || 'Failed to create user account',
      'USER_CREATION_FAILED',
      500
    )
  }
}

/**
 * Mints a fresh session for each sign-in. Reusing whatever `_Session` row the
 * user already had handed back expired tokens, and tied every device to one
 * session so logging out on one signed out the rest.
 *
 * Goes through the REST controller rather than `Parse.Session`: the SDK marks
 * `user`, `sessionToken` and `expiresAt` read-only on that class and throws on
 * `set`, and a master-key create without a token yields a token-less row, so
 * the token is generated here in Parse Server's own `r:<32 hex>` format.
 */
async function createSessionToken(user: Parse.User): Promise<string> {
  const sessionToken = `r:${randomBytes(16).toString('hex')}`
  await Parse.CoreManager.getRESTController().request(
    'POST',
    'classes/_Session',
    {
      user: user.toPointer(),
      sessionToken,
      restricted: false,
      createdWith: { action: 'login', authProvider: 'apple' },
      expiresAt: { __type: 'Date', iso: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }, // 1 year
    },
    { useMasterKey: true }
  )
  return sessionToken
}
