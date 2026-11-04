import { resolveFileUrl } from '~/composables/useBookmarkImages'

/**
 * Reading an audio bookmark.
 *
 * The sibling of `useBookmarkPdf`, and it reads the same two columns for the
 * same reason: `file` is our stored copy — the only thing there is to play,
 * since a recording has no original anywhere else — and `fileUrl` is the flat
 * string the search document carries, because the grid is served from
 * Meilisearch and never sees a Parse.File.
 */

export function isAudioBookmark(site) {
  return Boolean(site) && site.type === 'audio'
}

/** Recorded in one of our apps, rather than a file that was picked. */
export function isVoiceNote(site) {
  return Array.isArray(site?.subType) && site.subType.includes('voiceNote')
}

/** Our stored copy of the recording — what the player loads. */
export function audioFileUrl(site) {
  if (!site) return null
  return site.fileUrl || resolveFileUrl(site.file) || null
}

/** `3:24`, or `1:02:11` for something long. Empty when the length is unknown. */
export function audioDurationLabel(site) {
  const total = Number(site?.audioDuration)
  if (!Number.isFinite(total) || total <= 0) return ''

  const seconds = Math.round(total)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const pad = (value) => String(value).padStart(2, '0')

  return hours > 0
    ? `${hours}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`
}

/** `0:07` for a player's position, which is the same rule without the site. */
export function timeLabel(seconds) {
  return audioDurationLabel({ audioDuration: Math.max(seconds, 0.4) })
}

/**
 * The bars the card and the scrubber draw.
 *
 * A recording saved before the waveform existed, or one ffmpeg could not read,
 * has none — so a shape is made up from the bookmark's own id. It is a texture
 * that says "this is a recording", not a measurement, and a stable one: the
 * same bookmark draws the same bars every time rather than shimmering on each
 * render.
 */
export function audioPeaks(site, count = 64) {
  const stored = site?.audioPeaks
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.map(peak => Math.min(1, Math.max(0.04, Number(peak) || 0)))
  }

  const seedSource = String(site?.objectId || site?.customId || 'webbites')
  let seed = 0
  for (let i = 0; i < seedSource.length; i++) seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0

  const peaks = []
  for (let i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    // Two overlapping waves under the noise, so it reads as speech rather
    // than as a random picket fence.
    const wave = 0.5 + 0.28 * Math.sin(i / 3.1) + 0.14 * Math.sin(i / 1.3)
    peaks.push(Math.min(1, Math.max(0.12, wave * (0.6 + (seed % 1000) / 1000 * 0.6))))
  }
  return peaks
}

/** True while the server still owes us a transcript. */
export function isTranscribing(site) {
  return site?.transcriptStatus === 'pending'
}

/** The transcript as plain text, whichever side made it. */
export function transcriptText(site) {
  return (site?.siteBody || '').trim()
}

/** `[{start, end, text}]`, only ever present on a row fetched for the modal. */
export function transcriptSegments(site) {
  const segments = site?.audioTranscript?.segments
  return Array.isArray(segments) ? segments : []
}
