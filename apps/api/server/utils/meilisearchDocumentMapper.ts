/**
 * Shared utility for preparing documents for Meilisearch indexing
 * This ensures consistency between saveToSearchIndex and migrateToMeilisearch
 */

interface SiteColors {
  colorCategory?: string;
  colorName?: string;
}

interface WebsiteInput {
  id: string;
  user?: { objectId: string };
  url?: string;
  baseUrl?: string;
  siteTitle?: string;
  siteDescription?: string;
  siteBody?: string;
  siteAuthor?: string;
  sitePublisher?: string;
  siteDate?: string;
  siteLogo?: string;
  OGImage?: string;
  fullPageScreenshot?: { url?: string } | string;
  fullPageScreenshotUrl?: string;
  siteScreenshot?: { url?: string } | string;
  siteScreenshotUrl?: string;
  tags?: string[];
  siteColors?: SiteColors[];
  screenshotAnnotations?: any[];
  favorited?: boolean;
  pinned?: boolean;
  type?: string;
  subType?: string[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  mediaTypeObject?: any;
  images?: any[];
  textNote?: string;
  siteNotes?: string;
  isDeleted?: boolean;
  deletedAt?: Date | string | null;
  hiddenFrom?: string | null;
  aiSummary?: any;
  metaData?: any;
  fileUrl?: string;
  fileName?: string;
  audioDuration?: number;
  audioPeaks?: number[];
  transcriptStatus?: string;
  [key: string]: any;
}

interface MeilisearchDocument {
  id: string;
  objectId: string;
  user: { objectId: string };
  userId?: string;
  url: string;
  baseUrl: string;
  siteTitle: string;
  siteDescription: string;
  siteBody: string;
  siteAuthor: string;
  sitePublisher: string;
  siteDate: string;
  siteLogo: string;
  OGImage: string;
  fullPageScreenshotUrl: string;
  siteScreenshotUrl: string;
  tags: string[];
  siteColors: SiteColors[] | {};
  colorNames: string;
  colorCategories: string;
  colorDescription: string;
  screenshotAnnotations: any[];
  favorited: boolean;
  pinned: boolean;
  type: string;
  subType: string[];
  createdAt: Date | string;
  updatedAt: Date | string;
  mediaTypeObject: any;
  /** How many images the bookmark holds. The array itself is not indexed. */
  imageCount: number;
  /**
   * The two images after the cover, as URLs. The grid's stacked card fans
   * these out behind the cover; the rest of the array stays out of the index.
   */
  imageThumbs: string[];
  textNote: string;
  aiSummary: any;
  metaData: any;
  title: string;
  /**
   * Our stored copy of an uploaded file — the audio an audio bite plays.
   *
   * The grid is served from this index, so without it a card could not start
   * playing until the full Parse row had been fetched behind it.
   */
  fileUrl: string;
  fileName: string;
  /** An audio bite's length in seconds, for the card's badge. `0` for the rest. */
  audioDuration: number;
  /** 0..1 bars the card draws its waveform from. Empty when none were made. */
  audioPeaks: number[];
  /** `none` | `pending` | `done` | `failed` | `quota`, `''` for a non-audio bite. */
  transcriptStatus: string;
  /** An app bookmark's card summary (`appListing.ts`), `null` for every other bite. */
  appCard: { store: string; rating?: number; ratingCount?: number; category?: string; price?: string; subtitle?: string; screenshots?: string[] } | null;
  /**
   * Whether the bookmark sits in the trash. The document stays in the index
   * when a bookmark is deleted — that is what lets the deleted section search
   * it and a restore put it back — so every other search filters on this.
   */
  isDeleted: boolean;
  /** ISO instant the bookmark was moved to the trash, `''` while it isn't. */
  deletedAt: string;
  /**
   * `'library'`, `'everywhere'`, or `''` for the ordinary case.
   *
   * Carried here and not only written by the partial update in
   * `meilisearchTrash.ts`, because any later edit to the bookmark — a retitle, a
   * new tag, a save-pipeline stage — rebuilds this whole document. A mapper
   * that dropped the field would quietly un-hide the bookmark on the next such
   * save.
   */
  hiddenFrom: string;
}

/**
 * Remove HTML tags and limit string length
 */
// export function removeHtmlTags(html: string, maxLength: number = 1000): string {
//   if (!html) return '';

//   // Remove HTML tags
//   const textOnly = html.replace(/<[^>]*>/g, '');

//   // Decode HTML entities
//   const decoded = textOnly
//     .replace(/&amp;/g, '&')
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&quot;/g, '"')
//     .replace(/&#39;/g, "'")
//     .replace(/&nbsp;/g, ' ');

//   // Trim and limit length
//   const trimmed = decoded.trim();
//   return trimmed.length > maxLength ? trimmed.substring(0, maxLength) : trimmed;
// }

/**
 * Extract base URL from a full URL
 */
function extractBaseUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Extract title from URL (fallback when no title exists)
 */
function extractTitleFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Prepare a website document for Meilisearch indexing
 * This function ensures all fields required by the embedding template exist
 *
 * Embedding template fields:
 * - siteTitle
 * - siteDescription
 * - textNote
 * - tags
 * - colorDescription
 */
export function prepareMeilisearchDocument(site: WebsiteInput): MeilisearchDocument {
  // Process colors with null safety
  const colors = Array.isArray(site.siteColors) ? site.siteColors : [];

  const uniqueCategories = [...new Set(
    colors
      .map((c) => c.colorCategory)
      .filter((cat): cat is string => cat !== undefined && cat !== 'Unknown')
  )].join(' ');

  const colorNames = colors
    .map((c) => c.colorName)
    .filter((name): name is string => Boolean(name))
    .join(' ');

  const colorDescription = colors
    .filter((c) => c.colorCategory !== 'Unknown')
    .map((c) => `${c.colorName} (${c.colorCategory})`)
    .join(', ');

  // Extract and clean title - ALWAYS provide a value
  const rawTitle = site.siteTitle || extractTitleFromUrl(site.url || '') || 'Untitled';
  const cleanTitle = rawTitle.trim() || 'Untitled';

  // Clean and truncate siteBody BEFORE creating document
  let cleanedSiteBody = '';
  if (site.siteBody && typeof site.siteBody === 'string') {
    cleanedSiteBody = removeHtmlTags(site.siteBody, 1000).trim();
  }

  // Ensure tags is always an array
  const safeTags = Array.isArray(site.tags) ? site.tags : [];
  
  // Ensure subType is always an array
  const safeSubType = Array.isArray(site.subType) ? site.subType : [];

  // Build the document with ALL embedding-critical fields guaranteed non-null/non-empty
  let document: MeilisearchDocument = {
    // Core identification fields
    id: site.id,
    objectId: site.id,

    // User information
    user: site.user || { objectId: '' },

    // CRITICAL EMBEDDING FIELDS - Always present with fallbacks
    url: site.url || '',
    baseUrl: site.baseUrl || extractBaseUrl(site.url || ''),
    siteTitle: cleanTitle, // Guaranteed non-empty
    title: cleanTitle, // Guaranteed non-empty (duplicate for compatibility)
    siteDescription: (site.siteDescription || '').trim(), // Empty string if null
    siteBody: cleanedSiteBody, // Empty string if null, cleaned and truncated
    tags: safeTags, // Always array
    type: site.type || 'default', // Always has a value
    subType: safeSubType, // Always array
    
    // Color fields - always present
    siteColors: colors, // Always array (even if empty)
    colorNames: colorNames, // Empty string if no colors
    colorCategories: uniqueCategories, // Empty string if no categories
    colorDescription: colorDescription, // Empty string if no description

    // Other fields with defaults
    siteAuthor: site.siteAuthor || '',
    sitePublisher: site.sitePublisher || '',
    siteDate: site.siteDate || '',
    siteLogo: site.siteLogo || '',
    OGImage: site.OGImage || '',
    // The Screenshot tab draws from this. The Parse File itself is dropped below
    // (it is a blob, not searchable), so the flat URL is the only way a bite
    // opened from a search result knows it has a full-page capture at all.
    fullPageScreenshotUrl: site.fullPageScreenshotUrl
      || (typeof site.fullPageScreenshot === 'string'
        ? site.fullPageScreenshot
        : site.fullPageScreenshot?.url) || '',
    // The grid card's fallback when OGImage is dead (404, hotlink-blocked).
    // Without it a search-listed card runs out of sources and shows a gradient
    // until the modal merges in the Parse row.
    siteScreenshotUrl: site.siteScreenshotUrl
      || (typeof site.siteScreenshot === 'string'
        ? site.siteScreenshot
        : site.siteScreenshot?.url) || '',

    screenshotAnnotations: site.screenshotAnnotations || [],
    favorited: site.favorited || false,
    pinned: site.pinned || false,
    createdAt: site.createdAt || new Date(),
    updatedAt: site.updatedAt || new Date(),
    mediaTypeObject: site.mediaTypeObject || {},
    // A bookmark with no images array is a one-image bookmark, so 1 is the
    // floor, not 0 — the card badge only shows above 1.
    imageCount: Array.isArray(site.images) && site.images.length > 0 ? site.images.length : 1,
    imageThumbs: Array.isArray(site.images)
      ? site.images.slice(1, 3).map((image: any) => image?.url).filter(Boolean)
      : [],

    // The trash flag is always written, never left undefined: search filters
    // on it, and a document missing the field would have to be special-cased
    // in every filter expression.
    isDeleted: site.isDeleted === true,
    // Parse.Object.toJSON() encodes Date columns as { __type: 'Date', iso }.
    deletedAt: site.deletedAt
      ? (site.deletedAt instanceof Date ? site.deletedAt.toISOString() : String((site.deletedAt as any).iso ?? site.deletedAt))
      : '',
    // Same reasoning as isDeleted: always written, `''` when the bookmark is
    // not hidden, so the filter has a concrete value to compare against.
    hiddenFrom: site.hiddenFrom || '',

    // A stored file: the document a PDF bite opens, the recording an audio
    // bite plays. Always written so a card never has to special-case a missing
    // key — `''` for every bite that has no file of its own.
    fileUrl: site.fileUrl || '',
    fileName: site.fileName || '',
    audioDuration: Number.isFinite(Number(site.audioDuration)) ? Number(site.audioDuration) : 0,
    audioPeaks: Array.isArray(site.audioPeaks) ? site.audioPeaks : [],
    transcriptStatus: site.transcriptStatus || '',
    appCard: site.appCard || null,

    // Additional fields
    textNote: site.textNote || site.siteNotes || '',
    aiSummary: site.aiSummary || {},
    metaData: site.metaData || {
      author: site.siteAuthor || '',
      publisher: site.sitePublisher || ''
    },
  };

  // Clean up fields that should be removed
  delete (document as any).categories;
  delete (document as any).fullPageScreenshot;
  delete (document as any).newTags;
  delete (document as any).savedFrom;
  delete (document as any).size;
  delete (document as any).aiFromCache;
  delete (document as any).fromCache;
  delete (document as any).done;
  delete (document as any).siteHtml;
  delete (document as any).siteHtmlFile;
  delete (document as any).tokenUsage;
  delete (document as any).acl;
  delete (document as any).ACL;

  return document;
}
