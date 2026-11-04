/**
 * v1/import/importBookmarks - Import bookmarks for a user
 *
 * This endpoint processes and imports bookmarks for a user with access validation,
 * quota management, and session tracking. Supports different access types including
 * free tier, subscription, and paid import access.
 */

import { defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import { sendToQstash, validateImportAccess, calculateQuotaInfo, getExistingUrls, getPartitionedQueue } from '../../../utils/serverUtils.js';
import { ImportSessionManager } from '../../../utils/ImportSessionManager';

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
interface ImportBookmarksRequest {
  userId: string;
  forceImport?: boolean;
  importFromFile?: boolean;
  importFromParseClass?: boolean;
  limitExistingDuplicates?: boolean;
  bookmarksToImport?: string[]; // For k6 testing: allows passing bookmarks directly in request body
  fromCache?: boolean; // For k6 testing: allows importing from cache
}

interface AccessCheck {
  hasAccess: boolean;
  accessType: string;
  ignoreSubscriptionLimits?: boolean;
  reason?: string;
  remainingQuota?: number;
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

interface ImportBookmarksResponse {
  success?: boolean;
  message?: string;
  accessStatus?: string;
  session?: SessionData;
  stats?: {
    originalCount: number;
    filteredCount: number;
    skippedDuplicates: number;
    estimatedDuration: string;
  };
  tracking?: {
    sessionId: string;
    statusEndpoint: string;
    realTimeUpdates: boolean;
  };
  error?: string;
  userId?: string;
  timestamp?: string;
  expiresAt?: Date | null;
  importing?: boolean;
  cancelled?: boolean;
}

/**
 * OpenAPI Specification
 *
 * This endpoint would have the following OpenAPI spec:
 *
 * Tags: ["Bookmark Import"]
 * Summary: "Import bookmarks for a user"
 *
 * Access Types:
 * - free: Free tier users with 100 bookmark limit
 * - subscription: Paid subscription users with plan-based limits
 * - paid-import: Users with active paid import access (unlimited)
 * - expired-but-unused: Users with expired paid access who never used it (one-time unlimited)
 * - completed-under-limit: Users who completed import but have under 100 bookmarks
 * - force: Admin force import bypassing all restrictions (unlimited)
 *
 * Side Effects:
 * - Creates import session with tracking data
 * - Updates user importAccessStatus if using paid access
 * - Marks paid access as used (hasUsedImportAccess = true)
 * - Filters out existing bookmarks to prevent duplicates
 * - Applies quota limits based on user access type
 * - Enqueues bookmarks to QStash processing queue
 * - Sets up batch processing with 50 bookmarks per batch
 */

defineRouteMeta({
  openAPI: {
    tags: ["Import"],
    summary: "Import bookmarks for a user",
    description: "Processes and imports bookmarks for a user with access validation, quota management, and session tracking. Supports different access types including free tier, subscription, and paid import access.",
    requestBody: {
      description: "Import request data",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              userId: {
                type: "string",
                description: "Parse User object ID",
                example: "abc123def456"
              },
              forceImport: {
                type: "boolean",
                description: "Bypass access restrictions (admin use)",
                default: false,
                example: false
              },
              importFromFile: {
                type: "boolean",
                description: "Extract bookmarks from user's uploaded file in 'importedBookmarks' column",
                default: false,
                example: false
              },
              importFromParseClass: {
                type: "boolean",
                description: "Import bookmarks ONLY from the Parse 'bookmarksToImport' class records for this user",
                default: false,
                example: false
              },
              bookmarksToImport: {
                type: "array",
                items: { type: "string" },
                description: "For k6 testing: Array of bookmark URLs to import directly from the request body",
                example: ["https://example.com/page1", "https://example.com/page2"]
              }
            },
            required: ["userId"]
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Import request processed successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              oneOf: [
                {
                  type: "object",
                  description: "Successful import initiation",
                  properties: {
                    message: {
                      type: "string",
                      example: "Enqueued 150 bookmarks for import"
                    },
                    accessStatus: {
                      type: "string",
                      enum: ["none", "paid", "importing", "completed", "expired"],
                      example: "importing"
                    },
                    session: {
                      type: "object",
                      properties: {
                        sessionId: {
                          type: "string",
                          example: "import_1640995200000_abc123def"
                        },
                        startedAt: {
                          type: "string",
                          format: "date-time",
                          example: "2023-12-31T23:59:59.999Z"
                        },
                        totalBookmarks: {
                          type: "integer",
                          example: 150
                        },
                        processedBookmarks: {
                          type: "integer",
                          example: 0
                        },
                        failedBookmarks: {
                          type: "integer",
                          example: 0
                        },
                        currentlyProcessing: {
                          type: "string",
                          nullable: true,
                          example: null
                        },
                        estimatedCompletion: {
                          type: "string",
                          format: "date-time",
                          nullable: true,
                          example: null
                        },
                        processingRate: {
                          type: "number",
                          description: "Bookmarks per minute",
                          example: 0
                        },
                        status: {
                          type: "string",
                          enum: ["active", "paused", "completed", "failed"],
                          example: "active"
                        },
                        lastProgressUpdate: {
                          type: "string",
                          format: "date-time",
                          example: "2023-12-31T23:59:59.999Z"
                        }
                      }
                    }
                  },
                  required: ["message", "accessStatus", "session"]
                },
                {
                  type: "object",
                  description: "Access denied response",
                  properties: {
                    error: {
                      type: "string",
                      example: "Free limit reached (100 bookmarks). Please upgrade or purchase import access."
                    },
                    accessStatus: {
                      type: "string",
                      enum: ["none", "paid", "importing", "completed", "expired"],
                      example: "completed"
                    },
                    expiresAt: {
                      type: "string",
                      format: "date-time",
                      nullable: true,
                      example: "2024-01-31T23:59:59.999Z"
                    }
                  },
                  required: ["error", "accessStatus"]
                },
                {
                  type: "object",
                  description: "Error response",
                  properties: {
                    error: {
                      type: "string",
                      example: "User not found"
                    },
                    userId: {
                      type: "string",
                      example: "abc123def456"
                    }
                  },
                  required: ["error", "userId"]
                }
              ]
            }
          }
        }
      },
      "400": {
        description: "Bad request - missing or invalid parameters",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: {
                  type: "string",
                  example: "Missing required parameter: userId"
                }
              }
            }
          }
        }
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: {
                  type: "string",
                  example: "Database connection failed"
                },
                userId: {
                  type: "string",
                  example: "abc123def456"
                }
              }
            }
          }
        }
      }
    },
    'x-access-types': {
      description: 'Different user access types and their behaviors',
      types: {
        'free': {
          description: 'Free tier users with 100 bookmark limit',
          quota: 100,
          ignoreSubscriptionLimits: false
        },
        'subscription': {
          description: 'Paid subscription users with plan-based limits',
          quota: 'Based on subscription plan (typically 5000)',
          ignoreSubscriptionLimits: false
        },
        'paid-import': {
          description: 'Users with active paid import access',
          quota: 'Unlimited during access period',
          ignoreSubscriptionLimits: true
        },
        'expired-but-unused': {
          description: 'Users with expired paid access who never used it',
          quota: 'One-time unlimited import allowed',
          ignoreSubscriptionLimits: true
        },
        'completed-under-limit': {
          description: 'Users who completed import but have under 100 bookmarks',
          quota: 'Additional imports up to 100 total',
          ignoreSubscriptionLimits: false
        },
        'force': {
          description: 'Admin force import bypassing all restrictions',
          quota: 'Unlimited',
          ignoreSubscriptionLimits: true
        }
      }
    },
    'x-side-effects': {
      description: 'Side effects of successful import initiation',
      effects: [
        'Creates import session with tracking data',
        'Updates user importAccessStatus if using paid access',
        'Marks paid access as used (hasUsedImportAccess = true)',
        'Filters out existing bookmarks to prevent duplicates',
        'Applies quota limits based on user access type',
        'Enqueues bookmarks to QStash processing queue',
        'Sets up batch processing with 50 bookmarks per batch'
      ]
    }
  }
});

export default defineEventHandler(async (event): Promise<ImportBookmarksResponse> => {
    const body = await readBody(event) as ImportBookmarksRequest;
    const userId = body.userId;
    const forceImport = body.forceImport || false;
    const importFromFile = body.importFromFile || false;
    const importFromParseClass = body.importFromParseClass || false;
    const limitExistingDuplicates = body.limitExistingDuplicates || false;
    const bookmarksFromRequest = body.bookmarksToImport || []; // For k6 testing
    const fromCache = body.fromCache || false; // For k6 testing

    try {
        console.log(`[importBookmarks] Importing bookmarks for user: ${userId}, forceImport: ${forceImport}, importFromFile: ${importFromFile}, importFromParseClass: ${importFromParseClass}, bookmarksFromRequest: ${bookmarksFromRequest.length}`);

        const userQuery = new Parse.Query(Parse.User);
        userQuery.include('websiteUrls', 'currentPlan', 'bookmarksToImport');
        userQuery.equalTo('objectId', userId);
        const user = await userQuery.get(userId, { useMasterKey: true });

        let bookmarksToImport: string[] = user.get('bookmarksToImport') || [];

        // If bookmarks are provided directly in the request body (for k6 testing), use them
        if (bookmarksFromRequest.length > 0) {
            log(`[importBookmarks] Using ${bookmarksFromRequest.length} bookmarks from request body (k6 testing mode)`);
            const combinedBookmarks = Array.from(new Set([...bookmarksToImport, ...bookmarksFromRequest]));
            user.set('bookmarksToImport', combinedBookmarks);
            bookmarksToImport = combinedBookmarks;
            await user.save(null, { useMasterKey: true });
        }

        bookmarksToImport = bookmarksToImport.slice(0, 100);

        console.log(`[importBookmarks] bookmarksToImport length 1: ${bookmarksToImport.length}`);

        // Handle file import if requested
        if (importFromFile) {
            log(`Processing file import for user:, ${userId}`);
            const fileBookmarks = await extractBookmarksFromFile(user);
            
            if (fileBookmarks && fileBookmarks.length > 0) {
                const combinedBookmarks = Array.from(new Set([...bookmarksToImport, ...fileBookmarks]));
                user.set('bookmarksToImport', combinedBookmarks);
                bookmarksToImport = combinedBookmarks;
                await user.save(null, { useMasterKey: true });
                log(`Added ${fileBookmarks.length} bookmarks from file. Total: ${combinedBookmarks.length}`);
            } else {
                log('No bookmarks found in file or file not accessible');
            }
        }

        // Handle import from Parse class if requested
        if (importFromParseClass) {
            log(`Processing import from Parse BookmarksToImport class for user: ${userId}`);
            const bookmarksQuery = new Parse.Query(BookmarksToImport);
            bookmarksQuery.equalTo('user', user);
            bookmarksQuery.select('url');
            const bookmarkRecords = await bookmarksQuery.find({ useMasterKey: true });

            if (bookmarkRecords && bookmarkRecords.length > 0) {
                const parseClassBookmarks = bookmarkRecords.map(record => record.get('url')).filter((url): url is string => !!url);
                bookmarksToImport = parseClassBookmarks;
                log(`Found ${parseClassBookmarks.length} bookmarks in Parse BookmarksToImport class`);
            } else {
                log('No bookmarks found in Parse BookmarksToImport class');
                bookmarksToImport = [];
            }
        }

        // Get access check for processing logic (validate once)
        const accessCheck: AccessCheck = forceImport ?
            { hasAccess: true, accessType: 'force', ignoreSubscriptionLimits: true } :
            await validateImportAccess(user);

        // Check import access using validation result
        if (!forceImport && !accessCheck.hasAccess) {
            log(`Import access denied:' ${accessCheck.reason}`);
            const activeSession = await ImportSessionManager.getActiveSession(user);
            return {
                error: accessCheck.reason,
                accessStatus: activeSession ? activeSession.get('status') : 'none',
                expiresAt: user.get('importAccessExpiresAt')
            };
        }

        if (forceImport) console.log('[importBookmarks] Force import enabled - bypassing access restrictions');

        console.log(`_____________`);
        console.log(`[importBookmarks] bookmarksToImport length 2: ${bookmarksToImport.length}`);
        console.log(`_____________`);

        // Check if user is already importing
        const existingSession = await ImportSessionManager.getActiveSession(user);
        if (
            existingSession &&
            !importFromParseClass
        ) {
            log(`Import already in progress for user: ${userId}`);
            return {
                error: 'Import already in progress. Please wait for current import to complete.',
                accessStatus: existingSession.get('status'),
                importing: true,
                session: ImportSessionManager.getSessionData(existingSession)
            };
        }

        // Remember the access state so a cancel can give it back
        const previousImportAccess = {
            importAccessStatus: user.get('importAccessStatus') || 'none',
            hasUsedImportAccess: user.get('hasUsedImportAccess') || false
        };

        // Mark paid access as used for special cases
        if (user.get('importAccessStatus') === 'paid' ||
            accessCheck.accessType === 'expired-but-unused' ||
            accessCheck.accessType === 'free-with-paid-access') {
            user.set('hasUsedImportAccess', true);
        }

        // Set user status to 'importing' when starting the import
        user.set('importAccessStatus', 'importing');

        // Apply limits based on access type FIRST
        const limitedBookmarks = await applyImportLimits(user, bookmarksToImport, accessCheck);

        console.log('[importBookmarks] limitedBookmarks length 3: ', limitedBookmarks.length);

        let finalBookmarks = limitedBookmarks;
        
        // Fetch all items from the 'websites' class that have the same user as the userId
        if(limitExistingDuplicates){
            const existingUrls = await getExistingUrls(user);
            // Filter out existing bookmarks
            finalBookmarks = await filterExistingBookmarks(user, limitedBookmarks, existingUrls);
        }

        // Create session using unified ImportSessionManager
        const sessionId = generateSessionId();
        const batchId = generateBatchId();
        const importSession = await ImportSessionManager.createSession(
            user,
            sessionId,
            batchId,
            finalBookmarks.length,
            bookmarksToImport.length,
            finalBookmarks.length,
            accessCheck.accessType
        );
        importSession.set('previousImportAccess', previousImportAccess);

        // Send initial status update
        const now = new Date();
        await ImportSessionManager.updateStatus(importSession, {
            type: 'session-started',
            timestamp: now
        });

        // Initialize batch tracking with FILTERED count
        const BATCH_SIZE = 50; // Process 50 bookmarks per batch
        user.set('currentImportBatch', {
            batchId: `batch_${sessionId}_0`,
            batchIndex: 0,
            totalBatches: Math.ceil(finalBookmarks.length / BATCH_SIZE),
            batchStartTime: now,
            batchSize: BATCH_SIZE,
            bookmarksInCurrentBatch: 0
        });

        // Create individual BookmarksToImport records for each bookmark
        log(`[importBookmarks] 🔄 Creating ${finalBookmarks.length} BookmarksToImport records for user ${userId}`);

        const bookmarkObjects: Parse.Object[] = [];

        for (const url of finalBookmarks) {
            const bookmarkRecord = new BookmarksToImport();
            bookmarkRecord.set('user', user);
            bookmarkRecord.set('url', url);
            bookmarkRecord.set('importBatch', batchId);
            bookmarkRecord.setACL(new Parse.ACL(user));
            bookmarkObjects.push(bookmarkRecord);
            log(`[importBookmarks] 📝 Created record for URL: ${url} with batch ID: ${batchId}`);
        }

        // Save all bookmark records in batch
        if (bookmarkObjects.length > 0) {
            log(`[importBookmarks] 💾 Saving ${bookmarkObjects.length} BookmarksToImport records to database...`);
            try {
                const savedRecords = await Parse.Object.saveAll(bookmarkObjects, { useMasterKey: true });
                log(`[importBookmarks] ✅ Successfully saved ${savedRecords.length} BookmarksToImport records`);

                //// Verify records were saved by querying them back
                // const verifyQuery = new Parse.Query(BookmarksToImport);
                // verifyQuery.equalTo('user', user);
                // const savedCount = await verifyQuery.count({ useMasterKey: true });
                // log(`[importBookmarks] 🔍 Verification: Found ${savedCount} BookmarksToImport records in database for user ${userId}`);
            } catch (saveError: any) {
                errorLog(`[importBookmarks] ❌ Error saving BookmarksToImport records:`, saveError);
                throw saveError;
            }
        } else {
            log(`[importBookmarks] ⚠️ No bookmark records to save for user ${userId}`);
        }

        user.set('importing', finalBookmarks.length > 0);
        await user.save(null, { useMasterKey: true });

        // A cancel that landed while the rows were being saved may have missed
        // some of them, and the save above re-marked the user as importing
        if (await ImportSessionManager.isSessionCancelled(importSession.id)) {
            await discardCancelledImport(user, importSession, batchId);
            return { success: true, cancelled: true, message: 'Import was cancelled' };
        }

        // Enqueue bookmarks with enhanced status tracking
        const cancelled = await enqueueBookmarks(userId, finalBookmarks, accessCheck, importSession);
        // Also catch a cancel that landed after the loop's last check
        if (cancelled || await ImportSessionManager.isSessionCancelled(importSession.id)) {
            await ensureSessionCancelled(importSession);
            return { success: true, cancelled: true, message: 'Import was cancelled' };
        }

        // Send final session initialization status
        await ImportSessionManager.updateStatus(importSession, {
            type: 'import-initialized',
            message: `Successfully initialized import for ${finalBookmarks.length} bookmarks`,
            timestamp: new Date()
        });

        return {
            success: true,
            message: `Enqueued ${finalBookmarks.length} bookmarks for import`,
            accessStatus: importSession.get('status'),
            session: ImportSessionManager.getSessionData(importSession),
            stats: {
                originalCount: bookmarksToImport.length,
                filteredCount: finalBookmarks.length,
                skippedDuplicates: bookmarksToImport.length - finalBookmarks.length,
                estimatedDuration: Math.ceil(finalBookmarks.length / 10) + ' minutes'
            },
            tracking: {
                sessionId: sessionId,
                statusEndpoint: `/v1/importStatus?userId=${userId}`,
                realTimeUpdates: true
            }
        };
    } catch (error: any) {
        errorLog("[importBookmarks] Error enqueueing bookmark imports for user: ", userId, error.message);

        // Update session with error state using ImportSessionManager
        try {
            const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
            const session = await ImportSessionManager.getActiveSession(user);
            if (session) {
                await ImportSessionManager.markAsFailed(session, error.message, user);
            }
        } catch (updateError) {
            errorLog("[importBookmarks] Failed to update session with error:", updateError);
        }

        return {
            success: false,
            error: error.message,
            userId,
            timestamp: new Date().toISOString()
        };
    }
});

// Helper functions

async function extractBookmarksFromFile(user: Parse.User): Promise<string[]> {
    try {
        const importedBookmarksFile = user.get('importedBookmarks');
        if (!importedBookmarksFile) {
            log('[importBookmarks] No importedBookmarks file found for user');
            return [];
        }

        const fileUrl = importedBookmarksFile.url();
        const fileExtension = fileUrl.split('.').pop()?.toLowerCase() || '';

        log(`[importBookmarks] Extracting bookmarks from ${fileExtension} file: ${fileUrl}`);

        let bookmarks: string[] = [];

        // Fetch file content
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`[importBookmarks] Failed to fetch file: ${response.statusText}`);
        }

        const fileContent = await response.text();

        switch (fileExtension) {
            case 'html':
                bookmarks = extractBookmarksFromHtml(fileContent);
                break;
            case 'txt':
                bookmarks = extractBookmarksFromTxt(fileContent);
                break;
            case 'csv':
                bookmarks = extractBookmarksFromCsv(fileContent);
                break;
            default:
                log(`Unsupported file extension: ${fileExtension}`);
                return [];
        }

        // Remove duplicates and filter valid URLs
        bookmarks = Array.from(new Set(bookmarks));
        bookmarks = bookmarks.filter(url => isValidUrl(url));

        log(`[importBookmarks] Extracted ${bookmarks.length} valid bookmarks from file`);
        return bookmarks;

    } catch (error) {
        errorLog('[importBookmarks] Error extracting bookmarks from file:', error);
        return [];
    }
}

function extractBookmarksFromHtml(htmlContent: string): string[] {
    try {
        // Use regex to find href attributes since we don't have DOM parser in Node.js
        const hrefRegex = /href=["']([^"']*)["']/gi;
        const bookmarks: string[] = [];
        let match;

        while ((match = hrefRegex.exec(htmlContent)) !== null) {
            const url = match[1];
            if (url && url.startsWith('http')) {
                bookmarks.push(url);
            }
        }

        return bookmarks;
    } catch (error) {
        errorLog('[importBookmarks] Error parsing HTML content:', error);
        return [];
    }
}

function extractBookmarksFromTxt(txtContent: string): string[] {
    try {
        let bookmarks = txtContent.replace(/,/g, '\n');
        bookmarks = bookmarks.replace(/\n+/g, '\n').trim();
        const bookmarkArray = bookmarks.split('\n');
        return bookmarkArray.filter(url => url.trim().length > 0);
    } catch (error) {
        errorLog('[importBookmarks] Error parsing TXT content:', error);
        return [];
    }
}

function extractBookmarksFromCsv(csvContent: string): string[] {
    try {
        let bookmarks = csvContent.replace(/,/g, '\n');
        bookmarks = bookmarks.replace(/\n+/g, '\n').trim();
        const bookmarkArray = bookmarks.split('\n');
        return bookmarkArray.filter(url => url.includes('http'));
    } catch (error) {
        errorLog('[importBookmarks] Error parsing CSV content:', error);
        return [];
    }
}

function isValidUrl(string: string): boolean {
    try {
        // Trim whitespace
        const trimmed = string.trim();

        // Reject common non-URL schemes
        const invalidPrefixes = [
            'javascript:',
            'data:',
            'mailto:',
            'tel:',
            'file:',
            'ftp:',
            'about:',
            'chrome:',
            'edge:',
            'brave:',
            'opera:',
            'vivaldi:'
        ];

        const lowerCased = trimmed.toLowerCase();
        if (invalidPrefixes.some(prefix => lowerCased.startsWith(prefix))) {
            return false;
        }

        // Try to parse as URL
        const url = new URL(trimmed);

        // Only allow http and https protocols
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function applyImportLimits(user: Parse.User, bookmarks: string[], accessCheck: AccessCheck): Promise<string[]> {
    const quota = calculateQuotaInfo(user, accessCheck);

    // No limits for paid import users and force imports
    if (accessCheck.accessType === 'paid-import' ||
        accessCheck.accessType === 'force' ||
        accessCheck.accessType === 'expired-but-unused' ||
        accessCheck.accessType === 'free-with-paid-access') {
        console.log('returning 1: ', bookmarks.length);
        return bookmarks;
    }

    // Subscription and free users are both bounded by the plan's bookmark
    // limit, which `calculateQuotaInfo` already resolved — the subscription
    // branch used to re-derive it from `websiteCount`, a column nothing writes,
    // and fell back to a hard-coded 10000 when the pointer was cold.
    if (accessCheck.accessType === 'subscription' ||
        accessCheck.accessType === 'free' ||
        accessCheck.accessType === 'completed-under-limit') {
        if (quota.unlimited) return bookmarks;
        console.log('[importBookmarks] remaining slots: ', quota.remaining);
        return bookmarks.slice(0, quota.remaining || 0);
    }

    console.log('[importBookmarks] returning 0');
    return [];
}

async function filterExistingBookmarks(user: Parse.User, bookmarks: string[], existingUrls: string[]): Promise<string[]> {
    return bookmarks.filter(bookmark => !existingUrls.includes(bookmark));
}

/**
 * The status updates this request makes (e.g. 'session-started') can overwrite a
 * cancel that landed in between; cancelledAt survives, so put the status back.
 */
async function ensureSessionCancelled(importSession: Parse.Object): Promise<void> {
    if (importSession.get('status') === 'cancelled') return;
    importSession.set('status', 'cancelled');
    importSession.set('currentlyProcessing', null);
    await importSession.save(null, { useMasterKey: true });
}

/**
 * Removes the rows of an import cancelled while it was being set up and
 * resets the user's import state, mirroring v1/import/cancelImport.
 */
async function discardCancelledImport(user: Parse.User, importSession: Parse.Object, batchId: string): Promise<void> {
    await ensureSessionCancelled(importSession);

    while (true) {
        const query = new Parse.Query(BookmarksToImport);
        query.equalTo('user', user);
        query.equalTo('importBatch', batchId);
        query.limit(500);
        const rows = await query.find({ useMasterKey: true });
        if (rows.length === 0) break;
        await Parse.Object.destroyAll(rows, { useMasterKey: true }).catch((error: any) => {
            // Rows already deleted by the cancel endpoint are fine
            const errors = error?.code === Parse.Error.AGGREGATE_ERROR ? (error.errors || []) : [error];
            if (errors.some((e: any) => e?.code !== Parse.Error.OBJECT_NOT_FOUND)) throw error;
        });
    }

    // Give back the access state from before this import, as cancelImport does
    const previous = importSession.get('previousImportAccess');
    user.set('importing', false);
    if (previous && previous.importAccessStatus !== 'importing') {
        user.set('importAccessStatus', previous.importAccessStatus);
        user.set('hasUsedImportAccess', !!previous.hasUsedImportAccess);
    } else {
        user.set('importAccessStatus', 'completed');
    }
    user.set('currentImportBatch', null);
    user.set('activeImportSessionId', null);
    await user.save(null, { useMasterKey: true });
}

/**
 * Sends one QStash message per bookmark. Returns true if it stopped early
 * because the import was cancelled.
 */
async function enqueueBookmarks(userId: string, bookmarks: string[], accessCheck: AccessCheck, importSession: Parse.Object): Promise<boolean> {
    const batchSize = Number(process.env.QSTASH_IMPORT_BATCH_SIZE) || 10;
    const totalBatches = Math.ceil(bookmarks.length / batchSize);

    // Define milestone percentages for status updates
    const milestones = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];
    const milestoneBatches = new Set(milestones.map(m => Math.floor(totalBatches * m)));

    for (let i = 0; i < bookmarks.length; i += batchSize) {
        const batch = bookmarks.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize);

        // Stop queuing if the user cancelled the import
        if (await ImportSessionManager.isSessionCancelled(importSession.id)) {
            console.log(`[importBookmarks] Import cancelled for user ${userId}, stopping queuing at ${i}/${bookmarks.length}`);
            return true;
        }

        // Only send status updates at milestone percentages (10%, 20%, 30%, 40% ...)
        if (milestoneBatches.has(batchIndex)) {
            const percentage = Math.round((batchIndex / totalBatches) * 100);
            await ImportSessionManager.updateStatus(importSession, {
                type: 'queuing-progress',
                batchIndex: batchIndex,
                totalBatches: totalBatches,
                message: `${percentage}% of bookmarks queued`,
                timestamp: new Date()
            });
        }

        let bookmarksToSaveParse;
        let enqueuedBookmarks = [];

        // const queueName = `bookmarkImportRequests-${userId}`;
        for (const url of batch) {
          const objToSend = {
                type: 'bookmark-import-requests',
                data: {
                    userId,
                    url,
                    accessType: accessCheck.accessType,
                    ignoreSubscriptionLimits: accessCheck.ignoreSubscriptionLimits || false,
                    importSessionId: importSession.id,
                    batchIndex: batchIndex,
                    urlIndex: i + batch.indexOf(url),
                    totalUrls: bookmarks.length,
                    queuedAt: new Date().toISOString()
                }
            };
            enqueuedBookmarks.push(objToSend);
            await sendToQstash(objToSend, {isBatch: false, queueName: getPartitionedQueue('bookmarkImportRequests-import')});
          }


        // Small delay between batches to prevent overwhelming the queue
        if (i + batchSize < bookmarks.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Send final queuing complete status
    await ImportSessionManager.updateStatus(importSession, {
        type: 'queuing-completed',
        totalBatches: totalBatches,
        timestamp: new Date()
    });
    return false;
}

function generateSessionId(): string {
  return 'import_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateBatchId(): string {
  return 'batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
