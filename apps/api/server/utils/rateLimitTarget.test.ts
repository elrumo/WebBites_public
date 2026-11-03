/**
 * Regression tests for who a request is rate limited as.
 *
 * Both properties here were live bugs: `/_docs/scalar` answered 429 because the
 * docs UI was counted like API traffic, and it hit the limit that fast because
 * every request through nginx was bucketed on the proxy's address instead of
 * the caller's — one shared counter for the whole internet.
 *
 * Run with:  npm run test:rateLimitTarget
 */

import { isRateLimitExempt, resolveClientIp, rateLimitIdentifier, bearerToken } from './rateLimitTarget';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

// ─── Exempt paths ────────────────────────────────────────────────────────────

check('exempt: the scalar docs UI', isRateLimitExempt('/_docs/scalar', 'GET'));
check('exempt: the swagger docs UI', isRateLimitExempt('/_docs/swagger', 'GET'));
check('exempt: the OpenAPI document', isRateLimitExempt('/_docs/openapi.json', 'GET'));
check('exempt: the docs root itself', isRateLimitExempt('/_docs', 'GET'));
check('exempt: a query string does not hide the path', isRateLimitExempt('/_docs/scalar?theme=purple', 'GET'));
check('exempt: the health check', isRateLimitExempt('/health', 'GET'));
check('exempt: the favicon', isRateLimitExempt('/favicon.ico', 'GET'));
check('exempt: preflights, whatever the path', isRateLimitExempt('/v1/api/bookmarks', 'OPTIONS'));
check('exempt: method casing does not matter', isRateLimitExempt('/v1/api/bookmarks', 'options'));

check('counted: a developer API call', !isRateLimitExempt('/v1/api/bookmarks', 'GET'));
check('counted: search', !isRateLimitExempt('/search', 'POST'));
check('counted: the root path', !isRateLimitExempt('/', 'GET'));
check('counted: a prefix match is not a substring match', !isRateLimitExempt('/_docsearch/query', 'GET'));
check('counted: a path merely containing an exempt segment', !isRateLimitExempt('/v1/content/health-report', 'GET'));

// ─── The client's address behind the load balancer ───────────────────────────

check('ip: the left-most X-Forwarded-For entry is the client',
    resolveClientIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 127.0.0.1' }, '127.0.0.1') === '203.0.113.7');
check('ip: a single-hop X-Forwarded-For',
    resolveClientIp({ 'x-forwarded-for': '203.0.113.7' }, '127.0.0.1') === '203.0.113.7');
check('ip: whitespace is trimmed',
    resolveClientIp({ 'x-forwarded-for': '  203.0.113.7 , 10.0.0.2' }, '127.0.0.1') === '203.0.113.7');
check('ip: an array header (Node repeats) takes the first value',
    resolveClientIp({ 'x-forwarded-for': ['203.0.113.7', '198.51.100.4'] }, '127.0.0.1') === '203.0.113.7');
check('ip: X-Real-IP is the fallback',
    resolveClientIp({ 'x-real-ip': '203.0.113.9' }, '127.0.0.1') === '203.0.113.9');
check('ip: an empty X-Forwarded-For falls through to X-Real-IP',
    resolveClientIp({ 'x-forwarded-for': '', 'x-real-ip': '203.0.113.9' }, '127.0.0.1') === '203.0.113.9');
check('ip: the socket address is the last resort',
    resolveClientIp({}, '198.51.100.1') === '198.51.100.1');
check('ip: nothing at all is "unknown"',
    resolveClientIp({}, undefined) === 'unknown');
check('ip: a port is stripped',
    resolveClientIp({ 'x-forwarded-for': '203.0.113.7:51234' }, null) === '203.0.113.7');
check('ip: a bracketed IPv6 address loses its brackets and port',
    resolveClientIp({ 'x-forwarded-for': '[2001:db8::1]:443' }, null) === '2001:db8::1');
check('ip: a bare IPv6 address keeps its colons',
    resolveClientIp({ 'x-forwarded-for': '2001:db8::1' }, null) === '2001:db8::1');
check('ip: an IPv4-mapped socket address is unwrapped',
    resolveClientIp({}, '::ffff:203.0.113.7') === '203.0.113.7');
check('ip: two clients behind one proxy do not share a bucket',
    resolveClientIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }, '10.0.0.2') !==
    resolveClientIp({ 'x-forwarded-for': '198.51.100.4, 10.0.0.2' }, '10.0.0.2'));

// ─── Bucket identifiers ──────────────────────────────────────────────────────

check('bucket: an API key buckets by key', rateLimitIdentifier('wb_live_abc', '203.0.113.7') === rateLimitIdentifier('wb_live_abc', '198.51.100.4'));
check('bucket: the key is hashed, never stored as sent', !rateLimitIdentifier('wb_live_abc', '203.0.113.7').includes('wb_live_abc')
    && rateLimitIdentifier('wb_live_abc', '203.0.113.7').startsWith('key:'));
check('bucket: different keys, different buckets', rateLimitIdentifier('wb_live_abc', '') !== rateLimitIdentifier('wb_live_abd', ''));
check('bucket: no key buckets by address', rateLimitIdentifier(undefined, '203.0.113.7') === 'ip:203.0.113.7');
check('bucket: a blank key is no key', rateLimitIdentifier('   ', '203.0.113.7') === 'ip:203.0.113.7');
check('bucket: a key cannot collide with an address',
    rateLimitIdentifier('203.0.113.7', '198.51.100.4') !== rateLimitIdentifier(undefined, '203.0.113.7'));
check('bucket: a missing address is still a valid bucket', rateLimitIdentifier(undefined, '') === 'ip:unknown');

// ─── Bearer tokens ───────────────────────────────────────────────────────────

check('bearer: a bearer token is read', bearerToken('Bearer wb_live_abc') === 'wb_live_abc');
check('bearer: the scheme is case-insensitive', bearerToken('bearer wb_live_abc') === 'wb_live_abc');
check('bearer: surrounding whitespace is trimmed', bearerToken('Bearer   wb_live_abc  ') === 'wb_live_abc');
check('bearer: a Parse session token is still a token', bearerToken('Bearer r:sessiontoken') === 'r:sessiontoken');
check('bearer: no header is no token', bearerToken(undefined) === undefined);
check('bearer: another scheme is no token', bearerToken('Basic dXNlcjpwYXNz') === undefined);
check('bearer: an empty bearer is no token', bearerToken('Bearer    ') === undefined);

console.log(`\nrateLimitTarget: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
