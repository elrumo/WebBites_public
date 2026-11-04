/**
 * The MCP tool catalogue against its contract (docs/mcp-tools.json, shared
 * with the Mac app's local server): every tool complete and consistent, write
 * tools hidden from read-only callers, arguments validated the way a model
 * can act on.
 *
 * Run with:  npm run test:mcpToolCatalogue
 */

import contract from '../../docs/mcp-tools.json';
import { MCP_TOOLS, toolsForCaller, findTool, validateArguments, MCP_INSTRUCTIONS } from './mcpToolCatalogue';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) pass++; else { fail++; console.log(`FAIL: ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};

const EXPECTED = [
    'search_bookmarks', 'get_bookmark', 'list_boards', 'list_board_bookmarks', 'list_tags',
    'save_bookmark', 'save_note', 'update_bookmark', 'create_board', 'add_to_board', 'delete_bookmark',
];
check('the eleven tools, in contract order', JSON.stringify(MCP_TOOLS.map((t) => t.name)) === JSON.stringify(EXPECTED), MCP_TOOLS.map((t) => t.name));
check('names are unique', new Set(MCP_TOOLS.map((t) => t.name)).size === MCP_TOOLS.length);
check('instructions present', MCP_INSTRUCTIONS.length > 50);

for (const tool of MCP_TOOLS) {
    const schema = tool.inputSchema as any;
    const spec = (contract.tools as any[]).find((t) => t.name === tool.name);
    check(`${tool.name}: name is header-safe`, /^[A-Za-z0-9_.-]{1,128}$/.test(tool.name));
    check(`${tool.name}: closed input schema`, schema.type === 'object' && schema.additionalProperties === false);
    check(`${tool.name}: required ⊆ properties`, (schema.required ?? []).every((r: string) => r in schema.properties));
    check(`${tool.name}: has an output schema`, (tool.outputSchema as any)?.type === 'object');
    check(`${tool.name}: has a title and description`, !!tool.title && tool.description.length > 20);
    const a = tool.annotations as any;
    check(`${tool.name}: readOnlyHint matches write`, a.readOnlyHint === !tool.write, a);
    check(`${tool.name}: matches the contract`, spec && spec.write === tool.write && JSON.stringify(spec.inputSchema) === JSON.stringify(tool.inputSchema));
}
check('delete is destructive', (findTool('delete_bookmark')!.annotations as any).destructiveHint === true);
check('save_bookmark reaches the open web', (findTool('save_bookmark')!.annotations as any).openWorldHint === true);

const readOnly = toolsForCaller(false).map((t) => t.name);
check('read-only callers see only read tools', JSON.stringify(readOnly) === JSON.stringify(EXPECTED.slice(0, 5)), readOnly);
check('writers see everything', toolsForCaller(true).length === EXPECTED.length);
check('the internal write flag is not sent', toolsForCaller(true).every((t) => !('write' in t)));

const v = (tool: string, args: Record<string, unknown>) => validateArguments(findTool(tool)!.inputSchema, args);
check('valid search', v('search_bookmarks', { query: 'x', tags: ['a'], limit: 10 }) === null);
check('empty args are fine where nothing is required', v('list_boards', {}) === null);
check('nulls count as absent', v('search_bookmarks', { query: null, tags: null }) === null);
check('missing required', v('get_bookmark', {})?.includes("'id'"), v('get_bookmark', {}));
check('unknown argument named, with the accepted list', v('get_bookmark', { id: 'a', bogus: 1 })?.includes('bogus'), v('get_bookmark', { id: 'a', bogus: 1 }));
check('wrong type', v('search_bookmarks', { limit: 'ten' }) !== null);
check('integer required, not a fraction', v('search_bookmarks', { limit: 2.5 }) !== null);
check('over maximum', v('search_bookmarks', { limit: 51 })?.includes('at most'), v('search_bookmarks', { limit: 51 }));
check('enum', v('search_bookmarks', { type: 'video' })?.includes('one of'), v('search_bookmarks', { type: 'video' }));
check('too many items', v('add_to_board', { board_id: 'b', bookmark_ids: Array.from({ length: 51 }, (_, i) => `${i}`) }) !== null);
check('too few items', v('add_to_board', { board_id: 'b', bookmark_ids: [] }) !== null);
check('item too long', v('save_bookmark', { url: 'https://a.b', tags: ['x'.repeat(65)] })?.includes('tags[0]'), v('save_bookmark', { url: 'https://a.b', tags: ['x'.repeat(65)] }));
check('url format', v('save_bookmark', { url: 'not a url' }) !== null);
check('date-time format', v('search_bookmarks', { saved_after: 'last tuesday' }) !== null);
check('ISO date accepted', v('search_bookmarks', { saved_after: '2026-01-01T00:00:00Z' }) === null);
check('empty string refused where minLength 1', v('save_note', { text: '' }) !== null);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
