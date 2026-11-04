/**
 * ImportSessionManager - Unified service for managing import sessions
 *
 * This service provides a centralized, type-safe API for all import session operations.
 * It replaces the previous pattern of storing importSession as a JSON field on User
 * with a dedicated ImportSession Parse class for better performance and queryability.
 *
 * Benefits:
 * - Direct database updates (no QStash queue delays)
 * - Atomic operations with proper indexes
 * - Type safety and validation
 * - Single source of truth for all session updates
 * - Easier testing and maintenance
 */

import Parse from 'parse/node.js';
import { selfUrl } from './site';

// Parse class definition
const ImportSession = Parse.Object.extend('ImportSession');

// Type definitions for better IDE support and documentation
export interface ImportSessionData {
  sessionId: string;
  batchId: string;
  user: Parse.User;
  startedAt: Date;
  completedAt?: Date;
  totalBookmarks: number;
  processedBookmarks: number;
  failedBookmarks: number;
  skippedBookmarks: number;
  currentlyProcessing?: string | null;
  estimatedCompletion?: Date | null;
  processingRate: number;
  status: 'active' | 'processing' | 'completed' | 'failed' | 'paused' | 'cancelled';
  lastProgressUpdate: Date;
  accessType: string;
  originalBookmarkCount: number;
  filteredBookmarkCount: number;
  errors: Array<{
    url: string;
    error: string;
    timestamp: Date;
  }>;
  milestones: {
    sessionCreated: Date;
    queuingCompleted?: Date | null;
    importInitialized?: Date | null;
    firstBookmarkProcessed?: Date | null;
    halfwayPoint?: Date | null;
    lastBookmarkProcessed?: Date | null;
    sessionCompleted?: Date | null;
  };
  performance: {
    averageProcessingTime: number;
    fastestBookmark?: {
      url: string;
      time: number;
    } | null;
    slowestBookmark?: {
      url: string;
      time: number;
    } | null;
    totalProcessingTime: number;
  };
  batchInfo?: {
    currentBatch: number;
    totalBatches: number;
    batchSize: number;
    queuedAt?: Date;
  } | null;
  queuingProgress?: {
    currentBatch: number;
    totalBatches: number;
    percentage: number;
    message?: string;
    lastUpdate: Date;
  } | null;
  initializationMessage?: string;
}

export interface ProgressUpdateData {
  url: string;
  status: 'success' | 'failed' | 'skipped';
  errorMsg?: string | null;
  processingTime?: number | null;
}

export interface StatusUpdateData {
  type: 'session-started' | 'batch-queued' | 'queuing-progress' | 'queuing-completed' | 'import-initialized' |
        'import-error' | 'bookmark-processed' | 'import-completed';
  timestamp?: Date;
  batchIndex?: number;
  totalBatches?: number;
  batchSize?: number;
  message?: string;
  error?: string;
  url?: string;
  processingTime?: number;
  result?: any;
}

export class ImportSessionManager {
  /**
   * Create a new import session
   */
  static async createSession(
    user: Parse.User,
    sessionId: string,
    batchId: string,
    totalBookmarks: number,
    originalCount: number,
    filteredCount: number,
    accessType: string
  ): Promise<Parse.Object> {
    const now = new Date();

    const session = new ImportSession();
    session.set('sessionId', sessionId);
    session.set('batchId', batchId);
    session.set('user', user);
    session.set('startedAt', now);
    session.set('totalBookmarks', totalBookmarks);
    session.set('processedBookmarks', 0);
    session.set('failedBookmarks', 0);
    session.set('skippedBookmarks', 0);
    session.set('currentlyProcessing', null);
    session.set('estimatedCompletion', null);
    session.set('processingRate', 0);
    session.set('status', 'active');
    session.set('lastProgressUpdate', now);
    session.set('accessType', accessType);
    session.set('originalBookmarkCount', originalCount);
    session.set('filteredBookmarkCount', filteredCount);
    session.set('errors', []);
    session.set('milestones', {
      sessionCreated: now,
      queuingCompleted: null,
      importInitialized: null,
      firstBookmarkProcessed: null,
      halfwayPoint: null,
      lastBookmarkProcessed: null,
      sessionCompleted: null
    });
    session.set('performance', {
      averageProcessingTime: 0,
      fastestBookmark: null,
      slowestBookmark: null,
      totalProcessingTime: 0
    });

    // Set ACL to only allow the user and master key to access
    const acl = new Parse.ACL(user);
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    session.setACL(acl);

    await session.save(null, { useMasterKey: true });

    // Also store reference on user for quick access
    user.set('activeImportSessionId', session.id);
    await user.save(null, { useMasterKey: true });

    return session;
  }

  /**
   * Get the active import session for a user
   * Looks for sessions with status 'active' or 'processing'
   */
  static async getActiveSession(user: Parse.User): Promise<Parse.Object | null> {
    const query = new Parse.Query(ImportSession);
    query.equalTo('user', user);
    query.containedIn('status', ['active', 'processing']);
    query.descending('createdAt');

    try {
      return await query.first({ useMasterKey: true });
    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * Get session by ID
   */
  static async getSessionById(sessionId: string): Promise<Parse.Object | null> {
    const query = new Parse.Query(ImportSession);
    query.equalTo('sessionId', sessionId);

    try {
      return await query.first({ useMasterKey: true });
    } catch (error) {
      console.error('Error getting session by ID:', error);
      return null;
    }
  }

  /**
   * Get session by Parse object ID
   */
  static async getSessionByObjectId(objectId: string): Promise<Parse.Object | null> {
    const query = new Parse.Query(ImportSession);

    try {
      return await query.get(objectId, { useMasterKey: true });
    } catch (error) {
      console.error('Error getting session by object ID:', error);
      return null;
    }
  }

  /**
   * Update currently processing URL
   */
  static async updateCurrentlyProcessing(
    session: Parse.Object,
    url: string | null
  ): Promise<void> {
    const now = new Date();
    session.set('currentlyProcessing', url);
    session.set('lastProgressUpdate', now);
    await session.save(null, { useMasterKey: true });
  }

  /**
   * Update import progress with comprehensive tracking
   */
  static async updateProgress(
    session: Parse.Object,
    data: ProgressUpdateData
  ): Promise<void> {
    const now = new Date();
    const { url, status, errorMsg = null, processingTime = null } = data;

    // Update counters based on status
    if (status === 'success') {
      session.increment('processedBookmarks', 1);
    } else if (status === 'failed') {
      session.increment('failedBookmarks', 1);

      // Add to errors array (limit to last 100 errors)
      const errors = session.get('errors') || [];
      errors.push({
        url,
        error: errorMsg || 'Unknown error',
        timestamp: now
      });
      if (errors.length > 100) {
        errors.shift(); // Remove oldest error
      }
      session.set('errors', errors);
    } else if (status === 'skipped') {
      session.increment('skippedBookmarks', 1);
    }

    // Calculate processing rate and estimated completion
    const totalProcessed = (session.get('processedBookmarks') || 0) +
                          (session.get('failedBookmarks') || 0);
    const startedAt = session.get('startedAt');
    const elapsedMinutes = (now.getTime() - startedAt.getTime()) / (1000 * 60);
    const processingRate = elapsedMinutes > 0 ? totalProcessed / elapsedMinutes : 0;

    session.set('processingRate', processingRate);

    // Calculate estimated completion
    const totalBookmarks = session.get('totalBookmarks');
    const remaining = totalBookmarks - totalProcessed;
    if (processingRate > 0 && remaining > 0) {
      const estimatedMinutesRemaining = remaining / processingRate;
      const estimatedCompletion = new Date(now.getTime() + (estimatedMinutesRemaining * 60 * 1000));
      session.set('estimatedCompletion', estimatedCompletion);
    }

    // Clear currently processing if success or skipped
    if (status === 'success' || status === 'skipped') {
      session.set('currentlyProcessing', null);
    }

    // Update performance metrics if processing time provided
    if (processingTime !== null) {
      const performance = session.get('performance') || {};
      performance.totalProcessingTime = (performance.totalProcessingTime || 0) + processingTime;

      const processedCount = session.get('processedBookmarks') || 1;
      performance.averageProcessingTime = performance.totalProcessingTime / processedCount;

      // Track fastest and slowest
      if (!performance.fastestBookmark || processingTime < performance.fastestBookmark.time) {
        performance.fastestBookmark = { url, time: processingTime };
      }
      if (!performance.slowestBookmark || processingTime > performance.slowestBookmark.time) {
        performance.slowestBookmark = { url, time: processingTime };
      }

      session.set('performance', performance);
    }

    session.set('lastProgressUpdate', now);
    await session.save(null, { useMasterKey: true });
  }

  /**
   * Handle status updates (for webhook integration)
   */
  static async updateStatus(
    session: Parse.Object,
    statusData: StatusUpdateData
  ): Promise<void> {
    const now = new Date();
    const milestones = session.get('milestones') || {};
    const performance = session.get('performance') || {};

    switch (statusData.type) {
      case 'session-started':
        milestones.sessionCreated = statusData.timestamp || now;
        session.set('status', 'active');
        break;

      case 'batch-queued':
        if (statusData.batchIndex !== undefined) {
          session.set('batchInfo', {
            currentBatch: statusData.batchIndex,
            totalBatches: statusData.totalBatches || 0,
            batchSize: statusData.batchSize || 0,
            queuedAt: statusData.timestamp || now
          });
        }
        break;

      case 'queuing-progress':
        if (statusData.batchIndex !== undefined && statusData.totalBatches) {
          const queuingPercentage = Math.round((statusData.batchIndex / statusData.totalBatches) * 100);
          session.set('queuingProgress', {
            currentBatch: statusData.batchIndex,
            totalBatches: statusData.totalBatches,
            percentage: queuingPercentage,
            message: statusData.message,
            lastUpdate: statusData.timestamp || now
          });
        }
        break;

      case 'queuing-completed':
        milestones.queuingCompleted = statusData.timestamp || now;
        // Don't resurrect a session that was cancelled while queuing
        if (!(await ImportSessionManager.isSessionCancelled(session.id))) {
          session.set('status', 'processing');
        }
        break;

      case 'import-initialized':
        milestones.importInitialized = statusData.timestamp || now;
        if (statusData.message) {
          session.set('initializationMessage', statusData.message);
        }
        break;

      case 'import-error':
        session.set('status', 'failed');
        if (statusData.error) {
          const errors = session.get('errors') || [];
          errors.push({
            url: statusData.url || 'unknown',
            error: statusData.error,
            timestamp: statusData.timestamp || now
          });
          session.set('errors', errors);
        }
        break;

      case 'bookmark-processed':
        // Track first bookmark milestone
        if (!milestones.firstBookmarkProcessed) {
          milestones.firstBookmarkProcessed = statusData.timestamp || now;
        }

        // Update performance if processing time provided
        if (statusData.processingTime && statusData.url) {
          performance.totalProcessingTime = (performance.totalProcessingTime || 0) + statusData.processingTime;

          const processedCount = (session.get('processedBookmarks') || 0) + 1;
          performance.averageProcessingTime = performance.totalProcessingTime / processedCount;

          if (!performance.fastestBookmark || statusData.processingTime < performance.fastestBookmark.time) {
            performance.fastestBookmark = { url: statusData.url, time: statusData.processingTime };
          }
          if (!performance.slowestBookmark || statusData.processingTime > performance.slowestBookmark.time) {
            performance.slowestBookmark = { url: statusData.url, time: statusData.processingTime };
          }
        }

        // Track halfway point
        const totalProcessed = (session.get('processedBookmarks') || 0) +
                              (session.get('failedBookmarks') || 0);
        const totalBookmarks = session.get('totalBookmarks');
        if (!milestones.halfwayPoint && totalProcessed >= totalBookmarks / 2) {
          milestones.halfwayPoint = statusData.timestamp || now;
        }

        session.set('currentlyProcessing', statusData.url || null);
        break;

      case 'import-completed':
        session.set('status', 'completed');
        milestones.sessionCompleted = statusData.timestamp || now;
        milestones.lastBookmarkProcessed = statusData.timestamp || now;
        session.set('currentlyProcessing', null);
        session.set('completedAt', statusData.timestamp || now);
        break;
    }

    session.set('milestones', milestones);
    session.set('performance', performance);
    session.set('lastProgressUpdate', now);

    await session.save(null, { useMasterKey: true });

    // A cancel committed between the check above and this save was overwritten
    // with 'processing'; cancelledAt is never cleared, so restore the cancel
    if (statusData.type === 'queuing-completed' && session.get('status') === 'processing' &&
        await ImportSessionManager.isSessionCancelled(session.id)) {
      session.set('status', 'cancelled');
      await session.save(null, { useMasterKey: true });
    }
  }

  /**
   * Check the stored session (not an in-memory copy) for a cancellation.
   * cancelledAt is only ever written by cancelActiveSessions, so it survives a
   * stale save that overwrites status.
   */
  static async isSessionCancelled(sessionObjectId: string | undefined): Promise<boolean> {
    if (!sessionObjectId) return false;
    try {
      const fresh = await new Parse.Query(ImportSession)
        .select('status', 'cancelledAt')
        .get(sessionObjectId, { useMasterKey: true });
      return fresh.get('status') === 'cancelled' || !!fresh.get('cancelledAt');
    } catch {
      return false;
    }
  }

  /**
   * Cancel all running sessions for a user
   */
  static async cancelActiveSessions(user: Parse.User): Promise<Parse.Object[]> {
    const query = new Parse.Query(ImportSession);
    query.equalTo('user', user);
    query.containedIn('status', ['active', 'processing']);
    query.descending('createdAt');
    const sessions = await query.find({ useMasterKey: true });
    const now = new Date();
    for (const session of sessions) {
      session.set('status', 'cancelled');
      session.set('cancelledAt', now);
      session.set('completedAt', now);
      session.set('currentlyProcessing', null);
      session.set('lastProgressUpdate', now);
    }
    if (sessions.length) await Parse.Object.saveAll(sessions, { useMasterKey: true });
    return sessions;
  }

  /**
   * Mark session as failed
   */
  static async markAsFailed(
    session: Parse.Object,
    error: string,
    user?: Parse.User
  ): Promise<void> {
    const now = new Date();
    session.set('status', 'failed');

    const errors = session.get('errors') || [];
    errors.push({
      url: 'session',
      error,
      timestamp: now
    });
    session.set('errors', errors);
    session.set('lastProgressUpdate', now);

    await session.save(null, { useMasterKey: true });

    // Update user's importAccessStatus to 'failed' if user is provided
    if (user) {
      user.set('importAccessStatus', 'failed');
      await user.save(null, { useMasterKey: true });
    }
  }

  /**
   * Complete the import session and move to history
   */
  static async completeSession(
    session: Parse.Object,
    user: Parse.User
  ): Promise<void> {
    const now = new Date();

    session.set('status', 'completed');
    session.set('completedAt', now);
    session.set('currentlyProcessing', null);
    session.set('estimatedCompletion', now);

    const milestones = session.get('milestones') || {};
    milestones.sessionCompleted = now;
    session.set('milestones', milestones);

    await session.save(null, { useMasterKey: true });

    // Add to import history on user
    const history = user.get('importHistory') || [];
    const sessionSummary = {
      sessionId: session.get('sessionId'),
      startedAt: session.get('startedAt'),
      completedAt: now,
      totalBookmarks: session.get('totalBookmarks'),
      processedBookmarks: session.get('processedBookmarks'),
      failedBookmarks: session.get('failedBookmarks'),
      skippedBookmarks: session.get('skippedBookmarks'),
      accessType: session.get('accessType'),
      status: 'completed'
    };

    history.push(sessionSummary);

    // Keep only last 10 import sessions in history
    if (history.length > 10) {
      history.shift();
    }

    user.set('importHistory', history);
    user.set('activeImportSessionId', null);

    // Update user's importAccessStatus to 'completed'
    user.set('importAccessStatus', 'completed');

    await user.save(null, { useMasterKey: true });

    // Reconcile bookmark counts to ensure sync after import completes
    try {
      const reconcileUrl = `${selfUrl()}v1/sync/reconcileBookmarkCounts`;
      const response = await fetch(reconcileUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: user.id })
      });

      if (!response.ok) {
        throw new Error(`Reconcile request failed: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.success) {
        console.log(
          `[ImportSessionManager] ✅ Reconciled bookmark counts for user ${user.id}: ` +
          `${result.previousTotal} → ${result.actualTotal} (difference: ${result.difference > 0 ? '+' : ''}${result.difference})`
        );
      } else {
        console.warn(`[ImportSessionManager] Reconcile returned success=false:`, result.error);
      }
    } catch (reconcileError: any) {
      console.error(`[ImportSessionManager] Failed to reconcile bookmark counts:`, reconcileError.message);
      // Don't throw - this is a best-effort sync
    }
  }

  /**
   * Clear/delete session
   */
  static async clearSession(
    session: Parse.Object,
    user?: Parse.User
  ): Promise<void> {
    // Optionally clear reference on user
    if (user) {
      user.set('activeImportSessionId', null);
      await user.save(null, { useMasterKey: true });
    }

    // Delete the session
    await session.destroy({ useMasterKey: true });
  }

  /**
   * Update milestone
   */
  static async updateMilestone(
    session: Parse.Object,
    milestone: keyof ImportSessionData['milestones'],
    timestamp?: Date
  ): Promise<void> {
    const milestones = session.get('milestones') || {};
    milestones[milestone] = timestamp || new Date();
    session.set('milestones', milestones);
    session.set('lastProgressUpdate', new Date());
    await session.save(null, { useMasterKey: true });
  }

  /**
   * Get session data as plain object
   */
  static getSessionData(session: Parse.Object): ImportSessionData {
    return {
      sessionId: session.get('sessionId'),
      batchId: session.get('batchId'),
      user: session.get('user'),
      startedAt: session.get('startedAt'),
      completedAt: session.get('completedAt'),
      totalBookmarks: session.get('totalBookmarks'),
      processedBookmarks: session.get('processedBookmarks'),
      failedBookmarks: session.get('failedBookmarks'),
      skippedBookmarks: session.get('skippedBookmarks'),
      currentlyProcessing: session.get('currentlyProcessing'),
      estimatedCompletion: session.get('estimatedCompletion'),
      processingRate: session.get('processingRate'),
      status: session.get('status'),
      lastProgressUpdate: session.get('lastProgressUpdate'),
      accessType: session.get('accessType'),
      originalBookmarkCount: session.get('originalBookmarkCount'),
      filteredBookmarkCount: session.get('filteredBookmarkCount'),
      errors: session.get('errors'),
      milestones: session.get('milestones'),
      performance: session.get('performance'),
      batchInfo: session.get('batchInfo'),
      queuingProgress: session.get('queuingProgress'),
      initializationMessage: session.get('initializationMessage')
    };
  }

  /**
   * Increment failed bookmarks counter (for logFailedImport utility)
   */
  static async incrementFailedBookmarks(session: Parse.Object): Promise<void> {
    const now = new Date();
    session.increment('failedBookmarks', 1);

    // Recalculate metrics
    const totalProcessed = (session.get('processedBookmarks') || 0) +
                          (session.get('failedBookmarks') || 0);
    const startedAt = session.get('startedAt');
    const elapsedMinutes = (now.getTime() - startedAt.getTime()) / (1000 * 60);
    const processingRate = elapsedMinutes > 0 ? totalProcessed / elapsedMinutes : 0;

    session.set('processingRate', processingRate);

    const totalBookmarks = session.get('totalBookmarks');
    const remaining = totalBookmarks - totalProcessed;
    if (processingRate > 0 && remaining > 0) {
      const estimatedMinutesRemaining = remaining / processingRate;
      const estimatedCompletion = new Date(now.getTime() + (estimatedMinutesRemaining * 60 * 1000));
      session.set('estimatedCompletion', estimatedCompletion);
    }

    session.set('lastProgressUpdate', now);
    await session.save(null, { useMasterKey: true });
  }
}

// Export the Parse class for use in other modules
export { ImportSession };
