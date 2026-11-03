/**
 * The rules behind the CLI's browser sign-in: code shapes, what a typed code
 * normalises to, and what a key may be named.
 *
 * Run with:  npm run test:deviceAuthRules
 */

import { clientName, generateDeviceCode, generateUserCode, normalizeUserCode } from './deviceAuthRules';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => {
    if (ok) pass++; else { fail++; console.log(`FAIL: ${name}`); }
};

// Codes
const userCode = generateUserCode();
check('user code is XXXX-XXXX in the alphabet', /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(userCode));
check('user code round-trips', normalizeUserCode(userCode) === userCode);
check('device code is 43 url-safe chars', /^[A-Za-z0-9_-]{43}$/.test(generateDeviceCode()));
check('device codes differ', generateDeviceCode() !== generateDeviceCode());

// normalizeUserCode
check('lower case, no dash', normalizeUserCode('bcdfghjk') === 'BCDF-GHJK');
check('spaces', normalizeUserCode(' bcdf ghjk ') === 'BCDF-GHJK');
check('vowel rejected', normalizeUserCode('BCDF-GHJA') === null);
check('digit rejected', normalizeUserCode('BCDF-GHJ1') === null);
check('too short', normalizeUserCode('BCDF-GHJ') === null);
check('too long', normalizeUserCode('BCDF-GHJKL') === null);
check('not a string', normalizeUserCode(42) === null);

// clientName
check('keeps a machine name', clientName("WebBites CLI (Elias’s MacBook Pro)") === "WebBites CLI (Elias’s MacBook Pro)");
check('strips markup', clientName('<b>x</b>') === 'bxb');
check('falls back', clientName('') === 'WebBites CLI' && clientName(undefined) === 'WebBites CLI');
check('caps length', clientName('a'.repeat(200)).length === 60);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
