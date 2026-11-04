/**
 * Telling the kinds of picked file apart, before any of them is uploaded.
 *
 * The picker, the drop zone and the paste handler all hand over a `FileList`
 * that the user assembled, and the three kinds we keep go to different places: a
 * batch of pictures becomes one multi-image bookmark, while each PDF and each
 * recording is a thing in its own right and becomes a bookmark of its own.
 * Splitting here rather than at each call site is what lets someone drop a
 * paper, a voice memo and three screenshots in one go and get the five
 * bookmarks they meant.
 *
 * `file.type` comes from the OS and is occasionally empty — a PDF dragged out
 * of some archive tools arrives as `application/octet-stream`, or as nothing at
 * all — so the extension is the fallback. The server reads the magic bytes of
 * whatever arrives either way, so a wrong guess here costs a round trip and a
 * clear message, not a broken bookmark.
 */

const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf'])

export function isPdfFile(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase().split(';')[0].trim()
  if (PDF_MIME_TYPES.has(type)) return true
  if (type.startsWith('image/')) return false
  return /\.pdf$/i.test(String(file.name || ''))
}

export function isImageFile(file) {
  if (!file) return false
  if (isPdfFile(file)) return false
  if (String(file.type || '').toLowerCase().startsWith('image/')) return true
  // A picker set to `image/*` can still hand over a file with no type at all.
  return /\.(jpe?g|png|gif|webp|avif|heic|heif|tiff?|bmp|svg)$/i.test(String(file.name || ''))
}

/**
 * Audio, by type then by extension.
 *
 * `video/mp4` and `video/webm` count: a recording made in a browser comes back
 * from `MediaRecorder` wearing a video type even when there is no picture in
 * it, and a `.mp4` a user picked is usually a video — but the server reads the
 * container either way, and an audio-only MP4 saved as an audio bite is right
 * far more often than refusing the browser's own recording would be.
 */
const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
  'audio/ogg', 'audio/opus', 'audio/webm', 'audio/flac', 'audio/x-flac'
])

export function isAudioFile(file) {
  if (!file) return false
  if (isPdfFile(file)) return false
  const type = String(file.type || '').toLowerCase().split(';')[0].trim()
  if (AUDIO_MIME_TYPES.has(type)) return true
  if (type.startsWith('audio/')) return true
  if (type.startsWith('image/') || type.startsWith('video/')) return false
  return /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|caf|aiff?)$/i.test(String(file.name || ''))
}

/** `{ images, pdfs, audios, other }`, in the order the user picked them. */
export function splitByKind(files) {
  const images = []
  const pdfs = []
  const audios = []
  const other = []

  for (const file of Array.from(files || [])) {
    if (isPdfFile(file)) pdfs.push(file)
    else if (isImageFile(file)) images.push(file)
    else if (isAudioFile(file)) audios.push(file)
    else other.push(file)
  }

  return { images, pdfs, audios, other }
}

/** What the picker and the drop zone will take. */
export const UPLOAD_ACCEPT = 'image/*,application/pdf,.pdf,audio/*,.m4a,.mp3,.wav,.ogg,.flac'

/** What to say when someone picked something we cannot keep. */
export function unsupportedFileMessage(files) {
  const names = Array.from(files || []).map((file) => file.name).filter(Boolean)
  const { t } = useNuxtApp().$i18n
  return names.length === 1
    ? t('alerts.core_files.unsupported_one', { name: names[0] })
    : t('alerts.core_files.unsupported_many')
}
