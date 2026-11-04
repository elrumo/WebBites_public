/**
 * Who may do what on a shared board: role ordering, bookmark removal, and the
 * invite payload cleaner.
 *
 * Run with:  npm run test:boardAccess
 */

import {
    INVITE_TTL_MS,
    MAX_INVITES_PER_REQUEST,
    canAddBookmarks,
    canManageBoard,
    canRead,
    canRemoveBookmark,
    hasRole,
    isMemberRole,
    isUiVisibility,
    memberKey,
    parseInvites,
} from './boardAccessRules';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => {
    if (ok) pass++; else { fail++; console.log(`FAIL: ${name}`); }
};
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

// roles
check('owner >= editor', hasRole('owner', 'editor'));
check('viewer < editor', !hasRole('viewer', 'editor'));
check('no role has nothing', !hasRole(null, 'viewer') && !hasRole(undefined, 'viewer'));
check('everyone with a role reads', canRead('viewer') && canRead('editor') && canRead('owner') && !canRead(null));
check('viewer cannot add', !canAddBookmarks('viewer') && canAddBookmarks('editor') && canAddBookmarks('owner'));
check('only the owner manages', canManageBoard('owner') && !canManageBoard('editor') && !canManageBoard('viewer'));
check('member roles', isMemberRole('viewer') && isMemberRole('editor') && !isMemberRole('owner') && !isMemberRole('x'));

// removing bookmarks
check('owner removes anyone\'s', canRemoveBookmark('owner', false));
check('editor removes own', canRemoveBookmark('editor', true));
check('editor cannot remove others\'', !canRemoveBookmark('editor', false));
check('viewer removes nothing', !canRemoveBookmark('viewer', true));
check('stranger removes nothing', !canRemoveBookmark(null, true));

// membership key
check('one row per board and address', memberKey('b1', 'a@b.co') === 'b1:a@b.co');

// parseInvites
const ok = parseInvites([{ email: ' Ana@Example.COM ', role: 'editor' }, { email: 'bo@example.com' }]);
check('lower-cases and trims', ok[0].email === 'ana@example.com');
check('role defaults to viewer', ok[1].role === 'viewer');
check('duplicates fold, last role wins',
    parseInvites([{ email: 'a@b.co', role: 'viewer' }, { email: 'A@b.co', role: 'editor' }]).length === 1
    && parseInvites([{ email: 'a@b.co', role: 'viewer' }, { email: 'A@b.co', role: 'editor' }])[0].role === 'editor');
check('owner\'s own address is dropped',
    parseInvites([{ email: 'me@x.io' }, { email: 'you@x.io' }], 'ME@x.io').map((i) => i.email).join() === 'you@x.io');
check('rejects non-array / empty', throws(() => parseInvites(undefined)) && throws(() => parseInvites([])));
check('rejects bad email', throws(() => parseInvites([{ email: 'nope' }])));
check('rejects owner role', throws(() => parseInvites([{ email: 'a@b.co', role: 'owner' }])));
check('caps the batch',
    throws(() => parseInvites(Array.from({ length: MAX_INVITES_PER_REQUEST + 1 }, (_, i) => ({ email: `u${i}@b.co` })))));

// visibility + ttl
check('ui visibilities', isUiVisibility('private') && isUiVisibility('link') && !isUiVisibility('email_list'));
check('invites live a month', INVITE_TTL_MS === 30 * 24 * 60 * 60 * 1000);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
