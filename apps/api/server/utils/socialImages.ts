/**
 * A social post's pictures, as a multi-image bookmark.
 *
 * An Instagram carousel, a tweet with four photos and a Reddit gallery all
 * arrive as `clientMetadata.media` — an ordered list the extractors and the
 * resolvers already build. Until now the save path read `media[0]` into
 * `OGImage` and dropped the rest on the floor, so a ten-picture carousel was
 * saved as one picture.
 *
 * This maps that list onto the `images[]` column `bookmarkImages.ts` defines,
 * which the grid, the detail carousel and the merge endpoint all already speak.
 * Its one invariant holds here too: `images[0]` is the cover and `OGImage`
 * mirrors it, so a reader that only ever knew about `OGImage` is unaffected.
 *
 * Pure and Parse-free on purpose — the re-hosting half lives at the call site,
 * and this half is unit-testable.
 */

import type { ClientMetadata, ClientMedia } from './clientMetadata';
import { MAX_IMAGES, type BookmarkImage } from './bookmarkImages';

let counter = 0;
function imageId(): string {
  counter = (counter + 1) % 1e6;
  return `img_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The still picture for one media entry.
 *
 * A video never contributes its stream — we don't store playable video — so it
 * contributes its poster frame, which is what the carousel shows for that slide
 * and exactly what the platform shows before you press play.
 */
function stillUrl(item: ClientMedia): string | undefined {
  if (item.type === 'video') return item.poster || item.url || undefined;
  return item.url || item.poster || undefined;
}

/**
 * The post's pictures in post order, deduplicated, or an empty list when the
 * post has fewer than two.
 *
 * Deliberately empty for a single-picture post rather than a one-item array:
 * `imagesOf()` already reads a bookmark with no `images` column as the
 * single-item list `[cover]`, so writing one out would be a column full of
 * rows that say nothing, on every social save there is.
 */
export function carouselImages(
  metadata: ClientMetadata | null | undefined,
  context: { title?: string; sourceId?: string } = {}
): BookmarkImage[] {
  if (!metadata || !Array.isArray(metadata.media)) return [];

  const seen = new Set<string>();
  const images: BookmarkImage[] = [];

  for (const item of metadata.media) {
    const url = stillUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      id: imageId(),
      url,
      // The caption belongs to the post, not to slide seven of it, so only the
      // cover carries it — that is the image a merge would later inherit the
      // bookmark's own metadata from.
      title: images.length === 0 ? context.title || undefined : undefined,
      sourceId: context.sourceId
    });
    if (images.length >= MAX_IMAGES) break;
  }

  return images.length > 1 ? images : [];
}

/**
 * Whether this post is worth writing an `images[]` column for at all — the
 * cheap check callers make before doing any Parse work.
 */
export function hasCarousel(metadata: ClientMetadata | null | undefined): boolean {
  return carouselImages(metadata).length > 1;
}

/**
 * Reorders a re-hosted set of URLs back onto the images they replaced.
 *
 * Re-hosting runs per image and some of them fail — an expired CDN link, a 404,
 * a timeout — and a failure must not renumber the carousel. Keyed by index, so
 * a slide we could not copy keeps its original (still-working, for now) URL
 * rather than being dropped and pulling every later slide forward.
 */
export function applyRehosted(
  images: BookmarkImage[],
  rehosted: Array<{ url: string; fileName?: string } | null>
): BookmarkImage[] {
  return images.map((image, index) => {
    const replacement = rehosted[index];
    if (!replacement?.url) return image;
    return { ...image, url: replacement.url, fileName: replacement.fileName || image.fileName };
  });
}
