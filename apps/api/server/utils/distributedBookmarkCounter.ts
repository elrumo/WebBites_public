import { getRedisClient, ensureRedisConnected, isRedisAvailable } from './redis.js';
import { captureException } from '#root/server/utils/sentry.js';
import { currentUsageMonth } from './plans';

const PENDING_KEY_PREFIX = 'bookmark:pending:';
const LOCK_KEY_PREFIX = 'bookmark:lock:';
const LOCK_TTL = 30; // seconds
const DEBOUNCE_MS = 1000; // milliseconds
const FLUSH_THRESHOLD = 5;

interface PendingUpdate {
    delta: number;
    count: number;
    userId: string;
    createdAt: string; // ISO string
    lastUpdate: number; // timestamp
}

/**
 * Helper functions
 */
async function getOrCreateUsageStats(user: any, monthStr: string) {
    try {
        const Parse = (await import('parse/node.js')).default;
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
        console.log('[getOrCreateUsageStats] Created new stats:', stats);
        return stats;
    } catch (error) {
        console.error('[getOrCreateUsageStats] Error:', error);
        throw error;
    }
}

/** Re-exported under the local name so the format lives in one file. */
const getCurrentMonthString = currentUsageMonth;

/**
 * Acquire a distributed lock for flushing a user's updates
 */
async function acquireLock(userId: string): Promise<boolean> {
    try {
        const redis = getRedisClient();
        const lockKey = `${LOCK_KEY_PREFIX}${userId}`;

        // SET NX (only set if not exists) with expiration
        const result = await redis.set(lockKey, Date.now().toString(), {
            NX: true, // Only set if not exists
            EX: LOCK_TTL // Expire after LOCK_TTL seconds
        });

        return result === 'OK';
    } catch (error) {
        console.error('[acquireLock] Error:', error);
        return false;
    }
}

/**
 * Release the distributed lock
 */
async function releaseLock(userId: string): Promise<void> {
    try {
        const redis = getRedisClient();
        const lockKey = `${LOCK_KEY_PREFIX}${userId}`;
        await redis.del(lockKey);
    } catch (error) {
        console.error('[releaseLock] Error:', error);
    }
}

async function requeuePendingUpdate(userId: string, pending: PendingUpdate): Promise<void> {
    try {
        const redis = getRedisClient();
        const key = `${PENDING_KEY_PREFIX}${userId}`;
        const existingStr = await redis.get(key);
        const now = Date.now();

        if (!existingStr) {
            const toStore: PendingUpdate = {
                ...pending,
                count: Math.max(1, pending.count),
                lastUpdate: now
            };
            await redis.setEx(key, 300, JSON.stringify(toStore));
            setImmediate(() => {
                scheduleFlushInternal(userId).catch((error: any) => {
                    console.error('[requeuePendingUpdate] Schedule flush error:', error);
                });
            });
            return;
        }

        const existing = JSON.parse(existingStr.toString()) as PendingUpdate;
        const merged: PendingUpdate = {
            delta: existing.delta + pending.delta,
            count: existing.count + Math.max(1, pending.count),
            userId,
            createdAt: existing.createdAt || pending.createdAt || new Date().toISOString(),
            lastUpdate: now
        };

        await redis.setEx(key, 300, JSON.stringify(merged));
        setImmediate(() => {
            scheduleFlushInternal(userId).catch((error: any) => {
                console.error('[requeuePendingUpdate] Schedule flush error:', error);
            });
        });
    } catch (requeueError) {
        console.error('[requeuePendingUpdate] Failed to requeue pending update:', requeueError);
        captureException(requeueError);
    }
}

/**
 * Flush a user's pending bookmark updates to the database
 */
export async function flushUserUpdate(userId: string): Promise<void> {
    // Try to acquire lock
    const gotLock = await acquireLock(userId);
    if (!gotLock) {
        console.log(`[flushUserUpdate] Another instance is already flushing user ${userId}`);
        return;
    }

    let key = '';
    let pending: PendingUpdate | null = null;

    try {
        const redis = getRedisClient();
        key = `${PENDING_KEY_PREFIX}${userId}`;

        // Get and delete the pending update atomically
        const existingStr = await redis.get(key);
        if (!existingStr) {
            console.log(`[flushUserUpdate] No pending updates for user ${userId}`);
            return;
        }

        // Delete immediately to prevent double-processing
        await redis.del(key);

        pending = JSON.parse(existingStr.toString()) as PendingUpdate;

        console.log(`[flushUserUpdate] Flushing ${pending.delta} bookmarks for user ${userId}`);

        // Import Parse here to avoid circular dependencies
        const Parse = (await import('parse/node.js')).default;

        // Refetch user to ensure we have the latest usage data
        const userQuery = new Parse.Query(Parse.User);
        let user: any;

        try {
            user = await userQuery.get(userId, { useMasterKey: true });
        } catch (error: any) {
            console.error(`[flushUserUpdate] User ${userId} not found:`, error.message);
            return;
        }

        // Use atomic increment for bookmarksTotal
        user.increment('bookmarksTotal', pending.delta);

        const createdAt = new Date(pending.createdAt);
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
            const isFirstTimeInit = !usage.currentMonth;
            const previousTotal = isFirstTimeInit ? 0 : (usage.currentMonth?.bookmarksTotal || 0);

            if (usage.currentMonth && usage.currentMonth.month) {
                usage.pastMonths = usage.pastMonths || [];
                usage.pastMonths.push(usage.currentMonth);
            }

            usage.currentMonth = {
                month: currentMonthStr,
                bookmarksTotal: previousTotal,
                bookmarksThisMonth: 0,
                filesUploaded: usage.currentMonth?.filesUploaded || 0,
                audiosGenerated: usage.currentMonth?.audiosGenerated || 0
            };
        }

        usage.currentMonth.bookmarksTotal = (usage.currentMonth.bookmarksTotal || 0) + pending.delta;
        usage.currentMonth.bookmarksThisMonth = (usage.currentMonth.bookmarksThisMonth || 0) + pending.delta;
        user.set('usage', usage);

        // Save with retry logic
        let saveAttempts = 0;
        const maxAttempts = 3;

        console.log(`[flushUserUpdate] Initial bookmarksTotal: ${usage.currentMonth.bookmarksTotal}`);

        while (saveAttempts < maxAttempts) {
            try {
                await user.save(null, { useMasterKey: true });
                console.log(`[flushUserUpdate] Successfully updated counters for user ${userId} (delta: ${pending.delta})`);
                break;
            } catch (saveError: any) {
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
        captureException(error);
        if (pending && key) {
            await requeuePendingUpdate(userId, pending);
        }

    } finally {
        await releaseLock(userId);
    }
}

/**
 * Internal function to schedule a delayed flush for a user
 * This should only be called once when count === 1
 */
async function scheduleFlushInternal(userId: string): Promise<void> {
    try {
        console.log(`[scheduleFlushInternal] Starting delayed flush timer for user ${userId}, waiting ${DEBOUNCE_MS}ms`);

        // Wait for the full debounce period
        await new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS));

        console.log(`[scheduleFlushInternal] Timer expired for user ${userId}, checking if flush is needed`);

        // After waiting, check if we should still flush
        const redis = getRedisClient();
        const key = `${PENDING_KEY_PREFIX}${userId}`;
        const existingStr = await redis.get(key);

        if (!existingStr) {
            // Already flushed by another instance or threshold reached
            console.log(`[scheduleFlushInternal] User ${userId} already flushed (key not found)`);
            return;
        }

        const pending: PendingUpdate = JSON.parse(existingStr.toString());
        const timeSinceLastUpdate = Date.now() - pending.lastUpdate;

        console.log(`[scheduleFlushInternal] User ${userId} - timeSinceLastUpdate: ${timeSinceLastUpdate}ms, DEBOUNCE_MS: ${DEBOUNCE_MS}ms, count: ${pending.count}, delta: ${pending.delta}`);

        // Only flush if it's been at least DEBOUNCE_MS since last update
        if (timeSinceLastUpdate >= DEBOUNCE_MS) {
            console.log(`[scheduleFlushInternal] Flushing user ${userId} after debounce (timeSinceLastUpdate: ${timeSinceLastUpdate}ms >= ${DEBOUNCE_MS}ms)`);
            await flushUserUpdate(userId);
        } else {
            // Another update came in recently, reschedule the flush
            const remainingTime = DEBOUNCE_MS - timeSinceLastUpdate;
            console.log(`[scheduleFlushInternal] User ${userId} has recent update, rescheduling flush in ${remainingTime}ms (timeSinceLastUpdate: ${timeSinceLastUpdate}ms < ${DEBOUNCE_MS}ms)`);

            // Wait for the remaining time and try again
            await new Promise(resolve => setTimeout(resolve, remainingTime));

            // Recursively call to check again
            await scheduleFlushInternal(userId);
        }

    } catch (error) {
        console.error('[scheduleFlushInternal] Error:', error);
    }
}

/**
 * Export for backward compatibility (though shouldn't be called externally now)
 */
export async function scheduleFlush(userId: string): Promise<void> {
    return scheduleFlushInternal(userId);
}

/**
 * Set the total number of websites for a user
 * This directly sets the bookmarksTotal field without using increments
 */
export async function setUserWebsiteCount(
    total: number,
    userId: string
): Promise<void> {
    try {
        // Import Parse here to avoid circular dependencies
        const Parse = (await import('parse/node.js')).default;

        // Fetch the user
        const userQuery = new Parse.Query(Parse.User);
        let user: any;

        try {
            user = await userQuery.get(userId, { useMasterKey: true });
        } catch (error: any) {
            console.error(`[setUserWebsiteCount] User ${userId} not found:`, error.message);
            throw error;
        }

        // Set the bookmarksTotal to the specified value
        user.set('bookmarksTotal', total);

        // Update the usage column with current month data
        const currentMonthStr = getCurrentMonthString();
        let usage = user.get('usage') || { currentMonth: {}, pastMonths: [] };

        // Initialize currentMonth if it doesn't exist or if it's a different month
        if (!usage.currentMonth || usage.currentMonth.month !== currentMonthStr) {
            if (usage.currentMonth && usage.currentMonth.month) {
                usage.pastMonths = usage.pastMonths || [];
                usage.pastMonths.push(usage.currentMonth);
            }

            usage.currentMonth = {
                month: currentMonthStr,
                bookmarksTotal: total,
                bookmarksThisMonth: 0,
                filesUploaded: usage.currentMonth?.filesUploaded || 0,
                audiosGenerated: usage.currentMonth?.audiosGenerated || 0
            };
        } else {
            // Update the current month's total
            usage.currentMonth.bookmarksTotal = total;
        }

        user.set('usage', usage);

        // Save the user
        await user.save(null, { useMasterKey: true });
        console.log(`[setUserWebsiteCount] Successfully set bookmarksTotal to ${total} for user ${userId}`);

    } catch (error) {
        console.error('[setUserWebsiteCount] Error:', error);
        captureException(error);
        throw error;
    }
}

/**
 * Increment the pending bookmark counter for a user in Redis
 * Uses Lua script for atomic increment operation
 */
export async function incrementPendingBookmarkCount(
    userId: string,
    delta: number,
    createdAt: Date
): Promise<void> {
    try {
        if (!isRedisAvailable()) {
            await ensureRedisConnected();
        }

        const redis = getRedisClient();
        const key = `${PENDING_KEY_PREFIX}${userId}`;

        // Lua script for atomic increment
        // Returns the updated pending object as JSON string
        const luaScript = `
            local key = KEYS[1]
            local delta = tonumber(ARGV[1])
            local createdAt = ARGV[2]
            local now = tonumber(ARGV[3])
            local userId = ARGV[4]
            local ttl = tonumber(ARGV[5])

            local existing = redis.call('GET', key)
            local pending

            if existing then
                pending = cjson.decode(existing)
                pending.delta = pending.delta + delta
                pending.count = pending.count + 1
                pending.lastUpdate = now
            else
                pending = {
                    delta = delta,
                    count = 1,
                    userId = userId,
                    createdAt = createdAt,
                    lastUpdate = now
                }
            end

            local pendingJson = cjson.encode(pending)
            redis.call('SETEX', key, ttl, pendingJson)
            return pendingJson
        `;

        // Execute Lua script atomically
        const result = await redis.eval(luaScript, {
            keys: [key],
            arguments: [
                delta.toString(),
                createdAt.toISOString(),
                Date.now().toString(),
                userId,
                '300' // 5 min TTL
            ]
        }) as string;

        const pending: PendingUpdate = JSON.parse(result);

        console.log(`[distributedBookmarkCounter] pending count for user ${userId}: ${pending.count}, delta: ${pending.delta}`);

        // Check if we should force flush (only if threshold reached)
        if (pending.count >= FLUSH_THRESHOLD) {
            console.log(`[distributedBookmarkCounter] Force flush for user ${userId} (count: ${pending.count})`);
            // Don't await - let it run async
            setImmediate(() => {
                flushUserUpdate(userId).catch((error: any) => {
                    console.error('[distributedBookmarkCounter] Force flush error:', error);
                });
            });
        } else if (pending.count === 1) {
            // Only schedule a timer if this is the FIRST update (count === 1)
            // This prevents multiple timers from being created across instances
            console.log(`[distributedBookmarkCounter] Scheduling delayed flush for user ${userId} in ${DEBOUNCE_MS}ms`);
            setImmediate(() => {
                scheduleFlushInternal(userId).catch((error: any) => {
                    console.error('[distributedBookmarkCounter] Schedule flush error:', error);
                });
            });
        } else {
            console.log(`[distributedBookmarkCounter] Count is ${pending.count} for user ${userId}, waiting for threshold (${FLUSH_THRESHOLD}) or timer from count=1`);
        }
        // For count > 1 and < FLUSH_THRESHOLD: the existing timer from count === 1 will handle it

    } catch (error) {
        console.error('[incrementPendingBookmarkCount] Redis error:', error);
        captureException(error);
        throw error;
    }
}
