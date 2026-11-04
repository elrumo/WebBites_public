/**
 * Regression tests for the shared audio token.
 *
 * `streamAudio` is used by bookmarks and by the RSS reader, and the RSS work
 * added a `targetType` field that decides which class the finished MP3 is
 * written to. Two properties matter and neither would fail loudly if it broke:
 *
 *   1. A token minted for a bookmark must still say `website`, because tokens
 *      stay valid for ten minutes — tokens issued before a deploy are still
 *      being redeemed after it, and an absent or wrong `targetType` would send
 *      a bookmark's audio nowhere.
 *   2. The signature has to cover the payload, or the field is forgeable.
 *
 * Run with:  npm run test:audioAuth
 */

process.env.VITE_AUDIO_TOKEN_SECRET = process.env.VITE_AUDIO_TOKEN_SECRET || 'test-secret';
process.env.VITE_BACKEND_URL = process.env.VITE_BACKEND_URL || 'https://api.example.test/';

import LZString from 'lz-string';
import { buildAudioStreamEndpoint, verifyAudioToken, stripHtmlForSpeech, normaliseVoice, splitForSpeech, estimateSpeechTokens, normaliseAccent, speechInstructions } from './audio-auth';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

/** Pulls the token's payload back out of a minted endpoint URL. */
function decode(endpoint: string) {
    const url = new URL(endpoint);
    const token = url.searchParams.get('token') || '';
    const [payloadBase64] = token.split('.');
    return {
        url,
        token,
        payload: JSON.parse(Buffer.from(payloadBase64, 'base64').toString()),
        text: LZString.decompressFromEncodedURIComponent(url.searchParams.get('text') || ''),
    };
}

// ─── The bookmark path, unchanged ────────────────────────────────────────────

const bookmark = decode(buildAudioStreamEndpoint({
    text: '<p>An article about widgets.</p>',
    userId: 'user-1',
    websiteId: 'website-1',
    url: 'https://example.com/post',
}));

check('bookmark: targetType defaults to website', bookmark.payload.targetType === 'website');
check('bookmark: websiteId preserved', bookmark.payload.websiteId === 'website-1');
check('bookmark: url preserved', bookmark.payload.url === 'https://example.com/post');
check('bookmark: userId preserved', bookmark.payload.userId === 'user-1');
check('bookmark: no rssItemId', bookmark.payload.rssItemId === undefined);
check('bookmark: token verifies', verifyAudioToken(bookmark.token));
check('bookmark: endpoint points at streamAudio', bookmark.url.pathname.endsWith('/v1/audio/streamAudio'));
check('bookmark: userId also on the query string', bookmark.url.searchParams.get('userId') === 'user-1');
check('bookmark: text round-trips as prose', bookmark.text === 'An article about widgets.');

// ─── The RSS path ────────────────────────────────────────────────────────────

const article = decode(buildAudioStreamEndpoint({
    text: 'A feed article body.',
    userId: 'user-1',
    // An RSS article has no bookmark row; 'none' is the sentinel streamAudio
    // already understood before any of this existed.
    websiteId: 'none',
    url: 'https://example.com/feed-post',
    targetType: 'rssItem',
    rssItemId: 'item-9',
}));

check('rss: targetType is rssItem', article.payload.targetType === 'rssItem');
check('rss: rssItemId carried', article.payload.rssItemId === 'item-9');
check('rss: websiteId is the none sentinel', article.payload.websiteId === 'none');
check('rss: token verifies', verifyAudioToken(article.token));

// ─── Expiry ──────────────────────────────────────────────────────────────────

const now = Math.floor(Date.now() / 1000);
check('expiry: ten minutes out', article.payload.exp > now + 590 && article.payload.exp <= now + 600);

// ─── Tamper resistance ───────────────────────────────────────────────────────

// Rewriting `targetType` inside the payload must invalidate the signature —
// otherwise anyone holding a bookmark token could redirect the write.
const [, signature] = article.token.split('.');
const tampered = { ...article.payload, targetType: 'website', websiteId: 'someone-elses-bookmark' };
const tamperedToken = `${Buffer.from(JSON.stringify(tampered)).toString('base64')}.${signature}`;
check('tamper: a rewritten payload fails verification', !verifyAudioToken(tamperedToken));

check('tamper: a truncated token fails', !verifyAudioToken(article.token.split('.')[0]));
check('tamper: an empty token fails', !verifyAudioToken(''));
check('tamper: undefined fails', !verifyAudioToken(undefined));

// ─── Voice ───────────────────────────────────────────────────────────────────

const voiced = decode(buildAudioStreamEndpoint({ text: 'x', userId: 'u', websiteId: 'w', voice: 'onyx' }));
check('voice: chosen voice rides in the signed payload', voiced.payload.voice === 'onyx');
check('voice: absent voice becomes the default', bookmark.payload.voice === 'nova');
check('voice: unknown voice falls back', normaliseVoice('darth-vader') === 'nova');
check('voice: known voice passes through', normaliseVoice('shimmer') === 'shimmer');

// ─── Speech text cleanup ─────────────────────────────────────────────────────

check(
    'speech: scripts dropped',
    !stripHtmlForSpeech('<p>Read this.</p><script>alert(1)</script>', 0).includes('alert')
);
check(
    'speech: adjacent blocks do not fuse into one word',
    stripHtmlForSpeech('<h1>Title</h1><p>Body text.</p>', 0) === 'Title Body text.'
);
check(
    'speech: inline tags do not split a word',
    stripHtmlForSpeech('<p><b>bold</b>face</p>', 0) === 'boldface'
);
check('speech: limit respected', stripHtmlForSpeech('x'.repeat(500), 100).length === 100);
check('speech: null is empty', stripHtmlForSpeech(null) === '');
check('speech: undefined is empty', stripHtmlForSpeech(undefined) === '');

// ─── Accent ──────────────────────────────────────────────────────────────────

const accented = decode(buildAudioStreamEndpoint({ text: 'x', userId: 'u', websiteId: 'w', accent: 'british' }));
check('accent: chosen accent rides in the signed payload', accented.payload.accent === 'british');
check('accent: absent accent becomes the default', bookmark.payload.accent === 'american');
check('accent: unknown accent falls back', normaliseAccent('martian') === 'american');
check('accent: american leaves the base instruction alone', !speechInstructions('american').includes('accent'));
check('accent: british is appended to the instruction', speechInstructions('british').includes('British'));
check('language: a non-English page names its language, not the accent', speechInstructions('british', 'German').includes('natural German') && !speechInstructions('british', 'German').includes('British'));
check('language: an English page keeps the accent', speechInstructions('british', 'English').includes('British'));

// ─── Chunking for the 2000-token TTS limit ───────────────────────────────────

const sentence = 'The quick brown fox jumps over the lazy dog near the river bank. ';
const longArticle = sentence.repeat(400); // ~26k chars, ~6.5k tokens
const chunks = splitForSpeech(longArticle);
check('split: long article becomes several pieces', chunks.length > 3);
check('split: every piece is under the limit', chunks.every(c => estimateSpeechTokens(c) <= 1200));
check('split: pieces end on a sentence boundary', chunks.every(c => /[.!?]["'”’)]*$/.test(c)));
check('split: no text lost', chunks.join(' ').replace(/\s+/g, ' ') === longArticle.trim().replace(/\s+/g, ' '));
check('split: short text is one piece', splitForSpeech('Hello there. Short one.').length === 1);
check('split: empty text is no pieces', splitForSpeech('   ').length === 0);
const runOn = 'word '.repeat(3000).trim(); // one "sentence", ~3.7k tokens
check('split: a run-on sentence is hard-wrapped, never dropped',
    splitForSpeech(runOn).every(c => estimateSpeechTokens(c) <= 1200) &&
    splitForSpeech(runOn).join(' ') === runOn);
check('split: CJK counts a token per character', estimateSpeechTokens('日本語') === 3);

console.log(`\naudio-auth: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
