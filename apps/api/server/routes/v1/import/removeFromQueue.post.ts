/**
 * v1/import/removeFromQueue - Unified endpoint for bookmark queue management
 *
 * This endpoint handles the ordered removal of bookmarks from the import queue,
 * updates progress tracking, and triggers import completion when appropriate.
 *
 * Migrated from qstash-webhook.post.js to follow v1 unified architecture
 */

import { defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import { ImportSessionManager } from '#root/server/utils/ImportSessionManager';
import { sendToQstash, sendEmail, getPartitionedQueue } from '#root/server/utils/serverUtils.js';
import { log } from '#root/server/utils/bookmarkLogger.js';
import importCompleteTemplate from '#root/emailTemplates/importCompleteTemplate';
import { setUserWebsiteCount } from '#root/server/utils/distributedBookmarkCounter';
import { resolveUserPlan, isPaidPlan, getPlanId, setUserToFreePlan } from '#root/server/utils/plans';

// Initialize Parse
Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

// Parse class definition
const BookmarksToImport = Parse.Object.extend('bookmarksToImport');

// Type definitions
interface RemoveFromQueueRequest {
  userId: string;
  url: string;
  status: 'success' | 'failed' | 'skipped';
  errorMsg?: string | null;
  processingTime?: number | null;
}

interface RemoveFromQueueResponse {
  success: boolean;
  remainingCount?: number;
  importCompleted?: boolean;
  error?: string;
  details?: string;
}

/**
 * Main event handler for removing bookmarks from queue
 */
export default defineEventHandler(async (event): Promise<RemoveFromQueueResponse> => {
  try {
    const body = await readBody(event) as RemoveFromQueueRequest;

    const { userId, url, status, errorMsg = null, processingTime = null } = body;

    // Validate required parameters
    if (!userId || !url || !status) {
      return {
        success: false,
        error: 'Missing required parameters: userId, url, and status are required'
      };
    }

    // Validate status value
    if (!['success', 'failed', 'skipped'].includes(status)) {
      return {
        success: false,
        error: 'Invalid status. Must be one of: success, failed, skipped'
      };
    }

    log(`[removeFromQueue] 🔄 Ordered removal 1: ${url} for user ${userId} with status: ${status}`);

    const result = await removeBookmarkFromQueue({
      userId,
      url,
      status,
      errorMsg,
      processingTime
    });

    return result;

  } catch (error: any) {
    console.error('❌ [removeFromQueue] Endpoint error:', error);
    return {
      success: false,
      error: 'Failed to remove bookmark from queue',
      details: error.message
    };
  }
});

/**
 * Core function for removing bookmark from queue with atomic operations
 * and progress tracking using ImportSessionManager
 */
export async function removeBookmarkFromQueue({
  userId,
  url,
  status,
  errorMsg = null,
  processingTime = null
}: RemoveFromQueueRequest): Promise<RemoveFromQueueResponse> {
  let user: Parse.User | undefined;

  try {
    log(`[removeFromQueue] 🔄 Ordered removal 2: ${url} for user ${userId} with status: ${status}`);

    // Fetch user with `currentPlan` included: completeImportSession() resolves
    // the plan to decide whether to downgrade. `resolveUserPlan` would hydrate
    // a cold pointer anyway — including it here just saves the extra round trip.
    user = await new Parse.Query(Parse.User).include('currentPlan').get(userId, { useMasterKey: true });
    // console.log(`👤 Found user: ${user.id}`);

    // Use Parse operations to ensure atomicity
    let bookmarkDeleted = false;
    let remainingCount = 0;

    // ATOMIC OPERATION: Find and delete the specific bookmark record
    log(`[removeFromQueue] 🔍 Searching for BookmarksToImport record: user=${user.id}, url=${url}`);
    const bookmarkQuery = new Parse.Query(BookmarksToImport);
    bookmarkQuery.equalTo('user', user);
    bookmarkQuery.equalTo('url', url);
    const bookmarkRecord = await bookmarkQuery.first({ useMasterKey: true });

    if (bookmarkRecord) {
      // log(`[removeFromQueue] 📋 Found bookmark record: ${bookmarkRecord.id}`);
      await bookmarkRecord.destroy({ useMasterKey: true });
      // log(`[removeFromQueue] 🗑️ Bookmark record deleted: ${url}`);
      bookmarkDeleted = true;
    } else {
      console.warn(`[removeFromQueue] ⚠️ Bookmark record not found for deletion: ${url}`);

      // Debug: Check if any records exist for this user
      const debugQuery = new Parse.Query(BookmarksToImport);
      debugQuery.equalTo('user', user);
      const allUserRecords = await debugQuery.find({ useMasterKey: true });
      log(`[removeFromQueue] 🔍 Debug: User ${userId} has ${allUserRecords.length} total BookmarksToImport records`);
      if (allUserRecords.length > 0) {
        log(`[removeFromQueue] 📋 Debug: Existing URLs for user:`, allUserRecords.map(r => r.get('url')));
      }
    }

    // Re-fetch user to ensure we have latest data before counting
    user = await new Parse.Query(Parse.User).include('currentPlan').get(userId, { useMasterKey: true });

    // Count remaining bookmarks for this user
    const remainingQuery = new Parse.Query(BookmarksToImport);
    remainingQuery.equalTo('user', user);
    remainingCount = await remainingQuery.count({ useMasterKey: true });
    // log(`[removeFromQueue] 📊 Remaining BookmarksToImport for user ${userId}: ${remainingCount}`);

    // Update user importing status
    user.set('importing', remainingCount > 0);

    // Update progress tracking using ImportSessionManager - this function saves the user
    // Only count progress for rows we actually removed (skips duplicates and cancelled imports)
    try {
      if (bookmarkDeleted) await updateImportProgress(user, url, status, errorMsg, processingTime);
      else await user.save(null, { useMasterKey: true });
      // log(`[removeFromQueue] ✅ updateImportProgress completed for ${url}`);
    } catch (error: any) {
      console.error(`[removeFromQueue] ❌ Error updating import progress for ${url}:`, error?.message || String(error));
    }

    // Update other counters based on status (only if we actually deleted the record)
    if (status === 'success' && bookmarkDeleted) {
      // Re-fetch user again to get latest state after updateImportProgress
      user = await new Parse.Query(Parse.User).include('currentPlan').get(userId, { useMasterKey: true });

      const totalImported = user.get('totalImportedBookmarks') || 0;
      let importedBookmarksArr = user.get('importedBookmarksArr') || [];
      importedBookmarksArr.push(url);

      user.set('totalImportedBookmarks', totalImported + 1);
      user.set('importedBookmarksArr', importedBookmarksArr);

      // Save updated counters
      await user.save(null, { useMasterKey: true });
    }

    log(`[removeFromQueue] ✅ Bookmark ${url} removed from queue. ${remainingCount} remaining.`);

    // Check if import is complete (double-check by re-querying)
    // Normally the call that removed the last row completes the import. A call
    // that removed nothing (e.g. a retry after the last delete) may too, but
    // only once queuing has finished ('processing'); stale messages from a
    // cancelled import never match, as that session is 'cancelled'.
    let canComplete = bookmarkDeleted;
    if (!canComplete && remainingCount === 0) {
      const activeSession = await ImportSessionManager.getActiveSession(user);
      canComplete = activeSession?.get('status') === 'processing';
    }
    let importCompleted = false;
    if (canComplete && remainingCount === 0) {
      // Final verification before completion
      const finalCountQuery = new Parse.Query(BookmarksToImport);
      finalCountQuery.equalTo('user', user);
      const finalCount = await finalCountQuery.count({ useMasterKey: true });

      if (finalCount === 0) {
        console.log(`🎉 Import complete for user ${userId} - triggering completion`);
        await completeImportSession(user);
        importCompleted = true;
      } else {
        console.log(`⚠️ Count mismatch detected. Expected 0, found ${finalCount}. Not triggering completion yet.`);
      }
    }

    return {
      success: true,
      remainingCount,
      importCompleted
    };

  } catch (error: any) {
    console.error(`❌ Error removing bookmark ${url} from queue:`, error);

    // If we have a user object, attempt to log the failure in their record
    if (user) {
      try {
        await updateImportProgress(user, url, 'failed', `Queue removal error: ${error.message}`, processingTime);
      } catch (progressError: any) {
        console.error(`❌ Additional error updating progress for failed removal:`, progressError);
      }
    }

    throw error;
  }
}

/**
 * Enhanced progress update function with batch tracking
 */
async function updateImportProgress(
  user: Parse.User,
  url: string,
  status: 'success' | 'failed' | 'skipped',
  errorMsg: string | null = null,
  processingTime: number | null = null
): Promise<void> {
  const now = new Date();
  const session = await ImportSessionManager.getActiveSession(user);
  const batch = user.get('currentImportBatch');

  log(`🔍 [updateImportProgress] Session found: ${session ? 'YES' : 'NO'}, Session ID: ${session?.id || 'N/A'}`);

  if (session) {
    log(`📊 [updateImportProgress] Current session state BEFORE update: ${JSON.stringify({
      processedBookmarks: session.get('processedBookmarks'),
      failedBookmarks: session.get('failedBookmarks'),
      skippedBookmarks: session.get('skippedBookmarks'),
      status: session.get('status'),
      currentlyProcessing: session.get('currentlyProcessing')
    })}`);

    // Update progress using ImportSessionManager
    await ImportSessionManager.updateProgress(session, {
      url,
      status,
      errorMsg,
      processingTime
    });

    console.log(`📊 [updateImportProgress] Session state AFTER update:`, {
      processedBookmarks: session.get('processedBookmarks'),
      failedBookmarks: session.get('failedBookmarks'),
      skippedBookmarks: session.get('skippedBookmarks'),
      status: session.get('status'),
      currentlyProcessing: session.get('currentlyProcessing')
    });

    // Handle failed imports array on user
    if (status === 'failed') {
      const failedImports = user.get('failedToImport') || [];
      failedImports.push({
        url: url,
        error: errorMsg || 'Unknown error',
        timestamp: now,
        processingTime: processingTime || 0,
        canRetry: true
      });
      user.set('failedToImport', failedImports);
    }

    // Update batch progress
    if (batch) {
      batch.bookmarksInCurrentBatch = (batch.bookmarksInCurrentBatch || 0) + 1;

      // Check if current batch is complete
      if (batch.bookmarksInCurrentBatch >= batch.batchSize) {
        // Move to next batch
        batch.batchIndex += 1;
        batch.bookmarksInCurrentBatch = 0;
        batch.batchStartTime = now;
        batch.batchId = `batch_${session.get('sessionId')}_${batch.batchIndex}`;
      }

      user.set('currentImportBatch', batch);
    }
  }

  await user.save(null, { useMasterKey: true });
}

async function countUserWebsites(user: Parse.User): Promise<number> {
  const query = new Parse.Query('websites');
  query.equalTo('user', user);
  return await query.count({ useMasterKey: true });
}

/**
 * Enhanced completion function
 */
async function completeImportSession(user: Parse.User): Promise<void> {
  const session = await ImportSessionManager.getActiveSession(user);

  if (!session) {
    console.warn(`No active session found for user ${user.id}`);
    return;
  }

  const sessionData = ImportSessionManager.getSessionData(session);

  let totalWebsites = await countUserWebsites(user);
  console.log(`Total websites for user ${user.id}: ${totalWebsites}`);
  await setUserWebsiteCount(totalWebsites, user.id);

  // A user who used paid one-time import access should lose that access after the import,
  // but never their underlying subscription plan. `validateImportAccess` prioritises
  // `importAccessStatus === 'paid'` over a user's subscription when computing `accessType`,
  // so a paying subscriber who once bought import access lands here with accessType
  // 'paid-import' / 'expired-but-unused' / 'free-with-paid-access' and used to have their
  // `currentPlan` wiped to free.
  const usedOneTimeImportAccess =
    (sessionData.accessType === 'paid-import' ||
     sessionData.accessType === 'expired-but-unused' ||
     sessionData.accessType === 'free-with-paid-access') &&
    (sessionData.processedBookmarks || 0) >= 100;

  if (usedOneTimeImportAccess) {
    // Clear import access flags regardless of subscription state
    user.set('hasImportAccess', false);
    user.set('importAccessExpiresAt', null);

    // Only downgrade to free if the user isn't on a paid subscription.
    const plan = await resolveUserPlan(user);
    if (isPaidPlan(plan)) {
      console.log(`User ${user.id} import complete; keeping paid subscription plan '${getPlanId(plan)}' intact`);
    } else {
      await setUserToFreePlan(user, `import of ${sessionData.processedBookmarks} bookmarks complete`)
        .catch((error) => console.warn(`User ${user.id} import complete but free plan unavailable - leaving currentPlan untouched:`, error));
    }
  }

  // Clean up remaining BookmarksToImport records
  try {
    const cleanupQuery = new Parse.Query(BookmarksToImport);
    cleanupQuery.equalTo('user', user);
    const remainingRecords = await cleanupQuery.find({ useMasterKey: true });
    if (remainingRecords.length > 0) {
      await Parse.Object.destroyAll(remainingRecords, { useMasterKey: true });
      console.log(`🧹 Cleaned up ${remainingRecords.length} remaining BookmarksToImport records for user ${user.id}`);
    }
  } catch (cleanupError) {
    console.error('Error cleaning up BookmarksToImport records:', cleanupError);
  }

  // Update user status before completing session
  user.set('importing', false);
  user.set('bookmarksToImport', []);
  user.set('currentImportBatch', null);

  // Complete the session using ImportSessionManager
  // This will also set user.importAccessStatus to 'completed' and save the user
  await ImportSessionManager.completeSession(session, user);

  // Update usage counter
  const dataToUpdate = {
    typeOfUsage: 'bookmarks',
    userId: user.id,
    number: 1,
    shouldRefreshCount: true
  };

  // Queue usage update via QStash
  await sendToQstash({
    type: 'update-usage',
    data: dataToUpdate
  }, { queueName: getPartitionedQueue('usageUpdates') });

  // Send completion email
  try {
    await sendEmail({
      userEmail: user.get('email'),
      emailHtml: importCompleteTemplate,
      subject: "Your bookmarks have been imported!",
      text: "Your bookmarks have all been imported!",
      name: user.get('username') || 'User',
    });
  } catch (error) {
    console.error("Error sending import complete email: ", error);
  }

  console.log(`Import completed for user ${user.id}: ${sessionData.processedBookmarks || 0} successful, ${sessionData.failedBookmarks || 0} failed`);
}
