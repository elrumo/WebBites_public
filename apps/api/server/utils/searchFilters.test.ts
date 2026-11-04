/**
 * Typed search arguments become Meilisearch clauses that nothing a language
 * model writes can break out of.
 *
 * Run with:  npm run test:searchFilters
 */

import { meiliQuote, typedSearchFilters, savedWithin, encodeOffsetCursor, decodeOffsetCursor } from './searchFilters';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a === b) pass++; else { fail++; console.log(`FAIL: ${name}\n  got:  ${a}\n  want: ${b}`); }
};
const throws = (name: string, fn: () => unknown) => {
    try { fn(); fail++; console.log(`FAIL: ${name} should throw`); } catch { pass++; }
};

check('plain value', meiliQuote('design'), '"design"');
check('quote escaped', meiliQuote('a" OR user.objectId = "x'), '"a\\" OR user.objectId = \\"x"');
check('backslash escaped first', meiliQuote('a\\" b'), '"a\\\\\\" b"');
check('tags and type', typedSearchFilters({ tags: ['web', ' ux '], type: 'pdf' }), ['tags = "web"', 'tags = "ux"', 'type = "pdf"']);
check('blank values dropped', typedSearchFilters({ tags: ['', '  '], type: ' ' }), []);
check('nothing', typedSearchFilters({}), []);

check('no range', savedWithin('2026-01-01T00:00:00Z'), true);
check('after inclusive', savedWithin('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), true);
check('before exclusive', savedWithin('2026-01-01T00:00:00Z', undefined, '2026-01-01T00:00:00Z'), false);
check('parse date object', savedWithin({ __type: 'Date', iso: '2026-03-01T00:00:00Z' }, '2026-02-01', '2026-04-01'), true);
check('Date instance', savedWithin(new Date('2025-01-01'), '2026-01-01'), false);
check('unparseable date excluded', savedWithin('soon', '2026-01-01'), false);

check('cursor round trip', decodeOffsetCursor(encodeOffsetCursor(40)), 40);
check('no cursor', decodeOffsetCursor(undefined), 0);
throws('garbage cursor', () => decodeOffsetCursor('not-a-cursor'));
throws('negative offset', () => decodeOffsetCursor(Buffer.from('{"o":-1}').toString('base64url')));
throws('huge offset', () => decodeOffsetCursor(Buffer.from('{"o":1e9}').toString('base64url')));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
