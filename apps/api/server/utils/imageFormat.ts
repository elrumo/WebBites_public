/**
 * Getting an uploaded picture into a format a browser will actually draw.
 *
 * The picker accepts `image/*`, which on a Mac or an iPhone means HEIC, and on
 * a scanner means TIFF. Neither renders in Chrome or Firefox. Until this
 * existed the pipeline stored them byte-for-byte under their own content type —
 * `compressBase64Image` has no case for them and returns its input untouched —
 * so the upload "succeeded", the row was created, and the card in the grid drew
 * nothing at all. An image bookmark whose image cannot be seen is not an image
 * bookmark.
 *
 * So every upload now leaves here as something every browser draws, or it does
 * not get stored. The one format we genuinely cannot rescue is HEIC: sharp's
 * prebuilt libvips carries libheif without the HEVC decoder, so an iPhone photo
 * shared straight off the filesystem has to be refused with a message that says
 * what to do about it, rather than saved as a blank card.
 */

import sharp from 'sharp';

/** Formats every current browser draws, and that we serve untouched. */
export const WEB_SAFE_FORMATS = new Set(['jpeg', 'png', 'gif', 'webp', 'avif']);

/** What we transcode to when the source is something else. */
const FALLBACK_FORMAT = 'jpeg';
/** …unless it has transparency, which JPEG would flatten onto black. */
const FALLBACK_FORMAT_WITH_ALPHA = 'png';

const CONTENT_TYPES: Record<string, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
    tiff: 'image/tiff',
    bmp: 'image/bmp',
    svg: 'image/svg+xml'
};

/**
 * One spelling for a format that arrives as a file extension, a MIME type, or
 * whatever the client felt like sending.
 *
 * `photo.JPG` used to reach `new Parse.File(..., 'image/JPG')`, which is not a
 * registered media type — browsers sniff their way past it, but nothing else
 * downstream should have to.
 */
export function normaliseImageFormat(raw?: string | null): string {
    if (!raw) return FALLBACK_FORMAT;

    let format = String(raw).trim().toLowerCase();
    // `image/png`, `image/svg+xml`, `.png`, `png`
    if (format.includes('/')) format = format.split('/').pop() || '';
    if (format.includes('+')) format = format.split('+')[0];
    format = format.replace(/[^a-z0-9]/g, '');

    if (format === 'jpg' || format === 'jpe') return 'jpeg';
    if (format === 'tif') return 'tiff';
    if (format === 'svgxml') return 'svg';
    return format || FALLBACK_FORMAT;
}

export function contentTypeFor(format?: string | null): string {
    const normalised = normaliseImageFormat(format);
    return CONTENT_TYPES[normalised] || `image/${normalised}`;
}

export function isWebSafeFormat(format?: string | null): boolean {
    return WEB_SAFE_FORMATS.has(normaliseImageFormat(format));
}

export interface WebSafeImage {
    buffer: Buffer;
    /** Normalised, and the format the bytes actually are now. */
    format: string;
    contentType: string;
    /** True when the bytes were re-encoded rather than passed through. */
    converted: boolean;
}

/**
 * Hands back bytes a browser will draw, or `null` when there is no way to get
 * there — which the caller must treat as a failed upload, not as a picture.
 *
 * A web-safe format is passed straight through: this is a rescue, not a second
 * compression pass, and `compressBase64Image` still runs afterwards.
 */
export async function toWebSafeImage(
    buffer: Buffer,
    declaredFormat?: string | null
): Promise<WebSafeImage | null> {
    if (!buffer || buffer.length === 0) return null;

    // What the bytes say they are beats what the filename claimed, which is how
    // a `.jpg` that is really a HEIC stops being stored as an unopenable file.
    let detected: string | undefined;
    let hasAlpha = false;
    try {
        const metadata = await sharp(buffer).metadata();
        detected = metadata.format ? normaliseImageFormat(metadata.format) : undefined;
        hasAlpha = Boolean(metadata.hasAlpha);
    } catch {
        // sharp cannot read it at all — HEIC is the case that matters.
        return null;
    }

    const format = detected || normaliseImageFormat(declaredFormat);

    if (WEB_SAFE_FORMATS.has(format)) {
        return { buffer, format, contentType: contentTypeFor(format), converted: false };
    }

    // sharp reports every frame of an animation as one tall image, so a GIF
    // that reached here is not something to flatten. It is already web-safe
    // above; this only guards a future format that animates.
    const target = hasAlpha ? FALLBACK_FORMAT_WITH_ALPHA : FALLBACK_FORMAT;

    try {
        const converted = target === 'png'
            ? await sharp(buffer).png().toBuffer()
            : await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
        return {
            buffer: converted,
            format: target,
            contentType: contentTypeFor(target),
            converted: true
        };
    } catch {
        return null;
    }
}

/** The message the user sees when nothing could be done with their file. */
export function unsupportedFormatMessage(format?: string | null): string {
    const normalised = normaliseImageFormat(format);
    if (normalised === 'heic' || normalised === 'heif') {
        return 'HEIC photos can’t be read here yet. Export the photo as JPEG and try again.';
    }
    return `That file isn’t an image we can read (${normalised}).`;
}
