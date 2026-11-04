/**
 * Reading a PDF: what it says, how long it is, and what its first page looks
 * like.
 *
 * A PDF bookmark that stores only the file is a card with a filename on it —
 * not searchable, not summarisable, and visually indistinguishable from every
 * other PDF in the grid. Three things fix that and all three come out of the
 * same document:
 *
 *   - the text, which goes to `siteBody` and from there to Meilisearch, the AI
 *     summary and the audio reader, exactly like a scraped article's;
 *   - the metadata, because a paper's real title is almost never its filename
 *     (`1-s2.0-S0925231220305632-main.pdf` is a real one);
 *   - the first page, rendered, which becomes the card's cover.
 *
 * Everything here fails soft and returns null. pdf.js refuses encrypted files,
 * the canvas backend is a native module that may not have a build for the
 * platform, and a scanned PDF has no text layer at all — none of which is a
 * reason to lose a bookmark the user has already handed us the bytes for.
 */

import { SITE_BODY_TEXT_LIMIT as TEXT_LIMIT } from '#root/server/utils/contentExtraction.js';

/**
 * Pages to read text from.
 *
 * pdf.js walks page by page, so a 900-page scanned manual is minutes of work
 * for text we would truncate at the `siteBody` cap anyway. Forty pages is well
 * past the point where the cap bites for any normal document.
 */
const MAX_TEXT_PAGES = 40;

/** Cover render scale. 2x of a 612pt page is ~1224px wide — a crisp card. */
const COVER_SCALE = 2;

export interface PdfDocumentInfo {
    pageCount: number;
    /** From the document's own metadata, when it has one worth using. */
    title?: string;
    author?: string;
    subject?: string;
    keywords: string[];
    /** Plain text, capped at {@link TEXT_LIMIT}. */
    text: string;
    /** Whether the text was cut short — by the cap or by {@link MAX_TEXT_PAGES}. */
    truncated: boolean;
}

function toUint8(bytes: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
    if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
    return new Uint8Array(bytes as ArrayBuffer);
}

/**
 * Metadata titles are only sometimes titles.
 *
 * Word writes the first line of the document, LaTeX writes the .tex filename,
 * and a surprising number of exporters write `untitled` or the full path of a
 * file on someone's desktop. Anything that looks like one of those is worse
 * than the filename we already have.
 */
function usableTitle(raw?: string | null): string | undefined {
    const title = (raw || '').replace(/\s+/g, ' ').trim();
    if (title.length < 3 || title.length > 300) return undefined;
    if (/^untitled/i.test(title)) return undefined;

    // "Microsoft Word - annual review.docx" — the exporter's name, then the
    // source file. Whatever is left after the prefix has to stand on its own.
    if (/^(microsoft word|microsoft powerpoint|powerpoint|pages|keynote) - /i.test(title)) {
        return usableTitle(title.replace(/^[^-]+ - /, ''));
    }

    // A filename or a path, not a title: `thesis-final.tex`, `~/Desktop/a.pdf`.
    if (/\.(tex|docx?|indd|pdf|pages|odt|pptx?|rtf)$/i.test(title)) return undefined;
    if (/^[a-z]:\\|^[~.]?\//i.test(title)) return undefined;

    return title;
}

function cleanField(raw?: unknown, limit = 500): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const value = raw.replace(/\s+/g, ' ').trim();
    return value.length > 0 ? value.slice(0, limit) : undefined;
}

/**
 * Text as prose, not as a page dump.
 *
 * pdf.js hands back one string per page with its own line breaks; the pages
 * joined raw give runs of blank lines and hyphen-broken words that read badly
 * in a summary and match badly in search.
 */
function tidyText(raw: string): string {
    return raw
        // A word broken across a line by a hyphen is one word.
        .replace(/(\w)-\n(\w)/g, '$1$2')
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Text, page count and metadata.
 *
 * Returns null when pdf.js cannot open the file at all — encrypted, truncated
 * or not really a PDF. A readable document with no text layer (a scan) comes
 * back with `text: ''` rather than null, because its page count and cover are
 * still worth having.
 */
export async function readPdfDocument(bytes: Buffer | Uint8Array | ArrayBuffer): Promise<PdfDocumentInfo | null> {
    let getDocumentProxy: any;
    let extractText: any;
    let getMeta: any;
    try {
        ({ getDocumentProxy, extractText, getMeta } = await import('unpdf'));
    } catch (error: any) {
        console.warn('[pdfDocument] unpdf unavailable:', error?.message);
        return null;
    }

    let pdf: any;
    try {
        pdf = await getDocumentProxy(toUint8(bytes));
    } catch (error: any) {
        console.warn('[pdfDocument] Could not open PDF:', error?.message);
        return null;
    }

    const pageCount = Number(pdf?.numPages) || 0;

    let text = '';
    let truncated = false;
    try {
        const pagesToRead = Math.min(pageCount || MAX_TEXT_PAGES, MAX_TEXT_PAGES);
        const extracted = await extractText(pdf, { mergePages: false });
        const pages: string[] = Array.isArray(extracted?.text) ? extracted.text : [String(extracted?.text ?? '')];
        truncated = pages.length > pagesToRead;
        text = tidyText(pages.slice(0, pagesToRead).join('\n\n'));
        if (text.length > TEXT_LIMIT) {
            text = text.slice(0, TEXT_LIMIT);
            truncated = true;
        }
    } catch (error: any) {
        // A text layer that will not parse is not a reason to lose the rest.
        console.warn('[pdfDocument] Text extraction failed:', error?.message);
    }

    let title: string | undefined;
    let author: string | undefined;
    let subject: string | undefined;
    let keywords: string[] = [];
    try {
        const meta = await getMeta(pdf);
        title = usableTitle(meta?.info?.Title);
        author = cleanField(meta?.info?.Author, 200);
        subject = cleanField(meta?.info?.Subject, 1000);
        keywords = cleanField(meta?.info?.Keywords, 500)
            ?.split(/[,;]/)
            .map(keyword => keyword.trim())
            .filter(Boolean)
            .slice(0, 20) || [];
    } catch (error: any) {
        console.warn('[pdfDocument] Metadata read failed:', error?.message);
    }

    return { pageCount, title, author, subject, keywords, text, truncated };
}

/**
 * The first page as a PNG, for the card in the grid.
 *
 * Needs a canvas implementation, which is a native module — so this is the one
 * part of the feature allowed to be missing on a platform without a build for
 * it. A null here means the bookmark gets the same gradient card a text note
 * gets, not that the save failed.
 */
export async function renderPdfCover(bytes: Buffer | Uint8Array | ArrayBuffer, page = 1): Promise<Buffer | null> {
    try {
        const { renderPageAsImage } = await import('unpdf');
        const rendered = await renderPageAsImage(toUint8(bytes), page, {
            canvasImport: () => import('@napi-rs/canvas' as string),
            scale: COVER_SCALE
        });
        const buffer = Buffer.from(rendered as ArrayBuffer);
        return buffer.length > 0 ? buffer : null;
    } catch (error: any) {
        console.warn('[pdfDocument] Cover render unavailable:', error?.message);
        return null;
    }
}

/**
 * A description for the card, from whatever the document gave us.
 *
 * The PDF's own `Subject` is the closest thing it has to an abstract; failing
 * that, the opening of the text reads like one often enough to be useful, and
 * is in any case better than an empty line under the title.
 */
export function pdfDescription(info: PdfDocumentInfo | null, limit = 300): string | undefined {
    if (!info) return undefined;
    if (info.subject) return info.subject.slice(0, limit);
    if (!info.text) return undefined;

    const opening = info.text.replace(/\s+/g, ' ').trim();
    if (opening.length <= limit) return opening || undefined;

    // Cut on a sentence if there is one nearby, otherwise on a word.
    const window = opening.slice(0, limit);
    const sentence = window.lastIndexOf('. ');
    if (sentence > limit * 0.5) return window.slice(0, sentence + 1);
    const word = window.lastIndexOf(' ');
    return `${window.slice(0, word > 0 ? word : limit)}…`;
}
