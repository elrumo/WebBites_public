/**
 * App Store / Google Play listings.
 *
 * A saved link to an app page becomes an app card: icon, screenshots, rating,
 * developer, size and the rest of the store's own "Information" block. The
 * result lives in two places:
 *
 *  - the shared `AppListings` class, one row per store + app id, which holds
 *    the screenshots re-hosted on our own storage. A second save of the same
 *    app — by anyone — reads that row instead of fetching and re-uploading.
 *  - `websites.appListing`, a copy of the listing JSON so every client renders
 *    it from the bookmark row alone, the same way `clientMetadata` works.
 *
 * Nothing here may fail a save: every entry point resolves to null on trouble.
 */

import Parse from 'parse/node.js';

export interface AppListing {
  store: 'appstore' | 'playstore';
  appId: string;
  /** Canonical store page — what the Install button opens. */
  storeUrl: string;
  name: string;
  subtitle?: string;
  developer?: string;
  /** The developer's own website. */
  developerUrl?: string;
  privacyUrl?: string;
  icon?: string;
  screenshots: string[];
  description?: string;
  /** 0–5. */
  rating?: number;
  ratingCount?: number;
  /** As the store words it: "12+", "Parental guidance". */
  ageRating?: string;
  category?: string;
  /** "Free", "$4.99". */
  price?: string;
  sizeBytes?: number;
  /** ISO 639-1 codes, upper case. Play does not publish them. */
  languages: string[];
  /** "iOS 16.1" — the store's compatibility line. */
  minOS?: string;
  version?: string;
  releaseNotes?: string;
  updatedAt?: string;
  releasedAt?: string;
  inAppPurchases?: boolean;
  copyright?: string;
  /** Play only: "1,000,000,000+". */
  installs?: string;
  bundleId?: string;
  fetchedAt: string;
}

/**
 * What a bookmark card shows of an app. The full listing stays out of list
 * queries and the search index (it is description, notes and ten screenshots),
 * so this small summary rides on its own column — name, developer and icon are
 * already `siteTitle`, `siteAuthor` and `siteLogo`.
 */
export interface AppCard {
  store: AppListing['store'];
  rating?: number;
  ratingCount?: number;
  category?: string;
  price?: string;
  /** The store's one-line tagline: "Songs, Playlists & Audiobooks". */
  subtitle?: string;
  /** The first few screenshots — the card shows a row of them. */
  screenshots: string[];
}

const CARD_SCREENSHOTS = 3;

export function appCardOf(l: AppListing): AppCard {
  return {
    store: l.store,
    rating: l.rating,
    ratingCount: l.ratingCount,
    category: l.category,
    price: l.price,
    subtitle: l.subtitle,
    screenshots: l.screenshots.slice(0, CARD_SCREENSHOTS)
  };
}

export interface ParsedAppUrl {
  store: 'appstore' | 'playstore';
  appId: string;
  /** Apple storefront (`us`) or Play `gl`. */
  country: string;
  /** Play `hl`. */
  lang: string;
}

const MAX_SCREENSHOTS = 10;
const REFRESH_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** We fetch these server-side, so only the stores' own image CDNs qualify. */
const IMAGE_HOSTS = [/(^|\.)mzstatic\.com$/, /(^|\.)googleusercontent\.com$/];
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function parseAppUrl(url: string): ParsedAppUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'apps.apple.com' || host === 'itunes.apple.com') {
    const id = u.pathname.match(/\/id(\d+)/)?.[1];
    if (!id || !/\/app\//.test(u.pathname)) return null;
    const country = u.pathname.match(/^\/([a-z]{2})\//)?.[1] || 'us';
    return { store: 'appstore', appId: id, country, lang: 'en' };
  }
  if (host === 'play.google.com' && u.pathname.startsWith('/store/apps/details')) {
    const id = u.searchParams.get('id') || '';
    if (!/^[A-Za-z][\w]*(\.[\w]+)+$/.test(id)) return null;
    const lang = (u.searchParams.get('hl') || 'en').replace('_', '-');
    return {
      store: 'playstore',
      appId: id,
      country: (u.searchParams.get('gl') || 'US').toUpperCase(),
      lang: /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(lang) ? lang : 'en'
    };
  }
  return null;
}

export const listingKey = (p: Pick<ParsedAppUrl, 'store' | 'appId'>) => `${p.store}:${p.appId}`;

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const cleaned = v.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
};
/** Play ships descriptions as HTML. Clients draw text nodes, so flatten it here. */
const plainText = (v: unknown, max: number): string | undefined =>
  typeof v === 'string'
    ? text(
        v
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|li|div)>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
        max
      )
    : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined;
const httpUrl = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || v.length > 2048) return undefined;
  try {
    const u = new URL(v.startsWith('//') ? `https:${v}` : v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const imageUrl = (v: unknown): string | undefined => {
  const href = httpUrl(v);
  return href && IMAGE_HOSTS.some((p) => p.test(new URL(href).hostname)) ? href : undefined;
};
const iso = (v: unknown): string | undefined => {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

/** Apple thumbnails are resized by the URL: swap the size for a sharper one. */
const appleSized = (url: string, scale: number): string =>
  url.replace(/\/(\d+)x(\d+)(bb|w|h)?\.(png|jpg|jpeg|webp)$/, (_m, w, h) => `/${w * scale}x${h * scale}bb.jpg`);

export function appleToListing(r: any, extras: { inAppPurchases?: boolean; copyright?: string; privacyUrl?: string; subtitle?: string } = {}): AppListing | null {
  const name = text(r?.trackName, 200);
  if (!name || !r?.trackId) return null;
  const phone: string[] = Array.isArray(r.screenshotUrls) ? r.screenshotUrls : [];
  const shots = (phone.length ? phone : Array.isArray(r.ipadScreenshotUrls) ? r.ipadScreenshotUrls : [])
    .map((u: string) => imageUrl(appleSized(u, 2)))
    .filter(Boolean)
    .slice(0, MAX_SCREENSHOTS);
  const price = typeof r.formattedPrice === 'string' ? r.formattedPrice : r.price === 0 ? 'Free' : undefined;
  return {
    store: 'appstore',
    appId: String(r.trackId),
    storeUrl: `https://apps.apple.com/app/id${r.trackId}`,
    name,
    subtitle: plainText(extras.subtitle, 300),
    developer: text(r.sellerName || r.artistName, 200),
    developerUrl: httpUrl(r.sellerUrl),
    privacyUrl: httpUrl(extras.privacyUrl),
    icon: imageUrl(r.artworkUrl512 || r.artworkUrl100),
    screenshots: shots,
    description: text(r.description, 5000),
    rating: num(r.averageUserRating),
    ratingCount: num(r.userRatingCount),
    ageRating: text(r.contentAdvisoryRating, 40),
    category: text(r.primaryGenreName, 80),
    price: text(price, 40),
    sizeBytes: num(r.fileSizeBytes),
    languages: (Array.isArray(r.languageCodesISO2A) ? r.languageCodesISO2A : []).map((l: unknown) => text(l, 8)).filter(Boolean) as string[],
    minOS: r.minimumOsVersion ? `iOS ${text(r.minimumOsVersion, 20)}` : undefined,
    version: text(r.version, 40),
    releaseNotes: text(r.releaseNotes, 3000),
    updatedAt: iso(r.currentVersionReleaseDate),
    releasedAt: iso(r.releaseDate),
    inAppPurchases: extras.inAppPurchases,
    copyright: text(extras.copyright, 300),
    bundleId: text(r.bundleId, 200),
    fetchedAt: new Date().toISOString()
  };
}

/** The Play page ships its data as `AF_initDataCallback` blobs; the app is the
 * one with both a title at `[0][0]` and a developer at `[68][0]`. The index paths below are the same ones
 * the google-play-scraper package reads. */
function playBlob(html: string): any[] | null {
  for (const m of html.matchAll(/AF_initDataCallback\(\{key: 'ds:\d+', hash: '[^']*', data:(.*?), sideChannel/gs)) {
    try {
      const data = JSON.parse(m[1])?.[1]?.[2];
      if (typeof data?.[0]?.[0] === 'string' && typeof data?.[68]?.[0] === 'string') return data;
    } catch {
      // not the blob we want
    }
  }
  return null;
}

export function playToListing(html: string, appId: string, country = 'US'): AppListing | null {
  const d = playBlob(html);
  if (!d) return null;
  const at = (...path: number[]) => path.reduce<any>((x, i) => x?.[i], d);
  const name = text(at(0, 0), 200);
  if (!name) return null;

  let ld: any = {};
  const ldRaw = html.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)?.[1];
  try { if (ldRaw) ld = JSON.parse(ldRaw); } catch { /* ld+json only supplies the price */ }
  const offer = Array.isArray(ld.offers) ? ld.offers[0] : undefined;
  const price = offer ? (Number(offer.price) === 0 ? 'Free' : `${offer.price} ${offer.priceCurrency || ''}`.trim()) : undefined;

  const shots = ((at(78, 0) as any[]) || [])
    .map((s) => imageUrl(s?.[3]?.[2]))
    .filter(Boolean)
    .map((u) => `${u}=w720`)
    .slice(0, MAX_SCREENSHOTS) as string[];
  const icon = imageUrl(at(95, 0, 3, 2));

  return {
    store: 'playstore',
    appId,
    storeUrl: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
    name,
    subtitle: plainText(at(73, 0, 1), 300),
    developer: text(at(68, 0), 200),
    developerUrl: httpUrl(at(69, 0, 5, 2)),
    privacyUrl: httpUrl(at(99, 0, 5, 2)),
    icon: icon && `${icon}=s512`,
    screenshots: shots.filter((u) => !!u),
    description: plainText(at(72, 0, 1), 5000),
    rating: num(at(51, 0, 1)),
    ratingCount: num(at(51, 2, 1)),
    ageRating: text(at(9, 0), 40),
    category: text(at(79, 0, 0, 0), 80),
    price: text(price, 40),
    languages: [],
    updatedAt: iso(typeof at(145, 0, 1, 0) === 'number' ? at(145, 0, 1, 0) * 1000 : undefined),
    releasedAt: iso(at(10, 0)),
    inAppPurchases: Boolean(at(19, 0)),
    installs: text(at(13, 0), 40),
    bundleId: appId,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchText(url: string, accept: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': BROWSER_UA, Accept: accept } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchApple(p: ParsedAppUrl): Promise<AppListing | null> {
  const lookup = await fetchText(`https://itunes.apple.com/lookup?id=${p.appId}&country=${p.country}`, 'application/json');
  let result: any;
  try { result = JSON.parse(lookup || '')?.results?.[0]; } catch { return null; }
  if (!result || result.kind === undefined) return null;

  // The lookup API has no in-app-purchase flag, copyright or privacy link, so
  // read them off the page itself — best effort, the listing stands without.
  const page = (await fetchText(`https://apps.apple.com/${p.country}/app/id${p.appId}`, 'text/html')) || '';
  const extras = {
    // ponytail: the first match is the app's own record; later ones belong to "you might also like" apps.
    inAppPurchases: ((m) => (m ? m[1] === 'true' : undefined))(page.match(/"hasInAppPurchases":(true|false)/)),
    copyright: page.match(/"title":"Copyright","summary":"([^"]*)"/)?.[1],
    subtitle: page.match(/<p class="subtitle[^"]*">([^<]*)<\/p>/)?.[1],
    privacyUrl: page.match(/"actionUrl":"([^"]+)","location":\[\{[^\]]*?"id":"privacyPolicy"/)?.[1]
  };
  return appleToListing(result, extras);
}

async function fetchPlay(p: ParsedAppUrl): Promise<AppListing | null> {
  const html = await fetchText(
    `https://play.google.com/store/apps/details?id=${encodeURIComponent(p.appId)}&hl=${p.lang}&gl=${p.country}`,
    'text/html'
  );
  return html ? playToListing(html, p.appId, p.country) : null;
}

const fetchListing = (p: ParsedAppUrl) => (p.store === 'appstore' ? fetchApple(p) : fetchPlay(p));

/** Copies the icon and screenshots onto our own storage, up to four at a time. */
async function rehostImages(listing: AppListing): Promise<AppListing> {
  // Imported here so the parsing half of this file stays testable without the server's runtime.
  const { createFileName } = await import('#root/server/utils/serverUtils.js');
  const urls = [listing.icon, ...listing.screenshots];
  const out: Array<string | null> = new Array(urls.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      const i = next++;
      const src = urls[i];
      if (!src) continue;
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 10 * 1024 * 1024) continue;
        const type = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const name = createFileName('appListing', `app_${listing.store}_${listing.appId}_${i}`, ext, 'appListing');
        const file = new Parse.File(name, { base64: buffer.toString('base64') }, type);
        await file.save({ useMasterKey: true });
        out[i] = file.url();
      } catch (error: any) {
        console.warn(`[appListing] image ${i} of ${listing.appId} not re-hosted: ${error?.message || error}`);
      }
    }
  });
  await Promise.all(workers);
  // A slide we could not copy keeps its store URL rather than dropping out.
  return {
    ...listing,
    icon: listing.icon ? out[0] || listing.icon : undefined,
    screenshots: listing.screenshots.map((u, i) => out[i + 1] || u)
  };
}

/**
 * The listing for an app URL: from the shared row when we have one that is
 * fresh, otherwise fetched, re-hosted and stored for the next saver.
 */
export async function getAppListing(url: string): Promise<AppListing | null> {
  const parsed = parseAppUrl(url);
  if (!parsed) return null;
  try {
    const key = listingKey(parsed);
    // ponytail: no unique index on `key`, so two first-ever saves racing can store two rows; `.first()` takes the older one. Add a unique index if it ever matters.
    const row = await new Parse.Query('AppListings').equalTo('key', key).ascending('createdAt').first({ useMasterKey: true });
    const cached: AppListing | undefined = row?.get('listing');
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < REFRESH_AFTER_MS) return cached;

    const fresh = await fetchListing(parsed);
    // A store that is down or rate-limiting us: stale beats nothing.
    if (!fresh) return cached || null;

    const stored = await rehostImages(fresh);
    const target = row || new Parse.Object('AppListings');
    target.set('key', key);
    target.set('listing', stored);
    // No public access: only the server (master key) reads or writes this class.
    if (!row) target.setACL(new Parse.ACL());
    await target.save(null, { useMasterKey: true });
    return stored;
  } catch (error: any) {
    console.warn(`[appListing] ${url} failed: ${error?.message || error}`);
    return null;
  }
}

/**
 * Attaches the listing to a bookmark row and lets the app's own name, developer
 * and icon replace what the page scrape produced. Returns whether the row
 * changed and needs saving.
 */
export async function applyAppListing(website: Parse.Object, url: string): Promise<boolean> {
  const listing = await getAppListing(url);
  if (!listing) return false;
  website.set('appListing', listing);
  website.set('appCard', appCardOf(listing));
  website.set('siteTitle', listing.name);
  if (listing.developer) website.set('siteAuthor', listing.developer);
  if (listing.icon) website.set('siteLogo', listing.icon);
  website.set('siteDescription', (listing.subtitle || listing.description || '').slice(0, 300) || null);
  // The scrape of an app page can come back empty or as a wall; the first
  // screenshot (else the icon) is a better cover than nothing.
  if (!website.get('OGImage') && !website.get('OGImageFile')) website.set('OGImage', listing.screenshots[0] || listing.icon);
  return true;
}
