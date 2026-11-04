/**
 * POST /v1/auth/verifyEmailChange — finish an email change.
 *
 * Public on purpose: the token is the credential. It arrives in the email we
 * sent to the new address, so holding it proves the inbox is the user's. The
 * person clicking may be on a phone that isn't signed in at all.
 *
 * On success the account's email (and, for email sign-ups, its username)
 * becomes the new address and the old address is told about it.
 */

import { defineEventHandler, readBody } from 'h3';
import { confirmEmailChange } from '#root/server/utils/emailChange';

defineRouteMeta({
    openAPI: {
        tags: ['Account'],
        summary: 'Confirm an email change with the token from the verification email',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: { token: { type: 'string', description: 'The `token` query parameter from the link.' } },
                        required: ['token'],
                    },
                },
            },
        },
        responses: {
            200: { description: '`{ success: true, email }` — the account now uses `email`.' },
            400: { description: 'INVALID_TOKEN: unknown, malformed or already used' },
            409: { description: 'EMAIL_TAKEN: another account took the address after the link was sent' },
            410: { description: 'EXPIRED_TOKEN' },
            503: { description: 'BILLING_UNAVAILABLE: Stripe could not be reached; retry' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const body = (await readBody(event).catch(() => ({}))) || {};
    return { success: true, ...(await confirmEmailChange(body.token)) };
});
