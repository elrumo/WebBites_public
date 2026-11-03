/**
 * Flow control (rate / parallelism / priority) per job type.
 *
 * Shared by both queue drivers: QStash applies it as message flowControl, the
 * Redis driver as worker concurrency + limiter + job priority.
 * Moved verbatim from serverUtils.ts.
 */

/**
 * Get flow control configuration for each operation type
 * This prevents overwhelming the backend with too many concurrent requests
 * @param flowKey - The flow control key/operation type (can include partition suffix like 'getPageContent-5')
 * @returns Flow control configuration with key, rate, period, and parallelism
 */
export function getFlowControlConfig(flowKey: string) {
    // Strip partition suffix (e.g., 'getPageContent-5' -> 'getPageContent')
    // This ensures partitioned queue names map to the correct base configuration
    const baseKey = flowKey.replace(/-\d+$/, '');

    // Helper to create config objects with priority delay
    const createConfig = (rate: number, parallelism: number, delay: number = 0) => ({
        key: flowKey,
        rate,
        period: '1m' as const,
        parallelism,
        delay // Delay in seconds: 0 = immediate (high priority), >0 = delayed (lower priority)
    });

    // Define priority levels for easier maintenance
    // delay: 0 = highest priority (immediate processing)
    // delay: 5 = medium priority (5 second delay)
    // delay: 10 = low priority (10 second delay)
    const PRIORITY = {
        HIGH: createConfig(15, 10, 0),       // Regular bookmarks - immediate processing
        MEDIUM: createConfig(10, 5, 5),      // Shared operations - 5 sec delay
        LOW: createConfig(5, 3, 10),         // Import operations - 10 sec delay
        BATCH_DELETE: createConfig(60, 60, 0) // Special case - immediate
    };

    const flowControlConfigs: Record<string, ReturnType<typeof createConfig>> = {
        // BOOKMARK SAVES FROM THE WEB APP
        // The web app used to publish these to QStash itself, with 30/min and
        // parallelism 40 per key and no delay. They now arrive through
        // POST /v1/jobs/enqueue, so the same limits live here: without an entry
        // they would fall to 'default' and every save would wait 5 seconds.
        'website-save-requests': createConfig(30, 40, 0),

        // USAGE COUNTER UPDATES FROM PARSE CLOUD CODE (afterDelete)
        // Parse used a named QStash queue, which runs one message at a time in
        // order: update-usage is a read-modify-write on the user row, so two at
        // once can lose an update. parallelism 1 keeps that; the rate is high
        // enough that deleting hundreds of bookmarks doesn't make the counter lag.
        'updateUsage-sequential': createConfig(600, 1, 0),

        // REGULAR BOOKMARK OPERATIONS (Higher priority)
        'getBookmarkContent': PRIORITY.HIGH,
        'getPageContent': PRIORITY.HIGH,

        // IMPORT-TRIGGERED OPERATIONS (Lower priority to avoid saturation)
        'getBookmarkContent-import': PRIORITY.LOW,
        'getPageContent-import': PRIORITY.LOW,
        'saveBookmarkFromimport-import': PRIORITY.LOW,
        'bookmarkImportRequests-import': PRIORITY.LOW,
        'bookmark-queue-management-import': PRIORITY.MEDIUM,
        
        'getScreenshots': PRIORITY.LOW,

        // RSS READER
        // Feed fetches are cheap and latency-visible, so they run at the
        // regular-bookmark rate. Extraction and bulk OPML subscribes each cost
        // a page fetch plus an OpenAI call, so they queue behind everything a
        // user is actively waiting on.
        'rssFeedPoll': PRIORITY.MEDIUM,
        'rssItemExtract': PRIORITY.LOW,
        'rssSubscribe': PRIORITY.LOW,

        // BACKUPS
        // One key, not partitioned: parallelism here is the global cap on
        // backups building zips at once.
        'backupRun': createConfig(10, 2, 0),

        // SHARED OPERATIONS
        'bookmark-queue-management': PRIORITY.MEDIUM,
        'bookmark-processing': PRIORITY.MEDIUM,
        'updateUsage': PRIORITY.MEDIUM,
        'usageUpdates': PRIORITY.MEDIUM,
        'fileProcessing': PRIORITY.MEDIUM,

        // SPECIAL CASES
        'batch-delete': PRIORITY.BATCH_DELETE,

        // Default configuration
        'default': PRIORITY.MEDIUM
    };

    // Try exact match first, then check if baseKey starts with any config key
    // This ensures 'getPageContent-import' matches 'getPageContent-import' before 'getPageContent'
    let config = flowControlConfigs[baseKey];

    if (!config) {
        // No exact match, find the longest matching prefix
        // Sort keys by length (longest first) to match most specific patterns first
        const matchKey = Object.keys(flowControlConfigs)
            .filter(k => k !== 'default')
            .sort((a, b) => b.length - a.length)
            .find(k => baseKey.startsWith(k));

        config = flowControlConfigs[matchKey || 'default'];
    }

    if (config === flowControlConfigs['default']) {
        console.log('[getFlowControlConfig] Using default config for flowKey:', flowKey, 'baseKey:', baseKey);
    }

    return config;
}
