import { captureException } from '#root/server/utils/sentry.js';

// Temporarily disable profiling integration due to missing native module
// import { nodeProfilingIntegration } from '@sentry/profiling-node';

import Parse from 'parse/node.js'
import { defineEventHandler, readBody, createError } from 'h3';

import { htmlSourceManager } from '#root/server/utils/htmlSourceManager.js';
import { getSiteById, askGpt } from '#root/server/utils/serverUtils.js';
import { getAiLanguage } from '#root/server/utils/aiLanguage.js';
import { validateInternalApiKey } from '../../../utils/api-keys'
import { requireUserId } from '../../../utils/requireUser'

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = process.env.VITE_PARSE_URL;

// Type definitions
interface RequestBody {
    savedSiteId?: string;
    siteBody?: string | null;
    userId?: string;
    model?: string | null;
}

interface RawRequestBody {
    websiteData?: RequestBody;
    savedSiteId?: string;
    siteBody?: string | null;
    userId?: string;
    model?: string | null;
}

interface AiSummaryParams {
    savedSite?: Parse.Object | null;
    fromCache?: boolean;
    siteBody?: string | null;
    userId?: string;
    model?: string | null;
    shouldSave?: boolean;
    prompt?: string;
}

interface AiSummaryResult {
    tldr?: string;
    pointsThatBestDescribeThePage?: Array<{
        title: string;
        oneLineDescription: string;
        emojiThatBestRepresentsThePoint: string;
    }>;
    error?: string;
    details?: string;
}

function normalizeSummary(result: any): AiSummaryResult {
    if (result == null) return {};
    if (typeof result === 'string') {
        try {
            const parsed = JSON.parse(result);
            if (parsed && typeof parsed === 'object') return parsed as AiSummaryResult;
        } catch {}
        return { tldr: result } as AiSummaryResult;
    }
    if (typeof result === 'object') return result as AiSummaryResult;
    return {};
}

interface GptResponse {
    result?: any;
    error?: string;
    usage?: {
        queries: Array<{
            timeTaken?: number;
        }>;
    };
}

interface HtmlResult {
    error?: string;
    [key: string]: any;
}

export default defineEventHandler(async (event): Promise<AiSummaryResult> => {
    const startTime = performance.now();
    const requestId = `${Date.now()}.${Math.random()}`;

    try {
        const rawBody: RawRequestBody = await readBody(event);
        const body: RequestBody = rawBody.websiteData || rawBody;

        const {
            savedSiteId,
            siteBody = null
        } = body;

        // Only the pipeline may name a row, a user or a model; everyone else is who their credential says.
        const isInternal = validateInternalApiKey(event);
        const model = isInternal ? body.model ?? null : null;
        if (savedSiteId && !isInternal) {
            throw createError({ statusCode: 403, statusMessage: 'savedSiteId requires the internal API key' });
        }
        const userId: string | null = isInternal ? (body?.userId || null) : await requireUserId(event);

        const fromCache = true;

        let savedSite: Parse.Object | null = null;
        if (savedSiteId) savedSite = await getSiteById(savedSiteId, 'getAiSummary');

        const result = await getAiSummary({
            savedSite,
            fromCache,
            siteBody,
            userId,
            model,
            shouldSave: Boolean(savedSiteId) ? true : false
        });

        if (!savedSiteId) {
            log(`[getAiSummary] no savedSiteID for getAIsummary: ${savedSiteId}`);
            return result;
        }

        // console.log('getAISummary result: ', result)

        const duration = ((performance.now() - startTime) / 1000).toFixed(2);
        // log(`[${duration}s] [getAiSummary] getAiSummary______________${requestId}`);

        return result;
        // console.log('[aiSummary] result: ', result)
    } catch(error: any) {
        const duration = ((performance.now() - startTime) / 1000).toFixed(2);
        log(`[${duration}s] [getAiSummary] getAiSummary______________${requestId} - ERROR: ${error}`);
        // Provide structured error responses, including status codes when available
        const statusCode = error?.statusCode || (error?.status === 429 ? 429 : undefined);
        const isRateLimited = statusCode === 429 || /rate limit/i.test(error?.message || '');

        // Attempt to include retry hint if rate limited
        const retryAfterHeader = (error?.response?.headers?.['retry-after']) || (error?.data?.headers?.['retry-after']);
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;

        return {
            error: isRateLimited ? 'Rate limit exceeded' : 'Failed to generate AI summary',
            details: error?.message || 'Unexpected error',
            ...(statusCode ? { statusCode } as any : {}),
            ...(isRateLimited && retryAfterSeconds ? { retryAfterSeconds } : {}),
        };
    }
});

/**
 * The summariser itself, exported so callers that have text but no `websites`
 * row can reuse it — the RSS reader summarises `rssItems` bodies through this
 * exact path, which is what keeps bookmark summaries and article summaries
 * identical in shape, prompt and language handling.
 */
export async function getAiSummary({
    fromCache = true, 
    savedSite, 
    siteBody, 
    userId, 
    shouldSave = true, 
    prompt, 
    model
}: AiSummaryParams): Promise<AiSummaryResult> {
    if (!savedSite && !siteBody) {
        throw new Error('Either savedSite or siteBody must be provided');
    }

    // console.log('[getAiSummary] savedSite: ', savedSite)
    
    const startTime = performance.now();

    try {
        const existingSummary = savedSite?.get("aiSummary");
        if (existingSummary && fromCache) {
            log(`[getAiSummary] fromCache: ${fromCache}`);
            return normalizeSummary(existingSummary);
        }

        // getPageContent only found a wall (cookie notice, login prompt, bot
        // check): there is nothing to summarise.
        if (!siteBody && savedSite?.get('contentWalled')) {
            log(`[getAiSummary] skipped, content walled: ${savedSite.id}`);
            return {};
        }

        let siteHtml: string | HtmlResult | undefined;
        // getPageContent runs before this stage and leaves plain text in
        // siteBody, so the usual case needs no fetch at all.
        const storedBody = siteBody || savedSite?.get('siteBody');
        if (storedBody) {
            siteHtml = storedBody;
        } else {
            // Use shared HTML source manager for unified content access
            log(`[getAiSummary] Using shared HTML source for: ${savedSite?.id}`);
            
            const htmlResult: HtmlResult = await htmlSourceManager.getSharedHtmlContent(savedSite?.id, {
                removeHtml: true,
                maxLength: 8000,
                funcName: 'getAiSummary'
            });
            
            if (htmlResult.error) {
                console.warn('[getAiSummary] Shared HTML fetch failed:', htmlResult.error);
                return { error: '[getAiSummary] Failed to retrieve site content', details: htmlResult.error };
            }
            
            siteHtml = htmlResult;
            // console.log('[getAiSummary] siteHtml: ', siteHtml)
            // console.log('[getAiSummary] Shared HTML length:', siteHtml?.length);
        }

        if(typeof siteHtml === "object" && siteHtml !== null && "error" in siteHtml) {
            console.error('[getAiSummary] Error getting site HTML:', siteHtml.error);
            return { error: '[getAiSummary] Failed to retrieve site content', details: siteHtml.error };
        }
        
        // Ensure siteHtml is a string for further processing
        const htmlString = typeof siteHtml === 'string' ? siteHtml : String(siteHtml || '');
        
        // Limit text length for AI processing
        const maxTextLength = 8000;
        let processedHtml = htmlString;
        if (htmlString && htmlString.length > maxTextLength) {
            processedHtml = htmlString.substring(0, maxTextLength) + '...';
        }
        
        const type = savedSite?.get("type");

        if (processedHtml && type !== 'textNote' && type !== 'image') {

            // The output language is the user's setting, not a guess about the
            // source text — a reader who wants English summaries wants them for
            // the German article too. 'same as the content' is one of the values.
            const language = await getAiLanguage(userId, savedSite?.get('language'));

            log(`[getAiSummary] output language: ${language}`);

            let summaryPrompt: string;

            if (prompt) {
                log(`[getAiSummary] using custom prompt: ${prompt}`);
                summaryPrompt = prompt + `\n\nText to summarize: ${processedHtml}`;
            } else {
                summaryPrompt = `
                You are a web expert and your job is to create a TL;DR of the text bellow, which has is an extracted snippet from a website, and FOUR emojis at most. Return the text in ${language}. YOU MUST ALWAYS RETURN IN JSON FORMAT.
                
                Example of the json to return:
                    {tldr: '', pointsThatBestDescribeThePage: [{title: '', oneLineDescription: '', emojiThatBestRepresentsThePoint: ''}]}.
                
                REMEMBER: ALWAYS RETURN IN JSON FORMAT.
                Text to summarize: ${processedHtml}
            `;
            }

            // log(`[getAiSummary] summaryPrompt: ${summaryPrompt}`)

            const summary: GptResponse = await askGpt(summaryPrompt, { 
                name: 'getAiSummary', 
                userId: userId, 
                savedSite: savedSite ? savedSite : null,
                model,
                maxTokens: 1500
            });
            
            // Handle both legacy askGpt error shape and Claude's structured error in result
            if (summary.error) {
                console.log("error getting summary from GPT: ", summary.error);
                const errVal: any = summary.error as any;
                const msg = typeof errVal === 'string'
                    ? errVal
                    : (errVal && typeof errVal === 'object' && 'message' in errVal && typeof errVal.message === 'string'
                        ? errVal.message
                        : 'Unknown AI error');
                const rateLimited = /429|rate limit|too many requests/i.test(msg);
                return {
                    error: rateLimited ? 'Rate limit exceeded' : 'AI summarization failed',
                    details: msg,
                    ...(rateLimited ? { statusCode: 429 } as any : {})
                };
            }

            // Claude path: summary.result may contain { error: true, message }
            if (summary.result && typeof summary.result === 'object' && (summary.result as any).error) {
                const resVal: any = summary.result as any;
                const msg = (resVal && typeof resVal === 'object' && 'message' in resVal && typeof resVal.message === 'string')
                    ? resVal.message
                    : 'Unknown AI error';
                const rateLimited = /429|rate limit|too many requests/i.test(msg);
                return {
                    error: rateLimited ? 'Rate limit exceeded' : 'AI summarization failed',
                    details: msg,
                    ...(rateLimited ? { statusCode: 429 } as any : {})
                };
            }
            
            const summaryResult = normalizeSummary(summary.result);
            
            const timeTaken = Math.floor((performance.now() - startTime) / 1000);
            if (summary.usage?.queries?.[0]) {
                summary.usage.queries[0].timeTaken = timeTaken;
            }

            if (shouldSave && savedSite) {
                log('saving aiSummary');
                savedSite.set('aiCacheIgnored', false);
                savedSite.set('aiFromCache', false);
                savedSite.set("aiSummary", summaryResult);
                await savedSite.save(null, { useMasterKey: true });
            } else {
                console.log(`NOT saving aiSummary (shouldSave=${shouldSave}, savedSite=${savedSite?.id ?? null})`);
            }

            return summaryResult;
        }
        
        return {};
    } catch (error: any) {
        if (error?.statusCode === 401 || error?.statusCode === 403) throw error;
        console.error("error getting ai summary: ", error);
        captureException(error);
        return { error: 'Failed to generate AI summary', details: error.message };
    }
}