/**
 * Feed parsing for the RSS reader.
 *
 * Everything in this module is pure: it takes strings in and gives plain
 * objects back, never touching Parse, the network or the filesystem. That is
 * deliberate — feed XML in the wild is chaotic enough that the only way to
 * stay ahead of it is a fixture-driven test suite, and that only works if the
 * parser can be called with a string.
 *
 * Three families of feed exist and users do not know or care which one they
 * subscribed to:
 *   RSS 2.0  — <rss><channel><item>
 *   Atom 1.0 — <feed><entry>
 *   RDF/RSS1 — <rdf:RDF><channel> + sibling <item> elements
 *
 * `parseFeed` normalises all three into one shape. Namespace prefixes are
 * stripped by the XML parser, so `content:encoded` arrives as `encoded` and
 * `dc:creator` as `creator`.
 *
 * Run the tests with:  npm run test:rssParser
 */

import { XMLParser } from 'fast-xml-parser';
import { decodeHTMLAttribute, decodeHTMLStrict } from 'entities';
import { htmlToText, sanitizeArticleHtml } from './contentExtraction';

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface ParsedFeedItem {
    /** Stable per-feed identity: <guid>, <id> or the link, in that order. */
    guid: string;
    link: string | null;
    title: string;
    author: string | null;
    publishedAt: Date | null;
    /** Sanitised article HTML as the feed shipped it. May be empty. */
    contentHtml: string;
    /** Plain-text mirror of `contentHtml`, capped by the caller. */
    contentText: string;
    imageUrl: string | null;
}

export interface ParsedFeed {
    title: string;
    /** The human-facing site the feed belongs to, not the feed URL itself. */
    siteUrl: string | null;
    description: string | null;
    iconUrl: string | null;
    language: string | null;
    /** Newest first is *not* guaranteed by feeds — callers must not rely on order. */
    items: ParsedFeedItem[];
}

export interface OpmlEntry {
    title: string;
    xmlUrl: string;
    htmlUrl: string | null;
    category: string | null;
}

export interface DiscoveredFeedLink {
    url: string;
    title: string | null;
    /** The `type` attribute the page advertised, when it gave one. */
    mimeType: string | null;
}

/** Feed bodies are stored in a Parse column, so they need a hard ceiling. */
export const RSS_CONTENT_HTML_LIMIT = 64_000;
/** Mirrors the `websites.siteBody` cap so summaries and TTS behave identically. */
export const RSS_CONTENT_TEXT_LIMIT = 8_000;

// ─── XML plumbing ────────────────────────────────────────────────────────────

/**
 * One parser instance, reused. `removeNSPrefix` is what lets the rest of this
 * file read `encoded` / `creator` / `origLink` without caring which of the
 * dozen namespace spellings a publisher picked.
 *
 * `parseTagValue: false` keeps everything a string: without it a numeric guid
 * (`<guid>12345</guid>`, extremely common on WordPress) comes back as a number
 * and the dedup key changes shape between feeds.
 */
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    textNodeName: '#text',
    processEntities: true,
});

/** Coerces the parser's string | object | array union into a single node. */
function first<T = any>(value: any): T | null {
    if (value === undefined || value === null) return null;
    return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Coerces the same union into an array, dropping empties. */
function many(value: any): any[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined) : [value];
}

/**
 * Reads the text of a node that may be a bare string, a `{'#text': …}` object
 * or an array of either. Returns '' rather than null so callers can `.trim()`
 * without guarding.
 */
function text(value: any): string {
    const node = first(value);
    if (node === null) return '';
    if (typeof node === 'string') return node.trim();
    if (typeof node === 'number' || typeof node === 'boolean') return String(node);
    if (typeof node === 'object') {
        const inner = node['#text'];
        if (typeof inner === 'string') return inner.trim();
        if (typeof inner === 'number') return String(inner);
    }
    return '';
}

function attr(node: any, name: string): string | null {
    if (!node || typeof node !== 'object') return null;
    const value = node[`@_${name}`];
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    return str.length ? str : null;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * Feeds date items in RFC 822 (`Tue, 03 Jun 2003 09:39:21 GMT`), ISO 8601, and
 * a long tail of near-misses. `Date` handles the first two; the rest are worth
 * one repair pass before giving up, because a null date sends an item to the
 * bottom of every list forever.
 */
export function parseFeedDate(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;

    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return clampDate(direct);

    // `2024-01-05 09:12:00` — a space where ISO wants a T.
    const spaced = value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(:\d{2})?)/, '$1T$2');
    if (spaced !== value) {
        const repaired = new Date(spaced);
        if (!Number.isNaN(repaired.getTime())) return clampDate(repaired);
    }

    // A trailing named zone `... 09:39:21 PDT` that V8 rejects on some builds.
    const stripped = value.replace(/\s+[A-Z]{2,5}$/, ' GMT');
    if (stripped !== value) {
        const repaired = new Date(stripped);
        if (!Number.isNaN(repaired.getTime())) return clampDate(repaired);
    }

    // Unix seconds, occasionally seen in hand-rolled feeds.
    if (/^\d{9,11}$/.test(value)) return clampDate(new Date(Number(value) * 1000));

    return null;
}

/**
 * A date far in the future pins an item to the top of every list — some feeds
 * genuinely publish `2099`. Anything beyond a day ahead is treated as unusable
 * so the caller falls back to "seen now".
 */
function clampDate(date: Date): Date | null {
    const time = date.getTime();
    if (!Number.isFinite(time)) return null;
    if (time > Date.now() + 24 * 60 * 60 * 1000) return null;
    // Before 1990 is a parse artefact, not a publication date.
    if (time < 631_152_000_000) return null;
    return date;
}

// ─── URLs ────────────────────────────────────────────────────────────────────

/** Resolves a possibly-relative feed URL against its base, or null. */
export function resolveUrl(href: string | null | undefined, base: string | null | undefined): string | null {
    if (!href) return null;
    const value = String(href).trim();
    if (!value) return null;
    try {
        return base ? new URL(value, base).toString() : new URL(value).toString();
    } catch {
        return null;
    }
}

/**
 * Normalises a feed URL for the unique index on `rssFeeds.feedUrl`.
 *
 * Two users pasting `https://example.com/feed` and `https://example.com/feed/`
 * must land on the same shared feed row, otherwise the whole "poll once for
 * everyone" design quietly degrades into one poll per user. Query strings are
 * preserved — plenty of feeds are `?feed=rss2` — but the fragment is not.
 */
export function normalizeFeedUrl(raw: string): string {
    const url = new URL(raw.trim());
    url.hash = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
        url.port = '';
    }
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
}

// ─── Feed detection ──────────────────────────────────────────────────────────

/**
 * Cheap sniff used before spending a full parse: does this body look like a
 * feed rather than a web page? Checked against the first few KB because some
 * feeds carry long stylesheet processing instructions up top.
 */
export function looksLikeFeedXml(body: string | null | undefined): boolean {
    if (!body) return false;
    const head = body.slice(0, 4096).toLowerCase();
    return /<(rss|feed|rdf:rdf)[\s>]/.test(head);
}

/**
 * Pulls `<link rel="alternate" type="application/rss+xml">` candidates out of a
 * page. Regex rather than jsdom on purpose: this runs on arbitrary pages during
 * subscribe, where the cost of standing up a DOM for four attributes is not
 * worth paying, and malformed head markup breaks parsers more often than it
 * breaks a tag scan.
 */
export function discoverFeedLinksInHtml(html: string, baseUrl: string): DiscoveredFeedLink[] {
    if (!html) return [];

    const found: DiscoveredFeedLink[] = [];
    const seen = new Set<string>();

    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
        const rel = (tag.match(/\brel\s*=\s*["']?([^"'>\s]+)/i) || [])[1];
        if (!rel || !/alternate/i.test(rel)) continue;

        const type = (tag.match(/\btype\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || '';
        const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || tag.match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1];
        // An untyped alternate whose address plainly *is* a feed still counts:
        // plenty of sites (macosicons.com's changelog, for one) omit `type`.
        // `hreflang` alternates are page translations and never match this.
        const looksLikeFeedHref = !!href && /(\.(rss|atom|xml)|\/(feed|rss|atom))(\?|#|\/?$)/i.test(href);
        if (!/(rss|atom|rdf)\+?xml/i.test(type) && !looksLikeFeedHref) continue;

        const resolved = resolveUrl(href, baseUrl);
        if (!resolved || seen.has(resolved)) continue;

        seen.add(resolved);
        const titleMatch = tag.match(/\btitle\s*=\s*["']([^"']*)["']/i);
        found.push({
            url: resolved,
            title: titleMatch ? decodeHTMLAttribute(titleMatch[1]).trim() || null : null,
            mimeType: type || null,
        });
    }

    return found;
}

/**
 * Site-specific feeds for pages that do not advertise them in HTML.
 * These are the small, high-value rules used by RSS Lookup as well.
 */
export function discoverSiteFeedUrls(rawUrl: string): string[] {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return [];
    }

    const host = url.hostname.toLowerCase();
    const found = new Set<string>();
    const add = (feedUrl: string) => found.add(feedUrl);

    if (['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(host)) {
        const path = url.pathname === '/' ? '/.rss' : `${url.pathname.replace(/\/$/, '')}.rss`;
        add(new URL(`${path}${url.search}`, url.origin).toString());
    }

    if (host === 'youtube.com' || host === 'www.youtube.com') {
        const channel = url.pathname.match(/^\/channel\/(UC[\w-]+)/)?.[1];
        const user = url.pathname.match(/^\/user\/([\w-]+)/)?.[1];
        const playlist = url.searchParams.get('list');
        if (channel) add(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);
        if (user) add(`https://www.youtube.com/feeds/videos.xml?user=${user}`);
        if (playlist?.startsWith('PL')) {
            add(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist)}`);
        }
    }

    const stackSites = ['stackoverflow.com', 'serverfault.com', 'superuser.com', 'askubuntu.com', 'stackapps.com'];
    if (host.endsWith('stackexchange.com') || stackSites.includes(host)) {
        const tag = url.pathname.match(/^\/questions\/tagged\/([\w.+-]+)/)?.[1];
        const question = url.pathname.match(/^\/questions\/(\d+)/)?.[1];
        const user = url.pathname.match(/^\/users\/(\d+)/)?.[1];
        if (tag) add(`${url.origin}/feeds/tag/${tag}`);
        if (question) add(`${url.origin}/feeds/question/${question}`);
        if (user) add(`${url.origin}/feeds/user/${user}`);
    }

    return [...found];
}

/** Paths worth trying when a site advertises no feed at all. */
const FEED_PATHS = [
    'feed', 'feed/', 'rss', 'rss/', 'feed.xml', 'rss.xml', 'atom.xml', 'atom',
    'feed.rss', 'index.xml', 'index.rss',
];
/** Changelog and blog feeds that live one level below the root. */
const NESTED_FEED_PATHS = ['changelog.rss', 'changelog/rss.xml', 'changelog/feed', 'blog/rss.xml', 'blog/feed'];

/**
 * Feed URLs to guess for a page that advertises none, most specific first:
 * under the pasted path (`example.com/blog` → `/blog/feed`), then the root.
 * The path is joined by hand because `new URL('feed', 'https://x.com/blog')`
 * lands on the root, which found `/changelog.rss` for `stripe.com/blog`.
 */
export function feedUrlGuesses(pageUrl: string): string[] {
    let url: URL;
    try {
        url = new URL(pageUrl);
    } catch {
        return [];
    }

    const path = url.pathname.replace(/\/+$/, '');
    const bases = path ? [`${url.origin}${path}/`, `${url.origin}/`] : [`${url.origin}/`];
    const guesses = [
        ...bases.flatMap((base) => FEED_PATHS.map((feedPath) => base + feedPath)),
        ...NESTED_FEED_PATHS.map((feedPath) => `${url.origin}/${feedPath}`),
    ];
    return [...new Set(guesses)].filter((guess) => guess !== pageUrl);
}

// ─── Feed parsing ────────────────────────────────────────────────────────────

/**
 * Parses feed XML into the normalised shape. Throws only when the body is not
 * XML we recognise at all — a feed with zero items is a valid feed, and dead
 * items inside a good feed are skipped rather than failing the batch.
 */
export function parseFeed(xml: string, feedUrl: string): ParsedFeed {
    if (!xml || !xml.trim()) {
        throw new Error('Empty feed body');
    }

    let doc: any;
    try {
        doc = parser.parse(xml);
    } catch (error) {
        throw new Error(`Feed is not well-formed XML: ${(error as Error).message}`);
    }

    if (!doc || typeof doc !== 'object') {
        throw new Error('Feed is not well-formed XML');
    }

    if (doc.rss) return parseRss2(first(doc.rss), feedUrl);
    if (doc.feed) return parseAtom(first(doc.feed), feedUrl);
    if (doc.RDF) return parseRdf(first(doc.RDF), feedUrl);

    // Some servers wrap the document in a stylesheet PI plus whitespace and the
    // parser reports the channel at the root.
    if (doc.channel) return parseRss2(doc, feedUrl);

    throw new Error('Unrecognised feed format (no rss, feed or RDF root)');
}

function parseRss2(rss: any, feedUrl: string): ParsedFeed {
    const channel = first(rss?.channel) || {};
    const siteUrl = resolveUrl(text(channel.link) || attrOfLink(channel.link), feedUrl);

    return {
        title: plain(text(channel.title)) || hostnameOf(feedUrl),
        siteUrl,
        description: plain(text(channel.description) || text(channel.subtitle)) || null,
        iconUrl: rssChannelIcon(channel, siteUrl || feedUrl),
        language: text(channel.language) || null,
        items: many(channel.item).map((item) => parseRssItem(item, siteUrl || feedUrl)).filter(isUsableItem),
    };
}

/**
 * RDF/RSS 1.0 keeps `<item>` as a sibling of `<channel>` rather than a child.
 * The item shape is otherwise close enough to RSS 2.0 to share a reader.
 */
function parseRdf(rdf: any, feedUrl: string): ParsedFeed {
    const channel = first(rdf?.channel) || {};
    const siteUrl = resolveUrl(text(channel.link), feedUrl);

    return {
        title: plain(text(channel.title)) || hostnameOf(feedUrl),
        siteUrl,
        description: plain(text(channel.description)) || null,
        iconUrl: rssChannelIcon(channel, siteUrl || feedUrl),
        language: text(channel.language) || null,
        items: many(rdf?.item).map((item) => parseRssItem(item, siteUrl || feedUrl)).filter(isUsableItem),
    };
}

function parseRssItem(item: any, baseUrl: string): ParsedFeedItem {
    // `content:encoded` is the full post; `description` is usually a teaser.
    // Preferring encoded is what makes the Feed view worth reading at all.
    const rawHtml = text(item.encoded) || text(item.description) || text(item.summary) || '';
    const link =
        resolveUrl(text(item.origLink) || text(item.link) || attr(first(item.link), 'href'), baseUrl) ||
        resolveUrl(guidAsLink(item), baseUrl);

    const guid = text(item.guid) || link || text(item.title);

    return {
        guid,
        link,
        title: plain(text(item.title)) || 'Untitled',
        author: plain(text(item.creator) || text(item.author) || authorName(item.author) || '') || null,
        publishedAt: parseFeedDate(text(item.pubDate) || text(item.date) || text(item.published) || text(item.updated)),
        ...bodyOf(rawHtml),
        imageUrl: itemImage(item, rawHtml, baseUrl),
    };
}

function parseAtom(feed: any, feedUrl: string): ParsedFeed {
    const siteUrl = atomLink(feed?.link, feedUrl, ['alternate', null]);

    return {
        title: plain(text(feed?.title)) || hostnameOf(feedUrl),
        siteUrl,
        description: plain(text(feed?.subtitle) || text(feed?.tagline)) || null,
        iconUrl:
            resolveUrl(text(feed?.icon) || text(feed?.logo), siteUrl || feedUrl) ||
            faviconFor(siteUrl || feedUrl),
        language: attr(feed, 'lang') || text(feed?.language) || null,
        items: many(feed?.entry).map((entry) => parseAtomEntry(entry, siteUrl || feedUrl)).filter(isUsableItem),
    };
}

function parseAtomEntry(entry: any, baseUrl: string): ParsedFeedItem {
    // Atom `<content>` collides with `media:content` once namespaces are
    // stripped, so only take it when it actually carries text.
    const contentNode = first(entry.content);
    const contentText = contentNode && typeof contentNode === 'object' && !('#text' in contentNode)
        ? ''
        : text(entry.content);

    const rawHtml = contentText || text(entry.summary) || '';
    const link = atomLink(entry.link, baseUrl, ['alternate', null]) || resolveUrl(text(entry.id), baseUrl);
    const guid = text(entry.id) || link || text(entry.title);

    return {
        guid,
        link,
        title: plain(text(entry.title)) || 'Untitled',
        author: plain(text(first(entry.author)?.name) || text(entry.author) || text(entry.creator)) || null,
        publishedAt: parseFeedDate(text(entry.published) || text(entry.updated) || text(entry.issued)),
        ...bodyOf(rawHtml),
        imageUrl: itemImage(entry, rawHtml, baseUrl),
    };
}

/** An item with neither a guid nor a link cannot be deduped, so it is dropped. */
function isUsableItem(item: ParsedFeedItem): boolean {
    return Boolean(item.guid && item.guid.trim());
}

/**
 * Splits raw feed markup into the stored HTML and text pair. Both go through
 * the same sanitiser the bookmark reader uses, so an item body can never carry
 * a script or an inline handler into either client.
 */
function bodyOf(rawHtml: string): { contentHtml: string; contentText: string } {
    if (!rawHtml) return { contentHtml: '', contentText: '' };
    const contentHtml = sanitizeArticleHtml(rawHtml).slice(0, RSS_CONTENT_HTML_LIMIT);
    return { contentHtml, contentText: htmlToText(contentHtml, RSS_CONTENT_TEXT_LIMIT) };
}

/**
 * Plain-text feed fields (titles, authors, descriptions) as a reader should see
 * them. The XML parser resolves only the five XML entities and never looks
 * inside CDATA, so `Fortune&#8217;s`, `&rsquo;` and a WordPress
 * `<![CDATA[A &amp; B]]>` all reached clients still escaped.
 *
 * This is the one HTML decode, at ingest — never apply it to a stored value
 * again (`scripts/decode-rss-entities.ts` did the old rows exactly once). A
 * title may now contain a literal `<script>`; every client renders these
 * fields as text. Strict mode: a bare `&copy` without `;` is left as typed.
 */
export function plain(raw: string): string {
    if (!raw) return '';
    return decodeHTMLStrict(raw).replace(/\s+/g, ' ').trim();
}

/** `<guid isPermaLink="true">` doubles as the item link on many feeds. */
function guidAsLink(item: any): string | null {
    const guidNode = first(item.guid);
    if (!guidNode) return null;
    const value = text(item.guid);
    if (!/^https?:\/\//i.test(value)) return null;
    const isPermalink = attr(guidNode, 'isPermaLink');
    return isPermalink === 'false' ? null : value;
}

function authorName(author: any): string | null {
    const node = first(author);
    if (!node || typeof node !== 'object') return null;
    return text(node.name) || null;
}

/** `<link href=…>` used as an RSS channel link by a few generators. */
function attrOfLink(link: any): string | null {
    return attr(first(link), 'href');
}

/**
 * Picks an Atom `<link>` by rel. Atom feeds routinely carry a `self` link (the
 * feed itself) alongside the `alternate` (the page a human should open); taking
 * the first link blindly sends readers to the XML.
 */
function atomLink(links: any, baseUrl: string, preferredRels: (string | null)[]): string | null {
    const candidates = many(links);
    for (const rel of preferredRels) {
        for (const candidate of candidates) {
            if (typeof candidate === 'string') {
                if (rel === null || rel === 'alternate') return resolveUrl(candidate, baseUrl);
                continue;
            }
            const candidateRel = attr(candidate, 'rel');
            const matches = rel === null ? candidateRel === null : candidateRel === rel;
            if (!matches) continue;
            const href = attr(candidate, 'href');
            if (href) return resolveUrl(href, baseUrl);
        }
    }
    return null;
}

function rssChannelIcon(channel: any, baseUrl: string): string | null {
    const image = first(channel?.image);
    const fromImage = image ? resolveUrl(text(image.url) || attr(image, 'rdf:resource'), baseUrl) : null;
    return fromImage || resolveUrl(text(channel?.icon), baseUrl) || faviconFor(baseUrl);
}

/**
 * Feeds that ship no icon still need one in the sidebar, and every client
 * would otherwise invent its own guess. Google's endpoint is used rather than
 * `/favicon.ico` because it resolves apple-touch icons and manifest icons too.
 */
function faviconFor(url: string | null): string | null {
    if (!url) return null;
    try {
        const host = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
    } catch {
        return null;
    }
}

/**
 * Item artwork, best source first: an explicit enclosure or media element, then
 * the first image inside the body. The body scan matters — the majority of
 * WordPress feeds ship no media element at all but open the post with a photo.
 */
function itemImage(item: any, rawHtml: string, baseUrl: string): string | null {
    for (const node of many(item.enclosure)) {
        const type = attr(node, 'type') || '';
        const url = attr(node, 'url');
        if (url && (/^image\//i.test(type) || /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url))) {
            return resolveUrl(url, baseUrl);
        }
    }

    for (const key of ['thumbnail', 'content', 'group']) {
        for (const node of many(item[key])) {
            if (!node || typeof node !== 'object') continue;
            const medium = attr(node, 'medium');
            const type = attr(node, 'type') || '';
            const url = attr(node, 'url');
            if (url && (medium === 'image' || /^image\//i.test(type) || /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url))) {
                return resolveUrl(url, baseUrl);
            }
            // media:group nests media:content / media:thumbnail children.
            const nested = itemImage(node, '', baseUrl);
            if (nested) return nested;
        }
    }

    const inBody = rawHtml.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    return inBody ? resolveUrl(inBody[1], baseUrl) : null;
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

// ─── OPML ────────────────────────────────────────────────────────────────────

/**
 * Reads an OPML subscription list. Outlines nest arbitrarily deep — folders
 * inside folders — so this walks the tree and keeps every node that carries an
 * `xmlUrl`, remembering the nearest enclosing folder as its category.
 */
export function parseOpml(xml: string): OpmlEntry[] {
    if (!xml || !xml.trim()) throw new Error('Empty OPML body');

    let doc: any;
    try {
        doc = parser.parse(xml);
    } catch (error) {
        throw new Error(`OPML is not well-formed XML: ${(error as Error).message}`);
    }

    const body = first(first(doc?.opml)?.body);
    if (!body) throw new Error('OPML has no <body>');

    const entries: OpmlEntry[] = [];
    const seen = new Set<string>();

    const walk = (node: any, category: string | null) => {
        for (const outline of many(node?.outline)) {
            if (!outline || typeof outline !== 'object') continue;

            const xmlUrl = attr(outline, 'xmlUrl') || attr(outline, 'xmlurl');
            const title = attr(outline, 'title') || attr(outline, 'text') || '';

            if (xmlUrl) {
                const key = xmlUrl.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    entries.push({
                        title: title.trim() || hostnameOf(xmlUrl),
                        xmlUrl,
                        htmlUrl: attr(outline, 'htmlUrl') || attr(outline, 'htmlurl'),
                        category,
                    });
                }
            }

            // A folder outline has children and no xmlUrl of its own.
            if (outline.outline) {
                walk(outline, xmlUrl ? category : title.trim() || category);
            }
        }
    };

    walk(body, null);
    return entries;
}

export interface OpmlExportFeed {
    title: string;
    xmlUrl: string;
    htmlUrl?: string | null;
}

/** Serialises subscriptions as a flat OPML 2.0 document. */
export function buildOpml(feeds: OpmlExportFeed[], ownerTitle = 'WebBites Subscriptions'): string {
    const outlines = feeds
        .filter((feed) => feed.xmlUrl)
        .map((feed) => {
            const parts = [
                `text="${escapeXmlAttr(feed.title || hostnameOf(feed.xmlUrl))}"`,
                `title="${escapeXmlAttr(feed.title || hostnameOf(feed.xmlUrl))}"`,
                'type="rss"',
                `xmlUrl="${escapeXmlAttr(feed.xmlUrl)}"`,
            ];
            if (feed.htmlUrl) parts.push(`htmlUrl="${escapeXmlAttr(feed.htmlUrl)}"`);
            return `    <outline ${parts.join(' ')}/>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXmlText(ownerTitle)}</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}

function escapeXmlAttr(value: string): string {
    return escapeXmlText(value).replace(/"/g, '&quot;');
}

function escapeXmlText(value: string): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
