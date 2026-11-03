import Parse from 'parse/node.js';
import { defineEventHandler, readBody, H3Event, createError } from 'h3';
import { fetchUrl, isUrlReachable } from '#root/server/utils/serverUtils.js';
import { screenshotServiceBase, screenshotServiceUrl, screenshotServiceKey } from '#root/server/utils/renderService.js';

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

// TODO: Update to use corrent defineRouteMeta
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
                                fileUrl: {
                                    type: "string",
                                    description: "URL of the uploaded screenshot when S3 upload succeeds"
                                },
                                fileData: {
                                    type: "string",
                                    description: "Base64-encoded image data returned when S3 upload fails"
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
                                message: {
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

export interface CaptureParams {
    url: string;
    savedSiteId?: string;
    userId?: string;
    geoLocation?: string;
    quality?: string;
    fullPage?: boolean;
    removeAds?: boolean;
}

export interface ScreenshotResponse {
    status: 'ok' | 'error';
    fileUrl?: string;
    fileData?: string;
    /** Which attempt in the fallback chain actually produced the image. */
    mode?: 'fullPage' | 'viewport';
    message?: string;
    error?: string;
}


/**
 * One attempt against the screenshot service.
 *
 * The 90s timeout is explicit because `fetchUrl` otherwise defaults to 45s,
 * which a full-page capture of a long page routinely exceeds -- the request was
 * being abandoned while the service was still working on it.
 */
async function requestCapture(
    url: string,
    quality: string,
    fullPage: boolean,
    removeAds: boolean
): Promise<{ base64: string } | { error: string }> {
    const serviceUrl = screenshotServiceUrl('screenshot');
    if (!serviceUrl) return { error: 'SCREENSHOT_SERVICE_URL is not set' };

    const response = await fetchUrl(serviceUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': screenshotServiceKey(),
        },
        body: JSON.stringify({ url, quality, fullPage, removeAds }),
        timeout: 90000
    }, 'requestCapture');

    if (!response || typeof response !== 'object' || 'error' in response) {
        return { error: `Screenshot API error: ${JSON.stringify(response)}` };
    }

    const base64Image = (
        (response as any).base64 ||
        (response as any).image ||
        (response as any).screenshot ||
        (response as any).dataUrl
    );

    if (!base64Image || typeof base64Image !== 'string') {
        return { error: 'Invalid screenshot response: missing base64 image string' };
    }

    return { base64: base64Image };
}

/**
 * Core capture logic, callable in-process.
 *
 * Exported separately from the HTTP handler so `getScreenshots` can call it
 * directly -- the same reason `qstash-webhook` calls `processScreenshots`
 * directly rather than looping back out through the public API.
 */
export async function captureScreenshot(params: CaptureParams): Promise<ScreenshotResponse> {
    const urlToScreenshot = params.url || '';
    if (!urlToScreenshot) throw new Error('url is required');

    const quality = (params.quality && params.quality.trim() !== '') ? params.quality : 'standard';
    const removeAds = params.removeAds ?? true;
    const wantsFullPage = params.fullPage ?? false;

    log("[screenshot.post] urlToScreenshot: ", urlToScreenshot);

    // No service configured: nothing leaves this server. The caller falls back to the OG image.
    if (!screenshotServiceBase()) {
        return { status: 'error', message: 'screenshots_disabled', error: 'SCREENSHOT_SERVICE_URL is not set' };
    }

    // DNS resolution and the private-address guard only.
    //
    // This used to pass `{ checkHttp: true }`, which added a HEAD request with a
    // 3s timeout and no browser headers. `$fetch` throws on any 4xx/5xx, so a
    // site that rejects HEAD with 405, answers a non-browser UA with 403, sits
    // behind Cloudflare, or simply has a slow TTFB was written off as
    // `unreachable_url` before Chromium ever saw it -- even though Chromium
    // would have loaded it fine.
    const urlCheck = await isUrlReachable(urlToScreenshot);
    if (urlCheck.error) {
        return {
            status: 'error',
            message: 'unreachable_url',
            error: `[Screenshot POST] ${urlCheck.error}`
        };
    }

    // A full-page capture has more ways to fail than a viewport one (very tall
    // pages, lazy-load scroll passes, slow feeds). Falling back to the visible
    // screen beats storing nothing; the caller degrades further to OGImage.
    const attempts: Array<'fullPage' | 'viewport'> = wantsFullPage ? ['fullPage', 'viewport'] : ['viewport'];
    let lastError = 'Unknown error';

    for (const mode of attempts) {
        const result = await requestCapture(urlToScreenshot, quality, mode === 'fullPage', removeAds);

        if ('base64' in result) {
            return { status: 'ok', fileData: result.base64, mode };
        }

        lastError = result.error;
        console.warn(`[captureScreenshot] ${mode} attempt failed for ${urlToScreenshot}: ${lastError}`);
    }

    return { status: 'error', message: 'screenshot_api_error', error: lastError };
}

/** HTTP wrapper - kept for external callers; internal ones use captureScreenshot. */
export default defineEventHandler(async (event: H3Event): Promise<ScreenshotResponse> => {
    const body = await readBody(event) as CaptureParams;
    try {
        return await captureScreenshot(body);
    } catch (error: any) {
        console.error(`[Screenshot POST] Error processing screenshot - ${body?.url} - error: ${error?.message || String(error)}`);
        throw error;
    }
});
