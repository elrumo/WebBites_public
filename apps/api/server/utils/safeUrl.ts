/**
 * Guard for fetching a URL the user chose.
 *
 * `isLocalUrl` used to be the whole defence, and it only pattern-matched the
 * hostname *text* against localhost/10/172.16/192.168/.local. That left every
 * other way of naming an internal host open:
 *
 *   - 100.64.0.0/10, the CGNAT range (VPN overlays such as Tailscale use it)
 *   - 169.254.169.254 and the rest of link-local (cloud metadata)
 *   - 127.0.0.2 and the rest of 127/8, and 0.0.0.0
 *   - IPv4-mapped IPv6 (::ffff:127.0.0.1)
 *   - a public DNS name whose A record points at a private address
 *   - single-label Docker service names
 *   - any redirect, since the hop target was never re-checked
 *
 * So the check here is on the *resolved addresses*, not on the name, and
 * `safeFetch` re-runs it for every redirect hop.
 *
 * ponytail: this resolves, checks, then lets fetch resolve again, so a name that
 * changes answer between the two calls (DNS rebinding) still slips through. The
 * fix is an undici Agent with a `connect.lookup` that pins the checked address;
 * do that if we ever fetch somewhere a rebind could reach something dangerous.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** Private, loopback, link-local, CGNAT, multicast and reserved IPv4. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true

  const [a, b, c] = parts
  if (a === 0) return true                              // 0.0.0.0/8 "this network"
  if (a === 10) return true                             // RFC1918
  if (a === 127) return true                            // loopback, all of /8
  if (a === 100 && b >= 64 && b <= 127) return true     // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true               // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true      // RFC1918
  // Only these two /24s of 192.0/16 are reserved. The rest is public: 192.0.64/18
  // is Automattic's (WordPress.com and VIP, e.g. pewresearch.org → 192.0.66.2).
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // 192.0.0/24, TEST-NET-1
  if (a === 192 && b === 168) return true               // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true  // benchmarking
  if (a >= 224) return true                             // multicast, reserved, broadcast
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const s = ip.toLowerCase().split('%')[0] // drop any zone id
  if (s === '::' || s === '::1') return true

  // IPv4-mapped / NAT64 written with a dotted tail: ::ffff:127.0.0.1
  const dotted = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) return isBlockedIpv4(dotted[1])

  // The same thing written as hex: ::ffff:7f00:1
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
    return isBlockedIpv4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
  }

  if (/^f[cd]/.test(s)) return true    // fc00::/7 unique-local
  if (/^fe[89ab]/.test(s)) return true // fe80::/10 link-local
  if (/^ff/.test(s)) return true       // multicast
  return false
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return isBlockedIpv4(ip)
  if (family === 6) return isBlockedIpv6(ip)
  return true // not an address we understand: refuse
}

/**
 * `{ ok: true }` when `url` is an http(s) URL whose every resolved address is
 * routable on the public internet, `{ error }` otherwise.
 */
export async function assertPublicUrl(url: string): Promise<{ ok: true } | { error: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { error: 'Invalid URL' }
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { error: 'Unsupported protocol' }
  }

  // Strip the brackets IPv6 literals carry in a URL.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname) return { error: 'Missing hostname' }

  // An address literal needs no lookup.
  if (isIP(hostname)) {
    return isBlockedAddress(hostname) ? { error: 'Blocked address' } : { ok: true }
  }

  // A name with no dot is a container/service name on our own network, never a
  // site a user meant to save.
  if (!hostname.includes('.') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { error: 'Blocked host' }
  }

  let addresses: { address: string }[]
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS lookup timeout')), 3000)),
    ])
  } catch (e: any) {
    if (e?.code === 'ENOTFOUND') return { error: 'DNS_PROBE_FINISHED_NXDOMAIN' }
    return { error: e?.message || 'DNS lookup failed' }
  }

  if (!addresses.length) return { error: 'DNS lookup failed' }
  // Every answer has to be public: one private A record is enough to reach in.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) return { error: 'Blocked address' }
  }

  return { ok: true }
}

/**
 * fetch() for a user-supplied URL: the target is checked before the request,
 * redirects are followed by hand, and each hop is checked the same way.
 *
 * Throws on a blocked target so callers can't accidentally ignore it.
 */
export async function safeFetch(
  url: string,
  options: any = {},
  maxRedirects = 5
): Promise<Response> {
  let current = url

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await assertPublicUrl(current)
    if ('error' in check) throw new Error(`Refusing to fetch ${current}: ${check.error}`)

    const response: Response = await fetch(current, { ...options, redirect: 'manual' })

    if (response.status < 300 || response.status > 399) return response

    const location = response.headers.get('location')
    if (!location) return response

    current = new URL(location, current).toString()

    // A cross-origin hop must not carry credentials meant for the first host.
    if (options.headers) {
      const headers = new Headers(options.headers as any)
      headers.delete('authorization')
      headers.delete('cookie')
      options = { ...options, headers }
    }
  }

  throw new Error(`Refusing to fetch ${url}: too many redirects`)
}
