/**
 * The search document's screenshot URL.
 *
 * Both apps open their Screenshot tab from the search hit, and the Parse File
 * is stripped from the document (it is a blob, not searchable) — so if the flat
 * URL isn't carried alongside it, a bite opened from a search result has no
 * capture to show and the tab hides itself. Run with:
 *
 *   npm run test:meiliMapper
 */

import { prepareMeilisearchDocument } from './meilisearchDocumentMapper';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const doc = (site: Record<string, unknown>) =>
    prepareMeilisearchDocument({ id: 'abc', url: 'https://example.com', ...site } as any);

// Parse hands the column back as a File object …
check(
    'a Parse File contributes its url',
    doc({ fullPageScreenshot: { __type: 'File', name: 'x.webp', url: 'https://files/x.webp' } })
        .fullPageScreenshotUrl === 'https://files/x.webp'
);
// … newer rows also carry the flat column, which wins.
check(
    'the flat column wins over the File',
    doc({
        fullPageScreenshotUrl: 'https://files/flat.webp',
        fullPageScreenshot: { url: 'https://files/file.webp' }
    }).fullPageScreenshotUrl === 'https://files/flat.webp'
);
check(
    'a plain string column is taken as the url',
    doc({ fullPageScreenshot: 'https://files/str.webp' }).fullPageScreenshotUrl === 'https://files/str.webp'
);
check(
    'no capture yields an empty string, never undefined',
    doc({}).fullPageScreenshotUrl === ''
);
check(
    'the site screenshot rides along as a flat url for the card fallback',
    doc({ siteScreenshot: { url: 'https://files/crop.webp' } }).siteScreenshotUrl === 'https://files/crop.webp'
);
// An app bookmark's card summary is indexed; every other bite carries null.
check('an app card rides into the index', (doc({ appCard: { store: 'appstore', rating: 4.8 } }) as any).appCard?.rating === 4.8);
check('a bite with no app card indexes null', (doc({}) as any).appCard === null);
// The blob itself must not reach the index.
check('the File blob is stripped', (doc({ fullPageScreenshot: { url: 'https://f/x' } }) as any).fullPageScreenshot === undefined);
// Annotations are the notes dropped on the capture; both apps read them here.
check(
    'annotations ride along',
    doc({ screenshotAnnotations: [{ id: '1', x: 10, y: 20, text: 'note' }] }).screenshotAnnotations.length === 1
);

// The trash lives in the index: a deleted bookmark keeps its document and is
// filtered out by this flag, so the flag has to be on every document.
check('a live bookmark is explicitly not deleted', doc({}).isDeleted === false);
check('deletedAt is an empty string when the bookmark is live', doc({}).deletedAt === '');
check('a trashed bookmark carries the flag', doc({ isDeleted: true }).isDeleted === true);
check(
    'deletedAt is normalised to an ISO string',
    doc({ isDeleted: true, deletedAt: new Date('2026-01-02T03:04:05.000Z') }).deletedAt
        === '2026-01-02T03:04:05.000Z'
);

// Parse.Object.toJSON() (the live save path) encodes Date columns as { __type, iso }.
check(
    'a Parse-encoded deletedAt yields its iso string',
    doc({ isDeleted: true, deletedAt: { __type: 'Date', iso: '2026-09-16T10:00:00.000Z' } })
        .deletedAt === '2026-09-16T10:00:00.000Z'
);

// Hidden bookmarks work the same way, and the mapper is the half that is easy
// to lose: the partial update in meilisearchTrash.ts sets the flag, and then
// any later edit to the bookmark rebuilds this whole document over the top of
// it. A mapper that dropped `hiddenFrom` would quietly un-hide the bookmark on
// the next retitle or retag.
check('a visible bookmark carries an empty hiddenFrom, never undefined', doc({}).hiddenFrom === '');
check('hidden from the library survives the rebuild', doc({ hiddenFrom: 'library' }).hiddenFrom === 'library');
check('hidden everywhere survives the rebuild', doc({ hiddenFrom: 'everywhere' }).hiddenFrom === 'everywhere');
check(
    'a bookmark edited while hidden keeps the flag',
    doc({ hiddenFrom: 'library', siteTitle: 'a new title', tags: ['fresh'] }).hiddenFrom === 'library'
);

console.log(`\nmeilisearch document mapper: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
