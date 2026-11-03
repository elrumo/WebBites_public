import { captureException } from '#root/server/utils/sentry.js';
import { defineEventHandler, readBody, createError } from 'h3';
import Parse from 'parse/node.js'
import { Meilisearch } from 'meilisearch';

import spotifyUrlInfo from 'spotify-url-info';
const { getPreview } = spotifyUrlInfo(fetch);

import metascraper from 'metascraper';
import metascraperAuthor from 'metascraper-author';
import metascraperDate from 'metascraper-date';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';
import metascraperLogo from 'metascraper-logo';
import metascraperClearbit from 'metascraper-clearbit';
import metascraperPublisher from 'metascraper-publisher';
import metascraperTitle from 'metascraper-title';
import metascraperUrl from 'metascraper-url';
import metascrapperShopping from '@samirrayani/metascraper-shopping';
import { sendToQstash, fetchUrlWithProgressiveTimeout, callBackendEndpoint, isLocalUrl, getHtmlContent, isUrlAnImage, getPartitionedQueue } from '#root/server/utils/serverUtils.js';
import { processLargeImageFile } from '#root/server/utils/jobs/processJob.js';

// Import new utilities for refactoring improvements
// import { BookmarkConfig } from '#root/server/config/bookmark.config';
import { batchFindCachedWebsites } from '#root/server/utils/cacheHydration';
import { getUserWithPlan, getBookmarkQuota } from '#root/server/utils/plans';
import { sanitizeMetadata, shouldQueueImageProcessing, getBase64SizeKB } from '#root/server/utils/metadataUtils';
import { sanitizeClientMetadata, mergeClientMetadata, isLoginWalledHost, ownStorageURL, type ClientMetadata } from '#root/server/utils/clientMetadata';
import { carouselImages, applyRehosted } from '#root/server/utils/socialImages';
import type { BookmarkImage } from '#root/server/utils/bookmarkImages';
import { resolveSocialUrl, hasSocialResolver } from '#root/server/utils/socialResolvers';
import { applyAppListing } from '#root/server/utils/appListing';
import { log, errorLog } from '#root/server/utils/bookmarkLogger';
import { BROWSER_HEADERS } from '#root/server/utils/contentExtraction';
import { enrichmentContext, immediateMessages } from '#root/server/utils/enrichmentMessages';
import { detectPdfUrl, looksLikePdfUrl, pdfTargetUrl } from '#root/server/utils/pdfUrl';
import { resolveMediaBookmark, resolveMediaBookmarks, pool } from '#root/server/utils/mediaUrl';

const Websites = Parse.Object.extend("websites");
const WebsiteUrls = Parse.Object.extend('websiteUrls');

const meilisearchClient = new Meilisearch({
    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILISEARCH_API_KEY || ''
});


Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL;

// Define OpenAPI documentation for this route
defineRouteMeta({
    openAPI: {
        tags: ["Bookmarks"],
        description: "Save a bookmark to the user's collection",
        requestBody: {
            description: "Bookmark information to save (single object or array)",
            required: true,
            content: {
                "application/json": {
                schema: {
                    type: 'object',
                    oneOf: [
                            {
                                type: "object",
                                required: ["userId", "url"],
                                properties: {
                                    userId: { type: "string", description: "ID of the user saving the bookmark" },
                                    url: { type: "string", description: "URL of the bookmark to save" },
                                    savedFrom: { type: "string", description: "Source of the bookmark", default: "website" },
                                    type: { type: "string", description: "Type of bookmark", default: "website" },
                                    customId: { type: "string", description: "Custom identifier", nullable: true },
                                    geoLocation: { type: "object", description: "Geographic location", nullable: true },
                                    fromCache: { type: "boolean", description: "Use cached data", default: true },
                                    siteNotes: { type: "string", description: "User notes", nullable: true },
                                    mediaBookmark: { type: "object", description: "Media info for movie/game", nullable: true },
                                    importing: { type: "boolean", description: "Imported from another service", default: false },
                                    textNote: { type: "string", description: "User's text note", nullable: true }
                                }
                            },
                            {
                                type: "array",
                                items: {
                                type: "object",
                                required: ["userId", "url"],
                                properties: {
                                    userId: { type: "string" },
                                    url: { type: "string" },
                                    savedFrom: { type: "string", default: "website" },
                                    type: { type: "string", default: "website" },
                                    customId: { type: "string", nullable: true },
                                    geoLocation: { type: "object", nullable: true },
                                    fromCache: { type: "boolean", default: true },
                                    siteNotes: { type: "string", nullable: true },
                                    mediaBookmark: { type: "object", nullable: true },
                                    importing: { type: "boolean", default: false },
                                    textNote: { type: "string", nullable: true }
                                }
                                }
                            }
                        ]
                    }
                }
            },
        },
        responses: {
            "200": {
                description: "Bookmark successfully saved",
                content: {
                "application/json": {
                    schema: {
                    type: "object",
                    properties: {
                        status: {
                        type: "string",
                        example: "ok"
                        },
                        savedSite: {
                        type: "object",
                        description: "The saved bookmark object"
                        }
                    }
                    }
                }
                }
            },
            "400": {
                description: "Invalid request parameters",
                content: {
                "application/json": {
                    schema: {
                    type: "object",
                    properties: {
                        status: {
                        type: "string",
                        example: "error"
                        },
                        error: {
                        type: "string",
                        example: "No URL provided"
                        }
                    }
                    }
                }
                }
            },
            "500": {
                description: "Server error during bookmark saving",
                content: {
                "application/json": {
                    schema: {
                    type: "object",
                    properties: {
                        message: {
                        type: "string",
                        example: "Error saving bookmark"
                        }
                    }
                    }
                }
                }
            }
        }
    }
});

interface SaveBookmarkBody {
  userId: string
  url: string
  savedFrom?: string
  type?: string
  customId?: string | null
  geoLocation?: any | null
  fromCache?: boolean
  siteNotes?: string | null
  textNote?: string | null
  mediaBookmark?: any | null
  importing?: boolean,
  tags?: Array<string>
  /**
   * Post content read out of the live page by the browser extension's content
   * script — the only surface that can see a logged-in Instagram / X / Threads
   * post. Untrusted: it is assembled by JavaScript in a page we do not control,
   * so it must go through `sanitizeClientMetadata` before anything reads it.
   */
  clientMetadata?: unknown
  /** Native WebKit/Apple Intelligence output. Screenshots are Parse files
   * uploaded by the signed-in device before this request is queued. */
  deviceEnrichment?: unknown
  /**
   * Internal: this URL has already been through PDF detection and is not one.
   *
   * Set only when the PDF pipeline hands a link back — a `.pdf` URL that turned
   * out to serve a login page. Without it the re-save would detect the same URL,
   * download it a second time, and hand it back again.
   */
  pdfChecked?: boolean
  /** Internal: already through game / movie detection (it missed, or the media save failed). */
  mediaChecked?: boolean
}

interface DeviceEnrichment {
    title?: string;
    description?: string;
    author?: string;
    logo?: string;
    ogImageURL?: string;
    tags: string[];
    keywords: string[];
    aiSummary?: Record<string, unknown>;
    imageText?: string;
    siteBody?: string;
    desktopScreenshot?: { name: string; url: string };
    mobileScreenshot?: { name: string; url: string };
    /**
     * The post the device read out of the page it rendered, in the same shape
     * the browser extension sends — caption, author, and every picture of a
     * carousel.
     *
     * Carried raw and sanitized later, in `applyDeviceEnrichment`, because
     * `sanitizeClientMetadata` wants the bookmark's own URL to allow its host's
     * media alongside the platform CDNs, and that URL is only known once we
     * have the row. Nothing reads this field before that point.
     */
    clientMetadata?: unknown;
}

/**
 * `multiline` keeps newlines, for the fields where they are content: a rendered
 * page body and OCR'd text are both paragraphs, and stripping \n as a control
 * character joined every line to the next with no separator at all. Titles,
 * authors and the rest stay single-line.
 */
const deviceText = (value: unknown, limit: number, multiline = false): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = multiline ? value.replace(/\r\n?/g, '\n') : value;
    return normalized
        .replace(multiline ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, limit) || undefined;
};

function deviceTags(value: unknown): string[] {
    return Array.isArray(value)
        ? [...new Set(value.map(item => deviceText(item, 80)?.toLowerCase()).filter(Boolean) as string[])].slice(0, 24)
        : [];
}

function deviceFile(value: unknown): { name: string; url: string } | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const url = ownStorageURL(input.url);
    const name = deviceText(input.name, 180);
    return url && name ? { name, url } : undefined;
}

/** Native content is client-supplied, so bound it before it reaches Parse or a
 * search index. Malformed additions are ignored and the old server flow runs. */
export function sanitizeDeviceEnrichment(raw: unknown): DeviceEnrichment | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    try { if (JSON.stringify(raw).length > 180_000) return null; } catch { return null; }
    const input = raw as Record<string, unknown>;
    const summary = input.aiSummary && typeof input.aiSummary === 'object' && !Array.isArray(input.aiSummary)
        ? input.aiSummary as Record<string, unknown> : undefined;
    const enrichment: DeviceEnrichment = {
        title: deviceText(input.title, 500),
        description: deviceText(input.description, 5_000, true),
        author: deviceText(input.author, 500),
        logo: ownStorageURL(input.logo) || deviceText(input.logo, 2_048),
        ogImageURL: deviceText(input.ogImageURL, 2_048),
        tags: deviceTags(input.tags),
        keywords: deviceTags(input.keywords),
        aiSummary: summary,
        imageText: deviceText(input.imageText, 5_000, true),
        siteBody: deviceText(input.siteBody, 120_000, true),
        desktopScreenshot: deviceFile(input.desktopScreenshot),
        mobileScreenshot: deviceFile(input.mobileScreenshot),
        clientMetadata:
            input.clientMetadata && typeof input.clientMetadata === 'object' && !Array.isArray(input.clientMetadata)
                ? input.clientMetadata
                : undefined
    };
    return Object.values(enrichment).some(value => Array.isArray(value) ? value.length : Boolean(value)) ? enrichment : null;
}

export function applyDeviceEnrichment(website: Parse.Object, enrichment: DeviceEnrichment | null) {
    if (!enrichment) return;
    if (enrichment.title) website.set('siteTitle', enrichment.title);
    if (enrichment.description) website.set('siteDescription', enrichment.description);
    if (enrichment.author) website.set('siteAuthor', enrichment.author);
    if (enrichment.logo) website.set('siteLogo', enrichment.logo);
    if (enrichment.ogImageURL) website.set('OGImage', enrichment.ogImageURL);
    if (enrichment.tags.length) website.set('tags', enrichment.tags);
    if (enrichment.keywords.length) website.set('keywords', enrichment.keywords);
    if (enrichment.aiSummary) website.set('aiSummary', enrichment.aiSummary);
    if (enrichment.imageText) website.set('imageText', enrichment.imageText);
    if (enrichment.siteBody) website.set('siteBody', enrichment.siteBody);
    if (enrichment.desktopScreenshot) {
        const file = Parse.File.fromJSON({ __type: 'File', ...enrichment.desktopScreenshot });
        website.set('fullPageScreenshot', file);
        website.set('siteScreenshot', file);
    }
    if (enrichment.mobileScreenshot) {
        website.set('mobileScreenshot', Parse.File.fromJSON({ __type: 'File', ...enrichment.mobileScreenshot }));
    }

    // The post itself, read by a real browser engine on the user's own
    // connection. For Instagram and Threads this is the only route that ever
    // sees the real content, so it is also the only route that ever sees the
    // second picture of a carousel — hence the same sanitize-and-apply the
    // extension's payload goes through, the `images[]` write included.
    //
    // Only when the device actually read the post: a page that rendered to
    // nothing produces an extraction with no text and no media, and letting
    // that overwrite what a resolver already found would be a downgrade.
    const post = sanitizeClientMetadata(enrichment.clientMetadata, website.get('url'));
    if (post && (post.text || post.media.length > 0)) {
        // The device's read wins field by field — it saw the logged-in page,
        // where a resolver saw whatever a public API would hand a stranger —
        // and whatever it didn't manage to read keeps what is already stored.
        const existing = sanitizeClientMetadata(website.get('clientMetadata'), website.get('url'));
        applyClientMetadata(website, foldDevicePost(post, existing));
        const merged = mergeClientMetadata(website.get('metaData'), post, website.get('url') || '');
        if (merged) website.set('metaData', merged);
    }

    website.set('deviceEnrichedAt', new Date());
}

function hasCompleteDevicePage(enrichment: DeviceEnrichment | null): boolean {
    return Boolean(enrichment?.title && enrichment.description && enrichment.siteBody);
}

interface SaveMediaBody {
    userId: string;
    mediaBookmark: any | null;
    savedFrom: string;
    type: string;
    customId: string | null;
}

interface SaveNoteBody {
    userId: string;
    textNote: string;
    savedFrom: string;
    tags?: Array<string>
}

const scraper = metascraper([
    metascraperAuthor(),
    metascraperDate(),
    metascraperDescription(),
    metascraperImage(),
    metascraperLogo(),
    metascraperClearbit(),
    metascraperPublisher(),
    metascraperTitle(),
    metascraperUrl(),
    metascrapperShopping()
])

// Utility function to add timeout protection to any promise
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

/**
 * Records the extraction itself alongside the derived fields, so we can tell a
 * client-read post from a scraped one — and spot in the field when a platform
 * reships its markup and `extractedBy` silently drops to `client:generic`.
 */
export function applyClientMetadata(website: Parse.Object, clientMetadata: ClientMetadata | null) {
    if (!clientMetadata) return;
    website.set("clientMetadata", clientMetadata);
    website.set("extractedBy", clientMetadata.extractedBy || null);
    if (clientMetadata.authorHandle) website.set("siteAuthor", clientMetadata.authorHandle);
    if (clientMetadata.lang) website.set("siteLang", clientMetadata.lang);
    applyCarousel(website, clientMetadata);
}

/**
 * Writes a multi-picture post out as a multi-image bookmark.
 *
 * A carousel, a four-photo tweet and a Reddit gallery all arrive as an ordered
 * `media` list, and everything past `media[0]` used to be dropped — the row
 * kept one `OGImage` and the other nineteen pictures were gone. `images[]` is
 * the column the grid, the detail carousel and the merge endpoint already read,
 * so the post becomes one of those.
 *
 * Its invariant is kept deliberately: `OGImage` still mirrors `images[0]`, so
 * every reader that only ever knew about `OGImage` sees exactly what it saw
 * before. A single-picture post writes nothing at all — `imagesOf()` reads a
 * row with no `images` column as its cover, so there is nothing to store.
 */
function applyCarousel(website: Parse.Object, clientMetadata: ClientMetadata | null) {
    // Never on a re-save: a carousel reordered on the phone, or images merged in
    // from another bite, are the user's arrangement and outrank a fresh scrape.
    if (Array.isArray(website.get("images")) && website.get("images").length > 0) return;

    const images = carouselImages(clientMetadata, { title: website.get("siteTitle") || undefined });
    if (images.length < 2) return;

    website.set("images", images);
    website.set("OGImage", images[0].url);
}

/**
 * Copies a post's pictures onto our own storage, after the row is saved.
 *
 * Instagram and X sign their CDN URLs and expire them within days, so a stored
 * link rots — which is why the cover has always been re-hosted. Every other
 * slide of a carousel rots on exactly the same schedule, and a carousel that
 * works for a week and then shows nineteen broken frames is worse than one that
 * was never saved.
 *
 * Runs detached, like the cover's own re-host: the row and its card are already
 * there, and this only swaps URLs underneath them. Every failure is per-slide —
 * an expired link or a 404 leaves that one slide pointing at the CDN and never
 * renumbers the carousel around it.
 */
export async function rehostCarousel(websiteId: string, images: BookmarkImage[]): Promise<void> {
    if (!websiteId || images.length < 2) return;

    const website = await new Parse.Query(Websites).get(websiteId, { useMasterKey: true });
    if (!website) return;

    // Only rewrite the arrangement we were handed. If the user reordered the
    // carousel or merged another bite into it while this was in flight, their
    // arrangement wins and this pass simply does nothing.
    const current: BookmarkImage[] = website.get("images") || [];
    if (current.length !== images.length) return;
    if (current.some((image, index) => image?.url !== images[index]?.url)) return;

    const userId = website.get('user')?.id || '';

    const rehosted = await mapWithConcurrency(images, 4, async (image, index) => {
        // Already ours — the share extension uploaded these from the device
        // before the save. Copying them again would be pure cost.
        if (ownStorageURL(image.url)) return null;
        try {
            const response = await withTimeout(fetch(image.url), 20_000, 'carousel image fetch');
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            // A picture this large is a decompression bomb or a mistake, not a
            // carousel slide, and it would blow the Parse file limit anyway.
            if (buffer.length > 15 * 1024 * 1024) return null;

            const extension = guessImageExtension(image.url);
            const fileName = createFileName(
                userId,
                `carousel_${websiteId}_${index}`,
                extension,
                'rehostCarousel'
            );
            const file = new Parse.File(fileName, { base64: buffer.toString('base64') }, `image/${extension}`);
            await withTimeout(file.save({ useMasterKey: true }), 30_000, 'carousel image save');
            return { url: file.url(), fileName };
        } catch (error: any) {
            console.warn(`[rehostCarousel] slide ${index} of ${websiteId} failed: ${error?.message || error}`);
            return null;
        }
    });

    if (rehosted.every(item => item === null)) return;

    const updated = applyRehosted(images, rehosted);
    website.set("images", updated);
    website.set("OGImage", updated[0].url);
    await website.save(null, { useMasterKey: true });
    log(`[rehostCarousel] ${rehosted.filter(Boolean).length}/${images.length} slides re-hosted for ${websiteId}`);
}

/** `Promise.all` over a bounded number of workers: twenty parallel image
 * downloads and twenty parallel Parse uploads is a thundering herd. */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

/** True when this image URL came from the client extraction rather than the scrape. */
function isClientSuppliedImage(image: string, clientMetadata: ClientMetadata | null): boolean {
    if (!clientMetadata) return false;
    return clientMetadata.media.some(item => item.url === image || item.poster === image);
}

/**
 * Whether an extraction actually carries the post, as opposed to just naming it.
 *
 * A share-sheet save of a social URL produces a `clientMetadata` with only a
 * URL-derived handle and whatever the sharer typed into the card — genuinely
 * useful, but not the caption and not the images. That is the case where asking
 * the platform still adds something. An extension or device extraction that
 * read the logged-in DOM already has the real thing and must not be overwritten.
 */
function hasPostContent(clientMetadata: ClientMetadata | null): boolean {
    if (!clientMetadata) return false;
    return Boolean(clientMetadata.text) || clientMetadata.media.length > 0;
}

/**
 * Folds a server-resolved extraction into whatever the client sent.
 *
 * The client's own fields win wherever it has them — a title the sharer typed is
 * theirs, not something to overwrite with an API's — and the resolver fills
 * everything else. `extractedBy` deliberately follows the resolver, because
 * `mergeClientMetadata` reads its `server:` prefix to decide the result is
 * authoritative over metascraper.
 */
function foldResolved(
    clientMetadata: ClientMetadata | null,
    resolved: ClientMetadata | null
): ClientMetadata | null {
    if (!resolved) return clientMetadata;
    if (!clientMetadata) return resolved;
    return {
        ...resolved,
        title: clientMetadata.title || resolved.title,
        text: clientMetadata.text || resolved.text,
        author: clientMetadata.author || resolved.author,
        authorHandle: clientMetadata.authorHandle || resolved.authorHandle,
        media: clientMetadata.media.length ? clientMetadata.media : resolved.media,
        lang: clientMetadata.lang || resolved.lang
    };
}

/**
 * Folds a device-rendered post over whatever is already stored.
 *
 * The mirror image of `foldResolved`, and deliberately not a call to it: there
 * the client's typed fields outrank an API's, here the device's read outranks
 * everything, because it is the only one that saw the page as the user would.
 * What it failed to read — a resolver's publish date, an avatar it had no
 * selector for — keeps what is stored rather than being blanked.
 *
 * `extractedBy` follows the device for the same reason it follows the resolver
 * there: it names who actually produced this, which is what makes silent
 * breakage visible in the field when a platform reships its markup.
 */
function foldDevicePost(
    post: ClientMetadata,
    existing: ClientMetadata | null
): ClientMetadata {
    if (!existing) return post;
    return {
        ...existing,
        ...Object.fromEntries(
            Object.entries(post).filter(([key, value]) =>
                key === 'media' ? (value as unknown[]).length > 0 : value !== undefined && value !== ''
            )
        )
    } as ClientMetadata;
}

/** Best-effort extension for a CDN URL, defaulting to jpg. */
function guessImageExtension(url: string): string {
    try {
        const match = new URL(url).pathname.match(/\.(jpe?g|png|gif|webp|avif)$/i);
        return match ? match[1].toLowerCase() : 'jpg';
    } catch {
        return 'jpg';
    }
}

// Get favicon URL using Google's favicon service
function getGoogleFavicon(url: string, size = 128): string | null {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
    } catch {
        return null;
    }
}

// Export the SaveBookmark class for direct usage
export { SaveBookmark };

const fromCacheDefault = true;

export default defineEventHandler(async (event) => {
    const requestStartTime = Date.now();
    let url: string | undefined;


    try {
        const rawBody = await readBody(event)
        const bodyParsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
        const bookmarkService = new SaveBookmark();

        // console.log('[saveBookmark] Received as array: ', Array.isArray(bodyParsed))
        // console.log('[saveBookmark] bodyParsed: ', bodyParsed)

        if (Array.isArray(bodyParsed)) {
            log(`[SAVEBOOKMARK MAIN] Processing batch of ${bodyParsed.length} bookmarks`);

            // Add timeout protection for batch operations (5 minutes)
            const result = await withTimeout(
                bookmarkService.saveBookmarksBatch(bodyParsed as SaveBookmarkBody[]),
                300000,
                'saveBookmarksBatch'
            );

            const duration = Date.now() - requestStartTime;
            log(`[SAVEBOOKMARK MAIN] Completed batch saveBookmark route in ${duration}ms`);
            return result;
        }

        const body = bodyParsed as SaveBookmarkBody
        url = body.url;

        if(!body.userId) throw createError({ statusCode: 400, statusMessage: 'No user ID provided' });
        if(!body.url) throw createError({ statusCode: 400, statusMessage: 'No URL provided' });
        log(`[SAVEBOOKMARK MAIN] Processing URL: ${body.url} for user: ${body.userId}`);

        // Add timeout protection for single bookmark operations (2 minutes)
        const result = await withTimeout(
            bookmarkService.saveBookmark(body),
            120000,
            'saveBookmark'
        );

        const duration = Date.now() - requestStartTime;
        log(`[SAVEBOOKMARK MAIN] Completed saveBookmark route in ${duration}ms`);
        return result;
    } catch (error) {
        const duration = Date.now() - requestStartTime;
        const urlInfo = url ? ` for URL: ${url}` : '';

        console.error(`[SAVEBOOKMARK MAIN] Error saving bookmark after ${duration}ms${urlInfo}:`, error);

        // Provide more detailed error message
        let errorMessage = 'Error saving bookmark';
        if (error instanceof Error) {
            errorMessage = error.message;
            // Add timeout context to error message
            if (error.message.includes('timed out')) {
                errorMessage = `Operation timed out after ${duration}ms: ${error.message}`;
            }
        }

        throw createError({
            statusCode: 500,
            statusMessage: errorMessage,
            data: { url, duration }
        });
    }
})

class SaveBookmark {
    async saveBookmarksBatch(bodies: SaveBookmarkBody[]) {
        const validBodies = bodies.filter(b => b && typeof b === 'object' && b.userId && (b.url || b.textNote))
        if (validBodies.length === 0) return { status: 'error', error: 'No valid bookmarks in array' }
        const groups = new Map<string, SaveBookmarkBody[]>()
        for (const b of validBodies) {
            const k = b.userId
            const arr = groups.get(k) || []
            arr.push(b)
            groups.set(k, arr)
        }
        
        const savedIds: string[] = []
        const skipped: { userId: string; index: number; reason: string }[] = []
        
        for (const [userId, groupBodies] of Array.from(groups.entries())) {
            const { user, plan } = await getUserWithPlan(userId)
            // `remaining` is null on an unlimited plan — take the whole batch then.
            const remainingSlots = getBookmarkQuota(user, plan).remaining
            const toProcess = remainingSlots === null ? groupBodies : groupBodies.slice(0, remainingSlots)
            const websiteObjs: Parse.Object[] = []
            const imagesToQueue: SaveBookmarkBody[] = []
            const pdfsToQueue: SaveBookmarkBody[] = []
            const mediaToQueue : SaveBookmarkBody[] = []
            const noteQueue: SaveBookmarkBody[] = []
            
            
            // OPTIMIZATION: Pre-fetch all cached websites at once (95% reduction in DB queries)
            const urlsToCheck = toProcess.map((b) => b.url);
            const cachedWebsitesMap = await batchFindCachedWebsites(urlsToCheck);

            // Steam / App Store / TMDB / IMDb / Netflix… links among plain websites:
            // resolved once for the whole batch (detection is a pure check, so only
            // the media URLs cost anything). Misses stay in the ordinary path.
            const mediaResolved = await resolveMediaBookmarks(
                toProcess
                    .filter((b) => b.url && !b.mediaChecked && (!b.type || b.type === 'website') && !isUrlAnImage(b.url) && !looksLikePdfUrl(b.url))
                    .map((b) => {
                        const t = (b.clientMetadata as any)?.title;
                        return { url: b.url, title: typeof t === 'string' ? t : undefined };
                    })
            );

            // console.log('toProcess: ', toProcess)
            for (let i = 0; i < toProcess.length; i++) {
                const b = toProcess[i];

                try {
                    if (b.type !== 'textNote' && !this.isValidUrl(b.url) ) {
                        skipped.push({ userId, index: i, reason: 'invalid_url' })
                        continue
                    }

                    if (b.url && isUrlAnImage(b.url)) {
                        imagesToQueue.push(b)
                        continue
                    }
                    // Tier 1 only here, on purpose: an import is thousands of
                    // URLs, and a HEAD apiece to find the handful that hint at
                    // a download would dwarf the import itself. A `.pdf` link
                    // in a bookmarks export is what this actually catches.
                    if (b.url && (b.type === 'pdf' || ((!b.type || b.type === 'website') && looksLikePdfUrl(b.url)))) {
                        pdfsToQueue.push(b)
                        continue
                    }
                    if (b.type === 'movie' || b.type === 'game') {
                        mediaToQueue.push(b)
                        continue
                    }
                    const autoMedia = mediaResolved.get(b.url)
                    if (autoMedia && (!b.type || b.type === 'website')) {
                        mediaToQueue.push({ ...b, type: autoMedia.type, mediaBookmark: autoMedia.mediaBookmark, mediaChecked: true })
                        continue
                    }

                    if (b.type === 'textNote') {
                        noteQueue.push(b)
                        continue
                    }

                    const w = new Websites()
                    const pageType = await this.getPageType(b.url)
                    const computedType = pageType.type ? pageType.type : 'website'
                    const computedSubType = pageType.subType ? pageType.subType : []
                    const type = b.type && b.type !== 'website' ? b.type : computedType
                    const savedFrom = b.savedFrom ? b.savedFrom : 'website'
                    const siteNotes = b.siteNotes ? b.siteNotes : null
                    const textNote = b.textNote ? b.textNote : null
                    const customId = b.customId ? b.customId : null
                    const baseUrl = (() => { try { return new URL(b.url).origin } catch { return null } })()
                    w.setACL(new Parse.ACL(user))
                    w.set('url', b.url)
                    w.set('tags', Array.isArray(b.tags) ? b.tags : [])
                    w.set('type', type)
                    w.set('user', user)
                    w.set('subType', computedSubType)
                    w.set('siteNotes', siteNotes)
                    w.set('textNote', textNote)
                    w.set('customId', customId)
                    w.set('savedFrom', savedFrom)
                    w.set('baseUrl', baseUrl)

                    try {
                        if (type === 'website' || type === 'music') {
                            // Use pre-fetched cached website instead of individual query
                            const existingWebsite = cachedWebsitesMap.get(b.url);
                            if (existingWebsite) {
                                const hasTitle = Boolean(existingWebsite.get('siteTitle'))
                                const hasOG = Boolean(existingWebsite.get('OGImage') || existingWebsite.get('OGImageFile'))
                                const hasDesc = Boolean(existingWebsite.get('siteDescription'))

                                const OGImage = existingWebsite.get('OGImageFile') != undefined ? existingWebsite.get('OGImageFile').url() : existingWebsite.get('OGImage')

                                w.set('siteHtml', existingWebsite.get('siteHtml'))
                                w.set('siteHtmlFile', existingWebsite.get('siteHtmlFile'))
                                w.set('siteHtmlUrl', existingWebsite.get('siteHtmlUrl'))
                                w.set('siteBody', existingWebsite.get('siteBody') ? existingWebsite.get('siteBody') : '')
                                w.set('siteBodyFile', existingWebsite.get('siteBodyFile') ? existingWebsite.get('siteBodyFile') : null)
                                w.set('siteBodyFileUrl', existingWebsite.get('siteBodyFileUrl') ? existingWebsite.get('siteBodyFileUrl') : null)
                                w.set('baseUrl', existingWebsite.get('baseUrl'))
                                w.set('siteTitle', existingWebsite.get('siteTitle') ? existingWebsite.get('siteTitle') : undefined)
                                w.set('siteDescription', existingWebsite.get('siteDescription'))
                                w.set('siteAuthor', existingWebsite.get('siteAuthor'))
                                w.set('siteDate', existingWebsite.get('siteDate'))
                                w.set('siteLogo', existingWebsite.get('siteLogo'))
                                w.set('sitePublisher', existingWebsite.get('sitePublisher') ? existingWebsite.get('sitePublisher').substring(0, 500) : null)
                                w.set('aiSummary', existingWebsite.get('aiSummary'))
                                w.set('siteColors', existingWebsite.get('siteColors'))
                                w.set('embedCode', existingWebsite.get('embedCode'))
                                w.set('fullPageScreenshot', existingWebsite.get('fullPageScreenshot'))
                                w.set('siteScreenshot', existingWebsite.get('siteScreenshot'))
                                w.set('containsAdultContent', existingWebsite.get('containsAdultContent'))
                                w.set('articleAudio', existingWebsite.get('articleAudio'))
                                w.set('OGImageFile', existingWebsite.get('OGImageFile'))
                                w.set('OGImage', OGImage)
                                w.set('fromCache', true)

                                if (computedSubType.includes('spotify')) {
                                    try {
                                        const spMeta = await getPreview(b.url)
                                        w.set('metaData', spMeta)
                                        if (!hasTitle && spMeta?.title) w.set('siteTitle', spMeta.title)
                                        if (!hasOG && spMeta?.image) w.set('OGImage', spMeta.image)
                                    } catch (error) {
                                        console.log('error in spotify scraper from cache (batch): ', error)
                                    }
                                } else {
                                    try {
                                        const metaData = await this.setMetaData(existingWebsite, b.url)
                                        console.log('metaData from cache (batch): ', metaData)
                                        if (!metaData || !metaData.error) {
                                            w.set('metaData', metaData)
                                            if (!hasTitle && metaData?.title) w.set('siteTitle', metaData.title)
                                            if (!hasOG && metaData?.image) w.set('OGImage', metaData.image)
                                            if (!hasDesc && metaData?.description) w.set('siteDescription', metaData.description)
                                        }
                                    } catch (error) {
                                        console.log('error in meta scraper from cache (batch): ', error)
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.log('Error hydrating bookmark from cache (batch): ', e)
                    }
                    websiteObjs.push(w)
                } catch (e) {
                    skipped.push({ userId, index: i, reason: 'create_failed' })
                }
            }

            ///////// Website batch
            for (let i = 0; i < websiteObjs.length; i += 50) {
                const chunk = websiteObjs.slice(i, i + 50)
                const savedChunk = await Parse.Object.saveAll(chunk, { useMasterKey: true })

                // Add to user relation (reuse the user fetched above instead of
                // re-querying it once per 50-bookmark chunk)
                const rel = user.relation('savedSites')
                for (const s of savedChunk) {
                    rel.add(s)
                    savedIds.push(s.id)
                }
                await user.save(null, { useMasterKey: true })

                // Same two-hop fan-out as the single save (see utils/enrichmentMessages.ts),
                // batched: screenshots + content extraction now, AI stages once the
                // getPageContent worker has a siteBody to hand them.
                const isImportBatch = groupBodies.some((b) => b.importing)
                const hops = savedChunk.map(s => immediateMessages(
                    enrichmentContext(s.id, { url: s.get('url'), userId, importing: isImportBatch, fromCache: fromCacheDefault }),
                    false
                ))
                const pageContentQueueBase = isImportBatch ? 'getPageContent-import' : 'getPageContent'
                const bookmarkContentQueueBase = isImportBatch ? 'getBookmarkContent-import' : 'getBookmarkContent'
                await sendToQstash(hops.map(h => h.screenshots), { isBatch: true, queueName: getPartitionedQueue(bookmarkContentQueueBase) })
                await sendToQstash(hops.map(h => h.pageContent), { isBatch: true, queueName: getPartitionedQueue(pageContentQueueBase) })
            }

            let savePromises: Promise<any>[] = []

            if (imagesToQueue.length > 0) {
                const imagePromises = imagesToQueue.map(img =>
                    this.saveImageAsBookmark(
                        img.url,
                        userId,
                        img.savedFrom ? img.savedFrom : 'website',
                        img.customId ? img.customId : null
                    )
                )
                savePromises.push(
                    Promise.all(imagePromises).then(imageResults => {
                        for (const result of imageResults) {
                            if (result && result.savedSite && result.savedSite.id) savedIds.push(result.savedSite.id)
                        }
                    })
                )
            }

            if (pdfsToQueue.length > 0) {
                const pdfPromises = pdfsToQueue.map(pdf =>
                    this.savePdfAsBookmark(pdf.url, {
                        userId,
                        savedFrom: pdf.savedFrom ? pdf.savedFrom : 'website',
                        customId: pdf.customId ? pdf.customId : null,
                        siteNotes: pdf.siteNotes,
                        tags: pdf.tags
                    })
                )
                savePromises.push(
                    // allSettled, not all: one dead link in an import must not
                    // take the rest of the batch's PDFs down with it.
                    Promise.allSettled(pdfPromises).then(async pdfResults => {
                        // A null verdict is a link that looked like a PDF and
                        // was not one. Dropping it here would silently lose a
                        // bookmark out of an import, so it goes back through the
                        // ordinary save — flagged, so detection does not run
                        // again and download it a second time.
                        const notPdfs: SaveBookmarkBody[] = []

                        for (let i = 0; i < pdfResults.length; i++) {
                            const result = pdfResults[i]
                            if (result.status === 'rejected') {
                                errorLog(`[saveBookmarksBatch] Error saving PDF ${pdfsToQueue[i].url}:`, result.reason)
                                continue
                            }
                            if (result.value?.savedSite?.id) savedIds.push(result.value.savedSite.id)
                            else if (result.value === null) notPdfs.push({ ...pdfsToQueue[i], pdfChecked: true })
                        }

                        if (notPdfs.length === 0) return

                        const resaved = await Promise.allSettled(notPdfs.map(b => this.saveBookmark(b)))
                        for (let i = 0; i < resaved.length; i++) {
                            const result = resaved[i]
                            if (result.status === 'rejected') {
                                errorLog(`[saveBookmarksBatch] Error re-saving ${notPdfs[i].url}:`, result.reason)
                                continue
                            }
                            const id = (result.value as any)?.savedSite?.id
                            if (id) savedIds.push(id)
                        }
                    })
                )
            }

            if (mediaToQueue.length > 0) {
                // Bounded: each save is an IGDB / TMDB round of its own, and an
                // import can hold hundreds of media links.
                const mediaPromises = pool(mediaToQueue, 5, media =>
                    this.saveMedia({
                        userId,
                        mediaBookmark: media.mediaBookmark,
                        savedFrom: media.savedFrom ? media.savedFrom : 'website',
                        type: media.type,
                        customId: media.customId ? media.customId : null
                    }).then(
                        (value): PromiseSettledResult<any> => ({ status: 'fulfilled', value }),
                        (reason): PromiseSettledResult<any> => ({ status: 'rejected', reason })
                    )
                )
                savePromises.push(
                    mediaPromises.then(async mediaResults => {
                        // A media save that was only a guess from the URL must not
                        // lose the bookmark: it goes back through as a website.
                        const asWebsite: SaveBookmarkBody[] = []
                        for (let i = 0; i < mediaResults.length; i++) {
                            const r = mediaResults[i]
                            const failed = r.status === 'rejected' || (r.value as any)?.status === 'error'
                            if (failed) {
                                errorLog(`[saveBookmarksBatch] Error saving media ${mediaToQueue[i].url}:`, r.status === 'rejected' ? r.reason : (r.value as any)?.error)
                                if (mediaToQueue[i].mediaChecked) asWebsite.push({ ...mediaToQueue[i], type: 'website', mediaBookmark: null })
                            }
                        }
                        if (asWebsite.length === 0) return
                        const resaved = await Promise.allSettled(asWebsite.map(b => this.saveBookmark(b)))
                        for (let i = 0; i < resaved.length; i++) {
                            const r = resaved[i]
                            if (r.status === 'rejected') {
                                errorLog(`[saveBookmarksBatch] Error re-saving ${asWebsite[i].url}:`, r.reason)
                                continue
                            }
                            const id = (r.value as any)?.savedSite?.id
                            if (id) savedIds.push(id)
                        }
                    })
                )
            }

            if (noteQueue.length > 0) {
                const notePromises = noteQueue.map(note =>
                    this.saveNote({
                        userId,
                        textNote: note.textNote,
                        savedFrom: note.savedFrom ? note.savedFrom : 'website',
                        tags: note.tags ? note.tags : []
                    })
                )
                savePromises.push(Promise.all(notePromises))
            }

            if (savePromises.length > 0) {
                await Promise.all(savePromises)
            }

            // NOTE: media bookmarks (movies/games) are added to the user's savedSites
            // relation inside their own endpoints (saveMovie/saveGame), so no extra
            // user.save() is needed here.

            // Keep the user's websiteUrls cache in sync for batch saves (used by the
            // import flow for duplicate detection). This previously only happened for
            // single saves.
            try {
                const savedUrls = websiteObjs.map(w => w.get('url')).filter(Boolean)
                if (savedUrls.length > 0) {
                    let websiteUrlsPointer = user.get('websiteUrls')
                        ? await user.get('websiteUrls').fetch({ useMasterKey: true })
                        : undefined
                    if (!websiteUrlsPointer) {
                        websiteUrlsPointer = new WebsiteUrls()
                        websiteUrlsPointer.set('urls', Array.from(new Set(savedUrls)))
                        user.set('websiteUrls', websiteUrlsPointer)
                        await user.save(null, { useMasterKey: true })
                    } else {
                        const urls = websiteUrlsPointer.get('urls') || []
                        for (const u of savedUrls) if (!urls.includes(u)) urls.push(u)
                        websiteUrlsPointer.set('urls', urls)
                        await websiteUrlsPointer.save(null, { useMasterKey: true })
                    }
                }
            } catch (e) {
                errorLog('[saveBookmarksBatch] Error updating websiteUrls cache:', e)
            }
        }
        return { status: 'ok', savedCount: savedIds.length, queuedCount: savedIds.length, savedSiteIds: savedIds, skipped }
    }

    async saveBookmark(body: SaveBookmarkBody) {
        let user: Parse.Object | undefined;
        let userId: string = body.userId;
        let urlToSave: string = body.url;
        let savedFrom: string = body.savedFrom ? body.savedFrom : 'website';
        let type: string = body.type ? body.type : 'website';
        let customId: string | null = body.customId ? body.customId : null;
        let geoLocation: any | null = body.geoLocation ? body.geoLocation : null;
        let fromCache: boolean = body.fromCache != undefined ? body.fromCache : fromCacheDefault;
        let siteNotes: string | null = body.siteNotes? body.siteNotes : null;
        let textNote: string | null = body.textNote ? body.textNote : null;
        let mediaBookmark: any | null = body.mediaBookmark ? body.mediaBookmark : null;
        let importing: boolean = body.importing ? body.importing : false;
        // Validated up front so nothing downstream ever touches the raw blob.
        let clientMetadata: ClientMetadata | null = sanitizeClientMetadata(body.clientMetadata, body.url);
        const deviceEnrichment = sanitizeDeviceEnrichment(body.deviceEnrichment);
        log(`[saveBookmark] savedFrom:  ${savedFrom}`)
        if (clientMetadata) log(`[saveBookmark] clientMetadata: ${clientMetadata.extractedBy} (${clientMetadata.media.length} media)`)
        if (deviceEnrichment) log(`[saveBookmark] device enrichment: ${deviceEnrichment.desktopScreenshot ? 'screenshot, ' : ''}${deviceEnrichment.siteBody ? 'page body' : 'metadata'}`)

        urlToSave = (urlToSave || '').replace(/`/g, '').trim();

        // Parallelize database operations for better performance
        // const [userResult, duplicateResult] = await Promise.all([
        // this.checkIfDuplicate({ url: urlToSave, savedFrom, customId })
            
        // let { isDuplicate, bookmark } = duplicateResult;
        // if(isDuplicate){
        //     console.log('[saveBookmark] Duplicate bookmark found: ', bookmark.get('url'));
        //     return { status: 'ok', savedSite: bookmark }
        // }
                
        const { user: userResult, plan } = await getUserWithPlan(userId)

        user = userResult;

        // This gate used to compare `user.websiteCount`, a column nothing has
        // written in a long time — on most rows it is undefined, so
        // `undefined >= limit` was false and the bookmark limit was never
        // actually enforced here. `getBookmarkQuota` reads the counter
        // `distributedBookmarkCounter` maintains.
        const cannotSave = getBookmarkQuota(user, plan).exceeded;

        if (cannotSave) return {
            status: "error",
            error: "You have reached your website limit. Upgrade your account to save more bookmarks.",
            alert: {
                message: `You have reached your bookmark limit`,
                description: `<span class="_text:bold color-primary">Upgrade </span> your plan to save more bookmarks`,
                // TODO: Parse this JS on the front end so that it becomes actual JS
                onClickFunction: () => { 'this.showUpgradeModal = true;' },
            }
        };

        let savedSite;

        try {
            // Convert URL to absolute URL if it has no protocol. Do NOT prepend "www." —
            // that breaks subdomains (sub.example.com), IPs and hosts that don't serve www.
            if (!urlToSave.match(/^(?:f|ht)tps?\:\/\//)) urlToSave = "https://" + urlToSave;
            
            // console.log('[saveBookmark] isUrlAnImage(urlToSave): ', isUrlAnImage(urlToSave));
            if (isUrlAnImage(urlToSave)) {
                log(`[saveBookmark] Image URL: ${urlToSave}`);
                return await this.saveImageAsBookmark(urlToSave, userId, savedFrom, customId);
            }

            // A link to a document, not to a page about one.
            //
            // A client that says `type: 'pdf'` — the share sheet's type row —
            // is taken at its word and skips detection entirely; otherwise
            // `detectPdfUrl` answers from the URL alone where it can (a `.pdf`
            // path under any amount of query string or fragment) and only
            // spends a request on the URLs that hint at a download without
            // naming one. Either way, anything that is not really a PDF comes
            // straight back as null below and takes the ordinary path.
            const pdfLink = body.pdfChecked
                ? { isPdf: false, url: urlToSave, detectedBy: 'none' as const }
                : type === 'pdf'
                    ? { isPdf: true, url: pdfTargetUrl(urlToSave), detectedBy: 'client' as const }
                    : (type === 'website' || !type)
                        ? await detectPdfUrl(urlToSave)
                        : { isPdf: false, url: urlToSave, detectedBy: 'none' as const };

            if (pdfLink.isPdf) {
                log(`[saveBookmark] PDF URL (${pdfLink.detectedBy}): ${pdfLink.url}`);
                const savedPdf = await this.savePdfAsBookmark(pdfLink.url, {
                    userId,
                    savedFrom,
                    customId,
                    siteNotes,
                    tags: body.tags,
                    originalUrl: urlToSave
                });
                if (savedPdf) return savedPdf;
            }

            // A Steam / App Store / TMDB / IMDb / Netflix… link saved as a plain
            // website: look it up and save it as the game or movie it is. Any
            // miss (unknown title, lookup down, save failed) just carries on as
            // a website below.
            let autoMedia = false;
            if ((type === 'website' || !type) && !mediaBookmark && !body.mediaChecked) {
                const media = await resolveMediaBookmark(urlToSave, clientMetadata?.title);
                if (media) {
                    log(`[saveBookmark] Detected ${media.type} from URL: ${urlToSave}`);
                    ({ type, mediaBookmark } = media);
                    autoMedia = true;
                }
            }

            if (type == 'game' || type == 'movie') {
                try {
                    let mediaResult = await this.saveMedia({
                        userId,
                        mediaBookmark,
                        savedFrom,
                        type,
                        customId
                    })
                    if (!autoMedia || mediaResult?.status === 'ok') {
                        savedSite = mediaResult.savedSite;
                        return mediaResult
                    }
                } catch (error) {
                    if (!autoMedia) throw error;
                }
                errorLog(`[saveBookmark] Auto-detected media save failed, saving as website: ${urlToSave}`);
                type = 'website';
            }

            if(!this.isValidUrl(urlToSave)) return { status: "error", error: `Invalid URL: ${urlToSave}` };

            savedSite = await this.getWebsiteDescription(
                {
                    url: urlToSave,
                    user,
                    savedFrom,
                    customId,
                    siteNotes,
                    textNote,
                    fromCache: fromCacheDefault,
                    clientMetadata,
                    deviceEnrichment,
                    tags: body.tags,
                    importing
                }
            );

            if (savedSite.error) {
                console.log("Error saving site: ", savedSite.error);
                return {status: "error", error: savedSite.error}
            };

            // An App Store / Google Play link becomes an app card. Runs after
            // the row exists so every save path above (cache, device, live) is
            // covered once; a miss leaves the plain website bookmark as it was.
            if (savedSite.id && await applyAppListing(savedSite, urlToSave)) {
                try {
                    await savedSite.save(null, { useMasterKey: true });
                } catch (error) {
                    errorLog(`[saveBookmark] Could not store app listing for ${urlToSave}: ${error}`);
                }
            }

            // Save site to user (adds to savedSites relation and updates the websiteUrls cache).
            // NOTE: argument order is (user, savedSite) — it was previously swapped, which
            // polluted the websites class with a bogus relation and never updated websiteUrls.
            await saveBookmarkToUser(user, savedSite);

            if(importing){
                let bookmarksToImport = user.get('bookmarksToImport');
                const bookmarkIndex = bookmarksToImport.indexOf(urlToSave);
                if (bookmarkIndex > -1) {
                    bookmarksToImport.splice(bookmarkIndex, 1);
                    user.set('bookmarksToImport', bookmarksToImport);
                    await user.save(null, { useMasterKey: true });
                }
            }

            return { status: 'ok', savedSite }
        } catch (error) {
            if(importing){
                await this.logFailedImport(savedSite ? savedSite.url : urlToSave, 'newSaveWebsite', error);
            }

            console.log('error saving bookmark 2: ', error);
            throw error;
        } finally {
            // transaction.finish();
        }
    }

    async saveNote({ userId, textNote, savedFrom, tags }: SaveNoteBody){
        try {
            const result = await callBackendEndpoint(`v1/content/saveNote`, {
                userId,
                textNote,
                savedFrom,
                tags
            });
            const data = result.data as any;
            return data;
        } catch (error) {
            console.log('error saving note: ', error);
            throw error;
        }
    }

    async saveMedia({ userId, mediaBookmark, savedFrom, type, customId }: SaveMediaBody) {
        try {
            let mediaEndpoint = type == 'game' ? 'saveGame' : 'saveMovie';
            const result = await callBackendEndpoint(`v1/content/media/${mediaEndpoint}`, {
                userId,
                mediaBookmark,
                savedFrom,
                type,
                customId
            });
            const data = result.data as any;
            return data;
        } catch (error) {
            console.log('error saving media: ', error);
            throw error;
        }
    }

    async checkIfDuplicate({ url, savedFrom, customId }: { url: string; savedFrom: string; customId: string | null }) {
        try {
            // if (!user) return false;
            const query = new Parse.Query(Websites);
            query.equalTo("url", url);
            query.equalTo("savedFrom", savedFrom);
            query.equalTo("customId", customId);
            const results = await query.find({ useMasterKey: true });
            if (results.length > 0) {
                console.log('[checkIfDuplicate] Duplicate bookmark found 2: ', results[0].get('url'));
                return { isDuplicate: true, bookmark: results[0] };
            } else {
                return { isDuplicate: false, bookmark: null };
            }
        } catch (error) {
            console.log("Error checking if duplicate: ", error);
            return { isDuplicate: false, bookmark: null };
        }
    }

    isValidUrl(url: string){
        try {
            const myURL = new URL(url);
            return true;
          } catch (error) {
            console.log(`${Date().toString()}: ${url} is not a valid url`);
            return false;
          }
    }
    
    async saveImageAsBookmark(urlToSave: string, userId: string, savedFrom: string, customId: string | null) {
        try {
            const result = await callBackendEndpoint('saveUserImage', {
                urlToSave,
                userId,
                savedFrom,
                customId
            });
    
            const data = result.data as any;
            if (data && data.error) {
                console.error('Error in saveUserImage:', data.error);
                throw new Error(data.error);
            }
            return { savedSite: {url: urlToSave, type: 'image', id: data ? data.objectId : undefined} };

        } catch (error) {
            console.log('error queueing image save request: ', error);
            throw error;
        }
    }

    /**
     * Hand a PDF link to the PDF pipeline, and take it back if it turns out not
     * to be one.
     *
     * Detection is allowed to be optimistic — a `.pdf` URL is treated as a PDF
     * without asking the server first — because `saveUserPdf` reads the magic
     * bytes of what actually arrives. When those say otherwise it answers
     * `notAPdf`, and null here puts the URL back on the ordinary save path
     * rather than storing a bookmark whose document is a login page.
     */
    async savePdfAsBookmark(
        urlToSave: string,
        { userId, savedFrom, customId, siteNotes, tags, originalUrl }:
        { userId: string; savedFrom: string; customId: string | null; siteNotes?: string | null; tags?: string[]; originalUrl?: string }
    ) {
        try {
            const result = await callBackendEndpoint('saveUserPdf', {
                urlToSave,
                url: originalUrl && originalUrl !== urlToSave ? originalUrl : undefined,
                userId,
                savedFrom,
                customId,
                siteNotes,
                tags
            }, {
                // Downloading a 50MB paper, rendering its first page and reading
                // its text is comfortably more than the 60s default allows for.
                timeout: 150000
            });

            const data = result.data as any;
            if (data?.notAPdf) {
                log(`[saveBookmark] ${urlToSave} looked like a PDF but is not one; saving it as a page`);
                return null;
            }
            if (data?.error) {
                console.error('Error in saveUserPdf:', data.error);
                throw new Error(data.error);
            }

            // `status: 'ok'` matters: the QStash webhook unwraps exactly this
            // shape and treats anything else as a failed save.
            return {
                status: 'ok' as const,
                savedSite: {
                    url: originalUrl || urlToSave,
                    type: 'pdf',
                    id: data ? data.objectId : undefined,
                    fileUrl: data ? data.fileUrl : undefined,
                    pageCount: data ? data.pageCount : undefined
                }
            };
        } catch (error) {
            console.log('error queueing pdf save request: ', error);
            throw error;
        }
    }

    async getWebsiteDescription(params: { url: string; user: Parse.Object; savedFrom: string; customId: string | null; siteNotes: string | null; textNote: string | null; fromCache?: boolean; clientMetadata?: ClientMetadata | null; deviceEnrichment?: DeviceEnrichment | null; tags?: string[]; importing?: boolean; }) {
        let {
            url,
            user,
            savedFrom,
            customId,
            siteNotes,
            textNote,
            fromCache = fromCacheDefault,
            clientMetadata = null,
            deviceEnrichment = null,
            tags,
            importing = false
        } = params;

        let website, websiteSaved, metadata;
        // An OG image that cannot be stored as-is: a client CDN URL that expires
        // within days, or a base64 blob too large for the row. Re-hosted as a
        // Parse file once the row is saved — processLargeImageFile re-reads the
        // row by id, so firing it before our own save would race and lose.
        let imageToRehost: { url: string | null; imageData: string | null; fileExtension: string } | null = null;

        try {
            log(`[getWebsiteDescription] Starting for URL: ${url}`);
            website = new Websites();

            const isSpotify = url.startsWith('https://open.spotify.com');
            const pageType = isSpotify ? { type: 'music', subType: ['spotify'] } : await this.getPageType(url);
            const type = pageType.type ? pageType.type : "website";
            const subType = pageType.subType ? pageType.subType : [];
    
            website.setACL(new Parse.ACL(user));
            website.set("url", url);
            website.set("tags", Array.isArray(tags) ? tags : []);
            website.set("type", type);
            website.set("user", user);
            website.set("subType", subType);
            website.set("siteNotes", siteNotes);
            website.set("textNote", textNote);
            website.set("customId", customId);
            website.set("savedFrom", savedFrom);
            website.set("baseUrl", new URL(url).origin ? new URL(url).origin : null);
            applyDeviceEnrichment(website, deviceEnrichment);
            // 'created' = placeholder row so the card shows at once; the afterSave
            // trigger holds the bookmark.saved webhook until 'metadata' lands.
            website.set("saveStage", "created");
            await withTimeout(
                website.save(null, { useMasterKey: true }),
                30000,
                'Parse initial website.save'
            );

            if (fromCache) {
                try {
                    log(`[getWebsiteDescription] Checking cache for URL: ${url}`);
                    const websiteQuery = new Parse.Query(Websites);
                    websiteQuery.equalTo("url", url);
                    websiteQuery.exists("siteHtmlFile");
                    // A row that only ever got a wall must not hand it to the next saver.
                    websiteQuery.notEqualTo("contentWalled", true);
                    websiteQuery.descending("createdAt");
                    const existingWebsite = await withTimeout<Parse.Object | undefined>(
                        websiteQuery.first({ useMasterKey: true }),
                        20000,
                        'Parse cache query'
                    );
                    log(`[getWebsiteDescription] Cache ${existingWebsite ? 'hit' : 'miss'} for URL: ${url}`);
    
                    if (existingWebsite) {
                        let OGImage = existingWebsite.get("OGImageFile") != undefined ? existingWebsite.get("OGImageFile").url() : existingWebsite.get("OGImage");
    
                        website.set("siteHtml", existingWebsite.get("siteHtml"));
                        website.set("siteHtmlFile", existingWebsite.get("siteHtmlFile"));
                        website.set("siteHtmlUrl", existingWebsite.get("siteHtmlUrl"));
                        // The AI stages look for this URL; without it they re-fetched the live page.
                        website.set("siteHtmlFileUrl", existingWebsite.get("siteHtmlFileUrl") || existingWebsite.get("siteHtmlFile")?.url());
                        website.set("siteBody", existingWebsite.get("siteBody") ? existingWebsite.get("siteBody") : '');
                        // website.set("siteBody", existingWebsite.get("siteBody") ? existingWebsite.get("siteBody") : 'We could not find the content of this website.');
                        website.set("siteBodyFile", existingWebsite.get("siteBodyFile") ? existingWebsite.get("siteBodyFile") : null);
                        website.set("siteBodyFileUrl", existingWebsite.get("siteBodyFileUrl") ? existingWebsite.get("siteBodyFileUrl") : null);
                        website.set("baseUrl", existingWebsite.get("baseUrl"));
                        website.set("siteTitle", existingWebsite.get("siteTitle") ? existingWebsite.get("siteTitle") : undefined);
                        website.set("siteDescription", existingWebsite.get("siteDescription"));
                        website.set("siteAuthor", existingWebsite.get("siteAuthor"));
                        website.set("siteDate", existingWebsite.get("siteDate"));
                        website.set("siteLogo", existingWebsite.get("siteLogo"));
                        website.set("sitePublisher", existingWebsite.get("sitePublisher") ? existingWebsite.get("sitePublisher").substring(0, 500) : null);
                        website.set("aiSummary", existingWebsite.get("aiSummary"));
                        website.set("language", existingWebsite.get("language"));
                        website.set("siteColors", existingWebsite.get("siteColors"));
                        website.set("embedCode", existingWebsite.get("embedCode"));
                        website.set("fullPageScreenshot", existingWebsite.get("fullPageScreenshot"));
                        website.set("siteScreenshot", existingWebsite.get("siteScreenshot"));
                        website.set("containsAdultContent", existingWebsite.get("containsAdultContent"));
                        website.set("metaData", existingWebsite.get("metaData") ? existingWebsite.get("metaData") : undefined);
                        website.set("articleAudio", existingWebsite.get("articleAudio"));
                        website.set("fromCache", true);
                        website.set("OGImageFile", existingWebsite.get("OGImageFile"));
                        website.set("OGImage", OGImage);
    
                        if (subType.includes('spotify') && !hasCompleteDevicePage(deviceEnrichment)) {
                            try {
                                metadata = await getPreview(url);
                                website.set("metaData", metadata);
                                website.set("siteTitle", metadata.title);
                                website.set("OGImage", metadata.image);
                            } catch (error) {
                                console.log('error in spotify scraper from cache: ', error);
                            }
                        } else if (!hasCompleteDevicePage(deviceEnrichment) && !existingWebsite.get("metaData")) {
                            // Only re-scrape when the cached row never stored its metadata;
                            // otherwise the copy above already has it and this was a page
                            // download plus a metascraper run for nothing.
                            try {
                                const metaData = await this.setMetaData(existingWebsite, url);
                                // console.log('metaData from cache 2: ', metaData)
                                if (!metaData || !metaData.error) {
                                    website.set("metaData", metaData);
                                }
                            } catch (error) {
                                console.log('error in meta scraper from cache: ', error);
                            }
                        }
    
                        // A cached row for a login-walled URL was itself built from a
                        // login wall, so a fresh client extraction beats it outright.
                        if (clientMetadata && isLoginWalledHost(url)) {
                            const merged = mergeClientMetadata(website.get("metaData"), clientMetadata, url);
                            website.set("metaData", merged);
                            if (merged?.title) website.set("siteTitle", merged.title);
                            if (merged?.description) website.set("siteDescription", merged.description);
                            if (merged?.author) website.set("siteAuthor", merged.author);
                            if (merged?.date) website.set("siteDate", merged.date);
                            if (merged?.publisher) website.set("sitePublisher", merged.publisher.substring(0, 500));
                            if (merged?.image && !website.get("OGImageFile")) {
                                website.set("OGImage", merged.image);
                            }
                            website.set("fromCache", false);
                        }
                        applyClientMetadata(website, clientMetadata);
                        applyDeviceEnrichment(website, deviceEnrichment);

                        // Save website; the savedSites relation is added once by the caller
                        // via saveBookmarkToUser (previously duplicated here).
                        website.set("saveStage", "metadata");
                        websiteSaved = await withTimeout(
                            website.save(null, { useMasterKey: true }),
                            30000,
                            'Parse cached website.save'
                        );

                        const cachedCarousel: BookmarkImage[] = website.get("images") || [];
                        if (cachedCarousel.length > 1) {
                            rehostCarousel(website.id, cachedCarousel).catch(error => {
                                console.error('[saveBookmark] Error re-hosting cached carousel:', error);
                            });
                        }

                        return website;
                    }
                } catch (error) {
                    // A slow or failed cache lookup is not a reason to lose the
                    // bookmark: fall through to the live fetch below.
                    errorLog(`[getWebsiteDescription] Cache lookup failed for ${url}, fetching live instead: ${error}`);
                }
            }
    
            try {
                const urlObj = new URL(url);
                const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;

                website.set("fromCache", false);

                // Check if URL is a local/private URL
                if (isLocalUrl(url)) {
                    console.log( `[saveBookmark] 🏠 Local URL detected: ${url} - Skipping screenshot and metadata fetch`);

                    // Save bookmark with basic info only (no fetching)
                    website.set("siteTitle", url);
                    website.set("siteDescription", "Local bookmark");
                    website.set("baseUrl", baseUrl);
                    website.set("saveStage", "metadata");

                    websiteSaved = await withTimeout(
                        website.save(null, { useMasterKey: true }),
                        30000,
                        'Parse local website.save'
                    );

                    // The savedSites relation is added once by the caller via saveBookmarkToUser.
                    // console.timeEnd(GetMetadataTime);
                    return website;
                }

                // A device that rendered the page has fresher content than a
                // second server fetch, and its Parse screenshot file is ready
                // to use immediately.
                if (hasCompleteDevicePage(deviceEnrichment)) {
                    website.set("saveStage", "metadata");
                    websiteSaved = await withTimeout(
                        website.save(null, { useMasterKey: true }),
                        30000,
                        'Parse device-enriched website.save'
                    );
                    return websiteSaved;
                }

                // Parallel metadata scraping for better performance
                const metadataPromises = [];

                // Add Spotify metadata fetching if applicable
                if (subType.includes('spotify')) {
                    metadataPromises.push(
                        withTimeout(
                            getPreview(url).then(result => ({ type: 'spotify', data: result })),
                            15000, // 15 second timeout for Spotify API
                            'Spotify getPreview'
                        ).catch(error => ({ type: 'spotify', error: error.message }))
                    );
                }

                // Ask the platform itself about a social permalink. Runs
                // alongside the fetch below rather than before it, so a resolver
                // that is slow or down costs no wall clock — whichever answers,
                // the other still lands.
                if (!hasPostContent(clientMetadata) && hasSocialResolver(url)) {
                    metadataPromises.push(
                        resolveSocialUrl(url)
                            .then(data => ({ type: 'social' as const, data }))
                            .catch(error => ({ type: 'social' as const, error: error?.message }))
                    );
                }

                // Add web scraping for HTML metadata with progressive timeout
                log(`[getWebsiteDescription] Fetching HTML for URL: ${url}`);
                metadataPromises.push(
                    withTimeout(
                        // Browser headers: without a User-Agent many sites answer with a
                        // bot page or 403, and that is what got scraped and stored.
                        fetchUrlWithProgressiveTimeout(url, { headers: BROWSER_HEADERS }, 'getWebsiteDescription')
                            .then(async response => {
                                if ('error' in response) {
                                    errorLog(`[getWebsiteDescription] Fetch error for ${url}: ${response.error}`);
                                    return { type: 'html', error: response.error };
                                }
                                log(`[getWebsiteDescription] HTML fetched for ${url}, parsing...`);
                                const html = await response.text();
                                // const htmlMetadata = await this.setMetaData(website, url, html);
                                const htmlMetadata = subType.includes('spotify') ? null : await this.setMetaData(website, url, html);
                                return { type: 'html', data: htmlMetadata, html };
                            })
                            .catch(error => {
                                errorLog(`[getWebsiteDescription] Exception fetching ${url}: ${error.message}`);
                                return { type: 'html', error: error.message };
                            }),
                        45000, // 45 second timeout for entire fetch + parse operation
                        'fetchUrlWithProgressiveTimeout'
                    ).catch(error => {
                        errorLog(`[getWebsiteDescription] Timeout fetching ${url}: ${error.message}`);
                        return { type: 'html', error: error.message };
                    })
                );

                // Execute all metadata fetching in parallel
                const metadataResults = await Promise.allSettled(metadataPromises);
                
                // Process results
                let metadata = null;
                let html = null;
                
                for (const result of metadataResults) {
                    if (result.status === 'fulfilled' && result.value.data) {
                        const { type, data } = result.value;
                        
                        if (type === 'spotify') {
                            console.log('Spotify metadata 2: ', data);
                            website.set("metaData", data);
                            website.set("siteTitle", data.title);
                            website.set("OGImage", data.image);
                            metadata = data;
                        } else if (type === 'html') {
                            metadata = data;
                            html = result.value.html;
                        } else if (type === 'social') {
                            // Reassigning the local means every use below —
                            // the merge, the CDN re-host check, and the
                            // clientMetadata column — sees it without each
                            // needing to know a resolver ran.
                            clientMetadata = foldResolved(clientMetadata, data);
                            log(`[getWebsiteDescription] social resolver: ${data.extractedBy} (${data.media.length} media)`);
                        }
                    } else if (result.status === 'fulfilled' && result.value.error) {
                        console.log(`Error in ${result.value.type} scraper:`, result.value.error);
                    }
                }
    
                    // Overlay what the browser extension read out of the live page.
                    // On Instagram / X / Threads the fetch above hit a login wall,
                    // so the client extraction is the only real content we have.
                    metadata = mergeClientMetadata(metadata, clientMetadata, url) as typeof metadata;

                    if (metadata && metadata.image) {
                        if (metadata.image.startsWith('data:image/')) { // Check if it's base64
                            const base64Data = metadata.image.replace(/^data:image\/\w+;base64,/, "");

                            // OPTIMIZATION: Use utility function to determine if image should be queued
                            if (shouldQueueImageProcessing(base64Data)) {
                                const imageSizeKB = getBase64SizeKB(base64Data);
                                console.log(`Queuing large image processing (${Math.round(imageSizeKB)}KB) for website ${website.id}`);
                                // Re-hosted after the row is saved. The data URL is NOT
                                // stored meanwhile: it bloated the row, every afterSave
                                // diff and the search document, and raced the re-host.
                                imageToRehost = {
                                    url: null,
                                    imageData: base64Data,
                                    fileExtension: metadata.image.split(';')[0].split('/')[1].split('+')[0] || 'jpg'
                                };
                                metadata.image = null;
                            } else {
                                // Process small images immediately
                                const fileExtension = metadata.image.split(';')[0].split('/')[1].split('+')[0];
                                let userId = website.get('user')?.id || '';
                                let fileName = createFileName(userId, `OGImage_${website.id}`, fileExtension, 'saveBookmark-1');
                                const contentType = `image/${fileExtension}`;
                                const imageFile = new Parse.File(fileName, { base64: base64Data }, contentType);
                                await withTimeout(
                                    imageFile.save({ useMasterKey: true }),
                                    30000,
                                    'Parse image file save'
                                );
                                metadata.image = imageFile.url();
                                website.set("OGImageFile", imageFile);
                                website.set("OGImage", imageFile.url());
                            }
                        } else if (isClientSuppliedImage(metadata.image, clientMetadata)) {
                            // Instagram and X sign their CDN URLs and expire them within
                            // days, so a stored link rots. Show it now, re-host after save.
                            website.set("OGImage", metadata.image);
                            imageToRehost = { url: metadata.image, imageData: null, fileExtension: guessImageExtension(metadata.image) };
                        } else { // It's a URL
                            website.set("OGImage", metadata.image);
                        }
                    }
    
                    if (html) {
                        // Rewrite root-relative URLs (="/...") to absolute ones, but leave
                        // protocol-relative URLs (="//cdn...") untouched — the previous regex
                        // corrupted those into ="https://host//cdn...".
                        const htmlContent = html.replace(/<!doctype html>/i, '')
                            .replace(/="\/(?!\/)/g, `="${baseUrl}/`)
                            .replaceAll('<a', '<a target="_blank"');
                        
                        // Check HTML size for background processing
                        const htmlSizeKB = (htmlContent.length * 2) / 1024; // UTF-8 encoding approximation

                        log(`htmlSizeKB: ${htmlSizeKB}`)
                        let userId = website.get('user')?.id || '';
                        const fileName = createFileName(userId, `siteHtml_${website.id}`, '.html', 'saveBookmark-2');
                        
                        try {
                            const htmlFile = new Parse.File(fileName, { base64: Buffer.from(htmlContent).toString('base64') }, 'text/html');
                            await withTimeout(
                                htmlFile.save({ useMasterKey: true }),
                                30000,
                                'Parse HTML file save'
                            );
                            website.set("siteHtmlFile", htmlFile);
                            website.set("siteHtmlFileUrl", htmlFile.url());
                            website.set("siteHtml", "");
                        } catch (error) {
                            console.error('[saveBookmark - html-processing-requests] Error in HTML processing ---- ', "fileName: ", fileName,'--- ERROR:', error);
                        }
                        
                        // if (htmlSizeKB > 1000) { // Queue large HTML files (>1MB) for background processing
                        //     log(`Queuing large HTML processing (${Math.round(htmlSizeKB)}KB) for website ${website.id}`);
                            
                        //     // Queue HTML file processing
                        //     await sendToQstash({
                        //         type: 'html-processing-requests',
                        //         data: {
                        //             websiteId: website.id,
                        //             htmlContent: htmlContent,
                        //             fileName: fileName
                        //         }
                        //     }, { queueName: getPartitionedQueue('fileProcessing') });
                            
                        // } else {
                        //     // Process small HTML files immediately
                        //     const htmlFile = new Parse.File(fileName, { base64: Buffer.from(htmlContent).toString('base64') }, 'text/html');
                        //     await withTimeout(
                        //         htmlFile.save({ useMasterKey: true }),
                        //         30000,
                        //         'Parse HTML file save'
                        //     );
                        //     website.set("siteHtmlFile", htmlFile);
                        //     website.set("siteHtmlFileUrl", htmlFile.url());
                        // }
                        // website.set("siteHtml", "");

                    } else if (importing) {
                        // Import bookkeeping only: for a regular save this was three
                        // extra Parse round-trips on the critical path.
                        await this.logFailedImport(website, 'getWebsiteDescription', 'no html');
                    }
    
                    website.set("siteTitle", metadata?.title || undefined);
                    website.set("siteDescription", metadata?.description || null);
                    website.set("siteAuthor", getSiteAuthor(metadata, url, subType));
                    website.set("siteDate", metadata?.date || null);
                    website.set("siteLogo", metadata?.logo || getGoogleFavicon(url));
                    website.set("sitePublisher", metadata?.publisher?.substring(0, 500) || null);
                    website.set("metaData", metadata);
                    applyClientMetadata(website, clientMetadata);
                    applyDeviceEnrichment(website, deviceEnrichment);
                    
                    if (!metadata) {
                        console.log("No metadata found for website: ", url);
                    }
            } catch (error) {
                console.log(`Error fetching website for id ${website.id} with url ${url}: ${error}`);
            }
    
            try {
                // Save website; the savedSites relation is added once by the caller
                // via saveBookmarkToUser (previously duplicated here).
                website.set("saveStage", "metadata");
                websiteSaved = await withTimeout(
                    website.save(null, { useMasterKey: true }),
                    30000,
                    'Parse website.save'
                );

                const carousel: BookmarkImage[] = website.get("images") || [];
                if (carousel.length > 1) {
                    // The carousel pass re-hosts every slide, the cover
                    // included, and keeps OGImage on images[0]. Running the
                    // single-image re-host alongside it would copy the cover
                    // twice and leave the two passes racing over which copy
                    // OGImage ends up naming.
                    rehostCarousel(website.id, carousel).catch(error => {
                        console.error('[saveBookmark] Error re-hosting carousel:', error);
                    });
                } else if (imageToRehost) {
                    processLargeImageFile({
                        websiteId: website.id,
                        ...imageToRehost,
                        fileName: `OGImage_${website.id}`
                    }).catch(error => {
                        console.error('[saveBookmark] Error re-hosting OG image:', error);
                    });
                }

                // console.timeEnd(GetMetadataTime);
                return websiteSaved;
            } catch (error) {
                errorLog("Error getWebsiteDescription 2: ", error);
                return { status: "error", error };
            }
        } catch (error) {
            errorLog("Error getWebsiteDescription 3: ", error);
            return { status: "error", error };
        } finally {
            // Explicitly clear variables to help with garbage collection
            website = null;
            websiteSaved = null;
            metadata = null;
        }
    
        function getSiteAuthor(metadata: any, url: string, subType: string[]) {
            try {
                if (subType.includes('tweet')) {
                    return url.split('/')[3];
                } else if (Boolean(metadata?.author)) {
                    return metadata?.author;
                } else {
                    return undefined;
                }
            } catch (error) {
                errorLog("Error getWebsiteDescription getSiteAuthor: ", error);
                return undefined;
            }
        }
    }
    
    async setMetaData(website: Parse.Object, url: string, html: string = '') {
        try {
            let siteHtmlUrl = website.get("siteHtmlUrl");
            
    
            if (siteHtmlUrl != undefined && siteHtmlUrl.length > 0) {
                html = await getHtmlContent(siteHtmlUrl, 'setMetaData1', false, 4000);
                // html = await this.getHtmlContent(siteHtmlUrl, 'setMetaData1', false);
            }
    
            try {
                if (!html || html.length == 0) {
                    let siteHtml = website.get("siteHtml");
                    if (siteHtml && siteHtml.length > 10) {
                        html = siteHtml;
                    } else {
                        html = await getHtmlContent(url, 'setMetaData2', false, 4000);
                    }
                }
            } catch (error) {
                errorLog(`[saveBookmark] Error in setMetaData getHtmlContent: ${error} URL: ${url}`);
            }
            
            let metadata;

            try {
                let cleanUrl = (() => {
                    try {
                        const parsed = new URL(url);
                        return `${parsed.origin}${parsed.pathname}`;
                    } catch {
                        return url.split('#')[0].split('?')[0];
                    }
                })();

                // Sanitize HTML to fix malformed JSON-LD before scraping
                // Some websites have unescaped quotes in JSON-LD that break parsing
                let sanitizedHtml = html;
                try {
                    // Add timeout protection for HTML sanitization
                    sanitizedHtml = await withTimeout(
                        (async () => {
                            // Find and fix malformed JSON-LD script tags
                            const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
                            return html.replace(jsonLdRegex, (match, jsonContent) => {
                                try {
                                    // Try to parse the JSON - if it fails, return the original script tag removed
                                    JSON.parse(jsonContent);
                                    return match; // Valid JSON, keep as-is
                                } catch {
                                    // Invalid JSON-LD, remove it to prevent metascraper from failing
                                    console.log('[saveBookmark] Removing malformed JSON-LD from HTML');
                                    return '';
                                }
                            });
                        })(),
                        5000,
                        'HTML sanitization'
                    );
                } catch (sanitizeError) {
                    // If sanitization fails or times out, use original HTML
                    errorLog(`[saveBookmark] Error in HTML sanitization: ${sanitizeError}`);
                    sanitizedHtml = html;
                }


                // console.log('metadata 0: ', metadata)
                // Add timeout protection for metascraper (10 seconds)
                try {
                    metadata = await withTimeout(
                        scraper({ html: sanitizedHtml, url: cleanUrl }),
                        10000,
                        'metascraper'
                    );
                    // console.log('metadata 1: ', metadata)
                } catch (scraperError) {
                    errorLog(`[saveBookmark] Metascraper failed or timed out: ${scraperError}`);
                    metadata = null;
                }
                for (let key in metadata) {
                    if (metadata[key] && metadata[key].length > 1200) {
                        metadata[key] = metadata[key].substring(0, 1200);
                    }
                }
            } catch (error) {
                errorLog(`[saveBookmark] Error in setMetaData scraper: ${error} URL: ${url}`);
            }
    
            // console.log('metadata 2: ', metadata)
            if (!metadata) return {};

            // OPTIMIZATION: Use utility function for metadata sanitization (removes duplication)
            return sanitizeMetadata(metadata);
        } catch (error) {
            errorLog(`[saveBookmark] Error in setMetaData: ${error} URL: ${url}`);
            return undefined;
        }
    }
    
    async getPageType(url: string) {
        try {
            // Static mappings for domains to their types
            const domainTypeMap = {
                'dev.to': { type: "website", subType: ["article"] },
                'medium.com': { type: "website", subType: ["article"] },
                'towardsdatascience.com': { type: "website", subType: ["article"] },
                'hackernoon.com': { type: "website", subType: ["article"] },
                'theverge.com': { type: "website", subType: ["article", "news"] },
                'bbc.': { type: "website", subType: ["article", "news"] },
    
                // ... add all other article domains here from articlesUrls
                'youtube.com': { type: "website", subType: ["video", "youtube"] },
                'vimeo.com': { type: "website", subType: ["video", "vimeo"] },
                'dailymotion.com': { type: "website", subType: ["video", "dailymotion"] },
                'twitch.tv': { type: "website", subType: ["twitch", "social", "video"] },
                'tiktok.com': { type: "website", subType: ["tiktok", "social", "video"] },
    
                'dribbble.com': { type: "website", subType: ["dribble", "design", "media"] },
                'behance.com': { type: "website", subType: ["behance", "design", "media"] },
                'flickr.com': { type: "website", subType: ["behance", "design", "media"] },
    
                'spotify.com': { type: "music", subType: ["spotify"] },
                'soundcloud.': { type: "music", subType: ["soundCloud"] },
                'music.apple.com': { type: "music", subType: ["appleMusic"] },
    
                // ... add all other media domains here from mediaUrls
                'amazon.': { type: "website", subType: ["shopping"] },
                'target.com': { type: "website", subType: ["shopping"] },
                'walmart.com': { type: "website", subType: ["shopping"] },
                'elcorteingles.com': { type: "website", subType: ["shopping"] },
                'fnac.': { type: "website", subType: ["shopping"] },
                'carrefour.': { type: "website", subType: ["shopping"] },
                'pccomponentes.com': { type: "website", subType: ["shopping"] },
                'mediamarkt.': { type: "website", subType: ["shopping"] },
                'ebay.': { type: "website", subType: ["shopping"] },
                'etsy.': { type: "website", subType: ["shopping"] },
                'tesco.': { type: "website", subType: ["shopping"] },
                'sainsburys.co.uk': { type: "website", subType: ["shopping"] },
                'argos.co.uk': { type: "website", subType: ["shopping"] },
    
                // ... add all other shopping domains here from shoppingUrls
                'github.com': { type: "website", subType: ["developer"] },
                'stackoverflow.com': { type: "website", subType: ["developer"] },

                // Social posts. These all resolve through `socialResolvers`, and
                // `subType` is what the clients switch card treatments on — the
                // web grid already renders `tweet` as an embed.
                'instagram.com': { type: "website", subType: ["instagram", "social", "post"] },
                'threads.net': { type: "website", subType: ["threads", "social", "post"] },
                'threads.com': { type: "website", subType: ["threads", "social", "post"] },
                'bsky.app': { type: "website", subType: ["bluesky", "social", "post"] },
                'reddit.com': { type: "website", subType: ["reddit", "social", "post"] },
                'pinterest.': { type: "website", subType: ["pinterest", "social", "media"] },
                'facebook.com': { type: "website", subType: ["facebook", "social", "post"] },
                'linkedin.com': { type: "website", subType: ["linkedin", "social", "post"] },
            };
    
            // Patterns that require regex matching
            const patterns = [
                { regex: /https:\/\/([\w\.-]+\.)?figma.com\/(file|proto)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$/, type: { type: "website", subType: ["figma-file", "design"] } },
                { regex: /^https?:\/\/(?:www\.)?mediamarkt\.[a-z]{2}\/[a-z]{2}\/product\/.*$/, type: { type: "website", subType: ["shopping"] } },
                { regex: /^https?:\/\/(?:www\.)?apple\.(?:[a-z]{2}\.)?com\/(?:[a-z]{2}\/)?shop\/.*$/, type: { type: "website", subType: ["shopping"] } },
                // "social" alongside "tweet": the clients' Social filter switches
                // on it, and a post from the largest platform of the lot being
                // the one the shelf misses is the worst possible omission.
                { regex: /^https?:\/\/(?:www\.)?twitter\.com\/(?:#!\/)?(\w+)\/status\/(\d+)(?:\?.*)?$/, type: { type: "website", subType: ["tweet", "social", "post"] } },
                { regex: /^https?:\/\/(?:www\.)?x\.com\/(?:#!\/)?(\w+)\/status\/(\d+)(?:\?.*)?$/, type: { type: "website", subType: ["tweet", "social", "post"] } },
                // ... add other regex patterns here
            ];
    
            // Attempt to match the domain in the domainTypeMap
            const hostname = new URL(url).hostname;
            const domainMatch = Object.keys(domainTypeMap).find(domain => hostname.includes(domain));
            if (domainMatch) {
                return domainTypeMap[domainMatch];
            }
    
            // Check regex patterns if no domain match is found
            for (const pattern of patterns) {
                if (pattern.regex.test(url)) {
                    return pattern.type;
                }
            }
    
            // Fallback case
            return { type: "website", subType: [] };
        } catch (error) {
            return { type: "website", subType: [] };
        }
    }
    
    async logFailedImport(savedSite, funcName, error){
        try {
            savedSite = await savedSite.fetch({useMasterKey: true});
    
            let user = savedSite.get('user');
            user = await user.fetch({useMasterKey: true});
            let failedToImport = user.get('failedToImport');
            if(failedToImport == undefined) failedToImport = [];
    
            failedToImport.push({url: savedSite.get('url'), websiteId: savedSite.id, error: error, funcName: funcName, date: new Date().toString()});
            user.set('failedToImport', failedToImport);
            await user.save(null, { useMasterKey: true });
        } catch (error) {
            errorLog(`Error logging failed import: ${error}`);
        }
    }
}
