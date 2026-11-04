/**
 * POST /v1/auth/device/start — begins a browser sign-in for the terminal
 * client (the flow is described in `deviceAuthRules.ts`).
 *
 * Public on purpose: it grants nothing. Only a signed-in user approving the
 * `userCode` on the website turns the request into an API key.
 */

import { createError, defineEventHandler, readBody } from 'h3';
import { ensureRedisConnected, getRedisClient } from '#root/server/utils/redis';
import {
    DEVICE_AUTH_INTERVAL_SECONDS,
    DEVICE_AUTH_TTL_SECONDS,
    clientName,
    deviceKey,
    generateDeviceCode,
    generateUserCode,
    userCodeKey,
    type DeviceAuthRequest,
} from '#root/server/utils/deviceAuthRules';
import { siteUrl } from '#root/server/utils/site';

defineRouteMeta({
    openAPI: {
        tags: ['Authentication'],
        summary: 'Start a browser sign-in for a device such as the CLI',
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: { clientName: { type: 'string', description: 'Names the API key, e.g. "WebBites CLI (MacBook Pro)".' } },
                    },
                },
            },
        },
        responses: {
            200: { description: '`{ deviceCode, userCode, verificationUrl, expiresIn, interval }` — open `verificationUrl`, then poll with `deviceCode`.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const body = (await readBody(event).catch(() => ({}))) || {};
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const request: DeviceAuthRequest = { userCode, clientName: clientName(body.clientName), status: 'pending' };

    const redis = getRedisClient();
    await ensureRedisConnected();
    // NX: a user code that is already out must never point at a second request.
    const claimed = await redis.set(userCodeKey(userCode), deviceCode, { expiration: { type: 'EX', value: DEVICE_AUTH_TTL_SECONDS }, condition: 'NX' });
    if (!claimed) throw createError({ statusCode: 503, statusMessage: 'Please try again.' });
    await redis.set(deviceKey(deviceCode), JSON.stringify(request), { expiration: { type: 'EX', value: DEVICE_AUTH_TTL_SECONDS } });

    const website = siteUrl();
    return {
        deviceCode,
        userCode,
        verificationUrl: `${website}/cli?code=${userCode}`,
        expiresIn: DEVICE_AUTH_TTL_SECONDS,
        interval: DEVICE_AUTH_INTERVAL_SECONDS,
    };
});
