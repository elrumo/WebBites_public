/**
 * Pictures for Jev (https://docs.typesafe.ai/images). A bookmark's image is
 * fetched, made to fit Jev's limits and handed over as base64 JPEG; the request
 * builders write the returned `refs` into the state and send the `assets`.
 *
 * Jev rejects, rather than resizes, anything outside PNG/JPEG, 256–1568 px per
 * side and 78,400 pixels, and one bad image fails the whole request, so every
 * image is re-encoded here and skipped when it cannot fit. Nothing throws:
 * no picture means a text-only request, as before.
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { JevImages } from '../types/jev.types';
import { fileUrl, imagesOf, coverUrl, type SiteLike } from './bookmarkImages';
import { WEB_SAFE_FORMATS } from './imageFormat';
import { jevOn } from './jevJudgments';
import { safeFetch } from './safeUrl';

/** Pictures per request; every one costs input tokens. */
const MAX_IMAGES = 4;
const MAX_SIDE = 1568;
const MIN_SIDE = 256;
const MIN_PIXELS = 78_400;
const MAX_BYTES = 16 * 1024 * 1024;
const FETCH_MS = 5_000;

/**
 * Where a bookmark's pictures are: an image bookmark's own (cover first), or a
 * web bookmark's screenshot (ours, so it always loads) before its OG image.
 */
export function imageUrlsFor(site: SiteLike): string[] {
  if (site.get('type') === 'image') return imagesOf(site).slice(0, MAX_IMAGES).map((image) => image.url);
  const url = fileUrl(site.get('siteScreenshot')) || coverUrl(site);
  return url ? [url] : [];
}

/** The body, or null the moment it goes over the cap. */
async function readCapped(response: Response, max: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/** An image file as a base64 JPEG inside Jev's limits, or null when it cannot be made to fit. */
export async function fitForJev(input: Buffer): Promise<string | null> {
  try {
    // Raster only: sharp would also rasterise SVG and PDF, which can pull in other files.
    const { format } = await sharp(input).metadata();
    if (!format || !WEB_SAFE_FORMATS.has(format)) return null;
    const { data, info } = await sharp(input)
      .rotate() // Jev ignores EXIF orientation, so turn the pixels upright
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // no alpha: JPEG would make it black
      .jpeg({ quality: 85 }) // baseline, the safest JPEG for Jev
      .toBuffer({ resolveWithObject: true });
    if (info.width < MIN_SIDE || info.height < MIN_SIDE || info.width * info.height < MIN_PIXELS) return null;
    return data.toString('base64');
  } catch {
    return null;
  }
}

async function prepare(url: string): Promise<string | null> {
  try {
    const response = await safeFetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) return null;
    const input = await readCapped(response, MAX_BYTES);
    return input && (await fitForJev(input));
  } catch {
    return null;
  }
}

/** Pictures from `urls` ready for a request, or null when off or none can be used. */
export async function prepareImages(urls: string[]): Promise<JevImages | null> {
  if (!jevOn('JEV_IMAGES') || !urls.length) return null;
  const prepared = await Promise.all(urls.slice(0, MAX_IMAGES).map(prepare));
  const assets: JevImages['assets'] = {};
  for (const data of prepared) {
    // A long unique key, so it cannot match ordinary text in the state.
    if (data) assets[randomUUID()] = { type: 'image', format: 'jpg', data_base64: data };
  }
  const refs = Object.keys(assets);
  return refs.length ? { assets, refs } : null;
}
