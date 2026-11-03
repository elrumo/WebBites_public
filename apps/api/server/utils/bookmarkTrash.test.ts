/**
 * Tests for the bookmark trash arithmetic. The case worth pinning is the
 * counter tally: a row that never incremented the quota (bookmarkCounted
 * false) must not decrement it on delete, or every failed save would hand the
 * user a free bookmark slot. Run with:
 *
 *   npm run test:bookmarkTrash
 */

import { countedByUser, purgeCutoff, daysUntilPurge, TRASH_RETENTION_DAYS } from './bookmarkTrash';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const row = (userId: string | null, bookmarkCounted?: boolean) => ({
    get: (key: string) => key === 'user'
        ? (userId ? { id: userId } : undefined)
        : (key === 'bookmarkCounted' ? bookmarkCounted : undefined),
});

const now = new Date('2026-08-28T12:00:00.000Z');

check('counts one per row, per owner',
    JSON.stringify([...countedByUser([row('u1'), row('u1'), row('u2')])]) === '[["u1",2],["u2",1]]');

check('skips rows that never incremented the counter',
    countedByUser([row('u1', false), row('u1', true)]).get('u1') === 1);

check('a row with no owner is skipped, not counted under undefined',
    countedByUser([row(null)]).size === 0);

check('nothing to delete tallies nothing', countedByUser([]).size === 0);

check('the purge cutoff is exactly the retention window back',
    purgeCutoff(now) === new Date('2026-07-29T12:00:00.000Z').toISOString());

check('a row deleted just now has the full window left',
    daysUntilPurge(now.toISOString(), now) === TRASH_RETENTION_DAYS);

check('a row past its window reports zero, never negative',
    daysUntilPurge(new Date('2026-01-01T00:00:00.000Z').toISOString(), now) === 0);

console.log(`\nbookmark trash: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
