/**
 * v1/sync/reconcileBookmarkCounts - Reconcile bookmark counts for a user
 *
 * This endpoint synchronizes the usage.currentMonth.bookmarksTotal field with
 * the actual bookmarksTotal counter. This is useful for fixing sync issues
 * caused by race conditions during bulk imports.
 */

import { defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';

// Initialize Parse
Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

interface ReconcileRequest {
  userId: string;
}

interface ReconcileResponse {
  success: boolean;
  actualTotal?: number;
  syncedTotal?: number;
  previousTotal?: number;
  difference?: number;
  error?: string;
  timestamp?: string;
}

function getCurrentMonthString(date = new Date()): string {
  return `${date.getMonth() + 1}/${date.getFullYear()}`;
}

/**
 * OpenAPI Specification
 */
defineRouteMeta({
  openAPI: {
    tags: ["Sync"],
    summary: "Reconcile bookmark counts for a user",
    description: "Synchronizes the usage.currentMonth.bookmarksTotal field with the actual bookmarksTotal counter. Useful for fixing sync issues caused by race conditions during bulk imports.",
    requestBody: {
      description: "Reconcile request data",
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
              }
            },
            required: ["userId"]
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Reconciliation completed successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true
                },
                actualTotal: {
                  type: "integer",
                  description: "The actual bookmarksTotal value from the database",
                  example: 95
                },
                syncedTotal: {
                  type: "integer",
                  description: "The synced usage.currentMonth.bookmarksTotal value",
                  example: 95
                },
                previousTotal: {
                  type: "integer",
                  description: "The previous usage.currentMonth.bookmarksTotal value before sync",
                  example: 85
                },
                difference: {
                  type: "integer",
                  description: "The difference that was corrected (actualTotal - previousTotal)",
                  example: 10
                },
                timestamp: {
                  type: "string",
                  format: "date-time",
                  example: "2023-12-31T23:59:59.999Z"
                }
              }
            }
          }
        }
      },
      "400": {
        description: "Bad request - missing or invalid userId",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: false
                },
                error: {
                  type: "string",
                  example: "Missing required parameter: userId"
                }
              }
            }
          }
        }
      },
      "404": {
        description: "User not found",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: false
                },
                error: {
                  type: "string",
                  example: "User not found"
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
                success: {
                  type: "boolean",
                  example: false
                },
                error: {
                  type: "string",
                  example: "Failed to reconcile bookmark counts"
                },
                timestamp: {
                  type: "string",
                  format: "date-time"
                }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event): Promise<ReconcileResponse> => {
  const body = await readBody(event) as ReconcileRequest;
  const userId = body.userId;

  if (!userId) {
    return {
      success: false,
      error: 'Missing required parameter: userId',
      timestamp: new Date().toISOString()
    };
  }

  try {
    console.log(`[reconcileBookmarkCounts] Starting reconciliation for user: ${userId}`);

    const userQuery = new Parse.Query(Parse.User);
    let user: Parse.User;

    try {
      user = await userQuery.get(userId, { useMasterKey: true });
    } catch (error: any) {
      console.error(`[reconcileBookmarkCounts] User not found: ${userId}`, error.message);
      return {
        success: false,
        error: 'User not found',
        timestamp: new Date().toISOString()
      };
    }

    const websitesQuery = new Parse.Query('websites');
    websitesQuery.equalTo('user', user);
    websitesQuery.notEqualTo('isDeleted', true);

    const realTotal = await websitesQuery.count({ useMasterKey: true }) || 0;
    const actualTotal = realTotal;
    const usage = user.get('usage') || { currentMonth: {}, pastMonths: [] };
    const currentMonthStr = getCurrentMonthString();

    console.log(`[reconcileBookmarkCounts] Real total: ${realTotal}, Actual total: ${actualTotal}`);

    // Store previous value for reporting
    const previousTotal = usage.currentMonth?.bookmarksTotal || 0;

    // Initialize currentMonth if needed
    if (!usage.currentMonth || usage.currentMonth.month !== currentMonthStr) {
      usage.currentMonth = {
        month: currentMonthStr,
        bookmarksTotal: realTotal,
        bookmarksThisMonth: 0,
        filesUploaded: usage.currentMonth?.filesUploaded || 0,
        audiosGenerated: usage.currentMonth?.audiosGenerated || 0
      };
    } else {
      // Sync the usage.currentMonth.bookmarksTotal with the actual bookmarksTotal
      usage.currentMonth.bookmarksTotal = realTotal;
    }

    user.set('bookmarksTotal', realTotal);
    user.set('usage', usage);
    await user.save(null, { useMasterKey: true });

    const difference = actualTotal - previousTotal;

    console.log(
      `[reconcileBookmarkCounts] ✅ Synced for user ${userId}: ${previousTotal} → ${actualTotal} (difference: ${difference > 0 ? '+' : ''}${difference})`
    );

    return {
      success: true,
      actualTotal,
      syncedTotal: actualTotal,
      previousTotal,
      difference,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('[reconcileBookmarkCounts] Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to reconcile bookmark counts',
      timestamp: new Date().toISOString()
    };
  }
});
