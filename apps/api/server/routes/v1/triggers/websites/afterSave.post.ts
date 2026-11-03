import { captureException } from '#root/server/utils/sentry.js';
import { defineEventHandler, readBody, createError, H3Event } from 'h3';
import Parse from 'parse/node.js';
import { saveToSearchIndex as runSaveToSearchIndex } from '#root/server/utils/jobs/processJob.js';
import { incrementPendingBookmarkCount } from '#root/server/utils/distributedBookmarkCounter';
import { dispatchWebhooks } from '#root/server/utils/webhooks';
import { serializeBookmark } from '#root/server/utils/publicApi';
import { getRedisClient, ensureRedisConnected, isRedisAvailable } from '#root/server/utils/redis';

/**
 * How long re-index writes for one row are batched. The enrichment stages
 * (content, screenshot, summary, tags) each save the row within seconds of
 * each other; one write after the burst carries all of them.
 */
const INDEX_COALESCE_MS = 8000;

/**
 * Re-index later, once per burst of saves. The claim key is released right
 * before the delayed write re-reads the row, so a save arriving after that
 * starts a new window instead of being lost.
 * Falls back to an immediate write when Redis is unavailable.
 * ponytail: per-instance timer — a crash inside the window drops one re-index
 * until the row's next save. Move to a QStash delayed message if that matters.
 */
async function scheduleCoalescedIndex(websiteId: string): Promise<void> {
    const key = `idx:pending:${websiteId}`;
    let claimed: boolean | null = null;
    try {
        if (!isRedisAvailable()) await ensureRedisConnected();
        claimed = (await getRedisClient().set(key, '1', { NX: true, EX: Math.ceil(INDEX_COALESCE_MS / 1000) + 2 })) === 'OK';
    } catch {
        claimed = null;
    }

    if (claimed === false) return; // an earlier save owns this window

    if (claimed === null) {
        await runSaveToSearchIndex({ websiteId });
        return;
    }

    setTimeout(() => {
        getRedisClient().del(key).catch(() => {})
            .then(() => runSaveToSearchIndex({ websiteId }))
            .catch((error) => {
                console.error('[afterSave] Coalesced search index write failed:', error);
                captureException(error);
            });
    }, INDEX_COALESCE_MS);
}

// Define OpenAPI documentation for this route
defineRouteMeta({
    openAPI: {
        tags: ['Triggers'],
        description: 'Handle afterSave operations for websites',
        requestBody: {
            description: 'Website afterSave data',
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            websiteId: {
                                type: 'string',
                                description: 'Parse object ID of the website'
                            },
                            userId: {
                                type: 'string',
                                description: 'Parse object ID of the user'
                            },
                            isNewWebsite: {
                                type: 'boolean',
                                description: 'Whether this is a new website'
                            }
                        },
                        required: ['websiteId', 'userId', 'isNewWebsite']
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'Successfully triggered afterSave operations',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' }
                            }
                        }
                    }
                }
            },
            400: {
                description: 'Bad request - missing required parameters'
            },
            500: {
                description: 'Internal server error'
            }
        }
    }
});

// Use distributed Redis-based counter instead of in-memory maps
async function incrementBookmarkCountersForEvent(user: Parse.User, savedWebsite: Parse.Object, delta: number): Promise<boolean> {
    const userId = user.id;

    console.log('[incrementBookmarkCountersForEvent] userId:', userId);

    // Validate userId
    if (!userId) {
        console.error('[incrementBookmarkCountersForEvent] Invalid userId:', userId);
        return false;
    }

    try {
        const createdAt = savedWebsite.get('createdAt') || new Date();

        // Increment the pending count in Redis (works across all instances)
        // scheduleFlush is handled internally by incrementPendingBookmarkCount
        await incrementPendingBookmarkCount(userId, delta, createdAt);
        return true;

    } catch (error) {
        console.error('[incrementBookmarkCountersForEvent] Error:', error);
        captureException(error);
        return false;
    }
}


async function saveToSearchIndex(savedSite: Parse.Object) {
    try {
        await runSaveToSearchIndex({ websiteId: savedSite.id });
    } catch (error) {
        console.log("Error sending to QStash for search index save:", error);
        captureException(error);
        throw error;
    }
}

async function ensureSavedSitesRelation(user: Parse.User, savedWebsite: Parse.Object): Promise<boolean> {
    const userRelation = user.relation('savedSites');
    const relationQuery = userRelation.query();
    relationQuery.equalTo('objectId', savedWebsite.id);
    const existingRelation = await relationQuery.first({ useMasterKey: true });

    if (existingRelation) {
        return false;
    }

    userRelation.add(savedWebsite);
    await user.save(null, { useMasterKey: true });
    return true;
}

// Fields that feed the Algolia/Meilisearch documents (see
// meilisearchDocumentMapper.ts / buildAlgoliaWebsite). Saves that touch none of
// these don't need a re-index.
const SEARCH_RELEVANT_KEYS = new Set([
    'url', 'baseUrl', 'siteTitle', 'siteDescription', 'siteBody', 'siteAuthor',
    'sitePublisher', 'siteDate', 'siteLogo', 'OGImage', 'OGImageFile', 'tags',
    'siteColors', 'screenshotAnnotations', 'favorited', 'pinned', 'type',
    'subType', 'mediaTypeObject', 'textNote', 'siteNotes', 'aiSummary', 'metaData',
    'siteScreenshot', 'fullPageScreenshot', 'user',
    // The trash flag lives in the search document too, so a row that is
    // soft-deleted or restored anywhere but the bookmarks routes still gets
    // the index told about it.
    'isDeleted', 'deletedAt',
    // A reorder or a merge may change nothing but this array (the cover can
    // stay put), and the grid reads Meilisearch — so without it here the card
    // silently keeps the old thumbnail and image count.
    'images',
    // The placeholder -> metadata transition of a save. A device-enriched row
    // already had its fields on the first save, so this can be the only key
    // that changes — and it is what releases the bookmark.saved webhook.
    'saveStage',
    // An audio bite's card is drawn from these: the waveform, the length, and
    // whether its transcript has landed. The transcript text itself arrives as
    // `siteBody`, which is already above.
    'fileUrl', 'audioDuration', 'audioPeaks', 'transcriptStatus',
    // An app bookmark's card: store, rating, category and price.
    'appCard'
]);

async function afterSaveWebsites(websiteId: string, userId: string, isNewWebsite: boolean, changedKeys?: string[]) {
    try {
        // Handle search indexing with dirty-key detection. The save pipeline
        // (metadata, screenshots, AI summary, bookmarkCounted flag, ...) saves the
        // same website many times; re-indexing on every save caused 8-12 full
        // Algolia + Meilisearch writes per bookmark. When the cloud trigger tells
        // us which keys changed, only re-index if a search-relevant key changed.
        // If changedKeys is absent (older cloud code), keep the previous
        // always-index behaviour.
        const shouldUpdateSearchIndex = isNewWebsite
            || !Array.isArray(changedKeys)
            || changedKeys.some((key) => SEARCH_RELEVANT_KEYS.has(key));

        // Nothing to do for an update that touched no search-relevant field —
        // skip the website/user fetches entirely.
        if (!isNewWebsite && !shouldUpdateSearchIndex) {
            return;
        }

        // Fetch the website and user objects
        let savedWebsite: Parse.Object | null = null;
        let websiteQuery: Parse.Query<Parse.Object> | null = null;
        let user: Parse.User | null = null;

        try{
            websiteQuery = new Parse.Query('websites');
            [savedWebsite, user] = await Promise.all([
                websiteQuery.get(websiteId, { useMasterKey: true }),
                new Parse.Query(Parse.User).get(userId, { useMasterKey: true })
            ]);

            if (!Boolean(savedWebsite)) {
                console.log('[afterSave] Website not found:', websiteId);
                return;
            }

            if (!Boolean(user)) {
                console.log('[afterSave] No user found for website:', savedWebsite.id);
                return;
            }
        } catch (error) {
            console.log('');
            console.log('--------');
            console.log('[afterSave] Processing website:', websiteId, 'for user:', userId);
            console.error('[afterSave] Error fetching website or user:', error);
            console.log('--------');
            console.log('');
            captureException(error);
            return;
        }

        if (!savedWebsite || !user) {
            return;
        }

        // Developer webhooks: fire-and-forget, never on the save's critical path.
        // saveBookmark creates a placeholder row (saveStage 'created') and fills
        // it in on a second save ('metadata'); firing on the placeholder sent a
        // payload with no title or image. Rows other routes create in one go
        // (notes, drawings, images, batch saves) carry no stage and fire at once.
        const saveStage = savedWebsite.get('saveStage');
        const webhookReady = isNewWebsite
            ? saveStage !== 'created'
            : saveStage === 'metadata' && Array.isArray(changedKeys) && changedKeys.includes('saveStage');
        if (webhookReady) {
            void dispatchWebhooks(userId, 'bookmark.saved', serializeBookmark(savedWebsite));
        }

        if (isNewWebsite) {
            try {
                const relationAdded = await ensureSavedSitesRelation(user, savedWebsite);
                const alreadyCounted = savedWebsite.get('bookmarkCounted') === true;

                if (!alreadyCounted) {
                    console.log('[afterSave] Incrementing bookmark:', savedWebsite.id);
                    const incremented = await incrementBookmarkCountersForEvent(user, savedWebsite, 1);
                    if (incremented) {
                        // Mark the website as counted to make retries idempotent.
                        savedWebsite.set('bookmarkCounted', true);
                        await savedWebsite.save(null, { useMasterKey: true });
                    } else {
                        // Explicitly mark as uncounted so deletes don't decrement a counter that never incremented.
                        savedWebsite.set('bookmarkCounted', false);
                        await savedWebsite.save(null, { useMasterKey: true });
                        console.error('[afterSave] Bookmark counter increment failed; leaving bookmarkCounted=false for retry/reconciliation:', savedWebsite.id);
                    }
                } else if (relationAdded) {
                    console.log('[afterSave] Relation was missing and restored; counter already marked as counted:', savedWebsite.id);
                } else {
                    console.log('[afterSave] Bookmark already counted and related:', savedWebsite.id);
                }
            } catch (error) {
                console.error('[afterSave] Error syncing relation/counter:', error);
                captureException(error);
            }
        }

        console.log('[afterSave] shouldUpdateSearchIndex:', shouldUpdateSearchIndex);
        if (shouldUpdateSearchIndex) {
            try {
                // The card must appear at once (new row) and get its title as soon
                // as the metadata save lands; every later enrichment save is batched.
                const indexNow = isNewWebsite || (Array.isArray(changedKeys) && changedKeys.includes('saveStage'));
                if (indexNow) {
                    await saveToSearchIndex(savedWebsite);
                } else {
                    await scheduleCoalescedIndex(savedWebsite.id);
                }
            } catch (error) {
                console.error("Error saving to search index:", error);
                captureException(error);
            }
        }
    } catch (error) {
        console.error('[afterSaveWebsites] Critical error in websites afterSave:', error);
        captureException(error);
        throw error;
    }
}

export default defineEventHandler(async (event: H3Event) => {
    try {
        const body: { websiteId?: string; userId?: string; isNewWebsite?: boolean; changedKeys?: string[] } = await readBody(event);
        const { websiteId, userId, isNewWebsite, changedKeys } = body;

        if (!websiteId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'websiteId is required'
            });
        }

        if (!userId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'userId is required'
            });
        }

        if (typeof isNewWebsite !== 'boolean') {
            throw createError({
                statusCode: 400,
                statusMessage: 'isNewWebsite is required and must be a boolean'
            });
        }

        // Execute the afterSave logic
        await afterSaveWebsites(websiteId, userId, isNewWebsite, changedKeys);

        return { success: true };

    } catch (error: any) {
        console.error('[AFTER SAVE WEBSITES] Error in afterSaveWebsites:', error?.message || String(error));
        captureException(error);

        throw createError({
            statusCode: (error as any).statusCode || 500,
            statusMessage: (error as any).statusMessage || 'Internal server error'
        });
    }
});
