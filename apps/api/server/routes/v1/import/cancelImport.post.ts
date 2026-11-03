/**
 * v1/import/cancelImport - Cancel a user's running bookmark import
 *
 * Marks running ImportSessions as cancelled and deletes all pending
 * bookmarksToImport rows. Messages already queued in QStash check for
 * their row before processing, so they become no-ops.
 */

import { defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import { ImportSessionManager } from '#root/server/utils/ImportSessionManager';
import { verifySession } from '#root/server/utils/sessionCache.js';

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

const BookmarksToImport = Parse.Object.extend('bookmarksToImport');
const DELETE_PAGE_SIZE = 500;

export default defineEventHandler(async (event) => {
  const { userId, sessionToken } = (await readBody(event)) as { userId?: string; sessionToken?: string };
  if (!userId) {
    return { success: false, error: 'userId is required' };
  }

  // The frontend proxy attaches the internal credential for any caller, so
  // require the user's own session to stop one user cancelling another's import
  const sessionUser = await verifySession(sessionToken).catch(() => null);
  if (!sessionUser || sessionUser.id !== userId) {
    return { success: false, error: 'Not authorised to cancel this import' };
  }

  try {
    const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });

    // Cancel sessions first so the queuing loop and progress updates stop
    const sessions = await ImportSessionManager.cancelActiveSessions(user);
    const cancelledSessions = sessions.length;

    // A cancelled import shouldn't use up one-time paid import access: give
    // back what the user had before the (oldest) cancelled import started
    const previous = sessions
      .map(s => s.get('previousImportAccess'))
      .filter(Boolean)
      .pop();

    // Delete every pending row (queries are capped, so page until empty).
    // A failure here isn't fatal: the sessions are cancelled, so the webhook
    // drops their queued messages anyway.
    let removedBookmarks = 0;
    let deleteError: any = null;
    try {
      while (true) {
        const query = new Parse.Query(BookmarksToImport);
        query.equalTo('user', user);
        query.limit(DELETE_PAGE_SIZE);
        const rows = await query.find({ useMasterKey: true });
        if (rows.length === 0) break;
        await Parse.Object.destroyAll(rows, { useMasterKey: true }).catch((error: any) => {
          // In-flight saves may delete some rows first (OBJECT_NOT_FOUND); the
          // rest of the page is still deleted, so only rethrow other errors
          const errors = error?.code === Parse.Error.AGGREGATE_ERROR ? (error.errors || []) : [error];
          if (errors.some((e: any) => e?.code !== Parse.Error.OBJECT_NOT_FOUND)) throw error;
        });
        removedBookmarks += rows.length;
      }
    } catch (error: any) {
      deleteError = error;
      console.error('[cancelImport] Failed to delete some pending rows for user', userId, error?.message || error);
    }

    user.set('importing', false);
    if (previous && previous.importAccessStatus !== 'importing') {
      user.set('importAccessStatus', previous.importAccessStatus);
      user.set('hasUsedImportAccess', !!previous.hasUsedImportAccess);
    } else {
      user.set('importAccessStatus', 'completed');
    }
    user.set('bookmarksToImport', []);
    user.set('currentImportBatch', null);
    user.set('activeImportSessionId', null);
    await user.save(null, { useMasterKey: true });

    console.log(`[cancelImport] user ${userId}: cancelled ${cancelledSessions} session(s), removed ${removedBookmarks} pending bookmark(s)`);

    return {
      success: true,
      cancelledSessions,
      removedBookmarks,
      ...(deleteError ? { warning: 'Some queued bookmarks could not be removed' } : {})
    };
  } catch (error: any) {
    console.error('[cancelImport] Error cancelling import for user', userId, error?.message || error);
    return { success: false, error: error?.message || 'Failed to cancel import' };
  }
});
