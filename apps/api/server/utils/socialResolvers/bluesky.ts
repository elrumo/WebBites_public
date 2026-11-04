/**
 * Bluesky / AT Protocol.
 *
 * The best case in this whole directory: the public AppView answers unauthed,
 * with no key, no quota and a fully structured post record — text, author,
 * images with alt text, quote posts and link cards. Nothing is scraped.
 *
 *   https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread
 *
 * Permalinks are `bsky.app/profile/<handle-or-did>/post/<rkey>`, but the API
 * addresses posts by `at://<did>/app.bsky.feed.post/<rkey>`, so a handle has to
 * be resolved to a DID first.
 */

import { attempt, firstText, getJson, type RawExtraction, type ResolverContext } from './types';

const APPVIEW = 'https://public.api.bsky.app/xrpc';

/** `bsky.app/profile/<actor>/post/<rkey>` → its two path parts. */
function parsePermalink(parsed: URL): { actor: string; rkey: string } | null {
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 4) return null;
  const [profile, actor, post, rkey] = segments;
  if (profile !== 'profile' || post !== 'post' || !actor || !rkey) return null;
  return { actor, rkey };
}

async function resolveDid(actor: string): Promise<string | null> {
  if (actor.startsWith('did:')) return actor;
  const result = await getJson<{ did?: string }>(
    `${APPVIEW}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`
  );
  return result?.did || null;
}

/**
 * Flattens the embed union into plain media entries.
 *
 * `recordWithMedia` nests the real media one level down, and a quote post's own
 * images live under `record.embeds[]`. Unknown `$type`s are simply skipped —
 * the lexicon grows, and an embed we don't understand is not an error.
 */
function mediaFrom(embed: any): Array<{ type: 'image' | 'video'; url?: string; poster?: string }> {
  if (!embed || typeof embed !== 'object') return [];
  const type = String(embed.$type || '');

  if (type.startsWith('app.bsky.embed.images')) {
    return (embed.images || [])
      .map((image: any) => ({ type: 'image' as const, url: firstText(image?.fullsize, image?.thumb) }))
      .filter((item: any) => item.url);
  }

  if (type.startsWith('app.bsky.embed.video')) {
    // We never store playable video (App Store guideline 5.2.3), so the
    // thumbnail stands in for it, exactly as the share extension's poster frame
    // does for a locally shared Reel.
    const poster = firstText(embed.thumbnail);
    return poster ? [{ type: 'video' as const, url: poster, poster }] : [];
  }

  if (type.startsWith('app.bsky.embed.external')) {
    const thumb = firstText(embed.external?.thumb);
    return thumb ? [{ type: 'image' as const, url: thumb }] : [];
  }

  if (type.startsWith('app.bsky.embed.recordWithMedia')) {
    return [...mediaFrom(embed.media), ...mediaFrom(embed.record)];
  }

  if (type.startsWith('app.bsky.embed.record')) {
    const quoted = embed.record;
    return (quoted?.embeds || []).flatMap((inner: any) => mediaFrom(inner));
  }

  return [];
}

export async function resolveBluesky(context: ResolverContext): Promise<RawExtraction | null> {
  return attempt('bluesky', async () => {
    const permalink = parsePermalink(context.parsed);
    if (!permalink) return null;

    const did = await resolveDid(permalink.actor);
    if (!did) return null;

    const uri = `at://${did}/app.bsky.feed.post/${permalink.rkey}`;
    const thread = await getJson<any>(
      `${APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`
    );

    const post = thread?.thread?.post;
    if (!post) return null;

    const media = mediaFrom(post.embed);
    const handle = firstText(post.author?.handle);

    return {
      platform: 'bluesky',
      kind: media.some((item) => item.type === 'video') ? 'video' : 'post',
      canonicalUrl: context.url,
      text: firstText(post.record?.text),
      author: firstText(post.author?.displayName, handle),
      authorHandle: handle ? `@${handle}` : undefined,
      authorAvatar: firstText(post.author?.avatar),
      publishedAt: firstText(post.record?.createdAt, post.indexedAt),
      media,
      lang: Array.isArray(post.record?.langs) ? firstText(post.record.langs[0]) : undefined,
      extractedBy: 'server:bluesky',
      extractedAt: new Date().toISOString(),
      pageUrl: context.url
    };
  });
}
