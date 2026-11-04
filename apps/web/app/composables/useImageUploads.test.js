// node app/composables/useImageUploads.test.js
//
// The case worth pinning: a file the browser cannot decode must come back
// rejected, never accepted. Accepting one is what put a blank card in the grid.
import assert from 'node:assert/strict';
import {
  isWebSafeImageType,
  jpegName,
  toUploadableImages,
  unreadableImageMessage
} from './useImageUploads.js';

// --- what browsers draw ------------------------------------------------------

assert.ok(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].every(isWebSafeImageType));
assert.ok(!['image/heic', 'image/heif', 'image/tiff', 'image/bmp', 'image/svg+xml'].some(isWebSafeImageType));

// A type can arrive with parameters or in the wrong case.
assert.ok(isWebSafeImageType('IMAGE/JPEG'));
assert.ok(isWebSafeImageType('image/png; charset=binary'));
assert.ok(!isWebSafeImageType(''));
assert.ok(!isWebSafeImageType(undefined));

// --- naming ------------------------------------------------------------------

assert.equal(jpegName('photo.heic'), 'photo.jpg');
assert.equal(jpegName('IMG_0001.HEIC'), 'IMG_0001.jpg');
assert.equal(jpegName('holiday.photo.tiff'), 'holiday.photo.jpg');
assert.equal(jpegName('noextension'), 'noextension.jpg');
assert.equal(jpegName(''), 'image.jpg');

// --- splitting a picked list -------------------------------------------------

const file = (name, type) => ({ name, type });

// Web-safe files are passed through by identity: re-encoding a JPEG the user
// chose would lose quality for nothing.
const jpeg = file('a.jpg', 'image/jpeg');
const png = file('b.png', 'image/png');
{
  const { accepted, rejected } = await toUploadableImages([jpeg, png]);
  assert.equal(rejected.length, 0);
  assert.deepEqual(accepted, [jpeg, png]);
  assert.equal(accepted[0], jpeg, 'the same File object, not a copy');
}

// No decoder in this environment (as in Node, and as in a browser that cannot
// read HEIC): refused rather than uploaded.
{
  const heic = file('IMG_0001.heic', 'image/heic');
  const { accepted, rejected } = await toUploadableImages([jpeg, heic]);
  assert.deepEqual(accepted, [jpeg]);
  assert.deepEqual(rejected, [heic]);
}

{
  const { accepted, rejected } = await toUploadableImages([]);
  assert.deepEqual(accepted, []);
  assert.deepEqual(rejected, []);
}
{
  const { accepted, rejected } = await toUploadableImages(null);
  assert.deepEqual(accepted, []);
  assert.deepEqual(rejected, []);
}

// --- what the user is told ---------------------------------------------------

assert.match(unreadableImageMessage([file('IMG_0001.heic', 'image/heic')]), /IMG_0001\.heic/);
assert.match(unreadableImageMessage([file('IMG_0001.heic', 'image/heic')]), /JPEG/);
// Detected off the name too, for a browser that hands over an empty type.
assert.match(unreadableImageMessage([file('IMG_0001.HEIC', '')]), /JPEG/);
assert.match(
  unreadableImageMessage([file('a.heic', 'image/heic'), file('b.heic', 'image/heic')]),
  /HEIC photos/
);
assert.match(unreadableImageMessage([file('scan.tiff', 'image/tiff')]), /scan\.tiff/);

console.log('useImageUploads: ok');
