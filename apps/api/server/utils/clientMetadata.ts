/**
 * Client-extracted post metadata.
 *
 * The browser extension injects a content script into the page and reads the
 * post out of the live DOM, in the user's own logged-in session. That is the
 * only way we ever see the real content of an Instagram, X or Threads post:
 * a server-side fetch of those URLs gets a login wall or an empty JS shell,
 * and the iOS share sheet only ever hands us a bare permalink.
 *
 * Everything in here treats the payload as hostile. It was assembled by
 * JavaScript running in a page we do not control, so any field could be
 * attacker-chosen — including the media URLs, which we later fetch server-side.
 */

const MAX_TEXT = 5000;
const MAX_SHORT = 500;
/**
 * Matches `MAX_IMAGES` in `bookmarkImages.ts`, and for the same reason: this
 * list is what a carousel post becomes, so anything dropped here is a picture
 * missing from the card. Instagram allows 20 items in a carousel and X allows
 * 4, so 20 covers every post either can produce — where 8 silently truncated
 * the long ones.
 */
const MAX_MEDIA = 20;
const MAX_PAYLOAD_BYTES = 64 * 1024;

const PLATFORMS = [
  'twitter',
  'instagram',
  'threads',
  'tiktok',
  'bluesky',
  'reddit',
  'youtube',
  'mastodon',
  'pinterest',
  'web'
] as const;
const KINDS = ['post', 'video', 'website'] as const;
const MEDIA_TYPES = ['image', 'video'] as const;

export type ClientPlatform = (typeof PLATFORMS)[number];

export interface ClientMedia {
  type: 'image' | 'video';
  url: string;
  poster?: string;
}

export interface ClientMetadata {
  platform: ClientPlatform;
  kind: 'post' | 'video' | 'website';
  canonicalUrl?: string;
  title?: string;
  text?: string;
  author?: string;
  authorHandle?: string;
  authorAvatar?: string;
  publishedAt?: string;
  media: ClientMedia[];
  lang?: string;
  extractedBy?: string;
  extractedAt?: string;
  pageUrl?: string;
}

/**
 * Our own upload storage. Unlike the platform CDNs below, a URL here wasn't
 * chosen by a page or client-side script we don't trust — it's something
 * *we* created moments earlier via an authenticated Parse file upload (see
 * the share extension's local media capture), so the SSRF concern the rest
 * of this allowlist exists for doesn't apply. Allowed for every platform.
 */
const OWN_STORAGE_HOSTS: RegExp[] = [/(^|\.)s3\.webbites\.io$/];

/**
 * Hosts we are willing to fetch media from, keyed by the platform that claimed
 * it. An allowlist rather than a blocklist: without it, `media[0].url` is an
 * arbitrary URL the page chose and our server fetches it, which is SSRF.
 */
const MEDIA_HOSTS: Record<ClientPlatform, RegExp[]> = {
  twitter: [/(^|\.)twimg\.com$/, ...OWN_STORAGE_HOSTS],
  instagram: [/(^|\.)cdninstagram\.com$/, /(^|\.)fbcdn\.net$/, ...OWN_STORAGE_HOSTS],
  threads: [/(^|\.)cdninstagram\.com$/, /(^|\.)fbcdn\.net$/, ...OWN_STORAGE_HOSTS],
  tiktok: [
    /(^|\.)tiktokcdn\.com$/,
    /(^|\.)tiktokcdn-us\.com$/,
    /(^|\.)ibyteimg\.com$/,
    ...OWN_STORAGE_HOSTS
  ],
  bluesky: [/(^|\.)cdn\.bsky\.app$/, /(^|\.)bsky\.network$/, ...OWN_STORAGE_HOSTS],
  reddit: [
    /(^|\.)redd\.it$/,
    /(^|\.)redditmedia\.com$/,
    /(^|\.)redditstatic\.com$/,
    ...OWN_STORAGE_HOSTS
  ],
  youtube: [/(^|\.)ytimg\.com$/, /(^|\.)ggpht\.com$/, ...OWN_STORAGE_HOSTS],
  // Mastodon is thousands of independent instances, each serving media from its
  // own domain or object store, so there is no CDN list to write. The resolver
  // adds the instance's own host per-call, the same way the generic extractor
  // gets the saved URL's origin below.
  mastodon: [...OWN_STORAGE_HOSTS],
  pinterest: [/(^|\.)pinimg\.com$/, ...OWN_STORAGE_HOSTS],
  // The generic extractor only ever reports the page's own og:image, so it is
  // held to the saved URL's own origin (added per-call below) plus our own
  // storage, for a share-sheet save of a plain (non-social) URL.
  web: [...OWN_STORAGE_HOSTS]
};

/**
 * Platforms whose pages we cannot read server-side. For these, client metadata
 * is not a hint to fall back on — it is the only source of truth we will get,
 * so it wins over whatever the scraper managed to salvage from the login wall.
 */
const LOGIN_WALLED = /^(instagram\.com|x\.com|twitter\.com|threads\.(net|com)|tiktok\.com)$/;

export function isLoginWalledHost(url: string): boolean {
  try {
    return LOGIN_WALLED.test(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

const str = (value: unknown, max: number, multiline = false): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // Strip control characters: this text reaches Parse, the search indices and
  // the UI, and the page chose every byte of it.
  //
  // A post body is the one field where newlines are content rather than
  // formatting noise — captions are written in paragraphs — and stripping them
  // as control characters ran "First line.\nSecond line." together into
  // "First line.Second line.". So `multiline` keeps \n (0x0a) and normalizes
  // the other two line endings onto it; everything else still goes.
  const normalized = multiline ? value.replace(/\r\n?/g, '\n') : value;
  const cleaned = normalized
    .replace(multiline ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g, '')
    // Any run of blank lines reads the same as one, and a post padded with
    // dozens of them should not push the real text past the cap.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
};

const httpUrl = (value: unknown, allowedHosts?: RegExp[]): string | undefined => {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (allowedHosts) {
    const host = parsed.hostname.replace(/^www\./, '');
    if (!allowedHosts.some((pattern) => pattern.test(host))) return undefined;
  }
  return parsed.href;
};

/** A URL returned by our authenticated Parse file upload, safe to store as a
 * file reference without asking the server to fetch an arbitrary client URL. */
export const ownStorageURL = (value: unknown): string | undefined =>
  httpUrl(value, OWN_STORAGE_HOSTS);

/** ISO-8601 only, and only dates that are actually plausible. */
const isoDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 40) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  const year = new Date(parsed).getUTCFullYear();
  if (year < 1995 || year > new Date().getUTCFullYear() + 1) return undefined;
  return new Date(parsed).toISOString();
};

/** Turns a hostname into a regex that also matches its subdomains. */
const hostPattern = (host: string): RegExp =>
  new RegExp(`(^|\\.)${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * Validates and normalizes a `clientMetadata` blob. Returns null for anything
 * malformed, oversized, or empty of usable content — callers then behave
 * exactly as they did before the field existed.
 */
export function sanitizeClientMetadata(raw: unknown, savedUrl?: string): ClientMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  // Cheap denial-of-service guard before we walk the structure.
  try {
    if (JSON.stringify(raw).length > MAX_PAYLOAD_BYTES) {
      console.warn('[clientMetadata] payload over size limit, ignoring');
      return null;
    }
  } catch {
    return null;
  }

  const input = raw as Record<string, unknown>;
  const platform = (PLATFORMS as readonly string[]).includes(input.platform as string)
    ? (input.platform as ClientPlatform)
    : 'web';
  const kind = (KINDS as readonly string[]).includes(input.kind as string)
    ? (input.kind as ClientMetadata['kind'])
    : 'website';

  // The generic extractor reports the page's own og:image, so allow the saved
  // URL's own host on top of the platform CDNs.
  const allowedHosts = [...MEDIA_HOSTS[platform]];
  if (savedUrl) {
    try {
      allowedHosts.push(hostPattern(new URL(savedUrl).hostname.replace(/^www\./, '')));
    } catch {
      // Unparseable saved URL: the platform allowlist still applies.
    }
  }

  const media: ClientMedia[] = Array.isArray(input.media)
    ? (input.media as unknown[])
        .slice(0, MAX_MEDIA)
        .map((item): ClientMedia | null => {
          if (!item || typeof item !== 'object') return null;
          const entry = item as Record<string, unknown>;
          const url = httpUrl(entry.url, allowedHosts);
          if (!url) return null;
          return {
            type: (MEDIA_TYPES as readonly string[]).includes(entry.type as string)
              ? (entry.type as ClientMedia['type'])
              : 'image',
            url,
            poster: httpUrl(entry.poster, allowedHosts)
          };
        })
        .filter((item): item is ClientMedia => item !== null)
    : [];

  const metadata: ClientMetadata = {
    platform,
    kind,
    canonicalUrl: httpUrl(input.canonicalUrl),
    title: str(input.title, MAX_SHORT),
    text: str(input.text, MAX_TEXT, true),
    author: str(input.author, MAX_SHORT),
    authorHandle: str(input.authorHandle, MAX_SHORT),
    authorAvatar: httpUrl(input.authorAvatar, allowedHosts),
    publishedAt: isoDate(input.publishedAt),
    media,
    lang: str(input.lang, 16),
    extractedBy: str(input.extractedBy, 64),
    extractedAt: isoDate(input.extractedAt),
    pageUrl: httpUrl(input.pageUrl)
  };

  // Nothing worth carrying: behave as if the field was never sent.
  const hasContent = metadata.title || metadata.text || metadata.author || media.length > 0;
  return hasContent ? metadata : null;
}

const TITLED_PLATFORMS = new Set<ClientPlatform>(['youtube', 'reddit', 'pinterest']);

const PUBLISHERS: Record<ClientPlatform, string | undefined> = {
  twitter: 'X',
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  youtube: 'YouTube',
  mastodon: 'Mastodon',
  pinterest: 'Pinterest',
  web: undefined
};

function truncateForTitle(text?: string): string | undefined {
  if (!text) return undefined;
  const firstLine = text.split('\n')[0].trim();
  if (!firstLine) return undefined;
  if (firstLine.length <= 120) return firstLine;
  return `${firstLine.slice(0, 117).trimEnd()}…`;
}

/**
 * Projects client metadata onto metascraper's output shape, so the save path
 * can merge it without knowing where each field came from.
 */
export function clientMetadataAsScrape(metadata: ClientMetadata) {
  // Platforms where a post genuinely has a headline of its own, so composing
  // "@handle: first line" over the top of it would throw away the better
  // title. A tweet or a Reel has no such field; a YouTube video, a Reddit
  // submission and a Pin all do.
  const hasOwnTitle =
    TITLED_PLATFORMS.has(metadata.platform) && Boolean(metadata.title);
  const isSocialPost =
    metadata.platform !== 'web' && metadata.kind !== 'website' && !hasOwnTitle;

  // A social post has no headline. Composing one from the handle and the
  // opening line gives the card something readable instead of "Instagram".
  const composed = isSocialPost
    ? [metadata.authorHandle || metadata.author, truncateForTitle(metadata.text)]
        .filter(Boolean)
        .join(': ')
    : undefined;

  return {
    title: composed || metadata.title || undefined,
    description: metadata.text || undefined,
    author: metadata.author || metadata.authorHandle || undefined,
    date: metadata.publishedAt || undefined,
    // The cover is the post's *first* piece of media, which for a carousel is
    // the frame the platform itself shows first. Reaching past it for whichever
    // entry happened to carry a poster put a video thumbnail from slide four on
    // the card of a post whose first slide is a photo. A video entry's own
    // `url` is already its poster frame — we never store a playable stream — so
    // this stays right for a video post too.
    image: metadata.media[0]?.poster || metadata.media[0]?.url || undefined,
    publisher: PUBLISHERS[metadata.platform],
    lang: metadata.lang || undefined
  };
}

/**
 * Whether this extraction should overwrite the scrape rather than only fill its
 * gaps.
 *
 * Two cases qualify. On a login-walled host, anything metascraper produced came
 * from a login page rather than the post. And an extraction marked
 * `server:<platform>` came from that platform's own API — a structured post
 * body, not an og: card — which beats metascraper even on an open host like
 * bsky.app, where the scrape succeeds but only ever yields the generic card.
 */
function isAuthoritative(metadata: ClientMetadata, url: string): boolean {
  return isLoginWalledHost(url) || (metadata.extractedBy?.startsWith('server:') ?? false);
}

/**
 * Merges a client extraction over a scrape result.
 *
 * An authoritative extraction (see above) wins outright. Everything else only
 * fills gaps, since metascraper is the better general extractor.
 */
export function mergeClientMetadata(
  scraped: Record<string, any> | null | undefined,
  metadata: ClientMetadata | null,
  url: string
): Record<string, any> | null | undefined {
  if (!metadata) return scraped;

  const client = clientMetadataAsScrape(metadata);
  const clientWins = isAuthoritative(metadata, url);
  const merged: Record<string, any> = { ...(scraped || {}) };

  for (const [key, value] of Object.entries(client)) {
    if (value === undefined) continue;
    if (clientWins || !merged[key]) merged[key] = value;
  }

  return merged;
}
