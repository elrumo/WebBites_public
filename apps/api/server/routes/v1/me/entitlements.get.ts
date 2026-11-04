/**
 * GET /v1/me/entitlements — everything a client needs to gate its UI.
 *
 * This exists so no client has to know which Parse columns hold a plan. Before
 * it, the web app fetched `_User.currentPlan` and read limit columns off the
 * pointer, the Raycast extension got a bare `usage` object with no limits to
 * compare it against, and the native app had no way to ask at all. Each of them
 * re-derived "is this user paid?" differently.
 *
 * One request answers: what plan, what limits, how much is spent, what is
 * unlocked, and whether a one-off import is available.
 */

import { defineEventHandler, createError } from 'h3';
import Parse from 'parse/node.js';
import { validateApiKeyFromEvent } from '#root/server/utils/api-keys';
import { getUserWithPlan, buildEntitlements } from '#root/server/utils/plans';
import {
    validateImportAccess,
    isUnlimitedAccess,
    calculateQuotaInfo,
    generateAccessReason,
} from '#root/server/utils/serverUtils.js';
import type { EntitlementsResponse } from '#root/server/types/plan.types';

Parse.initialize(
    process.env.VITE_PARSE_ID as string,
    process.env.VITE_PARSE_JS_KEY as string,
    process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

defineRouteMeta({
    openAPI: {
        tags: ['Plans'],
        summary: "Get the authenticated user's plan, quotas and feature entitlements",
        description:
            'The single endpoint clients should use to decide what to show and what to gate. Replaces reading plan columns off the Parse user row.',
        parameters: [
            {
                name: 'authorization',
                in: 'header',
                required: true,
                description: 'Bearer API key.',
                schema: { type: 'string', example: 'Bearer wb_live_abc123' },
            },
        ],
        responses: {
            200: {
                description: 'Entitlements resolved',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                success: { type: 'boolean' },
                                userId: { type: 'string' },
                                plan: { type: 'object', description: 'The plan row, normalised.' },
                                usage: { type: 'object', description: 'Live quotas for the current month.' },
                                features: { type: 'object', description: 'Boolean entitlements. Gate on these.' },
                                importAccess: { type: 'object' },
                            },
                        },
                    },
                },
            },
            401: { description: 'Unauthorized' },
        },
    },
});

export default defineEventHandler(async (event): Promise<EntitlementsResponse> => {
    const userId = await validateApiKeyFromEvent(event);
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    const { user, plan } = await getUserWithPlan(userId);

    // Import access is bought separately from any subscription and deliberately
    // survives a downgrade, so it is reported alongside the plan rather than
    // folded into it.
    const access = await validateImportAccess(user);
    const importQuota = calculateQuotaInfo(user, access);
    const expiresAt = user.get('importAccessExpiresAt') as Date | undefined;

    return {
        success: true,
        userId,
        // plan, usage, features and planSource — the same four fields
        // /v1/me/plan/refresh and /v1/me/plan/appstore answer with.
        ...buildEntitlements(user, plan),
        importAccess: {
            status: user.get('importAccessStatus') || 'none',
            hasAccess: Boolean(access.hasAccess),
            accessType: access.accessType,
            reason: access.reason || generateAccessReason(access, importQuota),
            unlimited: isUnlimitedAccess(access.accessType),
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            hasUsedAccess: Boolean(user.get('hasUsedImportAccess')),
        },
        // Billing diagnostics, for rendering "renews on…" or "payment failed".
        // `syncedAt` is how old this snapshot is; the plan and features above
        // are the things to gate on. POST /v1/me/plan/refresh forces an update.
        subscription: {
            customerId: user.get('stripeCustomerId') ?? null,
            subscriptionId: user.get('stripeSubscriptionId') ?? null,
            status: user.get('stripeSubscriptionStatus') ?? null,
            currentPeriodEnd: toIso(user.get('stripeCurrentPeriodEnd')),
            syncedAt: toIso(user.get('planSyncedAt')),
        },
    };
});

function toIso(value: Date | undefined | null): string | null {
    return value instanceof Date ? value.toISOString() : null;
}
