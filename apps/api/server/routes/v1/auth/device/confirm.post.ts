/**
 * POST /v1/auth/device/confirm — the signed-in user's answer to a browser
 * sign-in the CLI started (`deviceAuthRules.ts`). Approving mints an API key
 * for them, which the CLI's next poll collects; declining tells the CLI to stop.
 *
 * `/v1/auth` is a public prefix, so the route authenticates for itself. Either
 * credential will do: the website proxies with its API key cookie, and a key
 * holder can already create keys through `/v1/keys/create`.
 */

import { createError, defineEventHandler, readBody } from 'h3';
import { ensureRedisConnected, getRedisClient } from '#root/server/utils/redis';
import { requireUserId } from '#root/server/utils/requireUser';
import { cleanupOldApiKeys, createApiKey, revokeApiKey } from '#root/server/utils/api-keys';
import { deviceKey, normalizeUserCode, userCodeKey, type DeviceAuthRequest } from '#root/server/utils/deviceAuthRules';

/** Same cap `generate-api-key` keeps; the oldest key makes room. */
const MAX_KEYS_PER_USER = 10;

defineRouteMeta({
    openAPI: {
        tags: ['Authentication'],
        summary: 'Approve or decline a device sign-in by its user code',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            userCode: { type: 'string', example: 'BCDF-GHJK' },
                            approve: { type: 'boolean', description: 'Only `true` grants access; anything else declines.' },
                        },
                        required: ['userCode'],
                    },
                },
            },
        },
        responses: {
            200: { description: '`{ success: true, approved, clientName }`' },
            400: { description: 'INVALID_CODE' },
            401: { description: 'Not signed in' },
            410: { description: 'EXPIRED_CODE: unknown, expired or already answered' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event);
    const body = (await readBody(event).catch(() => ({}))) || {};
    const userCode = normalizeUserCode(body.userCode);
    if (!userCode) throw createError({ statusCode: 400, statusMessage: 'INVALID_CODE' });

    const redis = getRedisClient();
    await ensureRedisConnected();
    // Taking the code off the lookup makes it single-use: a second answer, or
    // a guess at it, finds nothing.
    const deviceCode = await redis.getDel(userCodeKey(userCode));
    const raw = deviceCode ? await redis.get(deviceKey(deviceCode)) : null;
    if (!deviceCode || !raw) throw createError({ statusCode: 410, statusMessage: 'EXPIRED_CODE' });

    const request = JSON.parse(raw) as DeviceAuthRequest;
    const approved = body.approve === true;
    if (approved) {
        await cleanupOldApiKeys(userId, MAX_KEYS_PER_USER);
        request.apiKey = (await createApiKey(userId, request.clientName)).key;
    }
    request.status = approved ? 'approved' : 'denied';
    // XX: if the request expired meanwhile, don't recreate it without a TTL.
    if (!(await redis.set(deviceKey(deviceCode), JSON.stringify(request), { expiration: 'KEEPTTL', condition: 'XX' }))) {
        if (request.apiKey) await revokeApiKey(request.apiKey);
        throw createError({ statusCode: 410, statusMessage: 'EXPIRED_CODE' });
    }

    return { success: true, approved, clientName: request.clientName };
});
