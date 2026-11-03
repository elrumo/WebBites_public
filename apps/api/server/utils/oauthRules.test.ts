/**
 * The rules of the MCP sign-in (OAuth 2.1): PKCE, redirect URIs, scopes,
 * resource indicators, client registration and metadata documents, refresh
 * rotation.
 *
 * Run with:  npm run test:oauthRules
 */

import {
    verifyPkceS256, isValidCodeChallenge, requestedScopes, grantedScopes, checkRedirectUri, redirectUriMatches,
    normaliseResource, resolveResource, validateRegistration, isClientMetadataUrl, validateClientMetadataDocument,
    refreshDecision, redirectWith, randomToken, hashOAuthToken, cleanClientName, authorizationServerMetadata,
    protectedResourceMetadata, TOKEN_PREFIX, REFRESH_GRACE_SECONDS,
} from './oauthRules';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) pass++; else { fail++; console.log(`FAIL: ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// ─── PKCE: RFC 7636 Appendix B ───
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
check('RFC 7636 vector verifies', verifyPkceS256(verifier, challenge));
check('wrong verifier fails', !verifyPkceS256(verifier.replace('d', 'e'), challenge));
check('short verifier fails', !verifyPkceS256('abc', challenge));
check('non-string verifier fails', !verifyPkceS256(undefined, challenge));
check('challenge shape', isValidCodeChallenge(challenge) && !isValidCodeChallenge('short') && !isValidCodeChallenge(`${challenge}=`));

// ─── Scopes ───
eq('no scope means everything', requestedScopes(undefined), ['bookmarks:read', 'bookmarks:write']);
eq('read only', requestedScopes('bookmarks:read'), ['bookmarks:read']);
eq('write implies read', requestedScopes('bookmarks:write'), ['bookmarks:read', 'bookmarks:write']);
eq('unknown scopes dropped', requestedScopes('openid offline_access bookmarks:read'), ['bookmarks:read']);
eq('only unknown scopes → read', requestedScopes('openid'), ['bookmarks:read']);
eq('granted with writes', grantedScopes(['bookmarks:read', 'bookmarks:write'], true), ['bookmarks:read', 'bookmarks:write']);
eq('granted read-only by choice', grantedScopes(['bookmarks:read', 'bookmarks:write'], false), ['bookmarks:read']);
eq('write never granted unasked', grantedScopes(['bookmarks:read'], true), ['bookmarks:read']);

// ─── Redirect URIs ───
const ok = (uri: string, kind: string) => { const r = checkRedirectUri(uri); check(`redirect ok: ${uri}`, r.ok === true && (r as any).kind === kind, r); };
const bad = (uri: unknown) => check(`redirect refused: ${String(uri)}`, checkRedirectUri(uri).ok === false, checkRedirectUri(uri));
ok('https://claude.ai/api/mcp/auth_callback', 'web');
ok('http://localhost:33418/callback', 'loopback');
ok('http://127.0.0.1/cb', 'loopback');
ok('http://[::1]:8080/cb', 'loopback');
ok('cursor://anysphere.cursor-retrieval/oauth/callback', 'app');
ok('com.example.app:/oauth2redirect', 'app');
bad('http://example.com/cb');
bad('javascript:alert(1)');
bad('data:text/html,hi');
bad('file:///etc/passwd');
bad('https://claude.ai/cb#frag');
bad('https://user:pass@claude.ai/cb');
bad('not a uri');
bad('');
bad(42);
check('display of a web redirect is its host', (checkRedirectUri('https://chatgpt.com/connector/oauth/x') as any).display === 'chatgpt.com');

check('exact redirect match', redirectUriMatches(['https://a.io/cb'], 'https://a.io/cb'));
check('no prefix matching', !redirectUriMatches(['https://a.io/cb'], 'https://a.io/cb/evil'));
check('no query smuggling', !redirectUriMatches(['https://a.io/cb'], 'https://a.io/cb?next=evil'));
check('loopback any port', redirectUriMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:51234/callback'));
check('loopback path must match', !redirectUriMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:51234/other'));
check('loopback host must match', !redirectUriMatches(['http://127.0.0.1/callback'], 'http://localhost:51234/callback'));
check('https gets no port leeway', !redirectUriMatches(['https://a.io/cb'], 'https://a.io:8443/cb'));

// ─── Resource indicators ───
const MCP = 'https://api.webbites.io/mcp';
eq('normalise case and slash', normaliseResource('HTTPS://API.WebBites.io/mcp/'), 'https://api.webbites.io/mcp');
eq('fragment is unusable', normaliseResource('https://api.webbites.io/mcp#x'), null);
eq('endpoint accepted', resolveResource('https://api.webbites.io/mcp', MCP), MCP);
eq('trailing slash accepted', resolveResource('https://api.webbites.io/mcp/', MCP), MCP);
eq('origin accepted, bound to the endpoint', resolveResource('https://api.webbites.io', MCP), MCP);
eq('absent → the endpoint', resolveResource(undefined, MCP), MCP);
eq('another server refused', resolveResource('https://evil.example/mcp', MCP), null);
eq('another path refused', resolveResource('https://api.webbites.io/v1', MCP), null);

// ─── Registration (RFC 7591) ───
const reg = validateRegistration({ client_name: ' Claude‮ ', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
check('registration ok', reg.ok === true, reg);
check('defaults to a public client', reg.ok === true && reg.client.tokenEndpointAuthMethod === 'none');
check('name cleaned of bidi controls', reg.ok === true && reg.client.clientName === 'Claude', reg);
check('registration is dcr', reg.ok === true && reg.client.registration === 'dcr');
check('confidential allowed', validateRegistration({ redirect_uris: ['https://a.io/cb'], token_endpoint_auth_method: 'client_secret_basic' }).ok === true);
eq('bad redirect', (validateRegistration({ redirect_uris: ['http://evil.example/cb'] }) as any).error, 'invalid_redirect_uri');
eq('no redirects', (validateRegistration({}) as any).error, 'invalid_redirect_uri');
eq('jwt auth unsupported', (validateRegistration({ redirect_uris: ['https://a.io/cb'], token_endpoint_auth_method: 'private_key_jwt' }) as any).error, 'invalid_client_metadata');
eq('implicit grant refused', (validateRegistration({ redirect_uris: ['https://a.io/cb'], grant_types: ['implicit'] }) as any).error, 'invalid_client_metadata');
eq('token response type refused', (validateRegistration({ redirect_uris: ['https://a.io/cb'], response_types: ['token'] }) as any).error, 'invalid_client_metadata');
check('not an object', validateRegistration([]).ok === false);
eq('empty name', cleanClientName(''), 'Unnamed app');
check('long name capped', cleanClientName('x'.repeat(500)).length === 80);

// ─── Client ID Metadata Documents ───
const url = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
check('metadata URL', isClientMetadataUrl(url));
check('origin alone is not a metadata URL', !isClientMetadataUrl('https://claude.ai/'));
check('http is not a metadata URL', !isClientMetadataUrl('http://claude.ai/meta'));
check('a registered id is not a metadata URL', !isClientMetadataUrl('wbo_client_abc'));
const doc = validateClientMetadataDocument({ client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, url);
check('document accepted as cimd', doc.ok === true && doc.client.registration === 'cimd' && doc.client.clientName === 'Claude', doc);
check('document must name itself', validateClientMetadataDocument({ client_id: 'https://evil.example/x', redirect_uris: ['https://a.io/cb'] }, url).ok === false);
check('document must be public', validateClientMetadataDocument({ client_id: url, redirect_uris: ['https://a.io/cb'], token_endpoint_auth_method: 'private_key_jwt' }, url).ok === false);
check('document needs redirects', validateClientMetadataDocument({ client_id: url }, url).ok === false);

// ─── Refresh rotation ───
const now = 1_000_000;
eq('active rotates', refreshDecision({ grantId: 'g', clientId: 'c', status: 'active' }, now), 'rotate');
eq('retry inside grace', refreshDecision({ grantId: 'g', clientId: 'c', status: 'rotated', rotatedAt: now - 5_000 }, now), 'retry');
eq('replay after grace revokes', refreshDecision({ grantId: 'g', clientId: 'c', status: 'rotated', rotatedAt: now - (REFRESH_GRACE_SECONDS + 1) * 1000 }, now), 'revoke_grant');

// ─── Tokens and responses ───
const token = randomToken(TOKEN_PREFIX.access);
check('token prefix and length', token.startsWith('wbo_at_') && token.length > 40);
check('tokens differ', randomToken(TOKEN_PREFIX.access) !== token);
check('hash is stable hex', /^[0-9a-f]{64}$/.test(hashOAuthToken(token)) && hashOAuthToken(token) === hashOAuthToken(token));
eq('redirect keeps its query', redirectWith('https://a.io/cb?x=1', { code: 'c', state: 's', iss: 'https://api.webbites.io', skip: undefined }),
    'https://a.io/cb?x=1&code=c&state=s&iss=https%3A%2F%2Fapi.webbites.io');

// ─── Metadata ───
const as = authorizationServerMetadata('https://api.webbites.io', 'https://webbites.io');
check('AS metadata: S256 advertised', JSON.stringify(as.code_challenge_methods_supported) === '["S256"]');
check('AS metadata: CIMD + iss', as.client_id_metadata_document_supported === true && as.authorization_response_iss_parameter_supported === true);
check('AS metadata: endpoints under the issuer', [as.authorization_endpoint, as.token_endpoint, as.registration_endpoint, as.revocation_endpoint]
    .every((endpoint) => endpoint.startsWith('https://api.webbites.io/oauth/')));
const prm = protectedResourceMetadata(MCP, 'https://api.webbites.io', 'https://webbites.io');
check('PRM: resource exact, AS listed', prm.resource === MCP && prm.authorization_servers[0] === 'https://api.webbites.io');
check('PRM: no offline_access', !prm.scopes_supported.includes('offline_access' as any));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
