/**
 * Social post resolvers.
 *
 * Background: `clientMetadata.ts` exists because the browser extension is the
 * only surface that can read a social post out of a live, logged-in DOM. But
 * most saves have no extension behind them — the share sheet hands the app a
 * bare permalink, and the web app, Raycast, the public API and bulk import send
 * nothing but a URL. For those, this directory asks the platform itself.
 *
 * Where a platform still answers, it answers far better than a scrape:
 * Bluesky's public AppView returns the whole post record unauthed, and FxEmbed
 * returns a full tweet with no API key. Where it doesn't — Instagram, Threads —
 * the device is the primary route and this is only the fallback.
 *
 * Everything a resolver returns is run through `sanitizeClientMetadata` before
 * it reaches a caller, so a resolver is never trusted more than the extension
 * is: the media-host allowlist (an SSRF guard) and the length caps apply to
 * both identically.
 */

import { sanitizeClientMetadata, type ClientMetadata } from '../clientMetadata';
import { resolveBluesky } from './bluesky';
import { resolveTwitter } from './twitter';
import { resolveTikTok, resolveYouTube, resolvePinterest } from './oembed';
import { resolveReddit } from './reddit';
import { resolveMastodon, looksLikeMastodon } from './mastodon';
import { resolveInstagram, resolveThreads } from './meta';
import type { Resolver, ResolverContext } from './types';

/**
 * Query parameters that identify the sharer rather than the post. Instagram's
 * `igsh` and TikTok's `_t`/`_r` in particular make every share of the same post
 * a different URL, which defeats both this cache and the duplicate check the
 * clients run before saving.
 */
const TRACKING_PARAMS = [
  'igsh', 'igshid', 'img_index', 'si', 't', 's', '_t', '_r', '_nc_ht',
  'ref_src', 'ref_url', 'source', 'share_id', 'fbclid', 'gclid', 'mibextid'
];

const HOST_RESOLVERS: Array<{ pattern: RegExp; resolve: Resolver }> = [
  { pattern: /^bsky\.app$/, resolve: resolveBluesky },
  { pattern: /^(x\.com|twitter\.com|mobile\.twitter\.com)$/, resolve: resolveTwitter },
  { pattern: /^instagram\.com$/, resolve: resolveInstagram },
  { pattern: /^threads\.(net|com)$/, resolve: resolveThreads },
  { pattern: /(^|\.)tiktok\.com$/, resolve: resolveTikTok },
  { pattern: /^(youtube\.com|m\.youtube\.com|youtu\.be)$/, resolve: resolveYouTube },
  { pattern: /^(reddit\.com|old\.reddit\.com|redd\.it)$/, resolve: resolveReddit },
  { pattern: /^pinterest\.([a-z]{2,3})(\.[a-z]{2})?$/, resolve: resolvePinterest }
];

/**
 * Strips tracking parameters and the fragment, leaving a URL that is the same
 * for everyone who shares the same post. Returns the input unchanged if it
 * cannot be parsed — the caller validates separately.
 */
export function canonicalizeSocialUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param);
    // Collect first, delete after: mutating the params while iterating them
    // skips entries.
    const utm: string[] = [];
    parsed.searchParams.forEach((_value, key) => {
      if (key.toLowerCase().startsWith('utm_')) utm.push(key);
    });
    for (const key of utm) parsed.searchParams.delete(key);
    parsed.hash = '';
    // Trailing slashes are meaningless on these permalinks and would split the
    // cache. Keep the root path as "/".
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Whether a resolver exists for this URL at all — cheap, no network. */
export function hasSocialResolver(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Same protocol gate `resolveSocialUrl` applies, so the predicate cannot
    // promise a resolution the resolver will then refuse.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.replace(/^www\./, '');
    return (
      HOST_RESOLVERS.some((entry) => entry.pattern.test(host)) || looksLikeMastodon(parsed, host)
    );
  } catch {
    return false;
  }
}

/**
 * A popular post gets saved by many people in a short window, and every one of
 * those saves would otherwise be an identical upstream request. Small and
 * in-process on purpose: this is request coalescing, not a content store, and
 * an entry going stale costs nothing but one extra fetch.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 500;
const cache = new Map<string, { value: ClientMetadata | null; expiresAt: number }>();

function readCache(key: string): { value: ClientMetadata | null } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the eviction below is least-recently-used.
  cache.delete(key);
  cache.set(key, entry);
  return { value: entry.value };
}

function writeCache(key: string, value: ClientMetadata | null): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test seam: the cache is module state and would leak between test cases. */
export function clearSocialResolverCache(): void {
  cache.clear();
}

/**
 * Resolves a social permalink into sanitized client metadata, or null when the
 * URL isn't social, no resolver is configured for it, or the upstream didn't
 * answer usefully. Never throws — every caller is on the save path.
 */
export async function resolveSocialUrl(url: string): Promise<ClientMetadata | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const host = parsed.hostname.replace(/^www\./, '');
  const entry = HOST_RESOLVERS.find((candidate) => candidate.pattern.test(host));
  const resolve = entry?.resolve ?? (looksLikeMastodon(parsed, host) ? resolveMastodon : null);
  if (!resolve) return null;

  const canonical = canonicalizeSocialUrl(url);
  const cached = readCache(canonical);
  if (cached) return cached.value;

  const context: ResolverContext = { url: canonical, parsed: new URL(canonical), host };
  const raw = await resolve(context);
  // Sanitizing here rather than in each resolver keeps the SSRF allowlist in
  // one place and means a new resolver cannot forget it.
  const metadata = raw ? sanitizeClientMetadata(raw, canonical) : null;

  writeCache(canonical, metadata);
  return metadata;
}
