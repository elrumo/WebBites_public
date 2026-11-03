/**
 * Tests for finding a deleted account's files outside its own prefixes.
 *
 * The case worth pinning hardest is the one that must NOT be deleted: a plain
 * user-chosen name like `image.png`. Parse keeps upload names as they are, so
 * that object may be somebody else's upload too, and deleting it for one
 * account would take it from another. Run with:
 *
 *   npm run test:userStorageKeys
 */

// The installation these URLs belong to, and the hosts its older rows still point at.
process.env.S3_PUBLIC_URL = 'https://s3.example.test';
process.env.STORAGE_LEGACY_HOSTS = 'files.example.test';

import {
    isOwnParseFileName,
    parseFileNamesIn,
    isStrayUserKey,
    keyForParseFileName,
    relinkStorageKeys,
    storageKeysIn,
    storageKeysInRow,
    userStoragePrefixes,
} from './userStorageKeys';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const bucket = 'webbites';
const user = 'u1AbCdEf23';
const uuid = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';
const keys = (value: unknown) => [...storageKeysIn(value, bucket)].sort().join(',');

// ─── The prefixes ────────────────────────────────────────────────────────────

check(
    'both writers\' prefixes are swept, with and without the leading slash',
    userStoragePrefixes(user).join() === `parse/user/${user}/,userFiles/${user}/,/userFiles/${user}/`
);

// ─── Parse file names ────────────────────────────────────────────────────────

check('a rewritten name keeps its path', keyForParseFileName(`user/${user}/1_x.png`) === `parse/user/${user}/1_x.png`);
check(
    'a parseUser= name maps the way generateKey does',
    keyForParseFileName(`parseUser=${user}_fileName=1_x.png`) === `parse/user/${user}/1_x.png`
);
check('so does the legacy form', keyForParseFileName(`parseuser=${user}_x.png`) === `parse/user/${user}/x.png`);
check('a plain name is stored as it stands', keyForParseFileName('IMG_0001.jpg') === 'parse/IMG_0001.jpg');

// ─── What a row refers to ────────────────────────────────────────────────────

check(
    'a Parse file is found by its name',
    keys({ fullPageScreenshot: { __type: 'File', name: `device-screenshot-${uuid}.jpg`, url: 'https://s3.example.test/webbites/parse/x' } })
        === `parse/device-screenshot-${uuid}.jpg`
);
check(
    'a bare URL into the bucket is found',
    keys({ fileUrl: 'https://s3.example.test/webbites/parse/share-image.jpg' }) === 'parse/share-image.jpg'
);
check(
    'every image in a note\'s HTML is found, and its query ignored',
    keys({
        textNote: `<p>a</p><img src="https://s3.example.test/webbites/parse/note-drawing-${uuid}.png?v=2" `
            + `data-webbites-drawing="https://s3.example.test/webbites/parse/note-drawing-${uuid}.bin">`,
    }) === `parse/note-drawing-${uuid}.bin,parse/note-drawing-${uuid}.png`
);
check(
    'nested arrays of objects are followed',
    keys({ images: [{ id: 'a', url: 'https://s3.example.test/webbites/parse/a.jpg' }, { id: 'b', url: 'https://s3.example.test/webbites/parse/b.jpg' }] })
        === 'parse/a.jpg,parse/b.jpg'
);
check(
    'percent-encoding is undone, so the key is the stored one',
    keys({ fileUrl: 'https://s3.example.test/webbites/parse/My%20Photo.jpg' }) === 'parse/My Photo.jpg'
);
check(
    'uploadToS3\'s double slash comes back as the leading slash its key has',
    keys({ OGImage: `https://files.example.test/webbites//userFiles/${user}/1.png` }) === `/userFiles/${user}/1.png`
);
check('another bucket is not ours', keys({ fileUrl: 'https://s3.example.test/other/parse/x.jpg' }) === '');
check('a look-alike host is not ours', keys({ fileUrl: 'https://s3.example.test.evil.co/webbites/parse/x.jpg' }) === '');
check(
    'pointers are other rows and are not followed',
    keys({ user: { __type: 'Pointer', className: '_User', objectId: user, name: 'parse/x.jpg' } }) === ''
);

check(
    'a row\'s bookmarked address is not something we stored, even when it is a link into the bucket',
    [...storageKeysInRow({
        url: `https://s3.example.test/webbites/parse/device-screenshot-${uuid}.jpg`,
        urls: ['https://s3.example.test/webbites/parse/b.jpg'],
        fileUrl: 'https://s3.example.test/webbites/parse/a.jpg',
        images: [{ url: 'https://s3.example.test/webbites/parse/c.jpg' }],
    }, bucket)].sort().join(',') === 'parse/a.jpg,parse/c.jpg'
);

// ─── What is safe to delete ──────────────────────────────────────────────────

check('a key under the user\'s own prefix is left to the sweep', !isStrayUserKey(`parse/user/${user}/x.png`, user));
check('another user\'s prefix is never touched', !isStrayUserKey('parse/user/someoneElse/x.png', user));
check('nor is another user\'s userFiles', !isStrayUserKey('/userFiles/someoneElse/1.png', user));
check('a shared RSS article file is never touched', !isStrayUserKey('parse/user/rss/1_article.html', user));
check('an anonymous createFileName upload is deleted', isStrayUserKey('parse/user/anon/1712_ab12cd_pdfcover.png', user));
check('a native upload named by UUID is deleted', isStrayUserKey(`parse/device-screenshot-${uuid}.jpg`, user));
check('so is a drawing named by UUID, in lower case', isStrayUserKey(`parse/note-drawing-${uuid.toLowerCase()}.bin`, user));
check('a name starting with the user\'s id is deleted', isStrayUserKey(`parse/${user}_1712000000000.png`, user));
check('a name with Parse\'s random prefix is deleted', isStrayUserKey(`parse/${'a1'.repeat(16)}_photo.jpg`, user));
check('a plain name that anyone could have uploaded is not', !isStrayUserKey('parse/image.png', user));
check('nor is a share-sheet photo under its own name', !isStrayUserKey('parse/IMG_0001.jpg', user));
check('nor anything outside the Parse prefix', !isStrayUserKey(`backups/${uuid}.zip`, user));
check('nothing is deleted without a user id', !isStrayUserKey(`parse/device-screenshot-${uuid}.jpg`, ''));

// ─── Relinking rows at the objects that were actually written ────────────────

const salted = `parse/user/${user}/aea1416d407fe1a1_1712_ab12cd_report.pdf`;
const moves = new Map([[`parse/user/${user}/1712_ab12cd_report.pdf`, salted]]);
const brokenUrl = `https://s3.example.test/webbites/parse/user/${user}/1712_ab12cd_report.pdf`;
const fixedUrl = `https://s3.example.test/webbites/${salted}`;
const row = {
    url: brokenUrl,
    fileUrl: brokenUrl,
    file: { __type: 'File', name: `user/${user}/1712_ab12cd_report.pdf`, url: brokenUrl },
    images: [{ url: brokenUrl }, { url: 'https://s3.example.test/webbites/parse/other.png' }],
    owner: { __type: 'Pointer', className: '_User', objectId: user },
};
const relinked = relinkStorageKeys(row, bucket, moves) as typeof row;

check('a URL column points at the written key', relinked.fileUrl === fixedUrl);
check('the bookmark address that was our own copy follows it', relinked.url === fixedUrl);
check('a Parse file gets the new name and url', relinked.file.name === salted.slice('parse/'.length) && relinked.file.url === fixedUrl);
check('arrays are walked, and other objects left alone', relinked.images[0].url === fixedUrl && relinked.images[1].url === 'https://s3.example.test/webbites/parse/other.png');
check('pointers pass through untouched', relinked.owner === row.owner);
check('the input row is not mutated', row.fileUrl === brokenUrl);
check('the relinked columns read back as the new key', keys([relinked.fileUrl, relinked.file, relinked.url]) === salted);
check(
    'the query string and a URL inside HTML survive',
    relinkStorageKeys(`<a href="${brokenUrl}?v=2#p3">x</a>`, bucket, moves) === `<a href="${fixedUrl}?v=2#p3">x</a>`
);
check('a key that did not move is left as it was', relinkStorageKeys(brokenUrl, bucket, new Map()) === brokenUrl);
check(
    'odd characters are re-encoded, not mangled',
    relinkStorageKeys(brokenUrl, bucket, new Map([[`parse/user/${user}/1712_ab12cd_report.pdf`, `parse/user/${user}/ff_a b.pdf`]]))
        === `https://s3.example.test/webbites/parse/user/${user}/ff_a%20b.pdf`
);

// ─── Files kept in MongoDB (GridFS) ──────────────────────────────────────────

const names = (value: unknown) => [...parseFileNamesIn(value)].sort().join(',');
check('Parse files are found by name anywhere in a row',
    names({ a: { __type: 'File', name: 'one.png', url: 'x' }, deep: [{ f: { __type: 'File', name: 'two.pdf' } }] }) === 'one.png,two.pdf');
check('pointers and relations are other rows and are not followed',
    names({ owner: { __type: 'Pointer', className: '_User', objectId: 'a', f: { __type: 'File', name: 'no.png' } } }) === '');
check('a name filed under this user is theirs', isOwnParseFileName(`parseUser=${user}_fileName=0123456789abcdef_1_x.png`, user));
check('a name filed under another user is not', !isOwnParseFileName('parseUser=someoneElse_fileName=0123456789abcdef_1_x.png', user));
check('a plain name behind a random salt is one upload\'s', isOwnParseFileName('0123456789abcdef_image.png', user));
check('an unsalted plain name might be shared, so it is left alone', !isOwnParseFileName('image.png', user));
check('with no user nothing is anyone\'s', !isOwnParseFileName('0123456789abcdef_image.png', ''));

console.log(`\nuser storage keys: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
