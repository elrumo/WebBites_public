/**
 * Multiple images on one image bookmark.
 *
 * The whole design rests on one invariant: `images[0]` is the cover, and
 * `OGImage` always mirrors `images[0].url`. Every existing reader — the grid
 * card, the boards endpoints, the trash listing, colour extraction,
 * determineScreenshotUrl — keeps reading `OGImage`/`file` and needs no changes.
 *
 * The second rule: a bookmark with no `images` field IS a valid one-image
 * bookmark, read as the single-item list `[cover]`. That is what makes this
 * shippable with no migration and no backfill.
 *
 * Pure on purpose — it duck-types Parse objects via `get()` (the same trick
 * `countedByUser` in bookmarkTrash.ts uses) so it can be tested without a
 * Parse server.
 */

export interface BookmarkImage {
  /** Stable identity for reorder and list keys. */
  id: string;
  url: string;
  fileName?: string;
  /** Per-image metadata. A merged image keeps the title its bookmark had. */
  title?: string;
  notes?: string;
  tags?: string[];
  colors?: { colorCategory?: string; colorName?: string }[];
  /** objectId of the bookmark this image was merged in from. */
  sourceId?: string;
}

export interface SiteLike {
  id?: string;
  get(key: string): any;
}

/**
 * A hard cap, enforced at both entry points (upload and merge). Not a
 * performance guess: `images` rides in the Parse row and the Algolia record has
 * a 100 kB budget, and nobody swipes through 50 pictures in a card.
 */
export const MAX_IMAGES = 20;

let idCounter = 0;
function makeImageId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return `img_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Unwrap a Parse.File-or-string-or-plain-object into a URL. */
export function fileUrl(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.url === 'function') return value.url();
  if (typeof value.url === 'string') return value.url;
  return null;
}

/**
 * The single image a bookmark shows today. Mirrors the resolution order in the
 * image-tagging handler, with OGImage first because the invariant keeps it
 * pointing at the cover.
 */
export function coverUrl(site: SiteLike): string | null {
  return fileUrl(site.get('OGImage'))
    || fileUrl(site.get('file'))
    || fileUrl(site.get('OGImageFile'))
    || null;
}

/**
 * A bookmark's images, always at least its cover.
 *
 * The fallback item carries the bookmark's own title/notes/tags, which is what
 * lets merge treat a plain single-image bookmark and a multi-image one
 * identically — its metadata becomes that image's per-image metadata.
 */
export function imagesOf(site: SiteLike): BookmarkImage[] {
  const stored = site.get('images');

  if (Array.isArray(stored) && stored.length > 0) {
    return stored
      .filter((image: any) => image && typeof image.url === 'string' && image.url.length > 0)
      .map((image: any) => ({
        ...image,
        id: typeof image.id === 'string' && image.id ? image.id : makeImageId(),
        sourceId: image.sourceId || site.id
      }));
  }

  const url = coverUrl(site);
  if (!url) return [];

  return [{
    id: site.id || makeImageId(),
    url,
    title: site.get('siteTitle') || undefined,
    notes: site.get('siteNotes') || site.get('textNote') || undefined,
    tags: site.get('tags') || undefined,
    colors: site.get('siteColors') || undefined,
    sourceId: site.id
  }];
}

/**
 * Flatten several bookmarks into one ordered image list.
 *
 * Flatten, not nest: a source may already be a multi-image bookmark, and
 * merging into a nested array is the failure that silently corrupts the row.
 * Order follows the order the caller passed the sources in.
 */
export function buildMergedImages(sources: SiteLike[]): BookmarkImage[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const merged: BookmarkImage[] = [];

  for (const source of sources) {
    for (const image of imagesOf(source)) {
      // The same picture twice is never what a merge meant.
      if (seenUrls.has(image.url)) continue;
      seenUrls.add(image.url);

      // Ids only have to be unique within the row; two sources can collide.
      let id = image.id;
      if (seenIds.has(id)) id = makeImageId();
      seenIds.add(id);

      merged.push({ ...image, id });
      if (merged.length >= MAX_IMAGES) return merged;
    }
  }

  return merged;
}

/**
 * Bookmark-level `tags` is the union of the group's own tags and every
 * per-image tag. Keeping it flat here is what lets tag filtering, tag counts
 * and the Meilisearch facets keep working with no changes at all.
 */
export function unionTags(groupTags: any, images: BookmarkImage[]): string[] {
  const tags = new Set<string>();
  for (const tag of Array.isArray(groupTags) ? groupTags : []) {
    if (typeof tag === 'string' && tag) tags.add(tag);
  }
  for (const image of images) {
    for (const tag of Array.isArray(image.tags) ? image.tags : []) {
      if (typeof tag === 'string' && tag) tags.add(tag);
    }
  }
  return [...tags];
}
