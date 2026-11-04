/**
 * Instagram and Threads — the two we cannot resolve ourselves.
 *
 * Measured from a datacenter IP: an instagram.com permalink answers 200 with a
 * ~600 KB JavaScript shell carrying zero og: tags, and a second request inside
 * the same minute answers 429. A threads.com post permalink does serve og: tags
 * but they are the login page's ("Threads • Log in"), not the post's. There is
 * no keyless path to either, and Meta's own oEmbed dropped `thumbnail_url` and
 * `author_name` in November 2025.
 *
 * So the primary route for these two is the device: the iOS app renders the
 * post in a WKWebView on the user's own connection and sends the result back as
 * `deviceEnrichment`. This resolver is the fallback for every save that has no
 * device behind it — the web app, Raycast, the public API, bulk import.
 *
 * It speaks to whatever provider `SOCIAL_RESOLVER_URL` names, normalizing a few
 * field spellings the common ones use. With no provider configured it returns
 * null immediately and costs nothing: the save proceeds exactly as it does
 * today, and the device pass still upgrades it later.
 */

import { attempt, firstText, getJson, type RawExtraction, type ResolverContext } from './types';

type MetaPlatform = 'instagram' | 'threads';

/** Normalizes the handful of shapes third-party resolvers return. */
function normalize(
  data: any,
  platform: MetaPlatform,
  context: ResolverContext
): RawExtraction | null {
  // Providers variously nest the post under `data`, `post`, `result` or return
  // it at the top level.
  const post = data?.data ?? data?.post ?? data?.result ?? data;
  if (!post || typeof post !== 'object') return null;

  const text = firstText(post.caption, post.text, post.description, post.title);
  const author = post.author ?? post.user ?? post.owner ?? {};
  const handle = firstText(author.username, author.handle, post.username, post.author_name);

  // A carousel is the case this list exists for, and every provider spells it
  // differently: Instagram's own graph shape nests the slides under
  // `edge_sidecar_to_children.edges[].node`, the private API calls the same
  // thing `carousel_media`, and the scraping services variously say `media`,
  // `images`, `resources` or `items`. Missing the spelling means saving slide
  // one of twenty, so all of them are tried before giving up.
  const sidecar = Array.isArray(post.edge_sidecar_to_children?.edges)
    ? post.edge_sidecar_to_children.edges.map((edge: any) => edge?.node).filter(Boolean)
    : [];

  const rawMedia: any[] =
    [sidecar, post.carousel_media, post.media, post.images, post.resources, post.items].find(
      (candidate: any) => Array.isArray(candidate) && candidate.length > 0
    ) ?? [];

  const media = rawMedia
    .map((item: any) => {
      if (typeof item === 'string') return { type: 'image' as const, url: item };
      const isVideo =
        item?.type === 'video' || item?.is_video === true || item?.media_type === 2;
      const poster = firstText(
        item?.poster,
        item?.thumbnail,
        item?.thumbnail_url,
        item?.cover,
        item?.display_url,
        // `image_versions2.candidates` is the private API's size ladder,
        // largest first, and is the only picture a `carousel_media` slide has.
        item?.image_versions2?.candidates?.[0]?.url
      );
      if (isVideo) {
        // Never the playable stream — poster frames only, the same rule the
        // share extension follows for a locally shared Reel.
        return poster ? { type: 'video' as const, url: poster, poster } : null;
      }
      const url = firstText(item?.url, item?.src, item?.display_url, poster);
      return url ? { type: 'image' as const, url } : null;
    })
    .filter(Boolean) as Array<{ type: 'image' | 'video'; url?: string; poster?: string }>;

  if (!media.length) {
    const single = firstText(post.thumbnail_url, post.thumbnail, post.display_url, post.image);
    if (single) media.push({ type: 'image', url: single });
  }

  const extraction: RawExtraction = {
    platform,
    kind: post.is_video || media.some((item) => item.type === 'video') ? 'video' : 'post',
    canonicalUrl: firstText(post.permalink, post.url, context.url),
    text,
    author: firstText(author.full_name, author.name, author.display_name, handle),
    authorHandle: handle ? `@${handle.replace(/^@/, '')}` : undefined,
    authorAvatar: firstText(author.profile_pic_url, author.avatar),
    publishedAt: firstText(post.taken_at, post.timestamp, post.created_at, post.published_at),
    media,
    extractedBy: `server:${platform}`,
    extractedAt: new Date().toISOString(),
    pageUrl: context.url
  };

  return extraction.text || extraction.author || media.length ? extraction : null;
}

async function resolveViaProvider(
  context: ResolverContext,
  platform: MetaPlatform
): Promise<RawExtraction | null> {
  const endpoint = process.env.SOCIAL_RESOLVER_URL;
  if (!endpoint) return null;

  const key = process.env.SOCIAL_RESOLVER_KEY;
  const separator = endpoint.includes('?') ? '&' : '?';
  const data = await getJson<any>(
    `${endpoint}${separator}url=${encodeURIComponent(context.url)}`,
    key ? { headers: { Authorization: `Bearer ${key}`, 'x-api-key': key } } : {},
    // Third-party resolvers render the page behind the scenes, so they are
    // slower than the keyless APIs. Still bounded — the row must not wait.
    12_000
  );
  if (!data) return null;

  return normalize(data, platform, context);
}

export async function resolveInstagram(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('instagram', () => resolveViaProvider(context, 'instagram'));
}

export async function resolveThreads(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('threads', () => resolveViaProvider(context, 'threads'));
}
