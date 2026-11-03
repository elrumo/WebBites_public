/**
 * POST /v1/auth/device/poll — the CLI asking whether its browser sign-in has
 * been answered (`deviceAuthRules.ts`).
 *
 * Public: the `deviceCode` is the credential, and only the CLI that started
 * the request has it. An approval's API key is handed out exactly once.
 */

import { createError, defineEventHandler, readBody } from 'h3';
import { ensureRedisConnected, getRedisClient } from '#root/server/utils/redis';
import { deviceKey, type DeviceAuthRequest } from '#root/server/utils/deviceAuthRules';

defineRouteMeta({
    openAPI: {
        tags: ['Authentication'],
        summary: 'Poll a device sign-in for its answer',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { type: 'object', properties: { deviceCode: { type: 'string' } }, required: ['deviceCode'] },
                },
            },
        },
        responses: {
            200: { description: '`{ status: "pending" | "denied" | "expired" }`, or `{ status: "approved", apiKey }` once.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const body = (await readBody(event).catch(() => ({}))) || {};
    if (typeof body.deviceCode !== 'string' || !body.deviceCode) {
        throw createError({ statusCode: 400, statusMessage: 'deviceCode is required' });
    }

    const redis = getRedisClient();
    await ensureRedisConnected();
    const key = deviceKey(body.deviceCode);
    const raw = await redis.get(key);
    if (!raw) return { status: 'expired' };

    const request = JSON.parse(raw) as DeviceAuthRequest;
    if (request.status === 'pending') return { status: 'pending' };

    // Answered: whichever poll deletes the row reports it, so the key leaves
    // the server once even if two polls race.
    if (!(await redis.del(key))) return { status: 'expired' };
    return request.status === 'approved'
        ? { status: 'approved', apiKey: request.apiKey }
        : { status: 'denied' };
});
