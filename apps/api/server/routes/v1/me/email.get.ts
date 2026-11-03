/**
 * GET /v1/me/email — the account's email and any change waiting on verification.
 *
 * Settings reads this to decide what to show under the email field: the
 * address itself, whether changing it needs the current password, and — while
 * a change is pending — the new address, when the link expires and when the
 * resend button comes back.
 */

import { defineEventHandler } from 'h3';
import { requireUserId } from '#root/server/utils/requireUser';
import { getEmailStatus } from '#root/server/utils/emailChange';

defineRouteMeta({
    openAPI: {
        tags: ['Account'],
        summary: "Get the account's email and any pending change",
        responses: {
            200: {
                description: '`{ success, email, emailVerified, requiresPassword, pending: { email, sentAt, expiresAt, canResendAt } | null }`',
            },
            401: { description: 'Not signed in' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event);
    return { success: true, ...(await getEmailStatus(userId)) };
});
