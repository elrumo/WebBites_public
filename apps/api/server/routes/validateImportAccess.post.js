import Parse from 'parse/node.js'
import { validateImportAccess, calculateQuotaInfo, isUnlimitedAccess, generateAccessReason } from '../utils/serverUtils.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY);
Parse.serverURL = import.meta.env.VITE_PARSE_URL;

defineRouteMeta({
  openAPI: {
    tags: ["Bookmark Import"],
    summary: "Validate bookmark import access for a user",
    description: "Checks if a user can import bookmarks and returns detailed access information including quota limits, access type, and restrictions. This endpoint can be used to validate access before attempting an import or to check current import capabilities.",
    requestBody: {
      description: "Validation request data",
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
        description: "Access validation result",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                hasAccess: {
                  type: "boolean",
                  description: "Whether the user can import bookmarks",
                  example: true
                },
                accessType: {
                  type: "string",
                  enum: ["free", "subscription", "subscription-legacy", "paid-import", "expired-but-unused", "free-with-paid-access", "completed-under-limit", "expired", "completed", "free-over-limit"],
                  description: "Type of access the user has",
                  example: "free"
                },
                reason: {
                  type: "string",
                  description: "Explanation of why the user can or cannot import",
                  example: "User has 50 remaining imports under free tier (50/100 used)"
                },
                quota: {
                  type: "object",
                  properties: {
                    remaining: {
                      type: "integer",
                      description: "Number of bookmarks the user can still import",
                      example: 50
                    },
                    total: {
                      type: "integer", 
                      description: "Total quota limit for the user",
                      example: 100
                    },
                    used: {
                      type: "integer",
                      description: "Number of bookmarks already imported",
                      example: 50
                    }
                  }
                },
                restrictions: {
                  type: "object",
                  properties: {
                    ignoreSubscriptionLimits: {
                      type: "boolean",
                      description: "Whether subscription limits are ignored for this user",
                      example: false
                    },
                    unlimited: {
                      type: "boolean", 
                      description: "Whether the user has unlimited import access",
                      example: false
                    }
                  }
                },
                currentStatus: {
                  type: "object",
                  properties: {
                    importAccessStatus: {
                      type: "string",
                      enum: ["none", "paid", "importing", "completed", "expired"],
                      example: "none"
                    },
                    expiresAt: {
                      type: "string",
                      format: "date-time",
                      nullable: true,
                      example: null
                    },
                    hasUsedImportAccess: {
                      type: "boolean",
                      example: false
                    }
                  }
                }
              },
              required: ["hasAccess", "accessType", "reason"]
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
      "404": {
        description: "User not found",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: {
                  type: "string",
                  example: "User not found"
                },
                userId: {
                  type: "string",
                  example: "abc123def456"
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
    }
  }
});

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const userId = body?.userId

    if (!userId) return { error: "Missing required parameter: userId" }

    try {
        log(`[validateImportAccess] Validating import access for user ${userId}`);

        const userQuery = new Parse.Query(Parse.User);
        userQuery.include('websiteUrls', 'currentPlan');
        userQuery.equalTo('objectId', userId);
        const user = await userQuery.get(userId, { useMasterKey: true });

        const accessCheck = await validateImportAccess(user);
        
        // Calculate quota information
        const quota = calculateQuotaInfo(user, accessCheck);
        
        // Build comprehensive response
        const response = {
            hasAccess: accessCheck.hasAccess,
            accessType: accessCheck.accessType,
            reason: accessCheck.reason || generateAccessReason(accessCheck, quota),
            quota: quota,
            restrictions: {
                ignoreSubscriptionLimits: accessCheck.ignoreSubscriptionLimits || false,
                unlimited: isUnlimitedAccess(accessCheck.accessType)
            },
            currentStatus: {
                importAccessStatus: user.get('importAccessStatus') || 'none',
                expiresAt: user.get('importAccessExpiresAt'),
                hasUsedImportAccess: user.get('hasUsedImportAccess') || false
            }
        };

        // log(`[validateImportAccess] Access validation result for user ${userId}:`, response);
        return response;

    } catch (error) {
        errorLog("Error validating import access for user:", userId, error.message);
        return { 
            error: error.message.includes('Object not found') ? 'User not found' : error.message,
            userId
        };
    }
})