/**
 * POST /v1/me/email — start changing the account's email address.
 *
 * Sends a verification link to the new address. The account keeps its current
 * email — for sign-in, password resets and billing — until that link is
 * opened (`POST /v1/auth/verifyEmailChange`). Posting again replaces the
 * pending change and sends a fresh link; the previous one stops working.
 *
 * Accounts with a password must send it: a session left open on a shared
 * computer should not be enough to move the account somewhere else. Posting
 * the address that is already pending is a resend and needs no password.
 */

import { defineEventHandler, readBody } from 'h3';
import { requireUserId } from '#root/server/utils/requireUser';
import { requestEmailChange } from '#root/server/utils/emailChange';

defineRouteMeta({
    openAPI: {
        tags: ['Account'],
        summary: 'Request an email change (sends a verification link to the new address)',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            email: { type: 'string', format: 'email', example: 'new@example.com' },
                            password: {
                                type: 'string',
                                description: 'Current password. Required when `GET /v1/me/email` reports `requiresPassword`, except to resend the pending address.',
                            },
                        },
                        required: ['email'],
                    },
                },
            },
        },
        responses: {
            200: { description: 'Verification email sent. Same shape as `GET /v1/me/email`.' },
            400: { description: 'INVALID_EMAIL, SAME_EMAIL, PASSWORD_REQUIRED or INCORRECT_PASSWORD' },
            409: { description: 'EMAIL_TAKEN' },
            429: { description: 'RESEND_COOLDOWN or DAILY_LIMIT, with `retryAfterSeconds`' },
            503: { description: 'EMAIL_SEND_FAILED' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event);
    const body = (await readBody(event).catch(() => ({}))) || {};
    return { success: true, ...(await requestEmailChange(userId, { email: body.email, password: body.password })) };
});
