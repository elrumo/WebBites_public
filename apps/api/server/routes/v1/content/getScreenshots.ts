import sharp from 'sharp';
import Parse from 'parse/node.js';
import { fetchUrl, logFailedImport, extractColorsFromImg, extractColorsFromImgBuffer, createFileName } from '../../../utils/serverUtils.js';
import { captureScreenshot } from './images/screenshot.post.js';
import { defineEventHandler, readBody, H3Event } from 'h3';
import { resolveUserPlan, hasPlanFeature } from '../../../utils/plans';

/**
 * Full-page screenshot height caps, in pixels.
 *
 * The free cap is also WebP's maximum dimension, so a free screenshot never
 * needs the JPEG fallback; paid plans go taller and take that trade.
 */
const FREE_MAX_HEIGHT = 16380;
const HIGH_RES_MAX_HEIGHT = 24020;

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

const timeout = 45000;

// Type definitions
interface RequestBody {
    savedSiteId?: string;
    websiteData?: {
        savedSiteId: string;
        fromCache?: boolean;
        geoLocation?: string;
        importing?: boolean;
    };
    fromCache?: boolean;
    geoLocation?: string;
    importing?: boolean;
}

interface ScreenshotResult {
    status: 'success' | 'failed';
    reason?: string;
    message?: string;
    /** Which rung of the fullPage -> viewport -> ogImage chain produced it. */
    mode?: 'fullPage' | 'viewport' | 'ogImage';
    /** The stored image, so colours can be read from memory. */
    buffer?: Buffer;
}

interface ScreenshotResponse {
    status: 'ok' | 'error';
    savedSite?: Parse.Object;
    screenshotStatus?: string;
    screenshotReason?: string;
    screenshotMode?: string;
    error?: string;
}

// Define OpenAPI documentation for this route
defineRouteMeta({
    openAPI: {
        tags: ["Screenshots"],
        summary: "Get and process website screenshots",
        description: "Captures full-page screenshots of websites, extracts colors, and generates embed codes for supported media types. This endpoint handles the complete screenshot workflow including retries for failed captures.",
        requestBody: {
            description: "Screenshot request parameters",
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            savedSiteId: {
                                type: "string",
                                description: "ID of the saved site to capture screenshot for",
                                example: "abc123xyz"
                            },
                            websiteData: {
                                type: "object",
                                description: "Alternative format with nested website data",
                                properties: {
                                    savedSiteId: {
                                        type: "string",
                                        description: "ID of the saved site"
                                    },
                                    fromCache: {
                                        type: "boolean",
                                        description: "Whether to use cached screenshot if available"
                                    },
                                    geoLocation: {
                                        type: "string",
                                        description: "Geographic location for screenshot capture",
                                        example: "us"
                                    },
                                    importing: {
                                        type: "boolean",
                                        description: "Whether this is part of an import operation"
                                    }
                                }
                            },
                            fromCache: {
                                type: "boolean",
                                description: "Whether to use cached screenshot if available",
                                default: false
                            },
                            geoLocation: {
                                type: "string",
                                description: "Geographic location for screenshot capture (e.g., 'us', 'eu')",
                                default: "us"
                            },
                            importing: {
                                type: "boolean",
                                description: "Flag indicating if this is part of a bulk import process",
                                default: false
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
                description: "Screenshot processing completed successfully",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                status: {
                                    type: "string",
                                    enum: ["ok"],
                                    description: "Success status"
                                },
                                savedSite: {
                                    type: "object",
                                    description: "The updated saved site object with screenshots"
                                },
                                screenshotStatus: {
                                    type: "string",
                                    enum: ["success", "failed"],
                                    description: "Status of the screenshot capture"
                                },
                                screenshotReason: {
                                    type: "string",
                                    description: "Reason for screenshot failure (only present if failed)",
                                    example: "unreachable_url"
                                }
                            }
                        }
                    }
                }
            },
            "500": {
                description: "Error during screenshot processing",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                status: {
                                    type: "string",
                                    enum: ["error"],
                                    description: "Error status"
                                },
                                error: {
                                    type: "string",
                                    description: "Error message"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
});

/**
 * Core business logic for processing screenshots
 * Can be called directly from other parts of the application or via HTTP
 */
export async function processScreenshots(params: RequestBody): Promise<ScreenshotResponse> {
    let urlToScreenshot;

    try {
        log("[getScreenshots] rawBody: ", params)
        let body: RequestBody;

        if (!params.savedSiteId) {
            body = params.websiteData || params;
        } else {
            body = params;
        }

        const { savedSiteId } = body;

        if (!savedSiteId) throw new Error('savedSiteId is required');

        const { fromCache, geoLocation } = body;
        const importing = body.importing || false;

        const startTime = Date.now();

        // One query, with the user and plan the height cap needs. A missing row
        // (deleted between enqueue and processing) returns cleanly.
        const savedSite = await new Parse.Query('websites')
            .include(['user', 'user.currentPlan'])
            .get(savedSiteId, { useMasterKey: true })
            .catch(() => undefined);
        if (!savedSite) {
            console.error(`[getScreenshots] savedSite not found: id:${savedSiteId}`)
            return { status: 'error', error: `savedSite not found: ${savedSiteId}` };
        }

        urlToScreenshot = savedSite.get("url")

        // Screenshot, colours and embed code all `set` on the same object and
        // it is saved ONCE below: each save re-enters afterSave and re-indexes.
        const screenshotResult = await getWebsiteScreenshot(savedSite, geoLocation, fromCache);
        await getWebsiteColors(savedSite, screenshotResult?.buffer);
        await getEmbedCode(savedSite);

        if (savedSite.dirty()) {
            await savedSite.save(null, { useMasterKey: true });
        }

        const duration = Date.now() - startTime;

        if (duration > timeout * 2) {
            if (importing) {
                await logFailedImport(savedSite, 'screenshotFunctions', `Timeout, took longer than ${timeout}ms`);
            }
            throw new Error('Operation timed out in screenshotFunctions for url: ' + savedSite.get('url'));
        }

        log(`[getScreenshots] Done getScreenshots: ${savedSiteId}`);

        // Include screenshot status in response
        const response: ScreenshotResponse = {
            status: 'ok',
            savedSite,
            screenshotStatus: screenshotResult?.status || 'success',
            screenshotMode: screenshotResult?.mode
        };

        // If screenshot failed, include the reason
        if (screenshotResult?.status === 'failed') {
            response.screenshotReason = screenshotResult.reason;
            log(`[getScreenshots] Screenshot failed for ${savedSiteId}, URL: ${urlToScreenshot}, : ${screenshotResult.reason}`);
        }

        return response;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error(`[getScreenshots] error in screenshotFunctions, URL: ${urlToScreenshot}, ERROR:`, errorMessage, errorStack);
        throw error;
    }
}

/**
 * HTTP handler wrapper - extracts body and calls the core logic
 */
export default defineEventHandler(async (event: H3Event): Promise<ScreenshotResponse> => {
    const rawBody = await readBody(event) as RequestBody;
    return processScreenshots(rawBody);
});

async function getWebsiteScreenshot(savedSite: Parse.Object, geoLocation?: string, fromCache?: boolean): Promise<ScreenshotResult | undefined> {
    const PageScreenshotTime = `PageScreenshot-----${new Date().getTime()}${Math.random().toString().replace('0', '')}`;
    console.time(PageScreenshotTime);

    let imageUrl: string | undefined;

    try {
        // Early exit check - before any expensive operations
        // Skip this check if fromCache is false (meaning we want to force a new screenshot)
        if (fromCache !== false && savedSite.get("siteScreenshot") && savedSite.get("fullPageScreenshot")) return undefined;

        // Fetch user pointer explicitly
        const userPointer = savedSite.get("user");
        if (!userPointer) {
            console.error('[getScreenshots] User pointer not found for savedSite:', savedSite.id);
            return { status: 'failed', reason: 'user_not_found', message: 'User not found' };
        }

        // Already hydrated by the include in processScreenshots; resolveUserPlan
        // fetches the plan itself if the pointer is cold.
        const user = userPointer;
        // console.log('[getScreenshots] user: ', user);

        // Screenshot height is an entitlement, not a plan-id comparison —
        // adding a price point must not silently drop it back to the free cap.
        const plan = await resolveUserPlan(user);
        const allowsHighRes = hasPlanFeature(plan, 'highResScreenshots');

        // Called in-process rather than through callBackendEndpoint.
        //
        // That hop went out over the public API address (through a CDN edge that
        // can 504 slow origins) carrying the entire base64
        // image, on fetchUrl's 45s default nested inside a 60s outer timeout --
        // so the inner one always fired first. qstash-webhook already calls
        // processScreenshots directly for the same reason.
        const data = await captureScreenshot({
            url: savedSite.get("url"),
            fullPage: true,
            savedSiteId: savedSite.id,
            userId: user.id,
            removeAds: true
        });

        // 'fullPage' or 'viewport' from captureScreenshot; 'ogImage' if both
        // capture attempts failed and we fell back below.
        let mode: 'fullPage' | 'viewport' | 'ogImage' | undefined = data?.mode;

        const controller = new AbortController();
        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let imageBuffer: Buffer | undefined;

        try {
            if (data?.fileData) {
                const base64String = data.fileData.includes('base64,') ? data.fileData.split('base64,')[1] : data.fileData;
                imageBuffer = Buffer.from(base64String, 'base64');
            } else if (data?.fileUrl) {
                imageUrl = data.fileUrl;
                const imageResponse = await fetchUrl(imageUrl, { signal }, 'fullPageScreenshot 1');
                if (!('error' in imageResponse)) {
                    imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                }
            }

            // Last rung of the fallback chain. determineScreenshotUrl already
            // treats OGImage as the final source for colours, so storing it as
            // the screenshot keeps the card and the colours agreeing instead of
            // leaving the card blank.
            if (!imageBuffer || imageBuffer.length === 0) {
                const ogImage = savedSite.get('OGImage');
                if (typeof ogImage === 'string' && ogImage) {
                    log(`[getScreenshots] Falling back to OGImage for ${savedSite.get('url')}`);
                    const ogResponse = await fetchUrl(ogImage, { signal }, 'ogImageFallback');
                    if (!('error' in ogResponse)) {
                        imageBuffer = Buffer.from(await ogResponse.arrayBuffer());
                        mode = 'ogImage';
                    }
                }
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                log('[getScreenshots] Image download timed out for ' + savedSite.get('url'));
            } else {
                log('[getScreenshots] Error downloading screenshot image: ', err);
            }
        } finally {
            clearTimeout(timeoutId);
        }

        if (!imageBuffer || imageBuffer.length === 0) {
            // Every rung failed. Classify and record, but never throw for an
            // ordinary capture failure -- a bot wall is not an exception.
            let errorType = 'api_failure';
            const errorMessage = data?.error || data?.message || 'Unknown error';

            if (data?.message === 'unreachable_url') errorType = 'unreachable_url';
            else if (data?.message === 'Endpoint request timed out') errorType = 'api_timeout';
            else if (!data || data.status !== 'error') errorType = 'invalid_response';

            // Persisted by the single save in processScreenshots.
            savedSite.set('screenshotError', errorType);
            savedSite.set('screenshotErrorMessage', String(errorMessage).slice(0, 500));
            savedSite.set('screenshotLastAttempt', new Date());

            return { status: 'failed', reason: errorType, message: String(errorMessage) };
        }
        let image: sharp.Sharp | null = sharp(imageBuffer);
        let metadata = await image.metadata();
        const maxImageHeightForWebp = 16380;
        const maxImageWidthForWebp = 16380;
        const maxImageHeight = allowsHighRes ? HIGH_RES_MAX_HEIGHT : FREE_MAX_HEIGHT;

        // Check both width and height for WebP limitations
        const exceedsWebpLimits = (metadata.height && metadata.height > maxImageHeightForWebp) ||
                                   (metadata.width && metadata.width > maxImageWidthForWebp);
        const fileFormat = exceedsWebpLimits ? 'jpeg' : 'webp';

        if (metadata.height && metadata.width && metadata.height > maxImageHeight) {
            image = image.extract({ left: 0, top: 0, width: metadata.width, height: maxImageHeight });
            metadata.height = maxImageHeight;
        }

        const quality = (): number => {
            // Held at a flat 20 while the tiered values below are re-tuned;
            // `allowsHighRes` is what would pick between them.
            const proQuality = metadata.height && metadata.height > 20000 ? 60 : 90;
            const freeQuality = metadata.height && metadata.height > 8000 ? 60 : 90;
            // return allowsHighRes ? proQuality : freeQuality;
            return 20;
        };

        // Wrap the conversion in a try-catch to handle WebP size errors gracefully
        let compressedImage: Buffer;
        let actualFormat = fileFormat;
        try {
            compressedImage = await image.toFormat(fileFormat as 'jpeg' | 'webp', { quality: quality() }).toBuffer();
        } catch (convertError) {
            // If WebP conversion fails due to size, fall back to JPEG
            if (convertError instanceof Error && convertError.message.includes('too large for the WebP format')) {
                console.warn(`[getScreenshots] WebP conversion failed for ${savedSite.get('url')}, falling back to JPEG`);
                actualFormat = 'jpeg';
                compressedImage = await image.toFormat('jpeg', { quality: quality() }).toBuffer();
            } else {
                throw convertError;
            }
        }

        // Parallelize cropping and image file creation (not waiting for each other)
        const [croppedImageBuffer] = await Promise.all([
            cropImage(compressedImage, savedSite)
        ]);

        // Upload both images and set the fields; the row is saved once by the caller.
        await saveBothImages(savedSite, compressedImage, croppedImageBuffer, actualFormat, mode);

        // Explicitly clear variables to help with garbage collection
        image = null;
        imageUrl = undefined;

        // console.timeEnd(PageScreenshotTime);
        // The buffer goes back so colours come from memory instead of a re-download.
        return { status: 'success', mode, buffer: compressedImage };
    } catch (error) {
        console.error(`[getScreenshots] Error taking screenshots for id ${savedSite.id}: `, error);
        try {
            await logFailedImport(savedSite, 'getWebsiteScreenshot', error);
        } catch (logError) {
            console.error(`[getScreenshots] Error logging failed import getWebsiteScreenshot: ${logError}`);
            throw error;
        }
        throw error;
    }
}

async function getWebsiteColors(savedSite: Parse.Object, screenshotBuffer?: Buffer): Promise<void> {
    try {
        // Early exit checks before any expensive operations
        if (savedSite.get("siteColors") != null) {
            log('[getWebsiteColors] siteColors already exists');
            return null;
        }

        // Check if screenshot failed - if so, skip color extraction
        const screenshotError = savedSite.get("screenshotError");
        if (screenshotError) {
            // log(`[getWebsiteColors] Skipping color extraction - screenshot failed (${screenshotError})`);
            return null;
        }

        const GetColorsTime = `GetColors-----${new Date().getTime()}${Math.random().toString().replace('0', '')}`;
        if (process.env.NODE_ENV == 'development') console.time(GetColorsTime);

        // log(`[getWebsiteColors] savedSite: ${savedSite.id}`);

        try {
            let colors;
            if (screenshotBuffer) {
                // The capture we just made: no need to download our own upload.
                colors = await extractColorsFromImgBuffer(screenshotBuffer, savedSite);
            } else {
                const type = savedSite.get('type') || 'website';
                const screenshotUrl = determineScreenshotUrl(savedSite, type);
                if (!screenshotUrl) return null;
                colors = await extractColorsFromImg(screenshotUrl, savedSite);
            }
            if (!colors) return null;
            // Persisted by the single save in processScreenshots.
            savedSite.set("siteColors", colors);
        } catch (error) {
            console.error("error extracting colors: ", error);
        }

        // if (process.env.NODE_ENV == 'development') console.timeEnd(GetColorsTime);
    } catch (error) {
        console.error("[getWebsiteColors] Error getting colors 1: ", error);
        console.error("[getWebsiteColors] Error getting colors 2 savedSite: ", savedSite);
        console.error("[getWebsiteColors] Error getting colors 3 savedSite.get('type'): ", savedSite.get('type'));
        return null;
    }
}

async function getEmbedCode(savedSite: Parse.Object): Promise<void> {
    try {
        const embedCodeTime = 'GetEmbedCode-----' + new Date().getTime() + Math.random().toString().replace('0', '');
        console.time(embedCodeTime);

        if (savedSite.get("embedCode") != null) return;

        const siteSubType = savedSite.get('subType') as string | undefined;
        let embedCode = '';
        let url = savedSite.get('url') as string;

        if (siteSubType == null || siteSubType == undefined) return;

        if (siteSubType.includes('youtube')) {
            const urlParts = url.split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/)/);
            const videoId = (urlParts[2] !== undefined) ? urlParts[2].split(/[^0-9a-z_\-]/i)[0] : urlParts[0];
            embedCode = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        }

        if (siteSubType.includes('vimeo')) {
            const vimeoId = new URL(savedSite.get('url')).pathname.split("/").filter(Boolean).pop();
            embedCode = `<iframe src="https://player.vimeo.com/video/${vimeoId}" width="640" height="360" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        }

        if (siteSubType.includes('dailymotion')) {
            const dailymotionId = new URL(savedSite.get('url')).pathname.split("/").filter(Boolean).pop();
            embedCode = `<iframe frameborder="0" width="480" height="270" src="https://www.dailymotion.com/embed/video/${dailymotionId}" allowfullscreen allow="autoplay"></iframe>`;
        }

        if (siteSubType.includes('spotify')) {
            const spotifyId = new URL(savedSite.get('url')).pathname.split("/").filter(Boolean).pop();
            embedCode = `<iframe src="https://open.spotify.com/embed/track/${spotifyId}" width="300" height="380" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe>`;
        }

        if (siteSubType.includes('appleMusic')) {
            const appleMusicId = new URL(savedSite.get('url')).pathname.split("/").filter(Boolean).pop();
            embedCode = `<iframe allow="autoplay *; encrypted-media *;" frameborder="0" height="450" style="width:100%;max-width:660px;overflow:hidden;background:transparent;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" src="https://embed.music.apple.com/us/album/${appleMusicId}"></iframe>`;
        }

        if (siteSubType.includes('soundCloud')) {
            const trackUrl = savedSite.get('url') as string;
            embedCode = `<iframe width="100%" height="300" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(trackUrl)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true"></iframe>`;
        }

        if (siteSubType.includes('twitch')) {
            const twitchId = new URL(savedSite.get('url')).pathname.split("/").filter(Boolean).pop();
            embedCode = `<iframe src="https://player.twitch.tv/?channel=${twitchId}&parent=www.example.com" frameborder="0" allowfullscreen="true" scrolling="no" height="378" width="620"></iframe>`;
        }

        if (siteSubType.includes('tiktok')) {
            const tiktokId = new URL(savedSite.get('url')).pathname.split("/").filter(Boolean).pop();
            embedCode = `<iframe src="https://www.tiktok.com/embed/v2/${tiktokId}?lang=en-US" frameborder="0" allowfullscreen="true" scrolling="no" height="378" width="620"></iframe>`;
        }

        if (embedCode.length == 0) return;

        embedCode = embedCode.replace(/width="[^"]*"/g, 'width="100%"');

        // Persisted by the single save in processScreenshots.
        savedSite.set('embedCode', embedCode);
        // console.timeEnd(embedCodeTime);
    } catch (error) {
        console.error("Error getting embed code: ", error);
    }
}

// Optimized: Batch save both images in a single transaction
async function saveBothImages(savedSite: Parse.Object, fullPageBuffer: Buffer | null, croppedBuffer: Buffer | null, fileFormat: string, mode?: 'fullPage' | 'viewport' | 'ogImage'): Promise<void> {
    try {
        if (!fullPageBuffer && !croppedBuffer) return;

        // Create Parse files in parallel
        const fileCreationPromises = [];

        if (fullPageBuffer) {
            let userId = savedSite.get('user')?.id || '';
            let fileName = createFileName(userId, `fullPageScreenshot`, fileFormat, 'saveScreenshots-1');
            const contentType = `image/${fileFormat}`;
            console.log('[saveBothImages] contentType:', contentType);
            const fullPageFile = new Parse.File(fileName, Array.from(new Uint8Array(fullPageBuffer)), contentType);
            fileCreationPromises.push(fullPageFile.save({ useMasterKey: true }).then(() => ({ type: 'fullPage', file: fullPageFile })));
        }

        if (croppedBuffer) {
            let userId = savedSite.get('user')?.id || '';
            let fileName = createFileName(userId, `croppedScreenshot`, fileFormat, 'saveScreenshots-2');
            const contentType = `image/${fileFormat}`;
            const croppedFile = new Parse.File(fileName, Array.from(new Uint8Array(croppedBuffer)), contentType);
            fileCreationPromises.push(croppedFile.save({ useMasterKey: true }).then(() => ({ type: 'cropped', file: croppedFile })));
        }

        // Wait for all files to be created
        const results = await Promise.all(fileCreationPromises);

        // Set all fields on the object at once
        results.forEach(result => {
            if (result.type === 'fullPage') {
                savedSite.set("fullPageScreenshot", result.file);
                savedSite.set("fullPageScreenshotUrl", result.file.url());
            } else if (result.type === 'cropped') {
                savedSite.set("siteScreenshot", result.file);
                savedSite.set("siteScreenshotUrl", result.file.url());
            }
        });

        // Which rung of the fallback chain this image came from, so a later
        // pass can find and upgrade the degraded ones.
        if (mode) savedSite.set("screenshotMode", mode);

        // screenshotError was previously set on failure and never cleared
        // anywhere, and getWebsiteColors skips whenever it is set -- so one bad
        // capture disabled colour extraction for that row permanently, even
        // after a later success.
        savedSite.unset("screenshotError");
        savedSite.unset("screenshotErrorMessage");
        // Saved once by processScreenshots together with colours and embed code.
    } catch (error) {
        console.error(`error saving images: `, error);
    }
}

function determineScreenshotUrl(savedSite: Parse.Object, type: string): string | null {
    let screenshotUrl: string | null = savedSite.get('fullPageScreenshot') ? savedSite.get('fullPageScreenshot').url() : null;

    if (type == 'image') screenshotUrl = savedSite.get('file') ? savedSite.get('file').url() : null;
    if (!screenshotUrl && type == 'website' && savedSite.get('siteScreenshot') != undefined) screenshotUrl = savedSite.get('siteScreenshot') ? savedSite.get('siteScreenshot').url() : null;
    if (!screenshotUrl && type == 'website' && savedSite.get('OGImage') != undefined) screenshotUrl = savedSite.get('OGImage') ? savedSite.get('OGImage') : null;
    if (screenshotUrl == null) return null;
    return screenshotUrl;
}

async function cropImage(image: Buffer, savedSite: Parse.Object): Promise<Buffer | null> {
    try {
        if (!savedSite || !image) {
            console.error("Invalid parameters passed to cropImage");
            return null;
        }

        const sharpImage = sharp(image);
        const metadata = await sharpImage.metadata();

        if (!metadata.width || !metadata.height) {
            console.error("Unable to get image dimensions");
            return null;
        }

        const aspectRatio = 16 / 9;
        const newHeight = Math.round(metadata.width / aspectRatio);

        const croppedImageBuffer = await sharpImage
            .extract({ left: 0, top: 0, width: metadata.width, height: newHeight })
            .toBuffer();

        return croppedImageBuffer;
    } catch (error) {
        console.error("error cropping image: ", error);
        return null;
    }
}
