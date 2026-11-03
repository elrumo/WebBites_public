import { computed, unref } from 'vue'

/**
 * Multi-image bookmarks.
 *
 * An image bookmark can hold several pictures in an `images` array. The backend
 * keeps one invariant: `images[0]` is the cover and `OGImage` always mirrors
 * `images[0].url`, so anything that only ever wanted one picture keeps working.
 *
 * A bookmark with no `images` array IS a valid one-image bookmark — it reads as
 * the single-item list `[cover]`. That is why this shipped with no migration.
 *
 * Cover resolution here deliberately puts `OGImage` ahead of `file` for image
 * bookmarks, which is the opposite of what the older inline copies did. `file`
 * is the Parse.File of the picture that was uploaded first and it never moves;
 * after a reorder it points at the wrong picture. `OGImage` follows the cover.
 */

/** Parse.File | plain object | string -> url */
export function resolveFileUrl(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.url === 'function') return value.url()
  if (typeof value.url === 'string') return value.url
  return null
}

/** A historic double-prefix bug in stored OGImage values. */
function cleanUrl(url) {
  return typeof url === 'string' ? url.replace('https://https://', 'https://') : url
}

/** The one picture a bookmark shows in the grid. */
export function bookmarkCoverUrl(site) {
  if (!site) return null

  const images = site.images
  if (Array.isArray(images) && images.length > 0 && images[0]?.url) {
    return cleanUrl(images[0].url)
  }

  if (site.OGImage) return cleanUrl(site.OGImage)

  if (site.type === 'image') {
    // Legacy rows where `file` was stored as a bare string kept the real URL
    // on the bookmark itself.
    if (typeof site.file === 'string') return site.url
    return resolveFileUrl(site.file) || site.url || null
  }

  return resolveFileUrl(site.OGImageFile) || resolveFileUrl(site.file) || null
}

/**
 * Every URL a card can show for this bookmark, best first, deduplicated.
 * Callers walk it on <img> error and fall back to a gradient after the end.
 */
export function bookmarkImageSources(site, preferScreenshot = false) {
  if (!site) return []
  // Search hits carry only the flat URL; the Parse File arrives with the full row.
  const screenshot = resolveFileUrl(site.siteScreenshot) || site.siteScreenshotUrl
  const list = []
  if (preferScreenshot && screenshot) list.push(['siteScreenshot', screenshot])
  if (site.type === 'image') list.push(['file', bookmarkCoverUrl(site)])
  list.push(
    ['OGImage', cleanUrl(site.OGImage)],
    ['OGImageFile', resolveFileUrl(site.OGImageFile)],
    ['siteScreenshot', screenshot],
  )
  const seen = new Set()
  return list.filter(([, url]) => typeof url === 'string' && url && !seen.has(url) && seen.add(url))
}

/**
 * Every picture on a bookmark, in display order. Always at least the cover, so
 * callers never branch on whether this is a multi-image bookmark.
 */
export function bookmarkImages(site) {
  if (!site) return []

  const images = site.images
  if (Array.isArray(images) && images.length > 0) {
    return images
      .filter((image) => image && typeof image.url === 'string' && image.url)
      .map((image, index) => ({ ...image, url: cleanUrl(image.url), id: image.id || `img_${index}` }))
  }

  const url = bookmarkCoverUrl(site)
  if (!url) return []

  return [{
    id: site.objectId || 'cover',
    url,
    title: site.siteTitle || undefined,
    notes: site.siteNotes || site.textNote || undefined,
    tags: site.tags || undefined,
  }]
}

/**
 * How many pictures a bookmark holds, for the card badge.
 *
 * The grid lists from Meilisearch rather than Parse and the `images` array is
 * not indexed, so `imageCount` off the search document is the value that is
 * actually present there. Falls back to the array for a bookmark loaded
 * straight from Parse.
 */
export function bookmarkImageCount(site) {
  if (!site) return 0
  if (Array.isArray(site.images) && site.images.length > 0) return site.images.length
  return site.imageCount || 1
}

/** Reactive wrapper for use inside components. */
export function useBookmarkImages(site) {
  const images = computed(() => bookmarkImages(unref(site)))
  return {
    images,
    cover: computed(() => bookmarkCoverUrl(unref(site))),
    count: computed(() => bookmarkImageCount(unref(site))),
    isMulti: computed(() => bookmarkImageCount(unref(site)) > 1),
  }
}
