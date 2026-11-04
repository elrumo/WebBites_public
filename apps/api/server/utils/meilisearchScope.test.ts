/**
 * Tests for the search scoping: which slice of a user's bookmarks each section
 * is allowed to see.
 *
 * Worth pinning because the conditions invert per section and a transposition
 * is invisible in review but very visible to the user — the library showing
 * bookmarks they hid, or the Private section showing the ones they didn't. Run:
 *
 *   npm run test:meiliScope
 */

import {
    dropOutOfScopeHits, isHiddenDocument,
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

const plain = { objectId: 'plain' };
const trashed = { objectId: 'trashed', isDeleted: true };
const hiddenLibrary = { objectId: 'hidden-library', hiddenFrom: 'library' };
const hiddenEverywhere = { objectId: 'hidden-everywhere', hiddenFrom: 'everywhere' };
const unhidden = { objectId: 'unhidden', hiddenFrom: '' };
const both = { objectId: 'both', isDeleted: true, hiddenFrom: 'library' };

const all = [plain, trashed, hiddenLibrary, hiddenEverywhere, unhidden, both];
const ids = (hits: any[]) => hits.map((hit) => hit.objectId).sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- isHiddenDocument -------------------------------------------------------
// The empty string is what the document mapper writes for "not hidden", so it
// must not read as hidden — otherwise every ordinary bookmark vanishes.
check('an absent hiddenFrom is not hidden', isHiddenDocument(plain) === false);
check('an empty hiddenFrom is not hidden', isHiddenDocument(unhidden) === false);
check('library is hidden', isHiddenDocument(hiddenLibrary) === true);
check('everywhere is hidden', isHiddenDocument(hiddenEverywhere) === true);
check('an unexpected value is not treated as hidden', isHiddenDocument({ hiddenFrom: 'nonsense' }) === false);

// --- the library ------------------------------------------------------------
check(
    'the library sees only live, unhidden bookmarks',
    same(ids(dropOutOfScopeHits(all, scope())), ['plain', 'unhidden'])
);

// --- the trash --------------------------------------------------------------
// `both` belongs here: deleting a hidden bookmark has to leave it somewhere it
// can be restored from. Filtering on hidden here too put it in no list at all.
check(
    'the deleted section sees every trashed bookmark, hidden or not',
    same(ids(dropOutOfScopeHits(all, scope({ deletedOnly: true }))), ['both', 'trashed'])
);

// --- the Private section ----------------------------------------------------
check(
    'the Private section sees both levels of hidden, and nothing trashed',
    same(ids(dropOutOfScopeHits(all, scope({ hiddenOnly: true }))), ['hidden-everywhere', 'hidden-library'])
);
check(
    'a bookmark hidden from the library still counts as hidden',
    dropOutOfScopeHits([hiddenLibrary], scope({ hiddenOnly: true })).length === 1
);

// --- non-overlap ------------------------------------------------------------
// Every bookmark lands in exactly one section, or something is reachable twice
// (or not at all).
const sections = [scope(), scope({ deletedOnly: true }), scope({ hiddenOnly: true })];
const placements = all.map((hit) => sections.filter((s) => dropOutOfScopeHits([hit], s).length === 1).length);
check('every bookmark belongs to exactly one section', placements.every((n) => n === 1));

// --- degenerate input -------------------------------------------------------
check('a non-array is passed through untouched', dropOutOfScopeHits(null as any, scope()) === null);
check('an empty page stays empty', dropOutOfScopeHits([], scope()).length === 0);

// --- the filter strings -----------------------------------------------------
// A missing attribute must satisfy the "not hidden" filter, because that is the
// state of every bookmark indexed before this shipped.
check('the not-hidden filter admits a missing attribute', NOT_HIDDEN_FILTER.includes('hiddenFrom NOT EXISTS'));
// `IS EMPTY`, never `= ""`: Meilisearch equality does not match an empty
// string, and the document mapper writes one on every bookmark it indexes — so
// `= ""` hid every newly saved bookmark from search.
check('the not-hidden filter admits the empty string', NOT_HIDDEN_FILTER.includes('hiddenFrom IS EMPTY'));
check('the not-hidden filter never compares to an empty string', !NOT_HIDDEN_FILTER.includes('= ""'));
check('the hidden-only filter names both levels',
    HIDDEN_ONLY_FILTER.includes('"library"') && HIDDEN_ONLY_FILTER.includes('"everywhere"'));
check('the trash filters are unchanged',
    NOT_DELETED_FILTER.includes('isDeleted NOT EXISTS') && DELETED_ONLY_FILTER === 'isDeleted = true');

console.log(`\nmeilisearch search scope: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
