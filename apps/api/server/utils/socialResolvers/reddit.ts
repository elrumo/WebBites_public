/**
 * Reddit.
 *
 * The old trick of appending `.json` to any permalink now answers 403 from a
 * datacenter IP, so this goes through OAuth. Reddit's app-only ("client
 * credentials") grant is free and needs no user account: register a script app,
 * set `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`, and every request gets a
 * documented 100 QPM instead of a block.
 *
 * Without those two variables the resolver returns null and the save falls back
 * to the normal scrape, which does still work for Reddit — its og: tags are
 * served to crawlers. The resolver is an upgrade (selftext, real author, the
 * gallery), not a prerequisite.
 */

import { attempt, firstText, getJson, type RawExtraction, type ResolverContext } from './types';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';
const USER_AGENT = 'web:io.webbites:v1.0 (by /u/webbites)';

/** Tokens last an hour; keep one in module scope rather than minting per save. */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function appToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'utf-8').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) {
    console.warn(`[socialResolvers] reddit token request returned HTTP ${response.status}`);
    return null;
  }

  const data: any = await response.json();
  if (!data?.access_token) return null;
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
  return cachedToken.value;
}

/** `/r/<sub>/comments/<id>/<slug>` and `/comments/<id>` both appear in the wild. */
function postId(parsed: URL): string | null {
  const segments = parsed.pathname.split('/').filter(Boolean);
  const index = segments.indexOf('comments');
  if (index >= 0 && segments[index + 1]) return segments[index + 1];
  // Short share links: reddit.com/<id> or redd.it/<id>
  if (segments.length === 1 && /^[a-z0-9]{5,10}$/i.test(segments[0])) return segments[0];
  return null;
}

/** Reddit HTML-escapes the URLs inside its JSON. */
const unescape = (value?: string): string | undefined =>
  value?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

function mediaFrom(post: any): Array<{ type: 'image' | 'video'; url?: string; poster?: string }> {
  const preview = unescape(post?.preview?.images?.[0]?.source?.url);

  if (post?.is_video || post?.post_hint === 'rich:video') {
    const poster = preview ?? unescape(post?.thumbnail);
    return poster ? [{ type: 'video', url: poster, poster }] : [];
  }

  // A gallery carries its images under `media_metadata`, keyed by id, and the
  // *order* the poster arranged them in under `gallery_data.items`. Reading the
  // map's own key order instead — as this used to — is reading whatever order
  // JSON.parse happened to produce, which is not the order anyone sees on
  // Reddit and decides which picture becomes the cover.
  const metadata = post?.media_metadata || {};
  const items = Array.isArray(post?.gallery_data?.items) ? post.gallery_data.items : [];
  const ordered = items.length
    ? items.map((item: any) => metadata[item?.media_id])
    : Object.values(metadata);

  const gallery = ordered
    .map((entry: any) => {
      // An animated gallery item has no still `s.u`; `s.gif` is its source.
      const still = unescape(entry?.s?.u ?? entry?.s?.gif);
      // `p` is the resized preview ladder, largest last — the fallback for an
      // entry whose source Reddit declines to hand out.
      const preview = unescape(entry?.p?.[entry.p.length - 1]?.u);
      return still ?? preview;
    })
    .filter(Boolean) as string[];
  if (gallery.length) return gallery.map((url) => ({ type: 'image' as const, url }));

  // A crosspost is a wrapper with no media of its own; the pictures belong to
  // the post it points at.
  const crosspost = post?.crosspost_parent_list?.[0];
  if (crosspost) {
    const inherited = mediaFrom(crosspost);
    if (inherited.length) return inherited;
  }

  const direct = post?.post_hint === 'image' ? unescape(post?.url_overridden_by_dest ?? post?.url) : undefined;
  const best = direct ?? preview;
  return best ? [{ type: 'image', url: best }] : [];
}

export async function resolveReddit(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('reddit', async () => {
    const id = postId(context.parsed);
    if (!id) return null;

    const token = await appToken();
    if (!token) return null;

    const listing = await getJson<any>(`${API}/api/info?id=t3_${id}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT }
    });

    const post = listing?.data?.children?.[0]?.data;
    if (!post) return null;

    const author = firstText(post.author);

    return {
      platform: 'reddit',
      kind: post.is_video ? 'video' : 'post',
      canonicalUrl: post.permalink ? `https://www.reddit.com${post.permalink}` : context.url,
      title: firstText(post.title),
      // A link post has no body of its own; the subreddit is the most useful
      // thing left to say about it.
      text: firstText(post.selftext, post.subreddit_name_prefixed),
      author: author && author !== '[deleted]' ? `u/${author}` : firstText(post.subreddit_name_prefixed),
      authorHandle: author && author !== '[deleted]' ? `u/${author}` : undefined,
      publishedAt:
        typeof post.created_utc === 'number'
          ? new Date(post.created_utc * 1000).toISOString()
          : undefined,
      media: mediaFrom(post),
      extractedBy: 'server:reddit',
      extractedAt: new Date().toISOString(),
      pageUrl: context.url
    };
  });
}
