/**
 * Platforms that still run an open oEmbed endpoint: TikTok, YouTube, Pinterest.
 *
 * oEmbed gives us a title, an author and a thumbnail with no key and no quota.
 * It gives us nothing else — there is no body text, no media list and no
 * publish date in the spec's basic response — so these resolvers are a floor,
 * not a ceiling. What they buy is that a TikTok or a Pin never lands as a bare
 * URL with a login-wall title on it.
 *
 * For TikTok the `title` field is the video's caption, which is the single most
 * useful thing about the post, so it is mapped to `text` as well.
 */

import { attempt, firstText, getJson, type RawExtraction, type ResolverContext } from './types';

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
  type?: string;
  /** TikTok-only, and the cleanest handle of the three sources we try. */
  author_unique_id?: string;
}

/** `https://www.tiktok.com/@user/video/123` → `@user`. */
function handleFromPath(parsed: URL): string | undefined {
  const segment = parsed.pathname.split('/').filter(Boolean)[0];
  return segment?.startsWith('@') ? segment : undefined;
}

/** `author_url` is a profile link; its last path segment is the handle. */
function handleFromAuthorUrl(authorUrl?: string): string | undefined {
  if (!authorUrl) return undefined;
  try {
    const segment = new URL(authorUrl).pathname.split('/').filter(Boolean).pop();
    if (!segment) return undefined;
    return segment.startsWith('@') ? segment : `@${segment}`;
  } catch {
    return undefined;
  }
}

async function fromOEmbed(
  endpoint: string,
  context: ResolverContext,
  platform: 'tiktok' | 'youtube' | 'pinterest',
  kind: 'post' | 'video' | 'website'
): Promise<RawExtraction | null> {
  const data = await getJson<OEmbedResponse>(
    `${endpoint}${endpoint.includes('?') ? '&' : '?'}url=${encodeURIComponent(context.url)}`
  );
  if (!data) return null;

  const title = firstText(data.title);
  const thumbnail = firstText(data.thumbnail_url);
  const uniqueId = firstText(data.author_unique_id);
  const handle =
    (uniqueId ? `@${uniqueId.replace(/^@/, '')}` : undefined) ??
    handleFromPath(context.parsed) ??
    handleFromAuthorUrl(data.author_url);

  // TikTok has no separate caption field — `title` *is* the caption — so it
  // becomes the body text too. YouTube and Pinterest have real titles that are
  // distinct from a description, and oEmbed does not carry the description, so
  // for those `text` stays empty and metascraper's og:description fills it.
  const text = platform === 'tiktok' ? title : undefined;

  const extraction: RawExtraction = {
    platform,
    kind,
    canonicalUrl: context.url,
    title,
    text,
    author: firstText(data.author_name),
    authorHandle: handle,
    media: thumbnail
      ? [kind === 'video'
          ? { type: 'video', url: thumbnail, poster: thumbnail }
          : { type: 'image', url: thumbnail }]
      : [],
    extractedBy: `server:${platform}`,
    extractedAt: new Date().toISOString(),
    pageUrl: context.url
  };

  return extraction.title || extraction.author || extraction.media?.length ? extraction : null;
}

export async function resolveTikTok(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('tiktok', () =>
    fromOEmbed('https://www.tiktok.com/oembed', context, 'tiktok', 'video')
  );
}

export async function resolveYouTube(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('youtube', () =>
    fromOEmbed('https://www.youtube.com/oembed?format=json', context, 'youtube', 'video')
  );
}

export async function resolvePinterest(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('pinterest', () =>
    fromOEmbed('https://www.pinterest.com/oembed.json', context, 'pinterest', 'post')
  );
}
