/**
 * Deciding whether a URL is a PDF, and getting the bytes when it is.
 *
 * The naive version of this check — `url.endsWith('.pdf')` — is wrong for most
 * of the PDF links people actually paste. A signed S3 link carries its
 * signature in the query string, a citation link carries `#page=12`, a Java
 * servlet carries `;jsessionid=…` in the path, and arXiv serves its papers from
 * a path with no extension at all. All four are PDFs and all four fail a suffix
 * test, so the link would get scraped as a web page and stored as a bookmark
 * whose "article" is whatever the browser wall said.
 *
 * So detection happens in two tiers, and the split is deliberate: the cheap one
 * runs on every save and costs nothing, and the network one only runs when the
 * URL has already given us a reason to ask.
 *
 *   1. {@link looksLikePdfUrl} — syntax only. The path (decoded, stripped of
 *      query, fragment and path parameters) ends in `.pdf`, or the host is one
 *      of the few that serve PDFs from a known extension-less path.
 *   2. {@link probePdfUrl} — one HEAD, falling back to a ranged GET, reading
 *      the content type, the filename in `Content-Disposition`, and finally the
 *      `%PDF-` magic bytes. Run when {@link mayBePdfUrl} finds a hint.
 *
 * Nothing downstream trusts either answer on its own: {@link fetchPdf} checks
 * the magic bytes of what actually arrived, so a URL that looked like a PDF and
 * served an HTML error page falls back to the normal save path rather than
 * storing a bookmark whose "document" is a login form.
 */

/**
 * Pulled in at call time rather than at module load: everything above the
 * network functions here is pure, and a static import of `serverUtils` drags
 * Parse, Algolia and the rest of the server in behind it — which is what the
 * test file would otherwise have to stand up just to check a regex.
 */
async function localUrlGuard(url: string): Promise<boolean> {
    try {
        // assertPublicUrl, not isLocalUrl: the resolved addresses are what
        // matter, not whether the hostname happens to look private.
        const { assertPublicUrl } = await import('./safeUrl');
        return 'error' in (await assertPublicUrl(url));
    } catch {
        // Cannot tell: assume it is local and refuse, rather than fetching
        // something we were meant to keep away from.
        return true;
    }
}

/** `%PDF-`, the five bytes every PDF starts with. */
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

/**
 * How far into the file the header is allowed to sit.
 *
 * The spec says byte zero, but real files carry BOMs, stray newlines and the
 * occasional HTTP header a proxy forgot to strip, and every reader tolerates
 * it. Acrobat scans the first 1KB, so we do too.
 */
const MAGIC_SEARCH_WINDOW = 1024;

/** Content types that are a PDF, whatever the URL looks like. */
const PDF_CONTENT_TYPES = new Set([
    'application/pdf',
    'application/x-pdf',
    'application/acrobat',
    'application/vnd.pdf',
    'text/pdf',
    'text/x-pdf'
]);

/**
 * Types a server sends when it has no idea what it is serving. Not a PDF on
 * their own — they only count alongside a filename or magic bytes that say so.
 */
const AMBIGUOUS_CONTENT_TYPES = new Set([
    'application/octet-stream',
    'binary/octet-stream',
    'application/download',
    'application/force-download',
    'application/unknown',
    ''
]);

/**
 * Hosts that serve PDFs from a path with no extension on it.
 *
 * Deliberately a short list of the ones that show up constantly in a research
 * bookmark collection rather than an attempt at completeness — anything else
 * with a hint still reaches the probe, which reads the bytes.
 */
const EXTENSIONLESS_PDF_PATHS: { host: RegExp; path: RegExp }[] = [
    // arxiv.org/pdf/2401.12345, /pdf/2401.12345v2, and the older /pdf/cs/0501001
    { host: /(^|\.)arxiv\.org$/i, path: /^\/pdf\// },
    // biorxiv/medrxiv: /content/10.1101/2021.01.01.425001v1.full.pdf is caught
    // by the extension, but the `.full-text` style permalinks are not.
    { host: /(^|\.)(bio|med)rxiv\.org$/i, path: /\.full(-text)?$/ },
    // /doi/pdf/10.1145/… on the ACM and Wiley reader
    { host: /(^|\.)(dl\.acm\.org|onlinelibrary\.wiley\.com|journals\.sagepub\.com)$/i, path: /^\/doi\/(epdf|pdf)\// },
    // NBER, SSRN and friends hand a paper out from a query-only endpoint
    { host: /(^|\.)nber\.org$/i, path: /^\/system\/files\/working_papers\// }
];

/** Query keys whose value is the real target — a viewer wrapping a document. */
const EMBEDDED_URL_KEYS = ['file', 'url', 'src', 'href', 'document', 'doc', 'pdf', 'target', 'q'];

/** Query keys that name a format rather than a file. */
const FORMAT_KEYS = ['format', 'type', 'output', 'filetype', 'file_type', 'ext', 'extension', 'mimetype', 'download', 'as', 'rendition'];

/** Path words that mean "this hands you a file", without saying which. */
const DOWNLOAD_PATH_WORDS = /(^|[/_-])(pdf|download|downloads|attachment|attachments|getfile|get-file|fetchfile|export|render|print|viewer|view|document|documents|fulltext|full-text|paper|datastream|content)([/_-]|$)/i;

/** A cap on what we will pull down for a bookmark. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface PdfProbe {
    /** Whether this URL serves a PDF. */
    isPdf: boolean;
    /** The URL that actually holds the document — see {@link pdfTargetUrl}. */
    url: string;
    /** As reported, lowercased and stripped of its `; charset=…`. */
    contentType?: string;
    /** From `Content-Disposition`, or the last path segment. */
    fileName?: string;
    /** From `Content-Length`, when the server sent one. */
    contentLength?: number;
    /** Which tier answered, for the logs. */
    detectedBy: 'extension' | 'known-host' | 'embedded-url' | 'content-type' | 'content-disposition' | 'magic-bytes' | 'none';
}

/**
 * The path, decoded, with everything that is not the path removed.
 *
 * `new URL()` already takes the query and the fragment off. What it leaves is
 * RFC 3986 path parameters — the `;jsessionid=B4F…` a Java container appends —
 * and percent-encoding, so `/reports/Q3%20results.pdf` has to be decoded before
 * an extension test means anything.
 */
function normalisedPathname(parsed: URL): string {
    let path = parsed.pathname;

    // Path parameters hang off the last segment: /a/b;v=1 -> /a/b
    const lastSlash = path.lastIndexOf('/');
    const semicolon = path.indexOf(';', lastSlash + 1);
    if (semicolon !== -1) path = path.slice(0, semicolon);

    // A trailing slash is a directory-ish spelling of the same file:
    // /docs/report.pdf/ is served by more than one CMS.
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    try {
        return decodeURIComponent(path);
    } catch {
        // A stray % that is not an escape. The undecoded path is still better
        // than throwing, and `.pdf` survives it either way.
        return path;
    }
}

/** Parse, or nothing — every entry point here takes a string from a user. */
function parseUrl(url: string): URL | null {
    if (!url || typeof url !== 'string') return null;
    try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed;
    } catch {
        return null;
    }
}

/** True when the path — and only the path — ends in `.pdf`. */
function pathHasPdfExtension(parsed: URL): boolean {
    return /\.pdf$/i.test(normalisedPathname(parsed));
}

/**
 * The document a viewer URL is pointing at.
 *
 * `https://reader.example/web/viewer.html?file=https%3A//x.org/paper.pdf` is a
 * page, not a PDF — but the thing the reader means to save is the paper, and it
 * is right there in the query string. Same shape for Google's viewer (`?url=`)
 * and for most in-house PDF.js deployments. Only absolute http(s) values count:
 * a relative `?file=report.pdf` names a path on a host we would have to guess
 * at, and that is what the probe is for.
 */
export function embeddedPdfUrl(url: string): string | null {
    const parsed = parseUrl(url);
    if (!parsed) return null;

    for (const [key, value] of parsed.searchParams) {
        if (!EMBEDDED_URL_KEYS.includes(key.toLowerCase())) continue;
        const inner = parseUrl(value);
        if (inner && pathHasPdfExtension(inner)) return inner.toString();
    }
    return null;
}

/**
 * Tier 1: this is a PDF and no request is needed to know it.
 *
 * Everything after the path is ignored on purpose — a query string, a fragment
 * and a path parameter are all things a server puts *around* a filename, and
 * none of them changes what the file is.
 */
export function looksLikePdfUrl(url: string): boolean {
    const parsed = parseUrl(url);
    if (!parsed) return false;

    if (pathHasPdfExtension(parsed)) return true;

    const path = normalisedPathname(parsed);
    if (EXTENSIONLESS_PDF_PATHS.some(entry => entry.host.test(parsed.hostname) && entry.path.test(path))) return true;

    return embeddedPdfUrl(url) !== null;
}

/**
 * Tier 2's gate: worth spending a request on.
 *
 * The cost of a false positive here is one HEAD; the cost of a false negative
 * is a PDF stored as a broken web page. So this leans generous — a path that
 * says `download`, a `?format=pdf`, a query value that names a `.pdf` — while
 * still refusing to probe the ordinary article URL, which is the overwhelming
 * majority of what gets saved.
 */
export function mayBePdfUrl(url: string): boolean {
    const parsed = parseUrl(url);
    if (!parsed) return false;
    if (looksLikePdfUrl(url)) return true;

    const path = normalisedPathname(parsed);

    // A path that already names a page in some other format is not a PDF.
    if (/\.(html?|aspx?|jsp|php|json|xml|txt|csv|zip|png|jpe?g|gif|webp|svg|mp[34]|mov|docx?|pptx?|xlsx?)$/i.test(path)) {
        // …unless the query is pointing somewhere else entirely, which
        // `looksLikePdfUrl` already answered above.
        return false;
    }

    if (DOWNLOAD_PATH_WORDS.test(path)) return true;

    for (const [key, value] of parsed.searchParams) {
        const k = key.toLowerCase();
        const v = value.toLowerCase();
        if (FORMAT_KEYS.includes(k) && (v === 'pdf' || v === 'application/pdf')) return true;
        // `?file=report.pdf`, `?attachment=2024%20summary.pdf`
        if (/\.pdf$/i.test(v.split('?')[0].split('#')[0])) return true;
        // S3 pre-signed downloads name the file in the response override
        if (k.startsWith('response-content-') && v.includes('.pdf')) return true;
        if (k.startsWith('response-content-type') && v.includes('pdf')) return true;
    }

    return false;
}

/** The content type without its parameters, lowercased. */
export function normaliseContentType(raw?: string | null): string {
    return (raw || '').split(';')[0].trim().toLowerCase();
}

/** The `filename` out of a `Content-Disposition`, RFC 5987 form included. */
export function fileNameFromContentDisposition(raw?: string | null): string | undefined {
    if (!raw) return undefined;

    // filename*=UTF-8''Q3%20results.pdf wins over the ASCII fallback when both
    // are present, which is exactly when the name has non-ASCII characters in it.
    const extended = raw.match(/filename\*\s*=\s*([^']*)'([^']*)'([^;]+)/i);
    if (extended) {
        try {
            return decodeURIComponent(extended[3].trim());
        } catch {
            return extended[3].trim();
        }
    }

    const plain = raw.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
    if (plain) return (plain[2] ?? plain[1]).trim();

    return undefined;
}

/** Does this set of response headers describe a PDF? */
export function pdfFromHeaders(headers: Headers): { isPdf: boolean; detectedBy: PdfProbe['detectedBy'] } {
    const contentType = normaliseContentType(headers.get('content-type'));
    if (PDF_CONTENT_TYPES.has(contentType)) return { isPdf: true, detectedBy: 'content-type' };

    const fileName = fileNameFromContentDisposition(headers.get('content-disposition'));
    if (fileName && /\.pdf$/i.test(fileName.trim())) {
        // A server that says `text/html` and attaches `report.pdf` is confused,
        // not lying about the attachment — but only believe it when the type is
        // one of the ones servers send by default.
        if (AMBIGUOUS_CONTENT_TYPES.has(contentType) || PDF_CONTENT_TYPES.has(contentType)) {
            return { isPdf: true, detectedBy: 'content-disposition' };
        }
    }

    return { isPdf: false, detectedBy: 'none' };
}

/** `%PDF-` within the first kilobyte. */
export function isPdfBytes(bytes: Buffer | ArrayBuffer | Uint8Array | null | undefined): boolean {
    if (!bytes) return false;
    const buffer = Buffer.isBuffer(bytes)
        ? bytes
        : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    if (buffer.length < PDF_MAGIC.length) return false;
    return buffer.subarray(0, MAGIC_SEARCH_WINDOW + PDF_MAGIC.length).indexOf(PDF_MAGIC) !== -1;
}

/**
 * A filename for the stored file.
 *
 * The `Content-Disposition` name is the one the server meant the user to see,
 * so it wins; the last path segment is the fallback, and a URL with nothing
 * usable in it gets a generated name rather than an empty one.
 */
export function pdfFileName(url: string, headers?: Headers | null): string {
    const fromHeader = headers ? fileNameFromContentDisposition(headers.get('content-disposition')) : undefined;
    if (fromHeader) return ensurePdfExtension(fromHeader);

    const parsed = parseUrl(url);
    if (parsed) {
        const path = normalisedPathname(parsed);
        const segment = path.slice(path.lastIndexOf('/') + 1);
        if (segment) return ensurePdfExtension(segment);
        if (parsed.hostname) return ensurePdfExtension(parsed.hostname);
    }

    return `document-${Date.now()}.pdf`;
}

function ensurePdfExtension(name: string): string {
    const cleaned = name.replace(/[\r\n"]/g, '').trim();
    if (!cleaned) return `document-${Date.now()}.pdf`;
    return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

/** A human title from a filename: `Q3_results-final.pdf` -> `Q3 results final`. */
export function titleFromPdfFileName(fileName: string): string {
    return fileName
        .replace(/\.pdf$/i, '')
        .replace(/[_+]+/g, ' ')
        .replace(/-{2,}/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * The URL to actually download.
 *
 * For a viewer link that is the document it wraps; for everything else it is
 * the URL itself.
 */
export function pdfTargetUrl(url: string): string {
    return embeddedPdfUrl(url) || url;
}

interface ProbeOptions {
    /** Per-request budget. Two requests at most, so the wall clock is 2x this. */
    timeoutMs?: number;
    headers?: Record<string, string>;
}

const PDF_REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8'
};

async function requestWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // safeFetch re-checks each redirect hop; `redirect: 'follow'` here used
        // to let a public URL bounce the request to an internal host.
        const { safeFetch } = await import('./safeUrl');
        return await safeFetch(url, { ...init, signal: controller.signal });
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Tier 2: ask the server.
 *
 * HEAD first because it is free — no body crosses the wire. Plenty of servers
 * answer it with a 405, or with headers that do not match what a GET would
 * return, so a ranged GET of the first kilobyte is the fallback: enough to read
 * the magic bytes and no more.
 */
export async function probePdfUrl(url: string, options: ProbeOptions = {}): Promise<PdfProbe> {
    const target = pdfTargetUrl(url);
    const timeoutMs = options.timeoutMs ?? 8000;
    const headers = { ...PDF_REQUEST_HEADERS, ...(options.headers || {}) };
    const miss: PdfProbe = { isPdf: false, url: target, detectedBy: 'none' };

    if (!parseUrl(target) || await localUrlGuard(target)) return miss;

    const head = await requestWithTimeout(target, { method: 'HEAD', headers }, timeoutMs);
    if (head && head.ok) {
        const verdict = pdfFromHeaders(head.headers);
        if (verdict.isPdf) {
            return {
                isPdf: true,
                url: target,
                contentType: normaliseContentType(head.headers.get('content-type')),
                fileName: pdfFileName(target, head.headers),
                contentLength: lengthOf(head.headers),
                detectedBy: verdict.detectedBy
            };
        }
        // A server that answered HEAD with a real content type has told us what
        // it serves. Only keep going when it said nothing useful.
        const contentType = normaliseContentType(head.headers.get('content-type'));
        if (contentType && !AMBIGUOUS_CONTENT_TYPES.has(contentType)) return { ...miss, contentType };
    }

    const ranged = await requestWithTimeout(
        target,
        { method: 'GET', headers: { ...headers, Range: `bytes=0-${MAGIC_SEARCH_WINDOW + 64}` } },
        timeoutMs
    );
    if (!ranged || !ranged.ok) return miss;

    const verdict = pdfFromHeaders(ranged.headers);
    const contentType = normaliseContentType(ranged.headers.get('content-type'));

    let magic = false;
    try {
        magic = isPdfBytes(Buffer.from(await ranged.arrayBuffer()));
    } catch {
        magic = false;
    }

    if (!verdict.isPdf && !magic) return { ...miss, contentType };

    return {
        isPdf: true,
        url: target,
        contentType,
        fileName: pdfFileName(target, ranged.headers),
        contentLength: lengthOf(ranged.headers),
        detectedBy: verdict.isPdf ? verdict.detectedBy : 'magic-bytes'
    };
}

function lengthOf(headers: Headers): number | undefined {
    const raw = headers.get('content-length');
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Both tiers, in the order that keeps the common save free.
 *
 * `probe: false` turns the network tier off entirely, for the callers that
 * already know they are holding a PDF and only want the syntax answer.
 */
export async function detectPdfUrl(url: string, options: ProbeOptions & { probe?: boolean } = {}): Promise<PdfProbe> {
    const parsed = parseUrl(url);
    if (!parsed) return { isPdf: false, url, detectedBy: 'none' };

    if (looksLikePdfUrl(url)) {
        const target = pdfTargetUrl(url);
        return {
            isPdf: true,
            url: target,
            fileName: pdfFileName(target),
            detectedBy: target !== url ? 'embedded-url' : (pathHasPdfExtension(parsed) ? 'extension' : 'known-host')
        };
    }

    if (options.probe === false || !mayBePdfUrl(url)) return { isPdf: false, url, detectedBy: 'none' };

    return await probePdfUrl(url, options);
}

export interface FetchedPdf {
    buffer: Buffer;
    fileName: string;
    contentType: string;
    url: string;
}

/**
 * Download, with the two limits that matter: a byte cap, and the magic bytes.
 *
 * The cap is enforced while streaming rather than after, so a server that
 * advertises 1MB and sends 4GB does not get to fill the heap on its way to
 * being rejected. The magic-byte check at the end is what makes tier 1 safe to
 * be optimistic: a `.pdf` URL that 200s with a login page fails here, and the
 * caller falls back to saving it as an ordinary bookmark.
 */
export async function fetchPdf(url: string, options: ProbeOptions & { maxBytes?: number } = {}): Promise<FetchedPdf | { error: string }> {
    const target = pdfTargetUrl(url);
    if (!parseUrl(target)) return { error: 'Invalid URL' };
    if (await localUrlGuard(target)) return { error: 'Local URL' };

    const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
    const response = await requestWithTimeout(
        target,
        { method: 'GET', headers: { ...PDF_REQUEST_HEADERS, ...(options.headers || {}) } },
        options.timeoutMs ?? 30000
    );

    if (!response) return { error: 'Request failed' };
    if (!response.ok) return { error: `HTTP ${response.status}` };

    const advertised = lengthOf(response.headers);
    if (advertised !== undefined && advertised > maxBytes) {
        return { error: `PDF is larger than ${Math.round(maxBytes / (1024 * 1024))}MB` };
    }

    let buffer: Buffer;
    try {
        buffer = await readCapped(response, maxBytes);
    } catch (error: any) {
        return { error: error?.message || 'Download failed' };
    }

    if (!isPdfBytes(buffer)) return { error: 'Not a PDF' };

    return {
        buffer,
        fileName: pdfFileName(target, response.headers),
        contentType: 'application/pdf',
        url: target
    };
}

/** Read the body, refusing it the moment it goes over the cap. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) throw new Error(`PDF is larger than ${Math.round(maxBytes / (1024 * 1024))}MB`);
        return buffer;
    }

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`PDF is larger than ${Math.round(maxBytes / (1024 * 1024))}MB`);
        }
        chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks, total);
}
