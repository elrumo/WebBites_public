/**
 * The rules behind a verified email change: which addresses are accepted,
 * how tokens are made and checked, how often a verification email may go out,
 * and when the username follows the email.
 *
 * Run with:  npm run test:emailChangeRules
 */

import {
    EMAIL_CHANGE_TTL_MS,
    MAX_SENDS_PER_WINDOW,
    RESEND_COOLDOWN_MS,
    SEND_WINDOW_MS,
    generateToken,
    hashToken,
    isValidEmail,
    isWellFormedToken,
    normalizeEmail,
    requiresPassword,
    sendAllowance,
    shouldRenameUsername,
} from './emailChangeRules';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => {
    if (ok) pass++; else { fail++; console.log(`FAIL: ${name}`); }
};

// normalizeEmail
check('trims and lower-cases', normalizeEmail('  Elias@IBM.com ') === 'elias@ibm.com');
check('non-string is empty', normalizeEmail(undefined) === '' && normalizeEmail(42) === '');

// isValidEmail
for (const good of ['a@b.co', 'first.last+tag@sub.example.org', 'x@privaterelay.appleid.com']) {
    check(`valid: ${good}`, isValidEmail(good));
}
for (const bad of ['', 'plain', 'a@b', '@b.com', 'a@.', 'a b@c.com', 'a@b c.com', 'a@@b.com', `${'a'.repeat(250)}@b.com`]) {
    check(`invalid: ${bad.slice(0, 30)}`, !isValidEmail(bad));
}

// Tokens
const one = generateToken();
const two = generateToken();
check('token is well formed', isWellFormedToken(one.token));
check('tokens differ', one.token !== two.token && one.tokenHash !== two.tokenHash);
check('hash is stable', hashToken(one.token) === one.tokenHash);
check('hash is not the token', one.tokenHash !== one.token);
for (const bad of [undefined, null, 42, '', 'short', `${one.token}x`, one.token.replace(/.$/, '!'), { token: one.token }]) {
    check(`malformed token rejected: ${String(bad).slice(0, 12)}`, !isWellFormedToken(bad));
}

// sendAllowance
const t0 = new Date('2026-09-24T12:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

const first = sendAllowance({}, t0);
check('first send allowed and starts a window', first.outcome === 'send' && first.sendCount === 1 && first.windowStart.getTime() === t0.getTime());

const tooSoon = sendAllowance({ sentAt: t0, sendCount: 1, windowStart: t0 }, at(10_000));
check('resend inside cooldown refused', tooSoon.outcome === 'cooldown' && tooSoon.retryAfterSeconds === 50);

const afterCooldown = sendAllowance({ sentAt: t0, sendCount: 1, windowStart: t0 }, at(RESEND_COOLDOWN_MS));
check('resend after cooldown allowed and counted', afterCooldown.outcome === 'send' && afterCooldown.sendCount === 2 && afterCooldown.windowStart.getTime() === t0.getTime());

const capped = sendAllowance({ sentAt: at(-RESEND_COOLDOWN_MS), sendCount: MAX_SENDS_PER_WINDOW, windowStart: at(-60 * 60 * 1000) }, t0);
check('cap reached refuses with daily_limit', capped.outcome === 'daily_limit' && capped.retryAfterSeconds === (SEND_WINDOW_MS - 60 * 60 * 1000) / 1000);

const windowOver = sendAllowance({ sentAt: at(-SEND_WINDOW_MS), sendCount: MAX_SENDS_PER_WINDOW, windowStart: at(-SEND_WINDOW_MS) }, t0);
check('expired window resets the count', windowOver.outcome === 'send' && windowOver.sendCount === 1 && windowOver.windowStart.getTime() === t0.getTime());

const nullCounters = sendAllowance({ sentAt: null, sendCount: null, windowStart: null }, t0);
check('null counters behave like none', nullCounters.outcome === 'send' && nullCounters.sendCount === 1);

// shouldRenameUsername
check('username that is the old email follows it', shouldRenameUsername('elias@ibm.com', 'elias@ibm.com'));
check('comparison ignores case and spacing', shouldRenameUsername(' Elias@IBM.com', 'elias@ibm.com'));
check('a real name is kept', !shouldRenameUsername('Elias', 'elias@ibm.com'));
check('apple-style handle is kept', !shouldRenameUsername('elias', 'elias@ibm.com'));
check('missing old email keeps the username', !shouldRenameUsername('', '') && !shouldRenameUsername('x', undefined));

// requiresPassword
check('no authData needs a password', requiresPassword(undefined) && requiresPassword(null) && requiresPassword({}));
check('only-null providers need a password', requiresPassword({ apple: null }));
check('an Apple account does not', !requiresPassword({ apple: { id: 'abc' } }));

check('link lives a day', EMAIL_CHANGE_TTL_MS === 24 * 60 * 60 * 1000);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
