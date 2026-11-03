/**
 * Tests for multi-image bookmarks. The case worth pinning is flattening: a
 * source that is already a multi-image bookmark must merge as its images, not
 * as a nested array — get that wrong and the row is silently corrupted, with
 * no error anywhere and a carousel that shows one broken frame. Run with:
 *
 *   npm run test:bookmarkImages
 */

import { imagesOf, buildMergedImages, unionTags, coverUrl, MAX_IMAGES } from './bookmarkImages';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

/** A Parse-object-shaped stub: `get(key)` over a plain bag of columns. */
const site = (id: string, columns: Record<string, any>) => ({
    id,
    get: (key: string) => columns[key],
});

// --- the no-migration promise: an old row is a valid one-image bookmark ------

const legacy = site('bm1', {
    OGImage: 'https://s3.webbites.io/a.jpg',
    siteTitle: 'A picture',
    siteNotes: 'my note',
    tags: ['red'],
});

check('a bookmark with no images field reads as its single cover',
    imagesOf(legacy).length === 1 && imagesOf(legacy)[0].url === 'https://s3.webbites.io/a.jpg');

check('the fallback image carries the bookmark own metadata',
    imagesOf(legacy)[0].title === 'A picture'
    && imagesOf(legacy)[0].notes === 'my note'
    && JSON.stringify(imagesOf(legacy)[0].tags) === '["red"]');

check('a bookmark with no image at all yields nothing, not a broken entry',
    imagesOf(site('bm0', {})).length === 0);

check('cover falls back through OGImage, file, then OGImageFile',
    coverUrl(site('x', { file: { url: () => 'https://s3.webbites.io/f.jpg' } })) === 'https://s3.webbites.io/f.jpg'
    && coverUrl(site('x', { OGImageFile: { url: 'https://s3.webbites.io/o.jpg' } })) === 'https://s3.webbites.io/o.jpg');

// --- merge ------------------------------------------------------------------

const one = site('bm1', { OGImage: 'https://s3.webbites.io/1.jpg', siteTitle: 'One', tags: ['a'] });
const two = site('bm2', { OGImage: 'https://s3.webbites.io/2.jpg', siteTitle: 'Two', tags: ['b'] });
const three = site('bm3', { OGImage: 'https://s3.webbites.io/3.jpg', siteTitle: 'Three' });

const merged = buildMergedImages([one, two, three]);

check('merge order follows the order the sources were given',
    merged.map(i => i.url).join(',') === 'https://s3.webbites.io/1.jpg,https://s3.webbites.io/2.jpg,https://s3.webbites.io/3.jpg');

check('each merged image keeps the metadata of the bookmark it came from',
    merged[0].title === 'One' && merged[1].title === 'Two' && merged[2].title === 'Three');

check('each merged image records which bookmark it came from',
    merged.map(i => i.sourceId).join(',') === 'bm1,bm2,bm3');

check('the cover is the first image, which is what OGImage must mirror',
    merged[0].url === 'https://s3.webbites.io/1.jpg');

// The one that silently corrupts data if it regresses.
const alreadyMerged = site('bm9', {
    OGImage: 'https://s3.webbites.io/1.jpg',
    images: [
        { id: 'i1', url: 'https://s3.webbites.io/1.jpg', title: 'One' },
        { id: 'i2', url: 'https://s3.webbites.io/2.jpg', title: 'Two' },
    ],
});
const reMerged = buildMergedImages([alreadyMerged, three]);

check('merging a multi-image bookmark flattens it, never nests it',
    reMerged.length === 3
    && reMerged.every(i => typeof i.url === 'string')
    && reMerged.map(i => i.url).join(',').endsWith('1.jpg,https://s3.webbites.io/2.jpg,https://s3.webbites.io/3.jpg'));

check('a stored image keeps its own id so a reorder survives a merge',
    reMerged[0].id === 'i1' && reMerged[1].id === 'i2');

check('the same picture twice collapses to one entry',
    buildMergedImages([one, one]).length === 1);

check('every image ends up with a distinct id',
    new Set(reMerged.map(i => i.id)).size === reMerged.length);

const many = Array.from({ length: MAX_IMAGES + 5 }, (_, n) =>
    site(`bm${n}`, { OGImage: `https://s3.webbites.io/${n}.jpg` }));

check('the cap holds, and keeps the first images rather than the last',
    buildMergedImages(many).length === MAX_IMAGES
    && buildMergedImages(many)[0].url === 'https://s3.webbites.io/0.jpg');

// --- tags -------------------------------------------------------------------

check('bookmark tags are the union of group tags and every per-image tag',
    unionTags(['group'], merged).sort().join(',') === 'a,b,group');

check('duplicate tags across images collapse',
    unionTags(['a'], [{ id: 'x', url: 'u', tags: ['a', 'a'] }]).join(',') === 'a');

check('no tags anywhere is an empty list, not undefined',
    JSON.stringify(unionTags(undefined, [{ id: 'x', url: 'u' }])) === '[]');

console.log(`\nbookmark images: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
