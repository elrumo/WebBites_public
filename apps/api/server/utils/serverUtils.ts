import Parse from 'parse/node.js'
import { enqueueJob } from './jobs/index'
import sharp from 'sharp';
import { getOpenAI, getTextModel } from '#root/server/utils/aiClients';
import { parseModelJson } from './modelJson.js';
import https from 'https';
import { promises as dns } from 'node:dns';
import { unlink } from 'node:fs/promises';
import { sendMail } from './mailer';
import { applyBrand } from './emailBrand';
import { ImportSessionManager } from './ImportSessionManager.js';
import { prepareMeilisearchDocument } from './meilisearchDocumentMapper.js';
import { MEILISEARCH_CONFIG } from '../config/meilisearchConfig.js';
import getPixels from 'get-pixels';
import { extractColors } from 'extract-colors';
import Coloraze from 'coloraze';
import { claudeQueue } from './ClaudeRequestQueue.js';
import { resolveUserPlan, getResolvedPlan, getBookmarkQuota, isPaidPlan, currentUsageMonth } from './plans';
import { isBillingEnabled } from './billing';
import { assertPublicUrl, safeFetch } from './safeUrl';
import { siterelicKey } from './renderService';
import { selfUrl } from './site';

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = process.env.VITE_PARSE_URL;


const modelCosts = {
    gpt4: {
        input: 0.000150,
        output: 0.000600,
    },
    gpt3: {
        input: 0.0005,
        output: 0.0015,
    }
}
const timeout = 90000;

function classifyModelFamily(modelName = '') {
    return /4|claude|sonnet|opus|gpt/i.test(modelName) ? 'gpt4' : 'gpt3';
}

function resolveTextModelFromOptions(options: any = {}) {
    return getTextModel(
        options.model
        || options.textModel
        || options.gptModel
        || options.claudeModel
        || null
    );
}

async function askTextModelRaw(prompt, options: any = {}) {
    const name = options.name ? options.name : 'llm';
    const openai = getOpenAI(name);
    const modelToUse = resolveTextModelFromOptions(options);
    const modelFamily = classifyModelFamily(modelToUse);
    const requestTimeout = options.timeout || timeout;

    const createCompletion = (useJsonResponseFormat: boolean) =>
        openai.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: modelToUse,
            ...(useJsonResponseFormat ? { response_format: { type: 'json_object' } } : {}),
            max_tokens: options.maxTokens || 700,
        } as any, { timeout: requestTimeout, maxRetries: 0 });

    let chatCompletion: any;

    try {
        chatCompletion = await createCompletion(true);
    } catch (error: any) {
        const maybeUnsupportedJsonMode = /response_format|json_object|unsupported|not supported/i.test(error?.message || '');
        if (!maybeUnsupportedJsonMode) throw error;
        chatCompletion = await createCompletion(false);
    }

    const rawContent = chatCompletion?.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
        throw new Error('Empty response from LiteLLM');
    }

    const result = parseModelJson(rawContent);
    const queryUsage = chatCompletion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const costs = {
        prompt_cost: calculateCosts(modelFamily, queryUsage.prompt_tokens || 0),
        completion_cost: calculateCosts(modelFamily, queryUsage.completion_tokens || 0),
        total_cost: calculateCosts(modelFamily, queryUsage.prompt_tokens || 0) + calculateCosts(modelFamily, queryUsage.completion_tokens || 0),
    };

    const tokenUsage = {
        prompt_tokens: queryUsage.prompt_tokens || 0,
        completion_tokens: queryUsage.completion_tokens || 0,
        total_tokens: queryUsage.total_tokens || ((queryUsage.prompt_tokens || 0) + (queryUsage.completion_tokens || 0)),
    };

    return {
        result,
        usage: {
            queries: [{
                funcName: name,
                modelUsed: modelToUse,
                usage: tokenUsage,
                costs,
                timeTaken: 0,
            }],
            totalTokens: {
                usage: tokenUsage,
                costs,
                queries: [name]
            },
        }
    };
}

async function askTextModel(prompt, options: any = {}) {
    const name = options.name ? options.name : 'llm';

    try {
        return await askTextModelRaw(prompt, options);
    } catch (error: any) {
        console.error(`error running LiteLLM text model ${name}:`, error);

        try {
            if (options.userId && options.savedSite) {
                await logFailedImport(options.savedSite, options.name, error);
            }
        } catch (logError) {
            console.error('Error in askTextModel failedToImport:', logError);
        }

        return {
            result: {
                error: true,
                message: error?.message || 'Unknown error occurred',
                stack: error?.stack
            },
            usage: null
        };
    }
}

function sanitizeEnvString(str?: string): string {
    try {
        return (str || '').trim().replace(/[`]/g, '');
    } catch {
        return str || '';
    }
}

function sanitizeHostUrl(host?: string): string {
    let h = sanitizeEnvString(host);
    if (!h) return '';
    if (!/^https?:\/\//i.test(h)) {
        h = `https://${h}`;
    }
    return h.replace(/\/+$/,'');
}

/**
 * Verify URL is valid, DNS-resolvable, and optionally reachable via HTTP
 * @param url - The URL to verify
 * @param options - Verification options
 * @param options.checkHttp - Whether to also perform an HTTP HEAD request (default: false)
 * @param options.httpTimeout - Timeout for HTTP check in ms (default: 3000)
 * @returns Object with either { ok: true } or { error: string }
 */
export async function isUrlReachable(url: string, options: { checkHttp?: boolean; httpTimeout?: number } = {}) {
    const { checkHttp = false, httpTimeout = 3000 } = options;

    try {
        if (!url || url === undefined) {
            return { error: 'URL is undefined' };
        }

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return { error: 'Invalid URL' };
        }

        const protocol = parsed.protocol?.toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') {
            return { error: 'Unsupported protocol' };
        }

        // Check for local URLs first
        if (isLocalUrl(url)) {
            return { error: 'Local URL not allowed' };
        }

        const hostname = parsed.hostname;

        // Allow localhost without DNS lookup (for dev environments)
        if (hostname === 'localhost' || hostname.endsWith('.local')) {
            return { ok: true };
        }

        // DNS lookup with a small timeout to avoid hanging
        const dnsCheck = dns.lookup(hostname);
        const withTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DNS lookup timeout')), 3000)
        );

        await Promise.race([dnsCheck, withTimeout]);

        // Optional HTTP reachability check
        if (checkHttp) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), httpTimeout);

            try {
                await $fetch(url, {
                    method: 'HEAD',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    return { error: 'HTTP request timeout' };
                }
                // $fetch throws on HTTP errors (4xx, 5xx), so any error here means the request failed
                return { error: `HTTP request failed: ${fetchError.message}` };
            }
        }

        return { ok: true };
    } catch (e) {
        // Map ENOTFOUND to a more recognizable browser-type message
        if (e && (e.code === 'ENOTFOUND')) {
            return { error: 'DNS_PROBE_FINISHED_NXDOMAIN' };
        }
        if (e && e.message === 'DNS lookup timeout') {
            return { error: 'DNS lookup timeout' };
        }
        return { error: e?.message || 'DNS lookup failed' };
    }
}

type FetchError = { error: string; attempts?: number };

export async function getHtmlContent(
    url: string,
    funcName: string,
    removeHtml: boolean = false,
    maxLength: number = 0,
    useSiterelic: boolean = false
) {
    try {
        if(!url || url == undefined) return {error: 'URL is undefined'}

        // Use progressive timeout for better reliability
        const response: Response | FetchError = await fetchUrlWithProgressiveTimeout(url, { useSiterelic }, funcName, 3);
        
        if ('error' in response) {
            return { error: response.error };
        }

        let html = await (response as Response).text();
        
        // Limit HTML content if specified
        if (maxLength > 0 && html.length > maxLength) {
            html = html.substring(0, maxLength);
        }
        
        if(removeHtml) return removeHtmlTags(html, maxLength);

        return cleanHtml(html);
    } catch (error) {
        console.error(`Failed to fetch HTML from url:${url} for ${funcName}: `, error);
        return {errorMsg: `Failed to fetch HTML from url:${url} for ${funcName}: `, error}
    }
}

export function removeHtmlTags(htmlString, stringLimit = 3000) {
    if(htmlString == undefined || htmlString == null) return '';

    try {
        // Remove content within <script> and </head> tags
        let cleanedString = htmlString.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
        cleanedString = cleanedString.replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, '');
        cleanedString = cleanedString.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');

        // Remove all remaining HTML tags
        cleanedString = cleanedString.replace(/<\/?[^>]+(>|$)/g, '');
        cleanedString = cleanedString.replace(/\\n/g, '');
        cleanedString = cleanedString.replace(/\s\s+/g, ' ');
        cleanedString = cleanedString.replaceAll('&nbsp', '');
        if(stringLimit != 0) cleanedString = cleanedString.substring(0, stringLimit);

        return cleanedString;
    } catch (error) {
        console.error('[removeHtmlTags] Error removing html: ', error);
        return htmlString
    }
}

export function cleanHtml(html: string, options?: any) {
    try {
        const defaultOptions = {
            style: true,
            link: true,
            script: true,
            head: true,
            class: true,
            noscript: true,
            meta: true,
        }

        options = { ...defaultOptions, ...options };

        // console.log('[cleanHtml] html.length 1: ', html.length);
        
        html = options.style ? html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '') : html;
        html = options.link ? html.replace(/<link[^>]*>/gi, '') : html;
        html = options.script ? html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '') : html;
        html = options.head ? html.replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, '') : html;
        html = options.class ? html.replace(/class=["'].*?["']/gi, '') : html;
        html = options.style ? html.replace(/style=["'].*?["']/gi, '') : html;
        html = options.noscript ? html.replace(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi, '') : html;
        html = options.meta ? html.replace(/<meta[^>]*>/gi, '') : html;

        return html
    } catch (error) {
        console.error("error cleaning html: ", error);
        return html;
    }
}


/**
 * Build a clean Meilisearch-ready document.
 * Accepts either a Parse.Object (savedSite) or a plain website object.
 */
export function buildMeilisearchDocument(input) {
    try {
        let siteData;
        let userId = null;

        if (input && typeof input === 'object' && typeof input.get === 'function') {
            // Parse.Object case
            siteData = input.toJSON ? input.toJSON() : { ...input.attributes };
            const user = input.get && input.get('user');
            if (user && user.id) {
                userId = user.id;
            }
            siteData.id = input.id;
            // also expose user in original shape for mapper compatibility
            siteData.user = { objectId: userId };
        } else {
            // Plain object case (from getParseWebsites or similar)
            siteData = { ...(input || {}) };
            if (!siteData.id && siteData.objectID) {
                siteData.id = siteData.objectID;
            }
            if (siteData.user && siteData.user.objectId) {
                userId = siteData.user.objectId;
            }
        }

        // Prepare document consistently
        const document = prepareMeilisearchDocument(siteData);

        // Defensive defaults to satisfy Meilisearch embedder templates
        if (typeof document.colorDescription !== 'string') {
            document.colorDescription = '';
        }
        if (typeof document.colorCategories !== 'string') {
            document.colorCategories = '';
        }
        if (typeof document.colorNames !== 'string') {
            document.colorNames = '';
        }
        if (!Array.isArray(document.siteColors)) {
            document.siteColors = [];
        }

        // Add userId for filtering
        if (userId) {
            document.userId = userId;
        }

        return document;
    } catch (error) {
        console.error('[buildMeilisearchDocument] Error building Meilisearch document:', error);
        throw error;
    }
}

export async function askGpt(prompt, options) {
    return await askTextModel(prompt, options);
}

export async function askClaude(prompt, options) {
    try {
        return await claudeQueue.enqueue(
            () => askTextModelRaw(prompt, options),
            {
                name: options?.name ? options.name : 'claude',
                modelToUse: resolveTextModelFromOptions(options)
            }
        );
    } catch (error: any) {
        console.error(`error running Claude ${options?.name || 'claude'}:`, error);

        try {
            if (options?.userId && options?.savedSite) {
                await logFailedImport(options.savedSite, options.name, error);
            }
        } catch (logError) {
            console.error('Error in askClaude failedToImport:', logError);
        }

        return {
            result: {
                error: true,
                message: error?.message || 'Unknown error occurred',
                stack: error?.stack
            },
            usage: null
        };
    }
}

export function calculateCosts(gptModelUsed, tokensUsed) {
    return Number((modelCosts[gptModelUsed].input * (tokensUsed / 1000)).toFixed(8));
}

export async function logFailedImport(savedSite, funcName, error){
    try {
        savedSite = await savedSite.fetch({useMasterKey: true});

        let user = savedSite.get('user');
        user = await user.fetch({useMasterKey: true});
        let failedToImport = user.get('failedToImport');
        if(failedToImport == undefined) failedToImport = [];

        // Convert error to a serializable format
        const serializableError = error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { message: String(error) };

        failedToImport.push({url: savedSite.get('url'), websiteId: savedSite.id, error: serializableError, funcName: funcName, date: new Date().toString()});
        user.set('failedToImport', failedToImport);

        // Update import session failedBookmarks counter using ImportSessionManager
        const session = await ImportSessionManager.getActiveSession(user);
        if (session && session.get('status') === 'processing') {
            await ImportSessionManager.incrementFailedBookmarks(session);
        }

        await user.save(null, { useMasterKey: true });
    } catch (error) {
        console.error(`Error logging failed import: ${error}`);
        throw error;
    }
}

// Callers already cap their page content before building the prompt; capping here cut the instructions too.
export async function numTokensFromString(object) {
    return { tokenLen: 0, newPrompt: object.prompt ? object.prompt : '' };
}

export async function getSiteById(id, originFunc) {
    try {
        const query = new Parse.Query("websites");
        query.equalTo("objectId", id);
        const savedSite = await query.first({ useMasterKey: true });
        return savedSite
    } catch (error) {
        console.error(`[getSiteById - ${originFunc || 'unknown'}] - Error: ${error?.message || String(error)}`)
        if (error instanceof Error) throw error; else throw new Error(String(error));
        
    }
}

const extFromMime = (mime: string, fileFormat = 'png') => {
    switch (mime) {
        case 'image/jpeg': return 'jpg';
        case 'image/png': return 'png';
        case 'image/webp': return 'webp';
        case 'application/pdf': return 'pdf';
        case 'text/plain': return 'txt';
        case 'application/json': return 'json';
        case 'audio/mpeg': return 'mp3';
        case 'audio/wav': return 'wav';
        case 'video/mp4': return 'mp4';
        default: return fileFormat;
    }
};

export async function fetchUrl(url: string, options: any = {}, funcName: string = 'fetchUrl'): Promise<any | FetchError> {
    const preflight = await isUrlReachable(url);
    if (preflight.error) {
        console.log(`[fetchUrlWithProgressiveTimeout] 1 - Preflight failed for ${url}: ${preflight.error}`);
        return { error: preflight.error };
    }

    let fetchTimeout = options?.timeout || timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

    try {
        const data = await $fetch(url, {
            signal: controller.signal,
            agent: new https.Agent({
                rejectUnauthorized: false
            }),
            onRequest({ options }) {
                // console.log(`[fetchUrl] Making request to ${url}`, {
                //     method: options.method || 'GET',
                //     headers: options.headers
                // });
            },
            onRequestError({ error }) {
                console.error(`[fetchUrl - ${funcName}] Request error for ${url}:`, error);
            },
            onResponseError({ response }) {
                console.error(`[fetchUrl - ${funcName}] Response error for ${url}:`, {
                    status: response.status,
                    statusText: response.statusText
                });
            },
            onResponse({ response }) {
                if(response.status != 200) {
                    console.log(`[fetchUrl - ${funcName}] Response received from ${url}:`, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }
            },
            ...options
        });
        clearTimeout(timeoutId);
        return data;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.log(`[fetchUrl] Request timed out in ${url} for ${funcName}`);
            return { error: `Timeout, took longer than ${fetchTimeout} seconds` };
            // return { error: `Timeout, took longer than ${fetchTimeout} seconds` };
        } else {
            console.error(`[fetchUrl] Error fetching URL in ${url} for: ${funcName}`, error);
            return { error: error.toString() };
    }
}
}

// Progressive timeout fetch with smart retry logic
export async function fetchUrlWithProgressiveTimeout(
    url: string,
    options: any = {},
    funcName: string = 'fetchUrlProgressive',
    maxRetries: number = 3
): Promise<Response | FetchError> {
    const { useSiterelic = false, renderJS = false } = options;

    // Checks the resolved addresses, not just the hostname text, so a name that
    // points at an internal host can't get through. safeFetch below re-checks
    // every redirect hop.
    const preflight = await assertPublicUrl(url);
    if ('error' in preflight) {
        log(`[fetchUrlWithProgressiveTimeout] Preflight failed for ${url}: ${preflight.error} - NOT FETCHING`);
        return { error: preflight.error, attempts: 0 };
    }

    // Use Siterelic API if requested
    if (useSiterelic && siterelicKey()) {
        try {
            log(`Using Siterelic API for ${url}`);
            const sitelicResponse = await fetch('https://api.siterelic.com/webscraping', {
                method: 'POST',
                headers: {
                    'x-api-key': siterelicKey() as string,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: url,
                    device: 'desktop',
                    output: 'inline',
                    blockAds: true,
                    renderJS
                })
            });

            if (sitelicResponse.ok) {
                const sitelicData = await sitelicResponse.json();
                
                if (sitelicData.apiStatus === 'success' && sitelicData.data) {
                    log(`[fetchUrlWithProgressiveTimeout] ✅ Siterelic API success for ${url}`);
                    // Return a Response-like object with the HTML content
                    return new Response(sitelicData.data, {
                        status: 200,
                        headers: new Headers()
                    });
                } else {
                    console.error(`[fetchUrlWithProgressiveTimeout] ❌ Siterelic API failed for ${url}:`, sitelicData);
                }
            } else {
                console.error(`[fetchUrlWithProgressiveTimeout] ❌ Siterelic API request failed for ${url}:`, sitelicResponse.status);
            }
        } catch (error) {
            console.error(`[fetchUrlWithProgressiveTimeout] ❌ Siterelic API error for ${url}:`, error.message);
        }
        
        // If Siterelic fails, fall back to regular fetch.
        //
        // `method`, `headers` and `body` were addressed to the render/scrape
        // service, not to the site: fetchRenderedHtml passes the render
        // service's Basic credential in `headers`. Sending them on to the
        // target would hand that credential to whatever host the user named, so
        // the fallback is a plain GET.
        const { method, headers, body, ...rest } = options;
        options = rest;
        log(`[fetchUrlWithProgressiveTimeout] Falling back to regular fetch for ${url}`);
    }

    // Domain-specific timeout optimization
    const getDomainTimeouts = (url) => {
        try {
            const domain = new URL(url).hostname.toLowerCase();
            
            // Fast domains - shorter timeouts
            const fastDomains = ['github.com', 'stackoverflow.com', 'reddit.com', 'twitter.com'];
            if (fastDomains.some(d => domain.includes(d))) {
                return [8000, 15000, 25000]; // 8s, 15s, 25s
            }
            
            // Slow domains - longer timeouts
            const slowDomains = ['wikipedia.org', 'medium.com', 'blogs.', 'wordpress.', 'blogspot.'];
            if (slowDomains.some(d => domain.includes(d))) {
                return [20000, 35000, 60000]; // 20s, 35s, 60s
            }
            
            // Default timeouts
            return [15000, 30000, 45000]; // 15s, 30s, 45s
        } catch {
            return [15000, 30000, 45000]; // Fallback for invalid URLs
        }
    };
    
    const baseTimeouts = getDomainTimeouts(url);
    const retryDelays = [1000, 2000, 3000]; // 1s, 2s, 3s delays between retries
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        const currentTimeout = baseTimeouts[attempt] || baseTimeouts[baseTimeouts.length - 1];
        const timeoutId = setTimeout(() => controller.abort(), currentTimeout);

        try {
            // log(`[fetchUrlWithProgressiveTimeout - ${funcName}] Attempting ${url} (attempt ${attempt + 1}/${maxRetries}) with ${currentTimeout}ms timeout`);
            
            const response = await safeFetch(url, {
                signal: controller.signal,
                agent: new https.Agent({
                    rejectUnauthorized: false
                }),
                ...options
            });

            clearTimeout(timeoutId);
            log(`✅ Success for ${url} on attempt ${attempt + 1}`);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            const isLastAttempt = attempt === maxRetries - 1;
            const isTimeoutError = error.name === 'AbortError';

            // Errors that indicate the site can't be reached - don't retry these
            const isSiteUnreachableError = error.message?.includes('ENOTFOUND') ||      // DNS lookup failed
                                          error.message?.includes('ECONNREFUSED') ||   // Connection refused
                                          error.message?.includes('EHOSTUNREACH') ||   // Host unreachable
                                          error.message?.includes('ENETUNREACH') ||    // Network unreachable
                                          error.message?.includes('getaddrinfo');      // DNS resolution error

            // Only retry on transient errors (timeouts and connection resets)
            const isRetryableError = isTimeoutError ||
                                   error.message?.includes('ECONNRESET') ||
                                   error.message?.includes('ETIMEDOUT');

            if (isTimeoutError) {
                console.log(`⏱️ Timeout on attempt ${attempt + 1} for ${url} (${currentTimeout}ms)`);
            } else if (isSiteUnreachableError) {
                console.log(`🚫 Site unreachable on attempt ${attempt + 1} for ${url}: ${error.message} - NOT RETRYING`);
            } else {
                console.log(`❌ Error on attempt ${attempt + 1} for ${url}:`, error.message);
            }

            // If site is unreachable, return immediately without retrying
            if (isSiteUnreachableError) {
                return { error: `Site unreachable: ${error.message}`, attempts: attempt + 1 };
            }

            // If it's the last attempt or non-retryable error, return the error
            if (isLastAttempt || !isRetryableError) {
                if (isTimeoutError) {
                    return { error: `Timeout after ${maxRetries} attempts. Final timeout: ${currentTimeout}ms`, attempts: attempt + 1 };
                }
                return { error: error.toString(), attempts: attempt + 1 };
            }

            // Wait before retrying (exponential backoff)
            if (attempt < maxRetries - 1) {
                const delay = retryDelays[attempt] || retryDelays[retryDelays.length - 1];
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}

export async function callBackendEndpoint (
    endpoint: string,
    data: any,
    options: { timeout?: number; retries?: number; retryDelay?: number } = {}
) {
    // TODO: make this return a fetch promise
    // ): Promise<Response | FetchError> {
    const { 
        timeout = 60000, // 60 seconds default timeout
        retries = 2, // Number of retries for retryable errors
        retryDelay = 1000 // Base delay between retries in ms
    } = options;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const completeUrl = `${selfUrl()}${String(endpoint).replace(/^\/+/, '')}`;

            log(`[callBackendEndpoint] Calling backend endpoint: ${completeUrl}`);

            const response = await $fetch<any>(completeUrl, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + process.env.CUSTOM_API_KEY
                },
                body: JSON.stringify(data),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return { success: true, data: response };

        } catch (error) {
            const isLastAttempt = attempt === retries;
            const is524Error = error.statusCode === 524 || error.message?.includes('524') || error.message?.includes('timeout');
            const isTimeoutError = error.name === 'AbortError' || error.message?.includes('timeout');
            const is429Error = error.statusCode === 429 || /429|rate limit|too many requests/i.test(error.message || '');

            // Try to read Retry-After header if available
            const retryAfterHeader = (error?.response?.headers?.['retry-after']) || (error?.data?.headers?.['retry-after']);
            const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;

            // console.error(`[callBackendEndpoint] Error calling backend endpoint (attempt ${attempt + 1}/${retries + 1}): ${endpoint}:`, {
            //     statusCode: error.statusCode,
            //     message: error.message,
            //     name: error.name
            // });

            // Retry on rate limit (429), 524 errors or timeouts, but not on last attempt
            if ((is429Error || is524Error || isTimeoutError) && !isLastAttempt) {
                const baseDelay = retryDelay * Math.pow(2, attempt);
                const delay = is429Error ? (retryAfterMs ?? Math.min(60000, baseDelay)) : Math.min(30000, baseDelay);
                console.log(`[callBackendEndpoint] Retrying ${endpoint} in ${delay}ms due to ${is429Error ? '429 rate limit' : is524Error ? '524 error' : 'timeout'}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // On final failure, throw appropriate error
            if (is524Error) {
                throw createError({
                    statusCode: 524,
                    message: `Backend endpoint ${endpoint} timed out after ${retries + 1} attempts. The server took too long to respond.`
                });
            } else if (isTimeoutError) {
                throw createError({
                    statusCode: 408,
                    message: `Request to ${endpoint} timed out after ${timeout}ms`
                });
            } else if (is429Error) {
                throw createError({
                    statusCode: 429,
                    message: `Rate limit exceeded when calling ${endpoint}. Please try again later.`,
                    data: {
                        retryAfterMs: retryAfterMs || null,
                        attempts: attempt + 1
                    }
                });
            } else {
                throw createError({
                    statusCode: error.statusCode || 500,
                    message: `Error calling backend endpoint: ${endpoint}. Error: ${error.message}`
                });
            }
        }
    }
}

/**
 * Hand a message to the background job queue.
 *
 * The name is historical: the queue is QStash on WebBites.io and BullMQ/Redis
 * when QUEUE_DRIVER=redis (see utils/jobs). Callers don't care which.
 */
export async function sendToQstash(message: any | any[], options: { isBatch?: boolean; queueName?: string | null } = {}) {
    return enqueueJob(message, options);
}

const DEFAULT_USAGE = {
    currentMonth: {
      month: null,
      bookmarksTotal: 0,
      bookmarksThisMonth: 0,
      filesUploaded: 0,
      audiosGenerated: 0
    },
    pastMonths: []
  };
  
export async function updateUsage({typeOfUsage, user, subOrAdd = 'add', shouldRefreshCount = false, number = 1}) {
    try {
        // Input validation first
        if (!typeOfUsage) throw new Error('typeOfUsage parameter is required');
        if (!user) throw new Error('user parameter is required');
        if (typeof number !== 'number') throw new Error('number parameter must be a number');

        // Get user ID safely for logging
        const userIdForLogging = typeof user === 'string' ? user : (user?.id || 'unknown');
        log(`Starting usage update - Type: ${typeOfUsage}, User: ${userIdForLogging}, Operation: ${subOrAdd}`);

        // Fetch user if string ID provided
        let actualUser;
        try {
            actualUser = typeof user === 'string'
                ? await new Parse.Query(Parse.User)
                    .include(['userOptions'])
                    .get(user, { useMasterKey: true })
                : user;

            // console.log('actualUser: ', actualUser);
            if (!actualUser) throw new Error('User not found');
        } catch (error) {
            if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
                console.error(`User not found for ID: ${userIdForLogging}`, error?.message || String(error));
                return null;
            }
            console.error(`Error fetching user ${userIdForLogging}:`, error);
            throw new Error(`Failed to fetch user: ${error.message}`);
        }
  
        // Initialize or get usage data
        let usage = actualUser.get('usage');
        if (!usage) {
            console.log('Initializing new usage data for user');
            usage = structuredClone(DEFAULT_USAGE);
        }

        // console.log('Usage data before update:', usage);
  
        // Setup current month tracking
        const currentMonth = currentUsageMonth();
        log(`Processing usage for month: ${currentMonth}`);
  
        // Handle month transition if needed
        if (usage.currentMonth?.month && usage.currentMonth.month !== currentMonth) {
            log(`Month transition detected: ${usage.currentMonth.month} -> ${currentMonth}`);
            usage.pastMonths.push({ ...usage.currentMonth });
            usage.currentMonth = {
                ...DEFAULT_USAGE.currentMonth,
                month: currentMonth,
                bookmarksTotal: usage.currentMonth.bookmarksTotal || 0
            };
        } else if (!usage.currentMonth?.month) {
            // console.log('Initializing current month data');
            usage.currentMonth = {
                ...DEFAULT_USAGE.currentMonth,
                month: currentMonth
            };
        }

        const increment = subOrAdd === 'add' ? number : -number;
        log(`Applying increment: ${increment}`);
  
        try {
            if (typeOfUsage === 'bookmarks') {
                usage = await updateBookmarkCounts(usage, actualUser, increment, shouldRefreshCount);
                // console.log(`Updated bookmark counts - Total: ${usage.currentMonth.bookmarksTotal}, This Month: ${usage.currentMonth.bookmarksThisMonth}`);
            } else if (typeOfUsage in usage.currentMonth) {
                const previousValue = usage.currentMonth[typeOfUsage];
                usage.currentMonth[typeOfUsage] = (previousValue || 0) + increment;
                // console.log(`Updated ${typeOfUsage} count: ${previousValue} -> ${usage.currentMonth[typeOfUsage]}`);
            } else {
                throw new Error(`Invalid usage type: ${typeOfUsage}`);
            }
        } catch (error) {
            console.error(`Error updating ${typeOfUsage} counts:`, error);
            throw new Error(`Failed to update usage counts: ${error.message}`);
        }
  
        // Save updated usage data
        try {
            actualUser.set('usage', usage);
            await actualUser.save(null, { useMasterKey: true });
            // console.log('Successfully saved updated usage data');
        } catch (error) {
            console.error('Error saving usage data:', error);
            throw new Error(`Failed to save usage data: ${error.message}`);
        }

        // console.log('Usage update completed successfully: ', usage);
        return usage;
    } catch (error) {
        // Safe error logging with defensive checks
        const userIdForError = typeof user === 'string' ? user : (user?.id || 'unknown');
        console.error('Error in updateUsage:', {
            error,
            typeOfUsage,
            userId: userIdForError,
            operation: subOrAdd
        });
        throw new Error(`Failed to update ${typeOfUsage} usage: ${error.message}`);
    }
}

export function getCurrentMonthString(date: Date = new Date()) {
    return `${date.getMonth() + 1}/${date.getFullYear()}`;
}

async function getOrCreateUsageStats(user: Parse.User, month: string) {
    const UsageStats = Parse.Object.extend('UsageStats');
    const q = new Parse.Query(UsageStats);
    q.equalTo('user', user);
    q.equalTo('month', month);
    const existing = await q.first({ useMasterKey: true });
    if (existing) return existing as Parse.Object;
    const stats = new UsageStats();
    stats.set('user', user);
    stats.set('month', month);
    stats.set('bookmarksThisMonth', 0);
    await stats.save(null, { useMasterKey: true });
    return stats as Parse.Object;
}

export async function incrementBookmarkUsage({ user, delta, createdAt }: { user: string | Parse.User, delta: number, createdAt?: Date }) {
    const actualUser = typeof user === 'string'
        ? await new Parse.Query(Parse.User).get(user, { useMasterKey: true })
        : user;

    if (!actualUser) throw new Error('User not found');

    actualUser.increment('bookmarksTotal', delta);
    await actualUser.save(null, { useMasterKey: true });

    const eventDate = createdAt || new Date();
    const startOfMonth = new Date(eventDate.getFullYear(), eventDate.getMonth(), 1);
    const isCurrentMonth = eventDate >= startOfMonth;
    if (isCurrentMonth) {
        const monthStr = getCurrentMonthString(eventDate);
        const stats = await getOrCreateUsageStats(actualUser, monthStr);
        stats.increment('bookmarksThisMonth', delta);
        await stats.save(null, { useMasterKey: true });
    }
}

export async function reconcileBookmarkUsage({ user }: { user: string | Parse.User }) {
    const actualUser = typeof user === 'string'
        ? await new Parse.Query(Parse.User).get(user, { useMasterKey: true })
        : user;
    if (!actualUser) throw new Error('User not found');

    const relation = actualUser.relation('savedSites');
    const total = await relation.query().count({ useMasterKey: true });

    actualUser.set('bookmarksTotal', total);
    await actualUser.save(null, { useMasterKey: true });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const thisMonthCount = await relation.query()
        .greaterThanOrEqualTo('createdAt', startOfMonth)
        .count({ useMasterKey: true });

    const monthStr = getCurrentMonthString(new Date());
    const stats = await getOrCreateUsageStats(actualUser, monthStr);
    stats.set('bookmarksThisMonth', thisMonthCount);
    await stats.save(null, { useMasterKey: true });
}
  
async function updateBookmarkCounts(usage, user, increment, shouldRefreshCount) {
    try {
        log(`Updating bookmark counts - Increment: ${increment}, Refresh: ${shouldRefreshCount}`);

        if (!usage.currentMonth.bookmarksTotal || shouldRefreshCount) {
            log('Performing full bookmark count refresh');
            const savedSitesRelation = user.relation("savedSites");
            
            try {
                const [totalBookmarks, bookmarksThisMonth] = await Promise.all([
                    getBookmarkTotalCount(savedSitesRelation),
                    getBookmarksThisMonthCount(savedSitesRelation)
                ]);
                
                usage.currentMonth.bookmarksTotal = totalBookmarks;
                usage.currentMonth.bookmarksThisMonth = bookmarksThisMonth;
                
                log(`Retrieved fresh counts - Total: ${totalBookmarks}, This Month: ${bookmarksThisMonth}`);
            } catch (error) {
                console.error('Error fetching bookmark counts:', error);
                throw new Error(`Failed to fetch bookmark counts: ${error.message}`);
            }
        } else {
            console.log('Incrementing existing bookmark counts');
            usage.currentMonth.bookmarksTotal = (usage.currentMonth.bookmarksTotal || 0) + increment;
            usage.currentMonth.bookmarksThisMonth = (usage.currentMonth.bookmarksThisMonth || 0) + increment;
        }

        return usage;
    } catch (error) {
        console.error('Error in updateBookmarkCounts:', error);
        throw new Error(`Failed to update bookmark counts: ${error.message}`);
    }
}
  
async function getBookmarkTotalCount(relation) {
    return relation.query().count({ useMasterKey: true });
}
  
async function getBookmarksThisMonthCount(relation) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
  
    return relation.query()
      .greaterThanOrEqualTo('createdAt', startOfMonth)
      .count({ useMasterKey: true });
}

export async function compressBase64Image(base64Image: string, isPremium = false, fileFormat = 'png', originFunc = 'compressBase64Image') {
    try {
        // Validate base64 string
        if (!/^data:image\/\w+;base64,/.test(base64Image)) {
            // console.log('[compressBase64Image] Invalid base64 image string: ', originFunc);
            return base64Image; // Return original if invalid
        }

        // Remove data URL prefix
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

        // Convert base64 to Buffer
        let imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Validate imageBuffer
        if (!imageBuffer || imageBuffer.length === 0) {
            console.log('[compressBase64Image] Invalid or empty image buffer');
            return base64Image; // Return original if invalid
        }

        // Use sharp to compress the image
        let compressedImageBuffer;
        const quality = isPremium ? 20 : 50;

        try {
            switch (fileFormat.toLowerCase()) {
                case 'jpeg':
                case 'jpg':
                    compressedImageBuffer = await sharp(imageBuffer)
                        .jpeg({ quality: quality })
                        .toBuffer();
                    break;
                case 'png':
                    compressedImageBuffer = await sharp(imageBuffer)
                        .png({ compressionLevel: quality / 10 })
                        .toBuffer();
                    break;
                case 'webp':
                    compressedImageBuffer = await sharp(imageBuffer)
                        .webp({ quality: quality })
                        .toBuffer();
                    break;
                default:
                    console.log(`Unsupported file format: ${fileFormat}, returning original`);
                    return base64Image;
            }

        } catch (sharpError) {
            console.error(`Error in sharp processing: ${sharpError}`);
            return base64Image; // Return original if compression fails
        }

        // Convert Buffer back to base64
        let compressedBase64Image = compressedImageBuffer.toString('base64');

        return `data:image/${fileFormat.toLowerCase()};base64,${compressedBase64Image}`;
    } catch (error) {
        console.error(`Error compressing base64 image: ${error}`);
        return base64Image; // Return original if any error occurs
    }
}

// export function log(...args) {
//     if (process.env.NODE_ENV === 'development') console.log(...args);
// }

// export function errorLog(...args) {
//     if (process.env.NODE_ENV === 'development') console.error(...args);
// }

// Bookmark import validation utilities

/**
 * Decide whether a user may run a bookmark import, and under which allowance.
 *
 * Plan facts come from `utils/plans.ts` — this function must not read plan
 * columns off the user row itself. Import access is a separate, one-off
 * purchase that deliberately outranks the subscription tier while it is live.
 */
export async function validateImportAccess(user) {
    // No billing: importing is never gated (there is nothing to buy).
    if (!isBillingEnabled()) {
        return { hasAccess: true, accessType: 'subscription', ignoreSubscriptionLimits: false };
    }

    const importStatus = user.get('importAccessStatus') || 'none';
    const expiresAt = user.get('importAccessExpiresAt');

    // resolveUserPlan() hydrates the pointer when the caller forgot to
    // .include('currentPlan'). Without it, .get('planId') on a cold stub
    // answers undefined and every `!== 'free'` test below would hand a free
    // user subscription-level access.
    const plan = await resolveUserPlan(user);
    const bookmarkQuota = getBookmarkQuota(user, plan);
    const currentBookmarks = bookmarkQuota.used;
    const now = new Date();

    // Check if paid import access has expired
    if (importStatus === 'paid' && expiresAt && now > expiresAt) {
        user.set('importAccessStatus', 'expired');
        await user.save(null, { useMasterKey: true });
        return { 
            hasAccess: false, 
            reason: 'Import access expired',
            accessType: 'expired'
        };
    }

    // A plan may grant an unlimited allowance, in which case `limit` is null
    // and `exceeded` is always false — never compare against the raw number.
    const underLimit = !bookmarkQuota.exceeded;
    const bookmarkLimit = bookmarkQuota.limit ?? 'unlimited';

    // Check if import is already completed - but allow if they have less than their limit
    if (importStatus === 'completed') {
        if (underLimit) {
            return { 
                hasAccess: true, 
                accessType: 'completed-under-limit',
                ignoreSubscriptionLimits: false,
                reason: `You're under the limit (${currentBookmarks}/${bookmarkLimit}) - additional imports allowed`
                // reason: `Import completed but under limit (${currentBookmarks}/${bookmarkLimit}) - additional imports allowed`
            };
        }
        
        return { 
            hasAccess: false, 
            reason: `You are over the ${bookmarkLimit} bookmarks limit`,
            // reason: `Import already completed and over ${bookmarkLimit} bookmarks limit`,
            accessType: 'completed'
        };
    }
    
    // Special case: User has expired paid access but never used it - allow one-time import
    if (importStatus === 'expired' && !user.get('hasUsedImportAccess')) {
        return { 
            hasAccess: true, 
            accessType: 'expired-but-unused',
            ignoreSubscriptionLimits: true,
            reason: 'One-time import allowed for unused paid access'
        };
    }

    // Paid import access (active)
    if (importStatus === 'paid' || importStatus === 'importing') {
        return { 
            hasAccess: true, 
            accessType: 'paid-import',
            ignoreSubscriptionLimits: true
        };
    }

    // Subscription users. The old "legacy plan structure" branch that used to
    // follow this one read `currentPlan.currentPlan.name` — a path that only
    // ever existed on the dead `_User.plan` object, never on a `plans` row, so
    // it could not fire. It is gone; `resolveUserPlan` is the only answer now.
    if (isPaidPlan(plan)) {
        return {
            hasAccess: true,
            accessType: 'subscription',
            ignoreSubscriptionLimits: false
        };
    }

    // Free users - allow if under their bookmark limit OR if they paid but haven't imported yet
    const hasUsedImportAccess = user.get('hasUsedImportAccess') || false;
    const hasImportAccess = user.get('hasImportAccess') || false;
    
    // Case 1: User has paid for import access but hasn't used it yet
    if (hasImportAccess && !hasUsedImportAccess) {
        return { 
            hasAccess: true, 
            accessType: 'free-with-paid-access',
            ignoreSubscriptionLimits: true,
            reason: 'Paid import access available (not yet used)'
        };
    }
    
    // Case 2: Regular free user under their bookmark limit
    if (underLimit) {
        return { 
            hasAccess: true, 
            accessType: 'free',
            remainingQuota: bookmarkQuota.remaining,
            ignoreSubscriptionLimits: false
        };
    }
    
    // Case 3: Free user over limit
    return { 
        hasAccess: false, 
        reason: `Free limit reached (${bookmarkLimit} bookmarks). Please upgrade or purchase import access.`,
        accessType: 'free-over-limit'
    };
}

/**
 * Bookmark quota for an access decision.
 *
 * Synchronous, so it reads the plan `validateImportAccess` already resolved for
 * this user instance — which is why the two are always called as a pair.
 */
export function calculateQuotaInfo(user, accessCheck) {
    const quota = getBookmarkQuota(user, getResolvedPlan(user));

    // An access type that ignores plan limits reports as unlimited regardless
    // of what the plan says — that is the whole point of paid import access.
    if (isUnlimitedAccess(accessCheck.accessType)) {
        return { remaining: null, total: null, used: quota.used, unlimited: true };
    }

    const planQuota = {
        remaining: quota.remaining,
        total: quota.limit,
        used: quota.used,
        unlimited: quota.unlimited
    };

    switch (accessCheck.accessType) {
        case 'subscription':
        case 'free':
        case 'completed-under-limit':
            return planQuota;
        default:
            // No allowance for this access type (denied, expired, over limit).
            return { remaining: 0, total: 0, used: quota.used, unlimited: false };
    }
}

export function isUnlimitedAccess(accessType) {
    return ['paid-import', 'expired-but-unused', 'free-with-paid-access', 'subscription'].includes(accessType);
}

export function generateAccessReason(accessCheck, quota) {
    if (!accessCheck.hasAccess) {
        return accessCheck.reason;
    }

    switch (accessCheck.accessType) {
        case 'free':
            return `Free tier: ${quota.remaining} bookmarks remaining (${quota.used}/${quota.total} used)`;
        case 'subscription':
            return `Subscription plan: ${quota.remaining} bookmarks remaining (${quota.used}/${quota.total} used)`;
        case 'paid-import':
            return 'Active paid import access - unlimited imports';
        case 'expired-but-unused':
            return 'One-time unlimited import allowed for unused paid access';
        case 'free-with-paid-access':
            return 'Paid import access available - unlimited imports';
        case 'completed-under-limit':
            return `Import completed but under limit: ${quota.remaining} additional imports allowed (${quota.used}/${quota.total})`;
        default:
            return 'Import access available';
    }
}

/**
 * Send one email through the configured provider (see utils/mailer.ts).
 *
 * Answers `{ success: false, reason }` when email is not configured or the provider refuses,
 * instead of throwing: every caller either reports that to the user or carries on without it.
 */
export async function sendEmail({ userEmail, emailHtml, subject, name, text }: { userEmail: string; emailHtml: string; subject: string; name?: string; text?: string }) {
    const html = applyBrand(emailHtml).replaceAll('{{name}}', name || '');
    const result = await sendMail({ to: userEmail, subject, text, html });
    if (!result.success) {
        console.warn(`[sendEmail] not sent to ${userEmail}: ${result.reason}`);
        return { success: false, reason: result.reason };
    }
    log(`emailResult: ${JSON.stringify(result)}`);
    return { success: true, result };
}

export function useParse() {
  if (!Parse.applicationId) {
    Parse.initialize(
      process.env.VITE_PARSE_ID as string,
      process.env.VITE_PARSE_JS_KEY as string,
      process.env.VITE_PARSE_MASTER_KEY as string
    );
    Parse.serverURL = process.env.VITE_PARSE_URL as string;
  }
  return Parse;
}


export async function processImageColors(pixels) {
    let data = { data: new Uint8ClampedArray([...pixels.data]) };
    let options = { distance: 0.38, pixels: 1200 };
    let colors = await extractColors(data, options);
    const coloraze = new Coloraze();

    return colors.map(color => ({
        hex: color.hex,
        colorName: coloraze.name(color.hex),
        colorCategory: categorizeColor(color, coloraze.name(color.hex).toLowerCase()),
    }));
}

export function categorizeColor(color, colorName) {
    const { hue, saturation, lightness } = color;
    const normalizedColorName = colorName.toLowerCase();

    // Define color rules in order of priority
    // Rules are checked sequentially, so order matters
    const colorRules = [
        // Achromatic colors (Black, White, Gray) - check first
        {
            name: 'Black',
            test: () => {
                return lightness < 0.15 ||
                       (lightness < 0.25 && saturation < 0.1) ||
                       normalizedColorName.includes('black');
            }
        },
        {
            name: 'White',
            test: () => {
                return lightness > 0.92 ||
                       (lightness > 0.85 && saturation < 0.1) ||
                       normalizedColorName.includes('white');
            }
        },
        {
            name: 'Gray',
            test: () => {
                return saturation < 0.12 ||
                       (saturation < 0.2 && lightness >= 0.25 && lightness <= 0.85) ||
                       normalizedColorName.includes('gray') ||
                       normalizedColorName.includes('grey');
            }
        },

        // Chromatic colors - check hue ranges
        {
            name: 'Red',
            test: () => {
                // Red wraps around at 0/360 degrees (0.0/1.0)
                return ((hue >= 0 && hue < 0.028) || hue > 0.97) && saturation > 0.2 ||
                       normalizedColorName.includes('red') ||
                       normalizedColorName.includes('crimson') ||
                       normalizedColorName.includes('maroon');
            }
        },
        {
            name: 'Orange',
            test: () => {
                // Orange: 15-45 degrees (0.042-0.125)
                return (hue >= 0.028 && hue < 0.125) && saturation > 0.2 ||
                       normalizedColorName.includes('orange') ||
                       normalizedColorName.includes('coral') ||
                       normalizedColorName.includes('peach');
            }
        },
        {
            name: 'Brown',
            test: () => {
                // Brown: Orange/yellow hue with low lightness and moderate saturation
                return (hue >= 0.028 && hue < 0.15) &&
                       saturation > 0.15 && saturation < 0.7 &&
                       lightness > 0.15 && lightness < 0.5 ||
                       normalizedColorName.includes('brown') ||
                       normalizedColorName.includes('tan') ||
                       normalizedColorName.includes('beige');
            }
        },
        {
            name: 'Yellow',
            test: () => {
                // Yellow: 45-75 degrees (0.125-0.208)
                return (hue >= 0.125 && hue < 0.208) && saturation > 0.2 ||
                       normalizedColorName.includes('yellow') ||
                       normalizedColorName.includes('gold');
            }
        },
        {
            name: 'Green',
            test: () => {
                // Green: 75-165 degrees (0.208-0.458)
                return (hue >= 0.208 && hue < 0.458) && saturation > 0.2 ||
                       normalizedColorName.includes('green') ||
                       normalizedColorName.includes('lime') ||
                       normalizedColorName.includes('olive') ||
                       normalizedColorName.includes('emerald');
            }
        },
        {
            name: 'Cyan',
            test: () => {
                // Cyan/Aqua: 165-195 degrees (0.458-0.542)
                return (hue >= 0.458 && hue < 0.542) && saturation > 0.2 ||
                       normalizedColorName.includes('cyan') ||
                       normalizedColorName.includes('aqua') ||
                       normalizedColorName.includes('turquoise') ||
                       normalizedColorName.includes('teal');
            }
        },
        {
            name: 'Blue',
            test: () => {
                // Blue: 195-255 degrees (0.542-0.708)
                return (hue >= 0.542 && hue < 0.708) && saturation > 0.2 ||
                       normalizedColorName.includes('blue') ||
                       normalizedColorName.includes('navy') ||
                       normalizedColorName.includes('azure');
            }
        },
        {
            name: 'Purple',
            test: () => {
                // Purple/Violet: 255-285 degrees (0.708-0.792)
                return (hue >= 0.708 && hue < 0.792) && saturation > 0.2 ||
                       normalizedColorName.includes('purple') ||
                       normalizedColorName.includes('violet') ||
                       normalizedColorName.includes('indigo');
            }
        },
        {
            name: 'Pink',
            test: () => {
                // Pink: Magenta/Red hue with high lightness
                return ((hue >= 0.792 && hue < 1.0) || (hue >= 0 && hue < 0.083)) &&
                       lightness > 0.6 && saturation > 0.2 ||
                       normalizedColorName.includes('pink') ||
                       normalizedColorName.includes('rose') ||
                       normalizedColorName.includes('magenta');
            }
        },
        {
            name: 'Magenta',
            test: () => {
                // Magenta: 285-345 degrees (0.792-0.97)
                return (hue >= 0.792 && hue < 0.97) && saturation > 0.2 ||
                       normalizedColorName.includes('magenta') ||
                       normalizedColorName.includes('fuchsia');
            }
        }
    ];

    // Find the first matching rule
    const match = colorRules.find(rule => rule.test());
    return match ? match.name : 'Unknown';
}

export async function getImageBuffer(screenshotUrl: string, siteId: string) {
    let outputBuffer: string | null = null;

    const response = await fetchUrl(screenshotUrl, {}, 'getImageBuffer');
    if ('error' in response) return outputBuffer;

    // console.log(`[getImageBuffer] response: ${response}`);

    // fetchUrl now returns data directly, so response is already the buffer/data
    // Handle different response types: ArrayBuffer, Blob, or Buffer
    let imageBuffer: Buffer;
    if (response instanceof ArrayBuffer) {
        imageBuffer = Buffer.from(response);
    } else if (response instanceof Blob) {
        // Convert Blob to Buffer
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
    } else if (Buffer.isBuffer(response)) {
        imageBuffer = response;
    } else {
        imageBuffer = Buffer.from(response);
    }

    outputBuffer = await convertImageForProcessing(imageBuffer, screenshotUrl, siteId);
    return outputBuffer;
}

export async function convertImageForProcessing(imageBuffer: ArrayBuffer | Buffer, screenshotUrl: string, siteId: string) {
    try {
        const MAX_HEIGHT = 800;
        let tempFilePath = `/tmp/tempImage${new Date().getTime()}${Math.random().toString().replace('0', '')}.jpeg`;
        
        if(!imageBuffer) {
            console.error(`imageBuffer is null for ${screenshotUrl} with ${siteId}`);
            return null;
        }

        await sharp(imageBuffer as any)
            .resize({ height: MAX_HEIGHT })
            .jpeg()
            .toFile(tempFilePath);
        return tempFilePath;
    } catch (error) {
        console.error(`error converting image for color extraction for ${screenshotUrl} with ${siteId}: `, error);
        return null;
    }
}

export async function extractColorsFromImg(screenshotUrl, savedSite, funcName = 'extractColorsFromImg') {
    try{

        let outputBuffer = await getImageBuffer(screenshotUrl, savedSite.id);
        if (!outputBuffer) {
            console.error(`[getWebsiteColors from url - ${funcName}] outputBuffer empty for id ${savedSite.id}`);
            return null;
        }

        return await extractColorsFromBuffer(outputBuffer, savedSite.id, funcName);
    } catch (error) {
        console.error(`error extracting colors for image: `, error, 'func:', funcName);
        return null;
    }
}

// Optimized version that accepts an ArrayBuffer to avoid re-downloading the image
export async function extractColorsFromImgBuffer(imageBuffer: ArrayBuffer | Buffer, savedSite, funcName = 'extractColorsFromImgBuffer') {
    try {
        const outputBuffer = await convertImageForProcessing(imageBuffer, 'buffer-input', savedSite.id);
        if (!outputBuffer) {
            console.error(`[getWebsiteColors from buffer - ${funcName}] outputBuffer empty for id ${savedSite.id}`);
            return null;
        }

        return await extractColorsFromBuffer(outputBuffer, savedSite.id, funcName);
    } catch (error) {
        console.error(`error extracting colors from buffer: `, error);
        return null;
    }
}

// Shared function to extract colors from a processed image buffer (file path)
async function extractColorsFromBuffer(outputBuffer: string, siteId: string, funcName: string) {
    try {
        // Wrap getPixels in a promise since it uses callbacks
        const pixels: any = await new Promise<any>((resolve, reject) => {
            getPixels(outputBuffer, (err: any, pixels: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(pixels);
                }
            });
        });

        if (!pixels || !pixels.data || pixels.data.length === 0) {
            console.error(`[getWebsiteColors - ${funcName}] No pixels found for id ${siteId}`);
            return null;
        }

        let colors = await processImageColors(pixels);

        return colors;
    } catch (error) {
        console.error(`error extracting colors from buffer: `, error);
        return null;
    } finally {
        // convertImageForProcessing wrote this to /tmp; it was never removed.
        await unlink(outputBuffer).catch(() => {});
    }
}

export async function saveSiteColors(savedSite, colors) {
    try {
        savedSite.set("siteColors", colors);
        await savedSite.save(null, { useMasterKey: true });
    } catch (error) {
        console.error("error saving colors: ", error);
    }
}

/**
 * Hostname-text check for "looks like a local address". NOT a security boundary
 * — it misses 100.64/10, 169.254/16, most of 127/8, IPv4-mapped IPv6, and any
 * public name that resolves somewhere private. Use assertPublicUrl/safeFetch in
 * server/utils/safeUrl.ts for anything that actually fetches a user's URL; this
 * is kept only for the friendlier "that looks like a local site" messaging.
 */
export function isLocalUrl(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        // Check for localhost
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
            return true;
        }

        // Check for private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipPattern.test(hostname)) {
            const parts = hostname.split('.').map(Number);
            // 192.168.x.x
            if (parts[0] === 192 && parts[1] === 168) return true;
            // 10.x.x.x
            if (parts[0] === 10) return true;
            // 172.16.x.x to 172.31.x.x
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        }

        // Check for .local domains
        if (hostname.endsWith('.local')) {
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}

export function getObjectSize(object: any, returnObj: boolean = false){
    let size = {totalSize: 0};
    
    try {
        if(typeof object !== 'object') return 0

        for (const [key, value] of Object.entries(object)) {
            const sizeInBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
            const sizeInKilobytes = sizeInBytes / 1024;
            size[key] = sizeInKilobytes.toFixed(2);
            size.totalSize = Number(size.totalSize) + Number(sizeInKilobytes.toFixed(2));
        }

        if(returnObj) return {size, object}
        return size
    } catch (error) {
            return {}
    } finally {
        size = null
    }
}

export async function saveBookmarkToUser(user: Parse.User, savedSite: Parse.Object) {
    const WebsiteUrls = Parse.Object.extend('websiteUrls');

    try {
        const userRelation = user.relation("savedSites");
        userRelation.add(savedSite);

        // Update the websiteUrls cache before saving the user, so a single
        // user.save() persists both the relation and (if new) the pointer.
        const url = savedSite?.get('url');
        let websiteUrlsPointer;
        try {
            if (url) {
                websiteUrlsPointer = user.get('websiteUrls') ? await user.get('websiteUrls').fetch({ useMasterKey: true }) : undefined;

                if (!websiteUrlsPointer) {
                    websiteUrlsPointer = new WebsiteUrls();
                    websiteUrlsPointer.set('urls', [url]);
                    user.set('websiteUrls', websiteUrlsPointer);
                } else {
                    const urls = websiteUrlsPointer.get('urls') || [];
                    if (!urls.includes(url)) {
                        urls.push(url);
                        websiteUrlsPointer.set('urls', urls);
                        await websiteUrlsPointer.save(null, { useMasterKey: true });
                    }
                }
            }
        } catch (error) {
            console.log("Error setting websiteUrls 2: ", error);
        } finally {
            websiteUrlsPointer = null;
        }

        await user.save(null, { useMasterKey: true });
    } catch (error) {
        console.error('[saveBookmarkToUser] Error saving bookmark to user:', error);
        throw createError({ statusCode: 500, statusMessage: 'Error saving bookmark to user' });
    }
}

export function isUrlAnImage(url: string): boolean {
    // Remove query parameters from URL
    const urlWithoutParams = url.split('?')[0];

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg'];
    const extension = urlWithoutParams.split('.').pop().toLowerCase();

    const isBack4AppImage = url.startsWith('https://parsefiles.back4app.com') && (url.endsWith('jpg') || url.endsWith('jpeg') || url.endsWith('png') || url.endsWith('gif') || url.endsWith('bmp') || url.endsWith('svg'));

    return imageExtensions.includes('.' + extension) || isBack4AppImage;
}

export async function getExistingUrls(user: Parse.User): Promise<string[]> {
    try {
        const urls = new Set<string>();
        let skip = 0;
        const batchSize = 10000;

        while (true) {
        const query = new Parse.Query('websites');
        query.equalTo('user', user);
        query.select('url');
        query.limit(batchSize);
        query.skip(skip);

        const results = await query.find({ useMasterKey: true });
        results.forEach(w => urls.add(w.get('url')));

        if (results.length < batchSize) break;
        skip += batchSize;
        }

        let urlsArray = Array.from(urls);
        return urlsArray;
    } catch (error) {
        console.error('[getExistingUrls] Error fetching existing URLs:', error);
        throw createError({ statusCode: 500, statusMessage: '[getExistingUrls] Error fetching existing URLs' });
    }
}

/**
 * Save a website to the search index (Meilisearch; a second instance too when
 * MEILISEARCH_HOST_ALT is set)
 * @param websiteId - The Parse object ID of the website to save
 * @returns Object with success status and the result per instance
 */
export async function saveWebsiteToSearchIndices(websiteId: string, funcName: string) {
    const { MeiliSearch } = await import('meilisearch');
    const Sentry = await import('@sentry/node');

    try {
        if (!websiteId) {
            throw new Error('websiteId is required');
        }

        // Initialize search clients. The second instance exists only on deployments that run two.
        const meiliHost = sanitizeHostUrl(process.env.MEILISEARCH_HOST) || 'http://localhost:7700';
        const meiliHost_alt = sanitizeHostUrl(process.env.MEILISEARCH_HOST_ALT);
        const meiliApiKey = sanitizeEnvString(process.env.MEILISEARCH_API_KEY) || 'masterKey';
        const meiliApiKey_alt = sanitizeEnvString(process.env.MEILISEARCH_API_KEY_ALT) || meiliApiKey;

        const meilisearchClient = new MeiliSearch({
            host: meiliHost,
            apiKey: meiliApiKey
        });
        const meilisearchClientAlt = meiliHost_alt
            ? new MeiliSearch({ host: meiliHost_alt, apiKey: meiliApiKey_alt })
            : null;

        // Fetch the website from Parse
        const websiteQuery = new Parse.Query('websites');
        let savedSite: Parse.Object | undefined;

        try {
            savedSite = await websiteQuery.get(websiteId, { useMasterKey: true });
        } catch (error: any) {
            if (error.code === 101) { // Parse.Error.OBJECT_NOT_FOUND
                throw new Error(`Website not found: ${websiteId}`);
            }
            throw error;
        }

        // Helper function to calculate object size
        const getObjectSize = (object: any): number => {
            return JSON.stringify(object).length;
        };

        // Save to Meilisearch
        const saveToMeilisearch = async (params: { site: Parse.Object; client: any; host: string; apiKey: string; target: 'primary' | 'alt'; funcName: string }): Promise<{ success: boolean; size: number }> => {
            const { site, client, host, apiKey, target } = params;
            let size: number | null = null;

            // log(`[saveToMeilisearch] Saving meiliserach from ${funcName}`);

            try {
                log(`[DEBUG] Starting saveToMeilisearch(${target}) for ${site.id}`);

                const document = buildMeilisearchDocument(site);
                size = getObjectSize(document);

                const index = client.index(MEILISEARCH_CONFIG.INDEX_NAME);

                try {
                    await index.addDocuments([document], { primaryKey: 'id' });
                } catch (e: any) {
                    const msg = e?.message || String(e);
                    if (e instanceof SyntaxError || /JSON Parse/i.test(msg)) {
                        try {
                            const healthResp = await fetch(`${host}/health`, {
                                headers: { Authorization: `Bearer ${apiKey}` }
                            });
                            let healthBodyText = '';
                            let healthJsonOk = false;
                            try {
                                const hb = await healthResp.text();
                                healthBodyText = hb;
                                JSON.parse(hb);
                                healthJsonOk = true;
                            } catch {
                                healthJsonOk = false;
                            }
                            console.error('[Meilisearch Preflight] /health check', {
                                ok: healthResp.ok,
                                status: healthResp.status,
                                json: healthJsonOk,
                                bodySample: healthBodyText.slice(0, 200)
                            });
                            throw new Error(`Meilisearch response was not JSON. Verify ${target === 'alt' ? 'MEILISEARCH_HOST_ALT' : 'MEILISEARCH_HOST'} points to a Meilisearch instance. Status=${healthResp.status}`);
                        } catch (preflightErr: any) {
                            throw new Error(`Meilisearch JSON parse failed and preflight could not verify host: ${preflightErr?.message || String(preflightErr)}`);
                        }
                    }
                    throw e;
                }

                return { success: true, size };
            } catch (error) {
                console.log(`Error saving to Meilisearch(${target}): `, error, `size for ${site.id}:`, size);
                Sentry.captureException(error);
                throw error;
            }
        };

        // Save to each configured instance in parallel
        const failed = (error: unknown) => ({ success: false, error: (error as Error).message });
        const [meilisearchResult, meilisearchResultAlt] = await Promise.all([
            saveToMeilisearch({ site: savedSite, client: meilisearchClient, host: meiliHost, apiKey: meiliApiKey, target: 'primary', funcName }).catch(failed),
            meilisearchClientAlt && meiliHost_alt
                ? saveToMeilisearch({ site: savedSite, client: meilisearchClientAlt, host: meiliHost_alt, apiKey: meiliApiKey_alt, target: 'alt', funcName }).catch(failed)
                : Promise.resolve(null),
        ]);

        return {
            success: meilisearchResult.success || Boolean(meilisearchResultAlt?.success),
            meilisearch: meilisearchResult,
            meilisearchAlt: meilisearchResultAlt
        };

    } catch (error) {
        console.error('[saveWebsiteToSearchIndices] Error:', error, funcName);
        const Sentry = await import('@sentry/node');
        Sentry.captureException(error);
        throw error;
    }
}

export function createFileName(userId?: string, fileName?: string, fileFormat?: string, funcName?: string): string {
    try {
        fileName = fileName ? fileName.replace(/[^a-zA-Z0-9_]/g, '') : '';
        if (!/^[a-zA-Z]/.test(fileName)) {
            fileName = 'img_' + fileName;
        }
        
        userId = Boolean(userId) ? userId : 'anon';

        // Date.now() alone is not unique: several files uploaded in one request
        // (a multi-image bookmark) land on the same millisecond, and the S3
        // adapter's generateKey maps the name straight to user/<userId>/<name>,
        // so the second upload silently overwrote the first. The suffix makes
        // the key unique per file.
        const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        if (typeof fileName !== 'string' || !fileName || fileName.length === 0) {
            fileName = `${userId}_${uniq}`;
        }else{
            fileName = `parseUser=${userId}_fileName=${uniq}_${fileName}`
        }

        if(Boolean(fileFormat)) {
            fileFormat = fileFormat.includes('+') ? fileFormat.split('+')[0] : fileFormat;
            fileName = `${fileName}.${fileFormat.replaceAll('.', '')}`;
        }
        
        if (fileName) {
            const hasExtension = /\.[A-Za-z0-9]+$/.test(fileName);
            if (!hasExtension) {
                console.log('[createFileName] fileName with no extension:', fileName);
                throw new Error(`[${funcName}] Missing file extension`);
            }
        }

        return fileName
    } catch (error) {
        console.error('[createFileName] Error:', {
            error, 
            funcName,
            fileFormat
        });
        throw error;
    }
}

export function getPartitionedQueue(base: string, userId?: string): string {
    let randNum = Math.floor(Math.random() * 15) + 1;
    switch (base) {
        case 'getScreenshots':
            randNum = Math.floor(Math.random() * 5) + 1;;
            break;
    
        default:
            break;
    }
    return `${base}-${randNum}`;
}

/** Runs `worker` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await worker(items[index]);
        }
    });

    await Promise.all(runners);
    return results;
}
