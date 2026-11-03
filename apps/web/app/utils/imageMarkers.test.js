// node app/utils/imageMarkers.test.js
import assert from 'node:assert/strict';
import { expandImageMarkers } from './imageMarkers.js';

// The shape stored by the old JSON-LD extraction: one marker per paragraph.
const stored = '<p>Intro.</p>\n<p>[Image: The old homepage. https://cdn.example/a.jpg?quality=90&amp;strip=all]</p>';
assert.equal(
  expandImageMarkers(stored),
  '<p>Intro.</p>\n<figure><img src="https://cdn.example/a.jpg?quality=90&amp;strip=all" alt="The old homepage." loading="lazy" /><figcaption>The old homepage.</figcaption></figure>'
);

// No caption, no figcaption.
assert.equal(
  expandImageMarkers('<p>[Image: https://cdn.example/b.jpg]</p>'),
  '<figure><img src="https://cdn.example/b.jpg" alt="" loading="lazy" /></figure>'
);

// A bare marker in flat text still becomes an image.
assert.ok(expandImageMarkers('Text\n[Image: Cap https://x.y/z.png]\nMore').includes('<img src="https://x.y/z.png"'));

// Nothing to expand is returned untouched.
assert.equal(expandImageMarkers('<p>Plain [link](https://x.y)</p>'), '<p>Plain [link](https://x.y)</p>');
assert.equal(expandImageMarkers(''), '');
assert.equal(expandImageMarkers(null), null);

console.log('imageMarkers: ok');
