/**
 * Tests for the clientMetadata validation layer.
 *
 * This is the boundary where page-controlled JSON becomes something the server
 * stores and — in the case of media URLs — fetches. Run with:
 *
 *   npm run test:clientMetadata
 */

import { sanitizeClientMetadata, mergeClientMetadata, isLoginWalledHost } from './clientMetadata';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

// --- SSRF: media URLs are attacker-chosen and we fetch them server-side ---
const ssrf = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'hi',
  media: [
    { type: 'image', url: 'http://169.254.169.254/latest/meta-data/' },
    { type: 'image', url: 'http://localhost:7700/indexes' },
    { type: 'image', url: 'file:///etc/passwd' },
    { type: 'image', url: 'https://evil.com/x.jpg' },
    { type: 'image', url: 'https://scontent-lhr8-1.cdninstagram.com/v/real.jpg' }
  ]
}, 'https://www.instagram.com/p/ABC/');
check('drops all non-allowlisted media hosts', ssrf.media.length === 1);
check('keeps the real instagram CDN url', ssrf.media[0].url.includes('cdninstagram.com'));

// --- allowlist must not be defeated by a lookalike host ---
const lookalike = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'hi',
  media: [{ type: 'image', url: 'https://cdninstagram.com.evil.co/x.jpg' },
          { type: 'image', url: 'https://notcdninstagram.com/x.jpg' }]
}, 'https://www.instagram.com/p/ABC/');
check('rejects suffix-lookalike hosts', lookalike.media.length === 0);

// --- our own upload storage is allowed for every platform (share extension) ---
const localUpload = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'hi',
  media: [{ type: 'image', url: 'https://s3.webbites.io/bucket/parse/photo.jpg' }]
}, 'https://www.instagram.com/p/ABC/');
check('allows our own storage host on a login-walled platform', localUpload.media.length === 1);

const localUploadWeb = sanitizeClientMetadata({
  platform: 'web', kind: 'website', title: 'Post',
  media: [{ type: 'image', url: 'https://s3.webbites.io/bucket/parse/photo.jpg' }]
}, 'https://blog.example.com/a-post');
check('allows our own storage host on the generic web platform', localUploadWeb.media.length === 1);

const storageLookalike = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'hi',
  media: [{ type: 'image', url: 'https://s3.webbites.io.evil.co/x.jpg' }]
}, 'https://www.instagram.com/p/ABC/');
check('rejects a suffix-lookalike of our own storage host', storageLookalike.media.length === 0);

// --- generic pages may use their own origin ---
const own = sanitizeClientMetadata({
  platform: 'web', kind: 'website', title: 'Post',
  media: [{ type: 'image', url: 'https://blog.example.com/og.png' }]
}, 'https://blog.example.com/a-post');
check('allows the saved page own host', own.media.length === 1);

const foreign = sanitizeClientMetadata({
  platform: 'web', kind: 'website', title: 'Post',
  media: [{ type: 'image', url: 'https://cdn.other.com/og.png' }]
}, 'https://blog.example.com/a-post');
check('rejects a foreign host on the generic path', foreign.media.length === 0);

// --- control chars / overlong strings ---
const CTRL = String.fromCharCode(1) + String.fromCharCode(27) + String.fromCharCode(127);
const dirty = sanitizeClientMetadata({
  platform: 'twitter', kind: 'post',
  text: 'line1' + CTRL + 'drop',
  author: 'x'.repeat(9999),
  media: []
}, 'https://x.com/a/status/1');
check('strips control characters', dirty.text === 'line1drop');
check('caps long strings', dirty.author.length === 500);

// --- garbage in, null out ---
check('null for non-objects', sanitizeClientMetadata('hi') === null);
check('null for arrays', sanitizeClientMetadata([1,2]) === null);
check('null for empty content', sanitizeClientMetadata({ platform: 'twitter', media: [] }) === null);
check('null for oversized payload', sanitizeClientMetadata({ platform: 'web', text: 'a'.repeat(200000) }) === null);

// --- dates ---
const dates = sanitizeClientMetadata({ platform: 'web', text: 'x', publishedAt: 'not-a-date' });
check('rejects unparseable dates', dates.publishedAt === undefined);
const y1900 = sanitizeClientMetadata({ platform: 'web', text: 'x', publishedAt: '1900-01-01T00:00:00Z' });
check('rejects implausible years', y1900.publishedAt === undefined);

// --- unknown platform falls back, does not widen the allowlist ---
const spoof = sanitizeClientMetadata({
  platform: 'PWNED', kind: 'post', text: 'x',
  media: [{ type: 'image', url: 'https://pbs.twimg.com/media/a.jpg' }]
}, 'https://evil.com/p');
check('unknown platform falls back to web', spoof.platform === 'web');
check('unknown platform does not inherit CDN allowlists', spoof.media.length === 0);

// --- merge semantics ---
check('login-walled hosts detected', isLoginWalledHost('https://www.instagram.com/p/A/') === true);
check('normal hosts are not login-walled', isLoginWalledHost('https://example.com') === false);

const client = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'real caption', author: 'Ada', authorHandle: '@ada',
  media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/x.jpg' }]
}, 'https://www.instagram.com/p/ABC/');
const walled = mergeClientMetadata({ title: 'Login - Instagram', description: 'Log in' }, client, 'https://www.instagram.com/p/ABC/');
check('client beats the login wall scrape', walled.description === 'real caption');
check('client composes a readable title', walled.title === '@ada: real caption');

const normal = mergeClientMetadata({ title: 'Real Article', description: 'Real desc' }, client, 'https://example.com/a');
check('scraper wins on normal hosts', normal.title === 'Real Article' && normal.description === 'Real desc');

const gap = mergeClientMetadata({ title: 'Real Article' }, client, 'https://example.com/a');
check('client fills gaps on normal hosts', gap.description === 'real caption');

check('null metadata is a passthrough', mergeClientMetadata({ title: 'a' }, null, 'https://x.com').title === 'a');


// --- new platforms: each CDN allowlist is an SSRF boundary, so each needs a test ---
const cdnCases: Array<[string, string, string]> = [
  ['bluesky', 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/a', 'https://bsky.app/profile/a.example/post/xyz'],
  ['reddit', 'https://i.redd.it/abc123.jpg', 'https://www.reddit.com/r/pics/comments/abc/x/'],
  ['youtube', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['pinterest', 'https://i.pinimg.com/236x/a.jpg', 'https://www.pinterest.com/pin/99/']
];
for (const [platform, allowed, savedUrl] of cdnCases) {
  const ok = sanitizeClientMetadata({
    platform, kind: 'post', text: 'hi',
    media: [{ type: 'image', url: allowed }, { type: 'image', url: 'https://evil.com/x.jpg' }]
  }, savedUrl);
  check(platform + ' keeps its own cdn', ok.media.length === 1);
  check(platform + ' drops an unrelated host', ok.media[0].url === allowed);
}

// A Mastodon instance has no fixed CDN, so the resolver relies on the saved
// URL's host being added per-call. Subdomains of it count; other hosts do not.
const masto = sanitizeClientMetadata({
  platform: 'mastodon', kind: 'post', text: 'hi',
  media: [
    { type: 'image', url: 'https://files.mastodon.social/media/a.png' },
    { type: 'image', url: 'https://someone-elses-bucket.example/a.png' }
  ]
}, 'https://mastodon.social/@a/109252123456789');
check('mastodon allows instance-hosted media', masto.media.length === 1);
check('mastodon drops off-instance media', masto.media[0].url.includes('files.mastodon.social'));

// One platform's CDN must not be reachable by claiming a different platform.
const crossPlatform = sanitizeClientMetadata({
  platform: 'bluesky', kind: 'post', text: 'hi',
  media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/x.jpg' }]
}, 'https://bsky.app/profile/a.example/post/xyz');
check('a platform cannot borrow another platform allowlist', crossPlatform.media.length === 0);

// --- a post body is written in paragraphs; newlines are content, not noise ---
const multiline = sanitizeClientMetadata({
  platform: 'bluesky', kind: 'post', media: [],
  text: 'First line.\r\nSecond line.\n\n\n\nThird line.\u0007'
}, 'https://bsky.app/profile/a.example/post/xyz');
check('newlines survive in the post body', multiline.text === 'First line.\nSecond line.\n\nThird line.');
check('other control characters are still stripped', !multiline.text.includes('\u0007'));

const singleLine = sanitizeClientMetadata({
  platform: 'bluesky', kind: 'post', media: [], text: 'body',
  title: 'A\nB', author: 'C\nD'
}, 'https://bsky.app/profile/a.example/post/xyz');
check('titles stay on one line', singleLine.title === 'AB');
check('authors stay on one line', singleLine.author === 'CD');

// --- a server resolver beats metascraper even on a host that is not walled ---
const resolved = sanitizeClientMetadata({
  platform: 'bluesky', kind: 'post', text: 'the real post', author: 'Ada', authorHandle: '@ada',
  extractedBy: 'server:bluesky', media: []
}, 'https://bsky.app/profile/ada.example/post/xyz');
const overScrape = mergeClientMetadata(
  { title: 'Bluesky', description: 'Social media as it should be' },
  resolved,
  'https://bsky.app/profile/ada.example/post/xyz'
);
check('bsky.app is not login-walled', isLoginWalledHost('https://bsky.app/profile/a/post/b') === false);
check('a server resolution still beats the og: card', overScrape.description === 'the real post');
check('a server resolution composes the card title', overScrape.title === '@ada: the real post');

// ...but a browser extraction on an open host keeps only filling gaps.
const extensionOnOpenHost = sanitizeClientMetadata({
  platform: 'web', kind: 'website', title: 'Client title', text: 'client text',
  extractedBy: 'client:generic', media: []
}, 'https://example.com/a');
const openHost = mergeClientMetadata({ title: 'Real Article', description: 'Real desc' }, extensionOnOpenHost, 'https://example.com/a');
check('a client extraction does not override a good scrape', openHost.title === 'Real Article' && openHost.description === 'Real desc');

// --- platforms with a real headline keep it instead of composing one ---
const withTitle = sanitizeClientMetadata({
  platform: 'youtube', kind: 'video', title: 'Never Gonna Give You Up',
  author: 'Rick Astley', authorHandle: '@RickAstleyYT',
  extractedBy: 'server:youtube', media: []
}, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const youtubeMerged = mergeClientMetadata(null, withTitle, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
check('youtube keeps its own title', youtubeMerged.title === 'Never Gonna Give You Up');
check('youtube publisher', youtubeMerged.publisher === 'YouTube');

// A tweet has no headline, so one is composed from the handle and first line.
const tweetish = sanitizeClientMetadata({
  platform: 'twitter', kind: 'post', text: 'just setting up my twttr',
  authorHandle: '@jack', extractedBy: 'server:twitter', media: []
}, 'https://x.com/jack/status/20');
const tweetMerged = mergeClientMetadata(null, tweetish, 'https://x.com/jack/status/20');
check('a tweet composes a title', tweetMerged.title === '@jack: just setting up my twttr');

// --- a carousel keeps all of its pictures, and the first one is the cover ---
const carousel = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'ten slides', extractedBy: 'client:instagram',
  media: Array.from({ length: 12 }, (_, index) => ({
    type: 'image', url: `https://scontent.cdninstagram.com/v/${index}.jpg`
  }))
}, 'https://www.instagram.com/p/ABC');
check('a twelve-slide carousel keeps all twelve', carousel.media.length === 12);

const overCap = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'too many',
  media: Array.from({ length: 40 }, (_, index) => ({
    type: 'image', url: `https://scontent.cdninstagram.com/v/${index}.jpg`
  }))
}, 'https://www.instagram.com/p/ABC');
check('the media list is still capped', overCap.media.length === 20);

// The cover is the post's own first slide. Reaching past it for whichever entry
// happened to carry a poster put a video thumbnail from slide three on the card
// of a post whose first slide is a photo.
const photoThenVideo = sanitizeClientMetadata({
  platform: 'instagram', kind: 'post', text: 'mixed', extractedBy: 'client:instagram',
  media: [
    { type: 'image', url: 'https://scontent.cdninstagram.com/v/first.jpg' },
    { type: 'video', url: 'https://scontent.cdninstagram.com/v/reel.jpg', poster: 'https://scontent.cdninstagram.com/v/reel.jpg' }
  ]
}, 'https://www.instagram.com/p/ABC');
const mixedMerged = mergeClientMetadata(null, photoThenVideo, 'https://www.instagram.com/p/ABC');
check('the cover is the first slide, not a later video poster',
  mixedMerged.image === 'https://scontent.cdninstagram.com/v/first.jpg');

const videoOnly = sanitizeClientMetadata({
  platform: 'instagram', kind: 'video', text: 'a reel', extractedBy: 'client:instagram',
  media: [{ type: 'video', url: 'https://scontent.cdninstagram.com/v/reel.jpg', poster: 'https://scontent.cdninstagram.com/v/reel.jpg' }]
}, 'https://www.instagram.com/reel/ABC');
const reelMerged = mergeClientMetadata(null, videoOnly, 'https://www.instagram.com/reel/ABC');
check('a video post still covers itself with its poster frame',
  reelMerged.image === 'https://scontent.cdninstagram.com/v/reel.jpg');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
