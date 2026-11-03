/**
 * `npm run test:backups` — the pure half of backups: credentials survive the
 * round trip and refuse tampering, and files land where bookmarks.json says.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { encryptSecret, decryptSecret, bookmarkFileEntries, partFileName, netscapeHtml, nextRunAfter } from './backupFormat';

// Read on every call, so setting it here is enough.
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');

// Round trip, and a fresh IV every time.
const secret = { accessKey: 'AKIA…', secretKey: 's3cr3t/with+chars', bucket: 'b' };
const sealed = encryptSecret(secret);
assert.deepEqual(decryptSecret(sealed), secret);
assert.notEqual(encryptSecret(secret), sealed);
assert.ok(!sealed.includes('s3cr3t'));

// Flipping one byte of the ciphertext fails the auth tag.
const [iv, tag, data] = sealed.split('.');
const bytes = Buffer.from(data, 'base64url');
bytes[0] ^= 1;
assert.throws(() => decryptSecret([iv, tag, bytes.toString('base64url')].join('.')));

// A different key cannot read it.
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
assert.throws(() => decryptSecret(sealed));
process.env.BACKUP_ENCRYPTION_KEY = 'short';
assert.throws(() => encryptSecret(secret), /32 bytes/);

// Zip layout: stored name's extension wins, html kinds default to .html, empty columns are skipped.
assert.deepEqual(
  bookmarkFileEntries('abc', {
    siteScreenshot: { name: 'f00_shot.PNG', url: 'https://s3/f00_shot.PNG' },
    siteBodyFile: { name: 'body', url: 'https://s3/body' },
    fullPageScreenshot: null,
    file: { name: 'x_report.pdf', url: '' },
  }),
  [
    { kind: 'screenshot', url: 'https://s3/f00_shot.PNG', path: 'files/abc/screenshot.png' },
    { kind: 'reader', url: 'https://s3/body', path: 'files/abc/reader.html' },
  ],
);

// Part names sort by run then part, and carry no characters Windows or Dropbox reject.
assert.equal(partFileName('2026-09-24T03:20:05.123Z', 2), 'webbites-backup-2026-09-24T03-20-05Z-part2.zip');

// Netscape export escapes what it embeds and skips url-less rows.
const html = netscapeHtml([
  { url: 'https://a.com/?q="x"&y', title: '<b>A</b>', tags: ['one', 'two'], createdAt: '2026-01-01T00:00:00Z' },
  { url: null, title: 'note without url' },
]);
assert.ok(html.includes('HREF="https://a.com/?q=&quot;x&quot;&amp;y" ADD_DATE="1767225600" TAGS="one,two">&lt;b&gt;A&lt;/b&gt;</A>'));
assert.ok(!html.includes('note without url'));

// Schedule: half an hour early so the hourly tick does not push it back a day at a time.
assert.equal(nextRunAfter('2026-09-24T03:20:05Z', 'daily').toISOString(), '2026-09-25T02:50:05.000Z');
assert.equal(nextRunAfter('2026-09-24T03:20:05Z', 'weekly').toISOString(), '2026-10-01T02:50:05.000Z');

console.log('backups: ok');
