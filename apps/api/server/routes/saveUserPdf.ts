/**
 * Saving a PDF as a bookmark — one the user uploaded, or one behind a URL.
 *
 * Deliberately the sibling of `saveUserImage` rather than a branch inside it:
 * the two share a shape (bytes in, one `websites` row out) and nothing else. An
 * image is its own thumbnail and needs no reading; a PDF needs its first page
 * rendered before there is anything to show, its text pulled out before it is
 * searchable, and its own metadata consulted before we know what to call it.
 *
 * Both ways in end up at the same place:
 *
 *   upload   → multipart `file` parts, or a base64 `file` for the JSON callers.
 *   hosted   → `fileUrl`, a document the caller already put in our own storage.
 *              The native app uploads to Parse itself so a dropped packet costs
 *              a retry rather than the whole 40MB again; re-uploading the bytes
 *              through here would store every document twice and nothing ever
 *              deletes the first copy. `ownStorageURL` is what makes adopting it
 *              safe rather than an SSRF hole.
 *   from URL → `urlToSave`, downloaded here. `saveBookmark` sends anything
 *              {@link detectPdfUrl} recognised, and the bytes are checked again
 *              on arrival — a `.pdf` link that actually serves a login page
 *              comes back as `notAPdf` and the caller saves it as a web page
 *              instead. That fallback is the whole reason detection is allowed
 *              to be optimistic.
 */

import { defineEventHandler, getHeader, readBody, readMultipartFormData } from 'h3';
import Parse from 'parse/node.js';
import {
    compressBase64Image,
    createFileName,
    extractColorsFromImgBuffer,
    saveSiteColors,
    sendToQstash,
    getPartitionedQueue
} from '#root/server/utils/serverUtils.js';
import { getUserWithPlan, getBookmarkQuota } from '#root/server/utils/plans';
import { ownStorageURL } from '#root/server/utils/clientMetadata';
import {
    fetchPdf,
    isPdfBytes,
    pdfFileName,
    titleFromPdfFileName,
    MAX_PDF_BYTES
} from '#root/server/utils/pdfUrl';
import { readPdfDocument, renderPdfCover, pdfDescription } from '#root/server/utils/pdfDocument';
import { resolveActingUserId } from '#root/server/utils/requireUser';

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = process.env.VITE_PARSE_URL;

const Websites = Parse.Object.extend('websites');

/** Content types a client sends for a PDF. The bytes decide, but these gate. */
const PDF_UPLOAD_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', '']);

interface SaveUserPdfBody {
    userId: string;
    /** A base64 data URL, for callers that cannot send multipart. */
    file?: string;
    fileName?: string;
    tags?: string[];
    customId?: string;
    savedFrom?: string;
    pageTitle?: string;
    siteNotes?: string;
    /** The page the PDF was linked from, kept as the bookmark's URL when given. */
    url?: string;
    /** A PDF to download rather than one uploaded. */
    urlToSave?: string;
    /**
     * A PDF already sitting in our own storage, uploaded by the caller. Only a
     * URL `ownStorageURL` recognises is adopted — anything else is ignored.
     */
    fileUrl?: string;
}

defineRouteMeta({
    openAPI: {
        tags: ['Bookmarks'],
        description: 'Save a PDF as a bookmark, either uploaded directly or downloaded from a URL',
        requestBody: {
            description: 'Either a PDF upload (multipart/form-data) or a URL to download (JSON)',
            required: true,
            content: {
                'multipart/form-data': {
                    schema: {
                        type: 'object',
                        required: ['userId'],
                        properties: {
                            file: { type: 'string', format: 'binary', description: 'The PDF to upload' },
                            userId: { type: 'string' },
                            fileName: { type: 'string' },
                            tags: { type: 'string', description: 'JSON array or comma-separated list' },
                            customId: { type: 'string' },
                            savedFrom: { type: 'string' },
                            pageTitle: { type: 'string' }
                        }
                    }
                },
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['userId'],
                        properties: {
                            userId: { type: 'string' },
                            urlToSave: { type: 'string', description: 'A URL serving a PDF; downloaded here' },
                            fileUrl: { type: 'string', description: 'A PDF already uploaded to our own storage' },
                            url: { type: 'string', description: 'The page it was linked from, kept as the bookmark URL' },
                            file: { type: 'string', description: 'A base64 data URL holding the PDF' },
                            fileName: { type: 'string' },
                            tags: { type: 'array', items: { type: 'string' } },
                            customId: { type: 'string' },
                            savedFrom: { type: 'string' },
                            pageTitle: { type: 'string' }
                        }
                    }
                }
            }
        },
        responses: {
            '200': {
                description: 'Saved, or refused with a reason the caller can act on',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                status: { type: 'number', example: 200 },
                                objectId: { type: 'string' },
                                fileUrl: { type: 'string' },
                                pageCount: { type: 'number' },
                                notAPdf: {
                                    type: 'boolean',
                                    description: 'The URL did not serve a PDF — save it as a web page instead'
                                }
                            }
                        }
                    }
                }
            }
        }
    }
});

function partToBuffer(data: unknown): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return Buffer.from(String(data), 'utf8');
}

/** Tags arrive as a JSON array, a comma-separated string, or repeated parts. */
function parseTags(raw: string[] | undefined): string[] {
    if (!raw || raw.length === 0) return [];
    if (raw.length > 1) return raw.map(String);
    try {
        const parsed = JSON.parse(raw[0]);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
        // not JSON; fall through to the comma-separated reading
    }
    return raw[0].split(',').map(tag => tag.trim()).filter(Boolean);
}

/** Every part a picker or a FormData might use for the file itself. */
const FILE_PART_NAMES = ['file', 'files', 'file[]', 'files[]', 'pdf', 'pdfs', 'document', 'upload'];

export default defineEventHandler(async (event) => {
    try {
        const contentType = (getHeader(event, 'content-type') || '').toLowerCase();

        let body: SaveUserPdfBody | null = null;
        let bytes: Buffer | null = null;
        let uploadedName: string | undefined;

        if (contentType.includes('multipart/form-data')) {
            const parts = (await readMultipartFormData(event)) || [];
            const text = (name: string) => {
                const part = parts.find(p => p.name === name);
                return part ? partToBuffer(part.data).toString('utf8') : undefined;
            };

            // One PDF per bookmark, unlike images: a PDF is a document, and
            // several of them in one row would have no cover, no page count and
            // no text that belonged to any one of them.
            const filePart = parts.find(p => p.name && FILE_PART_NAMES.includes(p.name) && p.filename);
            if (filePart) {
                const partType = (filePart.type || '').toLowerCase().split(';')[0].trim();
                if (!PDF_UPLOAD_TYPES.has(partType) && !/\.pdf$/i.test(filePart.filename || '')) {
                    return { error: 'That file is not a PDF', status: 415 };
                }
                bytes = partToBuffer(filePart.data);
                uploadedName = filePart.filename;
            }

            body = {
                userId: text('userId') || '',
                fileName: text('fileName') || undefined,
                tags: parseTags(parts.filter(p => p.name === 'tags' || p.name === 'tags[]').map(p => partToBuffer(p.data).toString('utf8')).filter(Boolean)),
                customId: text('customId') || undefined,
                savedFrom: text('savedFrom') || undefined,
                pageTitle: text('pageTitle') || undefined,
                siteNotes: text('siteNotes') || undefined,
                url: text('url') || undefined,
                urlToSave: text('urlToSave') || undefined,
                fileUrl: text('fileUrl') || undefined
            };
        } else {
            body = await readBody<SaveUserPdfBody>(event);

            if (body?.file) {
                const base64 = body.file.includes(',') ? body.file.split(',')[1] : body.file;
                try {
                    bytes = Buffer.from(base64, 'base64');
                } catch {
                    return { error: 'Could not read the uploaded PDF', status: 400 };
                }
            }
        }

        if (!body) return { error: 'Missing required fields', status: 400 };

        // Only internal callers may name another user; see resolveActingUserId.
        body.userId = await resolveActingUserId(event, body.userId);

        const sourceUrl = (body.urlToSave || '').trim();
        // A document the caller already put in our own storage. Validated the
        // same way an adopted image URL is: anything that is not ours is
        // dropped rather than fetched, which is what stops this being a way to
        // make the server request an arbitrary URL.
        const hostedUrl = body.fileUrl ? ownStorageURL(body.fileUrl.trim()) : null;

        if (!bytes && !sourceUrl && !hostedUrl) return { error: 'Missing PDF input', status: 400 };

        // A remote PDF is downloaded here, capped and magic-byte checked on the
        // way in — see fetchPdf. Our own copy is read back the same way: it is
        // one request inside our own network, and the alternative is a bookmark
        // with no cover, no page count and no searchable text.
        const downloadUrl = sourceUrl || hostedUrl || '';
        let downloadedName: string | undefined;
        if (!bytes && downloadUrl) {
            const downloaded = await fetchPdf(downloadUrl);
            if ('error' in downloaded) {
                console.log(`[saveUserPdf] ${downloadUrl} is not a usable PDF: ${downloaded.error}`);
                // `notAPdf` is the caller's cue to fall back to an ordinary save
                // rather than to show the user an error. Anything else genuinely
                // went wrong and is worth reporting.
                return downloaded.error === 'Not a PDF'
                    ? { notAPdf: true, error: downloaded.error, status: 415 }
                    : { error: `Could not download the PDF: ${downloaded.error}`, status: 502 };
            }
            bytes = downloaded.buffer;
            downloadedName = downloaded.fileName;
        }

        if (!bytes || bytes.length === 0) return { error: 'Empty PDF', status: 400 };
        if (bytes.length > MAX_PDF_BYTES) {
            return { error: `PDFs are limited to ${Math.round(MAX_PDF_BYTES / (1024 * 1024))}MB`, status: 413 };
        }
        // An upload gets the same check a download gets: the extension and the
        // content type are both things a client chose, and neither is the file.
        if (!isPdfBytes(bytes)) {
            return sourceUrl
                ? { notAPdf: true, error: 'Not a PDF', status: 415 }
                : { error: 'That file is not a PDF', status: 415 };
        }

        let user: Parse.Object;
        let plan: Parse.Object | null;
        try {
            ({ user, plan } = await getUserWithPlan(body.userId));
        } catch (error: any) {
            console.error('[saveUserPdf] Could not load the user:', error?.message);
            return { error: 'User not found', status: 404 };
        }
        if (!user) return { error: 'User not found', status: 404 };

        if (getBookmarkQuota(user, plan).exceeded) {
            return {
                error: 'You have reached your website limit. Upgrade your account to save more bookmarks.',
                status: 402
            };
        }

        const fileName = body.fileName || uploadedName || downloadedName
            || pdfFileName(sourceUrl || hostedUrl || 'document.pdf');

        // Read before storing: the title decides what the row is called, and a
        // file we cannot open at all is worth refusing before it costs an upload.
        const document = await readPdfDocument(bytes);

        // Best name first: what the user typed, then the document's own
        // metadata title, then the filename made readable.
        const title = body.pageTitle?.trim()
            || document?.title
            || titleFromPdfFileName(fileName)
            || fileName;

        // A document the caller already stored is adopted as it stands. Saving
        // it again would put a second copy in the same bucket under a different
        // key, and nothing ever deletes the first.
        let pdfFile: Parse.File | null = null;
        let storedUrl = hostedUrl || '';
        if (!storedUrl) {
            try {
                pdfFile = new Parse.File(
                    createFileName(body.userId, fileName.replace(/\.pdf$/i, ''), 'pdf', 'saveUserPdf'),
                    { base64: bytes.toString('base64') },
                    'application/pdf'
                );
                await pdfFile.save({ useMasterKey: true });
                storedUrl = pdfFile.url() || '';
            } catch (error: any) {
                console.error('[saveUserPdf] Could not store the PDF:', error);
                return { error: 'Failed to save the PDF', details: error.message, status: 500 };
            }
            if (!storedUrl) return { error: 'Failed to save the PDF', status: 500 };
        }

        // The first page becomes the card. Missing is fine — the grid falls back
        // to the same gradient a text note gets — so nothing below depends on it.
        let coverUrl: string | null = null;
        let coverBuffer: Buffer | null = null;
        try {
            const rendered = await renderPdfCover(bytes);
            if (rendered) {
                const compressed = await compressBase64Image(
                    `data:image/png;base64,${rendered.toString('base64')}`,
                    false,
                    'png',
                    'saveUserPdf'
                );
                const coverFile = new Parse.File(
                    createFileName(body.userId, 'pdfcover', 'png', 'saveUserPdf'),
                    { base64: compressed },
                    'image/png'
                );
                await coverFile.save({ useMasterKey: true });
                coverUrl = coverFile.url() || null;
                coverBuffer = Buffer.from(
                    (compressed.includes(',') ? compressed.split(',')[1] : compressed),
                    'base64'
                );
            }
        } catch (error: any) {
            console.warn('[saveUserPdf] Cover page not stored:', error?.message);
        }

        const website = new Websites();
        try {
            website.setACL(new Parse.ACL(user));
            website.set('user', user);
            website.set('type', 'pdf');
            website.set('customId', body.customId || null);
            website.set('savedFrom', body.savedFrom || '');
            website.set('tags', Array.isArray(body.tags) ? body.tags : []);
            if (body.siteNotes) website.set('siteNotes', body.siteNotes);

            // The URL is what the user would click to get back to the original.
            // For a saved link that is the link — not our copy of the file — so
            // a re-save of the same URL still de-duplicates against it.
            const bookmarkUrl = body.url || sourceUrl || storedUrl;
            website.set('url', bookmarkUrl);
            try {
                website.set('baseUrl', new URL(bookmarkUrl).origin);
            } catch {
                website.set('baseUrl', null);
            }

            website.set('siteTitle', title);
            // Both spellings of "this is a PDF". `type` is what the grids and
            // the type filters switch on; `subType` is what every reader that
            // predates the type reads, including the native detail view's own
            // PDF tab, which has been gated on it since before this existed.
            website.set('subType', ['pdf']);
            website.set('fileName', fileName);
            if (pdfFile) website.set('file', pdfFile);
            website.set('fileUrl', storedUrl);

            if (coverUrl) website.set('OGImage', coverUrl);

            if (document) {
                website.set('pageCount', document.pageCount);
                if (document.author) website.set('siteAuthor', document.author);
                // `siteBody` is the column search, AI summaries and the audio
                // reader all read — the same one a scraped article fills.
                if (document.text) website.set('siteBody', document.text);
                const description = pdfDescription(document);
                if (description) website.set('siteDescription', description);
                if (document.keywords.length > 0) {
                    website.set('tags', [...new Set([...(body.tags || []), ...document.keywords])]);
                }
            }

            await website.save(null, { useMasterKey: true });
        } catch (error: any) {
            console.error('[saveUserPdf] Could not save the bookmark:', error);
            return { error: 'Failed to save bookmark', details: error.message, status: 500 };
        }

        if (coverBuffer) {
            try {
                const colors = await extractColorsFromImgBuffer(coverBuffer, website, 'saveUserPdf');
                await saveSiteColors(website, colors);
            } catch (error: any) {
                console.warn('[saveUserPdf] Colours not extracted:', error?.message);
            }
        }

        try {
            const relation = user.relation('savedSites');
            relation.add(website);
            await user.save(null, { useMasterKey: true });
        } catch (error) {
            console.error('[saveUserPdf] Could not add the bookmark to the user:', error);
        }

        // A scanned PDF has no text layer, so the page image is all there is to
        // read — the same OCR the image pipeline runs applies unchanged.
        if (coverUrl && !document?.text) {
            try {
                await sendToQstash(
                    { type: 'image-ocr-requests', data: { websiteId: website.id, userId: user.id } },
                    { isBatch: false, queueName: getPartitionedQueue('getBookmarkContent') }
                );
            } catch (error) {
                console.error('[saveUserPdf] Could not queue OCR:', error);
            }
        }

        console.log(`[saveUserPdf] Saved ${fileName} (${document?.pageCount ?? '?'} pages) for ${body.userId}`);

        return {
            status: 200,
            objectId: website.id,
            fileUrl: storedUrl,
            coverUrl,
            pageCount: document?.pageCount ?? null,
            title,
            message: 'PDF saved successfully'
        };
    } catch (error: any) {
        console.error('[saveUserPdf] Unexpected error:', error);
        return { error: 'Internal server error', details: error.message, status: 500 };
    }
});
