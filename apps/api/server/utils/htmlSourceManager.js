import Parse from 'parse/node.js';
import { getHtmlContent, isLocalUrl } from './serverUtils.js';

// HTML Source Manager - Ensures single source of truth for HTML content
export class HtmlSourceManager {
    constructor() {
        this.pendingFetches = new Map(); // Track ongoing fetches
        this.cache = new Map(); // Short-term cache for active processing
    }

    /**
     * Get HTML content for a saved site with dependency management
     * Ensures only one fetch happens and all dependent processes wait
     */
    async getSharedHtmlContent(savedSiteId, options = {}) {
        const {
            forceRefresh = false,
            removeHtml = false,
            maxLength = 0,
            funcName = 'getSharedHtml'
        } = options;

        try {
            // Check if already being fetched
            if (this.pendingFetches.has(savedSiteId)) {
                log(`[HtmlSourceManager] Waiting for existing fetch: ${savedSiteId}`);
                return await this.pendingFetches.get(savedSiteId);
            }

            // Get saved site
            const savedSite = await this.getSavedSite(savedSiteId);
            if (!savedSite) {
                throw new Error(`SavedSite not found: ${savedSiteId}`);
            }

            // Check for existing HTML file first (unless force refresh)
            if (!forceRefresh) {
                const existingHtml = await this.getExistingHtmlFile(savedSite);
                if (existingHtml) {
                    // log(`[HtmlSourceManager] Using existing HTML file for ${savedSiteId}`);
                    return await this.processHtmlContent(existingHtml, { removeHtml, maxLength });
                }
            }

            // Start new fetch and store promise to prevent duplicates
            const fetchPromise = this.fetchAndStoreHtml(savedSite, savedSiteId, options);
            this.pendingFetches.set(savedSiteId, fetchPromise);

            try {
                const result = await fetchPromise;
                return result;
            } finally {
                // Clean up pending fetch
                this.pendingFetches.delete(savedSiteId);
            }

        } catch (error) {
            console.error(`[HtmlSourceManager] Error for ${savedSiteId}:`, error);
            this.pendingFetches.delete(savedSiteId);
            return { error: error.message };
        }
    }

    /**
     * Get existing HTML file from savedSite if available
     */
    async getExistingHtmlFile(savedSite) {
        try {
            // Check for different HTML file sources in order of preference
            // Rows hydrated from cache carry the file pointer without its URL column.
            const htmlFileUrl = savedSite.get('siteHtmlFileUrl') ||
                               savedSite.get('siteHtmlFile')?.url?.() ||
                               savedSite.get('siteBodyFileUrl');
            
            if (htmlFileUrl) {
                // log(`[HtmlSourceManager] Found existing HTML file: ${htmlFileUrl}`);
                
                // Fetch the stored HTML file
                const response = await fetch(htmlFileUrl);
                if (response.ok) {
                    const htmlContent = await response.text();
                    
                    // Validate content is substantial
                    if (htmlContent && htmlContent.length > 100) {
                        return htmlContent;
                    }
                }
            }

            return null;
        } catch (error) {
            console.error('[HtmlSourceManager] Error fetching existing HTML file:', error);
            return null;
        }
    }

    /**
     * Fetch HTML and store it for future use
     */
    async fetchAndStoreHtml(savedSite, savedSiteId, options) {
        const { funcName = 'getSharedHtml', removeHtml = false, maxLength = 0 } = options;
        
        try {
            log(`[HtmlSourceManager] Fetching fresh HTML for ${savedSiteId}`);
            
            const url = savedSite.get("url");
            if (!url) {
                log(`[HtmlSourceManager] Missing URL for ${savedSiteId}`);
                return { error: 'No URL found for savedSite', errorType: 'missing_url', savedSiteId: savedSiteId };
            }

            // Check if this is a local URL and handle accordingly
            const isLocal = isLocalUrl(url);
            if (isLocal) {
                log(`[HtmlSourceManager] Detected local URL: ${url}`)
                return { error: 'Local URL detected', errorType: 'local_url', url: url, savedSiteId: savedSiteId, isLocalUrl: isLocal };
            };

            // Fetch HTML content using our progressive timeout
            const rawHtml = await getHtmlContent(url, funcName, false, maxLength);
            
            if (rawHtml.error) {
                // Categorize the error type for better handling, considering if it's a local URL
                const errorType = this.categorizeError(rawHtml.error, isLocal);
                
                // Log appropriately based on error type
                if (errorType === 'dns_failure') {
                    console.warn(`[HtmlSourceManager] DNS resolution failed for ${url}: ${rawHtml.error}`);
                } else if (errorType === 'local_site_unreachable') {
                    console.warn(`[HtmlSourceManager] Local site unreachable for ${url}: ${rawHtml.error}`);
                } else if (errorType === 'site_unreachable') {
                    console.warn(`[HtmlSourceManager] Site unreachable for ${url}: ${rawHtml.error}`);
                } else if (errorType === 'timeout') {
                    console.warn(`[HtmlSourceManager] Request timeout for ${url}: ${rawHtml.error}`);
                } else {
                    console.warn(`[HtmlSourceManager] Fetch error for ${url}: ${rawHtml.error}`);
                }
                
                // Return error object instead of throwing
                return { 
                    error: rawHtml.error, 
                    errorType: errorType,
                    url: url,
                    savedSiteId: savedSiteId,
                    isLocalUrl: isLocal
                };
            }

            // Store HTML file for future use (if substantial content)
            if (rawHtml && rawHtml.length > 1000) {
                try {
                    await this.storeHtmlFile(savedSite, rawHtml, savedSiteId);
                    log(`[HtmlSourceManager] HTML file stored for ${savedSiteId}`);
                } catch (storeError) {
                    // Don't fail the whole operation if storage fails
                    console.warn(`[HtmlSourceManager] Failed to store HTML file: ${storeError.message}`);
                }
            }

            // Return processed content
            return await this.processHtmlContent(rawHtml, { removeHtml, maxLength });

        } catch (error) {
            // Handle unexpected errors gracefully
            console.error(`[HtmlSourceManager] Unexpected error for ${savedSiteId}:`, error);
            return { 
                error: error.message || 'Unexpected error occurred', 
                errorType: 'unexpected_error',
                savedSiteId: savedSiteId
            };
        }
    }

    /**
     * Categorize error types for better handling
     */
    categorizeError(errorMessage, isLocalUrl = false) {
        if (!errorMessage || typeof errorMessage !== 'string') {
            return 'unknown_error';
        }

        const errorLower = errorMessage.toLowerCase();

        // DNS and domain resolution errors
        if (errorLower.includes('dns_probe_finished_nxdomain') || 
            errorLower.includes('enotfound') || 
            errorLower.includes('getaddrinfo') ||
            errorLower.includes('dns lookup')) {
            return 'dns_failure';
        }

        // Site unreachable errors - differentiate between local and remote
        if (errorLower.includes('site unreachable') ||
            errorLower.includes('econnrefused') ||
            errorLower.includes('ehostunreach') ||
            errorLower.includes('enetunreach')) {
            return isLocalUrl ? 'local_site_unreachable' : 'site_unreachable';
        }

        // Timeout errors
        if (errorLower.includes('timeout') ||
            errorLower.includes('aborted')) {
            return 'timeout';
        }

        // Invalid URL errors
        if (errorLower.includes('invalid url') ||
            errorLower.includes('unsupported protocol')) {
            return 'invalid_url';
        }

        // For local URLs, any other connection error is likely a local site issue
        if (isLocalUrl && (errorLower.includes('connect') || errorLower.includes('fetch'))) {
            return 'local_site_unreachable';
        }

        return 'network_error';
    }

    /**
     * Store HTML content as a file for future reuse
     */
    async storeHtmlFile(savedSite, htmlContent, savedSiteId) {
        try {
            // Clean HTML for storage
            const cleanedHtml = htmlContent
                .replace(/<!doctype html>/i, '')
                .replace(/="\//g, '="/')
                .replaceAll('<a', '<a target="_blank"');

            let userId = savedSite.get("userId");
            userId = Boolean(userId) ? userId : 'anon';
            const fileName = createFileName(userId, `siteHtml_${savedSiteId}`, 'html', 'storeHtmlFile-1');
            const htmlFile = new Parse.File(fileName, {
                base64: Buffer.from(cleanedHtml).toString('base64')
            }, 'text/html');

            await htmlFile.save({ useMasterKey: true });
            
            // Update savedSite with HTML file reference
            savedSite.set("siteHtmlFile", htmlFile);
            savedSite.set("siteHtmlFileUrl", htmlFile.url());
            await savedSite.save(null, { useMasterKey: true });
            
            log(`[HtmlSourceManager] HTML file stored: ${htmlFile.url()}`);
            
        } catch (error) {
            console.error('[HtmlSourceManager] HTML storage failed:', error);
            throw error;
        }
    }

    /**
     * Process HTML content based on requirements
     */
    async processHtmlContent(htmlContent, options = {}) {
        const { removeHtml = false, maxLength = 0 } = options;
        
        if (!htmlContent || typeof htmlContent !== 'string') {
            return htmlContent;
        }

        let processed = htmlContent;

        // Remove HTML tags if requested
        if (removeHtml) {
            processed = removeHtmlTags(processed, maxLength || 6000);
            // console.log('[HtmlSourceManager] processed: ', processed)
        }

        // Apply length limit
        if (maxLength > 0 && processed.length > maxLength) {
            processed = processed.substring(0, maxLength);
        }

        return processed;
    }

    /**
     * Get saved site with caching
     */
    async getSavedSite(savedSiteId) {
        try {
            const query = new Parse.Query("websites");
            query.equalTo("objectId", savedSiteId);
            const savedSite = await query.first({ useMasterKey: true });
            return savedSite;
        } catch (error) {
            console.error(`[HtmlSourceManager] Failed to get savedSite ${savedSiteId}:`, error);
            return null;
        }
    }

    /**
     * Wait for HTML file to be ready (for dependent processes)
     */
    async waitForHtmlFile(savedSiteId, maxWaitTime = 30000) {
        const startTime = Date.now();
        const pollInterval = 1000; // Check every second

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const savedSite = await this.getSavedSite(savedSiteId);
                
                if (savedSite && savedSite.get('siteHtmlFileUrl')) {
                    log(`[HtmlSourceManager] HTML file ready for ${savedSiteId}`);
                    return true;
                }

                // Check if there's a pending fetch
                if (this.pendingFetches.has(savedSiteId)) {
                    log(`[HtmlSourceManager] Waiting for pending fetch: ${savedSiteId}`);
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    continue;
                }

                // No pending fetch and no file - might be an issue
                break;

            } catch (error) {
                console.error(`[HtmlSourceManager] Error waiting for HTML file:`, error);
                break;
            }
        }

        return false;
    }

    /**
     * Clear cache and pending fetches (cleanup method)
     */
    cleanup() {
        this.cache.clear();
        this.pendingFetches.clear();
    }
}

// Singleton instance
export const htmlSourceManager = new HtmlSourceManager();
