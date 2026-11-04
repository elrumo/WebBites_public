/**
 * Tests for reading App Store and Google Play pages. The cases worth pinning
 * are the ones that silently store the wrong thing: an id parsed from the wrong
 * URL shape, an image host we would then fetch server-side, and a Play page
 * whose data blob moved. Run with:
 *
 *   npm run test:appListing
 */

import { parseAppUrl, appleToListing, playToListing, appCardOf } from './appListing';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}`); }
};

// --- URLs --------------------------------------------------------------------

const apple = parseAppUrl('https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580');
check('app store id and storefront', apple?.store === 'appstore' && apple.appId === '324684580' && apple.country === 'us');
check('app store link without a slug', parseAppUrl('https://apps.apple.com/de/app/id324684580?mt=8')?.country === 'de');
check('an app store developer page is not an app', parseAppUrl('https://apps.apple.com/us/developer/spotify/id324684583') === null);
const play = parseAppUrl('https://play.google.com/store/apps/details?id=com.spotify.music&hl=en-US');
check('play package and language', play?.store === 'playstore' && play.appId === 'com.spotify.music' && play.lang === 'en-US');
check('play link with no id', parseAppUrl('https://play.google.com/store/apps/details') === null);
check('play package must look like a package', parseAppUrl('https://play.google.com/store/apps/details?id=../../x') === null);
check('other hosts are ignored', parseAppUrl('https://example.com/app/id1') === null);

// --- App Store ---------------------------------------------------------------

const lookup = {
  kind: 'software', trackId: 1, trackName: 'Demo', sellerName: 'Demo Inc', sellerUrl: 'https://demo.example',
  artworkUrl512: 'https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.jpg',
  screenshotUrls: ['https://is1-ssl.mzstatic.com/image/thumb/b/392x696bb.png', 'https://evil.example/c.png'],
  averageUserRating: 4.5, userRatingCount: 10, contentAdvisoryRating: '12+', primaryGenreName: 'Music',
  formattedPrice: 'Free', fileSizeBytes: '1000', languageCodesISO2A: ['EN', 'ES'], minimumOsVersion: '16.1',
  currentVersionReleaseDate: '2026-10-19T13:57:56Z'
};
const a = appleToListing(lookup, { inAppPurchases: true, copyright: '© Demo', subtitle: 'Songs, Playlists &amp; Audiobooks' })!;
check('apple maps the core fields', a.name === 'Demo' && a.developer === 'Demo Inc' && a.rating === 4.5 && a.minOS === 'iOS 16.1' && a.sizeBytes === 1000);
check('apple screenshots are enlarged', a.screenshots[0] === 'https://is1-ssl.mzstatic.com/image/thumb/b/784x1392bb.jpg');
check('apple drops images from foreign hosts', a.screenshots.length === 1);
check('apple extras carried', a.inAppPurchases === true && a.copyright === '© Demo');
check('apple tagline is decoded', a.subtitle === 'Songs, Playlists & Audiobooks');
check('card carries the tagline and at most three screenshots', (() => {
  const c = appCardOf({ ...a, screenshots: ['a', 'b', 'c', 'd'] });
  return c.subtitle === a.subtitle && c.screenshots.length === 3 && c.rating === 4.5;
})());
check('apple result with no name is nothing', appleToListing({ trackId: 1 }) === null);

// --- Google Play -------------------------------------------------------------

const blob: any[] = [];
blob[0] = ['Demo Play'];
blob[9] = ['Everyone'];
blob[13] = ['1,000+'];
blob[19] = ['$1 - $5 per item'];
blob[51] = [[null, 4.2], null, [null, 100]];
blob[68] = ['Demo Dev'];
blob[69] = [[null, null, null, null, null, [null, null, 'https://dev.example']]];
blob[72] = [[null, 'Line one<br>It&#39;s <b>bold</b> &amp; fine']];
blob[78] = [[[null, 2, [1, 1], [null, null, 'https://play-lh.googleusercontent.com/shot']]]];
blob[79] = [[['Music & Audio']]];
blob[95] = [[null, null, null, [null, null, 'https://play-lh.googleusercontent.com/icon']]];
const page = `<script type="application/ld+json">{"offers":[{"price":"0","priceCurrency":"EUR"}]}</script>` +
  `<script>AF_initDataCallback({key: 'ds:5', hash: '1', data:${JSON.stringify([null, [null, null, blob]])}, sideChannel: {}});</script>`;
const p = playToListing(page, 'com.demo', 'US')!;
check('play maps the core fields', p.name === 'Demo Play' && p.developer === 'Demo Dev' && p.rating === 4.2 && p.ratingCount === 100);
check('play description is flattened to text', p.description === "Line one\nIt's bold & fine");
check('play price, category and iap', p.price === 'Free' && p.category === 'Music & Audio' && p.inAppPurchases === true);
check('play images are sized', p.icon === 'https://play-lh.googleusercontent.com/icon=s512' && p.screenshots[0].endsWith('/shot=w720'));
check('play page without the data blob is nothing', playToListing('<html></html>', 'com.demo') === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
