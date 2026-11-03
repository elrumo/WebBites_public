/**
 * Article extraction shared by every path that needs a page's readable body.
 *
 * The pipeline used to trust `isProbablyReaderable` as a gate and, when it said
 * no, fell back to `document.body.textContent`. That fallback is what produced
 * bookmarks whose reader body started with `Skip to content {"props":{...}}` —
 * `textContent` walks into `<script type="application/json">` payloads, which
 * modern React/Next/GitHub pages embed by the hundreds of KB. This module fixes
 * both halves: Readability always gets a try, and the fallback reads from a DOM
 * that has been stripped of non-content nodes first.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { decodeHTML } from 'entities';

const virtualConsole = new VirtualConsole();
virtualConsole.on('error', () => { });

/**
 * Headers a real browser sends. Without a User-Agent a meaningful share of
 * sites answer a bare fetch with a 403, a bot-check page or a stripped-down
 * variant — all of which parse fine and extract into a useless "article".
 */
export const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1'
};

/** Elements that never carry article text — dropped before any extraction. */
const NON_CONTENT_TAGS = [
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
    'svg', 'canvas', 'form', 'button', 'select', 'textarea'
];

/** Page furniture — dropped only in the fallback, Readability scores it itself. */
const BOILERPLATE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[role="search"]', '[role="complementary"]', '[aria-hidden="true"]',
    '.nav', '.navbar', '.menu', '.sidebar', '.footer', '.header',
    '.cookie', '.cookie-banner', '.newsletter', '.advertisement', '.ads'
];

/** Containers that usually hold the real content, best guess first. */
const MAIN_SELECTORS = [
    'article', 'main', '[role="main"]', '#content', '.content',
    '#main-content', '.post-content', '.entry-content', '.markdown-body'
];

/** Blocks kept in the simplified HTML we store for the reader views. */
const BLOCK_SELECTORS = 'h1, h2, h3, h4, p, li, blockquote, pre';

/** Below this a "successful" extraction is not worth storing. */
export const MIN_CONTENT_LENGTH = 200;

/**
 * Cap on the `siteBody` text column. Reader bodies are stored whole in
 * `siteBodyFile`; this is the flat copy the search index, AI summaries and TTS
 * read. Lives here because both writers — `getPageContent` and the
 * `reextract-content` migration — must agree on the column's shape, and two
 * private copies of the number drifted.
 */
export const SITE_BODY_TEXT_LIMIT = 16000;

/**
 * A run of embedded JSON/JS that leaked into text. Matches the `{"key":…}` and
 * `{'key':…}` shapes that hydration payloads produce.
 */
const JSON_BLOB = /\{\s*["'][^"']{1,80}["']\s*:[\s\S]{0,20000}?\}(?=\s|$)/g;

/**
 * Strip HTML tags and the debris that survives tag removal. Unlike a plain
 * tag-strip this also deletes script/style/noscript bodies (whose *contents*
 * are not tags and therefore survive a naive `<[^>]+>` replace) and any JSON
 * blob left behind.
 */
export function htmlToText(html: string, limit = 0): string {
    if (!html) return '';

    let text = html
        .replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
        .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|tr|br)\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[^>]+(>|$)/g, ' ');

    text = decodeEntities(text);
    text = stripJsonBlobs(text);

    text = text
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return limit > 0 ? text.substring(0, limit) : text;
}

/** Removes hydration payloads that leaked into extracted text. */
export function stripJsonBlobs(text: string): string {
    if (!text || text.indexOf('{') === -1) return text;
    return text.replace(JSON_BLOB, ' ').replace(/\s{2,}/g, ' ');
}

/**
 * One pass with a complete decoder (named, decimal, hex). The old chain of
 * replaces missed `&rsquo;`/`&#x2019;` and, by doing `&amp;` first, decoded
 * `&amp;lt;` twice.
 */
function decodeEntities(text: string): string {
    return decodeHTML(text).replace(/\u00a0/g, ' ');
}

/** Deletes every element matching `selectors` from a document/element. */
function removeAll(root: any, selectors: string[]) {
    for (const selector of selectors) {
        try {
            root.querySelectorAll(selector).forEach((el: any) => el.remove());
        } catch {
            // An unsupported selector must not abort the whole strip.
        }
    }
}

/**
 * Builds a small, predictable HTML document from a DOM subtree: only the block
 * elements the readers know how to render, with attributes dropped. Both the
 * web reader (`v-html`) and the native `ReaderHTMLParser` consume this subset.
 */
function simplifyToHtml(root: any, document: any): string {
    const parts: string[] = [];
    const seen = new Set<string>();

    root.querySelectorAll(BLOCK_SELECTORS).forEach((el: any) => {
        // Skip a block nested in another block we already emitted.
        if (el.closest('li') && el.tagName.toLowerCase() !== 'li') return;

        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) return;

        const key = `${el.tagName}:${text}`;
        if (seen.has(key)) return;
        seen.add(key);

        const tag = el.tagName.toLowerCase();
        const safeTag = ['h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'pre'].includes(tag) ? tag : 'p';
        parts.push(`<${safeTag}>${escapeHtml(text)}</${safeTag}>`);
    });

    // Containers built entirely from <div>/<span> match no block selector. Their
    // text is still the article, so split it into paragraphs rather than
    // returning nothing and letting the caller fall further down the chain.
    if (parts.length === 0) {
        const raw = (root.textContent || '').replace(/[ \t]+/g, ' ').trim();
        for (const chunk of raw.split(/\n\s*\n|(?<=\.)\s{2,}/)) {
            const text = chunk.replace(/\s+/g, ' ').trim();
            if (text.length > 1) parts.push(`<p>${escapeHtml(text)}</p>`);
        }
    }

    // Images are the one inline element worth keeping — both readers show them.
    root.querySelectorAll('img[src]').forEach((img: any) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) return;
        try {
            const absolute = new (document.defaultView.URL)(src, document.baseURI).href;
            if (seen.has(absolute)) return;
            seen.add(absolute);
            parts.push(`<img src="${escapeHtml(absolute)}" />`);
        } catch {
            // Relative URL we cannot resolve — not worth storing.
        }
    });

    return parts.join('\n');
}

/** `[Image: optional caption https://…]` — a whole line, as JSON-LD bodies write it. */
const IMAGE_MARKER = /^\[Image:\s*(.*?)\s*(https?:\/\/[^\s\]]+)\s*\]$/i;

export function parseImageMarker(line: string): { caption: string; url: string } | null {
    const match = line.trim().match(IMAGE_MARKER);
    if (!match) return null;
    try {
        return { caption: match[1].trim(), url: new URL(match[2]).href };
    } catch {
        return null;
    }
}

function imageFigureHtml(url: string, caption: string): string {
    const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
    return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}" />${figcaption}</figure>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Removes exact duplicate blocks and images from a content subtree. Responsive
 * markup (mobile/desktop variants, a hero image repeated in the body) survives
 * Readability's own scoring since JSDOM never computes `display:none`.
 */
function dedupeContent(root: any, document: any) {
    const seen = new Set<string>();

    root.querySelectorAll(`${BLOCK_SELECTORS}, img[src]`).forEach((el: any) => {
        const tag = el.tagName.toLowerCase();
        let key: string;

        if (tag === 'img') {
            const src = el.getAttribute('src');
            if (!src) return;
            try {
                key = `img:${new (document.defaultView.URL)(src, document.baseURI).href}`;
            } catch {
                return;
            }
        } else {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            key = `${tag}:${text}`;
        }

        if (seen.has(key)) el.remove();
        else seen.add(key);
    });
}

/**
 * Pulls `articleBody` out of the page's JSON-LD. Publishers embed the full
 * article there for search engines even when the DOM shows a paywall teaser or
 * lazy-loads the body, so it survives walls that beat every DOM strategy.
 */
function findJsonLdArticle(document: any): { body: string; title: string | null; byline: string | null } | null {
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')) as any[]) {
        let data: any;
        try { data = JSON.parse(script.textContent || ''); } catch { continue; }

        // Walk every nested object: articles hide under @graph, mainEntity, etc.
        const stack = [data];
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (!Array.isArray(node) && typeof node.articleBody === 'string' && node.articleBody.trim()) {
                const author = node.author;
                const byline = typeof author === 'string' ? author
                    : Array.isArray(author) ? author.map((a: any) => a?.name).filter(Boolean).join(', ')
                    : author?.name || null;
                return { body: node.articleBody, title: node.headline || node.name || null, byline: byline || null };
            }
            stack.push(...Object.values(node));
        }
    }
    return null;
}

/** Resolves the page's `<link rel="amphtml">`, if any. AMP pages are static and rarely walled. */
export function findAmpUrl(html: string, baseUrl: string): string | null {
    const tag = html?.match(/<link\b[^>]*\brel=["']amphtml["'][^>]*>/i)?.[0];
    const href = tag?.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) return null;
    try { return new URL(href, baseUrl).href; } catch { return null; }
}

/** Picks the densest plausible content container, falling back to `<body>`. */
function pickMainElement(document: any) {
    let best: any = null;
    let bestLength = 0;

    for (const selector of MAIN_SELECTORS) {
        let candidates: any[] = [];
        try {
            candidates = Array.from(document.querySelectorAll(selector));
        } catch {
            continue;
        }
        for (const candidate of candidates) {
            const length = (candidate.textContent || '').trim().length;
            if (length > bestLength) {
                best = candidate;
                bestLength = length;
            }
        }
    }

    return bestLength >= MIN_CONTENT_LENGTH ? best : document.body;
}

export interface ExtractedContent {
    /** Simplified article HTML — the block subset both readers render. */
    html: string;
    /** Plain text of the same content. */
    text: string;
    /** Article title Readability found, when it ran successfully. */
    title?: string | null;
    byline?: string | null;
    excerpt?: string | null;
    /** How the content was obtained, for logging and debugging. */
    strategy: 'json-ld' | 'readability' | 'main-element' | 'body' | 'metadata' | 'none';
    /** What `isProbablyReaderable` thought — reported, no longer a gate. */
    isReadable: boolean;
}

/**
 * Extracts the readable body of an HTML document.
 *
 * Order of attempts:
 *  1. Readability — always tried, regardless of `isProbablyReaderable`.
 *  2. The densest `<article>`/`<main>`/content container, cleaned.
 *  3. `<body>`, cleaned of scripts and page furniture.
 *  4. The page's own meta description, so something honest is stored.
 *
 * A strategy that clears `MIN_CONTENT_LENGTH` wins immediately. Short results
 * are not thrown away — the longest one is kept as a candidate, so a genuinely
 * brief page still gets its real text instead of nothing.
 */
export function extractContent(html: string, url: string): ExtractedContent {
    const empty: ExtractedContent = {
        html: '', text: '', title: null, byline: null, excerpt: null,
        strategy: 'none', isReadable: false
    };

    if (!html) return empty;

    let dom: JSDOM;
    try {
        dom = new JSDOM(html, { url, virtualConsole });
    } catch (error) {
        console.error('[extractContent] Could not parse HTML:', (error as Error).message);
        return empty;
    }

    const document = dom.window.document;

    // Read metadata before anything mutates the DOM — the last-resort branch
    // below needs it, and by then the stripping has already run.
    const metaDescription = (
        document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
        document.querySelector('meta[name="description"]')?.getAttribute('content') ||
        ''
    ).trim();
    const docTitle = (document.title || '').trim() || null;

    // Best short result seen so far — used only if no strategy clears the bar.
    let best: ExtractedContent = { ...empty };

    let isReadable = false;
    try {
        isReadable = isProbablyReaderable(document, { minScore: 15, minContentLength: 40 });
    } catch {
        // Heuristic only — never a reason to stop.
    }

    // 0. JSON-LD articleBody. Read before any stripping — it lives in a
    //    <script>. Not returned outright: Readability keeps images and
    //    structure, so when both clear the bar the longer text wins.
    let jsonLd: ExtractedContent | null = null;
    const ld = findJsonLdArticle(document);
    if (ld) {
        const lines = ld.body.replace(/\r/g, '').split(/\n+/)
            .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
        // Some publishers (The Verge, Vox) inline their figures as
        // `[Image: caption https://…]` lines. Render those as images and keep
        // them out of the text that summaries, search and TTS read.
        const paragraphs = lines.filter(line => !parseImageMarker(line));
        jsonLd = {
            html: lines.map(line => {
                const image = parseImageMarker(line);
                return image ? imageFigureHtml(image.url, image.caption) : `<p>${escapeHtml(line)}</p>`;
            }).join('\n'),
            text: paragraphs.join('\n'),
            title: ld.title || docTitle,
            byline: ld.byline,
            excerpt: null,
            strategy: 'json-ld',
            isReadable
        };
        if (jsonLd.text.length > best.text.length) best = jsonLd;
    }

    // 1. Readability. Runs even when the heuristic said no: it is tuned for
    //    news articles and rejects perfectly readable docs, READMEs and
    //    documentation pages that users bookmark constantly.
    try {
        const clone = document.cloneNode(true) as any;
        removeAll(clone, NON_CONTENT_TAGS);

        const article = new Readability(clone, {
            charThreshold: 20,
            classesToPreserve: [],
            debug: false
        }).parse();

        if (article?.content) {
            const container = document.createElement('div');
            container.innerHTML = article.content;
            dedupeContent(container, document);
            const dedupedContent = container.innerHTML;

            const text = htmlToText(dedupedContent);
            const candidate: ExtractedContent = {
                html: sanitizeArticleHtml(dedupedContent),
                text,
                title: article.title || null,
                byline: article.byline || null,
                excerpt: article.excerpt || null,
                strategy: 'readability',
                isReadable
            };
            if (text.length >= MIN_CONTENT_LENGTH) {
                return jsonLd && jsonLd.text.length > text.length ? jsonLd : candidate;
            }
            if (text.length > best.text.length) best = candidate;
        }
    } catch (error) {
        console.error('[extractContent] Readability failed:', (error as Error).message);
    }

    if (jsonLd && jsonLd.text.length >= MIN_CONTENT_LENGTH) return jsonLd;

    // 2 & 3. DOM fallback. Strip the non-content nodes *first* — this is the
    //        step whose absence produced the `{"props":…}` reader bodies.
    try {
        removeAll(document, NON_CONTENT_TAGS);

        const main = pickMainElement(document);
        if (main) {
            const usingMain = main !== document.body;
            if (!usingMain) removeAll(document, BOILERPLATE_SELECTORS);

            const simplified = simplifyToHtml(main, document);
            const text = htmlToText(simplified || main.innerHTML || '');

            const candidate: ExtractedContent = {
                html: simplified,
                text,
                title: docTitle,
                byline: null,
                excerpt: null,
                strategy: usingMain ? 'main-element' : 'body',
                isReadable
            };
            if (text.length >= MIN_CONTENT_LENGTH) return candidate;
            if (text.length > best.text.length) best = candidate;
        }
    } catch (error) {
        console.error('[extractContent] DOM fallback failed:', (error as Error).message);
    }

    // 4. Nothing readable on the page (a login wall, an app shell, a media
    //    page). Storing the description beats storing a wall of script JSON.
    // A short but real extraction beats the description; the description beats
    // nothing at all.
    if (best.text.length > 0 && best.text.length >= metaDescription.length) {
        return { ...best, isReadable };
    }

    if (metaDescription) {
        return {
            html: `<p>${escapeHtml(metaDescription)}</p>`,
            text: metaDescription,
            title: docTitle,
            byline: null,
            excerpt: null,
            strategy: 'metadata',
            isReadable
        };
    }

    return { ...best, isReadable };
}

/** Drops inline styles and any script/style that survived Readability. */
export function sanitizeArticleHtml(html: string): string {
    return html
        .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/\s*style="[^"]*"/gi, '')
        .replace(/\s*on[a-z]+="[^"]*"/gi, '');
}

/**
 * Recognises a reader body produced by the old `body.textContent` fallback.
 *
 * Used by the re-extraction migration to pick out affected rows instead of
 * re-fetching every bookmark in the database. Deliberately conservative: a
 * false negative just leaves a row for a later pass, while a false positive
 * spends a page fetch and rewrites a body that was already fine.
 */
export function looksLikeBadExtraction(siteBody: string | null | undefined): {
    bad: boolean;
    reason: string | null;
} {
    if (!siteBody || typeof siteBody !== 'string') return { bad: false, reason: null };

    const text = siteBody.trim();
    if (!text) return { bad: false, reason: null };

    // A hydration payload: a quoted key immediately inside a brace. This is the
    // signature of the old fallback and never appears in Readability output,
    // which keeps JSON samples inside <code>/<pre> markup.
    const payload = /\{\s*["'][a-zA-Z_$@][^"']{0,60}["']\s*:/.test(text);
    if (payload) return { bad: true, reason: 'hydration-payload' };

    // Inline script leftovers.
    if (/\bwindow\.__|__NEXT_DATA__|__NUXT__|\bdataLayer\.push\(/.test(text)) {
        return { bad: true, reason: 'inline-script' };
    }

    // CSS that got swept in with the text.
    if (/\{[^{}]{0,120}(display|font-size|margin|padding|color)\s*:\s*[^;{}]+;/.test(text)) {
        return { bad: true, reason: 'inline-css' };
    }

    // The old fallback collapsed *all* whitespace, so a long body with no line
    // break at all is a strong tell — real extractions keep paragraph breaks.
    if (text.length > 1500 && !text.includes('\n')) {
        return { bad: true, reason: 'no-paragraph-breaks' };
    }

    return { bad: false, reason: null };
}
