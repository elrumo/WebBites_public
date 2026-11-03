import Parse from 'parse/node.js'
import { createError } from 'h3';
import { validateInternalApiKey } from '#root/server/utils/api-keys';
import { fetchUrlWithProgressiveTimeout } from '#root/server/utils/serverUtils.js';
import { extractContent, findAmpUrl, MIN_CONTENT_LENGTH, SITE_BODY_TEXT_LIMIT, BROWSER_HEADERS, type ExtractedContent } from '#root/server/utils/contentExtraction.js';
import { assertPublicUrl } from '#root/server/utils/safeUrl';
import { screenshotServiceUrl, screenshotServiceKey, siterelicKey } from '#root/server/utils/renderService';
import { askJev } from '#root/server/utils/aiClients';
import { jevOn, pageCheckRequest, readPageCheck, type PageCheck } from '#root/server/utils/jevJudgments';

// Jev's P(yes) needed to call an extraction a wall, or an article.
const BARRIER_AT = 0.7;
const ARTICLE_AT = 0.5;

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = process.env.VITE_PARSE_URL;

defineRouteMeta({
    openAPI: {
        tags: ["Content"],
        summary: "Extract page content",
        description: "Fetch a page (direct or rendered) and extract readable article content. If a savedSiteId is provided and returnContent is false, the extracted content is saved to the Parse website record.",
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            savedSiteId: {
                                type: "string",
                                description: "Parse objectId of the saved website"
                            },
                            url: {
                                type: "string",
                                description: "Target URL to extract content from",
                                example: "https://example.com/article"
                            },
                            preferRendered: {
                                type: "boolean",
                                description: "Prefer rendered HTML fetching over direct fetch",
                                default: false
                            },
                            returnContent: {
                                type: "boolean",
                                description: "Return extracted content in the response instead of saving it",
                                default: false
                            },
                            fromCache: {
                                type: "boolean",
                                description: "Whether the request is considered cache-friendly for downstream processing",
                                default: true
                            },
                            websiteData: {
                                type: "object",
                                description: "Alternative format with nested request body",
                                properties: {
                                    savedSiteId: { type: "string" },
                                    url: { type: "string" },
                                    preferRendered: { type: "boolean", default: false },
                                    returnContent: { type: "boolean", default: false },
                                    fromCache: { type: "boolean", default: true }
                                }
                            }
                        },
                        oneOf: [
                            {
                                type: "object",
                                required: ["savedSiteId"],
                                properties: {
                                    savedSiteId: { type: "string" }
                                }
                            },
                            {
                                type: "object",
                                required: ["url"],
                                properties: {
                                    url: { type: "string" }
                                }
                            },
                            {
                                type: "object",
                                required: ["websiteData"],
                                properties: {
                                    websiteData: { type: "object" }
                                }
                            }
                        ]
                    }
                }
            }
        },
        responses: {
            "200": {
                description: "Content extraction result",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            oneOf: [
                                {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        extractionMethod: { type: "string", enum: ["client", "direct", "amp", "rendered"] },
                                        isReadable: { type: "boolean" },
                                        contentLength: { type: "integer", example: 2048 },
                                        savedSiteId: { type: "string", nullable: true }
                                    }
                                },
                                {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean", example: true },
                                        extractionMethod: { type: "string", enum: ["client", "direct", "amp", "rendered"] },
                                        isReadable: { type: "boolean" },
                                        siteText: { type: "string", nullable: true },
                                        content: { type: "string", nullable: true },
                                        articleData: { type: "object", nullable: true },
                                        endpoint: { type: "string", example: "getPageContent" }
                                    }
                                },
                                {
                                    type: "object",
                                    properties: {
                                        error: { type: "string", example: "Content extraction failed" },
                                        details: { type: "string", nullable: true }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        }
    }
});

export default defineEventHandler(async (event) => {
    const rawBody = await readBody(event) as any;
    const body: any = rawBody?.websiteData || rawBody || {};

    // Writing into a row by id is the pipeline's job; users only get returnContent.
    if (body.savedSiteId && !validateInternalApiKey(event)) {
        throw createError({ statusCode: 403, statusMessage: 'savedSiteId requires the internal API key' });
    }

    try {

        const {
            savedSiteId,
            url,
            preferRendered = false,
            returnContent = false,
            fromCache = true
        } = body;

        log(`[getPageContent] Processing: ${savedSiteId || url}`);

        const result = await getUnifiedPageContent({
            savedSiteId,
            url,
            preferRendered,
            returnContent,
            fromCache
        });

        return result;

    } catch (error) {
        console.error('[getPageContent] Error:', error);
        return { error: 'Failed to process page content', details: error.message };
    }
});

// Unified content extraction function
interface UnifiedPageContentParams {
    savedSiteId?: string;
    url?: string;
    preferRendered?: boolean;
    returnContent?: boolean;
    fromCache?: boolean;
}

export async function getUnifiedPageContent({
    savedSiteId,
    url,
    preferRendered = false,
    returnContent = false,
    fromCache = true
}: UnifiedPageContentParams) {
    try {
        let savedSite: any = null;
        let targetUrl = url;

        log(`[getPageContent] targetUrl: ${targetUrl}`)

        // Get saved site if ID provided
        if (savedSiteId) {
            const query = new Parse.Query("websites");
            query.equalTo("objectId", savedSiteId);
            savedSite = await query.first({ useMasterKey: true });
            
            if (!savedSite) {
                return { error: 'Saved site not found' };
            }
            
            targetUrl = targetUrl || savedSite.get("url");
        }

        if (!targetUrl) {
            return { error: 'No URL provided for content extraction' };
        }

        log(`[getPageContent] Extracting content from: ${targetUrl}`);

        // Fetch strategies, cheapest first. Each one runs only while the best
        // result so far is weak, and the longest extraction wins.
        let html: string | null = null;
        let extractionMethod = 'direct';
        let extracted: ExtractedContent | null = null;

        // Jev's read of an extraction (wall? article?), asked once per
        // candidate. Null when it is off or the call fails: then only the
        // length rule below decides, as before.
        const checks = new WeakMap<ExtractedContent, Promise<PageCheck | null>>();
        const check = (e: ExtractedContent) => {
            if (!checks.has(e)) {
                checks.set(e, jevOn('JEV_PAGE_CHECK')
                    ? askJev(pageCheckRequest(targetUrl, e.title, e.text), 'pageCheck', 8000)
                        .then(readPageCheck)
                        .catch((error) => { console.error('[getPageContent] Jev page check failed:', error?.message); return null; })
                    : Promise.resolve(null));
            }
            return checks.get(e)!;
        };

        // A bare meta description or a body under the article threshold is
        // almost always a wall or an app shell — worth the next, dearer fetch.
        // Past that length, Jev catches the walls that are long enough to pass
        // (cookie notices, login prompts, bot checks).
        const isWeak = async (e: ExtractedContent | null) =>
            !e || e.strategy === 'none' || e.strategy === 'metadata' || e.text.length < MIN_CONTENT_LENGTH
            || ((await check(e))?.barrier ?? 0) >= BARRIER_AT;

        const consider = async (candidateHtml: string | null, method: string) => {
            if (!candidateHtml) return;
            const candidate = extractContent(candidateHtml, targetUrl);
            log(`[getPageContent] ${method} extraction: strategy=${candidate.strategy} length=${candidate.text.length}`);
            // Real content beats a longer wall; otherwise the longest extraction wins.
            let better = !extracted;
            if (extracted) {
                const [weakNow, weakNew] = await Promise.all([isWeak(extracted), isWeak(candidate)]);
                better = weakNow !== weakNew ? !weakNew : candidate.text.length > extracted.text.length;
            }
            if (better) {
                html = candidateHtml;
                extracted = candidate;
                extractionMethod = method;
            }
        };

        // Strategy 0: the DOM the browser extension captured. It is post-login
        // and post-JS, so for Instagram/X/LinkedIn/paywalls it is the only copy
        // with the real content on it.
        // Rows hydrated from cache carry the file pointer without its URL column.
        const clientHtmlUrl = savedSite?.get('siteHtmlFileUrl') || savedSite?.get('siteHtmlFile')?.url?.();
        if (clientHtmlUrl && !preferRendered) {
            await consider(await fetchPageHtml(clientHtmlUrl, 'client'), 'client');
        }

        // Strategy 1: direct fetch. Browser headers matter: without a User-Agent
        // a good number of sites answer with a bot page or a 403.
        if (!preferRendered && await isWeak(extracted)) {
            const directHtml = await fetchPageHtml(targetUrl, 'direct', BROWSER_HEADERS);
            await consider(directHtml, 'direct');

            // Strategy 1b: the page's AMP twin — static, no JS, rarely walled.
            if (await isWeak(extracted) && directHtml) {
                const ampUrl = findAmpUrl(directHtml, targetUrl);
                if (ampUrl && ampUrl !== targetUrl) {
                    await consider(await fetchPageHtml(ampUrl, 'amp', BROWSER_HEADERS), 'amp');
                }
            }
        }

        // Strategy 2: rendered HTML through the proxy, JS executed. The paid
        // path, so only when everything cheaper came back weak.
        if (preferRendered || await isWeak(extracted)) {
            log('[getPageContent] Attempting rendered HTML fetch...');
            const renderedHtml = await fetchRenderedHtml(targetUrl);
            if (renderedHtml) {
                log(`[getPageContent] Rendered fetch successful (${renderedHtml.length} chars)`);
                await consider(renderedHtml, 'rendered');
            } else if (!html) {
                console.error('[getPageContent] Rendered fetch failed');
                return { error: 'Failed to fetch page content with both methods' };
            }
        }

        if (!html || !extracted) {
            console.error('[getPageContent] No HTML content to process for URL:', targetUrl);
            return { error: 'No HTML content to process' };
        }

        return await saveExtractedContent({
            extracted,
            pageCheck: extracted.text ? await check(extracted) : null,
            savedSite,
            savedSiteId,
            url: targetUrl,
            extractionMethod,
            returnContent
        });

    } catch (error) {
        console.error('[getUnifiedPageContent] Error:', error);
        return { error: 'Content extraction failed', details: error.message };
    }
}

/**
 * Persists an extraction to the website row.
 *
 * Two columns matter downstream and they are NOT interchangeable:
 *   `siteBodyFile` — the article HTML, what the web modal and the native reader
 *                    render as formatted prose.
 *   `siteBody`     — a plain-text copy, used for search, AI summaries and audio.
 *
 * Both are written together so the two clients can never disagree about what a
 * bookmark's content is.
 */
async function saveExtractedContent(params: any) {
    const {
        extracted,
        pageCheck,
        savedSite,
        savedSiteId,
        url,
        extractionMethod,
        returnContent
    } = params || {};

    try {
        // Every fetch came back a wall. Storing it would get a cookie notice
        // summarised, tagged, embedded, and copied to every later saver of
        // this URL through the cache; flag the row instead.
        const walled = (pageCheck?.barrier ?? 0) >= BARRIER_AT;
        if (walled) {
            log(`[getPageContent] Only a wall (p=${pageCheck.barrier}) for ${url}`);
            if (savedSite && !returnContent) {
                savedSite.set('contentWalled', true);
                await savedSite.save(null, { useMasterKey: true });
            }
        } else if (savedSite?.get('contentWalled')) {
            savedSite.set('contentWalled', false);
        }

        if (!extracted || !extracted.text || walled) {
            log(`[getPageContent] No readable content found for ${url}`);
            return {
                success: true,
                extractionMethod,
                isReadable: false,
                strategy: extracted?.strategy || 'none',
                contentLength: 0,
                savedSiteId: savedSiteId || null,
                ...(returnContent ? { siteText: '', content: '', articleData: null, endpoint: 'getPageContent' } : {})
            };
        }

        const siteBodyText = extracted.text.substring(0, SITE_BODY_TEXT_LIMIT);

        if (savedSite && !returnContent) {
            // Article HTML goes to a file — it is far too big for a column, and
            // both readers fetch it lazily when the reader tab opens.
            if (extracted.html) {
                try {
                    const userId = savedSite.get('user')?.id || savedSite.get('userId') || '';
                    const fileName = createFileName(userId, 'article', 'html', 'saveExtractedContent');
                    const articleFile = new Parse.File(fileName, {
                        base64: Buffer.from(extracted.html).toString('base64')
                    }, 'text/html');

                    await articleFile.save({ useMasterKey: true });
                    savedSite.set('siteBodyFile', articleFile);
                    savedSite.set('siteBodyFileUrl', articleFile.url());
                } catch (fileError) {
                    // A failed file save must not cost us the text too.
                    console.error('[getPageContent] Article file save failed:', fileError);
                }
            }

            savedSite.set('siteBody', siteBodyText);
            // Summaries, tags and audio follow the page's language when the user asks for 'same'.
            if (pageCheck?.language) savedSite.set('language', pageCheck.language);

            // Only mark it an article when there is enough prose to read. A page
            // whose body is just its meta description is not one, and neither is
            // a long product page or homepage when Jev has read it.
            const readsAsArticle = pageCheck?.article === undefined || pageCheck.article >= ARTICLE_AT;
            if (extracted.strategy !== 'metadata' && siteBodyText.length >= MIN_CONTENT_LENGTH && readsAsArticle) {
                const siteSubType = savedSite.get('subType')
                    ? [...new Set([...savedSite.get('subType'), 'article'])]
                    : ['article'];
                savedSite.set('subType', siteSubType);
            }

            await savedSite.save(null, { useMasterKey: true });
            log(`[getPageContent] Saved ${siteBodyText.length} chars (${extracted.strategy}) for ${savedSiteId}`);
        }

        if (returnContent) {
            return {
                success: true,
                extractionMethod,
                strategy: extracted.strategy,
                isReadable: extracted.isReadable,
                siteText: siteBodyText,
                content: extracted.html || siteBodyText,
                articleData: {
                    title: extracted.title,
                    byline: extracted.byline,
                    excerpt: extracted.excerpt,
                    content: extracted.html,
                    textContent: extracted.text
                },
                endpoint: 'getPageContent'
            };
        }

        return {
            success: true,
            extractionMethod,
            strategy: extracted.strategy,
            isReadable: extracted.isReadable,
            contentLength: siteBodyText.length,
            savedSiteId: savedSiteId
        };

    } catch (error) {
        console.error('[saveExtractedContent] Error:', error);
        return { error: 'Content extraction failed', details: error.message };
    }
}

/**
 * Fetches a page as HTML, or null when it is not one worth extracting: a
 * transport error, an error status (a 403 bot wall or a 404 page parses fine
 * and yields a bogus "article"), or a non-HTML body such as a PDF.
 */
async function fetchPageHtml(url: string, label: string, headers?: Record<string, string>): Promise<string | null> {
    const response = await fetchUrlWithProgressiveTimeout(url, headers ? { headers } : {}, `getPageContent:${label}`);

    if ('error' in response) {
        log(`[getPageContent] ${label} fetch failed: ${(response as any).error}`);
        return null;
    }
    if (response.status >= 400) {
        log(`[getPageContent] ${label} fetch returned HTTP ${response.status}`);
        return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html|xml/i.test(contentType)) {
        log(`[getPageContent] ${label} fetch is not HTML (${contentType})`);
        return null;
    }

    const html = await response.text();
    log(`[getPageContent] ${label} fetch successful (${html.length} chars)`);
    return html;
}

// Rendered HTML fetching
//
// Which renderer is used is up to the operator: the bundled screenshot service
// (SCREENSHOT_SERVICE_URL, its /render endpoint), or their own Siterelic key. With neither
// configured there is no JS rendering, and null is returned so the caller keeps whatever the
// plain fetches produced.
async function fetchRenderedHtml(url: string, geoLocation = 'us') {
    try {
        const renderUrl = screenshotServiceUrl('render');
        if (renderUrl) {
            const preflight = await assertPublicUrl(url);
            if ('error' in preflight) {
                log(`[fetchRenderedHtml] Blocked ${url}: ${preflight.error}`);
                return null;
            }
            try {
                const res = await fetch(renderUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': screenshotServiceKey() },
                    body: JSON.stringify({ url, blockAds: true }),
                    signal: AbortSignal.timeout(60000),
                });
                if (!res.ok) {
                    console.error(`[fetchRenderedHtml] render service answered HTTP ${res.status} for ${url}`);
                    return null;
                }
                const body = await res.json() as { html?: string };
                return typeof body.html === 'string' && body.html ? body.html : null;
            } catch (e: any) {
                console.error('[fetchRenderedHtml] render service error:', e?.message || e);
                return null;
            }
        }

        if (!siterelicKey()) return null;

        const response = await fetchUrlWithProgressiveTimeout(
            url,
            { useSiterelic: true, renderJS: true },
            'fetchRenderedHtml'
        );

        if ('error' in response) {
            console.error("[fetchRenderedHtml] Error 1:", (response as any).error);
            return null;
        }

        const responseData = await response.text();
        
        if (response.status !== 200) {
            // Usually the target's own block page (Cloudflare etc.), often hundreds of KB: log the status only.
            console.error(`[fetchRenderedHtml] HTTP ${response.status} for ${url}: ${responseData.slice(0, 200).replace(/\s+/g, ' ')}`);
            return null;
        }

        return responseData;
    } catch (error) {
        console.error('[fetchRenderedHtml] Error 2:', error);
        return null;
    }
}
