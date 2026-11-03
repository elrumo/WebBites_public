/**
 * Getting a picked file into a format that will still be a picture once it is
 * on a card.
 *
 * The picker accepts `image/*`, which on a Mac means HEIC and on a scanner
 * means TIFF — formats Chrome and Firefox draw nothing at all for. Those used
 * to upload "successfully" and land in the grid as a blank card, because
 * nothing on either side of the wire ever converted them.
 *
 * The browser's own decoders are the test: `createImageBitmap` succeeds exactly
 * where the browser could have drawn the file, so a HEIC picked in Safari is
 * re-encoded here and uploads as a JPEG, and one picked in Chrome is refused at
 * the picker with a message rather than after a round trip. The server does the
 * same job again for everything that reaches it (`server/utils/imageFormat.ts`)
 * — this half exists so the answer arrives before the upload, not after it.
 */

/** What every current browser draws, and what we upload untouched. */
export const WEB_SAFE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif'
])

export function isWebSafeImageType(type) {
  if (!type) return false
  return WEB_SAFE_IMAGE_TYPES.has(String(type).toLowerCase().split(';')[0].trim())
}

/** `photo.heic` -> `photo.jpg` */
export function jpegName(fileName) {
  const stem = String(fileName || '').replace(/\.[^./\\]+$/, '')
  return `${stem || 'image'}.jpg`
}

/**
 * Re-encodes through a canvas. Throws when the browser can't decode the file,
 * which is the signal that nothing downstream will be able to either.
 */
async function toJpegFile(file) {
  // `from-image` keeps the EXIF rotation a phone records; without it a
  // re-encoded portrait photo uploads on its side.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2d context')
  context.drawImage(bitmap, 0, 0)
  if (typeof bitmap.close === 'function') bitmap.close()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('Could not encode the image')

  return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() })
}

/**
 * Splits a picked list into what can be uploaded and what cannot.
 *
 * Web-safe files are passed through as-is — this is a rescue, not a second
 * compression pass, and re-encoding a JPEG the user chose would lose quality
 * for nothing.
 */
export async function toUploadableImages(files) {
  const accepted = []
  const rejected = []

  for (const file of Array.from(files || [])) {
    if (isWebSafeImageType(file.type)) {
      accepted.push(file)
      continue
    }

    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      rejected.push(file)
      continue
    }

    try {
      accepted.push(await toJpegFile(file))
    } catch (error) {
      console.warn('Could not read image, refusing it rather than uploading a blank card:', file.name, error)
      rejected.push(file)
    }
  }

  return { accepted, rejected }
}

/** What to tell someone whose file could not be read. */
export function unreadableImageMessage(rejected) {
  const names = rejected.map((file) => file.name).filter(Boolean)
  const isHeic = rejected.some((file) => /heic|heif/i.test(`${file.type} ${file.name}`))

  const { t } = useNuxtApp().$i18n

  if (isHeic) {
    return names.length === 1
      ? t('alerts.core_files.heic_one', { name: names[0] })
      : t('alerts.core_files.heic_many')
  }

  return names.length === 1
    ? t('alerts.core_files.unreadable_one', { name: names[0] })
    : t('alerts.core_files.unreadable_many')
}
