/**
 * The MCP wire rules: both protocol eras, header/body validation, error codes
 * and HTTP statuses, against fake tools.
 *
 * Run with:  npm run test:mcpProtocol
 */

import { handleMcpPost, decodeMirroredHeader, RPC_ERROR, SUPPORTED_PROTOCOL_VERSIONS, type McpHandlers, type McpHttpRequest } from './mcpProtocol';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) pass++; else { fail++; console.log(`FAIL: ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};

const calls: string[] = [];
const handlers: McpHandlers = {
    serverInfo: { name: 'webbites', title: 'WebBites', version: '1.0.0' },
    instructions: 'Use the tools.',
    listTools: () => [{ name: 'search_bookmarks', description: 'Search', inputSchema: { type: 'object' } }],
    async callTool(name, args, context) {
        calls.push(`${context.era}:${name}`);
        if (name === 'boom') throw new Error('kaboom');
        if (name === 'delete_bookmark') return { kind: 'forbidden', message: 'read only', headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope"' } };
        if (name !== 'search_bookmarks' && name !== 'emoji 🔖') return { kind: 'unknown_tool' };
        return { kind: 'result', result: { content: [{ type: 'text', text: '{}' }], structuredContent: { echo: args } } };
    },
};

const MODERN = '2026-07-28';
const meta = (extra: Record<string, unknown> = {}) => ({ _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' } }, ...extra });

function request(body: unknown, headers: Record<string, string> = {}): McpHttpRequest {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { header: (name) => lower[name.toLowerCase()], rawBody: typeof body === 'string' ? body : JSON.stringify(body) };
}
const modernHeaders = (method: string, name?: string) => ({ 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}) });
const body = (r: any) => r.body as any;

(async () => {
    // ─── Malformed ───
    let r = await handleMcpPost(request('{nope'), handlers);
    check('parse error is 400 -32700', r.status === 400 && body(r).error.code === RPC_ERROR.PARSE_ERROR, r);
    r = await handleMcpPost(request({ id: 1, method: 'ping' }), handlers);
    check('missing jsonrpc is 400 -32600', r.status === 400 && body(r).error.code === RPC_ERROR.INVALID_REQUEST, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: {}, method: 'ping' }), handlers);
    check('object id is invalid', r.status === 400, r);

    // ─── Modern ───
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: meta() }, modernHeaders('server/discover')), handlers);
    check('discover 200', r.status === 200, r);
    check('discover result complete', body(r).result.resultType === 'complete');
    check('discover lists every version', JSON.stringify(body(r).result.supportedVersions) === JSON.stringify(SUPPORTED_PROTOCOL_VERSIONS));
    check('discover serverInfo in _meta', body(r).result._meta['io.modelcontextprotocol/serverInfo'].name === 'webbites');
    check('discover caching fields', typeof body(r).result.ttlMs === 'number' && body(r).result.cacheScope === 'public');
    check('discover tools capability', body(r).result.capabilities.tools !== undefined);
    check('json content type', r.headers['Content-Type'] === 'application/json');

    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: meta() }, modernHeaders('tools/list')), handlers);
    check('modern tools/list', r.status === 200 && body(r).result.tools.length === 1 && body(r).result.cacheScope === 'private' && body(r).result.resultType === 'complete', r);

    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: meta() }, { 'Mcp-Method': 'tools/list' }), handlers);
    check('missing version header is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: meta() }, { 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Method': 'tools/list' }), handlers);
    check('version header ≠ _meta is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: meta() }, modernHeaders('tools/call')), handlers);
    check('method header ≠ body is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: meta() }, { 'MCP-Protocol-Version': MODERN }), handlers);
    check('missing Mcp-Method is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);

    const call = (name: string, args: unknown = {}) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: meta({ name, arguments: args }) });
    r = await handleMcpPost(request(call('search_bookmarks', { query: 'x' }), modernHeaders('tools/call', 'search_bookmarks')), handlers);
    check('modern tools/call', r.status === 200 && body(r).result.structuredContent.echo.query === 'x' && body(r).result.isError === false && body(r).result.resultType === 'complete', r);
    r = await handleMcpPost(request(call('search_bookmarks'), modernHeaders('tools/call')), handlers);
    check('tools/call without Mcp-Name is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);
    r = await handleMcpPost(request(call('search_bookmarks'), modernHeaders('tools/call', 'list_tags')), handlers);
    check('Mcp-Name ≠ body name is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);
    const encoded = `=?base64?${Buffer.from('emoji 🔖').toString('base64')}?=`;
    r = await handleMcpPost(request(call('emoji 🔖'), modernHeaders('tools/call', encoded)), handlers);
    check('base64 Mcp-Name is decoded before comparing', r.status === 200 && !body(r).error, r);

    r = await handleMcpPost(request(call('nope'), modernHeaders('tools/call', 'nope')), handlers);
    check('unknown tool is -32602', r.status === 200 && body(r).error.code === RPC_ERROR.INVALID_PARAMS, r);
    r = await handleMcpPost(request(call('delete_bookmark'), modernHeaders('tools/call', 'delete_bookmark')), handlers);
    check('forbidden tool is 403 with the challenge', r.status === 403 && r.headers['WWW-Authenticate']?.includes('insufficient_scope'), r);
    r = await handleMcpPost(request(call('boom'), modernHeaders('tools/call', 'boom')), handlers);
    check('handler crash is -32603, not a thrown error', r.status === 200 && body(r).error.code === RPC_ERROR.INTERNAL_ERROR, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: meta({ name: 'search_bookmarks', arguments: [1] }) }, modernHeaders('tools/call', 'search_bookmarks')), handlers);
    check('array arguments are -32602', body(r).error?.code === RPC_ERROR.INVALID_PARAMS, r);

    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: meta() }, modernHeaders('resources/list')), handlers);
    check('modern unknown method is 404 -32601', r.status === 404 && body(r).error.code === RPC_ERROR.METHOD_NOT_FOUND, r);

    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } }, { 'MCP-Protocol-Version': '1900-01-01', 'Mcp-Method': 'tools/list' }), handlers);
    check('unsupported version is 400 -32022 with the list', r.status === 400 && body(r).error.code === RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION
        && body(r).error.data.requested === '1900-01-01' && body(r).error.data.supported.includes(MODERN), r);

    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' }), handlers);
    check('modern header with no _meta is -32020', r.status === 400 && body(r).error.code === RPC_ERROR.HEADER_MISMATCH, r);

    // ─── Legacy ───
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }), handlers);
    check('initialize echoes a supported legacy version', body(r).result.protocolVersion === '2025-06-18', r);
    check('initialize has serverInfo + tools capability', body(r).result.serverInfo.name === 'webbites' && body(r).result.capabilities.tools);
    check('initialize mints no session', !Object.keys(r.headers).some((h) => h.toLowerCase() === 'mcp-session-id'));
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05' } }), handlers);
    check('initialize answers an unknown version with the newest legacy one', body(r).result.protocolVersion === '2025-11-25', r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'MCP-Protocol-Version': '2025-06-18' }), handlers);
    check('notification is 202 with no body', r.status === 202 && r.body === undefined, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 5, result: {} }), handlers);
    check('a client response is accepted with 202', r.status === 202, r);

    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-06-18' }), handlers);
    check('legacy tools/list has no modern fields', r.status === 200 && body(r).result.tools.length === 1 && body(r).result.resultType === undefined, r);
    calls.length = 0;
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_bookmarks', arguments: {} } }, { 'MCP-Protocol-Version': '2025-11-25' }), handlers);
    check('legacy tools/call needs no Mcp-* headers', r.status === 200 && body(r).result.isError === false && calls[0] === 'legacy:search_bookmarks', { r, calls });
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 3, method: 'ping' }), handlers);
    check('headerless legacy request is served (2025-03-26)', r.status === 200 && JSON.stringify(body(r).result) === '{}', r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 4, method: 'prompts/list' }, { 'MCP-Protocol-Version': '2025-06-18' }), handlers);
    check('legacy unknown method is 200 -32601', r.status === 200 && body(r).error.code === RPC_ERROR.METHOD_NOT_FOUND, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 4, method: 'server/discover' }, { 'MCP-Protocol-Version': '2025-06-18' }), handlers);
    check('server/discover is modern-only', body(r).error?.code === RPC_ERROR.METHOD_NOT_FOUND, r);
    r = await handleMcpPost(request({ jsonrpc: '2.0', id: 4, method: 'ping' }, { 'MCP-Protocol-Version': '2024-11-05' }), handlers);
    check('unsupported legacy header is 400 -32022', r.status === 400 && body(r).error.code === RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION, r);

    // ─── Batches (2025-03-26 only) ───
    r = await handleMcpPost(request([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]), handlers);
    check('batch answers each request, skips notifications', r.status === 200 && Array.isArray(r.body) && (r.body as any[]).length === 2, r);
    r = await handleMcpPost(request([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), handlers);
    check('all-notification batch is 202', r.status === 202, r);
    r = await handleMcpPost(request([{ jsonrpc: '2.0', id: 1, method: 'ping' }], { 'MCP-Protocol-Version': '2025-06-18' }), handlers);
    check('batch refused after 2025-03-26', r.status === 400, r);
    r = await handleMcpPost(request([]), handlers);
    check('empty batch is invalid', r.status === 400, r);

    // ─── Header decoding ───
    check('plain header kept', decodeMirroredHeader('search_bookmarks') === 'search_bookmarks');
    check('base64 sentinel decoded', decodeMirroredHeader(`=?base64?${Buffer.from('Hello, 世界').toString('base64')}?=`) === 'Hello, 世界');
    check('control characters refused', decodeMirroredHeader('a\nb') === null);
    check('broken sentinel refused', decodeMirroredHeader('=?base64?***?=') === null);

    console.log(`${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})();
