/**
 * Changing a signed-in user's email address, verified.
 *
 * The flow:
 *
 *   1. `requestEmailChange` — the signed-in user names a new address (and, for
 *      password accounts, re-enters their password). We park it in an
 *      `EmailChangeRequest` row with the SHA-256 of a random token and mail the
 *      raw token to the NEW address. `_User.email` is untouched.
 *   2. `confirmEmailChange` — the link in that email lands on
 *      the web app's /verify-email, which posts the token here. Only now does the
 *      address move onto `_User.email` (and the username, for email sign-ups),
 *      and the OLD address is told it happened.
 *
 * `EmailChangeRequest` has no client permissions at all (see parse-compose's
 * schema) and `_User.email` can only be written with the master key (its
 * beforeSave), so this module is the only way an address changes.
 *
 * Rules that don't need Parse live in `emailChangeRules.ts`.
 */

import { createError } from 'h3';
import Parse from 'parse/node.js';
import { sendEmail } from '#root/server/utils/serverUtils.js';
import { invalidateSession } from '#root/server/utils/sessionCache.js';
import { getBillingProvider } from '#root/server/utils/billing';
import { isMailEnabled } from '#root/server/utils/mailer';
import {
    EMAIL_CHANGE_TTL_MS,
    RESEND_COOLDOWN_MS,
    generateToken,
    hashToken,
    isValidEmail,
    isWellFormedToken,
    normalizeEmail,
    requiresPassword,
    sendAllowance,
    shouldRenameUsername,
} from '#root/server/utils/emailChangeRules';
import { emailChangedNoticeEmail, verifyEmailChangeEmail } from '#root/emailTemplates/emailChangeTemplates';
import { siteUrl } from '#root/server/utils/site';

const REQUEST_CLASS = 'EmailChangeRequest';

function initParse() {
    if (!Parse.applicationId) {
        Parse.initialize(
            process.env.VITE_PARSE_ID as string,
            process.env.VITE_PARSE_JS_KEY as string,
            process.env.VITE_PARSE_MASTER_KEY as string
        );
    }
    Parse.serverURL = process.env.VITE_PARSE_URL as string;
}

const website = () => siteUrl();

export function verificationLink(token: string): string {
    return `${website()}/verify-email?token=${encodeURIComponent(token)}`;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface PendingEmailChange {
    email: string;
    sentAt: string | null;
    expiresAt: string;
    /** When the resend button may be pressed again. */
    canResendAt: string | null;
}

export interface EmailStatus {
    email: string | null;
    emailVerified: boolean;
    /** Whether `requestEmailChange` will ask for the current password. */
    requiresPassword: boolean;
    pending: PendingEmailChange | null;
}

async function loadUser(userId: string): Promise<Parse.User> {
    try {
        return await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'User not found' });
    }
}

async function findRequestForUser(userId: string): Promise<Parse.Object | undefined> {
    return new Parse.Query(REQUEST_CLASS)
        .equalTo('userId', userId)
        .descending('updatedAt')
        .first({ useMasterKey: true });
}

function isExpired(row: Parse.Object, now = new Date()): boolean {
    const expiresAt = row.get('expiresAt') as Date | undefined;
    return !expiresAt || expiresAt.getTime() <= now.getTime();
}

function serializePending(row: Parse.Object | undefined): PendingEmailChange | null {
    if (!row || isExpired(row)) return null;
    const sentAt = row.get('sentAt') as Date | undefined;
    return {
        email: row.get('newEmail'),
        sentAt: sentAt?.toISOString() ?? null,
        expiresAt: (row.get('expiresAt') as Date).toISOString(),
        canResendAt: sentAt ? new Date(sentAt.getTime() + RESEND_COOLDOWN_MS).toISOString() : null,
    };
}

function statusFor(user: Parse.User, row: Parse.Object | undefined): EmailStatus {
    return {
        email: user.get('email') ?? null,
        emailVerified: user.get('emailVerified') === true,
        requiresPassword: requiresPassword(user.get('authData')),
        pending: serializePending(row),
    };
}

export async function getEmailStatus(userId: string): Promise<EmailStatus> {
    initParse();
    const [user, row] = await Promise.all([loadUser(userId), findRequestForUser(userId)]);
    return statusFor(user, row);
}

// ─── Requesting ──────────────────────────────────────────────────────────────

/**
 * Whether any other account already answers to `email`, as its email or as
 * its username. Both count: Parse signs in with `username OR email`, so an
 * address that is somebody else's username would make sign-in ambiguous.
 */
async function isAddressTaken(email: string, userId: string): Promise<boolean> {
    const byEmail = new Parse.Query(Parse.User).equalTo('email', email);
    const byUsername = new Parse.Query(Parse.User).equalTo('username', email);
    const clash = await Parse.Query.or(byEmail, byUsername)
        .notEqualTo('objectId', userId)
        .first({ useMasterKey: true });
    return Boolean(clash);
}

async function checkPassword(user: Parse.User, password: unknown): Promise<void> {
    if (typeof password !== 'string' || password.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Enter your current password to change your email',
            data: { errorCode: 'PASSWORD_REQUIRED' },
        });
    }
    try {
        // Checks the password without creating a session. Parse accepts the
        // username or the email here, so either one we hold works.
        await Parse.User.verifyPassword(user.get('username') ?? user.get('email'), password, { useMasterKey: true });
    } catch {
        // 400, not 403: both clients read a 401/403 from the backend as a
        // stale API key and mint a new one before retrying.
        throw createError({
            statusCode: 400,
            statusMessage: 'That password is incorrect',
            data: { errorCode: 'INCORRECT_PASSWORD' },
        });
    }
}

export async function requestEmailChange(
    userId: string,
    input: { email?: unknown; password?: unknown }
): Promise<EmailStatus> {
    initParse();
    const newEmail = normalizeEmail(input.email);
    if (!isValidEmail(newEmail)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Enter a valid email address',
            data: { errorCode: 'INVALID_EMAIL' },
        });
    }

    const [user, existing] = await Promise.all([loadUser(userId), findRequestForUser(userId)]);
    const currentEmail = normalizeEmail(user.get('email'));

    if (newEmail === currentEmail) {
        throw createError({
            statusCode: 400,
            statusMessage: "That's already your email address",
            data: { errorCode: 'SAME_EMAIL' },
        });
    }

    // Re-sending the link for the change already pending doesn't ask again:
    // the password was checked when that change was requested, and a resend
    // can only reach the address it was checked for.
    const isResend = Boolean(existing && !isExpired(existing) && existing.get('newEmail') === newEmail);
    if (!isResend && requiresPassword(user.get('authData'))) {
        await checkPassword(user, input.password);
    }

    if (await isAddressTaken(newEmail, userId)) {
        throw createError({
            statusCode: 409,
            statusMessage: 'Another account already uses that email address',
            data: { errorCode: 'EMAIL_TAKEN' },
        });
    }

    const now = new Date();
    const allowance = sendAllowance(
        existing
            ? {
                  sentAt: existing.get('sentAt'),
                  sendCount: existing.get('sendCount'),
                  windowStart: existing.get('windowStart'),
              }
            : {},
        now
    );
    if (allowance.outcome !== 'send') {
        throw createError({
            statusCode: 429,
            statusMessage:
                allowance.outcome === 'cooldown'
                    ? `Wait ${allowance.retryAfterSeconds} seconds before sending another email`
                    : "You've asked for too many verification emails today. Try again tomorrow.",
            data: {
                errorCode: allowance.outcome === 'cooldown' ? 'RESEND_COOLDOWN' : 'DAILY_LIMIT',
                retryAfterSeconds: allowance.retryAfterSeconds,
            },
        });
    }

    // One row per user. A new request (or a resend) replaces the token, so
    // only the most recent link ever works.
    const row = existing ?? new Parse.Object(REQUEST_CLASS);
    const { token, tokenHash } = generateToken();
    if (!existing) {
        row.set('userId', userId);
        row.set('user', user);
        row.setACL(new Parse.ACL());
    }
    row.set('newEmail', newEmail);
    row.set('oldEmail', currentEmail);
    row.set('tokenHash', tokenHash);
    row.set('expiresAt', new Date(now.getTime() + EMAIL_CHANGE_TTL_MS));
    row.set('sentAt', now);
    row.set('sendCount', allowance.sendCount);
    row.set('windowStart', allowance.windowStart);
    await row.save(null, { useMasterKey: true });

    const email = verifyEmailChangeEmail({
        name: user.get('name') ?? user.get('username'),
        currentEmail,
        newEmail,
        link: verificationLink(token),
        expiresInHours: Math.round(EMAIL_CHANGE_TTL_MS / 3_600_000),
    });

    let sent: { success?: boolean } | undefined;
    try {
        sent = await sendEmail({ userEmail: newEmail, emailHtml: email.html, subject: email.subject, text: email.text, name: '' });
    } catch (error) {
        console.error('[emailChange] Verification email failed:', error);
    }
    if (!sent?.success) {
        // Nobody can click a link that never arrived, and the token pending
        // before this call has already been replaced. Clear the change so
        // Settings doesn't show it waiting on an email that isn't coming, and
        // hand back the send so the cooldown doesn't block an immediate retry.
        clearPending(row);
        row.set('sentAt', existing?.get('sentAt') ?? null);
        row.set('sendCount', Math.max(0, allowance.sendCount - 1));
        await row.save(null, { useMasterKey: true }).catch(() => {});
        if (!isMailEnabled()) {
            // Not a hiccup: this server has no way to send email, so retrying cannot help.
            throw createError({
                statusCode: 501,
                statusMessage: 'Email is not set up on this server, so the address cannot be changed here. Ask the administrator.',
                data: { errorCode: 'EMAIL_NOT_CONFIGURED' },
            });
        }
        throw createError({
            statusCode: 503,
            statusMessage: "We couldn't send the verification email. Please try again in a moment.",
            data: { errorCode: 'EMAIL_SEND_FAILED' },
        });
    }

    return statusFor(user, row);
}

// ─── Cancelling ──────────────────────────────────────────────────────────────

/**
 * Forgets the pending address and kills its link, but keeps the row: its send
 * counters are the rate limit, and deleting them would let cancel-then-resend
 * mail an address as often as you liked.
 */
function clearPending(row: Parse.Object): void {
    row.unset('newEmail');
    row.unset('tokenHash');
    row.unset('expiresAt');
}

/** `clearPending`, saved. Used once a link has been spent or can't be. */
async function retire(row: Parse.Object): Promise<void> {
    clearPending(row);
    await row.save(null, { useMasterKey: true });
}

export async function cancelEmailChange(userId: string): Promise<EmailStatus> {
    initParse();
    const [user, row] = await Promise.all([loadUser(userId), findRequestForUser(userId)]);
    if (row) await retire(row);
    return statusFor(user, undefined);
}

// ─── Confirming ──────────────────────────────────────────────────────────────

/** Every cached copy of this user's sessions still carries the old address. */
async function dropCachedSessions(user: Parse.User): Promise<void> {
    const sessions = await new Parse.Query(Parse.Session)
        .equalTo('user', user)
        .select('sessionToken')
        .limit(1000)
        .find({ useMasterKey: true });
    await Promise.all(sessions.map((s) => invalidateSession(s.get('sessionToken'))));
}

export async function confirmEmailChange(token: unknown): Promise<{ email: string }> {
    initParse();
    const invalid = () =>
        createError({
            statusCode: 400,
            statusMessage: 'This link is invalid or has already been used',
            data: { errorCode: 'INVALID_TOKEN' },
        });

    if (!isWellFormedToken(token)) throw invalid();

    const row = await new Parse.Query(REQUEST_CLASS)
        .equalTo('tokenHash', hashToken(token))
        .first({ useMasterKey: true });
    if (!row) throw invalid();

    if (isExpired(row)) {
        await retire(row).catch(() => {});
        throw createError({
            statusCode: 410,
            statusMessage: 'This link has expired. Request a new one from Settings.',
            data: { errorCode: 'EXPIRED_TOKEN' },
        });
    }

    const user = await loadUser(row.get('userId'));
    const newEmail = normalizeEmail(row.get('newEmail'));
    const oldEmail = user.get('email') as string | undefined;

    if (normalizeEmail(oldEmail) === newEmail) {
        await retire(row).catch(() => {});
        return { email: newEmail };
    }

    // Someone may have signed up with the address since the link was sent.
    if (await isAddressTaken(newEmail, user.id as string)) {
        await retire(row).catch(() => {});
        throw createError({
            statusCode: 409,
            statusMessage: 'Another account started using that email address. Try a different one.',
            data: { errorCode: 'EMAIL_TAKEN' },
        });
    }

    // A billing provider (the hosted service's Stripe) records its link to this user by id
    // before the address changes, so billing still finds them afterwards.
    const billing = getBillingProvider();
    let billingState: unknown;
    try {
        billingState = billing?.beforeEmailChange ? await billing.beforeEmailChange(user) : undefined;
    } catch (error) {
        console.error('[emailChange] Billing provider could not prepare the change for', user.id, error);
        throw createError({
            statusCode: 503,
            statusMessage: "We couldn't update your billing details. Please open the link again in a minute.",
            data: { errorCode: 'BILLING_UNAVAILABLE' },
        });
    }

    if (shouldRenameUsername(user.get('username'), oldEmail)) {
        user.set('username', newEmail);
    }
    user.set('email', newEmail);
    user.set('emailVerified', true);

    try {
        await user.save(null, { useMasterKey: true });
    } catch (error: any) {
        if (error?.code === Parse.Error.EMAIL_TAKEN || error?.code === Parse.Error.USERNAME_TAKEN) {
            await retire(row).catch(() => {});
            throw createError({
                statusCode: 409,
                statusMessage: 'Another account started using that email address. Try a different one.',
                data: { errorCode: 'EMAIL_TAKEN' },
            });
        }
        throw error;
    }

    // The change has happened; nothing below may undo it or fail the request.
    await retire(row).catch((error) =>
        console.warn('[emailChange] Could not retire used request', row.id, error)
    );

    await dropCachedSessions(user).catch((error) =>
        console.warn('[emailChange] Could not drop cached sessions for', user.id, error)
    );

    if (billing?.afterEmailChange) {
        await billing
            .afterEmailChange(user, newEmail, billingState)
            .catch((error) => console.warn(`[emailChange] Billing provider could not follow the new address for ${user.id}:`, error));
    }

    if (oldEmail) {
        const notice = emailChangedNoticeEmail({
            name: user.get('name') ?? user.get('username'),
            oldEmail,
            newEmail,
            changedAt: new Date(),
        });
        await sendEmail({ userEmail: oldEmail, emailHtml: notice.html, subject: notice.subject, text: notice.text, name: '' })
            .catch((error: unknown) => console.warn('[emailChange] Could not send change notice to old address:', error));
    }

    console.log('[emailChange] Email changed for user', user.id);
    return { email: newEmail };
}
