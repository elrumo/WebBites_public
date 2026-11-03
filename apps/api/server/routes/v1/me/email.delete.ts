/**
 * DELETE /v1/me/email — cancel a pending email change.
 *
 * The link already sent stops working. The account's email was never changed,
 * so there is nothing else to undo.
 */

import { defineEventHandler } from 'h3';
import { requireUserId } from '#root/server/utils/requireUser';
import { cancelEmailChange } from '#root/server/utils/emailChange';

defineRouteMeta({
    openAPI: {
        tags: ['Account'],
        summary: 'Cancel a pending email change',
        responses: {
            200: { description: 'Cancelled. Same shape as `GET /v1/me/email`, with `pending: null`.' },
            401: { description: 'Not signed in' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event);
    return { success: true, ...(await cancelEmailChange(userId)) };
});
