/**
 * HelpBites (support-bites) holds this app's support chat and feedback board,
 * keyed by our user ids. Account deletion has to reach it too: its
 * `DELETE /v1/end-users/:externalId` (project secret) removes the user's
 * feedback posts, votes and comments, their support conversations, and their
 * end-user record.
 */

export type HelpbitesErased = Record<string, number>

export function helpbitesEraseUrl(baseUrl: string, userId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/end-users/${encodeURIComponent(userId)}`
}

/**
 * Erase one user's HelpBites data. Returns null when HelpBites is not
 * configured here (nothing can have reached it through us); throws when it is
 * configured and refuses, so the account delete fails whole rather than
 * leaving data behind.
 */
export async function eraseHelpbitesUser(userId: string, env = process.env, fetcher: typeof fetch = fetch): Promise<HelpbitesErased | null> {
  const baseUrl = env.HELPBITES_API_URL || ''
  const secret = env.HELPBITES_PRIVATE_KEY || ''
  if (!baseUrl || !secret) {
    console.warn('[helpbites] HELPBITES_API_URL / HELPBITES_PRIVATE_KEY not set — skipping the HelpBites erase')
    return null
  }
  const response = await fetcher(helpbitesEraseUrl(baseUrl, userId), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${secret}` },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`HelpBites erase answered ${response.status}: ${detail.slice(0, 200)}`)
  }
  const body = await response.json().catch(() => ({})) as { erased?: HelpbitesErased }
  return body.erased || {}
}
