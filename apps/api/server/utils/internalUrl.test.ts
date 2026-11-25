/**
 * Stored-file URLs are read by the in-network address, and nothing else is rewritten.
 *
 * Run with:  npm run test:internalUrl
 */

import { toInternalUrl } from './internalUrl';
import { assertPublicUrl } from './safeUrl';

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
    if (got === want) pass++; else { fail++; console.log(`FAIL: ${label}\n  got  ${got}\n  want ${want}`); }
};
const env = (vars: Record<string, string | undefined>) => {
    for (const k of ['SITE_URL', 'VITE_WEBSITE_URL', 'VITE_PARSE_URL', 'S3_PUBLIC_URL', 'S3_ENDPOINT_URL']) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
};

const run = async () => {
    // ./install.sh --domain localhost --http-port 8080
    env({ SITE_URL: 'http://localhost:8080', VITE_PARSE_URL: 'http://parse:1337/parse' });
    const file = 'http://localhost:8080/parse/files/app/abc_page.html';
    eq('localhost parse file', toInternalUrl(file), 'http://parse:1337/parse/files/app/abc_page.html');
    eq('query kept', toInternalUrl(`${file}?x=1`), 'http://parse:1337/parse/files/app/abc_page.html?x=1');
    eq('host case and default port', toInternalUrl('HTTP://LocalHost:8080/parse/files/a/b'), 'http://parse:1337/parse/files/a/b');
    eq('unrelated external', toInternalUrl('https://example.com/parse/files/a'), 'https://example.com/parse/files/a');
    eq('other path on the public origin', toInternalUrl('http://localhost:8080/parse/classes/_User'), 'http://localhost:8080/parse/classes/_User');
    eq('app route on the public origin', toInternalUrl('http://localhost:8080/v1/search'), 'http://localhost:8080/v1/search');
    eq('prefix without the slash', toInternalUrl('http://localhost:8080/parse/files'), 'http://localhost:8080/parse/files');
    eq('look-alike host (suffix)', toInternalUrl('http://localhost:8080.evil.test/parse/files/a'), 'http://localhost:8080.evil.test/parse/files/a');
    eq('look-alike host (userinfo)', toInternalUrl('http://localhost:8080@evil.test/parse/files/a'), 'http://localhost:8080@evil.test/parse/files/a');
    eq('other port', toInternalUrl('http://localhost:9090/parse/files/a'), 'http://localhost:9090/parse/files/a');
    eq('dot segments out of /files', toInternalUrl('http://localhost:8080/parse/files/../classes/_User'), 'http://localhost:8080/parse/files/../classes/_User');
    eq('encoded dot segments', toInternalUrl('http://localhost:8080/parse/files/%2e%2e/classes/_User'), 'http://localhost:8080/parse/files/%2e%2e/classes/_User');
    eq('backslash dot segments', toInternalUrl('http://localhost:8080/parse/files/..\\classes/x'), 'http://localhost:8080/parse/files/..\\classes/x');
    eq('not a URL', toInternalUrl('not a url'), 'not a url');
    eq('file scheme', toInternalUrl('file:///etc/passwd'), 'file:///etc/passwd');

    // trailing slashes in the settings
    env({ SITE_URL: 'http://localhost:8080/', VITE_PARSE_URL: 'http://parse:1337/parse/' });
    eq('trailing slashes', toInternalUrl(file), 'http://parse:1337/parse/files/app/abc_page.html');

    // a real domain works the same way (and skips the trip through Caddy)
    env({ SITE_URL: 'https://wb.example.com', VITE_PARSE_URL: 'http://parse:1337/parse' });
    eq('real domain', toInternalUrl('https://wb.example.com/parse/files/app/x.html'), 'http://parse:1337/parse/files/app/x.html');
    eq('real domain, other site', toInternalUrl('https://other.example.com/parse/files/app/x.html'), 'https://other.example.com/parse/files/app/x.html');

    // S3 behind Caddy (rustfs profile)
    env({ SITE_URL: 'http://localhost:8080', VITE_PARSE_URL: 'http://parse:1337/parse', S3_PUBLIC_URL: 'http://localhost:8080/s3', S3_ENDPOINT_URL: 'http://rustfs:9000' });
    eq('s3 object', toInternalUrl('http://localhost:8080/s3/webbites/parse/a.png'), 'http://rustfs:9000/webbites/parse/a.png');
    eq('s3 trailing slashes', (env({ S3_PUBLIC_URL: 'http://localhost:8080/s3/', S3_ENDPOINT_URL: 'http://rustfs:9000/', SITE_URL: 'http://localhost:8080', VITE_PARSE_URL: 'http://parse:1337/parse' }), toInternalUrl('http://localhost:8080/s3/webbites/a.png')), 'http://rustfs:9000/webbites/a.png');
    eq('s3 prefix is a path boundary', toInternalUrl('http://localhost:8080/s3other/a.png'), 'http://localhost:8080/s3other/a.png');
    eq('s3 dot segments', toInternalUrl('http://localhost:8080/s3/../parse/files/a'), 'http://parse:1337/parse/files/a'); // normalised first: it is a Parse file URL
    eq('parse file still mapped next to s3', toInternalUrl(file), 'http://parse:1337/parse/files/app/abc_page.html');

    // Hosted: a real hostname on the Parse/S3 side means nothing is rewritten.
    env({ SITE_URL: 'https://webbites.io', VITE_PARSE_URL: 'https://parse.webbites.io/parse', S3_PUBLIC_URL: 'https://s3.webbites.io', S3_ENDPOINT_URL: 'https://acct.r2.cloudflarestorage.com' });
    eq('hosted parse file', toInternalUrl('https://webbites.io/parse/files/app/a'), 'https://webbites.io/parse/files/app/a');
    eq('hosted s3 object', toInternalUrl('https://s3.webbites.io/webbites/a.png'), 'https://s3.webbites.io/webbites/a.png');

    // Nothing configured at all (tests, dev, scripts)
    env({});
    eq('no env', toInternalUrl(file), file);
    env({ SITE_URL: 'http://localhost:8080' });
    eq('no parse url', toInternalUrl(file), file);

    // The SSRF guard is untouched: users still cannot point a fetch at loopback or a service name.
    for (const url of [
        'http://localhost:8080/parse/files/app/a.html', 'http://127.0.0.1:8080/parse/files/a', 'http://parse:1337/parse/files/a',
        'http://rustfs:9000/webbites/a.png', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/',
    ]) eq(`guard refuses ${url}`, 'error' in (await assertPublicUrl(url)), true);

    console.log(`${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
};

run();
