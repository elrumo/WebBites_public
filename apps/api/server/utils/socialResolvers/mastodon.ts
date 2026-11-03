/**
 * Mastodon (and other instances speaking the same API).
 *
 * There is no mastodon.com to match on — the network is thousands of
 * independent hosts — so this resolver is reached by *shape* rather than by
 * hostname: a path of `/@user/<numeric id>` or `/users/<user>/statuses/<id>` on
 * any host is a candidate, and `GET /api/v1/statuses/<id>` on that same host
 * either answers with a status or it doesn't.
 *
 * The probe is cheap and safe: it is one request to the host the user is
 * already saving, which the normal scrape would have fetched anyway. A host
 * that isn't a Mastodon instance answers 404 or HTML, and we return null.
 *
 * Media lives on the instance's own domain or its object store. The sanitizer
 * adds the saved URL's host to the allowlist per-call, so instance-hosted
 * attachments pass and a third-party bucket is dropped rather than fetched.
 */

import { attempt, firstText, getJson, type RawExtraction, type ResolverContext } from './types';

/** Hosts that look Mastodon-shaped but are something else entirely. */
const NOT_MASTODON = /(^|\.)(medium\.com|twitter\.com|x\.com|threads\.(net|com)|instagram\.com|tiktok\.com|facebook\.com|linkedin\.com|youtube\.com|reddit\.com|bsky\.app|pinterest\.[a-z.]+)$/;

function statusId(parsed: URL): string | null {
  const segments = parsed.pathname.split('/').filter(Boolean);

  // /@user/109252... and /@user@remote.host/109252...
  if (segments.length === 2 && segments[0].startsWith('@') && /^\d{6,}$/.test(segments[1])) {
    return segments[1];
  }
  // /users/user/statuses/109252...
  if (
    segments.length === 4 &&
    segments[0] === 'users' &&
    segments[2] === 'statuses' &&
    /^\d{6,}$/.test(segments[3])
  ) {
    return segments[3];
  }
  return null;
}

function mediaFrom(status: any): Array<{ type: 'image' | 'video'; url?: string; poster?: string }> {
  return (status?.media_attachments || [])
    .map((attachment: any) => {
      const kind = String(attachment?.type || '');
      const preview = firstText(attachment?.preview_url);
      if (kind === 'video' || kind === 'gifv') {
        return preview ? { type: 'video' as const, url: preview, poster: preview } : null;
      }
      if (kind === 'image') {
        const url = firstText(attachment?.url, preview);
        return url ? { type: 'image' as const, url } : null;
      }
      return null;
    })
    .filter(Boolean) as Array<{ type: 'image' | 'video'; url?: string; poster?: string }>;
}

/** Mastodon's `content` is sanitized HTML; the card wants plain text. */
function plainText(html?: string): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return text || undefined;
}

/** True when this URL is worth probing as a Mastodon status. */
export function looksLikeMastodon(parsed: URL, host: string): boolean {
  return !NOT_MASTODON.test(host) && statusId(parsed) !== null;
}

export async function resolveMastodon(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('mastodon', async () => {
    const id = statusId(context.parsed);
    if (!id || NOT_MASTODON.test(context.host)) return null;

    const status = await getJson<any>(`${context.parsed.origin}/api/v1/statuses/${id}`);
    // Anything that isn't a status record means this host is not an instance.
    if (!status?.account || !status?.id) return null;

    const account = status.account;
    const handle = firstText(account.acct, account.username);
    const media = mediaFrom(status);

    return {
      platform: 'mastodon',
      kind: media.some((item) => item.type === 'video') ? 'video' : 'post',
      canonicalUrl: firstText(status.url, context.url),
      // A content warning is the only headline a status ever has.
      title: firstText(status.spoiler_text),
      text: plainText(status.content),
      author: firstText(account.display_name, handle),
      authorHandle: handle ? `@${handle.replace(/^@/, '')}` : undefined,
      authorAvatar: firstText(account.avatar_static, account.avatar),
      publishedAt: firstText(status.created_at),
      media,
      lang: firstText(status.language),
      extractedBy: 'server:mastodon',
      extractedAt: new Date().toISOString(),
      pageUrl: context.url
    };
  });
}
