/**
 * X / Twitter, via FxEmbed.
 *
 * A direct fetch of an x.com permalink gets a login shell, and the v2 API costs
 * money for read access. FxEmbed (MIT, the service behind fxtwitter.com) reads
 * the post as a logged-out web client would and returns structured JSON with no
 * API key. `publish.twitter.com/oembed` is the other keyless option but it
 * returns a blockquote of pre-rendered HTML, no media list, and is rate limited
 * per IP without documentation.
 *
 * `FXEMBED_BASE_URL` should point at our own deployment — FxEmbed is a
 * single-file Cloudflare Worker with no database and no credentials, so
 * self-hosting removes both the shared rate limit and the dependency on someone
 * else's uptime. It falls back to the public instance when unset.
 */

import { attempt, firstText, getJson, type RawExtraction, type ResolverContext } from './types';

const DEFAULT_BASE = 'https://api.fxtwitter.com';

/** Path segments that are X's own routes rather than a username. */
const RESERVED = new Set(['i', 'search', 'hashtag', 'explore', 'notifications', 'messages', 'home', 'intent']);

function parsePermalink(parsed: URL): { handle: string | null; id: string } | null {
  const segments = parsed.pathname.split('/').filter(Boolean);
  const statusIndex = segments.findIndex((segment) => segment === 'status' || segment === 'statuses');
  if (statusIndex < 0) return null;
  const id = segments[statusIndex + 1];
  if (!id || !/^\d+$/.test(id)) return null;
  const handle = segments[statusIndex - 1];
  return { handle: handle && !RESERVED.has(handle) ? handle : null, id };
}

/**
 * `media.all` covers photos, videos and GIFs in one ordered list — all four
 * photos of a four-photo tweet, which is the whole point of reading it rather
 * than the single `og:image`. A video's `url` is the playable stream, which we
 * never store, so a video entry carries only its thumbnail.
 */
function mediaFrom(media: any): Array<{ type: 'image' | 'video'; url?: string; poster?: string }> {
  const items = Array.isArray(media?.all) ? media.all : [];
  const mapped = items
    .map((item: any) => {
      const type = String(item?.type || '');
      if (type === 'video' || type === 'gif') {
        const poster = firstText(item?.thumbnail_url);
        return poster ? { type: 'video' as const, url: poster, poster } : null;
      }
      // The mosaic is one image with all four photos tiled into it, meant for
      // an unfurl card that can only show a single picture. Alongside the
      // photos themselves it is a duplicate of the whole set, and as the first
      // entry it would become the cover — a contact sheet where the card should
      // show the first photo.
      if (type === 'mosaic_photo') return null;
      const url = firstText(item?.url);
      return url ? { type: 'image' as const, url } : null;
    })
    .filter(Boolean) as Array<{ type: 'image' | 'video'; url?: string; poster?: string }>;

  if (mapped.length) return mapped;

  // Only a mosaic and nothing else: better the contact sheet than no picture.
  const mosaic = firstText(media?.mosaic?.formats?.jpeg, media?.mosaic?.formats?.webp);
  if (mosaic) return [{ type: 'image', url: mosaic }];

  // A link-card tweet has no media of its own, only the card's thumbnail.
  const external = firstText(media?.external?.thumbnail_url);
  return external ? [{ type: 'image', url: external }] : [];
}

export async function resolveTwitter(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('twitter', async () => {
    const permalink = parsePermalink(context.parsed);
    if (!permalink) return null;

    const base = (process.env.FXEMBED_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
    const path = permalink.handle ? `${permalink.handle}/status/${permalink.id}` : `i/status/${permalink.id}`;
    const response = await getJson<any>(`${base}/${path}`);

    const tweet = response?.tweet;
    if (!tweet) return null;

    const media = mediaFrom(tweet.media);
    const handle = firstText(tweet.author?.screen_name, permalink.handle ?? undefined);

    return {
      platform: 'twitter',
      kind: media.some((item) => item.type === 'video') ? 'video' : 'post',
      canonicalUrl: firstText(tweet.url, context.url),
      // `raw_text.text` keeps the t.co links expanded; `text` is the display
      // form. Either is better than the login page.
      text: firstText(tweet.text, tweet.raw_text?.text),
      author: firstText(tweet.author?.name, handle),
      authorHandle: handle ? `@${handle}` : undefined,
      authorAvatar: firstText(tweet.author?.avatar_url),
      // `created_at` is Twitter's own "Thu Apr 28 00:56:58 +0000 2022" format.
      // The unix `created_timestamp` alongside it needs no date parsing, so
      // prefer it and keep the string as the fallback.
      publishedAt:
        typeof tweet.created_timestamp === 'number'
          ? new Date(tweet.created_timestamp * 1000).toISOString()
          : firstText(tweet.created_at),
      media,
      lang: firstText(tweet.lang),
      extractedBy: 'server:twitter',
      extractedAt: new Date().toISOString(),
      pageUrl: context.url
    };
  });
}
