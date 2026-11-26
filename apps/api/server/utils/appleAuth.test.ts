/**
 * Sign in with Apple is off unless this server has a client id of its own. Run with:
 *
 *   npm run test:appleAuth
 */
import { appleAudiences, appleSignInEnabled, appleWebClientId, verifyAppleToken, AppleAuthError } from './apple-auth';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};
const setEnv = (vars: Record<string, string | undefined>) => {
    for (const k of ['APPLE_CLIENT_IDS', 'SELF_HOSTED', 'BILLING_PROVIDER']) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
};

(async () => {
    setEnv({});
    check('self-hosted default: nothing is accepted', appleAudiences().length === 0 && !appleSignInEnabled() && appleWebClientId() === null);
    setEnv({ APPLE_CLIENT_IDS: '' });
    check('an empty variable counts as unset', !appleSignInEnabled());
    setEnv({ APPLE_CLIENT_IDS: ' com.example.web , com.example.app ,' });
    check('configured ids are split and trimmed, the first is the web one', appleAudiences().join('|') === 'com.example.web|com.example.app' && appleWebClientId() === 'com.example.web');

    setEnv({ BILLING_PROVIDER: 'stripe' });
    check('hosted (a billing provider) keeps its own ids without any variable', appleAudiences().join('|') === 'io.webbites.web|io.webbites.app' && appleSignInEnabled());
    setEnv({ SELF_HOSTED: 'false' });
    check('hosted (SELF_HOSTED=false) keeps its own ids too', appleSignInEnabled());
    setEnv({ BILLING_PROVIDER: 'stripe', APPLE_CLIENT_IDS: 'x.y' });
    check('a configured value still wins on the hosted service', appleAudiences().join() === 'x.y');

    setEnv({});
    const refused = await verifyAppleToken('a.b.c').then(() => null, (e) => e);
    check('an unconfigured server refuses before looking at the token', refused instanceof AppleAuthError && refused.code === 'APPLE_NOT_CONFIGURED' && refused.statusCode === 403);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})();
