// node app/utils/bookmarkUrl.test.js
import assert from 'node:assert/strict';
import { bookmarkUrlVariants } from './bookmarkUrl.js';

// A bare host has to match the https row the backend actually stored.
assert.ok(bookmarkUrlVariants('example.com').includes('https://example.com'));

// The protocol and the trailing slash are the two spellings of the same page.
const variants = bookmarkUrlVariants('https://example.com/a');
assert.ok(variants.includes('http://example.com/a'));
assert.ok(variants.includes('https://example.com/a/'));

// What the user pasted is normalised the same way saveBookmark.ts does it.
assert.ok(bookmarkUrlVariants('  `https://example.com/a`  ').includes('https://example.com/a'));

// Different pages must never collide.
assert.ok(!bookmarkUrlVariants('https://example.com/a').includes('https://example.com/b'));

// Nothing to look up means no query.
assert.deepEqual(bookmarkUrlVariants(''), []);
assert.deepEqual(bookmarkUrlVariants(null), []);

console.log('bookmarkUrl: ok');
