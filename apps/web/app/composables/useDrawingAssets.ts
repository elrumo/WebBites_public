/**
 * Drawing asset hydrate / dehydrate.
 *
 * A Quickdraw snapshot is `{ document: { store: { [id]: ShapeRecord | AssetRecord } } }`.
 * Pasted or imported images land in the store as `AssetRecord { id, typeName: 'asset',
 * src, w, h }` where `src` is a base64 data URL — inline in the document. Left alone,
 * a handful of photos would push the row past anything sane to keep in a Parse column.
 *
 * So the two forms differ:
 *
 *   persisted  — every asset `src` is an https:// URL to a Parse.File
 *   editing    — every asset `src` is a data URL
 *
 * The editing form is not an optimisation, it is a correctness requirement. Quickdraw
 * renders image assets with a plain `new Image()` and never sets `crossOrigin`
 * (see `@quickdrawjs/core/src/shapes.js`, `assetImage`), so a board that has drawn a
 * remote image has a *tainted* canvas and `editor.exportImage()` rejects with a
 * SecurityError — thumbnails would silently stop updating. Converting to data URLs
 * before `loadSnapshot` is what keeps the canvas exportable.
 *
 * Note we never rewrite the *live* store. The plan sketched calling
 * `store.update(id, { src: url }, 'remote')` after each upload; doing it on a copy at
 * save time instead keeps the editor's document untouched (no diff, no undo entry, no
 * chance of a later render pulling the remote URL back through the image cache) while
 * producing exactly the same persisted bytes.
 *
 * Shared verbatim in spirit with the native bridge (`bridge.js`) so a board authored on
 * one platform round-trips through the other.
 */

export interface AssetRecord {
  id: string
  typeName: 'asset'
  src: string
  w: number
  h: number
}

export interface DrawingSnapshot {
  document: { store: Record<string, any> }
}

/** assetId -> remote URL, for assets already living in the bucket. */
export type AssetUrlCache = Map<string, string>

const isAsset = (rec: any): rec is AssetRecord =>
  !!rec && rec.typeName === 'asset' && typeof rec.src === 'string'

const isDataUrl = (src: string) => src.startsWith('data:')

export const emptyDrawingSnapshot = (): DrawingSnapshot => ({ document: { store: {} } })

/** A snapshot with no shapes in it — used to disable Save on an untouched board. */
export function isDrawingEmpty(snapshot: DrawingSnapshot | null | undefined): boolean {
  const store = snapshot?.document?.store
  if (!store) return true
  return !Object.values(store).some((rec: any) => rec?.typeName === 'shape')
}

/** Shallow-clone the snapshot so we can swap asset records without touching the original. */
function cloneSnapshot(snapshot: DrawingSnapshot): DrawingSnapshot {
  return { document: { store: { ...snapshot.document.store } } }
}

/**
 * Fetch a remote asset and return it as a data URL.
 *
 * Tries the bucket directly first. That requires `Access-Control-Allow-Origin` on
 * files.webbites.io; if the bucket is not configured for it the request fails and we
 * fall back to pulling the bytes through our own origin, which has no such
 * constraint. The native app has neither problem — it fetches over URLSession.
 */
async function remoteToDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`)
    return await blobToDataUrl(await res.blob())
  } catch (err) {
    const { dataUrl } = await $fetch<{ dataUrl?: string; error?: string }>('/api/drawingAsset', {
      method: 'post',
      body: { fetchUrl: url },
    })
    if (!dataUrl) throw err
    return dataUrl
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

/**
 * Persisted -> editing.
 *
 * Returns the snapshot to hand to `store.loadSnapshot`, plus the cache mapping each
 * asset back to the URL it already has in the bucket so dehydration does not re-upload
 * bytes that are already there.
 *
 * An asset that cannot be fetched is left pointing at its URL rather than failing the
 * whole board: the drawing still opens and stays editable, and `tainted` tells the
 * caller to stop exporting thumbnails from it (that export would throw).
 */
export async function hydrateSnapshot(
  snapshot: DrawingSnapshot | null | undefined,
): Promise<{ snapshot: DrawingSnapshot; cache: AssetUrlCache; tainted: boolean }> {
  const cache: AssetUrlCache = new Map()

  if (!snapshot?.document?.store) {
    return { snapshot: emptyDrawingSnapshot(), cache, tainted: false }
  }

  const out = cloneSnapshot(snapshot)
  let tainted = false

  const remote = Object.values(out.document.store).filter(
    (rec: any) => isAsset(rec) && !isDataUrl(rec.src),
  ) as AssetRecord[]

  await Promise.all(
    remote.map(async (asset) => {
      cache.set(asset.id, asset.src)
      try {
        out.document.store[asset.id] = { ...asset, src: await remoteToDataUrl(asset.src) }
      } catch (err) {
        console.error('[drawing] could not inline asset, thumbnails disabled:', asset.src, err)
        tainted = true
      }
    }),
  )

  return { snapshot: out, cache, tainted }
}

/**
 * Editing -> persisted.
 *
 * Uploads any asset still carrying a data URL, records it in `cache` (mutated in place,
 * so the next autosave is a no-op for that asset) and returns a copy of the snapshot
 * with every `src` pointing at the bucket.
 *
 * An upload failure leaves that one asset inline rather than dropping the image —
 * the row is bigger than we would like, but nothing the user drew is lost.
 */
export async function dehydrateSnapshot(
  snapshot: DrawingSnapshot,
  cache: AssetUrlCache,
): Promise<DrawingSnapshot> {
  if (!snapshot?.document?.store) return emptyDrawingSnapshot()

  const out = cloneSnapshot(snapshot)

  const inline = Object.values(out.document.store).filter(
    (rec: any) => isAsset(rec) && isDataUrl(rec.src),
  ) as AssetRecord[]

  await Promise.all(
    inline.map(async (asset) => {
      const known = cache.get(asset.id)
      if (known) {
        out.document.store[asset.id] = { ...asset, src: known }
        return
      }
      try {
        const url = await uploadDrawingAsset(asset.src, asset.id)
        cache.set(asset.id, url)
        out.document.store[asset.id] = { ...asset, src: url }
      } catch (err) {
        console.error('[drawing] asset upload failed, keeping it inline:', asset.id, err)
      }
    }),
  )

  return out
}

/** POST one data URL to the asset endpoint and get back its bucket URL. */
export async function uploadDrawingAsset(dataUrl: string, assetId: string): Promise<string> {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png'
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png'

  const res = await $fetch<{ url?: string; error?: any }>('/api/drawingAsset', {
    method: 'post',
    body: { data: dataUrl, name: `${assetId}.${ext}`, type: mime },
  })

  if (!res?.url) throw new Error(res?.error ? JSON.stringify(res.error) : 'no url returned')
  return res.url
}

export const useDrawingAssets = () => ({
  hydrateSnapshot,
  dehydrateSnapshot,
  uploadDrawingAsset,
  isDrawingEmpty,
  emptyDrawingSnapshot,
  blobToDataUrl,
})
