/**
 * Tests for the filter `/v1/search` sends to Meilisearch.
 *
 * `buildFilter` is the security boundary between one user's search and every
 * other user's bookmarks, and `sanitizeMeilisearchFilters` decides whether a
 * client's filter reaches Meilisearch as written. Run:
 *
 *   npm run test:meiliFilter
 */

import { buildFilter, mandatoryFilters, sanitizeMeilisearchFilters } from './meilisearchFilter';
import {
    NOT_DELETED_FILTER, DELETED_ONLY_FILTER,
    NOT_HIDDEN_FILTER, HIDDEN_ONLY_FILTER,
    type SearchScope,
} from './meilisearchTrash';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const scope = (over: Partial<SearchScope> = {}): SearchScope =>
    ({ deletedOnly: false, hiddenOnly: false, flagsFilterable: true, ...over });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const USER = 'u1';
const library = [`user.objectId = "${USER}"`, NOT_DELETED_FILTER, NOT_HIDDEN_FILTER];

// --- the scope --------------------------------------------------------------
check('the library is the user, minus the trash and the hidden', same(mandatoryFilters(USER, scope()), library));
check('the deleted section is the user\'s trash, hidden or not',
    same(mandatoryFilters(USER, scope({ deletedOnly: true })), [`user.objectId = "${USER}"`, DELETED_ONLY_FILTER]));
check('the Private section is the user\'s hidden bookmarks',
    same(mandatoryFilters(USER, scope({ hiddenOnly: true })), [`user.objectId = "${USER}"`, NOT_DELETED_FILTER, HIDDEN_ONLY_FILTER]));
check('before the flags are filterable, only the user clause is sent',
    same(mandatoryFilters(USER, scope({ flagsFilterable: false })), [`user.objectId = "${USER}"`]));

// --- the caller's filter ----------------------------------------------------
const fromApp = 'type = "website" AND tags = "swift" AND colorDescription CONTAINS "gray"';
check('no filter is the scope alone', same(buildFilter(USER, null, scope()), library));
check('an empty filter is the scope alone', same(buildFilter(USER, '   ', scope()), library));
check('a string filter is its own element, as written', same(buildFilter(USER, fromApp, scope()), [...library, fromApp]));
check('an array filter adds one element per clause',
    same(buildFilter(USER, ['type = "image"', 'tags = "a"'], scope()), [...library, 'type = "image"', 'tags = "a"']));
check('empty clauses in an array are dropped', same(buildFilter(USER, ['', 'tags = "a"'], scope()), [...library, 'tags = "a"']));

// The filter used to be spliced in as `scope AND (${filters})`, which an
// unbalanced parenthesis closed early: this one read as `(scope AND type =
// website) OR (type = website)`, every user's websites. As its own element
// Meilisearch parses it alone, and rejects it.
const escape = 'type = website) OR (type = website';
const built = buildFilter(USER, escape, scope());
check('a filter that closes the group early stays one element', same(built, [...library, escape]));
check('the scope is never merged into a string with the caller\'s filter',
    built.every((clause) => clause === escape || library.includes(clause)));
check('the user clause always comes first', buildFilter(USER, escape, scope({ hiddenOnly: true }))[0] === `user.objectId = "${USER}"`);

// --- sanitizing -------------------------------------------------------------
// Moved from the route unchanged; pinned here so it stays that way for the
// clients that still send the older syntaxes.
check('what the app sends goes through untouched', sanitizeMeilisearchFilters(fromApp) === fromApp);
check('a colour picked on its own goes through untouched',
    sanitizeMeilisearchFilters('colorDescription CONTAINS "red"') === 'colorDescription CONTAINS "red"');
check('Algolia-style strings are converted',
    sanitizeMeilisearchFilters("tags:swift AND siteAuthor:'John Doe'") === `tags = "swift" AND siteAuthor = 'John Doe'`);
check('a mixed string converts its Algolia half',
    sanitizeMeilisearchFilters('tags:design AND colorDescription CONTAINS red') === 'tags = "design" AND colorDescription CONTAINS red');
check('nothing is no filter', sanitizeMeilisearchFilters(undefined) === null && sanitizeMeilisearchFilters('') === null);
check('arrays are normalised clause by clause, non-strings dropped',
    same(sanitizeMeilisearchFilters(['tags:swift', 'type = "image"', 7]), ['tags = "swift"', 'type = "image"']));
check('objects become one clause per key, array values ORed',
    same(sanitizeMeilisearchFilters({ tags: ['a', 'b'], type: 'image' }), ['(tags = "a" OR tags = "b")', 'type = "image"']));
check('a whitespace-only filter still ends up as no filter',
    same(buildFilter(USER, sanitizeMeilisearchFilters('   '), scope()), library));

console.log(`\nmeilisearch filter: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
