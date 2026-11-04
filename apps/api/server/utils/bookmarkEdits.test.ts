/**
 * The field rules behind the MCP update_bookmark tool.
 *
 * Run with:  npm run test:bookmarkEdits
 */

import { normaliseTags, applyTagEdits, editsToColumns, MAX_TAGS, MAX_TITLE_LENGTH } from './bookmarkEditRules';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a === b) pass++; else { fail++; console.log(`FAIL: ${name}\n  got:  ${a}\n  want: ${b}`); }
};

check('normalise trims, dedupes by case, drops empties and non-strings',
    normaliseTags([' Design ', 'design', '', 3, 'web']), ['Design', 'web']);
check('normalise caps the count', normaliseTags(Array.from({ length: 80 }, (_, i) => `t${i}`)).length, MAX_TAGS);
check('normalise ignores a non-array', normaliseTags('design'), []);
check('tags replaces', applyTagEdits(['a', 'b'], { tags: ['c'] }), ['c']);
check('add_tags appends without duplicates', applyTagEdits(['a', 'b'], { addTags: ['B', 'c'] }), ['a', 'b', 'c']);
check('remove_tags ignores case', applyTagEdits(['Design', 'web'], { removeTags: ['design'] }), ['web']);
check('replace then add then remove', applyTagEdits(['x'], { tags: ['a'], addTags: ['b'], removeTags: ['a'] }), ['b']);
check('nothing to change', editsToColumns({ tags: [] }, {}), null);
check('title capped and trimmed', (editsToColumns({}, { title: ' ' + 'x'.repeat(400) }) as any).siteTitle.length, MAX_TITLE_LENGTH);
check('empty note clears it', editsToColumns({}, { note: '   ' }), { siteNotes: '' });
check('pin only', editsToColumns({ tags: ['a'] }, { pinned: false }), { pinned: false });
check('tags only touch tags', editsToColumns({ tags: ['a'] }, { addTags: ['b'] }), { tags: ['a', 'b'] });

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
