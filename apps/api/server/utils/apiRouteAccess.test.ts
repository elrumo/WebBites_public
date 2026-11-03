/**
 * Which credential each /v1 path needs. The api-key middleware was a no-op
 * for months, leaving pipeline-only routes (categoriseSite, getPageContent
 * with a savedSiteId, triggers…) open to anyone.
 *
 * Run with:  npm run test:apiRouteAccess
 */

import { routeAccess, normalisePath, registerPublicPrefixes } from './apiRouteAccess';

let pass = 0, fail = 0;
const expect = (path: string, want: string) => {
    const got = routeAccess(normalisePath(path));
    if (got === want) pass++; else { fail++; console.log(`FAIL: ${path} → ${got}, want ${want}`); }
};

// Pipeline-only: need the internal key
for (const p of [
    '/v1/content/categoriseSite', '/v1/content/saveBookmark', '/v1/content/images/getOcr',
    '/v1/content/media/saveMovie', '/v1/content/checkForAdultContent',
    '/v1/triggers/websites/afterSave', '/v1/triggers/users/beforeDelete',
    '/v1/sync/getUserCounts', '/v1/import/importBookmarks', '/v1/import/removeFromQueue', '/v1/import/cancelImport',
    '/v1/dev/plans/reconcile', '/v1/search/dev/migrateToMeilisearch', '/v1/example',
    // job queue: only the web app and Parse cloud code (with the internal key) may enqueue
    '/v1/jobs/enqueue', '/V1/Jobs/Enqueue', '/v1//jobs/enqueue/',
    // bypass attempts
    '/V1/Content/CategoriseSite', '/v1//content/categoriseSite', '/v1/content/categoriseSite/',
    '/v1/content%2FcategoriseSite', '/v1/content/getPageContentX',
    // legacy root tag routes
    '/tags/rebuildUserTags', '/Tags/RebuildUserTags/', '/tags/deleteWebsiteTags', '/tags%2FmigrateTagsToNewSchema',
]) expect(p, 'internal');

// Clients call these with their own credential
for (const p of [
    '/v1/content/getPageContent', '/v1/content/getAiSummary', '/v1/content/saveNote',
    '/v1/content/startSaveProcess', '/v1/content/enrichBookmark',
    '/v1/import/connect', '/v1/import/connect/raindrop',
    '/v1/boards', '/v1/rss/items', '/v1/audio/getAudio', '/v1/api/bookmarks', '/v1/me/entitlements',
    '/v1/me/email',
]) expect(p, 'user');

// Authenticate themselves or are public
for (const p of [
    '/v1/auth/login', '/v1/auth/session-login', '/v1/auth/verifyEmailChange', '/v1/search/saveToSearchIndex',
    '/v1/public/boards/abc', '/v1/audio/streamAudio',
    '/v1/backups/connect/dropbox/callback', '/v1/import/connect/raindrop/callback',
]) expect(p, 'public');

// A deployment's own webhooks are internal until it registers them as public (the hosted overlay does)
for (const p of ['/v1/payments/confirmPayment', '/v1/plans', '/v1/webhooks/appstore']) expect(p, 'user');
registerPublicPrefixes('/v1/payments', '/v1/webhooks/appstore');
for (const p of ['/v1/payments/confirmPayment', '/V1/Payments/confirmPayment', '/v1/webhooks/appstore']) expect(p, 'public');
expect('/v1/paymentsx/steal', 'user');  // a prefix, not a substring
let rejected = false;
try { registerPublicPrefixes('/qstash-webhook'); } catch { rejected = true; }
if (!rejected) { fail++; console.log('FAIL: registerPublicPrefixes accepted a non-/v1/ prefix'); } else pass++;

// Root routes: the default is 'internal', so legacy handlers that trust a
// body userId are not reachable without the internal key.
for (const p of [
    '/batchDelete', '/removeDuplicates', '/setACL', '/sendEmail', '/newUserFlow',
    '/getAnalyticsReports', '/getAnalyticsStats', '/getTaskDashboard', '/getTaskExecutions',
    '/validateImportAccess', '/v1',
    // unknown root routes deny by default rather than falling open
    '/somethingAddedLater', '/BatchDelete/', '/batchDelete%2Fx',
]) expect(p, 'internal');

// Root routes clients reach with their own credential
for (const p of [
    '/isPageSaved', '/raycast-user', '/raycast/bookmarks',
    '/saveUserImage', '/saveUserPdf', '/saveUserAudio',
]) expect(p, 'user');

// Root routes that need no credential (self-verifying or contentless)
for (const p of [
    '/qstash-webhook', '/health', '/test', '/keepAwake', '/cors-preflight',
    '/extension-auth', '/verify-extension-token', '/deleteSession',
    '/', // index
    // MCP and its OAuth server authenticate themselves
    '/mcp', '/MCP', '/mcp/', '/oauth/token', '/oauth/authorize', '/oauth/register', '/oauth/revoke',
    '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
]) expect(p, 'public');

// Near misses of those stay behind the internal key
for (const p of ['/mcpx', '/mcp-admin', '/oauthx', '/oauth-debug', '/.well-knownx']) expect(p, 'internal');

// The consent and connected-assistant APIs need a signed-in user
for (const p of ['/v1/oauth/requests/abc', '/v1/oauth/authorize/confirm', '/v1/oauth/grants', '/v1/oauth/grants/abc']) expect(p, 'user');

let threw = false;
try { normalisePath('/v1/%E0%A4%A'); } catch { threw = true; }
if (threw) pass++; else { fail++; console.log('FAIL: bad encoding should throw'); }

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
