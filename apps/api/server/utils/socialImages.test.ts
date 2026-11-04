/**
 * Tests for turning a social post's media list into a multi-image bookmark.
 *
 * The two cases worth pinning are the ones that silently corrupt a row rather
 * than failing: a single-picture post must write *no* `images` column at all
 * (a one-row column says nothing `imagesOf()` doesn't already infer), and a
 * re-host that partly fails must not renumber the carousel — a slide we could
 * not copy keeps its own URL where it is, instead of dropping out and pulling
 * every later slide forward onto the wrong caption. Run with:
 *
 *   npm run test:socialImages
 */

import { carouselImages, hasCarousel, applyRehosted } from './socialImages';
import { MAX_IMAGES } from './bookmarkImages';
import type { ClientMetadata, ClientMedia } from './clientMetadata';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}`); }
};

const post = (media: ClientMedia[]): ClientMetadata => ({
  platform: 'instagram',
  kind: 'post',
  media,
  text: 'a caption'
});

const image = (url: string): ClientMedia => ({ type: 'image', url });

// --- a single picture is not a carousel -------------------------------------

check('a one-picture post writes no images column',
  carouselImages(post([image('https://cdninstagram.com/a.jpg')])).length === 0);

check('a post with no media writes no images column',
  carouselImages(post([])).length === 0);

check('null metadata is not a carousel', hasCarousel(null) === false);

// --- a carousel ------------------------------------------------------------

const carousel = carouselImages(
  post([
    image('https://cdninstagram.com/1.jpg'),
    image('https://cdninstagram.com/2.jpg'),
    image('https://cdninstagram.com/3.jpg')
  ]),
  { title: 'Three slides', sourceId: 'bm1' }
);

check('a three-picture carousel writes three images', carousel.length === 3);
check('the carousel keeps post order', carousel[0].url.endsWith('1.jpg') && carousel[2].url.endsWith('3.jpg'));
check('every image gets its own id', new Set(carousel.map((item) => item.id)).size === 3);
check('only the cover carries the post title',
  carousel[0].title === 'Three slides' && carousel[1].title === undefined);
check('every image names the bookmark it came from',
  carousel.every((item) => item.sourceId === 'bm1'));

// --- video slides contribute their poster, never a stream -------------------

const mixed = carouselImages(post([
  image('https://cdninstagram.com/1.jpg'),
  { type: 'video', url: 'https://cdninstagram.com/poster.jpg', poster: 'https://cdninstagram.com/poster.jpg' }
]));
check('a video slide contributes its poster frame',
  mixed.length === 2 && mixed[1].url.endsWith('poster.jpg'));

// --- duplicates and caps ---------------------------------------------------

const duplicated = carouselImages(post([
  image('https://cdninstagram.com/1.jpg'),
  image('https://cdninstagram.com/1.jpg'),
  image('https://cdninstagram.com/2.jpg')
]));
check('the same picture twice counts once', duplicated.length === 2);

const many = carouselImages(post(
  Array.from({ length: MAX_IMAGES + 6 }, (_, index) => image(`https://cdninstagram.com/${index}.jpg`))
));
check('the carousel is capped at MAX_IMAGES', many.length === MAX_IMAGES);

// --- re-hosting ------------------------------------------------------------

const rehosted = applyRehosted(carousel, [
  { url: 'https://s3.webbites.io/1.jpg', fileName: 'one.jpg' },
  null,
  { url: 'https://s3.webbites.io/3.jpg' }
]);

check('a re-hosted slide takes the new url', rehosted[0].url === 'https://s3.webbites.io/1.jpg');
check('a re-hosted slide records its file name', rehosted[0].fileName === 'one.jpg');
check('a slide that could not be re-hosted keeps its own url',
  rehosted[1].url === carousel[1].url);
check('a failed slide never renumbers the ones after it',
  rehosted.length === 3 && rehosted[2].url === 'https://s3.webbites.io/3.jpg');
check('re-hosting preserves per-image metadata',
  rehosted[0].title === 'Three slides' && rehosted[0].id === carousel[0].id);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
