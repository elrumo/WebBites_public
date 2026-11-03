/**
 * GET /raycast/raycast-user — the Raycast extension's profile + entitlements call.
 *
 * This used to return a bare `usage` object and an `isPremium` flag read off
 * `userOptions`, a column nothing maintains. The extension therefore had counts
 * with no limits to compare them against, and a premium flag that was false for
 * every paying user.
 *
 * It now returns the same `plan` / `usage` / `features` / `importAccess` shape
 * as `GET /v1/me/entitlements`, built from the same helpers. The extension
 * cannot call that endpoint directly — it authenticates with a Parse session
 * token and `/v1/me/entitlements` takes an API key — so the shape comes here
 * instead of the route.
 *
 * Gate on `features.*` and `usage.*.exceeded`, never on `plan.planId`.
 */

import { defineEventHandler, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireRaycastAuth } from '../../utils/raycast-auth.js'
import {
  getUserWithPlan,
  getUsageSummary,
  getPlanFeatures,
  serializePlan,
  isPaidPlan
} from '../../utils/plans.ts'
import {
  validateImportAccess,
  isUnlimitedAccess,
  calculateQuotaInfo,
  generateAccessReason
} from '../../utils/serverUtils.js'

Parse.initialize(import.meta.env.VITE_PARSE_ID, import.meta.env.VITE_PARSE_JS_KEY, import.meta.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = import.meta.env.VITE_PARSE_URL

defineRouteMeta({
  openAPI: {
    tags: ["Raycast User"],
    description: "Get the authenticated user's profile, plan, live quotas and feature entitlements. Mirrors GET /v1/me/entitlements, which the extension cannot call directly because it authenticates with a Parse session token.",
    parameters: [
      {
        name: "authorization",
        in: "header",
        description: "Bearer token (Parse session token)",
        required: true,
        schema: {
          type: "string",
          example: "Bearer r:abc123def456..."
        }
      }
    ],
    responses: {
      "200": {
        description: "User information retrieved successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                userId: { type: "string" },
                user: {
                  type: "object",
                  description: "Profile fields only. Plan state lives in `plan`/`usage`/`features`.",
                  properties: {
                    id: { type: "string" },
                    username: { type: "string" },
                    email: { type: "string" },
                    bookmarkCount: { type: "integer", description: "Bookmarks in the user's savedSites relation." },
                    createdAt: { type: "string", format: "date-time" },
                    usage: {
                      type: "object",
                      description: "DEPRECATED — the raw `usage` column, with no limits attached. Read the top-level `usage` instead."
                    },
                    isPremium: {
                      type: "boolean",
                      description: "DEPRECATED — true for any paid plan. Gate on `features.*`, not on this."
                    }
                  }
                },
                plan: {
                  type: "object",
                  description: "The user's plan, normalised. Display only — do not gate on `planId` or `name`."
                },
                usage: {
                  type: "object",
                  description: "Live quotas: `bookmarks` and `audio`, each with used/limit/remaining/unlimited/exceeded."
                },
                features: {
                  type: "object",
                  description: "Boolean entitlements: aiSummaries, imageTagging, ocr, highResScreenshots, rssAutoExtract, smartBoards, backups. Gate on these."
                },
                importAccess: {
                  type: "object",
                  description: "One-off bookmark-import access, which is bought separately from any subscription."
                },
                subscription: {
                  type: "object",
                  description: "Stripe subscription snapshot, for rendering renewal or payment-failure notices. Diagnostics only."
                }
              }
            }
          }
        }
      },
      "401": {
        description: "Authentication failed",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 401 },
                statusMessage: { type: "string", example: "Invalid or expired session token" }
              }
            }
          }
        }
      },
      "500": {
        description: "Server error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: 500 },
                statusMessage: { type: "string", example: "Failed to retrieve user information" }
              }
            }
          }
        }
      }
    }
  }
});

export default defineEventHandler(async (event) => {
  try {
    const raycastUser = await requireRaycastAuth(event)

    // The session cache hands back a user that may not have `currentPlan`
    // included; `getUserWithPlan` resolves the pointer either way.
    const { user, plan } = await getUserWithPlan(raycastUser.user)

    const savedSitesRelation = user.relation('savedSites')
    const bookmarkCount = await savedSitesRelation.query().count({ useMasterKey: true })

    const access = await validateImportAccess(user)
    const importQuota = calculateQuotaInfo(user, access)
    const expiresAt = user.get('importAccessExpiresAt')

    return {
      success: true,
      userId: user.id,
      user: {
        id: user.id,
        username: user.get('username'),
        email: user.get('email'),
        bookmarkCount,
        createdAt: user.get('createdAt'),
        // Kept so an older extension build keeps working. Both are deprecated:
        // `usage` carries no limits, and `isPremium` is now derived from the
        // plan rather than read off the unmaintained `userOptions` column.
        usage: user.get('usage') || {},
        isPremium: isPaidPlan(plan)
      },
      plan: serializePlan(plan),
      usage: getUsageSummary(user, plan),
      features: getPlanFeatures(plan),
      importAccess: {
        status: user.get('importAccessStatus') || 'none',
        hasAccess: Boolean(access.hasAccess),
        accessType: access.accessType,
        reason: access.reason || generateAccessReason(access, importQuota),
        unlimited: isUnlimitedAccess(access.accessType),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        hasUsedAccess: Boolean(user.get('hasUsedImportAccess'))
      },
      // Billing diagnostics, mirroring /v1/me/entitlements. Snapshot values —
      // `syncedAt` says how old they are. Gate on `features`, not on `status`.
      subscription: {
        customerId: user.get('stripeCustomerId') ?? null,
        subscriptionId: user.get('stripeSubscriptionId') ?? null,
        status: user.get('stripeSubscriptionStatus') ?? null,
        currentPeriodEnd: toIso(user.get('stripeCurrentPeriodEnd')),
        syncedAt: toIso(user.get('planSyncedAt'))
      }
    }

  } catch (error) {
    console.error('Raycast get user error:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to retrieve user information'
    })
  }
})

function toIso(value) {
  return value instanceof Date ? value.toISOString() : null
}
