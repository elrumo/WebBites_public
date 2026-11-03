const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const Sentry = require("@sentry/node");
// const { nodeProfilingIntegration } = require("@sentry/profiling-node");



const AUTH_HEADER = process.env.CUSTOM_API_KEY

// Error reporting is opt-in: nothing leaves this server unless SENTRY_DSN is set.
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    });
}

// The backend that Parse's triggers call (set to its internal URL in Docker).
function backendUrlFromEnv() {
    return (process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || '').replace(/\/*$/, '/');
}

const USAGE_ATOMIC_ENABLED = process.env.USAGE_ATOMIC_ENABLED !== 'false';

async function getOrCreateUsageStats(user, monthStr) {
    const UsageStats = Parse.Object.extend('UsageStats');
    const q = new Parse.Query(UsageStats);
    q.equalTo('user', user);
    q.equalTo('month', monthStr);
    const existing = await q.first({ useMasterKey: true });
    if (existing) return existing;
    const stats = new UsageStats();
    stats.set('user', user);
    stats.set('month', monthStr);
    stats.set('bookmarksThisMonth', 0);
    await stats.save(null, { useMasterKey: true });
    return stats;
}

function getCurrentMonthString(date = new Date()) {
    return `${date.getMonth() + 1}/${date.getFullYear()}`;
}

// Debounce map to track pending user updates
const pendingUserUpdates = new Map();
// Mutex map to prevent concurrent flushes for the same user
const flushLocks = new Map();

async function incrementBookmarkCountersForEvent(user, savedWebsite, delta) {
    const userId = user.id;

    // Validate userId
    if (!userId) {
        console.error('[incrementBookmarkCountersForEvent] Invalid userId:', userId);
        return;
    }

    // Check if there's already a pending update for this user
    if (pendingUserUpdates.has(userId)) {
        // Add delta to pending count instead of doing immediate update
        const pending = pendingUserUpdates.get(userId);
        pending.delta += delta;
        pending.count++;

        // If we've accumulated 10+ changes, force flush
        if (pending.count >= 10) {
            clearTimeout(pending.timer);
            await flushUserUpdate(userId).catch(error => {
                console.error('[incrementBookmarkCountersForEvent] Flush error:', error);
            });
        }
        return;
    }

    // Create new pending update
    const pending = {
        delta: delta,
        count: 1,
        userId: userId,
        createdAt: savedWebsite.get('createdAt') || new Date(),
        timer: null
    };

    pending.timer = setTimeout(async () => {
        await flushUserUpdate(userId).catch(error => {
            console.error('[incrementBookmarkCountersForEvent] Timer flush error:', error);
        });
    }, 2000); // Flush after 2 seconds of inactivity

    pendingUserUpdates.set(userId, pending);
}

async function flushUserUpdate(userId) {
    // Prevent concurrent flushes for the same user using a simple promise-based lock
    if (flushLocks.has(userId)) {
        console.log(`[flushUserUpdate] Waiting for existing flush to complete for user ${userId}`);
        await flushLocks.get(userId);
        // After the lock is released, check if there's still pending data
        if (!pendingUserUpdates.has(userId)) {
            return; // Already flushed by the concurrent call
        }
    }

    // Create a promise that will resolve when this flush completes
    let releaseLock;
    const lockPromise = new Promise(resolve => { releaseLock = resolve; });
    flushLocks.set(userId, lockPromise);

    try {
        const pending = pendingUserUpdates.get(userId);
        if (!pending) {
            return;
        }

        pendingUserUpdates.delete(userId);
        clearTimeout(pending.timer);

        // Refetch user to ensure we have the latest usage data
        const userQuery = new Parse.Query(Parse.User);
        let user;

        try {
            user = await userQuery.get(userId, { useMasterKey: true });
        } catch (error) {
            // User not found - likely deleted or session expired
            console.error(`[flushUserUpdate] User ${userId} not found:`, error.message);
            return;
        }

        // Use atomic increment for bookmarksTotal
        user.increment('bookmarksTotal', pending.delta);

        const createdAt = pending.createdAt;
        const startOfMonth = new Date(createdAt.getFullYear(), createdAt.getMonth(), 1);
        const isCurrentMonth = createdAt >= startOfMonth;
        if (isCurrentMonth) {
            const stats = await getOrCreateUsageStats(user, getCurrentMonthString(createdAt));
            stats.increment('bookmarksThisMonth', pending.delta);
            await stats.save(null, { useMasterKey: true });
        }

        // Update the 'usage' column with current month data
        const currentMonthStr = getCurrentMonthString(createdAt);
        let usage = user.get('usage') || { currentMonth: {}, pastMonths: [] };

        // Initialize currentMonth if it doesn't exist or if it's a different month
        if (!usage.currentMonth || usage.currentMonth.month !== currentMonthStr) {
            // Determine if this is a new month rollover or first-time initialization
            const isFirstTimeInit = !usage.currentMonth;

            // For month rollover, preserve the total from previous month
            // For first-time init, start from 0 (will be incremented below)
            const previousTotal = isFirstTimeInit ? 0 : (usage.currentMonth?.bookmarksTotal || 0);

            // If there was a previous month, move it to pastMonths
            if (usage.currentMonth && usage.currentMonth.month) {
                usage.pastMonths = usage.pastMonths || [];
                usage.pastMonths.push(usage.currentMonth);
            }

            // Initialize new current month
            usage.currentMonth = {
                month: currentMonthStr,
                bookmarksTotal: previousTotal,
                bookmarksThisMonth: 0,
                filesUploaded: usage.currentMonth?.filesUploaded || 0,
                audiosGenerated: usage.currentMonth?.audiosGenerated || 0
            };
        }

        // Update counts by incrementing/decrementing from the current value
        usage.currentMonth.bookmarksTotal = (usage.currentMonth.bookmarksTotal || 0) + pending.delta;
        usage.currentMonth.bookmarksThisMonth = (usage.currentMonth.bookmarksThisMonth || 0) + pending.delta;

        user.set('usage', usage);

        // Save with retry logic for concurrent modification errors
        let saveAttempts = 0;
        const maxAttempts = 3;
        while (saveAttempts < maxAttempts) {
            try {
                await user.save(null, { useMasterKey: true });
                console.log(`[flushUserUpdate] Successfully updated counters for user ${userId} (delta: ${pending.delta})`);
                break;
            } catch (saveError) {
                saveAttempts++;
                if (saveAttempts >= maxAttempts) {
                    throw saveError;
                }
                console.warn(`[flushUserUpdate] Retry ${saveAttempts}/${maxAttempts} for user ${userId}:`, saveError.message);
                await new Promise(resolve => setTimeout(resolve, 100 * saveAttempts));
                // Refetch user for retry
                user = await userQuery.get(userId, { useMasterKey: true });
                user.increment('bookmarksTotal', pending.delta);
                usage = user.get('usage') || { currentMonth: {}, pastMonths: [] };
                if (!usage.currentMonth || usage.currentMonth.month !== currentMonthStr) {
                    usage.currentMonth = {
                        month: currentMonthStr,
                        bookmarksTotal: 0,
                        bookmarksThisMonth: 0,
                        filesUploaded: 0,
                        audiosGenerated: 0
                    };
                }
                usage.currentMonth.bookmarksTotal = (usage.currentMonth.bookmarksTotal || 0) + pending.delta;
                usage.currentMonth.bookmarksThisMonth = (usage.currentMonth.bookmarksThisMonth || 0) + pending.delta;
                user.set('usage', usage);
            }
        }
    } catch (error) {
        console.error('[flushUserUpdate] Error:', error);
        Sentry.captureException(error);
        // Re-queue the update if it failed
        if (pendingUserUpdates.has(userId)) {
            const existing = pendingUserUpdates.get(userId);
            existing.delta += pending.delta;
        } else {
            pendingUserUpdates.set(userId, {
                delta: pending.delta,
                count: 1,
                userId: userId,
                createdAt: pending.createdAt,
                timer: setTimeout(async () => {
                    await flushUserUpdate(userId).catch(err => {
                        console.error('[flushUserUpdate] Retry flush error:', err);
                    });
                }, 5000) // Retry after 5 seconds
            });
        }
    } finally {
        // Release the lock
        flushLocks.delete(userId);
        releaseLock();
    }
}

const gpt4 = 'gpt-4o';
const modelCosts = {
    gpt4: {
        input: 0.005,
        output: 0.015,
    },
    gpt3: {
        input: 0.0005,
        output: 0.0015,
    }
}

const Websites = Parse.Object.extend("websites");
const Users = Parse.Object.extend("User");


Parse.Cloud.beforeSave("websites", async (request) => {
    // beforeSaveWebsites/setSiteTitle existed but were never registered.
    // Never throw from here — a failure to default the title must not block the save.
    try {
        await beforeSaveWebsites(request)
    } catch (error) {
        console.error('Error in websites beforeSave:', error);
        Sentry.captureException(error);
    }
})

Parse.Cloud.afterSave("websites", async (request) => {
    try {
        await afterSaveWebsites(request)
    } catch (error) {
        console.error('Critical error in websites afterSave:', error);
        Sentry.captureException(error);
        throw error
    }
})

Parse.Cloud.beforeDelete("websites", async (request) => {
    let msgs = [];

    // The whole account is being deleted. Unpicking this bookmark from the
    // user's urls list and savedSites relation would re-save the very user that
    // is mid-delete, once per bookmark, and the backend wipes the search
    // documents for the user in one call anyway.
    if (request.context && request.context.userDeleted) return msgs;

    try {
        let user = request.object.get("user");

        if (!user) {
            console.log("After delete: User not found");
            return msgs;
        }

        try {
            let userQuery = new Parse.Query(Parse.User);
            userQuery.equalTo('objectId', user.id);
            userQuery.include('websiteUrls');
            user = await userQuery.first({useMasterKey: true});
        } catch (error) {
            console.log("Error finding user: ", error);
            Sentry.captureException(error);
            return msgs;
        }

        let savedWebsite = request.object;

        try {
            let websiteUrlsPointer = user.get('websiteUrls');

            if (websiteUrlsPointer != undefined) {
                const urls = websiteUrlsPointer.get('urls') || [];

                if (urls != undefined && urls.length > 0) {
                    const websiteUrl = savedWebsite.get('url');
                    const urlIndex = urls.indexOf(websiteUrl);
                    if (urlIndex !== -1) {
                        urls.splice(urlIndex, 1);
                        websiteUrlsPointer.set('urls', urls);
                        await websiteUrlsPointer.save(null, {
                            useMasterKey: true
                        });
                    } else {
                        // console.log("No websiteUrlsPointer found for the deleted website 1.");
                    }
                }
            } else {
                // console.log("No websiteUrlsPointer found for the deleted website 2.");
            }
        } catch (error) {
            console.log("Error setting websiteUrls 1: ", error);
            Sentry.captureException(error);
        }

        try {
            const savedSitesRelation = user.relation("savedSites");
            savedSitesRelation.remove(request.object);
            await user.save(null, {useMasterKey: true});
        } catch (error) {
            console.log("Error removing website from user's savedSites relation 1: ", error);
            Sentry.captureException(error);
        }

    } catch (error) {
        console.log("Error removing website from user's savedSites relation 2: ", error);
        Sentry.captureException(error);
    }


    return msgs;
});

Parse.Cloud.afterDelete("websites", async (request) => {
    // See beforeDelete: nothing here is worth doing per row when the account
    // itself is going — the quota it would settle is about to stop existing.
    if (request.context && request.context.userDeleted) return;

    try {
        const objectId = request.object.id;
        const savedWebsite = request.object;
        const user = savedWebsite.get('user');

        // The Meilisearch document outlives a *soft* delete on purpose — that
        // is what the trash reads and what a restore flips back — so the row
        // finally going for good is the moment the document has to go with it.
        // The backend owns the Meilisearch credentials, hence the call.
        // `wasCounted: false` because the quota is settled below, here.
        try {
            const backendUrl = backendUrlFromEnv();
            fetch(`${backendUrl}v1/triggers/websites/afterDelete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `${process.env.CUSTOM_API_KEY}`
                },
                body: JSON.stringify({ websiteId: objectId, userId: user?.id, wasCounted: false })
            }).catch(error => {
                console.log("Error cleaning search index in afterDelete: ", error);
                Sentry.captureException(error);
            });
        } catch (error) {
            console.log("Error calling afterDelete endpoint: ", error);
            Sentry.captureException(error);
        }

        try {
            // A bookmark whose quota was already given back — every soft delete
            // clears this flag when it frees the quota — must not give it back
            // again thirty days later when the purge destroys the row.
            if (savedWebsite.get('bookmarkCounted') === false) {
                console.log('[afterDelete] Quota already freed at soft-delete time:', objectId);
                return;
            }

            if (USAGE_ATOMIC_ENABLED) {
                await incrementBookmarkCountersForEvent(user, savedWebsite, -1);
            } else {
                let objToSend = {
                    type: 'update-usage',
                    data: {
                        typeOfUsage: 'bookmarks',
                        userId: user.id,
                        subOrAdd: 'sub',
                        number: 1,
                        shouldRefreshCount: true
                    }
                }
                // Sequential on purpose: update-usage is a read-modify-write on the
                // user row. This used to be a named QStash queue (one at a time, in
                // order); 'updateUsage-sequential' is the backend's equivalent.
                await enqueueJob(objToSend, {
                    isBatch: false,
                    queueName: 'updateUsage-sequential'
                });
            }
        } catch (error) {
            console.log("Error updateUsage afterDelete: ", error);
            Sentry.captureException(error);
        }
    } catch (error) {
        console.error('Critical error in websites afterDelete: ', error);
        Sentry.captureException(error);
    }
})

/**
 * Deleting an account has to delete the account's data — App Review 5.1.1(v) is
 * about the data, not the row — and most of that data is not in Parse: the API
 * keys are in Redis, the search documents in Meilisearch, the files in MinIO,
 * the subscription at Stripe. So the backend does it, and this waits for it.
 *
 * Waiting is the point. If the cascade fails, this throws and the user row
 * survives, which is a visible, retryable failure instead of an account whose
 * bookmarks outlive it.
 *
 * What used to be here deleted four classes with unlimited `find()` calls that
 * silently stop at 100 rows, queried `Parse.Query(Parse.File)` — not a class,
 * so no file was ever deleted — and knew nothing about boards, RSS, tags,
 * feedback or the API keys.
 */
Parse.Cloud.beforeDelete(Parse.User, async (request) => {
    const user = request.object;
    const backendUrl = backendUrlFromEnv();

    const response = await fetch(`${backendUrl}v1/triggers/users/beforeDelete`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `${process.env.CUSTOM_API_KEY}`
        },
        body: JSON.stringify({ userId: user.id, email: user.get('email') })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const message = `Could not delete this account's data (${response.status}). Nothing was deleted; please try again.`;
        console.error('[beforeDelete _User]', message, detail);
        Sentry.captureException(new Error(`${message} ${detail}`));
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED, message);
    }

    console.log('[beforeDelete _User] Data erased for', user.id, await response.text().catch(() => ''));
});

Parse.Cloud.job("updateAnalytics", async (request) => {
    const Analytics = Parse.Object.extend('analytics');

    try {
        const {
            userId,
            date,
            userDeleted
        } = request.params;

        const today = date != undefined ? new Date(date) : new Date();
        today.setHours(0, 0, 0, 0);

        let analytics;

        const analyticsQuery = new Parse.Query(Analytics);
        analyticsQuery.equalTo('date', today);
        const existingAnalytics = await Promise.race([
            analyticsQuery.first({useMasterKey: true}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);

        let users;
        let usersDeletedToday = userDeleted != undefined ? userDeleted : 0;
        let usersDeletedTotal = 0;
        let totalCost = 0;
        let costToday = 0;
        let tokensToday = 0;
        let totalTokens = 0;
        let averageTokensToday = 0;
        let totalAverageTokens = 0;
        let websitesWithTokenUsageCount = 0;
        let averageCostPerWebsite = 0;
        let noOfUsersCreatedToday = 0;
        let userWithTokenUsageCount = 0;
        let uniqueUserSessionsToday = [];

        if (existingAnalytics) {
            analytics = existingAnalytics;
            usersDeletedToday = analytics.get('usersDeletedToday') != undefined ? analytics.get('usersDeletedToday') + 1 : usersDeletedToday;
        } else {
            analytics = new Parse.Object('analytics');
        }

        if (userId != null) {
            users = [await Promise.race([
                fetchSingleUser(userId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
            ])];
        } else {
            users = await Promise.race([
                fetchAllUsers(9000),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
            ]);
        }

        for (const user of users) {
            const tokenUsage = user.get('tokenUsage');
            const userCreatedAt = user.get('createdAt');
            if (tokenUsage) {
                userWithTokenUsageCount++;
                totalCost += tokenUsage.costs.total_cost;
                totalTokens += tokenUsage.usage.total_tokens;
            };

            if (userCreatedAt >= today) {
                noOfUsersCreatedToday++;
            }
        }

        // Set the usersDeletedTotal
        const lastAnalyticsQuery = new Parse.Query(Analytics);
        lastAnalyticsQuery.descending('createdAt');
        const lastAnalytics = await lastAnalyticsQuery.first({
            useMasterKey: true
        });
        if (lastAnalytics) {
            usersDeletedTotal = lastAnalytics.get('usersDeletedTotal') != undefined ? lastAnalytics.get('usersDeletedTotal') : usersDeletedTotal;
        }

        const websitesQuery = new Parse.Query(Websites);
        websitesQuery.exists('tokenUsage');
        websitesWithTokenUsageCount = await Promise.race([
            websitesQuery.count({useMasterKey: true}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);
        averageCostPerWebsite = totalCost / websitesWithTokenUsageCount;

        const totalWebsitesQuery = new Parse.Query(Websites);
        const totalWebsitesCount = await Promise.race([
            totalWebsitesQuery.count({useMasterKey: true}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);

        const websitesCreatedTodayQuery = new Parse.Query(Websites);
        websitesCreatedTodayQuery.greaterThanOrEqualTo('createdAt', today);
        websitesCreatedTodayQuery.limit(99999)
        const websitesCreatedToday = await Promise.race([
            websitesCreatedTodayQuery.find({useMasterKey: true}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);

        for (const site of websitesCreatedToday) {
            const tokenUsage = site.get('tokenUsage');
            if (tokenUsage) {
                costToday += tokenUsage.totalTokens.costs.total_cost;
                tokensToday += tokenUsage.totalTokens.usage.total_tokens;
            };
        }

        averageTokensToday = Number(Number(tokensToday) / Number(websitesCreatedToday.length));
        totalAverageTokens = Number(Number(totalTokens) / Number(websitesWithTokenUsageCount));
        averageTokensToday = typeof averageTokensToday == 'number' ? averageTokensToday.toFixed() : averageTokensToday;
        totalAverageTokens = typeof totalAverageTokens == 'number' ? totalAverageTokens.toFixed() : totalAverageTokens;

        const sessionsQuery = new Parse.Query(Parse.Session);
        sessionsQuery.greaterThanOrEqualTo('createdAt', today);
        const sessionsToday = await sessionsQuery.find({
            useMasterKey: true
        });

        for (const session of sessionsToday) {
            const userId = session.get('user') ? session.get('user').id : null;
            if (userId && !uniqueUserSessionsToday.includes(userId)) {
                uniqueUserSessionsToday.push(userId);
            }
        }

        analytics.set('totalNoOfWebsitesWithTokenUsageCount', websitesWithTokenUsageCount);
        analytics.set('noOfWebsites', websitesCreatedToday.length);
        analytics.set('totalNoOfWebsites', totalWebsitesCount);
        analytics.set('averageCost', costToday / websitesCreatedToday.length);
        analytics.set('totalAverageCost', averageCostPerWebsite);
        analytics.set('cost', costToday);
        analytics.set('totalCost', totalCost);
        analytics.set('tokensToday', tokensToday);
        analytics.set('averageTokensToday', Number(averageTokensToday));
        analytics.set('totalAverageTokens', Number(totalAverageTokens));
        analytics.set('totalTokens', totalTokens);
        analytics.set('uniqueActiveUsers', uniqueUserSessionsToday);
        analytics.set('noOfUsersCreatedToday', noOfUsersCreatedToday);
        analytics.set('totalNoOfUsers', users.length);
        analytics.set('usersDeletedToday', usersDeletedToday);
        analytics.set('usersDeletedTotal', usersDeletedTotal);
        analytics.set('date', today);
        await analytics.save(null, {
            useMasterKey: true
        });

        console.log("analytics: ", analytics);

        return analytics;
    } catch (error) {
        console.log("error in analytics: ", error);
        Sentry.captureException(error);
        throw error;
    }
})

async function afterSaveWebsites(request) {
    const savedWebsite = request.object;
    let savedWebsiteId;
    
    try {
        const isNewWebsite = request.original === undefined;
        const user = savedWebsite.get('user');

        if (!Boolean(user)) {
            console.log('[afterSave] No user found for website:', savedWebsite.id);
            return { success: true };
        }

        savedWebsiteId = savedWebsite.id;

        // Call the Nitro endpoint asynchronously without waiting
        const backendUrl = backendUrlFromEnv();
        const endpoint = `${backendUrl}v1/triggers/websites/afterSave`;

        // Work out which keys actually changed so the backend can skip
        // re-indexing to Meilisearch when nothing search-relevant
        // changed (the save pipeline writes the same object many times).
        // Left undefined when we can't tell — the backend then indexes as before.
        let changedKeys;
        try {
            if (!isNewWebsite && request.original) {
                const before = request.original.toJSON();
                const after = savedWebsite.toJSON();
                const ignoredKeys = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL']);
                changedKeys = [];
                for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
                    if (ignoredKeys.has(key)) continue;
                    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changedKeys.push(key);
                }
            }
        } catch (diffError) {
            console.error('[afterSave] Error computing changedKeys:', diffError);
            changedKeys = undefined;
        }

        const payload = {
            websiteId: savedWebsite.id,
            userId: user.id,
            isNewWebsite: isNewWebsite,
            changedKeys
        };

        // Fire and forget - don't await
        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${process.env.CUSTOM_API_KEY}`
            },
            body: JSON.stringify(payload)
        }).catch(error => {
            console.error('[afterSave] Error calling afterSave endpoint:', JSON.stringify(error), 'savedWebsiteId:', savedWebsiteId );
            Sentry.captureException(error);
        });
    } catch (error) {
        console.error('Critical error in websites afterSave:', error);
        throw error
    }
}

async function beforeSaveWebsites(request){
    try {
        const savedWebsite = request.object;
        const isNewWebsite = request.original === undefined;

        // Only handle operations that MUST happen before save
        // isNewWebsite && savedWebsite.get("type") === "image"
        //     ? enqueueJob({
        //         type: 'image-tags-requests',
        //         data: { websiteId: savedWebsite.id, userId: user.id }
        //     }, { isBatch: false, queueName: 'getBookmarkContent' })
        //     : null   

        if(isNewWebsite) await setSiteTitle(savedWebsite)
        syncCoverImage(savedWebsite)
    } catch (error) {
        // Do not rethrow: failing to default the title should never block a save.
        console.error('Error in websites beforeSave:', error);
        Sentry.captureException(error);
    }
}

/**
 * Multi-image bookmarks: OGImage always mirrors images[0].
 *
 * That invariant is what lets every existing reader — the grid card, the boards
 * endpoints, the trash listing, colour extraction — keep reading OGImage and
 * know nothing about the array. Enforcing it here rather than in each client is
 * why reordering a carousel needs no endpoint at all: web, the native app and
 * the extension just write `images` through the Parse write path they already
 * use, and the cover follows.
 *
 * Also keeps bookmark-level `tags` as the union of the group's tags and every
 * per-image tag, so tag filtering and the Meilisearch facets keep working.
 */
function syncCoverImage(website) {
    // Costs nothing on the many saves that never touch images.
    if (!website.dirty('images')) return;

    const images = website.get('images');
    if (!Array.isArray(images) || images.length === 0) return;

    const cover = images[0];
    if (cover && typeof cover.url === 'string' && cover.url.length > 0) {
        website.set('OGImage', cover.url);
    }

    const tags = new Set(Array.isArray(website.get('tags')) ? website.get('tags') : []);
    for (const image of images) {
        for (const tag of Array.isArray(image?.tags) ? image.tags : []) {
            if (typeof tag === 'string' && tag) tags.add(tag);
        }
    }
    website.set('tags', [...tags]);
}

async function setSiteTitle(website) {
    // Don't run if not a website or if siteTitle already exists
    if (website.get("type") !== "website" ||
        (website.get("siteTitle") && website.get("siteTitle").trim().length > 0)) {
        return;
    }

    try {
        // NOTE: the field is "metaData" (capital D) and the image field is
        // "OGImage" — the previous lowercase keys never matched anything.
        const metadata = website.get("metaData");
        if (metadata?.title) {
            website.set("siteTitle", metadata.title);
            if (metadata.image && !website.get("OGImage")) website.set("OGImage", metadata.image);
            return;
        }

        let baseUrl = website.get("baseUrl");
        
        // Validate baseUrl before processing
        if (!baseUrl || typeof baseUrl !== 'string' || baseUrl.trim() === '') {
            console.log(`Invalid or missing baseUrl for website: ${website.id}`);
            return;
        }

        // Clean and set the site title from baseUrl
        const cleanedTitle = baseUrl
            .replace(/(^\w+:|^)\/\//, '') // Remove protocol
            .replace(/^www\./, '') // Remove www prefix
            .trim();
            
        if (cleanedTitle) {
            website.set("siteTitle", cleanedTitle);
        }
    } catch (error) {
        console.log(`Error setting siteTitle: ${error}`);
        Sentry.captureException(error);
    }
}

async function fetchSingleUser(userId) {
    try {
        const query = new Parse.Query(Users);
        query.equalTo("objectId", userId);
        query.include("websiteUrls");
        const user = await query.first({
            useMasterKey: true
        });
        if (!user) return {
            error: "User not found"
        }
        return user;
    } catch (error) {
        console.error("Error fetching user: ", error);
        Sentry.captureException(error);
        return {
            error
        }
    }
}

async function fetchAllUsers(limit = 20) {
    try {
        const query = new Parse.Query(Users);
        query.include("websiteUrls");
        query.limit(limit);
        const users = await query.find({
            useMasterKey: true
        });
        if (!users) return {
            error: "Users not found"
        }
        return users
    } catch (error) {
        console.error("Error fetching users: ", error);
        Sentry.captureException(error);
        return {
            error
        }
    }
}

function removeHtmlTags(htmlString, stringLimit = 1000) {
    if (htmlString == undefined || htmlString == null) return '';

    try {
        // Remove content within <script> and </head> tags
        let cleanedString = htmlString.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
        cleanedString = cleanedString.replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, '');

        // Remove all remaining HTML tags
        cleanedString = cleanedString.replace(/<\/?[^>]+(>|$)/g, '');
        cleanedString = cleanedString.replace(/\\n/g, '');
        cleanedString = cleanedString.replace(/\s\s+/g, ' ');
        cleanedString = cleanedString.replaceAll('&nbsp', '');
        if (stringLimit != 0) cleanedString = cleanedString.substring(0, stringLimit);

        return cleanedString;
    } catch (error) {
        console.error('Error removing html', error);
        return htmlString
    }
}

function getObjectSize(object, returnObj = false) {
    try {
        if (typeof object !== 'object') return 0
        let size = {
            totalSize: 0
        };

        for (const [key, value] of Object.entries(object)) {
            const sizeInBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
            const sizeInKilobytes = sizeInBytes / 1024;
            size[key] = sizeInKilobytes.toFixed(2);
            size.totalSize = Number(size.totalSize) + Number(sizeInKilobytes.toFixed(2));
        }

        return size
    } catch (error) {
        return {}
    } finally {
        size = null
    }
}

/**
 * Hand a job to the backend's queue (POST /v1/jobs/enqueue, internal key).
 *
 * The backend decides where it goes: QStash on WebBites.io, Redis when
 * self-hosted. This used to publish to QStash directly, which tied Parse to an
 * Upstash account.
 */
async function enqueueJob(message, {
    isBatch = false,
    queueName = null
} = {}) {
    try {
        const backendUrl = backendUrlFromEnv();
        const response = await fetch(`${backendUrl}v1/jobs/enqueue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': AUTH_HEADER
            },
            body: JSON.stringify({ message, isBatch, queueName }),
            timeout: 15000
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`enqueue failed (${response.status}) ${detail}`.trim());
        }
        return await response.json();
    } catch (error) {
        console.log('Error enqueueing job: ', {
            message,
            isBatch,
            queueName
        })
        Sentry.captureException(error);
        throw error;
    }
}
