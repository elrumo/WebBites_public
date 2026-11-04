/**
 * Migration utility to move importSession data from User objects to ImportSession class
 *
 * This script migrates all active import sessions from the old JSON field structure
 * on User objects to the new dedicated ImportSession Parse class.
 *
 * Usage:
 * - Run once during deployment
 * - Can be re-run safely (skips already migrated sessions)
 * - Logs progress and any errors
 */

import Parse from 'parse/node.js';
import { ImportSessionManager } from './ImportSessionManager.js';

export interface MigrationResult {
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ userId: string; error: string }>;
}

/**
 * Migrate all active import sessions from User objects to ImportSession class
 */
export async function migrateAllImportSessions(): Promise<MigrationResult> {
  console.log('Starting import session migration...');

  const result: MigrationResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Query all users that have an importSession field
    const userQuery = new Parse.Query(Parse.User);
    userQuery.exists('importSession');
    userQuery.limit(1000); // Process in batches

    const users = await userQuery.find({ useMasterKey: true });
    console.log(`Found ${users.length} users with importSession data`);

    for (const user of users) {
      try {
        const oldSession = user.get('importSession');

        if (!oldSession) {
          result.skipped++;
          continue;
        }

        // Check if already migrated (has activeImportSessionId)
        const activeSessionId = user.get('activeImportSessionId');
        if (activeSessionId) {
          console.log(`User ${user.id} already migrated, skipping...`);
          result.skipped++;
          continue;
        }

        // Create new ImportSession object
        await migrateUserSession(user, oldSession);
        result.success++;

        console.log(`✓ Migrated session for user ${user.id}`);
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push({
          userId: user.id,
          error: errorMsg
        });
        console.error(`✗ Failed to migrate user ${user.id}:`, errorMsg);
      }
    }

    console.log('\nMigration complete!');
    console.log(`Success: ${result.success}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Skipped: ${result.skipped}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(err => {
        console.log(`  User ${err.userId}: ${err.error}`);
      });
    }

    return result;
  } catch (error) {
    console.error('Migration failed with error:', error);
    throw error;
  }
}

/**
 * Migrate a single user's import session
 */
export async function migrateUserSession(
  user: Parse.User,
  oldSession: any
): Promise<Parse.Object> {
  const ImportSession = Parse.Object.extend('ImportSession');
  const newSession = new ImportSession();

  // Map all fields from old structure to new class
  newSession.set('sessionId', oldSession.sessionId || generateSessionId());
  newSession.set('batchId', oldSession.batchId || generateBatchId());
  newSession.set('user', user);
  newSession.set('startedAt', oldSession.startedAt || new Date());

  if (oldSession.completedAt) {
    newSession.set('completedAt', oldSession.completedAt);
  }

  newSession.set('totalBookmarks', oldSession.totalBookmarks || 0);
  newSession.set('processedBookmarks', oldSession.processedBookmarks || 0);
  newSession.set('failedBookmarks', oldSession.failedBookmarks || 0);
  newSession.set('skippedBookmarks', oldSession.skippedBookmarks || 0);
  newSession.set('currentlyProcessing', oldSession.currentlyProcessing || null);
  newSession.set('estimatedCompletion', oldSession.estimatedCompletion || null);
  newSession.set('processingRate', oldSession.processingRate || 0);
  newSession.set('status', oldSession.status || 'active');
  newSession.set('lastProgressUpdate', oldSession.lastProgressUpdate || new Date());
  newSession.set('accessType', oldSession.accessType || 'unknown');
  newSession.set('originalBookmarkCount', oldSession.originalBookmarkCount || 0);
  newSession.set('filteredBookmarkCount', oldSession.filteredBookmarkCount || 0);
  newSession.set('errors', oldSession.errors || []);

  // Migrate milestones
  newSession.set('milestones', {
    sessionCreated: oldSession.milestones?.sessionCreated || oldSession.startedAt || new Date(),
    queuingCompleted: oldSession.milestones?.queuingCompleted || null,
    importInitialized: oldSession.milestones?.importInitialized || null,
    firstBookmarkProcessed: oldSession.milestones?.firstBookmarkProcessed || null,
    halfwayPoint: oldSession.milestones?.halfwayPoint || null,
    lastBookmarkProcessed: oldSession.milestones?.lastBookmarkProcessed || null,
    sessionCompleted: oldSession.milestones?.sessionCompleted || null
  });

  // Migrate performance
  newSession.set('performance', {
    averageProcessingTime: oldSession.performance?.averageProcessingTime || 0,
    fastestBookmark: oldSession.performance?.fastestBookmark || null,
    slowestBookmark: oldSession.performance?.slowestBookmark || null,
    totalProcessingTime: oldSession.performance?.totalProcessingTime || 0
  });

  // Migrate batch info if present
  if (oldSession.batchInfo) {
    newSession.set('batchInfo', oldSession.batchInfo);
  }

  // Migrate initialization message if present
  if (oldSession.initializationMessage) {
    newSession.set('initializationMessage', oldSession.initializationMessage);
  }

  // Set ACL
  const acl = new Parse.ACL(user);
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  newSession.setACL(acl);

  // Save the new session
  await newSession.save(null, { useMasterKey: true });

  // Update user to reference new session
  user.set('activeImportSessionId', newSession.id);

  // Keep the old importSession field for now (for backward compatibility during transition)
  // It can be removed in a later migration once all code is updated

  await user.save(null, { useMasterKey: true });

  return newSession;
}

/**
 * Clean up old importSession fields from User objects
 *
 * WARNING: Only run this AFTER all code has been updated to use the new ImportSession class
 * and you've verified the migration was successful.
 */
export async function cleanupOldImportSessionFields(): Promise<number> {
  console.log('Starting cleanup of old importSession fields...');

  let cleaned = 0;

  try {
    const userQuery = new Parse.Query(Parse.User);
    userQuery.exists('importSession');
    userQuery.exists('activeImportSessionId'); // Only clean if migrated
    userQuery.limit(1000);

    const users = await userQuery.find({ useMasterKey: true });
    console.log(`Found ${users.length} users with old importSession field`);

    for (const user of users) {
      try {
        user.unset('importSession');
        await user.save(null, { useMasterKey: true });
        cleaned++;
        console.log(`✓ Cleaned user ${user.id}`);
      } catch (error) {
        console.error(`✗ Failed to clean user ${user.id}:`, error);
      }
    }

    console.log(`\nCleanup complete! Removed ${cleaned} old importSession fields.`);
    return cleaned;
  } catch (error) {
    console.error('Cleanup failed with error:', error);
    throw error;
  }
}

// Helper functions (same as used in the application)
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Rollback migration for a specific user (in case of issues)
 */
export async function rollbackUserMigration(userId: string): Promise<void> {
  console.log(`Rolling back migration for user ${userId}...`);

  try {
    const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
    const activeSessionId = user.get('activeImportSessionId');

    if (!activeSessionId) {
      console.log('No active session to rollback');
      return;
    }

    // Get the ImportSession
    const session = await ImportSessionManager.getSessionByObjectId(activeSessionId);

    if (!session) {
      console.log('Session not found');
      return;
    }

    // Convert back to old format
    const oldSession = ImportSessionManager.getSessionData(session);

    // Restore to user object
    user.set('importSession', oldSession);
    user.unset('activeImportSessionId');
    await user.save(null, { useMasterKey: true });

    // Delete the ImportSession object
    await session.destroy({ useMasterKey: true });

    console.log(`✓ Rollback complete for user ${userId}`);
  } catch (error) {
    console.error(`✗ Rollback failed for user ${userId}:`, error);
    throw error;
  }
}

// If running as a standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  // Initialize Parse
  Parse.initialize(
    process.env.VITE_PARSE_ID!,
    process.env.VITE_PARSE_JS_KEY!,
    process.env.VITE_PARSE_MASTER_KEY!
  );
  Parse.serverURL = process.env.VITE_PARSE_URL!;

  const command = process.argv[2];

  switch (command) {
    case 'migrate':
      migrateAllImportSessions()
        .then(result => {
          console.log('\nMigration result:', result);
          process.exit(result.failed > 0 ? 1 : 0);
        })
        .catch(error => {
          console.error('Migration failed:', error);
          process.exit(1);
        });
      break;

    case 'cleanup':
      // cleanupOldImportSessionFields()
      //   .then(count => {
      //     console.log(`\nCleaned ${count} users`);
      //     process.exit(0);
      //   })
      //   .catch(error => {
      //     console.error('Cleanup failed:', error);
      //     process.exit(1);
      //   });
      break;

    case 'rollback':
      const userId = process.argv[3];
      if (!userId) {
        console.error('Please provide a user ID');
        process.exit(1);
      }
      rollbackUserMigration(userId)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;

    default:
      console.log('Usage:');
      console.log('  node migrateImportSessions.js migrate   - Migrate all sessions');
      console.log('  node migrateImportSessions.js cleanup   - Remove old fields');
      console.log('  node migrateImportSessions.js rollback <userId> - Rollback single user');
      process.exit(1);
  }
}
