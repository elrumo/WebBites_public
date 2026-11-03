/**
 * What MCP tools return, built from Parse rows and search hits.
 *
 * Run with:  npm run test:mcpFormat
 */

import {
    htmlToPlainText, clip, isoDate, bookmarkSummaryFromRow, bookmarkSummaryFromHit,
    bookmarkDetailFromRow, boardFromRow, type RowLike,
} from './mcpFormat';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a === b) pass++; else { fail++; console.log(`FAIL: ${name}\n  got:  ${a}\n  want: ${b}`); }
};
const row = (id: string, fields: Record<string, unknown>, createdAt?: Date): RowLike => ({ id, createdAt, get: (name) => fields[name] });
const SITE = 'https://webbites.io';

check('html to text', htmlToPlainText('<h1>Title</h1><p>One &amp; <b>two</b></p><p>a<br>b</p><ul><li>x</li></ul>'), 'Title\nOne & two\na\nb\n• x');
check('numeric entities', htmlToPlainText('&#39;&#x1F516;&#65;'), "'🔖A");
check('empty html', htmlToPlainText(null), '');
check('clip short', clip('hello', 10), { text: 'hello', truncated: false });
check('clip at a word near the end', clip('lorem ipsum dolor sit amet consectetur', 30), { text: 'lorem ipsum dolor sit amet…', truncated: true });
check('clip mid-word when no space is near', clip('abcdefghijklmnop', 8), { text: 'abcdefgh…', truncated: true });
check('iso from Date', isoDate(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03:04:05.000Z');
check('iso from parse date', isoDate({ __type: 'Date', iso: '2026-01-02T03:04:05Z' }), '2026-01-02T03:04:05.000Z');
check('iso from junk', isoDate('soon'), null);

const site = row('abc', {
    url: 'https://www.example.com/post', siteTitle: ' A post ', siteDescription: 'About things', type: 'website',
    tags: ['web', 3], siteNotes: 'my note', aiSummary: { tldr: 'Short.' }, pinned: true,
}, new Date('2026-05-01T00:00:00Z'));
check('website summary', bookmarkSummaryFromRow(site, SITE), {
    id: 'abc', url: 'https://www.example.com/post', title: 'A post', description: 'About things', type: 'website',
    tags: ['web'], note: 'my note', summary: 'Short.', pinned: true, saved_at: '2026-05-01T00:00:00.000Z',
    web_url: 'https://webbites.io/app?bookmarkId=abc',
});
check('untitled website falls back to its host', bookmarkSummaryFromRow(row('x', { url: 'https://www.example.com/a' }), SITE).title, 'example.com');

const note = row('n1', { url: ' ', type: 'textNote', textNote: '<h1>Groceries</h1><p>eggs<br>milk</p>', siteNotes: 'ignored' });
const noteSummary = bookmarkSummaryFromRow(note, SITE);
check('note: blank url is null', noteSummary.url, null);
check('note: title is its first line', noteSummary.title, 'Groceries');
check('note: description is the rest', noteSummary.description, 'eggs milk');
check('note: no bookmark note', noteSummary.note, null);

const hit = { objectId: 'h1', url: 'https://a.io', siteTitle: 'A', type: 'website', tags: ['t'], textNote: 'the note', createdAt: '2026-02-01T00:00:00.000Z', pinned: false };
check('hit: index note folds into note', bookmarkSummaryFromHit(hit, SITE).note, 'the note');
check('hit: note bite', bookmarkSummaryFromHit({ objectId: 'h2', type: 'textNote', textNote: '<p>Hello</p>' }, SITE).title, 'Hello');

const detailRow = row('d1', {
    url: 'https://a.io', siteTitle: 'A', type: 'website', siteBody: 'word '.repeat(3000), siteAuthor: 'Ann',
    aiSummary: { tldr: 'TL', pointsThatBestDescribeThePage: [{ title: 'P', oneLineDescription: 'desc' }, {}] },
});
const detail = bookmarkDetailFromRow(detailRow, [{ id: 'b', name: 'Board' }], { includeContent: true, maxChars: 1000 }, SITE);
check('detail: content clipped', [detail.content!.length <= 1001, detail.content_truncated], [true, true]);
check('detail: ai summary points', detail.ai_summary, { tldr: 'TL', points: [{ title: 'P', description: 'desc' }] });
check('detail: author and boards', [detail.author, detail.boards], ['Ann', [{ id: 'b', name: 'Board' }]]);
const lean = bookmarkDetailFromRow(row('d2', { type: 'website' }), [], { includeContent: false, maxChars: 1000 }, SITE);
check('detail: no content unless asked', [lean.content, lean.content_note, lean.ai_summary], [null, null, null]);
const empty = bookmarkDetailFromRow(row('d3', { type: 'website' }), [], { includeContent: true, maxChars: 1000 }, SITE);
check('detail: says why content is missing', typeof empty.content_note, 'string');
const noteDetail = bookmarkDetailFromRow(note, [], { includeContent: true, maxChars: 1000 }, SITE);
check('detail: note text', noteDetail.text_note, 'Groceries\neggs\nmilk');

check('board', boardFromRow(row('b1', { name: 'Reading', description: '', parent: { id: 'p' }, bookmarkCount: 4, mode: 'smart' })),
    { id: 'b1', name: 'Reading', description: null, parent_id: 'p', bookmark_count: 4, mode: 'smart' });
check('board defaults', boardFromRow(row('b2', { bookmarkCount: -1 })),
    { id: 'b2', name: 'Untitled board', description: null, parent_id: null, bookmark_count: null, mode: 'manual' });

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
