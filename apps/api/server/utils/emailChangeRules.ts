/**
 * The rules behind changing a signed-in user's email address, kept free of
 * Parse and h3 so they can be tested on their own. The flow that uses them is
 * `emailChange.ts`.
 *
 * The address on the account never changes until the new one is proven: the
 * request is parked in `EmailChangeRequest` and only a click on the link we
 * send to the new inbox moves it onto `_User.email`. Until then the old
 * address keeps signing in, receiving password resets and matching Stripe.
 */

import { createHash, randomBytes } from 'node:crypto';

/** How long a verification link works for. */
export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

/** The shortest gap between two verification emails for one account. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Verification emails one account may send in `SEND_WINDOW_MS`. Each one goes
 * to an address the user typed, so without a cap this is a way to have us mail
 * anybody, as often as you like.
 */
export const MAX_SENDS_PER_WINDOW = 5;
export const SEND_WINDOW_MS = 24 * 60 * 60 * 1000;

/** RFC 5321's limit on a forward path. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Addresses are stored lower-cased. Parse's uniqueness check on `email` is
 * case-insensitive anyway, and the clients already lower-case what they sign in
 * with, so keeping the stored form canonical is what makes the equality checks
 * here mean what they say.
 */
export function normalizeEmail(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Deliberately loose: one `@`, something on each side, a dot in the domain,
 * no whitespace. Whether the inbox exists is what the verification email is
 * for; a stricter pattern only turns away real addresses.
 */
export function isValidEmail(email: string): boolean {
    if (!email || email.length > MAX_EMAIL_LENGTH) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** SHA-256 of the raw token, hex. Only the hash is ever stored. */
export function hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * A fresh single-use token: 32 random bytes, URL-safe. The raw value only
 * exists in the email; the database gets the hash, so a leaked row cannot be
 * turned back into a working link.
 */
export function generateToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: hashToken(token) };
}

/**
 * Tokens are base64url of 32 bytes: 43 characters from a fixed alphabet.
 * Anything else is rejected before it reaches a query.
 */
export function isWellFormedToken(token: unknown): token is string {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface SendHistory {
    /** When the last verification email went out. */
    sentAt?: Date | null;
    /** Emails sent since `windowStart`. */
    sendCount?: number | null;
    /** Start of the current rate-limit window. */
    windowStart?: Date | null;
}

// Discriminated on a string rather than `allowed: boolean`: the backend
// compiles without strictNullChecks, and boolean literals don't narrow there.
export type SendAllowance =
    | { outcome: 'send'; sendCount: number; windowStart: Date }
    | { outcome: 'cooldown' | 'daily_limit'; retryAfterSeconds: number };

/**
 * Whether another verification email may go out now, and the counters to
 * store if it does. A short cooldown stops double clicks and impatient
 * resends; the window cap stops the endpoint being used to mail strangers.
 */
export function sendAllowance(history: SendHistory, now: Date = new Date()): SendAllowance {
    const nowMs = now.getTime();

    const sentAt = history.sentAt?.getTime();
    if (sentAt && nowMs - sentAt < RESEND_COOLDOWN_MS) {
        return {
            outcome: 'cooldown',
            retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (nowMs - sentAt)) / 1000),
        };
    }

    const windowStartMs = history.windowStart?.getTime();
    const windowOpen = windowStartMs !== undefined && nowMs - windowStartMs < SEND_WINDOW_MS;
    const count = windowOpen ? history.sendCount ?? 0 : 0;

    if (windowOpen && count >= MAX_SENDS_PER_WINDOW) {
        return {
            outcome: 'daily_limit',
            retryAfterSeconds: Math.ceil((SEND_WINDOW_MS - (nowMs - windowStartMs!)) / 1000),
        };
    }

    return {
        outcome: 'send',
        sendCount: count + 1,
        windowStart: windowOpen ? history.windowStart! : now,
    };
}

/**
 * Email sign-ups store the address as the username too (the web and native
 * apps both sign up with `username = email`). Those accounts need the username
 * to follow the email, or the old address stays reserved as a username —
 * blocking whoever owns it from ever signing up — and keeps being shown as the
 * account's name. Apple sign-ups and anyone who picked a real name keep theirs.
 */
export function shouldRenameUsername(username: unknown, oldEmail: unknown): boolean {
    return typeof username === 'string'
        && typeof oldEmail === 'string'
        && oldEmail.length > 0
        && username.trim().toLowerCase() === oldEmail.trim().toLowerCase();
}

/**
 * A password is asked for when the account has one to ask for. Accounts that
 * signed up with Apple have `authData` and no password we could check, so for
 * them the signed-in session is the proof.
 */
export function requiresPassword(authData: unknown): boolean {
    if (!authData || typeof authData !== 'object') return true;
    return Object.values(authData as Record<string, unknown>).every((entry) => entry == null);
}
