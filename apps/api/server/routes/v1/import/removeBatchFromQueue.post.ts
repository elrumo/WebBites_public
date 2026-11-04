/**
 * v1/import/removeBatchFromQueue - Batch removal for bookmark import queue
 *
 * Processes multiple queue removals in a single request to reduce rate-limit pressure.
 * Mirrors the logic of single-item removal, updating ImportSessionManager and user counters.
 */

import { defineEventHandler, readBody, createError } from 'h3';
import Parse from 'parse/node.js';
import { ImportSessionManager } from '../../../utils/ImportSessionManager';
import importCompleteTemplate from '../../../../emailTemplates/importCompleteTemplate';
import { sendToQstash, sendEmail, getPartitionedQueue } from '../../../utils/serverUtils.js';
import { resolveUserPlan, isPaidPlan, setUserToFreePlan } from '../../../utils/plans';

// Initialize Parse
Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

// Parse class definition
const BookmarksToImport = Parse.Object.extend('bookmarksToImport');

interface RemovalItem {
  url: string;
  status: 'success' | 'failed' | 'skipped';
  errorMsg?: string | null;
  processingTime?: number | null;
}

interface RemoveBatchRequest {
  userId: string;
  items: RemovalItem[];
}

interface RemoveBatchResponse {
  success: boolean;
  processedCount: number;
  remainingCount?: number;
  importCompleted?: boolean;
  error?: string;
  details?: string;
}

/**
 * Core function for batch removing bookmarks from queue
 */
export async function removeBatchFromQueue({ userId, items }: RemoveBatchRequest): Promise<RemoveBatchResponse> {
  try {
    if (!userId || !Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        processedCount: 0,
        error: 'Missing required parameters: userId and a non-empty items array are required'
      };
    }

    // Validate items
    for (const item of items) {
      if (!item.url || !item.status || !['success', 'failed', 'skipped'].includes(item.status)) {
        return {
          success: false,
          processedCount: 0,
          error: 'Invalid item detected. Each item must include url and valid status.'
        };
      }
    }

    // Fetch user once, with `currentPlan` included: completeImportSession()
    // resolves the plan to decide whether to downgrade. `resolveUserPlan` would
    // hydrate a cold pointer anyway — including it saves the extra round trip.
    let user = await new Parse.Query(Parse.User).include('currentPlan').get(userId, { useMasterKey: true });

    let processedCount = 0;

    // Process each removal sequentially to preserve order semantics
    for (const item of items) {
      try {
        await removeSingleFromQueue({ user, userId, ...item });
        processedCount++;
      } catch (error: any) {
        // Log and continue with next item
        console.error(`❌ Error removing bookmark ${item.url} from queue (batch):`, error);
        try {
          await updateImportProgress(user, item.url, 'failed', `Queue removal error (batch): ${error.message}`, item.processingTime || null);
        } catch (progressError: any) {
          console.error(`❌ Additional error updating progress for failed removal (batch):`, progressError);
        }
      }
      // Re-fetch user after potential progress updates
      user = await new Parse.Query(Parse.User).include('currentPlan').get(userId, { useMasterKey: true });
    }

    // Final remaining count and potential completion
    const remainingQuery = new Parse.Query(BookmarksToImport);
    remainingQuery.equalTo('user', user);
    const remainingCount = await remainingQuery.count({ useMasterKey: true });

    let importCompleted = false;
    if (remainingCount === 0) {
      // Double-check and complete
      const finalCountQuery = new Parse.Query(BookmarksToImport);
      finalCountQuery.equalTo('user', user);
      const finalCount = await finalCountQuery.count({ useMasterKey: true });
      if (finalCount === 0) {
        await completeImportSession(user);
        importCompleted = true;
      }
    }

    return {
      success: true,
      processedCount,
      remainingCount,
      importCompleted
    };

  } catch (error: any) {
    console.error('❌ [removeBatchFromQueue] Function error:', error);
    return {
      success: false,
      processedCount: 0,
      error: 'Failed to process batch removal',
      details: error.message
    };
  }
}

export default defineEventHandler(async (event): Promise<RemoveBatchResponse> => {
  try {
    const body = await readBody(event) as RemoveBatchRequest;
    return await removeBatchFromQueue(body);
  } catch (error: any) {
    console.error('❌ [removeBatchFromQueue] Endpoint error:', error);
    return {
      success: false,
      processedCount: 0,
      error: 'Failed to process batch removal',
      details: error.message
    };
  }
});

async function removeSingleFromQueue({
  user,
  userId,
  url,
  status,
  errorMsg = null,
  processingTime = null
}: { user: Parse.User; userId: string } & RemovalItem): Promise<void> {
  // Find and delete the specific bookmark record
  const bookmarkQuery = new Parse.Query(BookmarksToImport);
  bookmarkQuery.equalTo('user', user);
  bookmarkQuery.equalTo('url', url);
  const bookmarkRecord = await bookmarkQuery.first({ useMasterKey: true });

  let bookmarkDeleted = false;

  if (bookmarkRecord) {
    await bookmarkRecord.destroy({ useMasterKey: true });
    bookmarkDeleted = true;
  } else {
    console.warn(`⚠️ Bookmark record not found for deletion (batch): ${url}`);
  }

  // Update progress tracking and user state
  await updateImportProgress(user, url, status, errorMsg, processingTime);

  if (status === 'success' && bookmarkDeleted) {
    // Re-fetch user to get latest state after progress update
    user = await new Parse.Query(Parse.User).include('currentPlan').get(userId, { useMasterKey: true });
    const totalImported = user.get('totalImportedBookmarks') || 0;
    let importedBookmarksArr = user.get('importedBookmarksArr') || [];
    importedBookmarksArr.push(url);

    user.set('totalImportedBookmarks', totalImported + 1);
    user.set('importedBookmarksArr', importedBookmarksArr);
    await user.save(null, { useMasterKey: true });
  }
}

/**
 * Progress update function (duplicated from single-item endpoint)
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

  if (session) {
    await ImportSessionManager.updateProgress(session, {
      url,
      status,
      errorMsg,
      processingTime
    });

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

    if (batch) {
      batch.bookmarksInCurrentBatch = (batch.bookmarksInCurrentBatch || 0) + 1;

      if (batch.bookmarksInCurrentBatch >= batch.batchSize) {
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

/**
 * Completion function (duplicated from single-item endpoint)
 */
async function completeImportSession(user: Parse.User): Promise<void> {
  const session = await ImportSessionManager.getActiveSession(user);

  if (!session) {
    console.warn(`No active session found for user ${user.id}`);
    return;
  }

  const sessionData = ImportSessionManager.getSessionData(session);

  // Mirror of removeFromQueue.post.ts: a user who used paid one-time import access loses
  // that access, but never their underlying subscription plan. See that file for context.
  const usedOneTimeImportAccess =
    (sessionData.accessType === 'paid-import' ||
     sessionData.accessType === 'expired-but-unused' ||
     sessionData.accessType === 'free-with-paid-access') &&
    (sessionData.processedBookmarks || 0) >= 100;

  if (usedOneTimeImportAccess) {
    user.set('hasImportAccess', false);
    user.set('importAccessExpiresAt', null);

    if (!isPaidPlan(await resolveUserPlan(user))) {
      await setUserToFreePlan(user, 'one-time import access spent')
        .catch((error) => console.warn(`User ${user.id} free plan unavailable:`, error));
    }
  }

  try {
    const cleanupQuery = new Parse.Query(BookmarksToImport);
    cleanupQuery.equalTo('user', user);
    const remainingRecords = await cleanupQuery.find({ useMasterKey: true });
    if (remainingRecords.length > 0) {
      await Parse.Object.destroyAll(remainingRecords, { useMasterKey: true });
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

  const dataToUpdate = {
    typeOfUsage: 'bookmarks',
    userId: user.id,
    number: 1,
    shouldRefreshCount: true
  };

  await sendToQstash({
    type: 'update-usage',
    data: dataToUpdate
  }, { queueName: getPartitionedQueue('usageUpdates') });

  try {
    await sendEmail({
      userEmail: user.get('email'),
      emailHtml: importCompleteTemplate,
      subject: 'Your bookmarks have been imported!',
      text: 'Your bookmarks have all been imported!',
      name: user.get('username') || 'User',
    });
  } catch (error) {
    console.error('Error sending import complete email: ', error);
  }
}
