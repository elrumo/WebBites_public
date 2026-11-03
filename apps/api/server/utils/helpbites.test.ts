/**
 * Account deletion must reach HelpBites, and must fail loudly when HelpBites
 * refuses. Run with:
 *
 *   npm run test:helpbites
 */

import { eraseHelpbitesUser, helpbitesEraseUrl } from './helpbites';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

(async () => {
    check('erase URL escapes the user id', helpbitesEraseUrl('https://help.example.com/', 'guest:a b') === 'https://help.example.com/v1/end-users/guest%3Aa%20b');

    const calls: { url: string, init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ erased: { posts: 2, votes: 5 } }), { status: 200 });
    }) as unknown as typeof fetch;

    const env = { HELPBITES_API_URL: 'https://help.example.com', HELPBITES_PRIVATE_KEY: 'sk_test' };
    const erased = await eraseHelpbitesUser('u1', env, ok);
    check('returns what HelpBites erased', erased?.posts === 2 && erased?.votes === 5);
    check('DELETE with the project secret', calls[0]?.init.method === 'DELETE' && (calls[0]?.init.headers as Record<string, string>).authorization === 'Bearer sk_test');

    check('skips when not configured', (await eraseHelpbitesUser('u1', {}, ok)) === null && calls.length === 1);

    const refused = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const threw = await eraseHelpbitesUser('u1', env, refused).then(() => false, (error) => String(error.message).includes('401'));
    check('a refusal throws, so the delete fails whole', threw);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})();
