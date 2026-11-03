/**
 * v1/import/importStatus - Get import status for a user
 *
 * This endpoint returns the current import status, session data, progress tracking,
 * and access information for a user's bookmark import process.
 */

import { defineEventHandler, getQuery } from 'h3';
import Parse from 'parse/node.js';
import { ImportSessionManager } from '../../../utils/ImportSessionManager';
import {
  resolveUserPlan,
  isPaidPlan,
  getPlanId,
  getPlanDisplayName,
  getPlanLimits,
  getBookmarkQuota,
} from '../../../utils/plans';

// Initialize Parse
Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

// Parse class definitions
const BookmarksToImport = Parse.Object.extend('bookmarksToImport');

// Type definitions
interface ImportStatusQuery {
  userId?: string;
}

interface PlanInfo {
  planId: string;
  planName: string;
  bookmarkLimit: number | null;
}

interface ProgressInfo {
  total: number;
  processed: number;
  failed: number;
  remaining: number;
  percentage: number;
}

interface SessionData {
  sessionId: string;
  startedAt: Date;
  totalBookmarks: number;
  processedBookmarks: number;
  failedBookmarks: number;
  skippedBookmarks: number;
  currentlyProcessing?: string | null;
  estimatedCompletion?: Date | null;
  processingRate: number;
  status: string;
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
  initializationMessage?: string;
  user: Parse.User;
  batchId: string;
  completedAt?: Date;
}

interface ImportStatusResponse {
  error?: string;
  status?: string;
  expiresAt?: Date | null;
  grantedAt?: Date | null;
  timeRemaining?: number | null;
  timeRemainingDays?: number | null;
  hasUsedAccess?: boolean;
  canImport?: boolean;
  canImportReason?: string;
  currentSession?: SessionData | null;
  progress?: ProgressInfo | null;
  history?: any[];
  planInfo?: PlanInfo | null;
  totalImported?: number;
  importing?: boolean;
  remainingBookmarks?: number;
}

interface CanImportResult {
  canImport: boolean;
  reason: string;
}

/**
 * Main event handler for getting import status
 */
export default defineEventHandler(async (event): Promise<ImportStatusResponse> => {
  const query = getQuery(event) as ImportStatusQuery;
  const userId = query.userId;

  if (!userId) {
    return { error: 'userId is required' };
  }

  try {
    const userQuery = new Parse.Query(Parse.User);
    userQuery.include('currentPlan');
    userQuery.equalTo('objectId', userId);
    const user = await userQuery.get(userId, { useMasterKey: true });

    const status = user.get('importAccessStatus') || 'none';
    const expiresAt = user.get('importAccessExpiresAt');
    const grantedAt = user.get('importAccessGrantedAt');

    // Get active session from ImportSession class
    const activeSession = await ImportSessionManager.getActiveSession(user);
    const session = activeSession ? ImportSessionManager.getSessionData(activeSession) : null;

    console.log('activeSession:', activeSession);
    console.log('session:', session);

    const history = user.get('importHistory') || [];
    const hasUsedAccess = user.get('hasUsedImportAccess') || false;

    // Calculate time remaining
    let timeRemaining: number | null = null;
    if (expiresAt) {
      const now = new Date();
      timeRemaining = Math.max(0, expiresAt.getTime() - now.getTime());
    }

    // Check if user can currently import
    const canImportResult = await canUserImport(user);

    // Get current plan info. `resolveUserPlan` always answers, so this is never
    // null any more — kept nullable in the type for wire compatibility.
    const plan = await resolveUserPlan(user);
    const planInfo: PlanInfo = {
      planId: getPlanId(plan),
      planName: getPlanDisplayName(plan),
      bookmarkLimit: getPlanLimits(plan).bookmarks
    };

    // Get remaining bookmarks count from BookmarksToImport class
    const remainingBookmarksQuery = new Parse.Query(BookmarksToImport);
    remainingBookmarksQuery.equalTo('user', user);
    const remainingBookmarksCount = await remainingBookmarksQuery.count({ useMasterKey: true });

    // Calculate progress for current session
    let progress: ProgressInfo | null = null;
    if (session && session.status === 'active') {
      const totalBookmarks = session.totalBookmarks || 0;
      const processedBookmarks = session.processedBookmarks || 0;
      const failedBookmarks = session.failedBookmarks || 0;

      progress = {
        total: totalBookmarks,
        processed: processedBookmarks,
        failed: failedBookmarks,
        remaining: remainingBookmarksCount, // Use actual count from database
        percentage: totalBookmarks > 0 ? Math.round((processedBookmarks + failedBookmarks) / totalBookmarks * 100) : 0
      };
    }

    return {
      status,
      expiresAt,
      grantedAt,
      timeRemaining,
      timeRemainingDays: timeRemaining ? Math.floor(timeRemaining / (24 * 60 * 60 * 1000)) : null,
      hasUsedAccess,
      canImport: canImportResult.canImport,
      canImportReason: canImportResult.reason,
      currentSession: session,
      progress,
      history,
      planInfo,
      totalImported: user.get('totalImportedBookmarks') || 0,
      importing: user.get('importing') || false,
      remainingBookmarks: remainingBookmarksCount
    };
  } catch (error: any) {
    console.error("Error getting import status:", error);
    return { error: error.message };
  }
});

/**
 * Helper function to check if user can import
 */
async function canUserImport(user: Parse.User): Promise<CanImportResult> {
  const importStatus = user.get('importAccessStatus') || 'none';
  const plan = await resolveUserPlan(user);
  const expiresAt = user.get('importAccessExpiresAt');
  const now = new Date();

  // Check if paid import access has expired
  if (importStatus === 'paid' && expiresAt && now > expiresAt) {
    return {
      canImport: false,
      reason: 'Import access expired'
    };
  }

  // Check if import is already completed
  if (importStatus === 'completed') {
    return {
      canImport: false,
      reason: 'Import already completed'
    };
  }

  // Check if import is already in progress
  if (importStatus === 'importing' && user.get('importing')) {
    return {
      canImport: false,
      reason: 'Import already in progress'
    };
  }

  // Paid import access (active)
  if (importStatus === 'paid' || importStatus === 'importing') {
    return {
      canImport: true,
      reason: 'Paid import access available'
    };
  }

  // Subscription users. The "legacy plan structure" branch that used to follow
  // read `currentPlan.currentPlan.name`, a path that only existed on the dead
  // `_User.plan` object and never on a `plans` row, so it could not fire.
  if (isPaidPlan(plan)) {
    return {
      canImport: true,
      reason: 'Subscription plan allows imports'
    };
  }

  // Free users, against their plan's own limit rather than a hard-coded 100.
  const quota = getBookmarkQuota(user, plan);
  if (quota.exceeded) {
    return {
      canImport: false,
      reason: `Free limit reached (${quota.limit} bookmarks)`
    };
  }

  return {
    canImport: true,
    reason: `Free tier: ${quota.remaining} bookmarks remaining`
  };
}
