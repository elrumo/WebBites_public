import { createHmac } from 'node:crypto'
import { createError } from 'h3'

/**
 * HelpBites (support-bites) runs support chat and the feedback board for this
 * app. It trusts us to say who a user is: we sign short-lived HS256 identity
 * tokens with the project secret. `role: 'admin'` marks one of our own staff,
 * which lets them moderate the feedback board (statuses, visibility,
 * changelog) straight from our custom UI.
 */

export function helpbitesSettings() {
  const config = useRuntimeConfig()
  return {
    host: String(config.public.helpbitesApiUrl || '').replace(/\/+$/, ''),
    publicKey: String(config.public.helpbitesPublicKey || ''),
    secret: String(config.helpbitesPrivateKey || '')
  }
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export type HelpbitesClaims = { sub: string, name?: string, email?: string, role?: 'admin' }

export function mintHelpbitesToken(claims: HelpbitesClaims, ttlSeconds = 3600): { token: string, expiresAt: string } {
  const { publicKey, secret } = helpbitesSettings()
  if (!publicKey || !secret) throw createError({ statusCode: 503, statusMessage: 'HelpBites is not configured' })
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttlSeconds
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: publicKey, ...claims, iat: now, exp })
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return { token: `${head}.${body}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() }
}

/**
 * Server-to-server call. `auth` is a minted identity token, or 'secret' for the
 * project-secret routes (import, erase); omit it for public reads, which carry
 * the public key instead.
 */
export async function helpbitesFetch<T = any>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown, auth?: string, query?: Record<string, unknown> } = {}): Promise<T> {
  const { host, publicKey, secret } = helpbitesSettings()
  if (!host || !publicKey) throw createError({ statusCode: 503, statusMessage: 'HelpBites is not configured' })
  const bearer = options.auth === 'secret' ? secret : options.auth
  return await $fetch<T>(`${host}${path}`, {
    method: options.method || 'GET',
    body: options.body as any,
    query: bearer ? options.query : { pk: publicKey, ...options.query },
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {}
  })
}

/** An admin identity for server jobs (changelog scripts, RSS) that need hidden rows. */
export function helpbitesSystemToken(): string {
  return mintHelpbitesToken({ sub: 'system:webbites', name: 'WebBites', role: 'admin' }, 300).token
}
