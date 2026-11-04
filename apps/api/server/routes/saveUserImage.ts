import { defineEventHandler, getHeader, readBody, readMultipartFormData } from 'h3';
import Parse from 'parse/node.js'
import { compressBase64Image, createFileName, extractColorsFromImgBuffer, saveSiteColors, sendToQstash, getPartitionedQueue } from '#root/server/utils/serverUtils.js';
import { MAX_IMAGES, unionTags, type BookmarkImage } from '#root/server/utils/bookmarkImages';
import { ownStorageURL } from '#root/server/utils/clientMetadata';
import { contentTypeFor, toWebSafeImage, unsupportedFormatMessage } from '#root/server/utils/imageFormat';
import { resolveActingUserId } from '#root/server/utils/requireUser';
import { safeFetch } from '#root/server/utils/safeUrl';

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = process.env.VITE_PARSE_URL;

interface SaveUserImageBody {
    fileName?: string;
    file?: string;
    tags?: string[];
    customId?: string;
    savedFrom?: string;
    userId: string;
    fileFormat?: string;
    pageTitle?: string;
    url?: string;
    imageUrl?: string;
    urlToSave?: string;
    /** Several base64 images in one bookmark, for the JSON (non-multipart) callers. */
    files?: string[];
    /**
     * Images that are already hosted. The native app uploads its pictures to
     * Parse itself before saving, so re-downloading and re-hosting them here
     * would store every picture twice — and nothing ever deletes the first copy.
     */
    imageUrls?: string[];
}

/** One incoming picture, before it has been compressed or uploaded. */
interface PendingImage {
    dataUrl: string;
    buffer: ArrayBuffer | Buffer | null;
    fileName: string;
    fileFormat: string;
}

/** The same picture once it lives in S3. */
interface StoredImage {
    url: string;
    parseFile: Parse.File | null;
    buffer: ArrayBuffer | Buffer | null;
    fileName: string;
}

/** A leading letter and nothing exotic — the S3 key is built from this. */
function sanitizeFileName(fileName?: string): string {
    const cleaned = (fileName || '').replace(/[^a-zA-Z0-9_]/g, '');
    return /^[a-zA-Z]/.test(cleaned) ? cleaned : 'img_' + cleaned;
}

export default defineEventHandler(async (event) => {
    try {
        const contentType = (getHeader(event, 'content-type') || '').toLowerCase();

        let body: SaveUserImageBody | null = null;
        // Every picture in this request, in the order the client sent them.
        // The first one is the cover.
        let pending: PendingImage[] = [];

        if (contentType.includes('multipart/form-data')) {
            const parts = await readMultipartFormData(event);

            const partDataToBuffer = (data: unknown) => {
                if (Buffer.isBuffer(data)) return data;
                if (data instanceof ArrayBuffer) return Buffer.from(data);
                if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
                return Buffer.from(String(data), 'utf8');
            };

            const getFirstPart = (name: string) => (parts || []).find(p => p.name === name);
            const getPartText = (name: string) => {
                const part = getFirstPart(name);
                if (!part) return undefined;
                return partDataToBuffer(part.data).toString('utf8');
            };

            const rawTagsArray = (parts || [])
                .filter(p => p.name === 'tags' || p.name === 'tags[]')
                .map(p => partDataToBuffer(p.data).toString('utf8'))
                .filter(Boolean);

            let tags: string[] | undefined;
            if (rawTagsArray.length > 1) {
                tags = rawTagsArray.map(String);
            } else if (rawTagsArray.length === 1) {
                const rawTags = rawTagsArray[0];
                try {
                    const parsed = JSON.parse(rawTags);
                    if (Array.isArray(parsed)) {
                        tags = parsed.map(String);
                    } else {
                        tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);
                    }
                } catch {
                    tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);
                }
            }

            // Every file part, not just the first — this is what turns a
            // multi-select in the picker into one multi-image bookmark. The
            // bracketed names are what a browser FormData with several files
            // under one key produces.
            const FILE_PART_NAMES = ['file', 'files', 'file[]', 'files[]', 'image', 'images', 'image[]', 'images[]', 'upload'];
            const fileParts = (parts || []).filter(p => p.name && FILE_PART_NAMES.includes(p.name) && p.filename);

            const sharedFileName: string | undefined = getPartText('fileName') || undefined;
            const sharedFileFormat: string | undefined = getPartText('fileFormat') || undefined;

            for (const part of fileParts.slice(0, MAX_IMAGES)) {
                const buf = partDataToBuffer(part.data);
                const ct = (part.type || '').toLowerCase();
                const filenameFromPart = part.filename || '';
                const ext = filenameFromPart.includes('.') ? filenameFromPart.split('.').pop() || '' : '';

                // Only trust the shared fileName/fileFormat fields for a
                // single upload; with several files they would name them all
                // the same thing.
                const isSingle = fileParts.length === 1;
                const fileFormat = (isSingle ? sharedFileFormat : undefined)
                    || ext
                    || (ct.startsWith('image/') ? ct.split('/')[1] : undefined)
                    || 'jpeg';
                const fileName = (isSingle ? sharedFileName : undefined) || filenameFromPart;

                pending.push({
                    dataUrl: `data:${ct && ct.includes('/') ? ct : `image/${fileFormat}`};base64,${buf.toString('base64')}`,
                    buffer: buf,
                    fileName: sanitizeFileName(fileName),
                    fileFormat
                });
            }

            // A `file` field that carries a base64 string rather than an upload.
            if (pending.length === 0) {
                const rawFile = getPartText('file');
                if (rawFile) {
                    pending.push({
                        dataUrl: rawFile,
                        buffer: null,
                        fileName: sanitizeFileName(sharedFileName),
                        fileFormat: sharedFileFormat || 'jpeg'
                    });
                }
            }

            body = {
                userId: getPartText('userId') || '',
                fileName: sharedFileName,
                tags,
                customId: getPartText('customId') || undefined,
                savedFrom: getPartText('savedFrom') || undefined,
                fileFormat: sharedFileFormat,
                pageTitle: getPartText('pageTitle') || undefined,
                url: getPartText('url') || undefined,
                imageUrl: getPartText('imageUrl') || undefined,
                urlToSave: getPartText('urlToSave') || undefined
            };
        } else {
            body = await readBody<SaveUserImageBody>(event);

            // JSON callers send `file` (one) or `files` (several) as base64.
            const rawFiles = Array.isArray(body?.files) && body.files.length > 0
                ? body.files
                : (body?.file ? [body.file] : []);
            pending = rawFiles.slice(0, MAX_IMAGES).map((dataUrl, index) => ({
                dataUrl,
                buffer: null,
                fileName: sanitizeFileName(
                    rawFiles.length > 1 && body?.fileName ? `${body.fileName}_${index}` : body?.fileName
                ),
                fileFormat: body?.fileFormat || 'jpeg'
            }));
        }

        if (!body) return { error: 'Request body is required', status: 400 };

        // The body's userId only counts for internal callers (website BFF, QStash
        // pipeline). A client holding a user credential saves to its own library,
        // whatever it puts in the body.
        body.userId = await resolveActingUserId(event, body.userId);

        console.log(`[saveUserImage] ${pending.length} image(s), user: ${body.userId}`);

        let { tags, customId, savedFrom, userId, pageTitle, url, imageUrl, urlToSave } = body;

        imageUrl = imageUrl || urlToSave || '';

        const hasHostedImages = Array.isArray(body.imageUrls) && body.imageUrls.length > 0;
        if (pending.length === 0 && !imageUrl && !hasHostedImages) {
            return { error: 'Missing image input', status: 400 };
        }
        if (!userId) {
            return { error: 'Missing required fields', status: 400 };
        }

        pageTitle = pageTitle || '';
        url = url || imageUrl || '';
        tags = tags || [];

        let user: Parse.User;
        let fallbackUrlOnly = false;

        try {
            if (userId) {
                let userQuery = new Parse.Query(Parse.User);
                user = await userQuery.get(userId, { useMasterKey: true });
                if (!user) {
                    return { error: 'User not found', status: 404 };
                }
            }
        } catch (error: any) {
            console.error("Error fetching user:", error);
            return { error: 'Failed to fetch user', details: error.message, status: 500 };
        }

        // Nothing uploaded: fetch the remote image ourselves, as before.
        if (pending.length === 0 && !hasHostedImages && imageUrl) {
            try {
                // safeFetch: imageUrl is caller-supplied, so it needs the same
                // resolved-address check every other user URL fetch gets.
                const res = await safeFetch(imageUrl);
                if (!res.ok) {
                    fallbackUrlOnly = true;
                } else {
                    const arrayBuffer = await res.arrayBuffer();
                    const buf = Buffer.from(arrayBuffer);
                    const ct = res.headers.get('content-type') || 'image/jpeg';
                    const urlNoParams = imageUrl.split('?')[0];
                    const lastSeg = urlNoParams.substring(urlNoParams.lastIndexOf('/') + 1);
                    const ext = lastSeg.includes('.') ? lastSeg.split('.').pop() : '';

                    pending.push({
                        dataUrl: `data:${ct};base64,${buf.toString('base64')}`,
                        buffer: arrayBuffer,
                        fileName: sanitizeFileName(body.fileName || lastSeg || `${Date.now()}_img`),
                        fileFormat: body.fileFormat || ext || ct.split('/')[1] || 'jpeg'
                    });
                }
            } catch (error) {
                fallbackUrlOnly = true;
            }
        }

        // Compress and upload each picture. One file in behaves exactly as it
        // did before; N files in produce N distinct S3 keys (createFileName's
        // random suffix is what stops same-millisecond uploads colliding).
        const stored: StoredImage[] = [];
        // Formats nothing could draw, so the caller can say which file it was
        // rather than reporting a generic failure.
        const unreadable: string[] = [];

        for (const image of pending) {
            try {
                let buffer = image.buffer;
                if (!buffer) {
                    const base64Data = image.dataUrl.includes(',') ? image.dataUrl.split(',')[1] : image.dataUrl;
                    buffer = Buffer.from(base64Data, 'base64');
                }

                // Before anything else: is this a picture a browser can draw?
                // The picker accepts `image/*`, so HEIC and TIFF arrive here,
                // and storing them under their own content type produced a row
                // whose card rendered nothing at all. `toWebSafeImage` reads
                // the bytes rather than trusting the extension, converts what
                // it can, and refuses what it cannot.
                const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
                const safe = await toWebSafeImage(bytes, image.fileFormat);
                if (!safe) {
                    unreadable.push(image.fileFormat);
                    console.warn(`[saveUserImage] Unreadable image format: ${image.fileFormat}`);
                    continue;
                }

                const dataUrl = safe.converted
                    ? `data:${safe.contentType};base64,${safe.buffer.toString('base64')}`
                    : image.dataUrl;

                const compressed = await compressBase64Image(dataUrl, false, safe.format, 'saveUserImage');
                const fileName = createFileName(userId, image.fileName, safe.format, 'saveUserImage-1');
                // The normalised type, not `image/${extension}` — a file called
                // `photo.JPG` was being stored as `image/JPG`.
                const parseFile = new Parse.File(fileName, { base64: compressed }, contentTypeFor(safe.format));
                await parseFile.save({ useMasterKey: true });

                const fileUrl = parseFile.url();
                if (!fileUrl) throw new Error('[saveUserImage] File URL not generated');

                stored.push({ url: fileUrl, parseFile, buffer: safe.buffer, fileName: image.fileName });
            } catch (error: any) {
                console.error('[saveUserImage] Error saving file:', error);
                // One bad picture out of several should not lose the others.
                if (pending.length === 1) {
                    return { error: 'Failed to save file', details: error.message, status: 500 };
                }
            }
        }

        // Everything the user picked was in a format we can't render. Saying so
        // is the whole point: the old behaviour stored the bytes anyway and
        // left a blank card in the grid.
        if (stored.length === 0 && unreadable.length > 0 && !imageUrl && !hasHostedImages) {
            return { error: unsupportedFormatMessage(unreadable[0]), status: 415 };
        }

        // Pictures the caller already put in our own storage. Adopted as-is:
        // `ownStorageURL` is the existing check that a URL is ours and not
        // something a client made up, which is what makes skipping the
        // re-host safe rather than an SSRF hole.
        const adopted: string[] = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
            .map((candidate) => ownStorageURL(candidate))
            .filter((candidate): candidate is string => Boolean(candidate))
            .slice(0, MAX_IMAGES);

        for (const url of adopted) {
            if (stored.length >= MAX_IMAGES) break;
            stored.push({ url, parseFile: null, buffer: null, fileName: '' });
        }

        // Nothing survived: neither an upload, nor a hosted URL we trust, nor a
        // remote URL to fall back on.
        if (stored.length === 0 && !imageUrl) {
            return {
                error: hasHostedImages ? 'No usable image URLs' : 'Failed to save file',
                status: hasHostedImages ? 400 : 500
            };
        }

        const cover: StoredImage | null = stored[0] || null;
        const coverUrl = cover ? cover.url : imageUrl;

        // Only a genuinely multi-image bookmark gets the array. A single image
        // stays exactly the row shape it has always been, which is what keeps
        // every existing reader working without a migration.
        const images: BookmarkImage[] = stored.length > 1
            ? stored.map((item, index) => ({
                id: `img_${Date.now().toString(36)}_${index}`,
                url: item.url,
                fileName: item.fileName
            }))
            : [];

        const Websites = Parse.Object.extend("websites");
        const WebsitesParse = new Websites();

        try {
            const acl = new Parse.ACL();
            acl.setPublicReadAccess(false);
            acl.setPublicWriteAccess(false);
            acl.setReadAccess(user, true);
            acl.setWriteAccess(user, true);

            WebsitesParse.setACL(acl);
            WebsitesParse.set('customId', customId ? customId : null);
            WebsitesParse.set('user', user);
            WebsitesParse.set('url', url.length > 0 ? url : coverUrl);
            WebsitesParse.set('siteTitle', pageTitle.length > 0 ? pageTitle : undefined);
            WebsitesParse.set('type', 'image');
            // The invariant: OGImage always mirrors the cover, images[0].
            WebsitesParse.set('OGImage', coverUrl);
            WebsitesParse.set('savedFrom', savedFrom);
            if (cover?.parseFile) {
                WebsitesParse.set('file', cover.parseFile);
            }
            if (images.length > 0) {
                WebsitesParse.set('images', images);
            }
            WebsitesParse.set('tags', unionTags(tags, images));

            await WebsitesParse.save(null, { useMasterKey: true });

            // Colours come off the cover, from the buffer we already have.
            if (cover?.parseFile && cover.buffer) {
                let colors = await extractColorsFromImgBuffer(cover.buffer, WebsitesParse, 'saveUserImage');
                await saveSiteColors(WebsitesParse, colors);
            }

            try {
                const userRelation = user.relation("savedSites");
                userRelation.add(WebsitesParse);
                // Usage count will be updated by Parse save trigger
                await user.save(null, { useMasterKey: true });
            } catch (error) {
                console.error("Error adding website to user relation:", error);
            }
        } catch(error: any) {
            console.error("Error saving website data:", error);
            return {
                error: 'Failed to save website data',
                details: error.message,
                status: 500
            };
        }

        // Queue OCR and image tags extraction. Await with allSettled so a QStash
        // failure neither crashes the process as an unhandled rejection nor
        // fails the already-saved image.
        const queueResults = await Promise.allSettled([
            sendToQstash({
                type: 'image-ocr-requests',
                data: { websiteId: WebsitesParse.id, userId: user.id }
            }, { isBatch: false, queueName: getPartitionedQueue('getBookmarkContent') }),
            sendToQstash({
                type: 'image-tags-requests',
                data: { websiteId: WebsitesParse.id, userId: user.id }
            }, { isBatch: false, queueName: getPartitionedQueue('getBookmarkContent') })
        ]);
        for (const r of queueResults) {
            if (r.status === 'rejected') console.error('[saveUserImage] Error queueing image post-processing:', r.reason);
        }

        return {
            fileUrl: coverUrl,
            status: 200,
            message: cover ? 'Image saved successfully' : 'Image URL saved without file',
            fallbackUrlOnly: !cover || fallbackUrlOnly,
            imageCount: Math.max(stored.length, 1),
            objectId: WebsitesParse.id
        };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return {
            error: 'Internal server error',
            details: error.message,
            status: 500
        };
    }
})
