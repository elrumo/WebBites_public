/**
 * Shared types for the social post resolvers.
 *
 * A resolver's job is to turn a post permalink into the *same* raw shape the
 * browser extension's `extract.js` produces. It deliberately stops there: the
 * result goes through `sanitizeClientMetadata` like any other client payload,
 * so the media-host allowlist and the length caps apply identically whether the
 * JSON came from a page we don't control or from a platform API.
 *
 * That means a resolver never has to be careful. It can pass through whatever
 * the upstream API said and let the sanitizer be the single place that decides
 * what is safe to store and fetch.
 */

import type { ClientPlatform } from '../clientMetadata';

/** The un-sanitized shape a resolver returns — mirrors `extract.js`'s output. */
export interface RawExtraction {
  platform: ClientPlatform;
  kind: 'post' | 'video' | 'website';
  canonicalUrl?: string;
  title?: string;
  text?: string;
  author?: string;
  authorHandle?: string;
  authorAvatar?: string;
  publishedAt?: string;
  media?: Array<{ type: 'image' | 'video'; url?: string; poster?: string }>;
  lang?: string;
  /** Always `server:<platform>`. `mergeClientMetadata` reads this prefix to
   * decide the extraction is authoritative over metascraper. */
  extractedBy: string;
  extractedAt?: string;
  pageUrl?: string;
}

export interface ResolverContext {
  /** The permalink being saved, already normalized to an absolute https URL. */
  url: string;
  /** Parsed form of `url`, so each resolver doesn't re-parse it. */
  parsed: URL;
  /** Hostname with a leading `www.` stripped. */
  host: string;
}

export type Resolver = (context: ResolverContext) => Promise<RawExtraction | null>;

/** Request timeout for a resolver's own upstream call. Deliberately short: a
 * resolver runs inline on the save path, and a slow one must not hold up the
 * bookmark row appearing. Everything degrades to the normal scrape. */
export const RESOLVER_TIMEOUT_MS = 6_000;

/** A resolver is best-effort by definition — an upstream that is down, rate
 * limited, or has changed its response shape must never fail the save. */
export async function attempt<T>(
  label: string,
  fn: () => Promise<T | null>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error: any) {
    console.warn(`[socialResolvers] ${label} failed:`, error?.message || error);
    return null;
  }
}

/** `fetch` with a timeout and a JSON body, or null on anything unexpected. */
export async function getJson<T = any>(
  url: string,
  init: RequestInit = {},
  timeoutMs = RESOLVER_TIMEOUT_MS
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // Several of these endpoints (TikTok's oEmbed in particular) answer
        // differently, or not at all, to a request with no User-Agent.
        'User-Agent': 'WebBites/1.0',
        ...(init.headers || {})
      }
    });
    if (!response.ok) {
      console.warn(`[socialResolvers] ${url} returned HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** First non-empty string, trimmed. Resolvers pass several candidate fields. */
export const firstText = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};
