/**
 * A saved App Store / Google Play page, read out of the `appListing` column —
 * the web twin of the native app's `AppListing` (webbites-native/WebBitesKit/
 * .../AppListing.swift). Same field names as the backend's `appListing.ts`.
 */

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const link = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null)
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** Normalised listing for a website row, or null when it is not an app page. */
export function appListingOf(website) {
  let raw = website?.appListing
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object') return null
  if (raw.store !== 'appstore' && raw.store !== 'playstore') return null
  const name = text(raw.name)
  if (!name || !text(raw.appId)) return null

  return {
    store: raw.store,
    appId: text(raw.appId),
    storeUrl: link(raw.storeUrl),
    name,
    subtitle: text(raw.subtitle),
    developer: text(raw.developer),
    developerUrl: link(raw.developerUrl),
    privacyUrl: link(raw.privacyUrl),
    icon: link(raw.icon),
    screenshots: (Array.isArray(raw.screenshots) ? raw.screenshots : []).filter(link),
    description: text(raw.description),
    rating: number(raw.rating),
    ratingCount: number(raw.ratingCount),
    ageRating: text(raw.ageRating),
    category: text(raw.category),
    price: text(raw.price),
    sizeBytes: number(raw.sizeBytes),
    languages: (Array.isArray(raw.languages) ? raw.languages : []).filter((l) => typeof l === 'string'),
    minOS: text(raw.minOS),
    version: text(raw.version),
    releaseNotes: text(raw.releaseNotes),
    updatedAt: text(raw.updatedAt),
    releasedAt: text(raw.releasedAt),
    inAppPurchases: typeof raw.inAppPurchases === 'boolean' ? raw.inAppPurchases : null,
    copyright: text(raw.copyright),
    installs: text(raw.installs),
  }
}

/** "378.7 MB", as the store prints it. */
export function formatAppSize(bytes) {
  if (!bytes || bytes <= 0) return null
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}
