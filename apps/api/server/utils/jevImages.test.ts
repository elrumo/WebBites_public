/**
 * Run: npm run test:jevImages
 *
 * Pictures for Jev: which image a bookmark offers, fitting a file into Jev's
 * limits (size, EXIF orientation, alpha, formats), and the off switch. No network.
 */
import sharp from 'sharp';
import { fitForJev, imageUrlsFor, prepareImages } from './jevImages';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const png = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha } } }).png().toBuffer();
const decode = (b64: string) => sharp(Buffer.from(b64, 'base64')).metadata();

// A Parse-object stand-in: `get` over a plain record.
const site = (fields: Record<string, any>) => ({ id: 'w1', get: (key: string) => fields[key] });
const parseFile = (url: string) => ({ url: () => url });

(async () => {
  // Fitting a file
  {
    const big = await fitForJev(await png(3000, 2000, 0.5));
    const meta = big ? await decode(big) : null;
    check('fit: big PNG becomes a JPEG', meta?.format === 'jpeg');
    check('fit: longest side capped at 1568', meta?.width === 1568 && (meta?.height ?? 0) <= 1568);
    check('fit: alpha flattened', meta?.hasAlpha === false);

    const sideways = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#336699' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const upright = await fitForJev(sideways);
    const uprightMeta = upright ? await decode(upright) : null;
    check('fit: EXIF rotation applied to the pixels', uprightMeta?.width === 300 && uprightMeta?.height === 600);

    check('fit: small image is kept as is', (await decode((await fitForJev(await png(300, 300)))!)).width === 300);
    check('fit: under 256 px is skipped', (await fitForJev(await png(200, 400))) === null);
    check('fit: a thin banner is skipped', (await fitForJev(await png(1568, 100))) === null);
    check('fit: under 78,400 pixels is skipped', (await fitForJev(await png(256, 256))) === null);
    check('fit: not an image is skipped', (await fitForJev(Buffer.from('<html>nope</html>'))) === null);
    check('fit: SVG is skipped', (await fitForJev(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"/>'))) === null);
  }

  // Which images a bookmark offers
  {
    const upload = site({
      type: 'image',
      OGImage: 'https://files.example/1.jpg',
      images: Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, url: `https://files.example/${i + 1}.jpg` })),
    });
    const urls = imageUrlsFor(upload);
    check('urls: an image bookmark offers its pictures, cover first, at most 4', urls.length === 4 && urls[0] === 'https://files.example/1.jpg');
    check('urls: a single-image bookmark offers its cover', imageUrlsFor(site({ type: 'image', OGImage: 'https://files.example/a.png' })).join() === 'https://files.example/a.png');
    check('urls: a page prefers its screenshot', imageUrlsFor(site({ type: 'website', siteScreenshot: parseFile('https://ours.example/s.webp'), OGImage: 'https://them.example/og.jpg' })).join() === 'https://ours.example/s.webp');
    check('urls: a page without one uses its OG image', imageUrlsFor(site({ type: 'website', OGImage: 'https://them.example/og.jpg' })).join() === 'https://them.example/og.jpg');
    check('urls: nothing to show, nothing offered', imageUrlsFor(site({ type: 'website' })).length === 0);
  }

  // Preparing for a request
  {
    delete process.env.JEV_IMAGES;
    check('prepare: no urls, no images', (await prepareImages([])) === null);
    check('prepare: a private address is never fetched', (await prepareImages(['http://127.0.0.1:1/x.jpg'])) === null);
    process.env.JEV_IMAGES = 'false';
    check('prepare: JEV_IMAGES=false turns it off', (await prepareImages(['https://files.example/a.jpg'])) === null);
    delete process.env.JEV_IMAGES;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
