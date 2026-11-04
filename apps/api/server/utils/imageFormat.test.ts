/**
 * Tests for getting an upload into something a browser draws. The case worth
 * pinning is the one that shipped broken: a picture in a format nothing can
 * render must not come back as a picture, because the caller stores whatever
 * this hands it and the grid then shows a card with nothing in it. Run with:
 *
 *   npm run test:imageFormat
 */

import sharp from 'sharp';
import {
    normaliseImageFormat,
    contentTypeFor,
    isWebSafeFormat,
    toWebSafeImage,
    unsupportedFormatMessage
} from './imageFormat';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

// --- one spelling for a format ----------------------------------------------

check('jpg and JPG are jpeg', normaliseImageFormat('jpg') === 'jpeg' && normaliseImageFormat('JPG') === 'jpeg');
check('a MIME type is a format', normaliseImageFormat('image/png') === 'png');
check('a dotted extension is a format', normaliseImageFormat('.WebP') === 'webp');
check('svg+xml loses its suffix', normaliseImageFormat('image/svg+xml') === 'svg');
check('tif is tiff', normaliseImageFormat('tif') === 'tiff');
check('nothing at all falls back to jpeg', normaliseImageFormat(undefined) === 'jpeg' && normaliseImageFormat('') === 'jpeg');

check('jpg gets the registered media type, not image/jpg',
    contentTypeFor('jpg') === 'image/jpeg' && contentTypeFor('JPG') === 'image/jpeg');
check('svg keeps its full media type', contentTypeFor('svg') === 'image/svg+xml');

check('the formats browsers draw are web-safe',
    ['jpeg', 'jpg', 'png', 'gif', 'webp', 'avif'].every(isWebSafeFormat));
check('the ones they do not are not',
    !['heic', 'heif', 'tiff', 'bmp', 'svg'].some(isWebSafeFormat));

// --- the rescue -------------------------------------------------------------

const source = sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 100, b: 50 } }
});

const run = async () => {
    const jpeg = await source.clone().jpeg().toBuffer();
    const tiff = await source.clone().tiff().toBuffer();
    const gif = await source.clone().gif().toBuffer();

    const asJpeg = await toWebSafeImage(jpeg, 'jpg');
    check('a JPEG is passed through untouched, not re-encoded here',
        asJpeg?.converted === false && asJpeg.format === 'jpeg'
        && asJpeg.contentType === 'image/jpeg' && asJpeg.buffer === jpeg);

    const asGif = await toWebSafeImage(gif, 'gif');
    check('a GIF is passed through — re-encoding would keep one frame',
        asGif?.converted === false && asGif.format === 'gif');

    const asTiff = await toWebSafeImage(tiff, 'tiff');
    check('a TIFF becomes a JPEG, because no browser draws a TIFF',
        asTiff?.converted === true && asTiff.format === 'jpeg' && asTiff.contentType === 'image/jpeg');
    check('and the converted bytes really are a JPEG',
        asTiff !== null && (await sharp(asTiff.buffer).metadata()).format === 'jpeg');

    // A transparent source flattened onto black is a worse answer than a
    // slightly larger file. An SVG is the realistic case: the picker's
    // `image/*` lets one through, no browser should be served it back off our
    // own storage domain, and it is transparent everywhere but the shape.
    const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
        + '<circle cx="16" cy="16" r="10" fill="#c86432"/></svg>'
    );
    const asTransparent = await toWebSafeImage(svg, 'image/svg+xml');
    check('transparency survives as PNG rather than being flattened onto black',
        asTransparent?.format === 'png' && asTransparent.contentType === 'image/png');
    check('and the converted bytes really are a PNG',
        asTransparent !== null && (await sharp(asTransparent.buffer).metadata()).format === 'png');

    // The bytes win over the name: this is how a HEIC named .jpg stops being
    // stored as a file nothing can open.
    const lying = await toWebSafeImage(tiff, 'jpg');
    check('the bytes are believed over the filename', lying?.format === 'jpeg' && lying.converted === true);

    check('bytes that are not an image at all are refused',
        (await toWebSafeImage(Buffer.from([0, 1, 2, 3]), 'jpg')) === null);
    check('an empty buffer is refused', (await toWebSafeImage(Buffer.alloc(0), 'png')) === null);

    // sharp's prebuilt libvips has libheif without the HEVC decoder, so this is
    // the format that has to be refused rather than rescued. Encoding one to
    // test with is impossible for the same reason — the refusal is covered by
    // the unreadable-bytes case above, and this pins the message.
    check('HEIC is refused with a message that says what to do',
        unsupportedFormatMessage('heic').includes('JPEG')
        && unsupportedFormatMessage('image/heif').includes('JPEG'));
    check('anything else names the format it could not read',
        unsupportedFormatMessage('tiff').includes('tiff'));

    console.log(`\nimage format: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
};

run();
