/**
 * Image cache that converts fetched images into blob: URLs so that the
 * virtual scroller can destroy and recreate DOM nodes without ever making
 * a second network request for the same image.
 *
 * How it works:
 *  1. When a card's image loads (onImageLoad), we immediately re-fetch it via
 *     the Fetch API. Because the browser just loaded it, the response comes
 *     straight from the HTTP memory cache — no network round-trip.
 *  2. We call URL.createObjectURL(blob) and store it in `blobSrcs`.
 *  3. `blobSrcs` is a reactive Map, so any computed() that calls getCachedSrc()
 *     automatically re-evaluates and switches the <img> src to the blob URL.
 *  4. From that point on, <img src="blob:..."> never touches the network,
 *     regardless of the original image's Cache-Control headers.
 *
 * For cross-origin images that block CORS (fetch throws TypeError), we fall
 * back to keeping a live Image object reference. This keeps the decoded
 * bitmap alive in the browser's in-process memory cache, which helps for
 * servers that DO send reasonable cache headers.
 */
import { reactive } from 'vue'

// Tracks URLs that have finished a browser decode (for imgLoading eager/lazy).
const loaded = new Set()

// Kept alive so the browser retains decoded bitmaps in memory (CORS-fallback).
const imageRefs = new Map() // url → Image | true (sentinel while fetch in-flight)

// The primary cache: original url → blob: URL.
// reactive() so components re-render automatically when a blob URL becomes ready.
const blobSrcs = reactive(new Map())

export function useImageCache() {
  const markLoaded = (url) => {
    if (url) loaded.add(url)
  }

  const isLoaded = (url) => loaded.has(url)

  /**
   * Convert `url` to a blob: URL and store it in blobSrcs.
   * Safe to call multiple times — duplicate calls are no-ops.
   *
   * Call this from onImageLoad() so the image is guaranteed to be in
   * the browser's HTTP cache when we fetch it, meaning no extra network
   * round-trip is needed to create the blob.
   */
  const preload = (url) => {
    if (!url || blobSrcs.has(url) || imageRefs.has(url)) return

    // Sentinel prevents duplicate in-flight requests.
    imageRefs.set(url, true)

    fetch(url, { cache: 'force-cache' })
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`))
        return r.blob()
      })
      .then((blob) => {
        blobSrcs.set(url, URL.createObjectURL(blob))
        loaded.add(url)
      })
      .catch(() => {
        // CORS failure or non-2xx — keep a live Image reference as fallback
        // so the browser retains the decoded bitmap in its in-process cache.
        const img = new Image()
        img.src = url
        imageRefs.set(url, img)
        img.onload = () => {
          loaded.add(url)
          img.decode?.().catch(() => {})
        }
      })
  }

  /**
   * Returns the cached blob: URL for `url` if available, otherwise `url` itself.
   * Call inside a computed() — Vue tracks the reactive blobSrcs Map access
   * so the computed re-evaluates when the blob URL becomes ready.
   */
  const getCachedSrc = (url) => (url ? blobSrcs.get(url) ?? url : url)

  return { markLoaded, isLoaded, preload, getCachedSrc }
}
