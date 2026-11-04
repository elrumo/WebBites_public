/**
 * The client secret is the one part of Sign in with Apple revocation that can
 * be wrong without Apple's help: a bad header or claim and every exchange and
 * revoke answers `invalid_client`. Run with:
 *
 *   npm run test:appleTokens
 */

import { exportPKCS8, generateKeyPair, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { appleClientSecret } from './appleTokens';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

(async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    process.env.APPLE_SIWA_TEAM_ID = 'UC3T83K9FR';
    process.env.APPLE_SIWA_KEY_ID = 'ABC123DEFG';
    // As a one-line env var, the way Dokploy stores it.
    process.env.APPLE_SIWA_PRIVATE_KEY = (await exportPKCS8(privateKey)).replace(/\n/g, '\\n');

    const secret = await appleClientSecret('io.webbites.app', 1_800_000_000);
    const header = decodeProtectedHeader(secret);
    const claims = decodeJwt(secret);
    check('ES256 with the key id', header.alg === 'ES256' && header.kid === 'ABC123DEFG');
    check('issued by the team', claims.iss === 'UC3T83K9FR');
    check('subject is the client id', claims.sub === 'io.webbites.app');
    check('audience is Apple', claims.aud === 'https://appleid.apple.com');
    check('short-lived', claims.exp === 1_800_000_300 && claims.iat === 1_800_000_000);
    check('signature verifies', await jwtVerify(secret, publicKey, { currentDate: new Date(1_800_000_100_000) }).then(() => true, () => false));


    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})();
