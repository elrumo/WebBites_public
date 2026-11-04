/**
 * Browser sign-in for the terminal client (`webbites login`), after RFC 8628's
 * device flow:
 *
 * 1. The CLI calls `/v1/auth/device/start` and gets a secret `deviceCode` plus
 *    a short `userCode`, and opens `verificationUrl` in the browser.
 * 2. On webbites.io the signed-in user checks the code matches the terminal
 *    and approves it (`/v1/auth/device/confirm`), which mints an API key.
 * 3. The CLI polls `/v1/auth/device/poll` with the `deviceCode`; the first poll
 *    after approval gets the key, once.
 *
 * Kept free of Redis and h3 so the rules can be tested on their own.
 */

import { randomBytes, randomInt } from 'node:crypto';

/** How long a request waits for the user before the CLI has to start over. */
export const DEVICE_AUTH_TTL_SECONDS = 10 * 60;

/** How often the CLI polls. */
export const DEVICE_AUTH_INTERVAL_SECONDS = 3;

/**
 * Consonants only: nothing to mistake for a digit, and no accidental words.
 * Eight of them is 20^8 ≈ 2.6e10 codes, against a 10 minute lifetime.
 */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

export type DeviceAuthStatus = 'pending' | 'approved' | 'denied';

/** What Redis holds under `deviceKey(deviceCode)`. */
export interface DeviceAuthRequest {
    userCode: string;
    clientName: string;
    status: DeviceAuthStatus;
    apiKey?: string;
}

export const deviceKey = (deviceCode: string) => `device_auth:${deviceCode}`;
export const userCodeKey = (userCode: string) => `device_auth_code:${userCode}`;

/** The secret only the CLI holds. Polling with it is what collects the key. */
export function generateDeviceCode(): string {
    return randomBytes(32).toString('base64url');
}

/** What the user compares between terminal and browser, e.g. `BCDF-GHJK`. */
export function generateUserCode(): string {
    const letters = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]);
    return `${letters.slice(0, 4).join('')}-${letters.slice(4).join('')}`;
}

/** Accepts what a person types or pastes: any case, with or without the dash. */
export function normalizeUserCode(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const letters = raw.toUpperCase().replace(/[\s-]/g, '');
    if (letters.length !== 8 || [...letters].some((c) => !USER_CODE_ALPHABET.includes(c))) return null;
    return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/**
 * The name the minted key gets in the developer settings list, which is where
 * the user revokes it — so it should say which machine it was for.
 */
export function clientName(raw: unknown): string {
    const name = typeof raw === 'string'
        ? raw.replace(/[^\p{L}\p{N} .,_'’()-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60)
        : '';
    return name || 'WebBites CLI';
}
