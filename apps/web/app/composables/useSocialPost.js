/**
 * A saved social post, read out of the `clientMetadata` column — the web twin of
 * the native app's `SocialPost` (webbites-native/WebBitesKit/.../SocialPost.swift).
 * Same field names, same vocabulary, so there is one shape to keep in step.
 */

const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/**
 * Profile pictures come through the same CDNs as a post's own pictures. A text
 * post can end up with its author's avatar in `media`, which drawn as a slide
 * says the post was a photograph of its author. Mirrors `SharePlatform.isAvatarURL`.
 */
export function isAvatarURL(raw) {
  let url
  try { url = new URL(raw) } catch { return false }
  const host = url.hostname
  const path = url.pathname.toLowerCase()
  if (host.endsWith('twimg.com')) return path.startsWith('/profile_images') || path.startsWith('/profile_banners')
  if (host.endsWith('cdninstagram.com') || host.endsWith('fbcdn.net')) return /t51\.\d+-19/.test(path)
  if (host === 'cdn.bsky.app') return path.startsWith('/img/avatar')
  if (host === 'styles.redditmedia.com' || host.endsWith('redditstatic.com')) return true
  if (host.endsWith('ggpht.com') || host === 'yt3.googleusercontent.com') return true
  if (host.endsWith('tiktokcdn.com') || host.endsWith('tiktokcdn-us.com')) {
    return path.includes('-avt-') || path.includes('/avatar')
  }
  return path.includes('/accounts/avatars/') || path.includes('/accounts/headers/')
}

const HOSTS = [
  [/(^|\.)(x|twitter)\.com$/, 'twitter'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)bsky\.app$/, 'bluesky'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'pinterest'],
]

/** The mark each platform wears on a card: a tabler brand icon and, where it has one, its colour. */
export const SOCIAL_BRANDS = {
  twitter: { icon: 'i-tabler-brand-x' },
  threads: { icon: 'i-tabler-brand-threads' },
  instagram: { icon: 'i-tabler-brand-instagram', color: '#e1306c' },
  tiktok: { icon: 'i-tabler-brand-tiktok', color: '#ff0050' },
  bluesky: { icon: 'i-tabler-brand-bluesky', color: '#0a7aff' },
  reddit: { icon: 'i-tabler-brand-reddit', color: '#ff4500' },
  pinterest: { icon: 'i-tabler-brand-pinterest', color: '#e60023' },
}

/** The social platform a saved URL belongs to, from its host alone — or null. */
export function socialPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname
    return HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? null
  } catch {
    return null
  }
}

const PROFILE_URLS = {
  twitter: (h) => `https://x.com/${h}`,
  instagram: (h) => `https://www.instagram.com/${h}/`,
  threads: (h) => `https://www.threads.com/@${h}`,
  bluesky: (h) => `https://bsky.app/profile/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  reddit: (h) => `https://www.reddit.com/u/${h}`,
  pinterest: (h) => `https://www.pinterest.com/${h}/`,
}

const HASHTAG_URLS = {
  twitter: (t) => `https://x.com/hashtag/${t}`,
  instagram: (t) => `https://www.instagram.com/explore/tags/${t}/`,
  threads: (t) => `https://www.threads.com/search?q=%23${t}`,
  bluesky: (t) => `https://bsky.app/hashtag/${t}`,
  tiktok: (t) => `https://www.tiktok.com/tag/${t}`,
  youtube: (t) => `https://www.youtube.com/hashtag/${t}`,
}

// Mastodon is thousands of instances, so a bare `@ada` could be anyone's account:
// it is tinted but not linked. A platform with no entry here does the same.
const ENTITY = /(^|[\s(\[{"'“‘—–/])(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.-]+|[ur]\/[\p{L}\p{N}_-]+)/gu
const TRAILING = /[.,;:!?)\]}"'’”]+$/

/**
 * The caption split into runs: `{ kind, text, url }`. Concatenating every run's
 * text reproduces the body, so nothing is dropped. Rendered as text nodes, never
 * as HTML — the page that wrote this caption is not trusted.
 */
export function socialTextRuns(text, platform) {
  if (!text) return []
  const runs = []
  let cursor = 0
  const plain = (value) => value && runs.push({ kind: 'plain', text: value })

  for (const match of text.matchAll(ENTITY)) {
    const lead = match[1]
    let token = match[2]
    const start = match.index + lead.length
    const isLink = token.startsWith('http')
    // Trailing punctuation belongs to the sentence, not to the entity.
    token = token.replace(TRAILING, '')
    const body = token.slice(1)

    let kind = null
    let url = null
    if (isLink) {
      if (token.length > 8) { kind = 'link'; url = token }
    } else if (token[0] === '#') {
      if (/\p{L}/u.test(body)) {
        kind = 'hashtag'
        url = HASHTAG_URLS[platform]?.(encodeURIComponent(body)) ?? null
      }
    } else if (token[0] === '@') {
      if (/\p{L}/u.test(body)) {
        kind = 'mention'
        url = PROFILE_URLS[platform]?.(body) ?? null
      }
    } else if (platform === 'reddit' && body) {
      kind = 'mention'
      url = `https://www.reddit.com/${token}`
    }
    if (!kind) continue

    plain(text.slice(cursor, start))
    runs.push({ kind, text: token, url })
    cursor = start + token.length
  }
  plain(text.slice(cursor))
  return runs
}

/** Normalised post for a website row, or null when it is not worth a post view. */
export function socialPostOf(website) {
  let raw = website?.clientMetadata
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object') return null

  const platform = trimmed(raw.platform) || 'web'
  if (platform === 'web') return null

  const seen = new Set()
  const media = (Array.isArray(raw.media) ? raw.media : []).flatMap((item) => {
    const url = trimmed(item?.url) || trimmed(item?.poster)
    if (!url || isAvatarURL(url) || seen.has(url)) return []
    seen.add(url)
    const video = item.type === 'video'
    const poster = trimmed(item.poster)
    return [{ kind: video ? 'video' : 'image', url, poster, src: video ? (poster || url) : url }]
  })

  const post = {
    platform,
    canonicalUrl: trimmed(raw.canonicalUrl),
    title: trimmed(raw.title),
    text: trimmed(raw.text),
    author: trimmed(raw.author),
    authorHandle: trimmed(raw.authorHandle),
    authorAvatar: trimmed(raw.authorAvatar),
    publishedAt: trimmed(raw.publishedAt),
    media,
  }
  return post.text || post.title || media.length ? post : null
}
